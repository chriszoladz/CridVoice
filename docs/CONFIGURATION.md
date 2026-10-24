# Configuration reference

Settings are serialized as camelCase JSON. Edit through the app; stop it before manual file edits. API key values are not part of this file. Model names refer to IDs in the bundled catalog.

| Key | Default | Meaning |
| --- | --- | --- |
| `setupComplete` | `false` | Wizard finished after the selected local component plan and provider configuration passed readiness checks |
| `transcription.mode` | `local` | `local` or selected `openai` audio endpoint |
| `transcription.modelId` | `whisper-turbo` | App-managed speech model |
| `transcription.device` | `auto` | `auto`, `cuda` (NVIDIA GPU), or `cpu` |
| `transcription.language` | `auto` | Automatic, `en`, or `pl` |
| `transcription.providerId` | empty | Connection UUID for selected audio API |
| `cleanup.mode` | `managed` | Managed local model, selected `provider`, or `off` |
| `cleanup.modelId` | `qwen3-4b` | App-managed cleanup model |
| `cleanup.device` | `auto` | Auto, GPU, or CPU; managed GPU text uses Vulkan |
| `cleanup.providerId` | empty | Selected text connection UUID |
| `cleanup.style` | `faithful` | Faithful, professional, casual, concise, or code |
| `cleanup.outputMode` | `text` | `text` for prose, `code` for literal code/CLI dictation, or `generate` for code from spoken instructions |
| `cleanup.codeLanguage` | empty / Auto | Optional freeform language/shell override; at most 80 characters on one line |
| `providers` | `[]` | Connection records; see below |
| `vocabulary` | `[]` | Correct spellings and aliases |
| `appRules` | `[]` | Executable-name matching, style, and optional guidance |
| `appearance.theme` | `violet` | Preset identifier |
| `appearance.mode` | `dark` | Light, dark, or system |
| `appearance.accent` | `#a78bfa` | Six-digit hexadecimal accent |
| `appearance.fontScale` | `1` | Text scaling, validated from 0.85 to 1.4 |
| `appearance.overlayVisible` | `true` | Floating recording bar |
| `appearance.waveform` | `true` | Audio waveform visualization |
| `appearance.livePreview` | `true` | Provisional recent speech while recording; local mode requires the separate CPU Whisper Tiny preview asset |
| `shortcuts.hold` | `Ctrl+Super` | Modifier hold shortcut |
| `shortcuts.toggle` | `Ctrl+Shift+Space` | Start/stop with repeated presses |
| `shortcuts.rewrite` | `Ctrl+Alt+R` | Start/stop selected-text rewrite |
| `general.startup` | `false` | Windows user startup |
| `general.insertionMethod` | `clipboard` | Clipboard paste with restoration and pre-write preservation fallback to Unicode typing, or `unicode` typing |
| `general.saveHistory` | `true` | Save original and final transcript text |
| `general.context` | `true` | Read available context in the focused control |
| `general.microphone` | empty | Windows default, or exact input device name |
| `general.duckBackgroundAudio` | `false` | Temporarily reduce supported other apps' playback while recording; restore afterward while retaining observed manual volume changes |
| `general.duckingReductionPercent` | `60` | Playback reduction from 10 to 90 percent; 60 leaves 40% of the original session volume |
| `general.maxRecordingSeconds` | `300` | 10–1800 seconds; UI offers common durations |
| `general.historyDays` | `0` | 0 = until deleted; otherwise retention days |

The preview model is fixed to `whisper-preview` on a two-thread CPU worker and is not a final-model selection or a new persisted setting. Setup requires it only when `transcription.mode` is `local` and `appearance.livePreview` is enabled. Provider speech keeps its selected provider and cadence. Final speech settings continue to control the complete-take recognition.

## Interface preferences

Collapsed navigation is a remembered local interface preference, separate from `settings.json`. It retains an icon rail; **Collapse sidebar** and **Expand sidebar** change the view without modifying speech, cleanup, or provider settings. Scrollbar and button hover/focus colors follow the existing appearance settings and add no new persisted fields.

Sidebar width/label transitions and logo activation feedback respect the system's reduced-motion preference. This adds no application animation setting or native configuration field.

Dialog backdrop, focus, and temporary scroll locking are interface behavior, not persisted settings. Dialogs restore the prior document scroll state after the final lock is released; setup retains its existing completion/pause/dismissal rules.

## Provider record

```json
{
  "id": "connection-uuid",
  "name": "LM Studio",
  "protocol": "openai",
  "baseUrl": "http://127.0.0.1:1234/v1",
  "model": "your-loaded-model-id",
  "sttModel": "",
  "hasKey": false
}
```

`protocol` is `openai` or `anthropic`. The speech model ID is only used for an OpenAI-compatible audio API. The app derives `hasKey` from Credential Manager. Never put keys in URLs or settings files. Explicit model discovery reads the draft endpoint but adds no persisted model-list/capability setting; saving still records only the selected IDs. Unsaved keys are not persisted by discovery.

## Vocabulary and rule records

```json
{
  "vocabulary": [{"word": "Łukasz", "aliases": ["Lucas"]}],
  "appRules": [{"app": "outlook", "style": "professional", "customPrompt": "Keep emails brief and warm."}]
}
```

Vocabulary words must contain 1–256 characters. Application matching uses case-insensitive substrings of the executable stem. Rules are evaluated in stored order, and the first match wins. Common/recent/running choices and editing are interfaces for these same rule records; custom executable names remain supported.

## Shortcut notation

Supported modifiers: Ctrl/Control, Alt, Shift, Super/Win/Windows. Stored notation supports letters, digits, Space, Tab, Escape, and F1–F24. The press-to-capture interface reserves Escape for cancellation. A shortcut must include Ctrl, Alt, or Windows. Modifier-only chords must contain Ctrl and Windows. Hold, toggle, and rewrite shortcuts must differ. The editor rejects duplicate/known overlapping bindings. Capture is temporary until Save, stops after 30 seconds without a completed chord, and is unavailable during recording/processing. Cancel, Escape, and invalid capture do not replace saved settings. Reset uses the existing default for that action, subject to validation.

Changes are validated in Rust before persisting. JSON files use temporary writes, flush/sync, and rename. Missing fields use defaults to permit compatible configuration evolution.

## Technical output

`code` and `generate` require `cleanup.mode` to be `managed` or `provider`; they are incompatible with cleanup `off`. Choosing cleanup Off in the app also returns the output mode to Text. An empty `codeLanguage` selects Auto. When `general.context` is enabled, available bounded editor/file/nearby-text/shell hints may identify the language. Otherwise, or when context is unknown, the spoken request guides the model. A nonempty manual hint takes precedence and can name any language or shell the selected model handles.

The interface exposes **Output mode** separately from **Code language or shell**, whose choices include Automatic, common language/shell hints, and **Other / custom…**. They all use the same `codeLanguage` field; an empty value means Automatic. No separate detection/preset setting is persisted, and this control never chooses or changes the output mode automatically. Text writing styles remain separate from literal code/generation instructions.

The legacy `cleanup.style: "code"` remains valid as a text-cleanup preset. Dedicated technical behavior is selected through `outputMode`. Generate results always require review and Copy. Literal multiline output also requires review when the captured target is a recognized terminal. Neither mode adds an Enter action.

## Setup and repair readiness

The wizard computes requirements from the actual selected stages, not only the route label. Local speech requires its selected model and, for CUDA, `nvidia-runtime`. Managed cleanup requires its selected model and `llama-gpu` or `llama-cpu`. Cleanup `off` and provider-based stages omit their respective local assets. Unknown local IDs and invalid provider/model selections prevent readiness.

The native `complete_setup` command checks the entire selected plan before writing `setupComplete: true`, including repair of a configuration already marked complete. An ordinary settings save changing the flag from false to true is also checked. Download commands await verification/extraction before writing installed markers; queued or partially downloaded assets are not ready.

Opening repair preserves existing stage modes, separate speech/cleanup provider IDs, provider metadata, keys, and normal settings. Explicit choices in the wizard change the relevant fields. Installed files are reused and usable partial downloads resume. The live snapshot's `activeDownloads` map carries queued/downloading/verifying/extracting progress for a reopened wizard; it is runtime state, not a persisted setting or provider secret.
