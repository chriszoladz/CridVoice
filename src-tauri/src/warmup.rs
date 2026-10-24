//! Background model loading has its own cancellation epoch, separate from takes.
use crate::config::Settings;
use std::sync::Mutex;
use tokio::{
    sync::{watch, Mutex as AsyncMutex, MutexGuard},
    task::JoinHandle,
};

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Route {
    pub model_id: String,
    pub device: String,
    pub assets: Vec<String>,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Selection {
    pub setup_complete: bool,
    pub speech: Option<Route>,
    pub cleanup: Option<Route>,
    pub preview: Option<Route>,
}
impl Selection {
    pub fn from_settings(settings: &Settings, cuda: bool) -> Self {
        let speech_gpu = settings.transcription.device == "cuda"
            || settings.transcription.device == "auto" && cuda;
        let cleanup_gpu =
            settings.cleanup.device == "cuda" || settings.cleanup.device == "auto" && cuda;
        Self {
            setup_complete: settings.setup_complete,
            speech: (settings.transcription.mode == "local").then(|| Route {
                model_id: settings.transcription.model_id.clone(),
                device: if speech_gpu { "cuda" } else { "cpu" }.into(),
                assets: if speech_gpu {
                    vec![
                        settings.transcription.model_id.clone(),
                        "nvidia-runtime".into(),
                    ]
                } else {
                    vec![settings.transcription.model_id.clone()]
                },
            }),
            cleanup: (settings.cleanup.mode == "managed").then(|| Route {
                model_id: settings.cleanup.model_id.clone(),
                device: if cleanup_gpu { "vulkan" } else { "cpu" }.into(),
                assets: vec![
                    settings.cleanup.model_id.clone(),
                    if cleanup_gpu {
                        "llama-gpu"
                    } else {
                        "llama-cpu"
                    }
                    .into(),
                ],
            }),
            preview: (settings.transcription.mode == "local" && settings.appearance.live_preview)
                .then(|| Route {
                    model_id: "whisper-preview".into(),
                    device: "cpu".into(),
                    assets: vec!["whisper-preview".into()],
                }),
        }
    }
    pub fn ready(&self, installed: impl Fn(&str) -> bool) -> Self {
        let eligible = |route: &Option<Route>| {
            route
                .as_ref()
                .filter(|route| self.setup_complete && route.assets.iter().all(|id| installed(id)))
                .cloned()
        };
        Self {
            setup_complete: self.setup_complete,
            speech: eligible(&self.speech),
            cleanup: eligible(&self.cleanup),
            preview: eligible(&self.preview),
        }
    }
    pub fn uses(&self, id: &str) -> bool {
        self.speech
            .iter()
            .chain(self.cleanup.iter())
            .chain(self.preview.iter())
            .any(|route| route.assets.iter().any(|asset| asset == id))
    }
    pub fn is_empty(&self) -> bool {
        self.speech.is_none() && self.cleanup.is_none() && self.preview.is_none()
    }
}

pub struct Coordinator {
    epoch: Mutex<(u64, bool, bool)>,
    changes: watch::Sender<u64>,
    tasks: Mutex<Vec<(u64, JoinHandle<()>)>>,
}
impl Default for Coordinator {
    fn default() -> Self {
        let (changes, _) = watch::channel(0);
        Self {
            epoch: Mutex::new((0, false, false)),
            changes,
            tasks: Mutex::new(Vec::new()),
        }
    }
}
impl Coordinator {
    pub fn invalidate(&self) {
        let mut epoch = self.epoch.lock().unwrap();
        epoch.0 += 1;
        self.changes.send_replace(epoch.0);
    }
    pub fn close(&self) {
        let mut epoch = self.epoch.lock().unwrap();
        epoch.1 = true;
        epoch.0 += 1;
        self.changes.send_replace(epoch.0);
    }
    pub fn suspend(&self) {
        let mut epoch = self.epoch.lock().unwrap();
        epoch.2 = true;
        epoch.0 += 1;
        self.changes.send_replace(epoch.0);
    }
    pub fn snapshot(&self) -> Ticket {
        let epoch = self.epoch.lock().unwrap();
        Ticket {
            expected: epoch.0,
            changes: self.changes.subscribe(),
        }
    }
    pub fn begin(&self, rearm: bool) -> Option<Ticket> {
        let mut epoch = self.epoch.lock().unwrap();
        if epoch.1 || epoch.2 && !rearm {
            return None;
        }
        if rearm {
            epoch.2 = false;
        }
        epoch.0 += 1;
        self.changes.send_replace(epoch.0);
        Some(Ticket {
            expected: epoch.0,
            changes: self.changes.subscribe(),
        })
    }
    pub fn is_pending(&self) -> bool {
        let epoch = self.epoch.lock().unwrap().0;
        self.tasks
            .lock()
            .unwrap()
            .iter()
            .any(|(ticket, task)| *ticket == epoch && !task.is_finished())
    }
    pub fn track(&self, ticket: &Ticket, task: JoinHandle<()>) {
        let mut tasks = self.tasks.lock().unwrap();
        tasks.retain(|(_, task)| !task.is_finished());
        tasks.push((ticket.expected, task));
    }
    pub async fn cancel_and_wait(&self) -> Ticket {
        let (ticket, tasks) = {
            let mut epoch = self.epoch.lock().unwrap();
            // Replacement begin() calls wait until the cancelled task list
            // has been captured, so newer valid work is never joined here.
            let mut tasks = self.tasks.lock().unwrap();
            epoch.0 += 1;
            self.changes.send_replace(epoch.0);
            let ticket = Ticket {
                expected: epoch.0,
                changes: self.changes.subscribe(),
            };
            (ticket, std::mem::take(&mut *tasks))
        };
        for (_, task) in tasks {
            let _ = task.await;
        }
        ticket
    }
}
#[derive(Clone)]
pub struct Ticket {
    expected: u64,
    changes: watch::Receiver<u64>,
}
pub enum Admission<G> {
    Cancelled,
    Busy,
    Ready(G),
}
impl Ticket {
    pub fn is_current(&self) -> bool {
        *self.changes.borrow() == self.expected
    }
    pub async fn cancelled(&mut self) {
        while *self.changes.borrow_and_update() == self.expected {
            if self.changes.changed().await.is_err() {
                break;
            }
        }
    }
    pub async fn lock_current<'a, T>(
        &mut self,
        engine: &'a AsyncMutex<T>,
    ) -> Option<MutexGuard<'a, T>> {
        let guard = tokio::select! { biased; _ = self.cancelled() => return None, guard = engine.lock() => guard };
        self.is_current().then_some(guard)
    }
    pub async fn lock_when_idle<'a, T>(
        &mut self,
        engine: &'a AsyncMutex<T>,
        can_start: impl Fn() -> bool,
    ) -> Admission<MutexGuard<'a, T>> {
        let Some(guard) = self.lock_current(engine).await else {
            return Admission::Cancelled;
        };
        if can_start() {
            Admission::Ready(guard)
        } else {
            Admission::Busy
        }
    }
    pub async fn run<T>(&mut self, operation: impl std::future::Future<Output = T>) -> Option<T> {
        let result = tokio::select! { biased; _ = self.cancelled() => None, value = operation => Some(value) };
        if self.is_current() {
            result
        } else {
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    };

    #[test]
    fn only_actual_local_routes_and_setup_change_warm_identity() {
        let mut settings = Settings {
            setup_complete: true,
            ..Default::default()
        };
        let original = Selection::from_settings(&settings, true);
        settings.cleanup.output_mode = "generate".into();
        settings.cleanup.code_language = "Python".into();
        settings.cleanup.style = "professional".into();
        settings.general.save_history = false;
        settings.appearance.waveform = false;
        assert_eq!(Selection::from_settings(&settings, true), original);
        settings.transcription.device = "cpu".into();
        assert_ne!(Selection::from_settings(&settings, true), original);
        settings.transcription.mode = "openai".into();
        settings.cleanup.mode = "off".into();
        assert!(Selection::from_settings(&settings, true).is_empty());
    }
    #[test]
    fn partial_assets_warm_only_ready_selected_routes() {
        let mut settings = Settings {
            setup_complete: true,
            ..Default::default()
        };
        let selected = Selection::from_settings(&settings, true);
        let ready = selected.ready(|id| matches!(id, "whisper-turbo" | "nvidia-runtime"));
        assert!(ready.speech.is_some());
        assert!(ready.cleanup.is_none());
        assert!(ready.preview.is_none());
        assert!(selected.uses("nvidia-runtime"));
        assert!(!selected.uses("whisper-small"));
        settings.setup_complete = false;
        assert!(Selection::from_settings(&settings, true)
            .ready(|_| true)
            .is_empty());
    }
    #[test]
    fn preview_route_is_optional_cpu_only_and_uses_its_own_asset() {
        let mut settings = Settings {
            setup_complete: true,
            ..Default::default()
        };
        let selected = Selection::from_settings(&settings, true);
        assert_eq!(
            selected.preview,
            Some(Route {
                model_id: "whisper-preview".into(),
                device: "cpu".into(),
                assets: vec!["whisper-preview".into()],
            })
        );
        assert!(selected.uses("whisper-preview"));
        let ready = selected.ready(|id| id == "whisper-preview");
        assert!(ready.preview.is_some());
        assert!(ready.speech.is_none());
        assert!(ready.cleanup.is_none());
        assert!(!ready.is_empty());
        settings.appearance.live_preview = false;
        assert!(Selection::from_settings(&settings, true).preview.is_none());
        assert!(!Selection::from_settings(&settings, true).uses("whisper-preview"));
        settings.appearance.live_preview = true;
        settings.transcription.mode = "openai".into();
        assert!(Selection::from_settings(&settings, true).preview.is_none());
    }

    #[test]
    fn toggling_preview_changes_only_the_preview_warm_route() {
        let mut settings = Settings::default();
        let enabled = Selection::from_settings(&settings, true);
        settings.appearance.live_preview = false;
        let disabled = Selection::from_settings(&settings, true);
        assert_eq!(enabled.speech, disabled.speech);
        assert_eq!(enabled.cleanup, disabled.cleanup);
        assert_ne!(enabled.preview, disabled.preview);
        settings.appearance.live_preview = true;
        settings.general.save_history = false;
        settings.cleanup.style = "professional".into();
        assert_eq!(enabled, Selection::from_settings(&settings, true));
    }
    #[tokio::test]
    async fn unloaded_epoch_prevents_queued_warm_from_acquiring_engine() {
        let coordinator = Arc::new(Coordinator::default());
        let engine = Arc::new(AsyncMutex::new(false));
        let held = engine.lock().await;
        let mut ticket = coordinator.begin(true).unwrap();
        let worker_engine = engine.clone();
        let (queued, waiting) = tokio::sync::oneshot::channel();
        let task = tokio::spawn(async move {
            queued.send(()).unwrap();
            if let Some(mut guard) = ticket.lock_current(&worker_engine).await {
                *guard = true;
            }
        });
        waiting.await.unwrap();
        coordinator.invalidate();
        drop(held);
        task.await.unwrap();
        assert!(!*engine.lock().await);
    }
    #[tokio::test]
    async fn queued_warm_rechecks_active_take_after_acquiring_engine() {
        let coordinator = Coordinator::default();
        let engine = Arc::new(AsyncMutex::new(false));
        let take_active = Arc::new(AtomicBool::new(false));
        let held = engine.lock().await;
        let mut ticket = coordinator.begin(true).unwrap();
        let worker_engine = engine.clone();
        let worker_take = take_active.clone();
        let (queued, waiting) = tokio::sync::oneshot::channel();
        let task = tokio::spawn(async move {
            queued.send(()).unwrap();
            match ticket
                .lock_when_idle(&worker_engine, || !worker_take.load(Ordering::SeqCst))
                .await
            {
                Admission::Ready(mut engine) => {
                    *engine = true;
                    false
                }
                Admission::Busy => true,
                Admission::Cancelled => false,
            }
        });
        waiting.await.unwrap();
        take_active.store(true, Ordering::SeqCst);
        drop(held);
        assert!(task.await.unwrap());
        assert!(!*engine.lock().await);
    }
    #[tokio::test]
    async fn cancellation_retires_warming_engine_before_maintenance_can_use_it() {
        let coordinator = Coordinator::default();
        let engine = Arc::new(AsyncMutex::new(false));
        let mut ticket = coordinator.begin(true).unwrap();
        let tracked = ticket.clone();
        let worker_engine = engine.clone();
        let (started, running) = tokio::sync::oneshot::channel();
        let task = tokio::spawn(async move {
            let mut guard = ticket.lock_current(&worker_engine).await.unwrap();
            *guard = true;
            started.send(()).unwrap();
            if ticket.run(std::future::pending::<()>()).await.is_none() {
                *guard = false;
            }
        });
        coordinator.track(&tracked, task);
        running.await.unwrap();
        coordinator.cancel_and_wait().await;
        assert!(!*engine.lock().await);
        assert!(!coordinator.is_pending());
    }
    #[tokio::test]
    async fn replaced_tasks_are_all_cancelled_and_closed_coordinator_never_rearms() {
        let coordinator = Coordinator::default();
        let finished = Arc::new(AtomicBool::new(false));
        let mut first = coordinator.begin(true).unwrap();
        let first_tracked = first.clone();
        let flag = finished.clone();
        coordinator.track(
            &first_tracked,
            tokio::spawn(async move {
                first.cancelled().await;
                flag.store(true, Ordering::SeqCst);
            }),
        );
        let mut second = coordinator.begin(true).unwrap();
        let second_tracked = second.clone();
        coordinator.track(
            &second_tracked,
            tokio::spawn(async move {
                second.cancelled().await;
            }),
        );
        coordinator.close();
        coordinator.cancel_and_wait().await;
        assert!(finished.load(Ordering::SeqCst));
        assert!(coordinator.begin(true).is_none());
    }
    #[tokio::test]
    async fn unload_cancels_blocked_lifecycle_request_and_suppresses_automatic_requeue() {
        let coordinator = Coordinator::default();
        let lifecycle = Arc::new(AsyncMutex::new(()));
        let held = lifecycle.lock().await;
        let mut request = coordinator.snapshot();
        let worker_lifecycle = lifecycle.clone();
        let (queued, waiting) = tokio::sync::oneshot::channel();
        let request_task = tokio::spawn(async move {
            queued.send(()).unwrap();
            request.lock_current(&worker_lifecycle).await.is_some()
        });
        waiting.await.unwrap();
        coordinator.suspend();
        assert!(!request_task.await.unwrap());
        assert!(coordinator.begin(false).is_none());
        coordinator.invalidate();
        assert!(coordinator.begin(false).is_none());
        drop(held);
        assert!(coordinator.begin(true).is_some());
    }
}
