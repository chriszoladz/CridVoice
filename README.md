# CridVoice

A personal Windows 11 dictation app with a Tauri 2 / React interface, Rust desktop integration, and a packaged Python speech service.

## Start here

Use the Windows installer, or extract the **entire** portable ZIP and run `CridVoice.exe`. Python is included. On first launch, choose app-managed local AI, an existing LM Studio/llama.cpp server, or your own cloud provider. Review the required components and download size, then choose **Install required components & finish**. The wizard automatically installs every missing component for your selected speech and cleanup stages and stays open through download, verification, and extraction. Installed components are reused; pause/resume and retry preserve usable partial downloads. Setup finishes only when the complete selected plan is installed.

An existing incomplete local setup opens the repair wizard at the required-component list. **Settings → Run setup wizard** also reopens it. Speech and cleanup providers, saved keys, and other settings are preserved unless you change them. A fully provider-based route needs no local model downloads.

Hold **Ctrl + Windows** while speaking in another application's text field. Release to transcribe, clean up, and insert. **Ctrl + Shift + Space** toggles dictation; **Ctrl + Alt + R** starts/stops a spoken rewrite of selected text. **Escape** cancels.

For coding, choose **Dictate code or commands** to speak literal code/commands or **Generate code or commands** to describe a task. Generation opens the result for review and Copy; multiline literal output to a recognized terminal also requires review. Automatic language/shell hints and manual overrides are available on Overview and in Writing styles. Both technical modes need cleanup enabled.

Selected installed local engines warm in the background after launch. Overview shows when they are warming; recording remains available during that preparation. Local models provides a manual loading action, and explicitly unloading models keeps them unloaded until you load or use them again. Cold initialization still takes time after launch, but is moved ahead of the first dictation where possible.

For the default managed route on an RTX 5070 Ti, the wizard includes Whisper Large v3 Turbo, the NVIDIA speech runtime, Whisper Tiny for enabled live preview, Qwen3 4B, and the llama.cpp GPU runtime. Having speech installed does not complete cleanup setup. Intel and AMD CPUs are supported; choose CPU explicitly and use Whisper Small for lighter transcription. GPU text inference uses llama.cpp's Vulkan backend; GPU speech uses CTranslate2 with CUDA 12.9 / cuDNN 9.

## What is included

- Global hold and toggle shortcuts, a tray menu, startup support, and a floating recording bar.
- Live waveform and transcript preview with independent switches.
- English/Polish automatic detection with manual language selection.
- Meaning-preserving cleanup, spoken self-corrections, vocabulary, per-app styles, and selected-text rewriting.
- Separate literal code/CLI dictation and code generation from spoken instructions, with Auto language hints or a freeform manual language/shell override.
- Generated code stays in CridVoice for review and Copy instead of automatic target-field insertion.
- Independently configurable speech and text engines: managed local AI, LM Studio, llama.cpp, OpenAI-compatible APIs, and Anthropic-compatible text APIs.
- Verified, resumable model/runtime downloads and explicit CPU/GPU selection.
- Setup and repair with all required components, per-component/overall progress, verification/extraction stages, and a native readiness check before completion.
- Live installed and in-memory model status, with updates across app windows and no restart required.
- Automatically saved local transcript text, search, copy, export, retention, and deletion.
- Eight theme presets, light/dark/system modes, accent colors, text scaling, and overlay controls.
- Compact desktop navigation, a custom title bar with window controls, plain status labels, and the supplied waveform logo across the app, Windows icons, and offline help.
- Installer and portable release packaging, locked dependencies, automated checks, and full documentation.

## Documentation

| Guide | Contents |
| --- | --- |
| [User guide](docs/USER-GUIDE.md) | Setup, shortcuts, recording, code/CLI modes, rewrites, vocabulary, styles, history, themes |
| [Models and hardware](docs/MODELS.md) | NVIDIA/CPU inference, downloads, model choices, memory and drivers |
| [Providers](docs/PROVIDERS.md) | LM Studio, llama.cpp, OpenAI/Anthropic formats, custom endpoints and keys |
| [Privacy and storage](docs/PRIVACY.md) | Audio lifecycle, application context, cloud selection, local data, portable mode |
| [Configuration reference](docs/CONFIGURATION.md) | Every persisted setting and its default |
| [Architecture](docs/ARCHITECTURE.md) | Components, IPC, native integration, concurrency, state and failure handling |
| [Development](docs/DEVELOPMENT.md) | Toolchains, commands, tests, code map, dependency maintenance |
| [Build and release](docs/RELEASING.md) | Windows installer, portable ZIP, CI, signing, artifact verification |
| [Windows validation](docs/WINDOWS-TESTING.md) | Acceptance checks on your Windows 11 / RTX 5070 Ti machine |
| [Troubleshooting](docs/TROUBLESHOOTING.md) | Microphone, models, GPU, providers, focus, shortcuts, WebView2 |
| [Polski: szybki start](docs/QUICKSTART-PL.md) | Polish quick-start instructions |
| [Validation report](docs/VALIDATION.md) | Executed checks and remaining Windows-specific validation |

## Development quick start

On Windows 11 x64, install Node.js 22+, Rust, and Visual Studio Build Tools with Desktop Development with C++. Install Python 3.12+ **only for development/packaging**.

```powershell
npm ci
python scripts/package_python.py --locked
npm run desktop
```

For interface development on Linux/macOS:

```sh
npm ci
npm run dev
```

The browser displays an explicit preview banner. It does not emulate microphone capture, downloaded model status, or Windows insertion. It cannot finish a setup requiring local components; a fully provider-based preview can save its configuration without claiming native readiness.

```sh
npm run build
npm test
python -m unittest discover -s tests -p "test_*.py"
cargo test --manifest-path src-tauri/Cargo.toml --lib
```

## Release status

CridVoice 0.1.16 rechecks transient Windows accessibility focus before insertion, accepting only the original window and field. Stable focus adds no intentional delay. Input failures distinguish window changes, field changes and unavailable field identity; no input is replayed after dispatch. Settings adds optional 25% reduction of other apps' playback during recording, with restoration when the take ends. It defaults off and requires no downloads.

History avoids rebuilding unchanged rows during live audio updates, and integer-format microphones avoid an intermediate conversion buffer per callback. The final model, decoder, clipboard ownership, password exclusion and current-take isolation are preserved. Matching external 0.1.16 verification records executed checks, build/install results and scoped human acceptance. Earlier results below retain their original versions.

### Historical 0.1.15 settings polish

Version 0.1.15 added press-to-set shortcut capture, common/custom language and app pickers, explicit provider model discovery and automatic microphone discovery. The user confirmed capture worked without starting a recording. Provider discovery lists IDs without inferring model capabilities, running a model or saving a draft API key. These controls remain available in 0.1.16.

### Historical 0.1.14 shortcut and dictation isolation

CridVoice 0.1.14 hardens Ctrl + Windows against stale modifier state and preserves the pairing of forwarded or suppressed Windows-key events, including repeats. Injected key presses cannot start recording. Release both shortcut keys between takes; a suppressed Windows key must physically release before another take can start.

Ordinary Text and literal code dictation send only the current transcript as source material. Existing selected/nearby text is excluded from those cleanup requests, preventing an earlier chat draft from being reintroduced. Application styles, vocabulary and local code-language detection remain available; explicit rewrite and code generation retain their permitted context.

The original Ctrl-only symptom cleared after restarting 0.1.13 and was not reproduced under the diagnostic. A read-only history overlap check found a separate take whose 5-word raw transcript became a 24-word cleaned result containing the entire previous 19-word result. These observations are distinct from automated regression evidence. Current test/build/install results and later human acceptance are recorded in the matching external release verification. Historical 0.1.13 inference/UI evidence is not a new 0.1.14 run.

### Historical 0.1.13 preview work

CridVoice 0.1.13 uses a separate low-priority, two-thread CPU Whisper Tiny worker for local live preview. Setup or repair installs its pinned 78,203,619-byte download (about 75 MiB) only when local speech and live preview are enabled. The selected final speech model stays independently warm and recognizes the full take with its existing quality settings. Preview considers only the latest six seconds, first becomes due at about 750 milliseconds, then uses minimum 300-millisecond request intervals with one request in flight and no backlog. These are provisional chunk updates that can revise or drop older words, not a true per-word CTranslate2 callback or a typewriter animation. Remote preview retains its existing provider and cadence.

The popup keeps a fixed two-line area showing the latest recognized words; the entire current preview window remains accessible. Overview follows new text while the reader remains near the bottom and preserves a manually scrolled-back position. Corrections replace the hypothesis immediately, and partial words are not repeatedly announced by live regions. Preview failure remains separate from final recognition. 125 frontend tests across eighteen files, TypeScript, 125 Windows Rust tests across targets, strict Clippy, and 29 Python tests passed. Nineteen scripted browser flows passed in 37.1 seconds. Build, installed readiness, synthetic performance evidence, and any later user feedback belong to matching external verification. No measured real-microphone latency or 0.1.13 user acceptance is claimed.

The historical 0.1.12 follow-up schedules the first local live-preview request at about 750 milliseconds instead of 2.4 seconds, then later requests every 1.5 seconds instead of 2.4 seconds, with only one request in flight. This changes request timing; when text appears still depends on model readiness and recognition speed. Final recognition and remote preview cadence remain unchanged. The preview-only decoder uses greedy decoding with one candidate, no word timestamps, and no prior-window conditioning; final recognition settings are unchanged. Final automated checks passed: 116 frontend tests across seventeen files, TypeScript, eighteen browser flows, 108 Windows Rust tests, strict Clippy, and 21 Python tests plus packaged imports. Build, installed behavior, and real-user 0.1.12 latency belong to matching external verification and are not established by those checks. The user later reported “Preview is quicker and insertion works” with installed 0.1.12. That is scoped feedback rather than instrumented timing or full-release acceptance.

The historical 0.1.11 follow-up targeted the reported “clipboard changed before paste” error in installed 0.1.10. The revised publication check closes the write handle before verifying a per-paste marker and exact UTF-16 text. A changed sequence requires fresh proof of that same publication; foreign writes remain protected, and post-write failures never retry insertion. Revalidation is bounded and input is dispatched at most once. Final automated checks passed: 116 frontend tests, eighteen browser flows, TypeScript/Vite, 103 Windows Rust tests, strict Clippy, and eighteen Python tests with packaged imports. Twelve new native regressions cover the clipboard-only production change. The reported failure was not reproduced through an instrumented target-app test. The user later confirmed insertion with “Works good,” which is scoped feedback rather than a timing measurement. Build, installed behavior, and artifact results belong to matching external verification; earlier results below keep their original versions.

The historical 0.1.10 follow-up addressed the reported clipboard-preservation error during Ctrl + Windows insertion. When an existing format cannot be preserved before clipboard changes or input begin, CridVoice uses Unicode typing without changing the clipboard. Busy-clipboard, paste, and restoration failures never trigger a second insertion attempt. Final source checks passed: 116 frontend tests across seventeen files, TypeScript compilation, eighteen browser flows, 91 Windows Rust tests, and strict Clippy. Fifteen new native regressions cover preservation, fallback, focus/cancellation, UTF-16, and partial-input handling. Build, installed behavior, and artifacts belong to matching release verification. Results below retain their original release versions; no 0.1.10 user acceptance is claimed.

The historical 0.1.9 follow-up corrected shared-dialog backdrop coverage, stacking, and focus handling so the custom header and upper logo dim with the rest of the window. Tab navigation recovers when a control is disabled or focus moved outside, balanced scroll locks restore the previous state, and Ctrl + K cannot stack search over another dialog. Setup reuses Tab protection without changing its pause/close rules. Final source checks passed: 116 frontend tests across seventeen files, eighteen browser flows, TypeScript compilation, 76 Windows Rust tests, and strict Clippy. It preserves the accepted 0.1.8 sidebar/logo behavior and the earlier popup correction without native desktop or engine changes. Build, installed-app, and artifact outcomes belong to matching release verification.

Historical 0.1.8 source checks passed 110 frontend tests across sixteen files, sixteen browser flows, TypeScript compilation, 76 Windows Rust tests, and strict Clippy. The user said “Looks right” about its sidebar/logo, then identified the Find a page backdrop issue. This is scoped interface acceptance, not broad voice or full-release acceptance.

Historical 0.1.7 source checks passed 108 frontend tests across sixteen files, fourteen browser flows, TypeScript compilation, 76 Windows Rust tests, and strict Clippy. The user gave positive visual feedback on its Ctrl + Windows popup but rejected the collapsed sidebar's upward icon shift and unnatural transition. This is partial feedback rather than full 0.1.7 acceptance; the new sidebar checks remain separate.

The historical 0.1.6 candidate reduced the recording popup and added selected-style examples plus separate output/language controls. Its source passed 107 frontend tests across sixteen files, twelve browser flows, TypeScript compilation, 76 Windows Rust tests, and strict Clippy. An observed eight-pixel native centering offset remained despite the browser layout pass, so 0.1.6 was not finally accepted. Earlier source checks do not establish the new 0.1.7 fixes.

The accepted 0.1.5 interface follow-up added theme-aware scrollbars, a compact default Overview, and a control to hide/show the left navigation. It also completed theme preset surfaces, reacted to System-mode changes in preview, kept text readable on custom accents, and preserved rapid Appearance updates. The idle default view fits at 1200×820 and 100% text size with up to three recent entries; smaller windows and larger content can still scroll. It retains the 0.1.4 background model preparation, custom title bar, literal CLI handling, separate generation mode, and setup repair.

Final 0.1.5 checks passed: 96 frontend tests across fourteen files, nine browser flows, TypeScript compilation, 72 Windows Rust tests, and strict Clippy. Browser checks use scripted IPC and cover all sixteen preset/color-mode combinations, custom accent persistence and contrast, System preview, sidebar/draft preservation, and default-fit/scroll behavior. Unchanged speech/cleanup sources retain the version-specific 0.1.4 Python and model-fixture evidence below. Build, installed-app, and artifact outcomes belong to the matching release verification.

The user twice reported that installed 0.1.5 dictation was now fast. This feedback is separate from timed synthetic measurements and from the new popup checks.

Historical 0.1.4 source checks passed 86 frontend tests, five browser flows, TypeScript compilation, 72 Windows Rust tests, strict Clippy, and 18 Python tests. Its installed startup and selected-model warming were subsequently verified separately. Fresh isolated CUDA workers recognized a fixed public sentence in 0.27-0.28 seconds after warming, compared with 3.76-6.14 seconds on their first cold request; warm-up itself took 3.51-3.53 seconds. CPU steady transcription still took about six seconds. These are speech-stage measurements, not complete dictation latency. All eleven final local Qwen Vulkan coding fixtures passed native normalization and applicable syntax checks, including CLI speech with unrelated Python context and an explicitly spoken dot. Generated code/commands were not executed. Browser checks use scripted IPC, synthetic assets, and a stubbed clipboard. The user separately confirmed Text and CLI insertion in installed 0.1.3; those reports and earlier release checks do not establish 0.1.7 behavior.

The versioned deliverables use these paths relative to this source folder. Check the matching [release verification](release/VERIFICATION-0.1.14.json) for build, startup, and update results. The finished outer release ZIP includes its own immutable VERIFICATION.json snapshot and SHA256SUMS.txt for the three artifacts.

| Deliverable | File |
| --- | --- |
| Windows installer | [CridVoice-0.1.14-windows-x64-setup.exe](release/CridVoice-0.1.14-windows-x64-setup.exe) |
| Portable build | [CridVoice-0.1.14-windows-x64-portable.zip](release/CridVoice-0.1.14-windows-x64-portable.zip) |
| Source archive | [CridVoice-0.1.14-source.zip](release/CridVoice-0.1.14-source.zip) |

This remains a personal evaluation build. Use the [Windows acceptance checklist](docs/WINDOWS-TESTING.md) for microphone permissions, both shortcut press orders, focus changes, English/Polish accuracy, and target-app insertion. See the [local Windows validation report](docs/WINDOWS-VALIDATION-2026-10-13.md) for the current 0.1.14 shortcut/dictation follow-up and historical 0.1.13 independent-preview work, historical clipboard/dialog/sidebar/popup feedback, the 0.1.6 candidate, and earlier warming/code fixtures. Personal artifacts are unsigned; public distribution would require signing and a completed acceptance pass.

This implementation was designed from Wispr's public product behavior and the agreed requirements. It does not use Wispr source code, private APIs, assets, or branding. Accuracy and subtle intent handling depend on the selected speech and cleanup models.
