# Privacy and storage

## Local defaults

Initial settings use managed local speech and cleanup. There is no telemetry, account, hosted application backend, or automatic cloud fallback. The speech worker uses local-only model loading and sets Hugging Face offline/telemetry flags during inference. Model downloads are separate, explicit setup/Models operations.

Setup lists the exact components required by the selected speech/cleanup stages and the missing download size. Choosing **Install required components & finish** starts those downloads automatically inside the wizard; there is no separate hidden download opt-in. It reuses installed assets and preserves usable partials on pause/retry. Merely opening repair does not begin network downloads. Fully provider-based stages do not download local models, and download/inference errors never choose a cloud provider automatically.

Repair keeps the existing independent provider IDs and saved credential architecture. Saved keys remain encrypted in Windows Credential Manager; leaving a key field blank performs no credential write. Setup is completed only after required local components and selected provider configuration pass readiness checks. These checks establish configuration/file readiness, not provider authentication, model accuracy, or an already-loaded model.

The speech worker explicitly disables ONNX Runtime telemetry events before creating inference sessions, in addition to Hugging Face telemetry controls.

Local inference/provider HTTP requests use a client that bypasses proxies for loopback traffic. Provider inference requests do not follow redirects, preventing an HTTPS endpoint from redirecting sensitive requests to another destination or to plaintext HTTP.

**Fetch models** explicitly requests model IDs from the draft provider, with the same endpoint restrictions and no redirects. It sends no audio, transcript, or application context and does not run a model. Unsaved typed keys are held in wiped-on-drop Rust buffers for the request; Fetch does not persist them. Saved credentials require exact provider ID/protocol/base-URL binding under the current settings lock. Returned IDs are transient choices, not a capability database or transcript history.

The application-rule editor obtains a bounded, deduplicated list of process names for visible top-level windows when opened/refreshed. It does not retrieve window titles, text, executable paths, or command lines for this list. Recent choices come from existing History app names. Choosing a rule saves its executable-name matcher, style, and optional guidance through the existing settings schema.

## Audio lifecycle

Rust captures microphone PCM in memory during recording. Provisional snapshots and final WAV files are written to the private `recordings/` directory for the Python worker or selected audio provider. WAV files are removed after their requests complete. Cancel invalidates the operation and prevents insertion; an already-running inference request can finish before its temporary file is removed. Crash leftovers are deleted on the next launch. Audio is never included in transcript history. Local live preview sends only a rolling six-second audio snapshot to a separate two-thread CPU worker using installed Tiny weights. Provisional text remains session state; it is not separately written to History. Final recognition and cleanup use the complete take independently. Tiny is downloaded only through an explicit setup/repair or Models action, and only local speech with live preview enabled requires it.

## Transcript history

History contains original recognition and final text, language, application executable name, recording duration, mode, insertion status, and timestamps. It is a local SQLite database with a write-ahead log. History is plaintext in the user's application directory; it is not encrypted by this app. Protect the Windows user account/disk, or disable history. Clearing history also checkpoints/truncates the WAL and vacuums the database. Individual deletion uses SQLite secure-delete behavior; storage backups are separate from live deletion.

Retention removes expired entries when history is saved and at startup. The display/query limit is the newest 10,000 entries; indefinite retention may contain older rows. Exporting history creates a user-controlled JSON file containing the filtered text and metadata.

## Application context

When enabled, the Windows UI Automation interface reads selected and nearby text from the focused control, bounded to approximately 2,048 characters each, and obtains the application executable name. It does not take screenshots or continuously scrape other applications. Password controls reported by accessibility are excluded and recording/insertion is refused for detected password fields. Controls without accessible text expose no surrounding text; accessibility implementations can vary.

Context is captured at recording start and used only for that session. Ordinary Text and literal code cleanup exclude selected and nearby text from model requests. Application style/vocabulary and locally derived language hints remain available; explicit rewrites and generation can send their permitted selected/nearby context. An output focus check compares the original window and accessible control identity; changed focus prevents insertion. No clipboard content is read for context. Default insertion temporarily places the final text on the clipboard, pastes it, and restores the prior supported formats. If the clipboard changes during paste, newer contents are preserved. When a format cannot be safely backed up before clipboard changes or input begin, CridVoice uses Unicode typing without changing the clipboard. Busy-clipboard, paste, or restoration errors do not trigger another insertion attempt. The temporary text carries Windows markers excluding it from clipboard history/cloud upload; third-party clipboard managers may implement their own behavior. Optional Unicode typing avoids clipboard use.

The clipboard insertion lease uses a unique per-paste marker and exact Unicode text to verify the temporary publication after the write handle closes. A changed sequence needs fresh proof before insertion or restoration; foreign clipboard updates remain protected. The marker is used locally for this operation.

Optional **Copy dictation to clipboard** deliberately leaves completed shortcut dictation on the clipboard after insertion or a focus-related insertion failure. It is off by default, works with either insertion method, and replaces previous clipboard contents at completion. This is separate from temporary paste restoration. Cancelled/stale takes, test recordings, failed-cleanup raw fallbacks and output awaiting code review are excluded. Persistent copies also carry Windows clipboard history/cloud/monitor exclusion flags; third-party clipboard tools may implement their own behavior. Clipboard text remains readable by applications with clipboard access until replaced.

## Technical output

Code dictation and code generation use the selected speech and text engines. A selected cloud speech provider receives audio; a selected cloud text provider receives the recognized request and permitted editor/file/shell hints. Literal dictation excludes raw selected/nearby text; explicit rewrites and generation may include it when enabled. Auto language detection uses those context hints only when application context is enabled. Password controls remain excluded.

Generated code appears in CridVoice for review and is copied only when you choose Copy; it is not automatically inserted into the original field. Literal code dictation uses the ordinary insertion method, except multiline output to a recognized terminal also requires review. CridVoice does not run generated code, though a terminal's response to a manual multiline paste depends on that terminal. When history is enabled, recognized and final code are saved as local text with code/generation mode metadata.

## Credentials and local model server

Personal writing preferences and application-specific guidance are stored in local settings. Text cleanup sends them with the current take to the selected local cleanup model or text provider. They are ordinary preferences, separate from encrypted API-key storage. They are not sent to code/CLI cleanup requests or used to modify app settings from dictated text.

API keys are encrypted with Windows DPAPI before storage in Windows Credential Manager. DPAPI is user-scoped, uses provider-specific entropy, and does not permit UI prompts. Only a versioned ciphertext record reaches the credential store; decrypted key buffers are temporary and explicitly wiped. Saved keys are never returned to the webview. Settings, logs, history, exports, and portable archives contain no raw keys. The private managed llama.cpp server listens only on `127.0.0.1` at an ephemeral port and requires a generated API key. The Python worker uses stdin/stdout, with no listening socket. Inference children belong to a Windows job configured to terminate them when the parent process closes. Keys, transcript text, and microphone buffers are not written to diagnostic logs by CridVoice.

## Diagnostics and live model status

Background warm-up loads only installed selected app-managed local engines. It uses fixed synthetic input to prepare speech and cleanup inference, discards its output, and does not capture the microphone, collect target-app context, save history, download assets, read provider credentials, or contact external providers. Explicit model unloading cancels pending warm-up work.

Speech stderr and managed llama.cpp stdout/stderr are consumed concurrently using fixed-size buffers. Raw child output is discarded. Only predefined diagnostic categories and safe numeric Windows spawn/exit codes can appear in application errors. Complete child command lines, API keys, prompts, transcripts, surrounding application text, and provider response bodies are not retained or written to diagnostic logs. Speech protocol stdout remains reserved for JSON responses.

Live `engineStatus` contains local model IDs, device choices, and unloaded/loading/loaded/error state. Application-wide model/settings events and a two-second installed-marker/child-status monitor keep the interface current. Monitoring does not read recordings, inspect external providers' memory, collect application context, or make inference requests. It does not re-hash all installed model data during each check.

## Network destinations

Explicit setup downloads contact python.org/PyPI only during packaging, and pinned Hugging Face, GitHub, or files.pythonhosted.org model/runtime sources in the app. Installed local inference does not download models. Selected external provider requests contact the exact configured endpoint. Model host CDNs may follow HTTPS redirects. A cloud provider is used only when selected for that stage.

## Storage locations

Installed data uses Tauri's current-user local app data directory for `com.cridvoice.desktop`. **Settings → Open folder** shows the actual path. It contains `settings.json`, `history.sqlite3` and WAL files, `models/`, and `recordings/`.

Portable mode is selected by `portable.flag` next to the executable and stores those files in `data/` beside it. Store that folder somewhere writable; do not put it in Program Files or a protected root. Provider keys remain in Credential Manager. Back up settings/history/models as appropriate; stop the app before backing up SQLite files. Uninstalling the application does not imply deleting your user data.
