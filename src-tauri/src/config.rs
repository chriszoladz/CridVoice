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
    pub insertion_method: String,
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
            insertion_method: "clipboard".into(),
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
