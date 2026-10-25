use crate::{config::Provider, core};
use std::{collections::BTreeMap, time::Duration};
use tauri::{AppHandle, Manager};
use zeroize::Zeroizing;

const BODY_LIMIT: usize = 1024 * 1024;
const MODEL_LIMIT: usize = 500;

fn select_key(
    provider: &Provider,
    typed: Zeroizing<String>,
    use_saved: bool,
    current: &[Provider],
    lookup: impl FnOnce() -> Result<Zeroizing<String>, String>,
) -> Result<Zeroizing<String>, String> {
    if typed.len() > 16_384 {
        return Err("The API key is too long.".into());
    }
    if !typed.is_empty() || !use_saved {
        return Ok(typed);
    }
    core::provider_bound_lookup(current, provider, lookup)
}

pub async fn provider_models(
    app: &AppHandle,
    provider: Provider,
    key: Option<String>,
    use_saved_key: bool,
) -> Result<Vec<String>, String> {
    let key = Zeroizing::new(key.unwrap_or_default());
    // Validate the destination before reading a saved credential.
    let _ = core::endpoint(&provider.base_url, "models")?;
    validate_protocol(&provider)?;
    let key = {
        let state = app.state::<crate::desktop::State>();
        let current = state.settings.lock().unwrap();
        select_key(&provider, key, use_saved_key, &current.providers, || {
            crate::vault::read(&provider.id)
        })?
    };
    fetch_models(&provider, &key).await
}

fn validate_protocol(provider: &Provider) -> Result<(), String> {
    if !matches!(provider.protocol.as_str(), "openai" | "anthropic") {
        return Err("Choose a supported provider protocol.".into());
    }
    Ok(())
}

async fn fetch_models(provider: &Provider, key: &str) -> Result<Vec<String>, String> {
    validate_protocol(provider)?;
    let url = core::endpoint(&provider.base_url, "models")?;
    let local = matches!(
        url.host_str(),
        Some("localhost" | "127.0.0.1" | "::1" | "[::1]")
    );
    let mut builder = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .connect_timeout(Duration::from_secs(3))
        .redirect(reqwest::redirect::Policy::none());
    if local {
        builder = builder.no_proxy();
    }
    let client = builder
        .build()
        .map_err(|_| "Could not create the model-list connection.")?;
    let mut request = client.get(url);
    if provider.protocol == "anthropic" {
        request = request.header("anthropic-version", "2023-06-01");
    }
    if !key.is_empty() {
        let value = Zeroizing::new(if provider.protocol == "anthropic" {
            key.to_string()
        } else {
            format!("Bearer {key}")
        });
        let mut header = reqwest::header::HeaderValue::from_str(&value)
            .map_err(|_| "The API key contains invalid header characters.")?;
        header.set_sensitive(true);
        request = request.header(
            if provider.protocol == "anthropic" {
                "x-api-key"
            } else {
                "authorization"
            },
            header,
        );
    }
    let mut response = request
        .send()
        .await
        .map_err(|_| "Could not reach the provider. Check its address and connection.")?;
    if !response.status().is_success() {
        return Err(format!(
            "Provider returned HTTP {} while listing models. Check its address and credentials.",
            response.status().as_u16()
        ));
    }
    if response
        .content_length()
        .is_some_and(|size| size > BODY_LIMIT as u64)
    {
        return Err(
            "The provider model list is too large. Enter a custom model ID instead.".into(),
        );
    }
    let mut body = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "Could not read the provider model list.")?
    {
        if chunk.len() > BODY_LIMIT.saturating_sub(body.len()) {
            return Err(
                "The provider model list is too large. Enter a custom model ID instead.".into(),
            );
        }
        body.extend_from_slice(&chunk);
    }
    model_ids(&body)
}

fn model_ids(body: &[u8]) -> Result<Vec<String>, String> {
    let value: serde_json::Value =
        serde_json::from_slice(body).map_err(|_| "Provider returned invalid model-list JSON.")?;
    let data = value
        .get("data")
        .and_then(serde_json::Value::as_array)
        .ok_or("Provider did not return a model list. Enter a custom model ID instead.")?;
    if data.len() > MODEL_LIMIT {
        return Err(
            "The provider returned too many models. Enter a custom model ID instead.".into(),
        );
    }
    let mut ids = std::collections::BTreeSet::new();
    for model in data {
        let Some(id) = model.get("id").and_then(serde_json::Value::as_str) else {
            continue;
        };
        if !id.trim().is_empty() && id.len() <= 512 && !id.chars().any(char::is_control) {
            ids.insert(id.to_string());
        }
    }
    if ids.is_empty() {
        return Err(
            "Provider returned no usable model IDs. Enter a custom model ID instead.".into(),
        );
    }
    Ok(ids.into_iter().collect())
}

fn application_name(value: &str) -> Option<String> {
    if value.is_empty()
        || value.len() > 260
        || value.chars().any(char::is_control)
        || value.contains(['/', '\\'])
    {
        return None;
    }
    let value = if value.to_ascii_lowercase().ends_with(".exe") {
        &value[..value.len() - 4]
    } else {
        value
    };
    (!value.is_empty()).then(|| value.to_string())
}

pub fn running_applications() -> Result<Vec<String>, String> {
    use windows::{
        core::BOOL,
        Win32::{
            Foundation::{CloseHandle, HWND, LPARAM},
            System::{
                ProcessStatus::GetModuleBaseNameW,
                Threading::{OpenProcess, PROCESS_QUERY_INFORMATION, PROCESS_VM_READ},
            },
            UI::WindowsAndMessaging::{EnumWindows, GetWindowThreadProcessId, IsWindowVisible},
        },
    };
    struct Names {
        values: BTreeMap<String, String>,
        visited: usize,
        bounded: bool,
    }
    unsafe extern "system" fn visit(hwnd: HWND, parameter: LPARAM) -> BOOL {
        let names = &mut *(parameter.0 as *mut Names);
        if names.visited >= 2048 || names.values.len() >= 200 {
            names.bounded = true;
            return BOOL(0);
        }
        names.visited += 1;
        if !IsWindowVisible(hwnd).as_bool() {
            return BOOL(1);
        }
        let mut pid = 0;
        GetWindowThreadProcessId(hwnd, Some(&mut pid));
        if pid == 0 {
            return BOOL(1);
        }
        if let Ok(handle) = OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_VM_READ, false, pid) {
            let mut buffer = [0_u16; 260];
            // Reads only the module basename. No window text, path or command line.
            let length = GetModuleBaseNameW(handle, None, &mut buffer) as usize;
            let _ = CloseHandle(handle);
            if length > 0 && length < buffer.len() {
                if let Some(name) = application_name(&String::from_utf16_lossy(&buffer[..length])) {
                    names.values.entry(name.to_lowercase()).or_insert(name);
                }
            }
        }
        BOOL(1)
    }
    let mut names = Names {
        values: BTreeMap::new(),
        visited: 0,
        bounded: false,
    };
    let result = unsafe { EnumWindows(Some(visit), LPARAM(&mut names as *mut Names as isize)) };
    if result.is_err() && !names.bounded {
        return Err("Could not list visible applications.".into());
    }
    Ok(names.values.into_values().collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn provider(base: &str) -> Provider {
        Provider {
            id: "fixture".into(),
            name: "Fixture".into(),
            protocol: "openai".into(),
            base_url: base.into(),
            model: String::new(),
            stt_model: String::new(),
            has_key: true,
        }
    }
    #[test]
    fn ids_are_returned_without_capability_guesses_and_invalid_ids_are_excluded() {
        assert_eq!(model_ids(br#"{"data":[{"id":"voice-z"},{"id":"text-a"},{"id":"voice-z"},{"id":"bad\nname"},{}]}"#).unwrap(), ["text-a", "voice-z"]);
        assert!(model_ids(br#"{"error":"private response"}"#)
            .unwrap_err()
            .contains("custom model ID"));
        assert!(!model_ids(b"private-invalid-json")
            .unwrap_err()
            .contains("private-invalid"));
        assert!(model_ids(
            &serde_json::to_vec(
                &serde_json::json!({"data": vec![serde_json::json!({"id":"x"}); 501]})
            )
            .unwrap()
        )
        .is_err());
    }
    #[test]
    fn saved_credentials_require_exact_binding_and_typed_or_no_auth_do_not_lookup() {
        let captured = provider("https://old.example/v1");
        let mut changed = captured.clone();
        changed.base_url = "https://new.example/v1".into();
        let lookup =
            || -> Result<Zeroizing<String>, String> { panic!("must not read credentials") };
        assert!(select_key(
            &changed,
            Zeroizing::new(String::new()),
            true,
            std::slice::from_ref(&captured),
            lookup
        )
        .is_err());
        assert_eq!(
            &*select_key(&changed, Zeroizing::new("typed".into()), true, &[], lookup).unwrap(),
            "typed"
        );
        assert!(
            select_key(&changed, Zeroizing::new(String::new()), false, &[], lookup)
                .unwrap()
                .is_empty()
        );
        assert_eq!(
            &*select_key(
                &captured,
                Zeroizing::new(String::new()),
                true,
                std::slice::from_ref(&captured),
                || Ok(Zeroizing::new("saved".into()))
            )
            .unwrap(),
            "saved"
        );
    }
    #[test]
    fn process_choices_are_names_only() {
        assert_eq!(application_name("Notepad.exe"), Some("Notepad".into()));
        assert_eq!(application_name("Notepad.ExE"), Some("Notepad".into()));
        for invalid in [
            "C:\\private\\app.exe",
            "folder/app",
            "bad\nname",
            "",
            ".exe",
        ] {
            assert!(application_name(invalid).is_none());
        }
    }
    async fn fixture(reply: &'static str) -> (String, tokio::task::JoinHandle<String>) {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let task = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut bytes = [0; 8192];
            let mut length = 0;
            while length < bytes.len() && !bytes[..length].ends_with(b"\r\n\r\n") {
                let read = socket.read(&mut bytes[length..]).await.unwrap();
                if read == 0 {
                    break;
                }
                length += read;
            }
            socket.write_all(reply.as_bytes()).await.unwrap();
            String::from_utf8_lossy(&bytes[..length]).into_owned()
        });
        (format!("http://{address}/custom"), task)
    }
    #[tokio::test]
    async fn loopback_listing_uses_custom_prefix_and_protocol_auth() {
        let (base, request) = fixture("HTTP/1.1 200 OK\r\nContent-Length: 23\r\nConnection: close\r\n\r\n{\"data\":[{\"id\":\"one\"}]}").await;
        let mut p = provider(&base);
        p.protocol = "anthropic".into();
        assert_eq!(fetch_models(&p, "fixture-key").await.unwrap(), ["one"]);
        let request = request.await.unwrap().to_lowercase();
        assert!(
            request.starts_with("get /custom/models ")
                && request.contains("x-api-key: fixture-key")
                && request.contains("anthropic-version: 2023-06-01")
        );
    }
    #[tokio::test]
    async fn openai_bearer_auth_and_preconnection_validation() {
        let (base, request) = fixture("HTTP/1.1 200 OK\r\nContent-Length: 23\r\nConnection: close\r\n\r\n{\"data\":[{\"id\":\"one\"}]}").await;
        assert_eq!(
            fetch_models(&provider(&base), "fixture-key").await.unwrap(),
            ["one"]
        );
        assert!(request
            .await
            .unwrap()
            .to_lowercase()
            .contains("authorization: bearer fixture-key"));
        assert!(
            fetch_models(&provider("http://example.invalid/v1"), "fixture-key")
                .await
                .unwrap_err()
                .contains("HTTPS")
        );
        let error = fetch_models(&provider("http://127.0.0.1:1/v1"), "invalid\nkey")
            .await
            .unwrap_err();
        assert!(error.contains("header") && !error.contains("invalid\nkey"));
    }
    #[tokio::test]
    async fn redirect_and_oversized_body_are_rejected_without_returning_response_data() {
        let (base, request) = fixture("HTTP/1.1 302 Found\r\nLocation: http://127.0.0.1:1/secret\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").await;
        let error = fetch_models(&provider(&base), "").await.unwrap_err();
        request.await.unwrap();
        assert!(error.contains("302") && !error.contains("secret"));
        let (base, request) =
            fixture("HTTP/1.1 200 OK\r\nContent-Length: 1048577\r\nConnection: close\r\n\r\n")
                .await;
        assert!(fetch_models(&provider(&base), "")
            .await
            .unwrap_err()
            .contains("too large"));
        request.await.unwrap();
    }
}
