use crate::{
    audio::{AudioSnapshot, Recorder},
    config::Settings,
    core::Context,
    downloads::{self, Model},
    inference::{self, Inference},
    native,
    store::{self, HistoryEntry, Store},
};
use serde::Serialize;
use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter, Manager, State as TauriState, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_autostart::ManagerExt;

const OVERLAY_WIDTH: f64 = 440.;
const OVERLAY_HEIGHT: f64 = 148.;
const OVERLAY_BOTTOM_GAP: f64 = 12.;

fn overlay_bounds(
    position: (i32, i32),
    size: (u32, u32),
    scale: f64,
) -> (tauri::PhysicalPosition<i32>, tauri::PhysicalSize<u32>) {
    let scale = if scale.is_finite() && scale > 0. {
        scale
    } else {
        1.
    };
    let scaled = |logical: f64| (logical * scale).round().clamp(1., i32::MAX as f64) as u32;
    let available_width = size.0.clamp(1, i32::MAX as u32);
    let available_height = size.1.clamp(1, i32::MAX as u32);
    let width = scaled(OVERLAY_WIDTH).min(available_width);
    let height = scaled(OVERLAY_HEIGHT).min(available_height);
    let gap = scaled(OVERLAY_BOTTOM_GAP).min(available_height - height);
    let x = i64::from(position.0) + i64::from((available_width - width) / 2);
    let y = i64::from(position.1) + i64::from(available_height - height - gap);
    let coordinate = |value: i64| value.clamp(i32::MIN as i64, i32::MAX as i64) as i32;
    (
        tauri::PhysicalPosition::new(coordinate(x), coordinate(y)),
        tauri::PhysicalSize::new(width, height),
    )
}

#[derive(Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Hardware {
    pub cpu: String,
    pub ram_gb: f64,
    pub gpus: Vec<Gpu>,
    pub cuda_available: bool,
    pub threads: usize,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Gpu {
    pub name: String,
    pub vram_mb: u64,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    pub status: String,
    pub preview: String,
    pub level: f32,
    pub started_at: Option<i64>,
    pub error: String,
    pub result: String,
    pub app: String,
    pub output_mode: String,
    pub coding_language: Option<String>,
    pub review_required: bool,
    pub result_is_raw: bool,
}
impl Default for Session {
    fn default() -> Self {
        Self {
            status: "idle".into(),
            preview: String::new(),
            level: 0.,
            started_at: None,
            error: String::new(),
            result: String::new(),
            app: String::new(),
            output_mode: "text".into(),
            coding_language: None,
            review_required: false,
            result_is_raw: false,
        }
    }
}
pub struct State {
    pub shortcuts: Mutex<crate::config::Shortcuts>,
    pub settings: Mutex<Settings>,
    pub session: Mutex<Session>,
    pub root: PathBuf,
    pub portable: bool,
    pub catalog: Vec<Model>,
    pub downloads: Mutex<HashMap<String, Arc<AtomicBool>>>,
    pub download_progress: Mutex<HashMap<String, downloads::Progress>>,
    pub model_operations: crate::model_operations::ModelOperations,
    pub inference: Arc<Inference>,
    pub hardware: Hardware,
    store: Store,
    recorder: Mutex<Option<Recorder>>,
    preview_active: Mutex<Option<Arc<AtomicBool>>>,
    target: Mutex<Context>,
    rewrite: AtomicBool,
    insert: AtomicBool,
    generation: AtomicU64,
    lifecycle: tokio::sync::Mutex<()>,
    actions: tokio::sync::mpsc::UnboundedSender<ControllerCommand>,
}
struct ControllerCommand {
    action: String,
    rewrite: bool,
    insert: bool,
    expected_generation: Option<u64>,
    shortcut_epoch: Option<u64>,
    reply: Option<tokio::sync::oneshot::Sender<Result<(), String>>>,
}
struct FinishedRecording {
    generation: u64,
    settings: Settings,
    target: Context,
    rewrite: bool,
    should_insert: bool,
    path: PathBuf,
    audio: AudioSnapshot,
    duration: f64,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    settings: Settings,
    session: Session,
    history: Vec<HistoryEntry>,
    hardware: Hardware,
    engine_status: inference::EngineStatuses,
    models: Vec<Model>,
    active_downloads: HashMap<String, downloads::Progress>,
    version: String,
    portable: bool,
    data_dir: String,
}
fn hardware() -> Hardware {
    use std::os::windows::process::CommandExt;
    use sysinfo::System;
    let mut sys = System::new_all();
    sys.refresh_cpu_all();
    let mut hw = Hardware {
        cpu: sys
            .cpus()
            .first()
            .map(|c| c.brand().into())
            .unwrap_or("Unknown CPU".into()),
        ram_gb: sys.total_memory() as f64 / 1073741824.,
        threads: sys.cpus().len(),
        ..Default::default()
    };
    let output = std::process::Command::new("nvidia-smi")
        .args([
            "--query-gpu=name,memory.total",
            "--format=csv,noheader,nounits",
        ])
        .creation_flags(0x08000000)
        .output();
    if let Ok(o) = output {
        if o.status.success() {
            for line in String::from_utf8_lossy(&o.stdout).lines() {
                if let Some((name, mem)) = line.split_once(',') {
                    hw.gpus.push(Gpu {
                        name: name.trim().into(),
                        vram_mb: mem.trim().parse().unwrap_or(0),
                    })
                }
            }
            hw.cuda_available = !hw.gpus.is_empty()
        }
    }
    hw
}
fn session_emit(app: &AppHandle) {
    let state = app.state::<State>();
    let s = state.session.lock().unwrap().clone();
    let _ = app.emit("session", &s);
    if let Some(window) = app.get_webview_window("overlay") {
        if ["recording", "transcribing", "cleaning", "inserting"].contains(&s.status.as_str())
            && state.settings.lock().unwrap().appearance.overlay_visible
        {
            let _ = window.show();
        } else {
            let _ = window.hide();
        }
    }
}
fn status(app: &AppHandle, value: &str) {
    app.state::<State>().session.lock().unwrap().status = value.into();
    session_emit(app)
}
async fn status_if_current(app: &AppHandle, generation: u64, value: &str) -> bool {
    let state = app.state::<State>();
    crate::controller::commit_if_current(&state.lifecycle, &state.generation, generation, || {
        status(app, value)
    })
    .await
    .is_some()
}
fn error(app: &AppHandle, message: String) {
    let state = app.state::<State>();
    {
        let mut session = state.session.lock().unwrap();
        session.status = "error".into();
        session.error = message;
    }
    session_emit(app);
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
    }
}
pub fn dispatch(app: AppHandle, action: &str, rewrite: bool, insert: bool) {
    let _ = app.state::<State>().actions.send(ControllerCommand {
        action: action.into(),
        rewrite,
        insert,
        expected_generation: None,
        shortcut_epoch: None,
        reply: None,
    });
}
pub fn dispatch_shortcut(app: AppHandle, action: &str, rewrite: bool, insert: bool, epoch: u64) {
    let _ = app.state::<State>().actions.send(ControllerCommand {
        action: action.into(),
        rewrite,
        insert,
        expected_generation: None,
        shortcut_epoch: Some(epoch),
        reply: None,
    });
}
async fn request_action(
    app: &AppHandle,
    action: &str,
    rewrite: bool,
    insert: bool,
) -> Result<(), String> {
    request_action_tagged(app, action, rewrite, insert, None).await
}
async fn request_action_tagged(
    app: &AppHandle,
    action: &str,
    rewrite: bool,
    insert: bool,
    expected_generation: Option<u64>,
) -> Result<(), String> {
    let (reply, result) = tokio::sync::oneshot::channel();
    app.state::<State>()
        .actions
        .send(ControllerCommand {
            action: action.into(),
            rewrite,
            insert,
            expected_generation,
            shortcut_epoch: None,
            reply: Some(reply),
        })
        .map_err(|_| "The dictation controller is unavailable.".to_string())?;
    result
        .await
        .map_err(|_| "The dictation controller stopped.".to_string())?
}
fn complete_action(
    app: &AppHandle,
    reply: Option<tokio::sync::oneshot::Sender<Result<(), String>>>,
    result: Result<(), String>,
) {
    if let Err(e) = &result {
        error(app, e.clone());
    }
    if let Some(reply) = reply {
        let _ = reply.send(result);
    }
}
async fn transition(app: AppHandle, command: ControllerCommand) {
    let state = app.state::<State>();
    let stop = command.action == "stop"
        || command.action == "recover"
        || command.action == "toggle" && state.recorder.lock().unwrap().is_some();
    if stop {
        match finish_recording(
            &app,
            command.expected_generation,
            command.action == "recover",
            command.shortcut_epoch,
        )
        .await
        {
            Ok(Some(recording)) => {
                // The transition is complete. Inference runs independently so a
                // queued Escape can invalidate it without waiting for a model.
                tauri::async_runtime::spawn(async move {
                    let generation = recording.generation;
                    let result = process_recording(&app, recording).await;
                    let state = app.state::<State>();
                    let _guard = state.lifecycle.lock().await;
                    if state.generation.load(Ordering::SeqCst) == generation {
                        complete_action(&app, command.reply, result);
                    } else if let Some(reply) = command.reply {
                        let _ = reply.send(Ok(()));
                    }
                });
            }
            Ok(None) => complete_action(&app, command.reply, Ok(())),
            Err(e) => complete_action(&app, command.reply, Err(e)),
        }
        return;
    }
    let result = match command.action.as_str() {
        "start" | "toggle" => {
            start(
                &app,
                command.rewrite,
                command.insert,
                command.shortcut_epoch,
            )
            .await
        }
        "cancel" => {
            cancel_tagged(&app, command.shortcut_epoch).await;
            Ok(())
        }
        _ => Ok(()),
    };
    complete_action(&app, command.reply, result);
}
async fn start(
    app: &AppHandle,
    rewrite: bool,
    insert: bool,
    shortcut_epoch: Option<u64>,
) -> Result<(), String> {
    let state = app.state::<State>();
    let _guard = state.lifecycle.lock().await;
    if native::shortcut_capture_blocked()
        || shortcut_epoch.is_some_and(|epoch| !native::shortcut_action_current(epoch))
    {
        return Ok(());
    }
    let s = state.settings.lock().unwrap().clone();
    if !s.setup_complete {
        return Err("Complete the first-run setup before dictating.".into());
    }
    if state.recorder.lock().unwrap().is_some() {
        return Ok(());
    }
    if ["transcribing", "cleaning", "inserting"]
        .contains(&state.session.lock().unwrap().status.as_str())
    {
        return Ok(());
    }
    crate::setup::validate_readiness(&s, &state.root, state.hardware.cuda_available)?;
    let context = if s.cleanup.output_mode == "text" {
        native::context(s.general.context)
    } else {
        native::context_for_output(s.general.context, true)
    };
    if context.password {
        return Err("Recording into password fields is disabled.".into());
    }
    if rewrite && context.selected.is_empty() {
        return Err("Select text in the target app before using the rewrite shortcut.".into());
    }
    if rewrite && s.cleanup.mode == "off" {
        return Err("Enable text intelligence before rewriting selected text.".into());
    }
    *state.target.lock().unwrap() = context.clone();
    state.rewrite.store(rewrite, Ordering::Relaxed);
    state.insert.store(insert, Ordering::Relaxed);
    let mut recorder = Recorder::start(&s.general.microphone, s.general.max_recording_seconds)?;
    if s.general.duck_background_audio {
        recorder.lower_background_audio(s.general.ducking_reduction_percent);
    }
    let recording_started = Instant::now();
    let level = recorder.level.clone();
    *state.recorder.lock().unwrap() = Some(recorder);
    let preview_active = Arc::new(AtomicBool::new(true));
    *state.preview_active.lock().unwrap() = Some(preview_active.clone());
    let generation = state.generation.fetch_add(1, Ordering::SeqCst) + 1;
    *state.session.lock().unwrap() = Session {
        status: "recording".into(),
        started_at: Some(chrono::Utc::now().timestamp_millis()),
        output_mode: s.cleanup.output_mode.clone(),
        coding_language: if s.cleanup.output_mode == "text" {
            None
        } else {
            crate::coding::language_hint(&s, "", &context)
        },
        review_required: s.cleanup.output_mode == "generate",
        app: context.app,
        ..Default::default()
    };
    session_emit(app);
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let state = app.state::<State>();
        let mut preview_schedule =
            crate::controller::PreviewSchedule::new(s.transcription.mode == "local");
        let preview_busy = Arc::new(AtomicBool::new(false));
        loop {
            tokio::time::sleep(Duration::from_millis(75)).await;
            let tick_guard = state.lifecycle.lock().await;
            if state.generation.load(Ordering::SeqCst) != generation
                || state.recorder.lock().unwrap().is_none()
            {
                break;
            }
            let failure = state
                .recorder
                .lock()
                .unwrap()
                .as_ref()
                .and_then(|r| r.failure());
            if let Some(message) = failure {
                drop(tick_guard);
                let recovered =
                    request_action_tagged(&app, "recover", false, false, Some(generation)).await;
                let _guard = state.lifecycle.lock().await;
                if state.generation.load(Ordering::SeqCst) == generation {
                    error(&app,format!("Microphone stream stopped: {message}. Available speech was processed without automatic insertion. {}",recovered.err().unwrap_or_default()));
                }
                break;
            }
            state.session.lock().unwrap().level = level.load(Ordering::Relaxed) as f32 / 10000.;
            session_emit(&app);
            let elapsed = state
                .recorder
                .lock()
                .unwrap()
                .as_ref()
                .map(|r| r.elapsed())
                .unwrap_or(0.);
            if elapsed >= s.general.max_recording_seconds as f64 {
                let _ = state.actions.send(ControllerCommand {
                    action: "stop".into(),
                    rewrite: false,
                    insert,
                    expected_generation: Some(generation),
                    shortcut_epoch: None,
                    reply: None,
                });
                break;
            }
            if s.appearance.live_preview
                && preview_schedule.try_start(
                    recording_started.elapsed(),
                    preview_busy.load(Ordering::Relaxed),
                )
            {
                let captured = {
                    let r = state.recorder.lock().unwrap();
                    r.as_ref().map(|r| {
                        if s.transcription.mode == "local" {
                            r.capture_tail(Duration::from_secs(6))
                        } else {
                            r.capture()
                        }
                    })
                };
                if let Some(audio) = captured {
                    if audio.duration_seconds() == 0. {
                        continue;
                    }
                    let offset_ms = (audio.offset_seconds() * 1000.).round() as u64;
                    let path = state
                        .root
                        .join("recordings")
                        .join(format!("preview-{generation}-{offset_ms}.wav"));
                    let preview_app = app.clone();
                    let settings = s.clone();
                    let active = preview_active.clone();
                    preview_busy.store(true, Ordering::Relaxed);
                    let flag = preview_busy.clone();
                    tauri::async_runtime::spawn(async move {
                        let state = preview_app.state::<State>();
                        let preview_path = path.clone();
                        let saved = crate::controller::finalize_preview_if_current(
                            &state.generation,
                            generation,
                            &active,
                            &path,
                            move || audio.write(&preview_path),
                        )
                        .await;
                        let context = inference::RequestContext {
                            cuda_available: state.hardware.cuda_available,
                            generation: &state.generation,
                            expected_generation: generation,
                        };
                        let result = if matches!(saved, Ok(true)) && active.load(Ordering::Acquire)
                        {
                            if settings.transcription.mode == "local" {
                                // Hold the preview model lease while it is mapped/read.
                                // Maintenance and final transcription use their own lanes.
                                match state.model_operations.acquire("whisper-preview") {
                                    Ok(_lease) => {
                                        state
                                            .inference
                                            .preview_transcribe(
                                                &preview_app,
                                                &settings,
                                                &path,
                                                context,
                                                &active,
                                            )
                                            .await
                                    }
                                    Err(_) => Ok(None),
                                }
                            } else {
                                state
                                    .inference
                                    .transcribe(&preview_app, &settings, &path, true, context)
                                    .await
                                    .map(Some)
                            }
                        } else {
                            Ok(None)
                        };
                        let _ = tokio::fs::remove_file(&path).await;
                        let _ = crate::controller::commit_if_current(
                            &state.lifecycle,
                            &state.generation,
                            generation,
                            || {
                                if active.load(Ordering::Acquire)
                                    && state.recorder.lock().unwrap().is_some()
                                {
                                    if let Ok(Some(v)) = result {
                                        state.session.lock().unwrap().preview =
                                            v["text"].as_str().unwrap_or("").into();
                                        session_emit(&preview_app)
                                    }
                                }
                            },
                        )
                        .await;
                        flag.store(false, Ordering::Relaxed);
                    });
                }
            }
        }
    });
    Ok(())
}
async fn finish_recording(
    app: &AppHandle,
    expected_generation: Option<u64>,
    recovery: bool,
    shortcut_epoch: Option<u64>,
) -> Result<Option<FinishedRecording>, String> {
    let state = app.state::<State>();
    let guard = state.lifecycle.lock().await;
    if shortcut_epoch.is_some_and(|epoch| !native::shortcut_action_current(epoch)) {
        return Ok(None);
    }
    if !crate::controller::matches_generation(&state.generation, expected_generation) {
        return Ok(None);
    }
    let recorder = state.recorder.lock().unwrap().take();
    let Some(mut recorder) = recorder else {
        return Ok(None);
    };
    stop_preview(&state);
    let generation = state.generation.load(Ordering::SeqCst);
    let s = state.settings.lock().unwrap().clone();
    let target = state.target.lock().unwrap().clone();
    let rewrite = state.rewrite.load(Ordering::Relaxed);
    let should_insert =
        !recovery && state.insert.load(Ordering::Relaxed) && s.cleanup.output_mode != "generate";
    let path = state
        .root
        .join("recordings")
        .join(format!("final-{generation}.wav"));
    // Close the capture device before another take can start. WAV conversion
    // and file writing run after this short transition, outside lifecycle.
    let duration = recorder.stop_capture();
    let audio = recorder.capture();
    status(app, "transcribing");
    drop(guard);
    Ok(Some(FinishedRecording {
        generation,
        settings: s,
        target,
        rewrite,
        should_insert,
        path,
        audio,
        duration,
    }))
}
async fn process_recording(app: &AppHandle, recording: FinishedRecording) -> Result<(), String> {
    let state = app.state::<State>();
    let FinishedRecording {
        generation,
        settings: s,
        target,
        rewrite,
        should_insert,
        path,
        audio,
        duration,
    } = recording;
    let final_path = path.clone();
    if !crate::controller::finalize_if_current(&state.generation, generation, &path, move || {
        audio.write(&final_path)
    })
    .await?
    {
        return Ok(());
    }
    let result = state
        .inference
        .transcribe(
            app,
            &s,
            &path,
            false,
            inference::RequestContext {
                cuda_available: state.hardware.cuda_available,
                generation: &state.generation,
                expected_generation: generation,
            },
        )
        .await;
    let _ = tokio::fs::remove_file(&path).await;
    if state.generation.load(Ordering::SeqCst) != generation {
        return Ok(());
    }
    let value = result?;
    let raw = value["text"].as_str().unwrap_or("").trim();
    if raw.is_empty() {
        status_if_current(app, generation, "idle").await;
        return Ok(());
    }
    let rewrite = crate::coding::implicit_rewrite(&s, &target, raw, rewrite);
    if crate::controller::commit_if_current(&state.lifecycle, &state.generation, generation, || {
        {
            let mut session = state.session.lock().unwrap();
            session.coding_language = if s.cleanup.output_mode == "text" {
                None
            } else {
                crate::coding::language_hint(&s, raw, &target)
            };
            session.status = "cleaning".into();
        }
        session_emit(app);
    })
    .await
    .is_none()
    {
        return Ok(());
    }
    let cleaned = state
        .inference
        .cleanup(
            app,
            &s,
            raw,
            &target,
            rewrite,
            inference::RequestContext {
                cuda_available: state.hardware.cuda_available,
                generation: &state.generation,
                expected_generation: generation,
            },
        )
        .await;
    if state.generation.load(Ordering::SeqCst) != generation {
        return Ok(());
    }
    // A cleanup failure preserves the raw transcript; it never switches provider.
    let (output, cleanup_error) = match cleaned {
        Ok(output) => (output, None),
        Err(e) => (
            crate::coding::Output {
                text: raw.to_owned(),
                coding_language: None,
            },
            Some(format!(
                "Text cleanup failed: {e} The raw transcript is available to copy."
            )),
        ),
    };
    let result_is_raw = cleanup_error.is_some();
    let coding_language = if s.cleanup.output_mode == "text" || result_is_raw {
        None
    } else {
        crate::coding::output_language(&s, raw, &target, output.coding_language)
    };
    let text = output.text;
    let review_required = crate::coding::review_required(&s, &target, &text);
    let mut insertion_error = None;
    let inserted = if crate::coding::automatic_insertion(&s, &target, should_insert, &text)
        && cleanup_error.is_none()
    {
        if !status_if_current(app, generation, "inserting").await {
            return Ok(());
        }
        let active = || state.generation.load(Ordering::SeqCst) == generation;
        match native::insert(&text, &target, &s.general.insertion_method, app, &active) {
            Ok(()) => true,
            Err(e) => {
                insertion_error = Some(e);
                false
            }
        }
    } else {
        false
    };
    // Cancellation may happen during the modifier wait or clipboard setup.
    // Serialize this final commit with cancellation/new recording transitions.
    let _guard = state.lifecycle.lock().await;
    if state.generation.load(Ordering::SeqCst) != generation {
        return Ok(());
    }
    // Commit a persistent copy only after temporary paste restoration, under
    // the lifecycle lock. A cancelled/stale take must never replace the clipboard.
    let copy_requested = s.general.copy_dictation_to_clipboard
        && should_insert
        && !review_required
        && cleanup_error.is_none();
    let clipboard_error = if copy_requested {
        crate::clipboard::copy_result(&text, app, &|| {
            state.generation.load(Ordering::SeqCst) == generation
        })
        .err()
    } else {
        None
    };
    if copy_requested && clipboard_error.is_none() {
        if let Some(error) = insertion_error.as_mut() {
            error.push_str(" Your dictation is on the clipboard.");
            if !error.contains("may already be inserted") {
                error.push_str(" Press Ctrl + V to paste it.");
            }
        }
    }
    let history_entry = s.general.save_history.then(|| HistoryEntry {
        id: uuid::Uuid::new_v4().to_string(),
        created_at: chrono::Utc::now().to_rfc3339(),
        raw_text: raw.into(),
        text: text.clone(),
        language: value["language"]
            .as_str()
            .unwrap_or(&s.transcription.language)
            .into(),
        app: target.app,
        duration_seconds: duration,
        word_count: text.split_whitespace().count(),
        mode: crate::coding::history_mode(&s, rewrite, result_is_raw).into(),
        inserted,
    });
    let history_error = commit_result_with_history(
        &state.session,
        text,
        coding_language,
        review_required,
        result_is_raw,
        || {
            if let Some(entry) = history_entry {
                state.store.add(&entry)?;
                let retained = state.store.retain_days(s.general.history_days);
                let _ = app.emit("history-updated", ());
                retained
            } else {
                Ok(())
            }
        },
    )
    .err();
    session_emit(app);
    if review_required {
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.show();
            let _ = window.set_focus();
        }
    }
    let errors: Vec<_> = [
        cleanup_error,
        insertion_error,
        clipboard_error,
        history_error,
    ]
    .into_iter()
    .flatten()
    .collect();
    if !errors.is_empty() {
        return Err(errors.join(" "));
    }
    Ok(())
}
fn commit_result_with_history(
    session: &Mutex<Session>,
    text: String,
    coding_language: Option<String>,
    review_required: bool,
    result_is_raw: bool,
    save_history: impl FnOnce() -> Result<(), String>,
) -> Result<(), String> {
    let saved = save_history().map_err(|_| "Local history could not be saved or maintained. The result is still available. Check disk space and app-data folder permissions.".to_string());
    // History storage is secondary to returning a completed result. In
    // generation mode there is intentionally no inserted copy elsewhere.
    let mut session = session.lock().unwrap();
    session.result = text;
    session.level = 0.;
    session.started_at = None;
    session.preview = String::new();
    session.status = "idle".into();
    session.coding_language = coding_language;
    session.review_required = review_required;
    session.result_is_raw = result_is_raw;
    saved
}

#[cfg(test)]
mod result_tests {
    use super::*;

    #[test]
    fn generated_result_remains_available_when_sqlite_history_write_fails() {
        let root = std::env::temp_dir().join(uuid::Uuid::new_v4().to_string());
        let store = Store::new(&root).unwrap();
        let connection = rusqlite::Connection::open(root.join("history.sqlite3")).unwrap();
        // A malformed history database is an actual SQLite write fault, not a
        // mocked error or a change to the user's database.
        connection.execute_batch("DROP TABLE history;").unwrap();
        drop(connection);
        let entry = HistoryEntry {
            id: "fixture".into(),
            created_at: chrono::Utc::now().to_rfc3339(),
            raw_text: "Generate a fixture function".into(),
            text: "    return 1".into(),
            language: "en".into(),
            app: "fixture".into(),
            duration_seconds: 1.,
            word_count: 2,
            mode: "generate".into(),
            inserted: false,
        };
        let session = Mutex::new(Session {
            status: "cleaning".into(),
            output_mode: "generate".into(),
            ..Default::default()
        });
        let error = commit_result_with_history(
            &session,
            entry.text.clone(),
            Some("Python".into()),
            true,
            false,
            || store.add(&entry),
        )
        .unwrap_err();
        assert!(error.contains("result is still available"));
        assert!(!error.contains("SQL"));
        assert!(!error.contains("history.sqlite3"));
        let result = session.lock().unwrap();
        assert_eq!(result.result, "    return 1");
        assert_eq!(result.status, "idle");
        assert!(result.review_required);
        assert!(!result.result_is_raw);
        assert_eq!(result.coding_language.as_deref(), Some("Python"));
        drop(result);
        drop(store);
        std::fs::remove_dir_all(root).unwrap();
    }
}
async fn cancel(app: &AppHandle) {
    cancel_tagged(app, None).await;
}
async fn cancel_tagged(app: &AppHandle, shortcut_epoch: Option<u64>) {
    let state = app.state::<State>();
    let _guard = state.lifecycle.lock().await;
    if shortcut_epoch.is_some_and(|epoch| !native::shortcut_action_current(epoch)) {
        return;
    }
    state.inference.warmup.invalidate();
    stop_preview(&state);
    state.generation.fetch_add(1, Ordering::SeqCst);
    state.recorder.lock().unwrap().take();
    *state.session.lock().unwrap() = Session::default();
    session_emit(app);
}
fn stop_preview(state: &State) {
    if let Some(active) = state.preview_active.lock().unwrap().take() {
        active.store(false, Ordering::Release);
    }
}

#[tauri::command]
fn get_snapshot(state: TauriState<State>) -> Result<Snapshot, String> {
    Ok(Snapshot {
        settings: state.settings.lock().unwrap().clone(),
        session: state.session.lock().unwrap().clone(),
        history: state.store.list()?,
        hardware: state.hardware.clone(),
        engine_status: state.inference.engine_status(),
        models: downloads::list(&state),
        active_downloads: state.download_progress.lock().unwrap().clone(),
        version: env!("CARGO_PKG_VERSION").into(),
        portable: state.portable,
        data_dir: state.root.display().to_string(),
    })
}
#[tauri::command]
async fn save_settings(
    app: AppHandle,
    state: TauriState<'_, State>,
    settings: Settings,
) -> Result<(), String> {
    let _guard = state.lifecycle.lock().await;
    let before = crate::warmup::Selection::from_settings(
        &state.settings.lock().unwrap(),
        state.hardware.cuda_available,
    );
    persist_settings(&app, &state, settings)?;
    let after = crate::warmup::Selection::from_settings(
        &state.settings.lock().unwrap(),
        state.hardware.cuda_available,
    );
    if before != after {
        state.inference.warmup.invalidate();
        let _ = queue_warm_locked(&app, &state, true);
    }
    Ok(())
}
fn persist_settings(app: &AppHandle, state: &State, mut settings: Settings) -> Result<(), String> {
    settings.validate()?;
    if settings.setup_complete && !state.settings.lock().unwrap().setup_complete {
        crate::setup::validate_readiness(&settings, &state.root, state.hardware.cuda_available)?;
    }
    if state.recorder.lock().unwrap().is_some() {
        return Err("Stop recording before changing settings.".into());
    }
    let autostart = app.autolaunch();
    if settings.general.startup {
        autostart.enable().map_err(|e| e.to_string())?
    } else {
        autostart.disable().map_err(|e| e.to_string())?
    }
    for p in &mut settings.providers {
        p.has_key = crate::vault::has_key(&p.id);
    }
    store::atomic_json(&state.root.join("settings.json"), &settings)?;
    *state.shortcuts.lock().unwrap() = settings.shortcuts.clone();
    *state.settings.lock().unwrap() = settings;
    let _ = app.emit("settings-updated", ());
    Ok(())
}
#[tauri::command]
async fn complete_setup(
    app: AppHandle,
    state: TauriState<'_, State>,
    mut settings: Settings,
) -> Result<(), String> {
    let _guard = state.lifecycle.lock().await;
    settings.setup_complete = true;
    settings.validate()?;
    crate::setup::validate_readiness(&settings, &state.root, state.hardware.cuda_available)?;
    persist_settings(&app, &state, settings)?;
    let _ = queue_warm_locked(&app, &state, true);
    Ok(())
}
fn warm_idle(state: &State) -> bool {
    matches!(
        state.session.lock().unwrap().status.as_str(),
        "idle" | "error"
    )
}
pub fn warm_uses_asset(state: &State, id: &str) -> bool {
    crate::warmup::Selection::from_settings(
        &state.settings.lock().unwrap(),
        state.hardware.cuda_available,
    )
    .uses(id)
}
// Caller holds lifecycle while capturing settings and mutating the warm epoch.
fn queue_warm_locked(app: &AppHandle, state: &State, rearm: bool) -> Result<(), String> {
    let settings = state.settings.lock().unwrap().clone();
    settings.validate()?;
    crate::setup::required_local_assets(&settings, state.hardware.cuda_available)?;
    let routes = crate::warmup::Selection::from_settings(&settings, state.hardware.cuda_available)
        .ready(|id| {
            state
                .root
                .join("models")
                .join(id)
                .join(".installed")
                .is_file()
        });
    if routes.is_empty() {
        return Err("Complete setup and install a selected local model before loading it.".into());
    }
    if state.inference.warmup.is_pending() {
        return Ok(());
    }
    let Some(ticket) = state.inference.warmup.begin(rearm) else {
        return Ok(());
    };
    let tracked = ticket.clone();
    let app = app.clone();
    let task = tauri::async_runtime::handle().inner().spawn(async move {
        let state = app.state::<State>();
        let mut ticket = ticket;
        loop {
            if !ticket.is_current() { break; }
            if warm_idle(&state) {
                let (speech, cleanup, preview) = tokio::join!(
                    warm_route(&app, &settings, routes.speech.as_ref(), ticket.clone(), WarmStage::Speech),
                    warm_route(&app, &settings, routes.cleanup.as_ref(), ticket.clone(), WarmStage::Cleanup),
                    warm_route(&app, &settings, routes.preview.as_ref(), ticket.clone(), WarmStage::Preview),
                );
                if speech && cleanup && preview { break; }
            }
            tokio::select! { biased; _ = ticket.cancelled() => break, _ = tokio::time::sleep(Duration::from_millis(250)) => () }
        }
    });
    state.inference.warmup.track(&tracked, task);
    Ok(())
}
enum WarmStage {
    Speech,
    Cleanup,
    Preview,
}
async fn warm_route(
    app: &AppHandle,
    settings: &Settings,
    route: Option<&crate::warmup::Route>,
    ticket: crate::warmup::Ticket,
    stage: WarmStage,
) -> bool {
    let Some(route) = route else {
        return true;
    };
    let state = app.state::<State>();
    if !ticket.is_current() {
        return true;
    }
    // A warm load holds the same short-lived model reservation as maintenance,
    // preventing extraction/removal while a model is being mapped into memory.
    let leases: Result<Vec<_>, _> = route
        .assets
        .iter()
        .map(|id| state.model_operations.acquire(id))
        .collect();
    let Ok(_leases) = leases else {
        return false;
    };
    if !route.assets.iter().all(|id| {
        state
            .root
            .join("models")
            .join(id)
            .join(".installed")
            .is_file()
    }) {
        return true;
    }
    let can_start = || warm_idle(&state);
    let result = match stage {
        WarmStage::Speech => {
            state
                .inference
                .warm_speech(app, route, ticket, can_start)
                .await
        }
        WarmStage::Cleanup => {
            state
                .inference
                .warm_cleanup(app, settings, route, ticket, can_start)
                .await
        }
        WarmStage::Preview => {
            state
                .inference
                .warm_preview(app, route, ticket, can_start)
                .await
        }
    };
    result.unwrap_or(true)
}
#[tauri::command]
async fn warm_selected_models(app: AppHandle, state: TauriState<'_, State>) -> Result<(), String> {
    let _guard = state.lifecycle.lock().await;
    queue_warm_locked(&app, &state, true)
}
pub async fn warm_after_download(app: &AppHandle, id: &str, reset_speech: bool) {
    let state = app.state::<State>();
    if !warm_uses_asset(&state, id) {
        return;
    }
    let mut ticket = state.inference.warmup.cancel_and_wait().await;
    if !ticket.is_current() {
        return;
    }
    if reset_speech && !state.inference.reset_speech(app, &mut ticket).await {
        return;
    }
    if id == "whisper-preview" && !state.inference.reset_preview(app, &mut ticket).await {
        return;
    }
    let Some(_guard) = ticket.lock_current(&state.lifecycle).await else {
        return;
    };
    // A selection may have changed while the old speech request was finishing.
    if warm_uses_asset(&state, id) {
        let _ = queue_warm_locked(app, &state, false);
    }
}
#[tauri::command]
async fn start_recording(app: AppHandle, rewrite: Option<bool>) -> Result<(), String> {
    request_action(&app, "start", rewrite.unwrap_or(false), false).await
}
#[tauri::command]
async fn stop_recording(app: AppHandle) -> Result<(), String> {
    request_action(&app, "stop", false, false).await
}
#[tauri::command]
async fn cancel_recording(app: AppHandle) {
    let _ = request_action(&app, "cancel", false, false).await;
}
#[tauri::command]
async fn begin_shortcut_capture(
    app: AppHandle,
    window: tauri::WebviewWindow,
    state: TauriState<'_, State>,
    id: String,
) -> Result<(), String> {
    if window.label() != "main" {
        return Err("Shortcut capture is only available in the main window.".into());
    }
    let _guard = state.lifecycle.lock().await;
    if state.recorder.lock().unwrap().is_some()
        || !matches!(
            state.session.lock().unwrap().status.as_str(),
            "idle" | "error"
        )
    {
        return Err("Finish dictation before changing a shortcut.".into());
    }
    let owner = window
        .hwnd()
        .map_err(|_| "The main window is unavailable.".to_string())?
        .0 as isize;
    let event = native::begin_shortcut_capture(id.clone(), owner)?;
    let _ = app.emit_to("main", "shortcut-capture", event);
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(30)).await;
        if let Some(event) = native::expire_shortcut_capture(&id) {
            let _ = app.emit_to("main", "shortcut-capture", event);
        }
    });
    Ok(())
}
#[tauri::command]
fn end_shortcut_capture(
    app: AppHandle,
    window: tauri::WebviewWindow,
    id: String,
) -> Result<(), String> {
    if window.label() != "main" {
        return Err("Shortcut capture is only available in the main window.".into());
    }
    if let Some(event) = native::end_shortcut_capture(&id) {
        let _ = app.emit_to("main", "shortcut-capture", event);
    }
    Ok(())
}
#[tauri::command]
async fn discover_provider_models(
    app: AppHandle,
    provider: crate::config::Provider,
    key: Option<String>,
    use_saved_key: bool,
) -> Result<Vec<String>, String> {
    crate::discovery::provider_models(&app, provider, key, use_saved_key).await
}
#[tauri::command]
fn running_applications() -> Result<Vec<String>, String> {
    crate::discovery::running_applications()
}
#[tauri::command]
fn microphone_devices() -> Result<Vec<String>, String> {
    crate::audio::devices()
}
#[tauri::command]
fn delete_history(state: TauriState<State>, id: String) -> Result<(), String> {
    state.store.delete(&id)
}
#[tauri::command]
fn clear_history(state: TauriState<State>) -> Result<(), String> {
    state.store.clear()
}
#[tauri::command]
async fn set_provider_key(
    state: TauriState<'_, State>,
    id: String,
    key: String,
) -> Result<(), String> {
    let _guard = state.lifecycle.lock().await;
    let key = zeroize::Zeroizing::new(key);
    let mut s = state.settings.lock().unwrap();
    let p = s
        .providers
        .iter_mut()
        .find(|p| p.id == id)
        .ok_or("Save the provider before its API key.")?;
    inference::save_credential(&id, &key)?;
    p.has_key = !key.is_empty();
    store::atomic_json(&state.root.join("settings.json"), &*s)
}
#[tauri::command]
async fn test_provider(
    app: AppHandle,
    state: TauriState<'_, State>,
    id: String,
) -> Result<String, String> {
    let p = state
        .settings
        .lock()
        .unwrap()
        .providers
        .iter()
        .find(|p| p.id == id)
        .cloned()
        .ok_or("Provider not found.")?;
    state.inference.test_provider(&app, &p).await
}
#[tauri::command]
async fn download_model(app: AppHandle, id: String) -> Result<(), String> {
    downloads::download(app, id).await
}
#[tauri::command]
fn cancel_download(state: TauriState<State>, id: String) {
    if let Some(c) = state.downloads.lock().unwrap().get(&id) {
        c.store(true, Ordering::Relaxed)
    }
}
#[tauri::command]
async fn remove_model(
    app: AppHandle,
    state: TauriState<'_, State>,
    id: String,
) -> Result<(), String> {
    if !state.catalog.iter().any(|m| m.id == id) {
        return Err("Unknown model.".into());
    }
    let _guard = state.lifecycle.lock().await;
    if state.downloads.lock().unwrap().contains_key(&id) {
        return Err("Pause the download first.".into());
    }
    let status = state.session.lock().unwrap().status.clone();
    if state.recorder.lock().unwrap().is_some() || status != "idle" && status != "error" {
        return Err("Wait until dictation finishes before removing a model.".into());
    }
    state.inference.warmup.suspend();
    state.inference.warmup.cancel_and_wait().await;
    let _operation = state.model_operations.acquire(&id)?;
    state.inference.shutdown(&app).await;
    let path = state.root.join("models").join(id);
    if path.exists() {
        tokio::fs::remove_dir_all(path)
            .await
            .map_err(|e| e.to_string())?
    }
    let _ = app.emit("models-updated", ());
    Ok(())
}
#[tauri::command]
async fn unload_models(app: AppHandle, state: TauriState<'_, State>) -> Result<(), String> {
    let _guard = state.lifecycle.lock().await;
    let status = state.session.lock().unwrap().status.clone();
    if state.recorder.lock().unwrap().is_some() || status != "idle" && status != "error" {
        return Err("Wait until dictation finishes before unloading models.".into());
    }
    state.inference.warmup.suspend();
    state.inference.warmup.cancel_and_wait().await;
    state.inference.shutdown(&app).await;
    let _ = app.emit("models-updated", ());
    Ok(())
}
#[tauri::command]
fn open_data_folder(app: AppHandle, state: TauriState<State>) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    app.opener()
        .open_path(state.root.display().to_string(), None::<&str>)
        .map_err(|e| e.to_string())
}
#[tauri::command]
fn open_documentation(app: AppHandle) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    let path = app
        .path()
        .resource_dir()
        .map_err(|e| e.to_string())?
        .join("help/index.html");
    app.opener()
        .open_path(path.display().to_string(), None::<&str>)
        .map_err(|e| e.to_string())
}

pub fn run() {
    let result = tauri::Builder::default().plugin(tauri_plugin_single_instance::init(|app,_,_|{if let Some(w)=app.get_webview_window("main"){let _=w.show();let _=w.set_focus();}})).plugin(tauri_plugin_opener::init()).plugin(tauri_plugin_autostart::Builder::new().args(["--background"]).build())
 .invoke_handler(tauri::generate_handler![get_snapshot,save_settings,complete_setup,warm_selected_models,start_recording,stop_recording,cancel_recording,begin_shortcut_capture,end_shortcut_capture,discover_provider_models,running_applications,microphone_devices,delete_history,clear_history,set_provider_key,test_provider,download_model,cancel_download,remove_model,unload_models,open_data_folder,open_documentation])
 .setup(|app|{
  let exe=std::env::current_exe()?;let portable=exe.parent().unwrap().join("portable.flag").exists();let root=if portable{exe.parent().unwrap().join("data")}else{app.path().app_local_data_dir()?};std::fs::create_dir_all(root.join("recordings"))?;
  // Recordings from interrupted sessions are never kept across launches.
  for entry in std::fs::read_dir(root.join("recordings"))?.flatten(){if entry.path().extension().is_some_and(|e|e=="wav"){let _=std::fs::remove_file(entry.path());}}
  let path=root.join("settings.json");let mut startup_warning=String::new();let settings=if path.exists(){let data=std::fs::read(&path)?;match serde_json::from_slice::<Settings>(&data).map_err(|e|e.to_string()).and_then(|s|{s.validate()?;Ok(s)}){Ok(s)=>s,Err(_)=>{let backup=root.join(format!("settings.invalid-{}.json",chrono::Utc::now().timestamp()));std::fs::rename(&path,&backup)?;startup_warning="Invalid settings were backed up. Complete setup to restore valid settings; your history and models were preserved.".into();Settings::default()}}}else{Settings::default()};let store=Store::new(&root).map_err(std::io::Error::other)?;store.retain_days(settings.general.history_days).map_err(std::io::Error::other)?;
  let (actions, commands)=tokio::sync::mpsc::unbounded_channel();
  app.manage(State{shortcuts:Mutex::new(settings.shortcuts.clone()),settings:Mutex::new(settings),session:Mutex::new(Session{error:startup_warning,..Default::default()}),inference:Arc::new(Inference::new(root.clone())),root,portable,catalog:downloads::catalog(),downloads:Mutex::new(HashMap::new()),download_progress:Mutex::new(HashMap::new()),model_operations:crate::model_operations::ModelOperations::default(),hardware:hardware(),store,recorder:Mutex::new(None),preview_active:Mutex::new(None),target:Mutex::new(Context::default()),rewrite:AtomicBool::new(false),insert:AtomicBool::new(false),generation:AtomicU64::new(0),lifecycle:tokio::sync::Mutex::new(()),actions});
  let controller_app=app.handle().clone();
  tauri::async_runtime::spawn(crate::controller::run_ordered(commands,move |command|{let app=controller_app.clone();async move{transition(app,command).await;}}));
  let monitor_app=app.handle().clone();
  tauri::async_runtime::spawn(async move {
   let mut previous=None;
   loop {
    let state=monitor_app.state::<State>();
    let engines=state.inference.engine_status();
    let installed:Vec<_>=downloads::list(&state).into_iter().map(|m|(m.id,m.installed)).collect();
    let current=(engines,installed);
    if previous.as_ref()!=Some(&current) {
     previous=Some(current);
     let _=monitor_app.emit("models-updated",());
    }
    tokio::time::sleep(Duration::from_secs(2)).await;
   }
  });
  // The click-through popup uses its CSS frame. Native undecorated shadows add
  // hidden client insets on Windows, shifting the centered content by 8px at 96 DPI.
  let overlay=WebviewWindowBuilder::new(app,"overlay",WebviewUrl::App("index.html?overlay=1".into())).title("CridVoice recording").inner_size(OVERLAY_WIDTH,OVERLAY_HEIGHT).decorations(false).resizable(false).shadow(false).transparent(true).always_on_top(true).skip_taskbar(true).visible(false).focused(false).focusable(false).build()?;
  let _=overlay.set_ignore_cursor_events(true);if let Some(monitor)=app.primary_monitor()?{let area=monitor.work_area();let (position,size)=overlay_bounds((area.position.x,area.position.y),(area.size.width,area.size.height),monitor.scale_factor());let _=overlay.set_position(position);let _=overlay.set_size(size);}
  use tauri::{menu::{Menu,MenuItem},tray::TrayIconBuilder};let show=MenuItem::with_id(app,"show","Open CridVoice",true,None::<&str>)?;let dictate=MenuItem::with_id(app,"dictate","Toggle dictation",true,None::<&str>)?;let quit=MenuItem::with_id(app,"quit","Quit CridVoice",true,None::<&str>)?;let menu=Menu::with_items(app,&[&show,&dictate,&quit])?;
  TrayIconBuilder::new().icon(app.default_window_icon().unwrap().clone()).tooltip("CridVoice · Ctrl + Windows to dictate").menu(&menu).on_menu_event(|app,event|match event.id.as_ref(){"show"=>{if let Some(w)=app.get_webview_window("main"){let _=w.show();let _=w.set_focus();}},"dictate"=>dispatch(app.clone(),"toggle",false,true),"quit"=>{let handle=app.clone();tauri::async_runtime::spawn(async move{let state=handle.state::<State>();state.inference.warmup.close();cancel(&handle).await;let _=tauri::async_runtime::spawn_blocking(crate::ducking::shutdown).await;state.inference.shutdown(&handle).await;handle.exit(0);});},_=>{}}).build(app)?;
  native::install_shortcuts(app.handle()).map_err(std::io::Error::other)?;if std::env::args().any(|a|a=="--background"){if let Some(w)=app.get_webview_window("main"){let _=w.hide();}}let warm_app=app.handle().clone();let mut initial_warm=app.state::<State>().inference.warmup.snapshot();tauri::async_runtime::spawn(async move{let state=warm_app.state::<State>();if let Some(_guard)=initial_warm.lock_current(&state.lifecycle).await {let _=queue_warm_locked(&warm_app,&state,false);};});Ok(())
 }).on_window_event(|window,event|{if window.label()=="main"{match event{tauri::WindowEvent::CloseRequested{api,..}=>{if let Some(event)=native::cancel_shortcut_capture(false){let _=window.emit_to("main","shortcut-capture",event);}api.prevent_close();let _=window.hide();},tauri::WindowEvent::Focused(false)=>{if let Some(event)=native::cancel_shortcut_capture(true){let _=window.emit_to("main","shortcut-capture",event);}},_=>{}}}}).run(tauri::generate_context!());
    if let Err(e) = result {
        native::startup_error(&format!("CridVoice could not start: {e}\n\nCheck that the app folder is writable and Microsoft WebView2 is installed."));
    }
}

#[cfg(test)]
mod overlay_geometry_tests {
    use super::*;

    #[test]
    fn compact_overlay_is_centered_above_the_primary_monitor_taskbar() {
        let (position, size) = overlay_bounds((0, 0), (1920, 1040), 1.);
        assert_eq!((size.width, size.height), (440, 148));
        assert_eq!((position.x, position.y), (740, 880));
        assert_eq!(1040 - position.y - size.height as i32, 12);
    }

    #[test]
    fn overlay_scales_position_and_size_together_on_negative_origin_monitors() {
        for scale in [1.25, 1.5, 2.] {
            let (position, size) = overlay_bounds((-1280, -100), (1280, 1024), scale);
            assert_eq!(size.width, (OVERLAY_WIDTH * scale).round() as u32);
            assert_eq!(size.height, (OVERLAY_HEIGHT * scale).round() as u32);
            assert_eq!(position.x, -1280 + (1280 - size.width as i32) / 2);
            assert_eq!(
                position.y + size.height as i32,
                924 - (OVERLAY_BOTTOM_GAP * scale).round() as i32
            );
        }
    }

    #[test]
    fn overlay_shrinks_to_fit_a_work_area_smaller_than_its_scaled_size() {
        let (position, size) = overlay_bounds((-320, 80), (320, 100), 3.);
        assert_eq!((size.width, size.height), (320, 100));
        assert_eq!((position.x, position.y), (-320, 80));
    }

    #[test]
    fn overlay_geometry_tolerates_unavailable_scale_or_empty_display_metadata() {
        for scale in [f64::NAN, f64::INFINITY, 0., -1.] {
            let (_, size) = overlay_bounds((0, 0), (1920, 1080), scale);
            assert_eq!((size.width, size.height), (440, 148));
        }
        let (position, size) = overlay_bounds((-10, -20), (0, 0), 1.);
        assert_eq!((size.width, size.height), (1, 1));
        assert_eq!((position.x, position.y), (-10, -20));
    }
}
