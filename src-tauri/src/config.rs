use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub setup_complete: bool,
    pub transcription: Transcription,
    pub cleanup: Cleanup,
    pub providers: Vec<Provider>,
    pub vocabulary: Vec<Vocabulary>,
    pub app_rules: Vec<AppRule>,
    pub appearance: Appearance,
    pub shortcuts: Shortcuts,
    pub general: General,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Transcription {
    pub mode: String,
    pub model_id: String,
    pub device: String,
    pub language: String,
    pub provider_id: String,
}
impl Default for Transcription {
    fn default() -> Self {
        Self {
            mode: "local".into(),
            model_id: "whisper-turbo".into(),
            device: "auto".into(),
            language: "auto".into(),
            provider_id: String::new(),
        }
    }
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Cleanup {
    pub mode: String,
    pub model_id: String,
    pub device: String,
    pub provider_id: String,
    pub style: String,
    pub rewrite_strength: String,
    pub output_mode: String,
    pub code_language: String,
}
impl Default for Cleanup {
    fn default() -> Self {
        Self {
            mode: "managed".into(),
            model_id: "qwen3-4b".into(),
            device: "auto".into(),
            provider_id: String::new(),
            style: "faithful".into(),
            rewrite_strength: "balanced".into(),
            output_mode: "text".into(),
            code_language: String::new(),
        }
    }
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Provider {
    pub id: String,
    pub name: String,
    pub protocol: String,
    pub base_url: String,
    pub model: String,
    pub stt_model: String,
    #[serde(default)]
    pub has_key: bool,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Vocabulary {
    pub word: String,
    pub aliases: Vec<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppRule {
    pub app: String,
    pub style: String,
    pub custom_prompt: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Appearance {
    pub theme: String,
    pub mode: String,
    pub accent: String,
    pub font_scale: f64,
    pub overlay_visible: bool,
    pub waveform: bool,
    pub live_preview: bool,
}
impl Default for Appearance {
    fn default() -> Self {
        Self {
            theme: "violet".into(),
            mode: "dark".into(),
            accent: "#a78bfa".into(),
            font_scale: 1.,
            overlay_visible: true,
            waveform: true,
            live_preview: true,
        }
    }
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct Shortcuts {
    pub hold: String,
    pub toggle: String,
    pub rewrite: String,
}
impl Default for Shortcuts {
    fn default() -> Self {
        Self {
            hold: "Ctrl+Super".into(),
            toggle: "Ctrl+Shift+Space".into(),
            rewrite: "Ctrl+Alt+R".into(),
        }
    }
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct General {
    pub duck_background_audio: bool,
    pub ducking_reduction_percent: u32,
    pub insertion_method: String,
    pub copy_dictation_to_clipboard: bool,
    pub startup: bool,
    pub save_history: bool,
    pub context: bool,
    pub microphone: String,
    pub max_recording_seconds: u32,
    pub history_days: u32,
}
impl Default for General {
    fn default() -> Self {
        Self {
            duck_background_audio: false,
            ducking_reduction_percent: 60,
            insertion_method: "clipboard".into(),
            copy_dictation_to_clipboard: false,
            startup: false,
            save_history: true,
            context: true,
            microphone: String::new(),
            max_recording_seconds: 300,
            history_days: 0,
        }
    }
}

impl Settings {
    pub fn validate(&self) -> Result<(), String> {
        fn one(value: &str, allowed: &[&str], label: &str) -> Result<(), String> {
            if allowed.contains(&value) {
                Ok(())
            } else {
                Err(format!("Unsupported {label}: {value}"))
            }
        }
        one(
            &self.transcription.mode,
            &["local", "openai"],
            "transcription mode",
        )?;
        one(
            &self.cleanup.mode,
            &["managed", "provider", "off"],
            "cleanup mode",
        )?;
        one(
            &self.cleanup.output_mode,
            &["text", "code", "generate"],
            "output mode",
        )?;
        if self.cleanup.output_mode != "text" && self.cleanup.mode == "off" {
            return Err("Enable text cleanup to use code dictation or code generation.".into());
        }
        if self.cleanup.code_language.chars().count() > 80
            || self
                .cleanup
                .code_language
                .chars()
                .any(|c| c.is_control() || matches!(c, '\u{2028}' | '\u{2029}'))
        {
            return Err(
                "Use a single-line language or shell override of up to 80 characters.".into(),
            );
        }
        one(
            &self.general.insertion_method,
            &["clipboard", "unicode"],
            "insertion method",
        )?;
        if !(10..=90).contains(&self.general.ducking_reduction_percent) {
            return Err("Background audio reduction must be between 10% and 90%.".into());
        }
        for device in [&self.transcription.device, &self.cleanup.device] {
            one(device, &["auto", "cpu", "cuda"], "device")?;
        }
        one(
            &self.transcription.language,
            &["auto", "en", "pl"],
            "language",
        )?;
        one(
            &self.appearance.mode,
            &["light", "dark", "system"],
            "theme mode",
        )?;
        if !(0.85..=1.4).contains(&self.appearance.font_scale) {
            return Err("Text size must be between 85% and 140%.".into());
        }
        let a = &self.appearance.accent;
        if a.len() != 7 || !a.starts_with('#') || !a[1..].bytes().all(|c| c.is_ascii_hexdigit()) {
            return Err("Accent must be a six-digit hex color.".into());
        }
        if !(10..=1800).contains(&self.general.max_recording_seconds) {
            return Err("Recording limit must be 10–1800 seconds.".into());
        }
        let hold = crate::core::parse_shortcut(&self.shortcuts.hold)?;
        let toggle = crate::core::parse_shortcut(&self.shortcuts.toggle)?;
        let rewrite = crate::core::parse_shortcut(&self.shortcuts.rewrite)?;
        if hold == toggle || hold == rewrite || toggle == rewrite {
            return Err("Shortcuts must be different.".into());
        }
        if hold.key.is_none()
            && [&toggle, &rewrite].iter().any(|s| {
                s.ctrl == hold.ctrl
                    && s.alt == hold.alt
                    && s.shift == hold.shift
                    && s.super_key == hold.super_key
            })
        {
            return Err(
                "Toggle/rewrite modifiers cannot overlap the modifier-only hold shortcut.".into(),
            );
        }
        one(
            &self.cleanup.style,
            &["faithful", "professional", "casual", "concise", "code"],
            "writing style",
        )?;
        one(
            &self.cleanup.rewrite_strength,
            &["light", "balanced", "thorough"],
            "editing amount",
        )?;
        for rule in &self.app_rules {
            if rule.app.trim().is_empty() {
                return Err("Application rules need a nonempty executable name.".into());
            }
            one(
                &rule.style,
                &["faithful", "professional", "casual", "concise", "code"],
                "application writing style",
            )?;
        }
        let mut ids = std::collections::HashSet::new();
        for p in &self.providers {
            if p.id.is_empty() || !ids.insert(&p.id) {
                return Err("Provider identifiers must be unique.".into());
            }
            one(&p.protocol, &["openai", "anthropic"], "provider protocol")?;
            crate::core::endpoint(&p.base_url, "models")?;
        }
        for v in &self.vocabulary {
            if v.word.trim().is_empty() || v.word.len() > 256 {
                return Err("Vocabulary words must contain 1–256 characters.".into());
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod clipboard_setting_tests {
    use super::*;

    #[test]
    fn older_settings_keep_clipboard_copy_off_without_resetting_preferences() {
        let mut saved = serde_json::to_value(Settings::default()).unwrap();
        saved["general"]
            .as_object_mut()
            .unwrap()
            .remove("copyDictationToClipboard");
        saved["general"]["insertionMethod"] = "unicode".into();
        saved["general"]["saveHistory"] = false.into();
        let loaded: Settings = serde_json::from_value(saved).unwrap();
        assert!(!loaded.general.copy_dictation_to_clipboard);
        assert_eq!(loaded.general.insertion_method, "unicode");
        assert!(!loaded.general.save_history);
        assert!(loaded.validate().is_ok());
    }

    #[test]
    fn clipboard_copy_persists_for_both_insertion_methods() {
        for method in ["clipboard", "unicode"] {
            let mut settings = Settings::default();
            settings.general.insertion_method = method.into();
            settings.general.copy_dictation_to_clipboard = true;
            let saved = serde_json::to_value(&settings).unwrap();
            assert_eq!(saved["general"]["copyDictationToClipboard"], true);
            let loaded: Settings = serde_json::from_value(saved).unwrap();
            assert!(loaded.general.copy_dictation_to_clipboard);
            assert_eq!(loaded.general.insertion_method, method);
            assert!(loaded.validate().is_ok());
        }
    }
}

#[cfg(test)]
mod rewrite_strength_tests {
    use super::*;

    #[test]
    fn older_cleanup_settings_default_to_balanced_without_resetting_style_or_output() {
        let mut saved = serde_json::to_value(Settings::default()).unwrap();
        saved["cleanup"]
            .as_object_mut()
            .unwrap()
            .remove("rewriteStrength");
        saved["cleanup"]["style"] = "casual".into();
        saved["cleanup"]["outputMode"] = "code".into();
        saved["cleanup"]["codeLanguage"] = "PowerShell".into();
        let loaded: Settings = serde_json::from_value(saved).unwrap();
        assert_eq!(loaded.cleanup.rewrite_strength, "balanced");
        assert_eq!(loaded.cleanup.style, "casual");
        assert_eq!(loaded.cleanup.output_mode, "code");
        assert_eq!(loaded.cleanup.code_language, "PowerShell");
        assert!(loaded.validate().is_ok());
    }

    #[test]
    fn editing_amount_round_trips_and_rejects_unknown_values() {
        for strength in ["light", "balanced", "thorough"] {
            let mut settings = Settings::default();
            settings.cleanup.rewrite_strength = strength.into();
            let saved = serde_json::to_value(&settings).unwrap();
            assert_eq!(saved["cleanup"]["rewriteStrength"], strength);
            let loaded: Settings = serde_json::from_value(saved).unwrap();
            assert_eq!(loaded.cleanup.rewrite_strength, strength);
            assert!(loaded.validate().is_ok());
        }
        for strength in ["", "maximum", "Balanced", "ignore previous rules"] {
            let mut settings = Settings::default();
            settings.cleanup.rewrite_strength = strength.into();
            assert!(settings.validate().unwrap_err().contains("editing amount"));
        }
    }
}
