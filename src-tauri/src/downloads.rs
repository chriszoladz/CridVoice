use crate::desktop::State;
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    io::Read,
    path::Path,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
};
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::AsyncWriteExt;
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Model {
    pub id: String,
    pub name: String,
    pub kind: String,
    pub description: String,
    pub size_bytes: u64,
    pub license: String,
    pub files: Vec<ModelFile>,
    #[serde(default)]
    pub installed: bool,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelFile {
    pub url: String,
    pub name: String,
    pub sha256: String,
    pub bytes: u64,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    pub id: String,
    pub completed: u64,
    pub total: u64,
    pub state: String,
    pub error: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stage_completed: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stage_total: Option<u64>,
}
type Notify = Arc<dyn Fn(Progress) + Send + Sync>;
const PAUSED: &str = "Download paused. Download again to resume.";
pub fn catalog() -> Vec<Model> {
    serde_json::from_str(include_str!("../resources/model-catalog.json"))
        .expect("Invalid bundled model catalog")
}
pub fn list(state: &State) -> Vec<Model> {
    state
        .catalog
        .iter()
        .cloned()
        .map(|mut m| {
            m.installed = state
                .root
                .join("models")
                .join(&m.id)
                .join(".installed")
                .is_file();
            m
        })
        .collect()
}
fn progress(
    notify: &Notify,
    m: &Model,
    completed: u64,
    status: &str,
    error: &str,
    stage: Option<(u64, u64)>,
) {
    notify(Progress {
        id: m.id.clone(),
        completed,
        total: m.size_bytes,
        state: status.into(),
        error: error.into(),
        stage_completed: stage.map(|(completed, _)| completed),
        stage_total: stage.map(|(_, total)| total),
    });
}
fn check_cancel(cancel: &AtomicBool) -> Result<(), String> {
    if cancel.load(Ordering::Relaxed) {
        Err(PAUSED.into())
    } else {
        Ok(())
    }
}
async fn cancellation(cancel: &AtomicBool) {
    while !cancel.load(Ordering::Relaxed) {
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    }
}
fn hash(path: &Path, cancel: &AtomicBool, notify: impl Fn(u64, u64)) -> Result<String, String> {
    let mut f = std::fs::File::open(path).map_err(|e| e.to_string())?;
    let total = f.metadata().map_err(|e| e.to_string())?.len();
    let mut digest = Sha256::new();
    let mut b = [0u8; 1024 * 256];
    let mut completed = 0;
    let mut last = std::time::Instant::now();
    notify(0, total);
    loop {
        check_cancel(cancel)?;
        let n = f.read(&mut b).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        digest.update(&b[..n]);
        completed += n as u64;
        if last.elapsed().as_millis() >= 200 {
            notify(completed, total);
            last = std::time::Instant::now();
        }
    }
    notify(completed, total);
    Ok(format!("{:x}", digest.finalize()))
}
pub async fn download(app: AppHandle, id: String) -> Result<(), String> {
    let state = app.state::<State>();
    let model = state
        .catalog
        .iter()
        .find(|m| m.id == id)
        .cloned()
        .ok_or("Unknown model.")?;
    let cancel = Arc::new(AtomicBool::new(false));
    if state.downloads.lock().unwrap().contains_key(&id) {
        return Err("This model is already downloading.".into());
    }
    if crate::desktop::warm_uses_asset(&state, &id) {
        // Retire background readers before reserving and modifying this asset.
        // Real takes are governed by their existing engine/controller guards.
        state.inference.warmup.cancel_and_wait().await;
    }
    let _operation = {
        let mut jobs = state.downloads.lock().unwrap();
        if jobs.contains_key(&id) {
            return Err("This model is already downloading.".into());
        }
        let operation = state.model_operations.acquire(&id)?;
        jobs.insert(id.clone(), cancel.clone());
        operation
    };
    let progress_app = app.clone();
    let notify: Notify = Arc::new(move |event| {
        progress_app
            .state::<State>()
            .download_progress
            .lock()
            .unwrap()
            .insert(event.id.clone(), event.clone());
        let _ = progress_app.emit("download", event);
    });
    progress(&notify, &model, 0, "queued", "", None);
    let client = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(20))
        .read_timeout(std::time::Duration::from_secs(60))
        .user_agent("CridVoice/0.1.0")
        .build()
        .map_err(|e| e.to_string());
    let result = match client {
        Ok(client) => {
            install_model(
                &state.root.join("models").join(&model.id),
                &model,
                &cancel,
                &notify,
                &client,
            )
            .await
        }
        Err(error) => Err(error),
    };
    match result {
        Ok(()) => {
            let _ = app.emit("models-updated", ());
            progress(&notify, &model, model.size_bytes, "complete", "", None);
            state.download_progress.lock().unwrap().remove(&id);
            state.downloads.lock().unwrap().remove(&id);
            if crate::desktop::warm_uses_asset(&state, &id) {
                // Installation is complete. Do not hold a wizard completion
                // behind an old speech request's engine lock.
                let reset_app = app.clone();
                let installed_id = id.clone();
                let reset_speech = model.kind == "speech" || id == "nvidia-runtime";
                tauri::async_runtime::spawn(async move {
                    crate::desktop::warm_after_download(&reset_app, &installed_id, reset_speech)
                        .await;
                });
            }
            Ok(())
        }
        Err(e) => {
            let completed = state
                .download_progress
                .lock()
                .unwrap()
                .get(&id)
                .map(|p| p.completed)
                .unwrap_or(0);
            progress(
                &notify,
                &model,
                completed,
                if cancel.load(Ordering::Relaxed) {
                    "cancelled"
                } else {
                    "error"
                },
                &e,
                None,
            );
            state.download_progress.lock().unwrap().remove(&id);
            state.downloads.lock().unwrap().remove(&id);
            let _ = app.emit("models-updated", ());
            Err(e)
        }
    }
}
async fn install_model(
    root: &Path,
    m: &Model,
    cancel: &Arc<AtomicBool>,
    notify: &Notify,
    client: &reqwest::Client,
) -> Result<(), String> {
    tokio::fs::create_dir_all(root)
        .await
        .map_err(|e| e.to_string())?;
    match tokio::fs::remove_file(root.join(".installed")).await {
        Ok(()) => (),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => (),
        Err(error) => return Err(error.to_string()),
    }
    let mut base = 0;
    for file in &m.files {
        check_cancel(cancel)?;
        let finalpath = root.join(&file.name);
        let part = root.join(format!("{}.part", file.name));
        if finalpath.exists() {
            let p = finalpath.clone();
            let expected = file.sha256.clone();
            let verify_cancel = cancel.clone();
            let verify_notify = notify.clone();
            let verify_model = m.clone();
            let completed = base + file.bytes;
            if tokio::task::spawn_blocking(move || {
                hash(&p, &verify_cancel, |checked, total| {
                    progress(
                        &verify_notify,
                        &verify_model,
                        completed,
                        "verifying",
                        "",
                        Some((checked, total)),
                    );
                })
                .map(|s| s == expected)
            })
            .await
            .map_err(|e| e.to_string())??
            {
                if file.name.ends_with(".zip") || file.name.ends_with(".whl") {
                    let src = finalpath.clone();
                    let dest = root.to_path_buf();
                    let extract_cancel = cancel.clone();
                    let extract_notify = notify.clone();
                    let extract_model = m.clone();
                    tokio::task::spawn_blocking(move || {
                        extract(&src, &dest, &extract_cancel, |checked, total| {
                            progress(
                                &extract_notify,
                                &extract_model,
                                completed,
                                "extracting",
                                "",
                                Some((checked, total)),
                            );
                        })
                    })
                    .await
                    .map_err(|e| e.to_string())??;
                }
                base += file.bytes;
                continue;
            }
        }
        let mut offset = tokio::fs::metadata(&part)
            .await
            .map(|m| m.len())
            .unwrap_or(0);
        if offset > file.bytes {
            tokio::fs::remove_file(&part)
                .await
                .map_err(|e| e.to_string())?;
            offset = 0
        }
        if offset < file.bytes {
            let mut req = client.get(&file.url);
            if offset > 0 {
                req = req.header(reqwest::header::RANGE, format!("bytes={offset}-"))
            }
            progress(notify, m, base + offset, "downloading", "", None);
            let response = tokio::select! {
                response = req.send() => response.map_err(|_| "Download server could not be reached. Retry to resume.".to_string())?,
                _ = cancellation(cancel) => return Err(PAUSED.into()),
            };
            if !response.status().is_success() {
                return Err(format!(
                    "Download returned HTTP {}. Retry later.",
                    response.status().as_u16()
                ));
            }
            if offset > 0 && response.status() != reqwest::StatusCode::PARTIAL_CONTENT {
                offset = 0
            }
            if response.status() == reqwest::StatusCode::PARTIAL_CONTENT
                && !response
                    .headers()
                    .get(reqwest::header::CONTENT_RANGE)
                    .and_then(|v| v.to_str().ok())
                    .is_some_and(|v| v.starts_with(&format!("bytes {offset}-")))
            {
                return Err("Download server returned an invalid byte range.".into());
            }
            let mut output = tokio::fs::OpenOptions::new()
                .create(true)
                .write(true)
                .append(offset > 0)
                .truncate(offset == 0)
                .open(&part)
                .await
                .map_err(|e| e.to_string())?;
            let mut stream = response.bytes_stream();
            let mut last = std::time::Instant::now();
            loop {
                let chunk = tokio::select! {
                    chunk = stream.next() => chunk,
                    _ = cancellation(cancel) => {
                        output.flush().await.map_err(|e| e.to_string())?;
                        return Err(PAUSED.into());
                    },
                };
                let Some(chunk) = chunk else {
                    break;
                };
                if cancel.load(Ordering::Relaxed) {
                    output.flush().await.map_err(|e| e.to_string())?;
                    return Err("Download paused. Download again to resume.".into());
                }
                let chunk =
                    chunk.map_err(|_| "Download interrupted. Retry to resume.".to_string())?;
                if offset + chunk.len() as u64 > file.bytes {
                    return Err("Download exceeded its expected size.".into());
                }
                output
                    .write_all(&chunk)
                    .await
                    .map_err(|_| "Could not write model. Check free disk space.".to_string())?;
                offset += chunk.len() as u64;
                if last.elapsed().as_millis() > 200 {
                    progress(notify, m, base + offset, "downloading", "", None);
                    last = std::time::Instant::now();
                }
            }
            output.sync_all().await.map_err(|e| e.to_string())?;
        }
        if offset != file.bytes {
            return Err("Download was incomplete. Retry to resume.".into());
        }
        check_cancel(cancel)?;
        let p = part.clone();
        let verify_cancel = cancel.clone();
        let verify_notify = notify.clone();
        let verify_model = m.clone();
        let completed = base + offset;
        let actual = tokio::task::spawn_blocking(move || {
            hash(&p, &verify_cancel, |checked, total| {
                progress(
                    &verify_notify,
                    &verify_model,
                    completed,
                    "verifying",
                    "",
                    Some((checked, total)),
                );
            })
        })
        .await
        .map_err(|e| e.to_string())??;
        if actual != file.sha256 {
            let _ = tokio::fs::remove_file(&part).await;
            return Err(
                "Download checksum did not match. The partial file was removed; download again."
                    .into(),
            );
        }
        tokio::fs::rename(&part, &finalpath)
            .await
            .map_err(|e| e.to_string())?;
        if file.name.ends_with(".zip") || file.name.ends_with(".whl") {
            let src = finalpath.clone();
            let dest = root.to_path_buf();
            let extract_cancel = cancel.clone();
            let extract_notify = notify.clone();
            let extract_model = m.clone();
            tokio::task::spawn_blocking(move || {
                extract(&src, &dest, &extract_cancel, |checked, total| {
                    progress(
                        &extract_notify,
                        &extract_model,
                        completed,
                        "extracting",
                        "",
                        Some((checked, total)),
                    );
                })
            })
            .await
            .map_err(|e| e.to_string())??;
        }
        base += file.bytes;
    }
    if cancel.load(Ordering::Relaxed) {
        return Err("Download paused.".into());
    }
    crate::store::atomic_json(&root.join(".installed"), m)?;
    Ok(())
}
fn extract(
    src: &Path,
    dest: &Path,
    cancel: &AtomicBool,
    notify: impl Fn(u64, u64),
) -> Result<(), String> {
    let file = std::fs::File::open(src).map_err(|e| e.to_string())?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;
    let mut total = 0;
    for i in 0..archive.len() {
        total += archive.by_index(i).map_err(|e| e.to_string())?.size();
    }
    let mut completed = 0;
    let mut buffer = [0u8; 256 * 1024];
    let mut last = std::time::Instant::now();
    notify(0, total);
    for i in 0..archive.len() {
        check_cancel(cancel)?;
        let mut f = archive.by_index(i).map_err(|e| e.to_string())?;
        if f.unix_mode().is_some_and(|m| m & 0o170000 == 0o120000) {
            return Err("Runtime archive contains a symbolic link.".into());
        }
        let enclosed = f
            .enclosed_name()
            .ok_or("Runtime archive contains an unsafe path.")?;
        let path = dest.join(enclosed);
        if f.is_dir() {
            std::fs::create_dir_all(path).map_err(|e| e.to_string())?;
        } else {
            if let Some(parent) = path.parent() {
                std::fs::create_dir_all(parent).map_err(|e| e.to_string())?
            }
            let mut out = std::fs::File::create(path).map_err(|e| e.to_string())?;
            use std::io::Write;
            loop {
                check_cancel(cancel)?;
                let count = f.read(&mut buffer).map_err(|e| e.to_string())?;
                if count == 0 {
                    break;
                }
                out.write_all(&buffer[..count]).map_err(|e| e.to_string())?;
                completed += count as u64;
                if last.elapsed().as_millis() >= 200 {
                    notify(completed, total);
                    last = std::time::Instant::now();
                }
            }
            out.sync_all().map_err(|e| e.to_string())?;
        }
    }
    notify(completed, total);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{io::Write, path::PathBuf, sync::Mutex};
    use tokio::{io::AsyncReadExt, net::TcpListener, task::JoinHandle};

    struct Fixture(PathBuf);
    impl Fixture {
        fn new() -> Self {
            let root =
                std::env::temp_dir().join(format!("cridvoice-download-{}", uuid::Uuid::new_v4()));
            std::fs::create_dir_all(&root).unwrap();
            Self(root)
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            // Every recursive test cleanup stays under this task's temp root.
            assert!(self.0.is_absolute() && self.0.starts_with(std::env::temp_dir()));
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }
    fn model(data: &[u8], name: &str, url: &str) -> Model {
        Model {
            id: "fixture".into(),
            name: "Fixture".into(),
            kind: "runtime".into(),
            description: String::new(),
            license: "test".into(),
            installed: false,
            size_bytes: data.len() as u64,
            files: vec![ModelFile {
                name: name.into(),
                url: url.into(),
                sha256: format!("{:x}", Sha256::digest(data)),
                bytes: data.len() as u64,
            }],
        }
    }
    fn notifications() -> (Notify, Arc<Mutex<Vec<Progress>>>) {
        let events = Arc::new(Mutex::new(Vec::new()));
        let captured = events.clone();
        (
            Arc::new(move |event| captured.lock().unwrap().push(event)),
            events,
        )
    }
    fn client() -> reqwest::Client {
        reqwest::Client::builder()
            .no_proxy()
            .timeout(std::time::Duration::from_secs(3))
            .build()
            .unwrap()
    }
    async fn server(body: Vec<u8>, range: Option<(usize, usize)>) -> (String, JoinHandle<String>) {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}/fixture", listener.local_addr().unwrap());
        let task = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut headers = Vec::new();
            let mut buffer = [0u8; 1024];
            while !headers.windows(4).any(|bytes| bytes == b"\r\n\r\n") {
                let count = socket.read(&mut buffer).await.unwrap();
                assert!(count > 0 && headers.len() < 8192);
                headers.extend_from_slice(&buffer[..count]);
            }
            let (status, content_range) = if let Some((start, total)) = range {
                (
                    "206 Partial Content",
                    format!(
                        "Content-Range: bytes {start}-{}/{total}\r\n",
                        start + body.len() - 1
                    ),
                )
            } else {
                ("200 OK", String::new())
            };
            socket.write_all(format!("HTTP/1.1 {status}\r\n{content_range}Content-Length: {}\r\nConnection: close\r\n\r\n", body.len()).as_bytes()).await.unwrap();
            socket.write_all(&body).await.unwrap();
            String::from_utf8(headers).unwrap().to_lowercase()
        });
        (url, task)
    }
    fn archive(name: &str, content: &[u8]) -> Vec<u8> {
        let mut zip = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
        zip.start_file(
            name,
            zip::write::SimpleFileOptions::default()
                .compression_method(zip::CompressionMethod::Stored),
        )
        .unwrap();
        zip.write_all(content).unwrap();
        zip.finish().unwrap().into_inner()
    }

    #[tokio::test]
    async fn resumed_download_appends_valid_range_then_verifies_before_installing() {
        let fixture = Fixture::new();
        let data = b"verified fixture model";
        std::fs::write(fixture.0.join("model.bin.part"), &data[..5]).unwrap();
        let (url, request) = server(data[5..].to_vec(), Some((5, data.len()))).await;
        let (notify, events) = notifications();
        install_model(
            &fixture.0,
            &model(data, "model.bin", &url),
            &Arc::new(AtomicBool::new(false)),
            &notify,
            &client(),
        )
        .await
        .unwrap();
        assert!(request.await.unwrap().contains("range: bytes=5-"));
        assert_eq!(std::fs::read(fixture.0.join("model.bin")).unwrap(), data);
        assert!(fixture.0.join(".installed").is_file());
        assert!(events
            .lock()
            .unwrap()
            .iter()
            .any(|event| event.state == "verifying"
                && event.stage_completed == Some(data.len() as u64)));
    }

    #[tokio::test]
    async fn server_ignoring_range_restarts_instead_of_duplicating_partial_prefix() {
        let fixture = Fixture::new();
        let data = b"complete fixture";
        std::fs::write(fixture.0.join("model.bin.part"), &data[..4]).unwrap();
        let (url, request) = server(data.to_vec(), None).await;
        let (notify, _) = notifications();
        install_model(
            &fixture.0,
            &model(data, "model.bin", &url),
            &Arc::new(AtomicBool::new(false)),
            &notify,
            &client(),
        )
        .await
        .unwrap();
        assert!(request.await.unwrap().contains("range: bytes=4-"));
        assert_eq!(std::fs::read(fixture.0.join("model.bin")).unwrap(), data);
    }

    #[tokio::test]
    async fn invalid_range_preserves_partial_bytes_and_never_marks_installed() {
        let fixture = Fixture::new();
        let data = b"valid fixture";
        let prefix = &data[..4];
        std::fs::write(fixture.0.join("model.bin.part"), prefix).unwrap();
        let (url, request) = server(data[4..].to_vec(), Some((5, data.len()))).await;
        let (notify, _) = notifications();
        let error = install_model(
            &fixture.0,
            &model(data, "model.bin", &url),
            &Arc::new(AtomicBool::new(false)),
            &notify,
            &client(),
        )
        .await
        .unwrap_err();
        request.await.unwrap();
        assert!(error.contains("invalid byte range"));
        assert_eq!(
            std::fs::read(fixture.0.join("model.bin.part")).unwrap(),
            prefix
        );
        assert!(!fixture.0.join(".installed").exists());
    }

    #[tokio::test]
    async fn checksum_failure_removes_bad_partial_and_stale_installed_marker() {
        let fixture = Fixture::new();
        let data = b"good";
        std::fs::write(fixture.0.join(".installed"), "stale").unwrap();
        let (url, request) = server(b"evil".to_vec(), None).await;
        let (notify, _) = notifications();
        let error = install_model(
            &fixture.0,
            &model(data, "model.bin", &url),
            &Arc::new(AtomicBool::new(false)),
            &notify,
            &client(),
        )
        .await
        .unwrap_err();
        request.await.unwrap();
        assert!(error.contains("checksum did not match"));
        assert!(!fixture.0.join("model.bin.part").exists());
        assert!(!fixture.0.join(".installed").exists());
    }

    #[tokio::test]
    async fn archive_install_exposes_verification_and_extraction_before_marker() {
        let fixture = Fixture::new();
        let content = b"fixture runtime";
        let data = archive("bin/runtime.dll", content);
        std::fs::write(fixture.0.join("runtime.zip"), &data).unwrap();
        std::fs::write(fixture.0.join(".installed"), "stale").unwrap();
        let root = fixture.0.clone();
        let events = Arc::new(Mutex::new(Vec::<Progress>::new()));
        let captured = events.clone();
        let notify: Notify = Arc::new(move |event| {
            assert!(!root.join(".installed").exists());
            captured.lock().unwrap().push(event);
        });
        install_model(
            &fixture.0,
            &model(&data, "runtime.zip", "http://127.0.0.1:1/unused"),
            &Arc::new(AtomicBool::new(false)),
            &notify,
            &client(),
        )
        .await
        .unwrap();
        assert_eq!(
            std::fs::read(fixture.0.join("bin/runtime.dll")).unwrap(),
            content
        );
        let events = events.lock().unwrap();
        assert!(events.iter().any(|event| event.state == "verifying"));
        assert!(events.iter().any(|event| event.state == "extracting"
            && event.stage_completed == Some(content.len() as u64)
            && event.stage_total == Some(content.len() as u64)));
        assert!(fixture.0.join(".installed").is_file());
    }

    #[tokio::test]
    async fn pausing_extraction_preserves_verified_archive_for_retry() {
        let fixture = Fixture::new();
        let data = archive("runtime.dll", b"fixture");
        std::fs::write(fixture.0.join("runtime.zip"), &data).unwrap();
        let cancel = Arc::new(AtomicBool::new(false));
        let requested = cancel.clone();
        let notify: Notify = Arc::new(move |event| {
            if event.state == "extracting" {
                requested.store(true, Ordering::Relaxed);
            }
        });
        let model = model(&data, "runtime.zip", "http://127.0.0.1:1/unused");
        assert!(
            install_model(&fixture.0, &model, &cancel, &notify, &client())
                .await
                .unwrap_err()
                .contains("paused")
        );
        assert_eq!(std::fs::read(fixture.0.join("runtime.zip")).unwrap(), data);
        assert!(!fixture.0.join(".installed").exists());
        cancel.store(false, Ordering::Relaxed);
        let (notify, _) = notifications();
        install_model(&fixture.0, &model, &cancel, &notify, &client())
            .await
            .unwrap();
        assert!(fixture.0.join(".installed").is_file());
    }

    #[tokio::test]
    async fn unsafe_archive_path_cannot_write_outside_model_or_mark_installed() {
        let fixture = Fixture::new();
        let escaped = format!("outside-{}.dll", uuid::Uuid::new_v4());
        let data = archive(&format!("../{escaped}"), b"fixture");
        std::fs::write(fixture.0.join("runtime.zip"), &data).unwrap();
        let (notify, _) = notifications();
        let error = install_model(
            &fixture.0,
            &model(&data, "runtime.zip", "http://127.0.0.1:1/unused"),
            &Arc::new(AtomicBool::new(false)),
            &notify,
            &client(),
        )
        .await
        .unwrap_err();
        assert!(error.contains("unsafe path"));
        assert!(!fixture.0.parent().unwrap().join(escaped).exists());
        assert!(!fixture.0.join(".installed").exists());
    }
}
