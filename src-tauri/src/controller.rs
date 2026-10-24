//! Run session transitions in arrival order without serializing inference work.
use std::future::Future;
use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::Duration;
use tokio::sync::mpsc::UnboundedReceiver;

pub struct PreviewSchedule {
    timing: PreviewTiming,
}

enum PreviewTiming {
    Local { last_started: Option<Duration> },
    Remote { ticks_until_slot: u8 },
}

impl PreviewSchedule {
    pub fn new(local: bool) -> Self {
        Self {
            timing: if local {
                PreviewTiming::Local { last_started: None }
            } else {
                PreviewTiming::Remote {
                    ticks_until_slot: 32,
                }
            },
        }
    }

    pub fn try_start(&mut self, elapsed: Duration, busy: bool) -> bool {
        match &mut self.timing {
            PreviewTiming::Remote { ticks_until_slot } => {
                // Preserve the old remote-provider grid, including skipping a
                // busy slot instead of issuing a request as soon as it clears.
                *ticks_until_slot -= 1;
                if *ticks_until_slot == 0 {
                    *ticks_until_slot = 32;
                    !busy
                } else {
                    false
                }
            }
            PreviewTiming::Local { last_started } => {
                if busy {
                    return false;
                }
                let due = match last_started {
                    Some(last) => elapsed.saturating_sub(*last) >= Duration::from_millis(300),
                    None => elapsed >= Duration::from_millis(750),
                };
                if due {
                    // Missed local requests never accumulate into a burst.
                    *last_started = Some(elapsed);
                }
                due
            }
        }
    }
}

pub async fn run_ordered<T, F, Fut>(mut commands: UnboundedReceiver<T>, mut transition: F)
where
    F: FnMut(T) -> Fut,
    Fut: Future<Output = ()>,
{
    while let Some(command) = commands.recv().await {
        transition(command).await;
    }
}

pub fn run_if_active<T>(
    active: &dyn Fn() -> bool,
    operation: impl FnOnce() -> T,
) -> Result<T, String> {
    if !active() {
        return Err("Dictation was cancelled.".into());
    }
    Ok(operation())
}

pub fn matches_generation(current: &AtomicU64, expected: Option<u64>) -> bool {
    expected.is_none_or(|generation| current.load(Ordering::SeqCst) == generation)
}

pub async fn commit_if_current<T>(
    lifecycle: &tokio::sync::Mutex<()>,
    current: &AtomicU64,
    expected: u64,
    operation: impl FnOnce() -> T,
) -> Option<T> {
    let _guard = lifecycle.lock().await;
    matches_generation(current, Some(expected)).then(operation)
}

pub async fn finalize_if_current(
    current: &AtomicU64,
    expected: u64,
    path: &Path,
    write: impl FnOnce() -> Result<(), String> + Send + 'static,
) -> Result<bool, String> {
    if !matches_generation(current, Some(expected)) {
        return Ok(false);
    }
    let result = tokio::task::spawn_blocking(write)
        .await
        .map_err(|_| "Audio could not be finalized. Try dictating again.".to_string())
        .and_then(|result| result);
    if !matches_generation(current, Some(expected)) {
        let _ = tokio::fs::remove_file(path).await;
        return Ok(false);
    }
    if result.is_err() {
        let _ = tokio::fs::remove_file(path).await;
    }
    result.map(|_| true)
}

pub async fn finalize_preview_if_current(
    current: &AtomicU64,
    expected: u64,
    active: &AtomicBool,
    path: &Path,
    write: impl FnOnce() -> Result<(), String> + Send + 'static,
) -> Result<bool, String> {
    if !active.load(Ordering::Acquire) {
        return Ok(false);
    }
    // Always join the blocking writer. Dropping its future cannot stop a WAV
    // write and could otherwise recreate a stale file after cleanup on Windows.
    let saved = finalize_if_current(current, expected, path, write).await;
    if !active.load(Ordering::Acquire) {
        let _ = tokio::fs::remove_file(path).await;
        return Ok(false);
    }
    saved
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};
    use tokio::sync::{mpsc, oneshot};

    #[test]
    fn local_preview_starts_at_short_initial_delay_then_respects_cadence() {
        let mut schedule = PreviewSchedule::new(true);
        let at = Duration::from_millis;
        assert!(!schedule.try_start(at(749), false));
        assert!(schedule.try_start(at(750), false));
        assert!(!schedule.try_start(at(1049), false));
        assert!(schedule.try_start(at(1050), false));
        assert!(!schedule.try_start(at(1349), false));
        assert!(schedule.try_start(at(1350), false));
    }

    #[test]
    fn remote_preview_keeps_original_32_tick_opportunities() {
        let mut schedule = PreviewSchedule::new(false);
        let at = Duration::from_millis;
        for tick in 1..=64 {
            assert_eq!(schedule.try_start(at(tick * 75), false), tick % 32 == 0);
        }
    }

    #[test]
    fn remote_preview_misses_busy_slot_without_starting_on_first_free_tick() {
        let mut schedule = PreviewSchedule::new(false);
        let at = Duration::from_millis;
        for tick in 1..=32 {
            assert!(!schedule.try_start(at(tick * 75), true));
        }
        // Even after a long delay, the remote path waits for its next original
        // tick slot rather than using local elapsed-time catch-up behavior.
        for tick in 33..64 {
            assert!(!schedule.try_start(at(10_000 + tick * 75), false));
        }
        assert!(schedule.try_start(at(14_800), false));
    }

    #[test]
    fn delayed_preview_tick_does_not_catch_up_with_a_burst() {
        let mut schedule = PreviewSchedule::new(true);
        let at = Duration::from_millis;
        assert!(schedule.try_start(at(10_000), false));
        assert!(!schedule.try_start(at(10_000), false));
        assert!(!schedule.try_start(at(10_299), false));
        assert!(schedule.try_start(at(10_300), false));
    }

    #[test]
    fn overdue_preview_starts_on_first_free_tick_and_reanchors_its_cadence() {
        let mut schedule = PreviewSchedule::new(true);
        let at = Duration::from_millis;
        assert!(schedule.try_start(at(750), false));
        assert!(!schedule.try_start(at(1050), true));
        assert!(!schedule.try_start(at(3700), true));
        // The request finishes between timer-grid points. It can start on the
        // next tick, rather than waiting for another fixed 2.4-second grid.
        assert!(schedule.try_start(at(3775), false));
        assert!(!schedule.try_start(at(4074), false));
        assert!(schedule.try_start(at(4075), false));
    }

    #[tokio::test]
    async fn release_during_preview_write_waits_for_writer_and_cannot_submit_audio() {
        let root = std::env::temp_dir().join(uuid::Uuid::new_v4().to_string());
        std::fs::create_dir_all(&root).unwrap();
        let path = root.join("preview.wav");
        let generation = Arc::new(AtomicU64::new(1));
        let active = Arc::new(AtomicBool::new(true));
        let (started, writing) = oneshot::channel();
        let (release, blocked) = std::sync::mpsc::channel();
        let task_generation = generation.clone();
        let task_active = active.clone();
        let task_path = path.clone();
        let worker = tokio::spawn(async move {
            let write_path = task_path.clone();
            finalize_preview_if_current(&task_generation, 1, &task_active, &task_path, move || {
                started.send(()).unwrap();
                blocked.recv().unwrap();
                std::fs::write(write_path, b"public fixture").map_err(|e| e.to_string())
            })
            .await
            .unwrap()
        });
        writing.await.unwrap();
        // Stop/release leaves the take generation intact for final recognition.
        active.store(false, Ordering::Release);
        assert!(!worker.is_finished());
        release.send(()).unwrap();
        assert!(!worker.await.unwrap());
        assert!(!path.exists());
        assert_eq!(generation.load(Ordering::SeqCst), 1);
        std::fs::remove_dir(root).unwrap();
    }

    #[tokio::test]
    async fn stopped_preview_does_not_start_a_wav_writer_for_the_final_take() {
        let generation = AtomicU64::new(1);
        let active = AtomicBool::new(false);
        let called = Arc::new(AtomicBool::new(false));
        let writer_called = called.clone();
        assert!(!finalize_preview_if_current(
            &generation,
            1,
            &active,
            Path::new("unused.wav"),
            move || {
                writer_called.store(true, Ordering::SeqCst);
                Ok(())
            }
        )
        .await
        .unwrap());
        assert!(!called.load(Ordering::SeqCst));
    }

    #[tokio::test]
    async fn old_preview_waiting_for_new_session_cannot_overwrite_it() {
        let lifecycle = Arc::new(tokio::sync::Mutex::new(()));
        let generation = Arc::new(AtomicU64::new(1));
        let preview = Arc::new(Mutex::new(String::new()));
        let new_session_guard = lifecycle.lock().await;
        let old_lifecycle = lifecycle.clone();
        let old_generation = generation.clone();
        let old_preview = preview.clone();
        let old_result = tokio::spawn(async move {
            commit_if_current(&old_lifecycle, &old_generation, 1, || {
                *old_preview.lock().unwrap() = "old transcript".into();
            })
            .await
        });
        generation.store(2, Ordering::SeqCst);
        *preview.lock().unwrap() = "new session".into();
        drop(new_session_guard);
        assert!(old_result.await.unwrap().is_none());
        assert_eq!(*preview.lock().unwrap(), "new session");
    }

    #[tokio::test]
    async fn stale_timer_stop_queued_after_restart_keeps_new_take_recording() {
        let (commands, receiver) = mpsc::unbounded_channel();
        let generation = Arc::new(AtomicU64::new(1));
        let recording = Arc::new(Mutex::new(true));
        let worker_generation = generation.clone();
        let worker_recording = recording.clone();
        let worker = tokio::spawn(run_ordered(receiver, move |expected| {
            let generation = worker_generation.clone();
            let recording = worker_recording.clone();
            async move {
                match expected {
                    None => {
                        // Cancellation followed by the next hold/toggle take.
                        generation.store(2, Ordering::SeqCst);
                        *recording.lock().unwrap() = true;
                    }
                    Some(expected) if matches_generation(&generation, Some(expected)) => {
                        *recording.lock().unwrap() = false;
                    }
                    Some(_) => (),
                }
            }
        }));
        commands.send(None).unwrap();
        // An automatic stop/failure captured generation 1 before the restart,
        // but its command arrives after the new take has started.
        commands.send(Some(1)).unwrap();
        drop(commands);
        worker.await.unwrap();
        assert!(*recording.lock().unwrap());
    }

    #[tokio::test]
    async fn cancel_runs_before_delayed_final_audio_work_finishes() {
        let (commands, receiver) = mpsc::unbounded_channel();
        let (finished, final_audio) = oneshot::channel();
        let (cancelled, cancel_done) = oneshot::channel();
        let (transcribed, transcription_done) = oneshot::channel();
        let generation = Arc::new(AtomicU64::new(1));
        let current = generation.clone();
        let mut stop = Some((final_audio, transcribed));
        let mut cancel = Some(cancelled);
        let worker = tokio::spawn(run_ordered(receiver, move |is_stop| {
            let generation = current.clone();
            let stop = if is_stop { stop.take() } else { None };
            let cancel = if is_stop { None } else { cancel.take() };
            async move {
                if let Some((final_audio, transcribed)) = stop {
                    let expected = generation.load(Ordering::SeqCst);
                    // Finalization is detached from the ordered transition.
                    tokio::spawn(async move {
                        final_audio.await.unwrap();
                        transcribed
                            .send(matches_generation(&generation, Some(expected)))
                            .unwrap();
                    });
                } else {
                    generation.fetch_add(1, Ordering::SeqCst);
                    cancel.unwrap().send(()).unwrap();
                }
            }
        }));
        commands.send(true).unwrap();
        commands.send(false).unwrap();
        // This acknowledgement must arrive while final audio is still blocked.
        cancel_done.await.unwrap();
        finished.send(()).unwrap();
        assert!(!transcription_done.await.unwrap());
        drop(commands);
        worker.await.unwrap();
    }

    #[tokio::test]
    async fn cancelled_preview_or_final_write_removes_its_temporary_file() {
        let generation = Arc::new(AtomicU64::new(1));
        let writer_generation = generation.clone();
        let path = std::env::temp_dir().join(format!("cridvoice-{}.wav", uuid::Uuid::new_v4()));
        let writer_path = path.clone();
        let (started, writing) = oneshot::channel();
        let (finish, resume) = std::sync::mpsc::channel();
        let writer = tokio::spawn(async move {
            let output = writer_path.clone();
            finalize_if_current(&writer_generation, 1, &writer_path, move || {
                started.send(()).unwrap();
                resume.recv().unwrap();
                std::fs::write(output, b"fixed synthetic audio fixture").map_err(|e| e.to_string())
            })
            .await
        });
        writing.await.unwrap();
        generation.store(2, Ordering::SeqCst);
        finish.send(()).unwrap();
        assert!(!writer.await.unwrap().unwrap());
        assert!(!path.exists());
    }

    #[test]
    fn cancellation_during_preparation_prevents_input_dispatch() {
        use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
        let generation = AtomicU64::new(1);
        let sent = AtomicBool::new(false);
        let active = || generation.load(Ordering::SeqCst) == 1;
        // Simulate cancellation after waiting for modifiers or preparing paste.
        generation.fetch_add(1, Ordering::SeqCst);
        let result = run_if_active(&active, || sent.store(true, Ordering::SeqCst));
        assert!(result.is_err());
        assert!(!sent.load(Ordering::SeqCst));
    }

    #[tokio::test]
    async fn release_waits_for_pending_start_and_does_not_leave_recording_active() {
        let (commands, receiver) = mpsc::unbounded_channel();
        let (started, pending_start) = oneshot::channel();
        let (resume, initialization) = oneshot::channel();
        let recording = Arc::new(Mutex::new(false));
        let transitions = Arc::new(Mutex::new(Vec::new()));
        let current = recording.clone();
        let observed = transitions.clone();
        let mut start_signals = Some((started, initialization));
        let worker = tokio::spawn(run_ordered(receiver, move |pressed| {
            let current = current.clone();
            let observed = observed.clone();
            let start_signals = if pressed { start_signals.take() } else { None };
            async move {
                if let Some((started, initialization)) = start_signals {
                    let _ = started.send(());
                    initialization.await.unwrap();
                }
                *current.lock().unwrap() = pressed;
                observed.lock().unwrap().push(pressed);
            }
        }));
        commands.send(true).unwrap();
        pending_start.await.unwrap();
        commands.send(false).unwrap();
        resume.send(()).unwrap();
        drop(commands);
        worker.await.unwrap();
        assert_eq!(*transitions.lock().unwrap(), vec![true, false]);
        assert!(!*recording.lock().unwrap());
    }

    #[tokio::test]
    async fn second_toggle_observes_completed_microphone_initialization() {
        let (commands, receiver) = mpsc::unbounded_channel();
        let (started, pending_start) = oneshot::channel();
        let (resume, initialization) = oneshot::channel();
        let recording = Arc::new(Mutex::new(false));
        let current = recording.clone();
        let mut start_signals = Some((started, initialization));
        let worker = tokio::spawn(run_ordered(receiver, move |()| {
            let current = current.clone();
            let start_signals = start_signals.take();
            async move {
                // The toggle decision belongs to the serialized transition.
                let active = *current.lock().unwrap();
                if let Some((started, initialization)) = start_signals {
                    let _ = started.send(());
                    initialization.await.unwrap();
                }
                *current.lock().unwrap() = !active;
            }
        }));
        commands.send(()).unwrap();
        pending_start.await.unwrap();
        commands.send(()).unwrap();
        resume.send(()).unwrap();
        drop(commands);
        worker.await.unwrap();
        assert!(!*recording.lock().unwrap());
    }
}
