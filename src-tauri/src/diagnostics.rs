//! Child output is consumed, never logged or retained. Only fixed categories survive.
use std::{
    process::ExitStatus,
    sync::{Arc, Mutex},
    time::Duration,
};
use tokio::{
    io::{AsyncRead, AsyncReadExt},
    task::JoinHandle,
};

const HINTS: [&str; 8] = [
    "NVIDIA speech libraries could not load; check the speech runtime or select CPU.",
    "GPU memory is unavailable; close other GPU workloads or select a smaller model/CPU.",
    "The graphics backend failed; update the graphics driver or select CPU.",
    "The local model could not load; check its download in Models.",
    "A speech dependency could not load; restore the complete packaged Python runtime.",
    "Child-process access was denied; check folder permissions.",
    "The local server could not bind its port; retry startup.",
    "The speech worker rejected an invalid request.",
];
const SIGNATURES: &[(&[u8], usize)] = &[
    (b"cublas", 0),
    (b"cudnn", 0),
    (b"cudart", 0),
    (b"cridvoice-diagnostic: nvidia_runtime", 0),
    (b"out of memory", 1),
    (b"cuda_error_out_of_memory", 1),
    (b"error_out_of_device_memory", 1),
    (b"cridvoice-diagnostic: gpu_memory", 1),
    (b"vulkan error", 2),
    (b"failed to initialize vulkan", 2),
    (b"cridvoice-diagnostic: graphics_backend", 2),
    (b"failed to load model", 3),
    (b"error loading model", 3),
    (b"modulenotfounderror", 4),
    (b"importerror", 4),
    (b"dll load failed", 4),
    (b"cridvoice-diagnostic: python_dependency", 4),
    (b"permission denied", 5),
    (b"access is denied", 5),
    (b"cridvoice-diagnostic: permission", 5),
    (b"address already in use", 6),
    (b"failed to bind", 6),
    (b"cridvoice-diagnostic: invalid_request", 7),
];

#[derive(Default)]
struct Summary {
    categories: [bool; HINTS.len()],
    read_failed: bool,
}

/// Matching state contains signature positions, never a copy of child text.
struct Classifier {
    positions: [usize; SIGNATURES.len()],
}
impl Classifier {
    fn new() -> Self {
        Self {
            positions: [0; SIGNATURES.len()],
        }
    }
    fn ingest(&mut self, bytes: &[u8], categories: &mut [bool; HINTS.len()]) {
        for byte in bytes {
            let byte = byte.to_ascii_lowercase();
            for (index, &(pattern, category)) in SIGNATURES.iter().enumerate() {
                if categories[category] {
                    continue;
                }
                let mut position = self.positions[index];
                while position > 0 && pattern[position] != byte {
                    // Recover the longest prefix that is also a suffix of the
                    // already matched signature, without retaining input bytes.
                    position = (1..position)
                        .rev()
                        .find(|&length| pattern[..length] == pattern[position - length..position])
                        .unwrap_or(0);
                }
                if pattern[position] == byte {
                    position += 1;
                }
                if position == pattern.len() {
                    categories[category] = true;
                    position = 0;
                }
                self.positions[index] = position;
            }
        }
    }
}

pub(crate) struct ChildDiagnostics {
    summary: Arc<Mutex<Summary>>,
    drains: [Option<JoinHandle<()>>; 2],
}
impl ChildDiagnostics {
    pub(crate) fn new() -> Self {
        Self {
            summary: Arc::new(Mutex::new(Summary::default())),
            drains: [None, None],
        }
    }
    pub(crate) fn capture<R: AsyncRead + Unpin + Send + 'static>(
        &mut self,
        mut reader: R,
    ) -> Result<(), &'static str> {
        let slot = self
            .drains
            .iter_mut()
            .find(|slot| slot.is_none())
            .ok_or("Child diagnostic stream limit exceeded.")?;
        let summary = Arc::clone(&self.summary);
        *slot = Some(tokio::spawn(async move {
            // Always drain to EOF, including arbitrarily long lines. Stopping at
            // an output limit could block the child. Memory stays fixed at 4 KiB.
            let mut buffer = [0u8; 4096];
            let mut classifier = Classifier::new();
            loop {
                match reader.read(&mut buffer).await {
                    Ok(0) => break,
                    Ok(length) => {
                        if let Ok(mut summary) = summary.lock() {
                            classifier.ingest(&buffer[..length], &mut summary.categories);
                        }
                        buffer[..length].fill(0);
                    }
                    Err(_) => {
                        if let Ok(mut summary) = summary.lock() {
                            summary.read_failed = true;
                        }
                        break;
                    }
                }
            }
        }));
        Ok(())
    }
    /// Let concurrent drains consume the final output after exit or termination.
    pub(crate) async fn settle(&mut self) {
        let _ = tokio::time::timeout(Duration::from_millis(200), async {
            for task in self.drains.iter_mut().flatten() {
                let _ = task.await;
            }
        })
        .await;
    }
    pub(crate) fn describe(&self, message: &str, exit: Option<&ExitStatus>) -> String {
        let mut result = message.to_string();
        if let Some(code) = exit.and_then(ExitStatus::code) {
            if code < 0 {
                result.push_str(&format!(" Exit code: 0x{:08X} ({code}).", code as u32));
            } else {
                result.push_str(&format!(" Exit code: {code}."));
            }
            match code as u32 {
                0xc0000135 | 0xc000007b | 0xc0000142 => result.push_str(
                    " A Windows runtime library is missing, incompatible, or could not initialize.",
                ),
                0xc0000005 => {
                    result.push_str(" The child process encountered a Windows memory-access fault.")
                }
                _ => (),
            }
        }
        if let Ok(summary) = self.summary.lock() {
            for (index, seen) in summary.categories.iter().enumerate() {
                if *seen {
                    result.push(' ');
                    result.push_str(HINTS[index]);
                }
            }
            if summary.read_failed {
                result.push_str(" Child diagnostic output could not be read.");
            }
        }
        result
    }
}
impl Drop for ChildDiagnostics {
    fn drop(&mut self) {
        for task in self.drains.iter().flatten() {
            task.abort();
        }
    }
}

pub(crate) fn spawn_error(message: &str, error: &std::io::Error) -> String {
    match error.raw_os_error() {
        Some(code) => format!("{message} Windows error code: {code}."),
        None => message.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::AsyncWriteExt;

    #[test]
    fn categories_handle_split_signatures_and_never_echo_sensitive_output() {
        let mut classifier = Classifier::new();
        let mut categories = [false; HINTS.len()];
        classifier.ingest(
            b"--api-key PRIVATE_KEY transcript PRIVATE_TEXT out of mem",
            &mut categories,
        );
        classifier.ingest(b"ory\nImportError: PRIVATE_PATH", &mut categories);
        let diagnostics = ChildDiagnostics::new();
        diagnostics.summary.lock().unwrap().categories = categories;
        let message = diagnostics.describe("Engine stopped.", None);
        assert!(message.contains("GPU memory"));
        assert!(message.contains("speech dependency"));
        assert!(!message.contains("PRIVATE_"));
        assert!(!message.contains("--api-key"));
    }

    #[tokio::test]
    async fn both_streams_drain_without_line_or_total_output_limits_blocking_child() {
        let mut diagnostics = ChildDiagnostics::new();
        let (mut first_writer, first_reader) = tokio::io::duplex(128);
        let (mut second_writer, second_reader) = tokio::io::duplex(128);
        diagnostics.capture(first_reader).unwrap();
        diagnostics.capture(second_reader).unwrap();
        let first = tokio::spawn(async move {
            for _ in 0..256 {
                first_writer.write_all(&[b'x'; 4096]).await.unwrap();
            }
            first_writer
                .write_all(b"failed to load model PRIVATE_PROMPT")
                .await
                .unwrap();
        });
        let second = tokio::spawn(async move {
            for _ in 0..256 {
                second_writer.write_all(&[b'y'; 4096]).await.unwrap();
            }
            second_writer.write_all(b"cudnn PRIVATE_KEY").await.unwrap();
        });
        tokio::time::timeout(Duration::from_secs(10), async {
            first.await.unwrap();
            second.await.unwrap();
            diagnostics.settle().await;
        })
        .await
        .expect("captured child streams must keep draining concurrently");
        let message = diagnostics.describe("Engine stopped.", None);
        assert!(message.contains("NVIDIA speech libraries"));
        assert!(message.contains("model could not load"));
        assert!(!message.contains("PRIVATE_"));
    }
}
