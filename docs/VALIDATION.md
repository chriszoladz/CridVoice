# Validation report

## Current 0.1.17 adjustable playback reduction

The user confirmed repeated 0.1.16 takes inserted correctly in the previously affected chat field, then reported that its fixed 25% playback reduction was too subtle. Version 0.1.17 adds a 10–90% slider with a 60% default. Saved settings without the new amount use that default. A recording snapshots the amount; moving the slider does not alter an active take.

Ordinary Settings persistence no longer disables and dims the full settings fieldset. The ordered save queue, rollback/epoch guards, and recording/processing locks remain. Regression tests hold saves pending and verify two edits persist without disabling the fieldset; slider tests cover drafts, single commits, keyboard input and persisted values.

An explicitly run Windows COM test created only its own unique silent session and exercised the production volume-adjustment guard. From baseline 0.800, 10%, 60% and 90% reduction produced 0.720, 0.320 and 0.080, then restored 0.800. A manual test-session change to 0.440 was retained. This test did not adjust other applications' sessions. It is opt-in/ignored during the ordinary suite; its separate execution log is recorded in matching external release verification. Audible playback and real-user 0.1.17 acceptance remain separate.

## Historical 0.1.16 insertion, background audio and performance

Version 0.1.16 addresses transient Windows accessibility focus reads before automatic insertion. Bounded retries accept only the original input identity; window/password/cancellation checks, clipboard publication ownership and no replay after dispatch remain required. Missing original field identity is not accepted as a wildcard. Error messages distinguish unavailable fields and actual focus changes without collecting target contents.

The optional playback reduction setting defaults off, attenuates other app sessions during recording, and queues conditional restoration when the recording ends. Normal shutdown has a bounded restoration wait. Policy/lifecycle tests do not establish behavior with every audio driver or exclusive-mode player.

History no longer rebuilds unchanged rows for frequent recording events. Integer microphone formats avoid an intermediate conversion allocation; equivalence tests cover channel averaging, sample extrema, caps and RMS. This changes neither the selected final model nor its decoding settings. No speech-accuracy or end-to-end latency improvement is inferred from these code changes.

Matching external 0.1.16 verification records actual automated, package and installed checks. Physical shortcuts, real microphone/target-app insertion and audible volume behavior require a separate acceptance pass. Earlier results below retain their original scope.

## Historical 0.1.15 configuration controls

CridVoice 0.1.15 adds deliberate shortcut capture with conflict checks, Cancel/Escape, a 30-second incomplete-capture limit, and default restoration. Common language/shell choices retain the same optional custom hint. Application rules offer common/recent/running/custom names and editing. Settings loads microphone choices when opened, preserves a disconnected saved choice, and adds section jumps and search keywords.

Provider model discovery is an explicit request from setup/the provider editor to the configured draft endpoint. It returns IDs without classifying capabilities, offers a custom-ID fallback, uses exact saved-credential binding, and does not persist typed keys. Loopback fixtures establish request behavior rather than real-provider support. The 0.1.14 current-take cleanup and clipboard protections are retained.

Final 0.1.15 automated counts, build/install outcomes, and scoped human feedback belong to matching external verification. At this source checkpoint they are pending; earlier versioned results remain historical. No current installed/user acceptance or new microphone/model accuracy is claimed.

## Historical 0.1.14 shortcut and dictation isolation

CridVoice 0.1.14 hardens Ctrl + Windows against stale modifier state and preserves the pairing of forwarded or suppressed Windows-key events, including repeats. Injected key presses cannot start recording. Release both shortcut keys between takes; a suppressed Windows key must physically release before another take can start.

Ordinary Text and literal code dictation send only the current transcript as source material. Existing selected/nearby text is excluded from those cleanup requests, preventing an earlier chat draft from being reintroduced. Application styles, vocabulary and local code-language detection remain available; explicit rewrite and code generation retain their permitted context.

The original Ctrl-only symptom cleared after restarting 0.1.13 and was not reproduced under the diagnostic. A read-only history overlap check found a separate take whose 5-word raw transcript became a 24-word cleaned result containing the entire previous 19-word result. These observations are distinct from automated regression evidence. Current test/build/install results and later human acceptance are recorded in the matching external release verification. Historical 0.1.13 inference/UI evidence is not a new 0.1.14 run.

## Historical 0.1.13 independent local preview

CridVoice 0.1.13 uses a separate low-priority, two-thread CPU Whisper Tiny worker for local live preview. Setup or repair installs its pinned 78,203,619-byte download (about 75 MiB) only when local speech and live preview are enabled. The selected final speech model stays independently warm and recognizes the full take with its existing quality settings. Preview considers only the latest six seconds, first becomes due at about 750 milliseconds, then uses minimum 300-millisecond request intervals with one request in flight and no backlog. These are provisional chunk updates that can revise or drop older words, not a true per-word CTranslate2 callback or a typewriter animation. Remote preview retains its existing provider and cadence.

The popup keeps a fixed two-line area showing the latest recognized words; the entire current preview window remains accessible. Overview follows new text while the reader remains near the bottom and preserves a manually scrolled-back position. Corrections replace the hypothesis immediately, and partial words are not repeatedly announced by live regions. Preview failure remains separate from final recognition.

125 frontend tests across eighteen files, TypeScript, 125 Windows Rust tests across targets, strict Clippy, and 29 Python tests passed. Nineteen scripted browser flows passed in 37.1 seconds. Scripted browser and source checks do not establish actual microphone latency, general recognition accuracy, or 0.1.13 user acceptance. Synthetic performance evidence, build, installed readiness, and artifact outcomes belong to matching external verification.

## Historical 0.1.12 local preview timing

CridVoice 0.1.12 schedules local preview requests earlier: about 750 milliseconds for the first request and 1.5 seconds for later requests, replacing the prior 2.4-second cadence. One request remains in flight. Preview-only greedy decoding uses one candidate, no word timestamps, and no prior-window conditioning; final recognition keeps its original settings. Remote preview preserves its original 32-tick cadence, including skipped requests while busy. These are scheduling targets, not measured text-arrival latency.

Final automated checks passed: 116 frontend tests across seventeen files, TypeScript, eighteen scripted browser flows in 40.8 seconds, 108 Windows Rust tests across targets, strict Clippy, and 21 Python tests in 0.759 seconds plus packaged imports. Five new native scheduling regressions and three new Python preview regressions cover the bounded changes. Browser data is scripted; tests do not establish real-microphone preview latency or new model accuracy. Build, installed behavior, and artifact results belong to matching external verification. The user later reported “Preview is quicker and insertion works” for installed 0.1.12; this confirms that take's preview/insertion behavior without instrumented timing or full-release acceptance.

## Historical 0.1.11 clipboard-publication follow-up

On 2026-10-15, the user reported “clipboard changed before paste” with installed 0.1.10. The 0.1.11 correction verifies the publication after closing the write handle, using the owner, a per-paste marker, and exact UTF-16 text including its terminator. Sequence changes require a fresh proof under a read lock; a strict final sequence/owner check still protects input. At most three proof/target-validation passes recheck focus, cancellation, and password exclusion before one input dispatch. Input is never replayed after a zero, partial, or full send. Restoration likewise requires proof of the same publication, and failed setup writes restore originals before the initial lock closes. Close/post-write failures never use Unicode fallback.

Final automated checks passed: 116 frontend tests across seventeen files, TypeScript/Vite, eighteen browser flows in 35.0 seconds, 103 Windows Rust tests across targets, strict Clippy, and eighteen Python tests in 0.663 seconds plus packaged dependency imports. Twelve new native regressions bring the clipboard module to nineteen tests. Production logic changes are confined to `clipboard.rs`; speech, inference, model prompts, and the controller retain their prior behavior. The proposed cause is an inference from clipboard API semantics: the private-station fixture was unavailable with Access Denied 5 and made no real clipboard call. This is not an instrumented reproduction or target-app insertion acceptance. The user later confirmed installed 0.1.11 insertion with “Works good”; that scoped report does not turn the earlier fixture into an instrumented reproduction. Build/installed/artifact results belong to matching external verification, and historical inference results keep their original versions.

## Historical 0.1.10 clipboard-preservation follow-up

CridVoice 0.1.10 addresses the reported clipboard-preservation error during Ctrl + Windows insertion. A typed format-preservation failure before any clipboard change or paste input uses Unicode typing; the saved insertion-method choice stays unchanged. Busy/open failures and failures at or after the attempted write boundary do not retry insertion. The Unicode path checks cancellation, physical modifiers, the original focus/control, and password exclusion before sending input. Final checks passed: 116 frontend tests across seventeen files, TypeScript compilation, eighteen browser flows in 37.8 seconds, 91 Windows Rust tests across targets, and strict Clippy. Fifteen new native regressions cover snapshot/write boundaries, fallback/non-retry behavior, UTF-16, focus/password/cancellation, and partial-input reporting without replaying a prefix. These checks use injected faults/input callbacks rather than the real clipboard, microphone, or target-app insertion. Matching release verification records build, installed behavior, and artifact results. No 0.1.10 user acceptance or new model accuracy is claimed.

## Historical 0.1.9 shared-dialog follow-up

CridVoice 0.1.9 corrects full-window shared-dialog backdrop coverage, stacking, and focus handling, preserving the earlier sidebar/logo and popup work. The bounded focus correction handles disabled controls and outside focus, captures the prior focus before autofocus, guards Ctrl + K stacking, and reuses Tab protection in setup without changing busy/pause/close/Escape rules. Counted document scroll locks restore the prior overflow after the final cleanup. Final checks passed: 116 frontend tests across seventeen files, TypeScript compilation, eighteen browser flows in 39.8 seconds, 76 Windows Rust tests, and strict Clippy. Native desktop/engine code matches the prior hash proof; matching build, installed-app, and artifact outcomes belong to external verification.

Scripted browser proofs cover full-window Find a page, Help at large text, provider/history/confirmation dialogs, and busy setup. Header clicks behind shared dialogs dismiss without invoking native window actions, while controls work after dismissal. These checks do not establish new microphone/model accuracy or broad release acceptance. The 0.1.8 “Looks right” feedback remains limited to sidebar/logo.

## Historical 0.1.8 sidebar/brand follow-up

The user said “Looks right” about the 0.1.8 sidebar/logo, then identified a separate Find a page backdrop issue. This is scoped interface acceptance rather than broad voice or full-release acceptance.

CridVoice 0.1.8 addresses sidebar icon shifts, horizontal width/label transitions, reduced-motion behavior, and the brand-home hover/focus state. Full and rail logo activation returns to Overview with restrained feedback that respects reduced motion. Final checks passed: 110 frontend tests across sixteen files, TypeScript compilation, sixteen combined browser flows in 37.1 seconds, 76 Windows Rust tests across targets, and strict Clippy. A focused 27-test set also passed. The popup/native/engine routes are unchanged; matching build, installed-app, and artifact outcomes belong to external verification.

Browser geometry checks keep all ten navigation/Search/About SVG centers and sizes stable before, during, after, and while reversing the transition at default/minimum windows and 100%/140% text. Reduced-motion, full/rail Home navigation, pulse replay/cancellation/completion, and retained draft/preference behavior passed. Unmount/stale-animation completion are unit regressions. These are scripted interface checks, not new microphone/model accuracy runs or full 0.1.8 user acceptance.

## Historical 0.1.7 popup/navigation follow-up

The user gave positive visual feedback on the Ctrl + Windows popup but rejected the collapsed sidebar's upward icon shift and unnatural transition. This is scoped feedback, not full 0.1.7 acceptance.

CridVoice 0.1.7 corrects native recording-popup border/centering, scrollbar corners and outer overflow, collapsed icon navigation with named hover/focus tooltips, and shared button states. Output-mode/Automatic/Manual controls and illustrative style examples remain separate and unchanged in purpose. Final source checks passed: 108 frontend tests across sixteen files, TypeScript compilation, fourteen combined browser flows in 27.8 seconds, 76 Windows Rust tests, and strict Clippy. Focused sidebar/modal checks also passed 25 cases on the same production source. Browser tests cover named hover/focus tooltips and their dismissal, default Overview fit, compact popup fixtures, local code scrolling/corners, and readable hover/focus/danger states.

The reviewed native change is limited to popup shadow/resize flags and is bound in `validation/native-layout-delta-0.1.7.json` outside the source tree. It does not change engine/controller/model prompts. Browser data is scripted; actual installed native popup centering and matching build, installed-app, and artifact outcomes belong to external verification. Earlier Python/model runs retain their original versions, and no new user acceptance is claimed.

## Historical 0.1.6 candidate

The 0.1.6 candidate had an observed eight-pixel native centering offset despite passing source/browser checks, so it was not finally accepted. Its source results below remain historical; they do not establish 0.1.7 centering or user acceptance.

CridVoice 0.1.6 reduces the recording popup and centers its status label/waveform. Writing-style input/output examples follow the selected style using local illustrations without inference/provider calls. Output-mode selection is separate from automatic/manual language or shell hints; the user chooses the mode. Final checks passed: 107 frontend tests across sixteen files, TypeScript compilation, twelve combined browser flows, 76 Windows Rust tests, and strict Clippy. Four new native geometry cases cover work-area placement, DPI rounding, and clamping; the popup is 440×148 logical pixels with a 12-pixel logical gap. Browser fixtures cover centered stages/waveform, light/dark and 140% text, two-line preview clipping with complete accessible text, preview-off layout, all five style examples, and output/language controls. They use scripted data and do not constitute a real-microphone popup run.

Native engine/controller/model prompts were not changed. The earlier version-specific Python/model results remain historical evidence rather than new inference runs. Current results belong to [WINDOWS-VALIDATION-2026-10-13.md](WINDOWS-VALIDATION-2026-10-13.md); build, actual native popup/startup, and installed-app outcomes belong to matching external verification.

## Historical 0.1.5 interface follow-up

CridVoice 0.1.5 adds theme-aware scrollbars, a compact default Overview, hide/show navigation, complete preset surfaces, reactive System-mode preview, readable custom accents, and rapid Appearance-update protection. Final checks passed: 96 frontend tests across fourteen files, TypeScript compilation, nine combined browser flows, 72 Windows Rust tests, and strict Clippy. Browser checks use scripted IPC/media/clipboard behavior and cover actual preset surfaces, persisted custom colors/text size, sidebar and coding-draft preservation, rendered scrollbar thumbs, and default Overview fit. The fit target is idle 1200×820 at 100% text size with up to three recent rows; smaller windows, long results, and enlarged text still scroll.

The speech/cleanup sources match the preserved 0.1.4 engine hashes. Its 18 Python tests, eleven coding-model fixtures, and isolated warm measurements remain version-specific retained evidence rather than a new 0.1.5 model run. The user twice reported that installed 0.1.5 was now fast; that feedback is separate from measured fixture timings. Its UI results are recorded in the dated Windows report; matching build, actual native controls/startup, installed-app, and artifact outcomes belong to external release verification.

## Historical 0.1.4 cold-start/title-bar follow-up

The frozen 0.1.4 source passed 86 frontend tests across twelve files, five browser flows, TypeScript compilation, 72 Windows Rust tests, strict Clippy, and 18 Python tests. Installed 0.1.4 startup and selected-model warming were subsequently verified separately. Browser checks use scripted IPC/clipboard behavior; they do not establish native window dragging, target-app behavior, or real-user latency.

Fresh isolated speech-worker checks passed for CUDA in both test orders and CPU. The fixed 2.625-second SAPI sentence took 3.76-6.14 seconds on the first CUDA request, then 0.27-0.28 seconds on the first request after a 3.51-3.53-second warm-up. CPU still required about six seconds for steady transcription. Warm-up initializes local weights, synthetic ONNX VAD, and a bounded encoder/decoder pass without microphone, context, history, or provider calls. OS caches were not flushed. Build, native title-bar/startup/warming, and installed-app outcomes belong to the matching external release verification.

The final eleven-case 0.1.4 Qwen Vulkan run passed using the latest exported native prompts and native output parser. This includes the reported CLI-versus-Python-context scenario and an explicitly spoken dot. Exact tokens/formatting, Python AST, SQL EXPLAIN, and two PowerShell syntax cases passed; both PowerShell cases had zero parse errors. A bounded opening-only tagged transport wrapper is accepted after normal completion when no second fence exists, preserving the code remainder; token-limit/truncated responses remain rejected. No generated code or commands were executed. A separate isolated-server completion-stage check measured a 0.156-second warm request, 0.156-second first Python result, and 0.141-second following CLI result; server startup is excluded and OS/GPU caches were not flushed. These examples establish bounded fixture behavior rather than general language accuracy or complete dictation latency.

The accepted 0.1.3 coding release passed 71 frontend tests, five browser flows, TypeScript compilation, 57 Windows Rust tests, strict Clippy, and 12 Python tests. The user later confirmed normal Text and CLI insertion with that installed version and reported a slow first take. That user report is separate from instrumented evidence and from the new 0.1.4 source checks.

Two fixed synthetic coding-speech cases passed with Whisper Turbo/CUDA. Separately, all nine final Qwen Vulkan fixtures passed using the latest exported native prompts and native output normalization. Checks covered exact tokens/formatting/indentation, Python AST, SQL EXPLAIN, and two PowerShell syntax cases with zero parse errors. Manual Python over a Rust filename and generated Python/PowerShell were included. No generated code or commands were executed. Version-matched build, package, and installed-app results belong to the external release verification/checksum files. These fixed examples do not establish universal language accuracy or real terminal acceptance.

Before the technical-mode addition, the 0.1.3 frontend passed 55 tests across ten files, TypeScript compilation, and five browser flows after supplied-logo integration. These checks cover settings updates, ordered App snapshots, partially registered event-listener cleanup, wizard draft persistence, case-insensitive filtering, and pending/rejected panel saves. Render work is reduced through history metrics reuse, lazy wizard initialization, and reused search/shortcut parsing.

The same pre-feature native checkpoint passed 43 Windows Rust tests, strict Clippy, 12 Python tests, and packaged interpreter imports. Native work covered recording-generation checks for timers/previews and requests waiting for engine locks, lifecycle ordering, model-folder operation leases, WAV finalization outside the lifecycle lock, and binding credential lookup to the request's current provider ID/endpoint/protocol. Those results do not validate the later code/CLI addition. The provided-logo build and installer were assembled before technical modes, but 0.1.3 had not been installed. The user separately reported successful Notepad dictation with installed 0.1.2.

In the earlier 0.1.2 follow-up, the installed 0.1.1 app was running, but its selected managed cleanup components were missing. The corrected wizard installs the entire selected plan before finishing and displays download/verification/extraction progress. The user-changed Application Control state was recorded separately from the earlier blocked launch.

The final 0.1.2 checks passed: 31 frontend tests, five browser tests after the final download-race corrections, TypeScript compilation, 12 Python tests, 32 native Rust tests, and strict Clippy. Browser/setup regressions use scripted IPC and isolated assets. Separately, the actual native 0.1.2 validation copy started and its wizard downloaded the missing Qwen model/GPU runtime against current app data, with catalog hashes, all four installed markers, and unchanged normal settings verified. The wizard automatically closed, Test dictation became enabled, and the idle app quit normally. Microphone, hotkeys, and insertion were not instrumented in that pass; the later successful Notepad report came from the user. Final installed-app update, archive verification, and hashes are recorded in the matching external release verification/checksum files.

The same dated report preserves historical 0.1.1 checks: real packaged-interpreter imports, CPU/CUDA speech execution, verified Vulkan cleanup offload, DPAPI/Credential Manager tests, and desktop acceptance gaps. Completed artifact results and hashes belong in the matching release verification/checksum files; 0.1.1 artifact records do not validate 0.1.2.

## Historical 0.1.0 cloud validation

Build: CridVoice 0.1.0. Implementation/validation workspace: Debian Linux x64, Node 24.19, Rust 1.99, Python 3.12.14. Target: Windows 11 x64. This report distinguishes executed checks from required hardware checks.

| Check | Status |
| --- | --- |
| TypeScript / production frontend build | Passed |
| Frontend control/configuration tests | 5 passed |
| Browser setup / theme / vocabulary / provider persistence / key storage flows | 4 passed |
| Rust core/configuration/Unicode history/provider payload tests on Linux | 11 passed |
| Python service protocol/path/format tests | 4 passed |
| Windows MSVC-target native code check | Passed |
| Windows-target strict Clippy check | Passed |
| Actual CPU recognition on a public English audio fixture | Passed using Whisper Small |
| Packaged embedded Python and locked Windows wheels | Assembled, hash-verified |
| App-local Microsoft C++ runtime | Hash-verified; all 135 Python C++ import groups and both pinned llama.cpp runtimes resolve |
| Visual review of browser overview | Reviewed; no browser page errors |
| Windows installer build | Passed; Windows x64 app and packaged resource paths verified |
| Portable build | Passed; ZIP integrity, runtime layout, and included documentation verified |
| Real Windows microphone and keyboard-hook tests | Requires user's Windows test pass |
| RTX 5070 Ti speech / GPU cleanup | Requires user's hardware test pass |
| Windows Credential Manager and target-app insertion | Requires user's Windows test pass |
| User-scoped DPAPI round-trip and provider binding test | Included; execution requires Windows |
| Code signing / SmartScreen reputation | Unsigned personal evaluation build |

The tests exercise endpoint normalization/restrictions, response extraction, password-context exclusion, prompt constraints, configuration defaults, Unicode history, audio path/format limits, JSON-lines resilience, and actual interface persistence. They do not assert model accuracy or simulate Windows OS behavior.

These entries preserve the original cloud workspace's reported results and remaining requirements at that time. Use [WINDOWS-TESTING.md](WINDOWS-TESTING.md) for the full acceptance matrix and the dated report above for current Windows evidence. Production readiness remains unverified until the acceptance pass completes.
