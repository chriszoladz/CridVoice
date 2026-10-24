use crate::{
    config::{Provider, Settings},
    core::{self, Context},
    diagnostics::{spawn_error, ChildDiagnostics},
};
use serde::Serialize;
use serde_json::{json, Value};
use std::{
    path::{Path, PathBuf},
    process::Stdio,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Mutex as StdMutex,
    },
    time::Duration,
};
use tauri::{AppHandle, Emitter, Manager};
use tokio::{
    io::{AsyncBufReadExt, AsyncRead, AsyncWrite, AsyncWriteExt, BufReader, Lines},
    process::{Child, ChildStdin, ChildStdout, Command},
    sync::{Mutex, MutexGuard},
};

pub struct Inference {
    pub warmup: crate::warmup::Coordinator,
    speech: Mutex<Option<Worker>>,
    preview: Mutex<Option<Worker>>,
    preview_epoch: AtomicU64,
    llm: Mutex<Option<Server>>,
    client: reqwest::Client,
    local_client: reqwest::Client,
    root: PathBuf,
    engine_status: StdMutex<EngineStatuses>,
}
#[derive(Clone, Copy)]
pub struct RequestContext<'a> {
    pub cuda_available: bool,
    pub generation: &'a AtomicU64,
    pub expected_generation: u64,
}
impl RequestContext<'_> {
    fn ensure_current(self) -> Result<(), String> {
        if crate::controller::matches_generation(self.generation, Some(self.expected_generation)) {
            Ok(())
        } else {
            Err("Dictation was cancelled.".into())
        }
    }
}
#[derive(Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineStatuses {
    pub speech: EngineStatus,
    pub cleanup: EngineStatus,
    pub preview: EngineStatus,
}
#[derive(Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineStatus {
    pub model_id: Option<String>,
    pub device: Option<String>,
    pub state: String,
}
impl Default for EngineStatus {
    fn default() -> Self {
        Self {
            model_id: None,
            device: None,
            state: "unloaded".into(),
        }
    }
}
struct Worker {
    child: Child,
    input: ChildStdin,
    output: Lines<BufReader<ChildStdout>>,
    diagnostics: ChildDiagnostics,
}
struct Server {
    child: Child,
    provider: Provider,
    key: String,
    identity: String,
    diagnostics: ChildDiagnostics,
}
fn preview_current(context: RequestContext<'_>, active: &AtomicBool) -> bool {
    active.load(Ordering::SeqCst) && context.ensure_current().is_ok()
}
async fn drain_preview_result<T>(
    current: impl Fn() -> bool,
    operation: impl std::future::Future<Output = T>,
) -> Option<T> {
    // A release discards the result, but drains the short CPU request so the
    // next take can reuse its warm model and a clean JSON-lines stream.
    let result = operation.await;
    current().then_some(result)
}
async fn preview_epoch_result<T>(
    epoch: &AtomicU64,
    expected: u64,
    operation: impl std::future::Future<Output = T>,
) -> Option<T> {
    if epoch.load(Ordering::SeqCst) != expected {
        return None;
    }
    tokio::pin!(operation);
    loop {
        tokio::select! {
            biased;
            _ = tokio::time::sleep(Duration::from_millis(25)) => {
                if epoch.load(Ordering::SeqCst) != expected { return None; }
            }
            result = &mut operation => {
                return (epoch.load(Ordering::SeqCst) == expected).then_some(result);
            }
        }
    }
}
async fn preview_exchange<W, R, F>(
    input: &mut W,
    output: &mut Lines<BufReader<R>>,
    line: &[u8],
    id: &str,
    can_send: &F,
) -> Result<Option<Value>, String>
where
    W: AsyncWrite + Unpin,
    R: AsyncRead + Unpin,
    F: Fn() -> bool + Sync,
{
    if !can_send() {
        return Ok(None);
    }
    input
        .write_all(line)
        .await
        .map_err(|_| "Live preview service stopped.".to_string())?;
    // After a successful write, always drain this request even if the
    // take ended. The worker is dedicated to previews, never finals.
    input
        .flush()
        .await
        .map_err(|_| "Live preview service stopped.".to_string())?;
    loop {
        let line = output
            .next_line()
            .await
            .map_err(|_| "Live preview communication failed.".to_string())?
            .ok_or("Live preview service exited unexpectedly.")?;
        let value: Value = serde_json::from_str(&line)
            .map_err(|_| "Live preview returned an invalid response.".to_string())?;
        if value["id"] != id {
            continue;
        }
        if value["ok"] != true {
            return Err(value["error"]
                .as_str()
                .unwrap_or("Live preview recognition failed.")
                .to_string());
        }
        let result = value["result"].clone();
        if !result.is_object() || result.get("loadedModel").is_none() {
            return Err("Live preview returned an invalid response.".into());
        }
        if let Some(loaded) = result["loadedModel"].as_object() {
            if loaded.get("modelId").and_then(Value::as_str) != Some("whisper-preview")
                || loaded.get("device").and_then(Value::as_str) != Some("cpu")
            {
                return Err("Live preview returned an unexpected model identity.".into());
            }
        }
        return Ok(Some(result));
    }
}
async fn retire_preview(guard: &mut Option<Worker>) {
    if let Some(mut worker) = guard.take() {
        let _ = worker.child.kill().await;
        worker.diagnostics.settle().await;
    }
}
fn hidden(cmd: &mut Command) {
    cmd.creation_flags(0x08000000);
}
pub fn locate(root: &Path, name: &str) -> Option<PathBuf> {
    if !root.exists() {
        return None;
    }
    for e in std::fs::read_dir(root).ok()?.flatten() {
        let path = e.path();
        if path.is_file() && path.file_name().is_some_and(|n| n == name) {
            return Some(path);
        }
        if path.is_dir() {
            if let Some(p) = locate(&path, name) {
                return Some(p);
            }
        }
    }
    None
}
impl Inference {
    pub fn new(root: PathBuf) -> Self {
        Self {
            warmup: crate::warmup::Coordinator::default(),
            speech: Mutex::new(None),
            preview: Mutex::new(None),
            preview_epoch: AtomicU64::new(0),
            llm: Mutex::new(None),
            client: reqwest::Client::builder()
                .timeout(Duration::from_secs(180))
                .connect_timeout(Duration::from_secs(8))
                .redirect(reqwest::redirect::Policy::none())
                .build()
                .unwrap(),
            local_client: reqwest::Client::builder()
                .no_proxy()
                .timeout(Duration::from_secs(180))
                .connect_timeout(Duration::from_secs(8))
                .redirect(reqwest::redirect::Policy::none())
                .build()
                .unwrap(),
            root,
            engine_status: StdMutex::new(EngineStatuses::default()),
        }
    }
    pub fn engine_status(&self) -> EngineStatuses {
        // An idle child's exit must not leave a stale "loaded" indicator.
        if let Ok(mut guard) = self.speech.try_lock() {
            let exited = guard
                .as_mut()
                .is_some_and(|worker| worker.child.try_wait().is_ok_and(|status| status.is_some()));
            if exited {
                *guard = None;
                self.engine_status.lock().unwrap().speech = EngineStatus::default();
            }
        }
        if let Ok(mut guard) = self.llm.try_lock() {
            let exited = guard
                .as_mut()
                .is_some_and(|server| server.child.try_wait().is_ok_and(|status| status.is_some()));
            if exited {
                *guard = None;
                self.engine_status.lock().unwrap().cleanup = EngineStatus::default();
            }
        }
        if let Ok(mut guard) = self.preview.try_lock() {
            if guard
                .as_mut()
                .is_some_and(|worker| worker.child.try_wait().is_ok_and(|status| status.is_some()))
            {
                *guard = None;
                self.engine_status.lock().unwrap().preview = EngineStatus::default();
            }
        }
        self.engine_status.lock().unwrap().clone()
    }
    fn set_engine(
        &self,
        app: &AppHandle,
        speech: bool,
        state: &str,
        model_id: Option<String>,
        device: Option<String>,
    ) {
        let mut status = self.engine_status.lock().unwrap();
        let next = EngineStatus {
            model_id,
            device,
            state: state.into(),
        };
        let engine = if speech {
            &mut status.speech
        } else {
            &mut status.cleanup
        };
        if *engine != next {
            *engine = next;
            let payload = status.clone();
            drop(status);
            let _ = app.emit("models-updated", payload);
        }
    }
    fn begin_engine(
        &self,
        app: &AppHandle,
        speech: bool,
        model_id: Option<String>,
        device: Option<String>,
    ) {
        let status = self.engine_status.lock().unwrap();
        let current = if speech {
            &status.speech
        } else {
            &status.cleanup
        };
        let loaded =
            current.state == "loaded" && current.model_id == model_id && current.device == device;
        drop(status);
        if !loaded {
            self.set_engine(app, speech, "loading", model_id, device);
        }
    }
    fn set_preview_engine(&self, app: &AppHandle, state: &str) {
        let next = if state == "unloaded" {
            EngineStatus::default()
        } else {
            EngineStatus {
                model_id: Some("whisper-preview".into()),
                device: Some("cpu".into()),
                state: state.into(),
            }
        };
        let mut status = self.engine_status.lock().unwrap();
        if status.preview != next {
            status.preview = next;
            let payload = status.clone();
            drop(status);
            let _ = app.emit("models-updated", payload);
        }
    }
    fn provider_client(&self, provider: &Provider) -> &reqwest::Client {
        if url::Url::parse(&provider.base_url).ok().is_some_and(|u| {
            matches!(
                u.host_str(),
                Some("localhost" | "127.0.0.1" | "::1" | "[::1]")
            )
        }) {
            &self.local_client
        } else {
            &self.client
        }
    }
    pub async fn shutdown(&self, app: &AppHandle) {
        self.warmup.invalidate();
        self.preview_epoch.fetch_add(1, Ordering::SeqCst);
        {
            let mut guard = self.preview.lock().await;
            retire_preview(&mut guard).await;
            self.set_preview_engine(app, "unloaded");
        }
        {
            let mut guard = self.speech.lock().await;
            if let Some(mut w) = guard.take() {
                let _ = w.child.kill().await;
            }
            self.set_engine(app, true, "unloaded", None, None);
        }
        {
            let mut guard = self.llm.lock().await;
            if let Some(mut s) = guard.take() {
                let _ = s.child.kill().await;
            }
            self.set_engine(app, false, "unloaded", None, None);
        }
    }
    pub async fn reset_speech(&self, app: &AppHandle, ticket: &mut crate::warmup::Ticket) -> bool {
        let Some(mut guard) = ticket.lock_current(&self.speech).await else {
            return false;
        };
        if let Some(mut worker) = guard.take() {
            let _ = worker.child.kill().await;
        }
        self.set_engine(app, true, "unloaded", None, None);
        ticket.is_current()
    }
    pub async fn reset_preview(&self, app: &AppHandle, ticket: &mut crate::warmup::Ticket) -> bool {
        if !ticket.is_current() {
            return false;
        }
        self.preview_epoch.fetch_add(1, Ordering::SeqCst);
        let Some(mut guard) = ticket.lock_current(&self.preview).await else {
            return false;
        };
        retire_preview(&mut guard).await;
        self.set_preview_engine(app, "unloaded");
        ticket.is_current()
    }
    async fn worker(&self, app: &AppHandle) -> Result<Worker, String> {
        self.worker_with_role(app, false).await
    }
    async fn worker_with_role(&self, app: &AppHandle, preview: bool) -> Result<Worker, String> {
        let resource = app.path().resource_dir().map_err(|e| e.to_string())?;
        let bundled = resource.join("python/python.exe");
        let script = resource.join("service/speech.py");
        let mut cmd = if bundled.exists() {
            Command::new(bundled)
        } else if cfg!(debug_assertions) {
            Command::new("python")
        } else {
            return Err("Packaged Python runtime is missing. Reinstall CridVoice or restore the complete portable folder.".into());
        };
        cmd.arg("-u")
            .arg(&script)
            .arg("--data-dir")
            .arg(&self.root)
            .env("PYTHONIOENCODING", "utf-8")
            .env("PYTHONUTF8", "1")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        if preview {
            cmd.arg("--preview-worker");
            cmd.creation_flags(0x08000000 | 0x40);
        } else {
            hidden(&mut cmd);
        }
        let mut child = cmd.spawn().map_err(|error| {
            spawn_error(
                "Speech service could not start. Check the packaged Python runtime.",
                &error,
            )
        })?;
        let mut diagnostics = ChildDiagnostics::new();
        diagnostics.capture(
            child
                .stderr
                .take()
                .ok_or("Speech diagnostics unavailable.")?,
        )?;
        crate::native::attach_to_job(&child)?;
        let input = child.stdin.take().ok_or("Speech input unavailable.")?;
        let output =
            BufReader::new(child.stdout.take().ok_or("Speech output unavailable.")?).lines();
        Ok(Worker {
            child,
            input,
            output,
            diagnostics,
        })
    }
    fn try_preview_current(
        &self,
        context: RequestContext<'_>,
        active: &AtomicBool,
    ) -> Option<MutexGuard<'_, Option<Worker>>> {
        if !preview_current(context, active) {
            return None;
        }
        let guard = self.preview.try_lock().ok()?;
        preview_current(context, active).then_some(guard)
    }
    async fn preview_locked<F: Fn() -> bool + Sync>(
        &self,
        app: &AppHandle,
        mut request: Value,
        guard: &mut Option<Worker>,
        epoch: u64,
        budget: Duration,
        can_send: &F,
    ) -> Result<Option<Value>, String> {
        if !can_send() || self.preview_epoch.load(Ordering::SeqCst) != epoch {
            return Ok(None);
        }
        if guard
            .as_mut()
            .is_some_and(|worker| worker.child.try_wait().is_ok_and(|status| status.is_some()))
        {
            *guard = None;
        }
        if guard.is_none() {
            self.set_preview_engine(app, "loading");
            match self.worker_with_role(app, true).await {
                Ok(worker) => *guard = Some(worker),
                Err(error) => {
                    self.set_preview_engine(app, "error");
                    return Err(error);
                }
            }
            if !can_send() || self.preview_epoch.load(Ordering::SeqCst) != epoch {
                self.set_preview_engine(app, "unloaded");
                return Ok(None);
            }
        }
        let id = uuid::Uuid::new_v4().to_string();
        request["id"] = json!(id);
        let line = request.to_string() + "\n";
        if line.len() > 256 * 1024 {
            self.set_preview_engine(app, "error");
            return Err(
                "Live preview request is too large. Reduce the vocabulary and retry.".into(),
            );
        }
        let worker = guard.as_mut().unwrap();
        let exchange = preview_exchange(
            &mut worker.input,
            &mut worker.output,
            line.as_bytes(),
            &id,
            can_send,
        );
        let result = tokio::time::timeout(
            budget,
            preview_epoch_result(&self.preview_epoch, epoch, exchange),
        )
        .await;
        match result {
            Ok(Some(Ok(value))) => {
                if let Some(value) = &value {
                    if value["loadedModel"].is_object() {
                        self.set_preview_engine(app, "loaded");
                    } else if value.get("loadedModel").is_some() {
                        self.set_preview_engine(app, "unloaded");
                    }
                } else {
                    let loading = self.engine_status.lock().unwrap().preview.state == "loading";
                    if loading {
                        self.set_preview_engine(app, "unloaded");
                    }
                }
                Ok(value)
            }
            Ok(None) => {
                retire_preview(guard).await;
                self.set_preview_engine(app, "unloaded");
                Ok(None)
            }
            Ok(Some(Err(error))) => {
                retire_preview(guard).await;
                self.set_preview_engine(app, "error");
                Err(error)
            }
            Err(_) => {
                retire_preview(guard).await;
                self.set_preview_engine(app, "error");
                Err(
                    "Live preview timed out. Final recognition uses the separate speech engine."
                        .into(),
                )
            }
        }
    }
    pub async fn preview_transcribe(
        &self,
        app: &AppHandle,
        s: &Settings,
        audio: &Path,
        context: RequestContext<'_>,
        active: &AtomicBool,
    ) -> Result<Option<Value>, String> {
        if s.transcription.mode != "local"
            || !s.appearance.live_preview
            || !self
                .root
                .join("models/whisper-preview/.installed")
                .is_file()
        {
            return Ok(None);
        }
        let Some(mut guard) = self.try_preview_current(context, active) else {
            return Ok(None);
        };
        let epoch = self.preview_epoch.load(Ordering::SeqCst);
        let current = || {
            preview_current(context, active) && self.preview_epoch.load(Ordering::SeqCst) == epoch
        };
        drain_preview_result(
            current,
            self.preview_locked(
                app,
                json!({"op":"transcribe","audio":audio,"preview":true,"device":"cpu",
                    "modelId":"whisper-preview","language":s.transcription.language,"vocabulary":s.vocabulary}),
                &mut guard,
                epoch,
                Duration::from_secs(5),
                &current,
            ),
        ).await.unwrap_or(Ok(None))
    }
    pub async fn warm_preview(
        &self,
        app: &AppHandle,
        route: &crate::warmup::Route,
        mut ticket: crate::warmup::Ticket,
        can_start: impl Fn() -> bool,
    ) -> Result<bool, String> {
        if !ticket.is_current() {
            return Ok(true);
        }
        if route.model_id != "whisper-preview"
            || route.device != "cpu"
            || !self
                .root
                .join("models/whisper-preview/.installed")
                .is_file()
        {
            return Ok(true);
        }
        let Ok(mut guard) = self.preview.try_lock() else {
            return Ok(false);
        };
        if !ticket.is_current() {
            return Ok(true);
        }
        if !can_start() {
            return Ok(false);
        }
        let current = self.engine_status.lock().unwrap().preview.clone();
        if current.state == "loaded"
            && guard
                .as_mut()
                .is_some_and(|worker| worker.child.try_wait().is_ok_and(|s| s.is_none()))
        {
            return Ok(true);
        }
        let epoch = self.preview_epoch.load(Ordering::SeqCst);
        let current_ticket = ticket.clone();
        let can_send =
            || current_ticket.is_current() && self.preview_epoch.load(Ordering::SeqCst) == epoch;
        match ticket.run(self.preview_locked(
            app,
            json!({"op":"warm_model","modelId":"whisper-preview","device":"cpu","preview":true}),
            &mut guard,
            epoch,
            Duration::from_secs(30),
            &can_send,
        )).await {
            Some(result) => { result?; Ok(true) }
            None => {
                retire_preview(&mut guard).await;
                self.set_preview_engine(app, "unloaded");
                Ok(true)
            }
        }
    }
    async fn lock_speech(&self, preview: bool) -> Result<MutexGuard<'_, Option<Worker>>, String> {
        // A final take must outwait the one permitted preview's 45-second
        // processing budget, including worker retirement and diagnostic drain.
        let queue_budget = Duration::from_secs(if preview { 15 } else { 60 });
        tokio::time::timeout(queue_budget, self.speech.lock())
            .await
            .map_err(|_| "Speech service is still processing a previous take or live preview. Disable live preview and retry.".into())
    }
    async fn lock_speech_current(
        &self,
        preview: bool,
        context: RequestContext<'_>,
    ) -> Result<MutexGuard<'_, Option<Worker>>, String> {
        let guard = self.lock_speech(preview).await?;
        context.ensure_current()?;
        Ok(guard)
    }
    async fn lock_cleanup_current(
        &self,
        context: RequestContext<'_>,
    ) -> Result<MutexGuard<'_, Option<Server>>, String> {
        let guard = self.llm.lock().await;
        context.ensure_current()?;
        Ok(guard)
    }
    pub async fn speech(
        &self,
        app: &AppHandle,
        request: Value,
        context: RequestContext<'_>,
    ) -> Result<Value, String> {
        let preview = request["preview"].as_bool().unwrap_or(false);
        let mut guard = self.lock_speech_current(preview, context).await?;
        self.speech_locked(app, request, preview, &mut guard).await
    }
    async fn speech_locked(
        &self,
        app: &AppHandle,
        request: Value,
        preview: bool,
        guard: &mut Option<Worker>,
    ) -> Result<Value, String> {
        let model_id = request["modelId"].as_str().map(str::to_string);
        let device = request["device"].as_str().map(str::to_string);
        if request["op"] == "transcribe" || request["op"] == "warm_model" {
            self.begin_engine(app, true, model_id.clone(), device.clone());
        }
        if guard.is_none() {
            match self.worker(app).await {
                Ok(worker) => *guard = Some(worker),
                Err(error) => {
                    self.set_engine(app, true, "error", model_id, device);
                    return Err(error);
                }
            }
        }
        let w = guard.as_mut().unwrap();
        let id = uuid::Uuid::new_v4().to_string();
        let mut request = request;
        request["id"] = json!(id);
        let line = request.to_string() + "\n";
        if line.len() > 256 * 1024 {
            self.set_engine(app, true, "error", model_id, device);
            return Err("Speech request is too large. Reduce the vocabulary and retry.".into());
        }
        let result = async {
            w.input
                .write_all(line.as_bytes())
                .await
                .map_err(|_| "Speech service stopped.".to_string())?;
            w.input
                .flush()
                .await
                .map_err(|_| "Speech service stopped.".to_string())?;
            loop {
                let line = w
                    .output
                    .next_line()
                    .await
                    .map_err(|_| "Speech service communication failed.".to_string())?
                    .ok_or("Speech service exited unexpectedly. Check Models and try again.")?;
                let value: Value = serde_json::from_str(&line)
                    .map_err(|_| "Speech service returned an invalid response.".to_string())?;
                if value["id"] == id {
                    if value["ok"] == true {
                        return Ok(value["result"].clone());
                    }
                    return Err(value["error"]
                        .as_str()
                        .unwrap_or("Speech recognition failed.")
                        .to_string());
                }
            }
        };
        let timeout = Duration::from_secs(if preview { 45 } else { 240 });
        match tokio::time::timeout(timeout, result).await {
            Ok(Ok(v)) => {
                if let Some(loaded) = v["loadedModel"].as_object() {
                    self.set_engine(
                        app,
                        true,
                        "loaded",
                        loaded
                            .get("modelId")
                            .and_then(Value::as_str)
                            .map(str::to_string),
                        loaded
                            .get("device")
                            .and_then(Value::as_str)
                            .map(str::to_string),
                    );
                } else if v.get("loadedModel").is_some() {
                    self.set_engine(app, true, "unloaded", None, None);
                }
                Ok(v)
            }
            Ok(Err(e)) => {
                self.set_engine(app, true, "error", model_id, device);
                if let Some(mut w) = guard.take() {
                    let exit = w.child.try_wait().ok().flatten();
                    let _ = w.child.kill().await;
                    w.diagnostics.settle().await;
                    return Err(w.diagnostics.describe(&e, exit.as_ref()));
                }
                Err(e)
            }
            Err(_) => {
                self.set_engine(app, true, "error", model_id, device);
                let message = if preview {
                    "Live speech preview timed out. Final recognition will be attempted separately."
                } else {
                    "Speech recognition timed out. Try a smaller model or CPU/GPU setting."
                };
                if let Some(mut w) = guard.take() {
                    let _ = w.child.kill().await;
                    w.diagnostics.settle().await;
                    return Err(w.diagnostics.describe(message, None));
                }
                Err(message.into())
            }
        }
    }
    pub async fn warm_speech(
        &self,
        app: &AppHandle,
        route: &crate::warmup::Route,
        mut ticket: crate::warmup::Ticket,
        can_start: impl Fn() -> bool,
    ) -> Result<bool, String> {
        let mut guard = match ticket.lock_when_idle(&self.speech, can_start).await {
            crate::warmup::Admission::Ready(guard) => guard,
            crate::warmup::Admission::Busy => return Ok(false),
            crate::warmup::Admission::Cancelled => return Ok(true),
        };
        let current = self.engine_status.lock().unwrap().speech.clone();
        if current.state == "loaded"
            && current.model_id.as_deref() == Some(route.model_id.as_str())
            && current.device.as_deref() == Some(route.device.as_str())
            && guard
                .as_mut()
                .is_some_and(|worker| worker.child.try_wait().is_ok_and(|status| status.is_none()))
        {
            return Ok(true);
        }
        if guard
            .as_mut()
            .is_some_and(|worker| worker.child.try_wait().is_ok_and(|status| status.is_some()))
        {
            *guard = None;
        }
        let result = ticket
            .run(self.speech_locked(
                app,
                json!({"op":"warm_model","modelId":route.model_id,"device":route.device}),
                false,
                &mut guard,
            ))
            .await;
        match result {
            Some(result) => {
                result?;
                Ok(true)
            }
            None => {
                if let Some(mut worker) = guard.take() {
                    let _ = worker.child.kill().await;
                }
                self.set_engine(app, true, "unloaded", None, None);
                Ok(true)
            }
        }
    }
    pub async fn transcribe(
        &self,
        app: &AppHandle,
        s: &Settings,
        audio: &Path,
        preview: bool,
        context: RequestContext<'_>,
    ) -> Result<Value, String> {
        if s.transcription.mode == "local" {
            let device = if s.transcription.device == "auto" {
                if context.cuda_available {
                    "cuda"
                } else {
                    "cpu"
                }
            } else {
                &s.transcription.device
            };
            return self.speech(app,json!({"op":"transcribe","audio":audio,"preview":preview,"device":device,"modelId":s.transcription.model_id,"language":s.transcription.language,"vocabulary":s.vocabulary}),context).await;
        }
        let p = s
            .providers
            .iter()
            .find(|p| p.id == s.transcription.provider_id)
            .ok_or("Select a transcription provider in Settings.")?;
        if p.protocol != "openai" {
            return Err("Cloud transcription requires an OpenAI-compatible audio endpoint. Anthropic-compatible providers are supported for text cleanup.".into());
        }
        let key = credential(app, p)?;
        let bytes = tokio::fs::read(audio).await.map_err(|e| e.to_string())?;
        let part = reqwest::multipart::Part::bytes(bytes)
            .file_name("dictation.wav")
            .mime_str("audio/wav")
            .map_err(|e| e.to_string())?;
        let mut form = reqwest::multipart::Form::new()
            .part("file", part)
            .text("model", p.stt_model.clone())
            .text("response_format", "json");
        if s.transcription.language != "auto" {
            form = form.text("language", s.transcription.language.clone())
        }
        let mut request = self
            .provider_client(p)
            .post(core::endpoint(&p.base_url, "audio/transcriptions")?)
            .multipart(form);
        if !key.is_empty() {
            request = request.bearer_auth(key.as_str())
        }
        let response = request
            .send()
            .await
            .map_err(|_| "Transcription provider could not be reached.".to_string())?;
        if !response.status().is_success() {
            return Err(format!(
                "Transcription provider returned HTTP {}. Check the speech model and API key.",
                response.status().as_u16()
            ));
        }
        let value: Value = response
            .json()
            .await
            .map_err(|_| "Invalid transcription response.".to_string())?;
        if !value["text"].is_string() {
            return Err("Transcription response did not contain text.".into());
        }
        Ok(value)
    }
    pub async fn cleanup(
        &self,
        app: &AppHandle,
        s: &Settings,
        raw: &str,
        ctx: &Context,
        rewrite: bool,
        context: RequestContext<'_>,
    ) -> Result<crate::coding::Output, String> {
        let output = self
            .cleanup_inner(app, s, raw, ctx, rewrite, context)
            .await?;
        Ok(crate::coding::normalize_output(s, raw, rewrite, output))
    }
    async fn cleanup_inner(
        &self,
        app: &AppHandle,
        s: &Settings,
        raw: &str,
        ctx: &Context,
        rewrite: bool,
        context: RequestContext<'_>,
    ) -> Result<crate::coding::Output, String> {
        if s.cleanup.mode == "off" {
            return Ok(crate::coding::Output {
                text: raw.to_string(),
                coding_language: None,
            });
        }
        let (system, user) = core::cleanup_messages(s, raw, ctx, rewrite);
        if s.cleanup.mode == "provider" {
            let p = s
                .providers
                .iter()
                .find(|p| p.id == s.cleanup.provider_id)
                .ok_or("Select a text-cleanup provider.")?;
            return core::chat_output(
                self.provider_client(p),
                p,
                &credential(app, p)?,
                &system,
                &user,
                &s.cleanup.output_mode,
            )
            .await;
        }
        let mut guard = self.lock_cleanup_current(context).await?;
        let gpu = match s.cleanup.device.as_str() {
            "cuda" => true,
            "cpu" => false,
            _ => context.cuda_available,
        };
        self.ensure_llm(app, s, gpu, &mut guard, true).await?;
        let server = guard.as_mut().unwrap();
        let result = core::chat_output(
            &self.local_client,
            &server.provider,
            &server.key,
            &system,
            &user,
            &s.cleanup.output_mode,
        )
        .await;
        match result {
            Ok(text) => Ok(text),
            Err(error) => {
                let exit = server.child.try_wait().ok().flatten();
                if exit.is_some() {
                    server.diagnostics.settle().await;
                    self.set_engine(
                        app,
                        false,
                        "error",
                        Some(s.cleanup.model_id.clone()),
                        Some(if gpu { "vulkan" } else { "cpu" }.into()),
                    );
                }
                Err(server.diagnostics.describe(&error, exit.as_ref()))
            }
        }
    }
    async fn ensure_llm(
        &self,
        app: &AppHandle,
        s: &Settings,
        gpu: bool,
        guard: &mut Option<Server>,
        mark_loaded: bool,
    ) -> Result<(), String> {
        let identity = format!("{}:{gpu}", s.cleanup.model_id);
        if let Some(server) = guard.as_mut() {
            if server.identity != identity
                || server
                    .child
                    .try_wait()
                    .map_err(|e| e.to_string())?
                    .is_some()
            {
                let _ = server.child.kill().await;
                *guard = None
            }
        }
        if guard.is_none() {
            let device = if gpu { "vulkan" } else { "cpu" }.to_string();
            self.begin_engine(
                app,
                false,
                Some(s.cleanup.model_id.clone()),
                Some(device.clone()),
            );
            match self.start_llm(app, s, gpu, identity).await {
                Ok(server) => {
                    *guard = Some(server);
                    if mark_loaded {
                        self.set_engine(
                            app,
                            false,
                            "loaded",
                            Some(s.cleanup.model_id.clone()),
                            Some(device),
                        );
                    }
                }
                Err(error) => {
                    self.set_engine(
                        app,
                        false,
                        "error",
                        Some(s.cleanup.model_id.clone()),
                        Some(device),
                    );
                    return Err(error);
                }
            }
        }
        Ok(())
    }
    pub async fn warm_cleanup(
        &self,
        app: &AppHandle,
        settings: &Settings,
        route: &crate::warmup::Route,
        mut ticket: crate::warmup::Ticket,
        can_start: impl Fn() -> bool,
    ) -> Result<bool, String> {
        let mut guard = match ticket.lock_when_idle(&self.llm, can_start).await {
            crate::warmup::Admission::Ready(guard) => guard,
            crate::warmup::Admission::Busy => return Ok(false),
            crate::warmup::Admission::Cancelled => return Ok(true),
        };
        let current = self.engine_status.lock().unwrap().cleanup.clone();
        if current.state == "loaded"
            && current.model_id.as_deref() == Some(route.model_id.as_str())
            && current.device.as_deref() == Some(route.device.as_str())
            && guard
                .as_mut()
                .is_some_and(|server| server.child.try_wait().is_ok_and(|status| status.is_none()))
        {
            return Ok(true);
        }
        let gpu = route.device == "vulkan";
        self.begin_engine(
            app,
            false,
            Some(route.model_id.clone()),
            Some(route.device.clone()),
        );
        let result = ticket
            .run(async {
                self.ensure_llm(app, settings, gpu, &mut guard, false)
                    .await?;
                let server = guard.as_ref().unwrap();
                // Exercise representative prompt prefill as well as first decode
                // allocations. Only the output mode is used; all text, style,
                // context and vocabulary come from public defaults.
                let response = self
                    .local_client
                    .post(core::endpoint(
                        &server.provider.base_url,
                        "chat/completions",
                    )?)
                    .bearer_auth(&server.key)
                    .json(&core::cleanup_warmup_payload(&settings.cleanup.output_mode))
                    .send()
                    .await
                    .map_err(|_| "Local cleanup warm-up could not reach its engine.".to_string())?;
                if !response.status().is_success() {
                    return Err(
                        "Local cleanup warm-up failed. Retry loading the selected models.".into(),
                    );
                }
                let value: Value = response
                    .json()
                    .await
                    .map_err(|_| "Local cleanup warm-up returned invalid JSON.".to_string())?;
                if !value["choices"][0]["message"]["content"].is_string() {
                    return Err("Local cleanup warm-up returned no completion.".into());
                }
                Ok::<(), String>(())
            })
            .await;
        match result {
            Some(Ok(())) => {
                self.set_engine(
                    app,
                    false,
                    "loaded",
                    Some(route.model_id.clone()),
                    Some(route.device.clone()),
                );
                Ok(true)
            }
            result => {
                if let Some(mut server) = guard.take() {
                    let _ = server.child.kill().await;
                }
                if let Some(Err(error)) = result {
                    self.set_engine(
                        app,
                        false,
                        "error",
                        Some(route.model_id.clone()),
                        Some(route.device.clone()),
                    );
                    Err(error)
                } else {
                    self.set_engine(app, false, "unloaded", None, None);
                    Ok(true)
                }
            }
        }
    }
    async fn start_llm(
        &self,
        app: &AppHandle,
        s: &Settings,
        gpu: bool,
        identity: String,
    ) -> Result<Server, String> {
        let modelroot = self.root.join("models").join(&s.cleanup.model_id);
        if !modelroot.join(".installed").exists() {
            return Err("Download the selected cleanup model in Models, or connect LM Studio/llama.cpp in Providers.".into());
        }
        let runtime = self
            .root
            .join("models")
            .join(if gpu { "llama-gpu" } else { "llama-cpu" });
        if !runtime.join(".installed").exists() {
            return Err("Download the selected llama.cpp CPU/GPU runtime in Models.".into());
        }
        let exe = locate(&runtime, "llama-server.exe")
            .ok_or("Local model engine is missing. Re-download its runtime.")?;
        // App-local DLLs take precedence over an absent or older system C++ runtime.
        // Both managed engines use the same verified libraries as packaged Python.
        let libraries = app
            .path()
            .resource_dir()
            .map_err(|e| e.to_string())?
            .join("python");
        for name in [
            "msvcp140.dll",
            "msvcp140_1.dll",
            "msvcp140_2.dll",
            "msvcp140_atomic_wait.dll",
            "msvcp140_codecvt_ids.dll",
            "vcruntime140.dll",
            "vcruntime140_1.dll",
            "concrt140.dll",
        ] {
            tokio::fs::copy(libraries.join(name), exe.parent().unwrap().join(name)).await
                .map_err(|_| "Bundled C++ libraries could not be prepared for the local model engine. Reinstall CridVoice and check model-folder write permissions.".to_string())?;
        }
        let model =
            locate(&modelroot, "Qwen3-4B-Q4_K_M.gguf").ok_or("Local cleanup model is missing.")?;
        let listener = std::net::TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
        let port = listener.local_addr().map_err(|e| e.to_string())?.port();
        drop(listener);
        let key = uuid::Uuid::new_v4().to_string();
        let mut cmd = Command::new(&exe);
        cmd.arg("--model")
            .arg(model)
            .arg("--alias")
            .arg("local")
            .arg("--host")
            .arg("127.0.0.1")
            .arg("--port")
            .arg(port.to_string())
            .arg("--api-key")
            .arg(&key)
            .arg("--ctx-size")
            .arg("8192")
            .arg("--parallel")
            .arg("1")
            .arg("--n-gpu-layers")
            .arg(if gpu { "99" } else { "0" })
            .arg("--no-webui")
            .current_dir(exe.parent().unwrap())
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        hidden(&mut cmd);
        let mut child=cmd.spawn().map_err(|error| spawn_error("Local language-model engine could not start. Check its runtime and graphics driver.", &error))?;
        let mut diagnostics = ChildDiagnostics::new();
        diagnostics.capture(
            child
                .stdout
                .take()
                .ok_or("Local engine output unavailable.")?,
        )?;
        diagnostics.capture(
            child
                .stderr
                .take()
                .ok_or("Local engine diagnostics unavailable.")?,
        )?;
        crate::native::attach_to_job(&child)?;
        let base = format!("http://127.0.0.1:{port}");
        let readiness = async {
            loop {
                if let Some(exit) = child
                    .try_wait()
                    .map_err(|_| "Local engine status could not be checked.")?
                {
                    diagnostics.settle().await;
                    return Err(diagnostics.describe("Local language-model engine exited. Try CPU mode or update the graphics driver.", Some(&exit)));
                }
                if self
                    .local_client
                    .get(format!("{base}/health"))
                    .bearer_auth(&key)
                    .timeout(Duration::from_secs(1))
                    .send()
                    .await
                    .is_ok_and(|r| r.status().is_success())
                {
                    return Ok(());
                }
                tokio::time::sleep(Duration::from_millis(500)).await;
            }
        };
        match tokio::time::timeout(Duration::from_secs(120), readiness).await {
            Ok(Ok(())) => (),
            Ok(Err(error)) => return Err(error),
            Err(_) => {
                let _ = child.kill().await;
                diagnostics.settle().await;
                return Err(diagnostics.describe(
                "Local cleanup model did not become ready within 120 seconds. Try CPU mode or restart CridVoice."
                , None));
            }
        }
        Ok(Server {
            child,
            identity,
            key,
            diagnostics,
            provider: Provider {
                id: "managed".into(),
                name: "Managed local model".into(),
                protocol: "openai".into(),
                base_url: format!("{base}/v1"),
                model: "local".into(),
                stt_model: String::new(),
                has_key: false,
            },
        })
    }
    pub async fn test_provider(&self, app: &AppHandle, p: &Provider) -> Result<String, String> {
        core::chat(
            self.provider_client(p),
            p,
            &credential(app, p)?,
            "Return only READY.",
            "Connection test.",
        )
        .await
    }
}
fn credential(app: &AppHandle, provider: &Provider) -> Result<zeroize::Zeroizing<String>, String> {
    let state = app.state::<crate::desktop::State>();
    let settings = state.settings.lock().unwrap();
    core::provider_bound_lookup(&settings.providers, provider, || {
        crate::vault::read(&provider.id)
    })
}
pub fn save_credential(id: &str, key: &str) -> Result<(), String> {
    crate::vault::write(id, key)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test(start_paused = true)]
    async fn final_speech_lock_does_not_wait_for_a_slow_preview() {
        let inference = std::sync::Arc::new(Inference::new(PathBuf::from(".")));
        let preview_inference = inference.clone();
        let (started, ready) = tokio::sync::oneshot::channel();
        let (finish, finished) = tokio::sync::oneshot::channel();
        let preview = tokio::spawn(async move {
            let _guard = preview_inference.preview.lock().await;
            started.send(()).unwrap();
            finished.await.unwrap();
        });
        ready.await.unwrap();
        let final_guard =
            tokio::time::timeout(Duration::from_millis(1), inference.lock_speech(false))
                .await
                .expect("final must not queue behind the dedicated preview lock")
                .unwrap();
        drop(final_guard);
        assert!(!preview.is_finished());
        finish.send(()).unwrap();
        preview.await.unwrap();
    }

    #[tokio::test]
    async fn busy_preview_is_dropped_without_joining_a_queue() {
        let inference = Inference::new(PathBuf::from("."));
        let generation = AtomicU64::new(1);
        let active = AtomicBool::new(true);
        let context = RequestContext {
            cuda_available: false,
            generation: &generation,
            expected_generation: 1,
        };
        let held = inference.preview.lock().await;
        assert!(inference.try_preview_current(context, &active).is_none());
        drop(held);
        assert!(inference.try_preview_current(context, &active).is_some());
    }

    #[tokio::test]
    async fn release_after_preview_admission_prevents_any_request_write() {
        use tokio::io::AsyncReadExt;
        let inference = Inference::new(PathBuf::from("."));
        let generation = AtomicU64::new(1);
        let active = AtomicBool::new(true);
        let context = RequestContext {
            cuda_available: false,
            generation: &generation,
            expected_generation: 1,
        };
        let _admitted = inference.try_preview_current(context, &active).unwrap();
        active.store(false, Ordering::SeqCst);
        let (client, mut peer) = tokio::io::duplex(1024);
        let (read, mut write) = tokio::io::split(client);
        let mut output = BufReader::new(read).lines();
        let result = preview_exchange(
            &mut write,
            &mut output,
            b"must not be sent\n",
            "cancelled",
            &|| preview_current(context, &active),
        )
        .await
        .unwrap();
        assert!(result.is_none());
        write.shutdown().await.unwrap();
        let mut bytes = Vec::new();
        peer.read_to_end(&mut bytes).await.unwrap();
        assert!(bytes.is_empty());
    }

    #[tokio::test]
    async fn released_preview_drains_and_reuses_the_same_protocol_stream() {
        let active = std::sync::Arc::new(AtomicBool::new(true));
        let current = active.clone();
        let (client, peer) = tokio::io::duplex(4096);
        let (read, mut write) = tokio::io::split(client);
        let mut output = BufReader::new(read).lines();
        let (peer_read, mut peer_write) = tokio::io::split(peer);
        let mut requests = BufReader::new(peer_read).lines();
        let (sent, received) = tokio::sync::oneshot::channel();
        let (respond, response_allowed) = tokio::sync::oneshot::channel();
        let worker = tokio::spawn(async move {
            assert_eq!(requests.next_line().await.unwrap().unwrap(), "first");
            sent.send(()).unwrap();
            response_allowed.await.unwrap();
            peer_write.write_all(b"{\"id\":\"first\",\"ok\":true,\"result\":{\"text\":\"old\",\"loadedModel\":{\"modelId\":\"whisper-preview\",\"device\":\"cpu\"}}}\n").await.unwrap();
            assert_eq!(requests.next_line().await.unwrap().unwrap(), "second");
            peer_write.write_all(b"{\"id\":\"second\",\"ok\":true,\"result\":{\"text\":\"new\",\"loadedModel\":{\"modelId\":\"whisper-preview\",\"device\":\"cpu\"}}}\n").await.unwrap();
        });
        let first = tokio::spawn(async move {
            let can_send = || current.load(Ordering::SeqCst);
            let result = drain_preview_result(
                &can_send,
                preview_exchange(&mut write, &mut output, b"first\n", "first", &can_send),
            )
            .await;
            (write, output, result)
        });
        received.await.unwrap();
        active.store(false, Ordering::SeqCst);
        assert!(
            !first.is_finished(),
            "release must drain rather than abort the worker stream"
        );
        respond.send(()).unwrap();
        let (mut write, mut output, result) = first.await.unwrap();
        assert!(result.is_none());
        let second = preview_exchange(&mut write, &mut output, b"second\n", "second", &|| true)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(second["text"], "new");
        assert_eq!(second["loadedModel"]["modelId"], "whisper-preview");
        worker.await.unwrap();
    }

    #[tokio::test]
    async fn old_preview_generation_cannot_enter_or_publish_into_a_new_take() {
        let inference = Inference::new(PathBuf::from("."));
        let generation = AtomicU64::new(1);
        let active = AtomicBool::new(true);
        let context = RequestContext {
            cuda_available: false,
            generation: &generation,
            expected_generation: 1,
        };
        generation.store(2, Ordering::SeqCst);
        assert!(inference.try_preview_current(context, &active).is_none());
        assert!(
            drain_preview_result(|| preview_current(context, &active), async { "old text" })
                .await
                .is_none()
        );
        assert!(inference.preview.lock().await.is_none());
    }

    #[tokio::test(start_paused = true)]
    async fn explicit_preview_reset_epoch_cancels_only_preview_work() {
        let inference = std::sync::Arc::new(Inference::new(PathBuf::from(".")));
        let preview_inference = inference.clone();
        let (started, ready) = tokio::sync::oneshot::channel();
        let preview = tokio::spawn(async move {
            let _guard = preview_inference.preview.lock().await;
            preview_epoch_result(&preview_inference.preview_epoch, 0, async {
                started.send(()).unwrap();
                std::future::pending::<()>().await;
            })
            .await
        });
        ready.await.unwrap();
        inference.preview_epoch.fetch_add(1, Ordering::SeqCst);
        tokio::time::advance(Duration::from_millis(25)).await;
        assert!(preview.await.unwrap().is_none());
        assert!(inference.speech.try_lock().is_ok());
        assert!(inference.llm.try_lock().is_ok());
    }

    #[tokio::test]
    async fn preview_protocol_failure_cannot_change_main_engine_state() {
        let inference = Inference::new(PathBuf::from("."));
        let main = EngineStatus {
            model_id: Some("whisper-turbo".into()),
            device: Some("cuda".into()),
            state: "loaded".into(),
        };
        inference.engine_status.lock().unwrap().speech = main.clone();
        let _main_lock = inference.speech.lock().await;
        let (client, mut peer) = tokio::io::duplex(1024);
        peer.write_all(b"invalid JSON\n").await.unwrap();
        let (read, mut write) = tokio::io::split(client);
        let mut output = BufReader::new(read).lines();
        assert!(
            preview_exchange(&mut write, &mut output, b"preview\n", "preview", &|| true)
                .await
                .is_err()
        );
        assert_eq!(
            inference.engine_status.lock().unwrap().speech.state,
            main.state
        );
        assert_eq!(
            inference.engine_status.lock().unwrap().speech.model_id,
            main.model_id
        );
        assert!(inference.preview.try_lock().is_ok());
    }

    #[tokio::test]
    async fn cancelled_speech_waiter_cannot_restart_worker_after_shutdown() {
        let inference = std::sync::Arc::new(Inference::new(PathBuf::from(".")));
        let generation = std::sync::Arc::new(AtomicU64::new(1));
        let shutdown_guard = inference.speech.lock().await;
        let waiter_inference = inference.clone();
        let waiter_generation = generation.clone();
        let (queued, waiting) = tokio::sync::oneshot::channel();
        let waiter = tokio::spawn(async move {
            queued.send(()).unwrap();
            waiter_inference
                .lock_speech_current(
                    false,
                    RequestContext {
                        cuda_available: false,
                        generation: &waiter_generation,
                        expected_generation: 1,
                    },
                )
                .await
                .err()
                .expect("a cancelled waiter must not reach worker startup")
        });
        waiting.await.unwrap();
        generation.store(2, std::sync::atomic::Ordering::SeqCst);
        drop(shutdown_guard);
        assert_eq!(waiter.await.unwrap(), "Dictation was cancelled.");
        assert!(inference.speech.lock().await.is_none());
    }

    #[tokio::test]
    async fn cancelled_cleanup_waiter_cannot_restart_server_after_shutdown() {
        let inference = std::sync::Arc::new(Inference::new(PathBuf::from(".")));
        let generation = std::sync::Arc::new(AtomicU64::new(1));
        let shutdown_guard = inference.llm.lock().await;
        let waiter_inference = inference.clone();
        let waiter_generation = generation.clone();
        let (queued, waiting) = tokio::sync::oneshot::channel();
        let waiter = tokio::spawn(async move {
            queued.send(()).unwrap();
            waiter_inference
                .lock_cleanup_current(RequestContext {
                    cuda_available: false,
                    generation: &waiter_generation,
                    expected_generation: 1,
                })
                .await
                .err()
                .expect("a cancelled waiter must not reach server startup")
        });
        waiting.await.unwrap();
        generation.store(2, std::sync::atomic::Ordering::SeqCst);
        drop(shutdown_guard);
        assert_eq!(waiter.await.unwrap(), "Dictation was cancelled.");
        assert!(inference.llm.lock().await.is_none());
    }

    #[tokio::test(start_paused = true)]
    async fn final_take_outwaits_a_cold_preview_deadline() {
        let inference = std::sync::Arc::new(Inference::new(PathBuf::from(".")));
        let preview_inference = inference.clone();
        let (started, ready) = tokio::sync::oneshot::channel();
        let preview = tokio::spawn(async move {
            let _guard = preview_inference.speech.lock().await;
            started.send(()).unwrap();
            tokio::time::sleep(Duration::from_secs(45)).await;
        });
        ready.await.unwrap();
        let start = tokio::time::Instant::now();
        let final_guard = inference
            .lock_speech(false)
            .await
            .expect("the final take must survive the maximum preview processing time");
        assert!(start.elapsed() >= Duration::from_secs(45));
        assert!(start.elapsed() < Duration::from_secs(60));
        drop(final_guard);
        preview.await.unwrap();
    }

    #[tokio::test(start_paused = true)]
    async fn truly_stuck_speech_queue_has_a_bounded_actionable_failure() {
        let inference = Inference::new(PathBuf::from("."));
        let _stuck_guard = inference.speech.lock().await;
        let start = tokio::time::Instant::now();
        let error = inference
            .lock_speech(false)
            .await
            .err()
            .expect("a stuck queue must time out");
        assert_eq!(start.elapsed(), Duration::from_secs(60));
        assert!(error.contains("Disable live preview and retry"));
    }

    #[tokio::test]
    async fn snapshot_clears_loaded_speech_when_idle_child_exits() {
        let inference = Inference::new(PathBuf::from("."));
        let mut command = Command::new("cmd.exe");
        command
            .args(["/D", "/C", "exit 7"])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .kill_on_drop(true);
        hidden(&mut command);
        let mut child = command.spawn().unwrap();
        let input = child.stdin.take().unwrap();
        let output = BufReader::new(child.stdout.take().unwrap()).lines();
        child.wait().await.unwrap();
        *inference.speech.lock().await = Some(Worker {
            child,
            input,
            output,
            diagnostics: ChildDiagnostics::new(),
        });
        inference.engine_status.lock().unwrap().speech = EngineStatus {
            model_id: Some("whisper-small".into()),
            device: Some("cpu".into()),
            state: "loaded".into(),
        };
        let snapshot = inference.engine_status();
        assert_eq!(snapshot.speech.state, "unloaded");
        assert!(snapshot.speech.model_id.is_none());
        assert!(inference.speech.lock().await.is_none());
    }
}
