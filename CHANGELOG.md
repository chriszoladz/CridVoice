# Changelog

## 0.1.15

- Capture shortcuts by pressing and releasing the chord, with conflict checks, Cancel/Escape, a bounded listening timeout, and reset-to-default actions.
- Choose common code languages/shells or a custom hint; choose common, recent, running, or custom applications when adding/editing writing-style rules.
- Fetch provider model IDs explicitly from the configured endpoint in setup and the provider editor, with a custom-ID fallback and exact saved-credential binding. Returned IDs do not establish model capabilities.
- Refresh microphone choices on opening Settings, preserve disconnected saved choices, and add Settings section jumps and useful page-search keywords.
- Preserve the 0.1.14 shortcut and current-take cleanup fixes. Final validation, build/installed results, and user feedback belong to matching external verification.

## 0.1.14

- Reconcile stale shortcut modifiers, require physical Windows-key rearming after a suppressed hold, and preserve key-down/up ownership through repeats. Injected releases can stop a take but never start one.
- Isolate ordinary Text and literal code cleanup from existing selected/nearby text so a new take cannot reintroduce the prior chat draft through context. Preserve explicit rewrite/generation context and code-language detection.

## 0.1.13

- Run local live preview in a separate low-priority, two-thread Whisper Tiny CPU worker, installed through setup/repair when local speech and live preview are enabled.
- Preview the latest six seconds with a first request due around 750 milliseconds and minimum 300-millisecond hops, skipping busy opportunities rather than queueing. Provisional phrases may revise; final full-audio recognition and remote preview behavior are unchanged.
- Keep the newest words visible in a fixed two-line popup, retain the complete current preview for accessibility, and preserve an Overview reader's scroll position. No simulated typewriter or per-word live announcements.

## 0.1.12

- Schedule the first local live-preview request at about 750 milliseconds instead of 2.4 seconds, then subsequent requests at 1.5-second intervals instead of 2.4 seconds, with one request in flight.
- Use a preview-only greedy decoder with one candidate, no word timestamps, and no prior-window conditioning. Final recognition and the original remote preview cadence remain unchanged.
- Automated checks passed; actual preview arrival still depends on model readiness and hardware, and no real-user 0.1.12 latency or acceptance is claimed.

## 0.1.11

- Clipboard-publication follow-up for the reported “clipboard changed before paste” error. The temporary publication is verified after the write handle closes, using a per-paste marker and exact UTF-16 data while preserving unrelated clipboard changes.
- Sequence changes require fresh proof of the same publication; failed writes restore the originals under the initial lock, and post-write failures never retry insertion.
- Twelve new native regressions cover publication proof, foreign changes, rollback/close failures, and bounded revalidation with one input dispatch. Source checks passed; installed behavior and user acceptance remain separate from automated regression evidence.

## 0.1.10

- Clipboard paste uses Unicode typing when an existing format cannot be safely preserved before clipboard changes or input begin, keeping the clipboard untouched.
- Busy-clipboard, paste, and restoration errors do not trigger a second insertion attempt.

## 0.1.9

- Shared dialogs dim the full window uniformly, including the custom header and upper logo, with consistent stacking and focus handling.
- Dialog focus remains contained when Save is disabled or focus moved outside; setup reuses Tab protection while keeping its existing close/pause rules.

## 0.1.8

- Navigation icons keep their vertical positions when the sidebar collapses or expands.
- Subtle horizontal width/label transitions, with instant changes for reduced-motion preferences.
- Balanced brand-home hover/focus states without an oversized uneven rectangle.
- Full and rail logos return to Overview with restrained activation feedback that respects reduced motion.

## 0.1.7

- Recording-popup native border and centering corrections.
- Scrollbar corners and outer overflow follow the surrounding surface.
- Collapsed navigation keeps an icon rail with named hover/focus tooltips.
- Shared buttons use clearer hover and keyboard-focus states, with neutral colors where suitable.

## 0.1.6

- Smaller recording popup with a centered status label and waveform, compact spacing, and a clearer processing layout.
- Writing-style examples follow the selected style using local illustrative input/output, without provider requests.
- Output-mode selection is distinct from automatic or manual language/shell hints; automatic detection does not choose the output mode.

## 0.1.5

- Theme-aware custom scrollbars, compact default Overview, and a control to hide or show the left navigation.
- Complete light/dark surfaces for every theme preset and reactive System-mode preview.
- Readable text on custom accent colors and ordered Appearance updates that preserve rapid control changes.

## 0.1.4

- Custom title bar replaces the Windows caption, with drag, minimize, maximize/restore, and close-to-tray controls.
- Literal CLI intent takes priority over unrelated editor code; command punctuation and keywords handle incidental speech-recognition formatting.
- Installed selected local speech and cleanup models warm in the background after launch, reducing work deferred to the first dictation.
- Live warming status and a manual model-loading action distinguish configured models from ready local engines.
- Warm-up uses synthetic input without recording audio or contacting external providers.
- Route changes and model maintenance invalidate stale warm-up work; explicit unloading keeps models unloaded.

## 0.1.3

- Compact desktop navigation, plain processing status, and a quieter visual style throughout settings and setup.
- Supplied CridVoice waveform and wordmark assets throughout the app, with updated native Windows icons.
- Functional dictation panel replaces decorative rings, glowing dots, and promotional copy.
- Text badges replace status pills; live recording and setup progress remain visible.
- Recording cancellation is also available directly from the Overview controls.
- Recording timers and live previews check their session generation before changing state; cancellation stays responsive during WAV conversion.
- Model removal, downloads, settings writes, and recording transitions coordinate to prevent conflicting operations.
- Cancelled requests recheck their session after waiting for an engine lock, so they cannot restart an unloaded model.
- Provider requests verify their captured endpoint and protocol against current settings before reading credentials.
- Delayed snapshots and saves preserve newer model progress, provider edits, vocabulary, and style changes.
- History totals update only when history changes, and the idle waveform and unused decorative styles were removed.

### Code and CLI

- Separate literal code dictation and generation from spoken instructions, alongside normal text output.
- Auto language/shell hints use available context when enabled; freeform manual overrides support model-specific languages and dialects.
- Code cleanup is instructed to preserve syntax, operators, switches, paths, quoting, and indentation.
- Generated results open in CridVoice for review and Copy, with no automatic target-field insertion or added Enter action.
- Literal multiline output to recognized terminals also requires review; mode-aware formatting preserves code indentation and removes a model's surrounding code fence.

## 0.1.2

- Setup automatically installs every missing model and runtime required by the selected speech and cleanup routes before completing.
- Visible component progress covers download, checksum verification, and extraction, with pause, resume, and retry inside the wizard.
- Existing models and saved provider selections are reused. Incomplete existing setups open the repair wizard, also available from Settings.
- Native setup completion validates installed components and provider configuration before saving readiness.
- Download state stays current across app windows, including downloads started before the wizard opens.
- Compact setup layout keeps progress and controls usable at the minimum window size.
- Windows Rust, frontend, download fixtures, and browser wizard checks cover readiness, failures, pause/resume, and retry. Full microphone, shortcut, and insertion acceptance remains separate.

## 0.1.1

- Live installed and resident model status, download completion, unload, child exit, and settings updates across app windows without restarting.
- Ordered hold/toggle transitions and late-cancellation checks before input dispatch and result updates.
- Bounded preview/recognition queue waits and cleanup startup, separate transcription/cleanup/insertion labels, and sanitized child exit diagnostics.
- Resilient private speech protocol, including native stdout isolation and safe error messages.
- Correct saved microphone display and rollback of rejected shortcut edits.
- Portable rebuilds refuse to overwrite an output folder containing user data.
- Native Windows checks and CPU/CUDA recognition of a synthetic English fixture. The reported shortcut processing freeze still requires a full application reproduction and acceptance pass.

## 0.1.0

Initial personal evaluation build: Windows dictation, managed local speech/text models, selected external providers, English/Polish recognition, self-correction prompts, custom vocabulary, app styles, history, themes, setup, installer/portable packaging, and documentation. Real Windows/hardware acceptance is required before production release.
