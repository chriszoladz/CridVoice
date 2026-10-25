//! The local assets required by the selected speech and cleanup routes.
use crate::config::Settings;
use serde::Deserialize;
use std::path::Path;

#[derive(Deserialize)]
struct Asset {
    id: String,
    name: String,
    kind: String,
}
fn assets() -> Vec<Asset> {
    serde_json::from_str(include_str!("../resources/model-catalog.json"))
        .expect("Invalid bundled model catalog")
}
pub fn required_local_assets(
    settings: &Settings,
    cuda_available: bool,
) -> Result<Vec<String>, String> {
    let catalog = assets();
    let mut required = Vec::new();
    let mut model = |id: &str, kind: &str| -> Result<(), String> {
        if !catalog
            .iter()
            .any(|asset| asset.id == id && asset.kind == kind)
        {
            return Err(format!("Select a supported {kind} model in Settings."));
        }
        required.push(id.to_string());
        Ok(())
    };
    if settings.transcription.mode == "local" {
        if settings.transcription.device == "cuda" && !cuda_available {
            return Err(
                "No NVIDIA GPU was detected. Select CPU or Automatic for speech recognition."
                    .into(),
            );
        }
        model(&settings.transcription.model_id, "speech")?;
        if settings.transcription.device == "cuda"
            || settings.transcription.device == "auto" && cuda_available
        {
            required.push("nvidia-runtime".into());
        }
        if settings.appearance.live_preview {
            required.push("whisper-preview".into());
        }
    }
    if settings.cleanup.mode == "managed" {
        // Explicit GPU cleanup uses Vulkan. It is not an NVIDIA-only gate.
        if !catalog
            .iter()
            .any(|asset| asset.id == settings.cleanup.model_id && asset.kind == "cleanup")
        {
            return Err("Select a supported cleanup model in Settings.".into());
        }
        required.push(settings.cleanup.model_id.clone());
        let gpu = settings.cleanup.device == "cuda"
            || settings.cleanup.device == "auto" && cuda_available;
        required.push(if gpu { "llama-gpu" } else { "llama-cpu" }.into());
    }
    Ok(required)
}
pub fn validate_readiness(
    settings: &Settings,
    root: &Path,
    cuda_available: bool,
) -> Result<(), String> {
    let required = required_local_assets(settings, cuda_available)?;
    let catalog = assets();
    let missing = required
        .iter()
        .filter(|id| !root.join("models").join(id).join(".installed").is_file())
        .map(|id| {
            catalog
                .iter()
                .find(|asset| asset.id == *id)
                .map(|asset| asset.name.as_str())
                .unwrap_or(id)
                .to_string()
        })
        .collect::<Vec<_>>();
    if !missing.is_empty() {
        return Err(format!(
            "Finish installing these selected models and runtimes: {}.",
            missing.join(", ")
        ));
    }
    if settings.transcription.mode == "openai"
        && !settings.providers.iter().any(|provider| {
            provider.id == settings.transcription.provider_id
                && provider.protocol == "openai"
                && !provider.stt_model.trim().is_empty()
        })
    {
        return Err("Select an audio-capable provider and its speech model in Settings.".into());
    }
    if settings.cleanup.mode == "provider"
        && !settings.providers.iter().any(|provider| {
            provider.id == settings.cleanup.provider_id && !provider.model.trim().is_empty()
        })
    {
        return Err("Select a text-cleanup provider and model in Settings.".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::Provider;

    #[test]
    fn local_device_matrix_includes_both_engines_and_runtimes() {
        let mut settings = Settings::default();
        assert_eq!(
            required_local_assets(&settings, true).unwrap(),
            [
                "whisper-turbo",
                "nvidia-runtime",
                "whisper-preview",
                "qwen3-4b",
                "llama-gpu"
            ]
        );
        assert_eq!(
            required_local_assets(&settings, false).unwrap(),
            ["whisper-turbo", "whisper-preview", "qwen3-4b", "llama-cpu"]
        );
        settings.transcription.device = "cpu".into();
        settings.transcription.model_id = "whisper-small".into();
        settings.cleanup.device = "cpu".into();
        assert_eq!(
            required_local_assets(&settings, true).unwrap(),
            ["whisper-small", "whisper-preview", "qwen3-4b", "llama-cpu"]
        );
        settings.cleanup.mode = "off".into();
        assert_eq!(
            required_local_assets(&settings, true).unwrap(),
            ["whisper-small", "whisper-preview"]
        );
        settings.cleanup.mode = "managed".into();
        settings.cleanup.device = "cuda".into();
        assert_eq!(
            required_local_assets(&settings, false).unwrap(),
            ["whisper-small", "whisper-preview", "qwen3-4b", "llama-gpu"]
        );
    }

    #[test]
    fn external_audio_ignores_saved_local_cuda_and_requires_no_speech_assets() {
        let mut settings = Settings::default();
        settings.transcription.mode = "openai".into();
        settings.transcription.device = "cuda".into();
        settings.cleanup.mode = "provider".into();
        assert!(required_local_assets(&settings, false).unwrap().is_empty());
        settings.cleanup.mode = "managed".into();
        assert_eq!(
            required_local_assets(&settings, false).unwrap(),
            ["qwen3-4b", "llama-cpu"]
        );
        settings.transcription.mode = "local".into();
        assert!(required_local_assets(&settings, false).is_err());
    }

    #[test]
    fn missing_cleanup_runtime_prevents_readiness_until_entire_plan_is_installed() {
        let root = std::env::temp_dir().join(uuid::Uuid::new_v4().to_string());
        let settings = Settings::default();
        for id in [
            "whisper-turbo",
            "nvidia-runtime",
            "whisper-preview",
            "qwen3-4b",
        ] {
            let model = root.join("models").join(id);
            std::fs::create_dir_all(&model).unwrap();
            std::fs::write(model.join(".installed"), "{}").unwrap();
        }
        assert!(validate_readiness(&settings, &root, true)
            .unwrap_err()
            .contains("llama.cpp"));
        let runtime = root.join("models/llama-gpu");
        std::fs::create_dir_all(&runtime).unwrap();
        std::fs::write(runtime.join(".installed"), "{}").unwrap();
        assert!(validate_readiness(&settings, &root, true).is_ok());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn external_setup_requires_configured_provider_models_without_local_files() {
        let root = std::env::temp_dir().join(uuid::Uuid::new_v4().to_string());
        let mut settings = Settings::default();
        settings.transcription.mode = "openai".into();
        settings.cleanup.mode = "provider".into();
        settings.transcription.provider_id = "external".into();
        settings.cleanup.provider_id = "external".into();
        assert!(validate_readiness(&settings, &root, false).is_err());
        settings.providers.push(Provider {
            id: "external".into(),
            name: "Test".into(),
            protocol: "openai".into(),
            base_url: "http://127.0.0.1:1234/v1".into(),
            model: "text".into(),
            stt_model: "speech".into(),
            has_key: false,
        });
        assert!(validate_readiness(&settings, &root, false).is_ok());
    }

    #[test]
    fn preview_is_required_only_for_enabled_local_preview() {
        let mut settings = Settings::default();
        assert!(required_local_assets(&settings, true)
            .unwrap()
            .contains(&"whisper-preview".into()));
        settings.appearance.live_preview = false;
        assert!(!required_local_assets(&settings, true)
            .unwrap()
            .contains(&"whisper-preview".into()));
        settings.appearance.live_preview = true;
        settings.transcription.mode = "openai".into();
        assert!(!required_local_assets(&settings, true)
            .unwrap()
            .contains(&"whisper-preview".into()));
        settings.transcription.mode = "local".into();
        settings.transcription.model_id = "whisper-preview".into();
        assert!(required_local_assets(&settings, true).is_err());
    }
}
