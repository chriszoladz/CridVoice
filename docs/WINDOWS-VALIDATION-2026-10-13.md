# Windows validation: 2026-10-13

## Current 2026-10-17 follow-up: 0.1.15 configuration controls

CridVoice 0.1.15 adds deliberate shortcut capture with conflict checks, Cancel/Escape, a 30-second incomplete-capture limit, and default restoration. Common language/shell choices retain the same optional custom hint. Application rules offer common/recent/running/custom names and editing. Settings loads microphone choices when opened, preserves a disconnected saved choice, and adds section jumps and search keywords.

Provider model discovery is an explicit request from setup/the provider editor to the configured draft endpoint. It returns IDs without classifying capabilities, offers a custom-ID fallback, uses exact saved-credential binding, and does not persist typed keys. Loopback fixtures establish request behavior rather than real-provider support. The 0.1.14 current-take cleanup and clipboard protections are retained.

Final 0.1.15 automated counts, build/install outcomes, and scoped human feedback belong to matching external verification. At this source checkpoint they are pending; earlier versioned results remain historical. No current installed/user acceptance or new microphone/model accuracy is claimed.

## Historical 2026-10-17 follow-up: 0.1.14 shortcuts and repeated dictation

CridVoice 0.1.14 hardens Ctrl + Windows against stale modifier state and preserves the pairing of forwarded or suppressed Windows-key events, including repeats. Injected key presses cannot start recording. Release both shortcut keys between takes; a suppressed Windows key must physically release before another take can start.

Ordinary Text and literal code dictation send only the current transcript as source material. Existing selected/nearby text is excluded from those cleanup requests, preventing an earlier chat draft from being reintroduced. Application styles, vocabulary and local code-language detection remain available; explicit rewrite and code generation retain their permitted context.

The original Ctrl-only symptom cleared after restarting 0.1.13 and was not reproduced under the diagnostic. A read-only history overlap check found a separate take whose 5-word raw transcript became a 24-word cleaned result containing the entire previous 19-word result. These observations are distinct from automated regression evidence. Current test/build/install results and later human acceptance are recorded in the matching external release verification. Historical 0.1.13 inference/UI evidence is not a new 0.1.14 run.

## Historical 2026-10-15 follow-up: 0.1.13 independent CPU preview

CridVoice 0.1.13 uses a separate low-priority, two-thread CPU Whisper Tiny worker for local live preview. Setup or repair installs its pinned 78,203,619-byte download (about 75 MiB) only when local speech and live preview are enabled. The selected final speech model stays independently warm and recognizes the full take with its existing quality settings. Preview considers only the latest six seconds, first becomes due at about 750 milliseconds, then uses minimum 300-millisecond request intervals with one request in flight and no backlog. These are provisional chunk updates that can revise or drop older words, not a true per-word CTranslate2 callback or a typewriter animation. Remote preview retains its existing provider and cadence.

The popup keeps a fixed two-line area showing the latest recognized words; the entire current preview window remains accessible. Overview follows new text while the reader remains near the bottom and preserves a manually scrolled-back position. Corrections replace the hypothesis immediately, and partial words are not repeatedly announced by live regions. Preview failure remains separate from final recognition.

| Current 0.1.13 source check | Result |
| --- | --- |
| Frontend suite and TypeScript | 125/125 passed across 18 files; TypeScript passed |
| Scripted browser flows | 19/19 passed in 37.1 seconds |
| Native Windows suite and strict Clippy | 125/125 passed across targets; strict Clippy passed |
| Python worker | 29/29 passed |
| Synthetic preview/final performance | Matching external evidence; no general timing promise |
| Build, installed readiness, and user acceptance | Matching external verification; no current installed/acceptance claim from source checks |

The current preview model is a separately installed asset, not a replacement for the selected final model. Tests cover its role restriction, CPU identity, bounded audio/tokens, conditional setup, independent status, generation/cancellation/maintenance, corrected preview replacement, accessible text, and scroll/layout behavior. No actual microphone-to-visible-word latency is inferred from synthetic workers. Polish SAPI availability and any fixture limitations are recorded with external performance evidence.

## Historical 2026-10-15 follow-up: 0.1.12 local preview timing

The user confirmed installed 0.1.11 insertion with “Works good,” then requested an earlier first live preview. The user later reported “Preview is quicker and insertion works” for installed 0.1.12. These are scoped reports, not instrumented latency or full-release acceptance.

Version 0.1.12 schedules the first local preview request at about 750 milliseconds rather than 2.4 seconds and later local requests at 1.5-second intervals rather than 2.4 seconds. It permits one in-flight request. Model readiness and recognition speed still determine actual text arrival. The preview-only decoder uses greedy decoding with one candidate, no word timestamps, and no prior-window conditioning. Final recognition settings and the original remote 32-tick cadence, including skipped requests while busy, remain unchanged; the 0.1.11 clipboard correction is retained. Five new native scheduling regressions and three Python preview regressions cover these bounded changes. Native build, installation, and real-user timing belong to matching external verification.

| Current 0.1.12 source check | Result |
| --- | --- |
| Frontend suite and TypeScript | 116/116 passed across 17 files; TypeScript passed |
| Scripted browser flows | 18/18 passed in 40.8 seconds |
| Native Windows suite and strict Clippy | 108/108 passed across targets; strict Clippy passed |
| Python worker, preview regressions, and packaged imports | 21/21 passed in 0.759 seconds; packaged imports passed |
| Build, installed readiness, and real-user timing | Matching external verification; not asserted by source checks |

## Historical 2026-10-15 follow-up: 0.1.11 clipboard publication

The user reported “clipboard changed before paste” in installed 0.1.10. The 0.1.11 correction explicitly closes the write phase, then verifies the owner, per-paste marker, and exact Unicode bytes including the terminator under a fresh read lock. It accepts a sequence change only after that full proof and retains a strict final sequence/owner check before input. Restoration may accept a changed sequence only when the same owner/marker/text proof holds under its lock. Foreign text, marker, owner, or unknown sequence changes reject the lease. Failed setup writes restore originals before the initial write lock closes. Close/post-write errors never retry with Unicode, and restoration errors after any input warn that some text may already be inserted.

Late drift during UI Automation validation permits at most three proof/target-validation passes, each checking fresh focus, cancellation, and password state. A single dispatch closure sends input at most once; zero, partial, and full sends are never replayed. Production logic changes are confined to `src-tauri/src/clipboard.rs`. Speech/cleanup/model/controller sources remain unchanged apart from metadata and documentation.

The proposed cause is an inference from documented clipboard semantics rather than a native reproduction. The private-station fixture could not start with Access Denied 5, so it made no real clipboard call. The clipboard regressions use controlled operations rather than real microphone, clipboard, or target input. The user later confirmed installed 0.1.11 insertion with “Works good”; that scoped report does not turn the earlier fixture into an instrumented reproduction. Build, installed startup/update/readiness, and artifact outcomes belong to matching external verification.

The working source was restored from the verified 0.1.10 source archive, whose SHA-256 is `445c3ea261248e0746fff2f3d779290043edc4efa446aa0db344ae3684cc7c4f`. The new restoration baseline is `cbe16471006bd4f585aabb57c6378b969f252543`; the historical `095e359` checkpoint below remains release provenance rather than the restored repository's current commit. Retained npm/Cargo caches support offline dependency restoration, and the complete packaged Python runtime can be reused from the verified portable archive without downloading models or reading application data.

| Current 0.1.11 source check | Result |
| --- | --- |
| Frontend suite | 116/116 passed across 17 files in 9.0 seconds |
| TypeScript and Vite build | Passed |
| Browser flows | 18/18 passed in 35.0 seconds |
| Python suite and packaged imports | 18/18 passed in 0.663 seconds; dependency imports passed without inference |
| Native Windows suite and strict Clippy | 103/103 passed across targets outside the sandbox; strict Clippy passed |
| Clipboard-publication regressions | 19 clipboard tests, including 12 new regressions versus 0.1.10 |
| Real Windows publication reproduction | Unavailable: private station Access Denied 5 before clipboard access |
| Build and installed insertion | Matching external verification; not asserted by source checks |

The native result is recorded in `validation/native-checks-0.1.11.json`, bound to final clipboard SHA-256 `be1438a28c47bd6c709771c4daf9d4e6ac2e84e8c1e8e3c4f4381b4aecb79a29`. The interrupted preliminary 99-test run is not a final passing run. Browser checks use scripted bridge/data and new `0111` capture names. Packaged imports passed for NumPy 2.2.6, CTranslate2 4.8.2, faster-whisper 1.2.1, PyAV 19.0.1, and ONNX Runtime 1.31.0; they do not constitute fresh model inference or accuracy checks.

## Historical 0.1.10 clipboard-preservation follow-up

The user reported a clipboard-preservation error during Ctrl + Windows insertion. Version 0.1.10 uses Unicode typing only when an existing format cannot be safely preserved before any clipboard write or paste input. Busy/open failures and errors at or after the attempted write boundary never retry insertion. The Unicode path checks cancellation, physical modifiers, the original focus/control, and password exclusion before input. The saved insertion method stays unchanged, and the result remains available in the current session and in History when enabled. Build, installed-app, and artifact outcomes belong to matching external verification. Earlier checks below retain their original release versions. No 0.1.10 user acceptance is claimed.

The newest release package replaces old release ZIPs/folders after verification, as requested. Source Git history, toolchains, original logos, personal application data/models, and retained validation evidence remain separate from that cleanup. Older archives were preserved during their original checks; small historical proof reports and feedback remain in `validation/release-history` and `validation`.

| Current 0.1.10 source check | Result |
| --- | --- |
| Frontend suite | 116/116 passed across 17 files |
| TypeScript | Passed |
| Combined browser flows | 18/18 passed in 37.8 seconds |
| Native Windows suite and strict Clippy | 91/91 passed across targets; strict Clippy passed |
| New clipboard/native insertion regressions | 15 passed; snapshot/write boundary, fallback/non-retry, UTF-16, focus/password/cancellation, and partial-input reporting |
| Build and installed insertion | Matching external verification |

Native regressions use injected format/input failures and controlled focus/cancellation callbacks. A failure after an earlier successful Unicode batch reports possible partial insertion without replaying the prefix. These are not real clipboard, microphone, or target-app insertion tests. Browser checks use scripted bridge/data and intercepted clipboard behavior; their current report is `validation/browser-polish-results-0110-final`. The Settings hint capture is `validation/settings-insertion-hint-0110.png`. Earlier Python/model reports retain their original versions.

## Historical 0.1.9 shared-dialog follow-up

The Find a page screenshot showed a backdrop dimming content below the custom header while leaving the top bar and upper logo bright. Version 0.1.9 corrects full-window shared-dialog coverage, stacking, and focus handling. The bounded focus correction handles disabled Save/outside focus after a readable toast, captures the prior focus before autofocus, and prevents Ctrl + K from stacking search over an existing dialog. Setup reuses the Tab protection without changing busy/pause/close/Escape rules. It preserves the prior sidebar/logo and popup behavior without native desktop or engine changes. Build, installed-app, and artifact outcomes belong to matching external verification. No new user acceptance is claimed.

The backdrop covers the viewport from all four edges above the header/sidebar; dialog content sits above its scrim and feedback remains readable. Shared-dialog Escape/outside-click dismissal and prior-focus restoration remain available. A header click behind a shared dialog dismisses without dispatching a native window action. Counted scroll locks retain the document's previous overflow and restore it after the final modal cleanup. The setup focus reuse preserves its step focus and mandatory/busy/pause/dismissal rules.

| Final 0.1.9 source check | Result |
| --- | --- |
| Frontend suite | 116/116 passed across 17 files |
| TypeScript | Passed |
| Combined browser flows | 18/18 passed in 39.8 seconds |
| Native Windows suite and strict Clippy | 76/76 passed; strict Clippy passed |
| Dialog/browser proofs | Find a page, Help at 140% text, provider, history, confirmation, and busy setup passed with uniform coverage |
| Focus/stack regressions | Disabled/outside focus recovery, prior-focus restoration, Tab/Shift+Tab, Ctrl+K stacking guard, and balanced scroll-lock cleanup passed |
| Native scope | Desktop/engine source hash proof unchanged; no new popup/model changes |

The final scripted browser report is `validation/browser-polish-results-019-final` outside the source tree. Reviewed captures include `dialog-find-full-dark-019.png`, `dialog-help-{dark,light}-font{100,140}-019.png`, `dialog-provider-{dark,light}-019.png`, and `dialog-setup-busy-full-019.png`. These interface checks do not establish new microphone/model accuracy or user acceptance; actual installed behavior belongs to matching external verification.

## Historical 0.1.8 sidebar/brand follow-up

The user said “Looks right” about the installed sidebar/logo, then identified the Find a page backdrop issue. This is scoped interface acceptance, not broad voice or full-release acceptance. The original complete 0.1.8 release was archived during those checks. The later user-requested cleanup removes older release archives after verifying the newest package; small proof reports and scoped feedback remain in `validation/release-history` and `validation`.

Version 0.1.8 keeps navigation icons stable between expanded and collapsed states, animates horizontal sidebar width/content for 180 milliseconds while labels fade/clip over 110 milliseconds, and balances brand-home hover/focus styling. Shared vertical tracks keep icon positions fixed. Full and rail logo activation returns to Overview with a restrained 260-millisecond pulse; replay cancels the previous animation, unmount cleans it up, and stale completion cannot clear newer feedback. Reduced motion makes sidebar changes instant and skips the pulse. Popup/native/engine behavior remains unchanged. Build, installed-app, and artifact outcomes belong to matching external verification. No new user acceptance is claimed.

| Final 0.1.8 source check | Result |
| --- | --- |
| Frontend suite | 110/110 passed across 16 files |
| TypeScript | Passed |
| Combined browser flows | 16/16 passed in 37.1 seconds |
| Focused regressions | 27 tests passed |
| Native Windows tests across targets and strict Clippy | 76 tests passed; strict Clippy passed |
| Sidebar geometry | All 10 navigation/Search/About SVG centers/sizes stable before/during/after/reversal at 1200×820 and 900×640, 100%/140% text |
| Brand/reduced-motion behavior | Full/rail Home navigation, actual animation pulse/replay/cancel/completion, reduced-motion skip, and unmount/stale-finish guards passed |
| Retained UI behavior | Footer/Search, 64-pixel rail, preferences/drafts/actions, default fit, popup and style/control checks passed |

The final scripted browser report is `validation/browser-polish-results-018-verified` outside the source tree. Reviewed captures are `brand-{hover,focus}-{dark,light}-{full,rail}-018.png` and `sidebar-stable-{1200,900}-font{100,140}-018.png`. The supplied logos remain centered in a balanced transparent Home control without an oversized hover fill. The browser checks establish interface geometry/behavior and do not claim new microphone, model accuracy, or user acceptance. Earlier native popup/engine evidence retains its original version.

## Historical 0.1.7 popup/navigation follow-up

The user said “ctrl weindows pop up looks good” about the Ctrl + Windows popup, but rejected the collapsed sidebar's upward button shift and unnatural transition. This is scoped visual feedback rather than full 0.1.7 acceptance. Its original complete release was archived during those checks; retained historical proof reports keep their original versions after the later user-requested archive cleanup.

Version 0.1.7 corrects the native recording popup's border/centering, scrollbar corners and outer overflow, and shared button hover/focus states. Collapsed navigation retains an icon rail with named tooltips available on hover and keyboard focus. The 0.1.6 output-mode/Automatic/Manual controls and local illustrative writing-style examples are preserved. Actual native popup centering and matching native build, installed-app, and artifact outcomes belong to external release verification. No new user acceptance is claimed.

Native inspection traced the candidate's horizontal inset to the window framework's default shadow. The overlay-only correction disables native shadow/resizing while retaining the CSS card border; installed 0.1.7 geometry requires separate verification. **Collapse sidebar** / **Expand sidebar** retain a 64-pixel icon rail with eight page buttons, Search, About, and the supplied mark. The existing local interface preference remains separate from settings IPC. Tooltips work on hover and keyboard focus and clear on navigation, Escape, scrolling, resizing, or modal opening. Long prose wraps within the page; code preserves whitespace and scrolls locally in bounded result/dialog panes with themed corners. Shared hover/focus colors are neutral and shadow-free; danger actions retain a red tint/border and readable neutral text.

| Final 0.1.7 source check | Result |
| --- | --- |
| Frontend suite | 108/108 passed across 16 files |
| TypeScript | Passed |
| Combined browser flows | 14/14 passed in 27.8 seconds |
| Focused sidebar/modal regressions | 25/25 passed on the same production source |
| Native Windows suite and strict Clippy | 76 tests passed; strict Clippy passed |
| Native scope review | Popup-only shadow/resize delta bound in `validation/native-layout-delta-0.1.7.json` |
| UI/browser review | Icon rail/tooltips, hover/focus/danger states, local scrollbar corners, default fit, popup/style/control regressions passed; screenshots reviewed |
| Actual installed native centering/startup/warming | See matching external release verification |

The final browser report is `validation/browser-polish-results-017-verified` outside the source tree. Reviewed captures include `sidebar-rail-{focus,hover}-dark-017.png`, `sidebar-rail-hover-light-017.png`, `download-{hover,focus}-{dark,light}-017.png`, `code-scrollbar-corner-{dark,light}-017.png`, and `danger-hover-{dark,light}-017.png`. Browser checks use scripted bridge/session data and do not establish Windows popup geometry, microphone behavior, or new user acceptance. Engine/controller/model prompts were not changed; the earlier version-specific Python/model evidence remains historical.

## Historical 0.1.6 recording-popup candidate

The 0.1.6 candidate showed an eight-pixel native centering offset despite the source/browser passes below and was not finally accepted. Its source, installer, portable artifacts, and evidence were preserved in a candidate checkpoint. These earlier results do not establish the new 0.1.7 native correction.

The user requested a slightly smaller recording popup with the status label and waveform centered, writing-style examples that match the selected style, and clearer output versus language controls. Version 0.1.6 changes popup layout/native geometry, supplies local illustrative style previews without provider/inference calls, and separates selected output mode from automatic/manual language or shell hints. Auto never chooses Text, literal code/commands, or generation; the user selects that mode. Recording states, preview/appearance controls, shortcuts, and selected inference routes retain their processing behavior. Matching native build, installed popup/startup, and artifact outcomes belong to external release verification.

The native popup is 440×148 logical pixels, bottom-centered within the primary monitor's taskbar-excluding work area with a 12-pixel logical gap. Size and position use consistent DPI rounding and clamp to available space. The card centers the stage label/waveform, bounds visible preview to two lines while retaining complete accessible text, and removes the preview placeholder when preview is off. In the hold workflow, Text/code display **Release to finish** and generation displays **Release to review**. Processing stages keep the Escape cancellation hint. Synthetic loading/error layout fixtures do not add native popup opening for those states.

Writing styles use five local examples from the same corrected request, preserving Wednesday, approximate timing, CridVoice/dryRun identifiers, and the negation. The caption identifies the selected style and explains that exact AI wording may vary. Cleanup-Off/non-Text notices and the legacy identifier-preserving Code & technical prose style remain explicit. Code language/shell Automatic and Manual override controls preserve the existing freeform 80-character setting; pending/rejected saves and clearing an override retain truthful state. Native engine/controller/model prompts were not changed.

| Final 0.1.6 source check | Result |
| --- | --- |
| Frontend suite | 107/107 passed across 16 files |
| TypeScript | Passed |
| Combined browser flows | 12/12 passed: app 6, Appearance 3, overlay 2, writing styles 1; 21.9 seconds |
| Native Windows suite and strict Clippy | 76 tests passed; strict Clippy passed, including four new geometry regressions |
| Popup/browser layout | Light/dark, 140% text, preview-off and processing fixtures fit the compact bounds; screenshots reviewed |
| Style/control regressions | All five styles, Text-mode/reload preservation, illustrative notices, Auto/Manual and deferred/rejected/cleared saves passed |
| Default Overview regression | Text/code/generation with loaded/warming models still fit at default 1200×820 |

Browser checks use scripted bridge/session data and controlled theme media. They do not capture a microphone or establish actual installed popup geometry. Evidence is outside the source tree at `validation/browser-polish-results-016-final`, `overlay-recording-{dark,light}-016.png`, `overlay-large-text-016.png`, `overlay-preview-off-016.png`, `overlay-processing-016.png`, and `writing-style-example-016.png`. The earlier Python/model fixture reports retain their original versions; no new inference accuracy run is claimed.

Before this change, the user twice reported that installed 0.1.5 was fast: “Yes, fast now” and “fast now.” This is user feedback, separate from the synthetic timing measurements and from the new popup's acceptance. The original complete 0.1.5 ZIP was preserved, and the accepted bundle records the feedback in its `USER-ACCEPTANCE.json`.

## Historical 0.1.5 interface follow-up

The user requested custom scrollbars, a default Overview that fits without scrolling, and a way to hide the left navigation. Version 0.1.5 implements this interface follow-up while retaining the existing dictation, setup, model-warming, and code/CLI routes. Theme corrections complete preset surfaces, update System-mode preview when the system scheme changes, keep custom accent text readable, and preserve rapid Appearance updates. Matching native build, actual window-control/startup, installed-app, and artifact outcomes belong to external release verification.

The **Hide sidebar** / **Show sidebar** control hides the complete navigation and remembers the choice in a local interface preference without changing native settings. It preserves the active coding-language draft. The fit target is idle Overview at the default 1200×820 window and 100% text size, with up to three recent entries, across Text/Code/Generate and selected-model loading/loaded states. The 900×640 minimum, long results, and larger text continue to scroll normally. Themed Chromium scrollbars use a surface-colored track and muted thumb without arrow buttons. These layout conditions keep the no-scroll claim bounded to the default view.

| Final 0.1.5 source check | Result |
| --- | --- |
| Frontend suite | 96/96 passed across 14 files |
| TypeScript | Passed |
| Combined browser flows | 9/9 passed: six app flows and three Appearance flows, 25.4 seconds |
| Native Windows suite and strict Clippy | 72 tests passed; strict Clippy passed on 0.1.5 |
| Default Overview fit | Six mode/model-status combinations passed at 1200×820 with three recent rows and no result |
| Smaller/longer view and scrollbar | 900×640 footer reachable; actual custom thumb painted without arrow buttons; long results/enlarged text scroll |
| Theme/browser regressions | All 16 preset/light-dark combinations, custom black/white/midgray foreground and hover, reload persistence, reactive System/media preview passed |
| Existing speech/cleanup evidence | Unchanged engine hashes retain 0.1.4's 18 Python tests and 11 coding-model fixtures; no new model run claimed |

Browser results use scripted bridge/data, intercepted clipboard behavior, and controlled system-color media. They establish interface behavior, not native microphone/insertion or every Windows title-bar action. Reports and screenshots are outside the source tree at `validation/browser-polish-results-015-final` and `validation/layout-overview-{default,code-default,generate-default}-015.png`. The preserved 0.1.4 checkpoint/source commit is `5e1760`; its installed startup/warming evidence remains separate.

## Historical 0.1.4 cold-start follow-up

The completed 0.1.4 source and release were preserved before the 0.1.5 interface follow-up. Installed 0.1.4 startup and selected-model warming were verified independently; the source/fixture results below remain version-specific.

The user confirmed normal Text and literal CLI dictation both inserted correctly in the installed 0.1.3 app, then reported about 10-15 seconds for the first transcription and instant later takes. Inspection confirmed lazy Whisper/CUDA initialization and lazy managed llama.cpp startup. The accepted 0.1.3 installer, portable build, source, verification, and complete ZIP were preserved before this follow-up.

Version 0.1.4 moves selected installed managed speech and cleanup initialization into concurrent background preparation after launch, with live engine readiness and manual Load/Retry actions. Speech preparation exercises synthetic VAD and encoder/decoder work without microphone input; cleanup prepares the app's own local server. Explicit unload and stale-work cancellation are separate from recording state. Cold initialization still has a cost just after launch or unload; final processing can wait when recording starts before preparation finishes.

The custom title bar supplies drag, double-click maximize/restore, minimize, maximize/restore, and close-to-tray controls. Controls remain available during setup, startup, and error screens; the drag region excludes buttons. Browser regressions cover these command dispatches and layout, while actual native frame behavior is recorded in external release verification. Literal CLI intent now outranks unrelated source context. Native normalization is bounded to recognized executable/subcommand keywords and incidental sentence periods on bare commands; it preserves argument/quoted text case and explicitly spoken punctuation, and skips correction for rewriting or explicit casing directives.

| Cold-start follow-up source check | Result |
| --- | --- |
| Frontend suite | 86 passed across 12 files, including custom window controls |
| TypeScript | Passed |
| Browser flows | 5 passed with scripted IPC/data and an intercepted clipboard |
| Native Windows suite and strict Clippy | Final 72 tests passed; strict Clippy passed |
| Python boundary suite | 18 passed, including six warm-up regressions |
| Fresh isolated speech workers | CUDA, reversed-order CUDA, and CPU runs passed |
| Final Qwen Vulkan coding-model fixtures | 11/11 passed through the latest native parser; both PowerShell syntax checks had zero errors |
| Build, installed startup/warming, and real-user latency | See matching external release verification |

The nine actual coding-model fixtures below belong to 0.1.3. The user's later screenshot revealed clear CLI text misclassified from nearby Python context. A fresh eleven-case 0.1.4 Qwen Vulkan suite passed, including that scenario and an explicitly spoken dot. The latest exported native prompts and parser supplied the actual normalized results. Checks covered exact source/tokens/formatting, Python AST, SQL EXPLAIN, and two PowerShell syntax cases with zero errors. Opening-only tagged transport wrappers from normal completion are accepted only with no other fence delimiter, preserving the remaining source exactly; token-limit/truncation rejection remains intact. No generated code or commands were executed. Reports are `validation/coding-model-0.1.4-final/quality-report.json` and `powershell-parser-report.json` outside the source tree. These bounded fixtures do not establish accuracy across every language or real terminal acceptance.

A separate isolated Qwen Vulkan completion-stage measurement took 0.156 seconds for its warm request, 0.156 seconds for the first Python fixture, and 0.141 seconds for the next CLI fixture. These timings exclude local-server startup, use public defaults rather than user context, and were taken without flushing OS/GPU caches. They do not measure total dictation latency.

The 2.625-second public SAPI fixture took 3.76-6.14 seconds for the first transcription in fresh CUDA workers, then 0.27-0.28 seconds for the first transcription after an explicit 3.51-3.53-second warm request. Repeated takes were about 0.25-0.26 seconds. On CPU, first recognition took 9.94 seconds cold or 6.05 seconds after a 5.57-second warm request; subsequent CPU recognition remained about six seconds. These are speech-stage timings, not complete microphone/cleanup/insertion timings. Stage measurements overlap, OS file/GPU caches were not flushed, and user processes were not stopped. Both CUDA ordering runs passed the fixed word checks. Reports are `validation/speech-warm-014-{cuda,cuda-reversed,cpu}.json` outside the source tree; matching worker hashes bind them to this source.

## Historical 0.1.3 code and CLI follow-up

The user requested both literal code dictation and generation from spoken instructions. Technical modes use the existing speech and selected cleanup engines, with cleanup required. Auto language/shell hints use available bounded context only when enabled, or the spoken request when context is unknown; arbitrary manual overrides remain available. Literal code cleanup is instructed to preserve identifiers, syntax, operators, switches, quoting, paths, and indentation. Mode-aware response handling removes a surrounding model code fence while preserving indentation. Generation opens the main window for review and Copy and does not automatically insert into an editor or terminal. Literal multiline output to a recognized terminal also requires review. No Enter keystroke is added. A terminal can interpret a manually pasted multiline result according to its own behavior.

Cleanup/conversion failures retain speech as **Raw transcript**, clear its code-language tag, and use raw-mode history labels rather than presenting it as finished code. Successfully generated output remains reviewable/copyable if history saving subsequently fails. The old prose prompt and legacy `style: "code"` settings have compatibility tests.

| Coding-release source check | Result |
| --- | --- |
| Full frontend suite | 71 passed across 11 files |
| TypeScript compilation | Passed |
| Browser flows | 5 passed; scripted IPC, synthetic assets, and stubbed clipboard |
| Native Windows Rust suite | 57 passed |
| Native strict Clippy | Passed |
| Python boundary suite | 12 passed |
| Synthetic coding speech | 2 fixed public English cases passed using Whisper Turbo/CUDA; word checks only |
| Final Qwen Vulkan prompt/output fixtures | 9/9 passed using the latest exported native prompts and native output normalization |
| Final native build/packages/install | See matching external release verification |

The speech word checks alone do not establish syntax-correct code; raw Python recognition included a stray punctuation mark. The final model run used the latest exported native prompts and `core::extract_output`, covering transport fences, language metadata, exact tokens, formatting, and indentation. Its nine cases covered literal Python, Bash CLI, a quoted PowerShell path, TypeScript, Rust, SQL, manual Python overriding a Rust filename, generated Python, and generated recursive PowerShell log-file filtering. Python AST, SQL EXPLAIN, and both PowerShell syntax cases passed; the PowerShell parser reported zero errors. The manual-override fixture's actual model language tag was Python.

The local Qwen Vulkan run confirmed 37/37 layers offloaded and stopped its own child process afterward. No generated code or commands were executed. Reports are stored outside the source tree at `validation/coding-model-0.1.3-release/quality-report.json` and `powershell-parser-report.json`. These fixed fixtures do not establish correct semantics or accuracy across every language. Real microphone/code dictation, automatic editor/shell detection across applications, and terminal insertion remain separate acceptance work.

The earlier 55 frontend, five browser, 43 Rust, and 12 Python passes below cover the provided-logo/polish checkpoint before these technical modes. They remain historical. Final feature/build/install outcomes belong in the matching external release verification. The provided-logo native build and installer were assembled, but were not installed before this new feature was requested.

## Completed 0.1.3 desktop polish and race checkpoint

This follow-up simplifies the sidebar and recording controls, removes promotional profile content and filled status pills, and uses plain status labels and the user's supplied waveform logo for the app, native Windows icons, and neutral offline help. The supplied artwork provides matching marks and wordmarks for light/dark surfaces; offline help embeds the PNGs in its single HTML file. Setup uses compact **AI processing**, **Speech recognition**, **Preferences**, and **Install components** stages. Accessible progress labels and pause/resume/retry actions are retained. Selected processing routes, model assets, credential storage, and insertion methods are preserved.

Bounded render cleanup initializes the wizard's settings clone once, reuses saved-history metrics until history changes, normalizes search queries once per render, splits shortcut text once, and removes an unused component. These reduce repeated work; no latency or recognition-speed improvement is claimed. The App rejects older startup/state responses and cleans up event listeners if registration fails partway through.

Vocabulary and application-style saves guard duplicate submissions, catch rejected saves, and retain newer or failed drafts. Provider editor revisions prevent an earlier save from closing a later editor or erasing newer key typing; blank keys preserve existing credentials. Provider/vocabulary/style collection updates use current settings, including provider removal after its awaited credential operation. History deletion only closes the matching selected entry. Ten focused deferred/rejected-mutation tests cover these corrections.

Native timers, automatic recovery/stop actions, preview commits, and status changes carry a recording generation and recheck it under the lifecycle lock. Older work cannot mutate a restarted session. The capture device closes during the short stop transition; resampling and WAV writing then run as blocking work outside the lifecycle lock. Obsolete or failed temporary WAV files are removed. Model-folder leases prevent a download and removal from modifying the same component concurrently and release on cancellation, while allowing operations on other components. These are controller/fixture checks, separate from live microphone acceptance.

Speech and cleanup requests also recheck their recording generation after acquiring the engine lock, so a cancelled waiter cannot restart a worker/server after shutdown. Credential lookup holds the current settings lock and verifies that the request's captured provider ID, endpoint, and protocol still match. A removed or redirected provider is rejected before key lookup; key rotation at the same endpoint remains supported. The credential storage format is unchanged. The final native tests cover both cancelled engine waiters and changed provider bindings without using real credentials.

| 0.1.3 checkpoint before technical modes | Result |
| --- | --- |
| Full frontend suite | 55 passed across ten files after source freeze |
| TypeScript compilation | Passed |
| Browser flow suite | 5 passed after supplied-logo integration; scripted IPC and synthetic assets |
| Offline help | Generated; all 13 guides/internal links checked; supplied light/dark PNGs embedded, decoded, and correctly selected; layout inspected at 900×640 without horizontal overflow |
| Native Windows Rust suite | 43 passed after final source freeze |
| Native strict Clippy | Passed after final source freeze |
| Python boundary suite | 12 passed |
| Packaged interpreter imports | Passed |
| Provided-logo native build and installer assembly | Completed before technical modes; rebuilt feature artifacts still require verification |
| Package integrity and 0.1.3 installed-app update | See matching external release verification; installed update had not run at this checkpoint |

Final version-matched results and artifact hashes belong in the external `release/VERIFICATION.json` and `release/SHA256SUMS.txt` beside the 0.1.3 deliverables. The 0.1.2 results below do not establish those 0.1.3 outcomes, and the new version had not yet been installed at this source checkpoint.

Before requesting the UI changes, the user reported that holding Ctrl + Windows in Notepad produced text and that installed 0.1.2 worked well. This is user-reported confirmation of that workflow, not an instrumented microphone/hotkey/insertion acceptance pass or a 0.1.3 runtime result. The completed 0.1.2 bundle and source checkpoint were backed up and preserved before this revision, including the separate `CridVoice-0.1.2-complete.zip` archive.

## Completed 0.1.2 setup and repair follow-up

At the start of this follow-up, the installed 0.1.1 app was running at the current-user installation path `AppData\Local\CridVoice\cridvoice.exe`. A read-only check found the user-changed Application Control policy-state value was 0. A native validation copy of 0.1.2 subsequently started successfully, with file/product versions and executable hash verified. The earlier blocked portable launch remains historical evidence below; this work did not change security policy.

The current installed settings selected local Whisper Turbo/Automatic speech and managed Qwen3/Automatic cleanup, while only `whisper-turbo` and `nvidia-runtime` model directories were present. The cleanup model and GPU cleanup runtime were missing. The old wizard could save completed setup before optional downloads, so selected speech components alone did not establish a complete local setup. This finding does not confirm the cause of the original Processing freeze.

The 0.1.2 correction keeps installation inside the wizard. It lists all selected local components and missing download size, automatically awaits every missing component after **Install required components & finish**, reuses installed assets, and shows per-component/overall download plus verification/extraction progress. Pause/resume and retry preserve usable partials and completed components. The wizard remains open until a fresh snapshot and native `complete_setup` readiness check succeed.

The final race corrections join an existing download if it starts between the snapshot and the install command. If the installed-marker and active-job map appear inconsistent during completion, the wizard allows three fresh checks separated by 500 ms before declaring the job stopped. This bounded coherence check does not bypass installed markers or the final native readiness gate.

Repair starts from existing settings, preserves independent speech/cleanup provider IDs, disabled cleanup, key metadata, and normal preferences, and writes a key only when a new nonblank value is entered. Unknown required IDs, unsupported NVIDIA speech selection, or invalid provider/model configuration prevent readiness. Fully provider-based routes need no local assets; browser preview cannot complete a plan requiring local components. Installed components remain distinct from actual resident models in `engineStatus`.

| 0.1.2 check | Current result |
| --- | --- |
| Complete local CPU/GPU requirement plans and provider validation | 6 frontend helper tests passed |
| Desktop bridge/event setup regressions, scripted IPC | 10 passed, including download collisions and separately-read marker/job completion state |
| TypeScript compilation | Passed |
| Native Windows Rust suite, including setup/download progress regressions | 32 passed |
| Native strict Clippy | Passed |
| Full frontend suite | 31 passed |
| Python boundary/packaging suite | 12 passed |
| Browser flow suite | 5 passed again after the final download-race corrections |
| Wizard visual layout | Inspected at 1440×1000 and 900×640; sticky active extraction stage and footer visible without horizontal overflow |
| Native 0.1.2 release build | Passed |
| Native 0.1.2 validation-copy startup | Passed; checked file/product versions and executable hash |
| Actual native setup repair against current app data | Passed with one primary action: visible live Qwen progress, missing model/runtime downloaded, all four markers present, wizard automatically closed, Test dictation enabled |
| Downloaded cleanup assets | GGUF and Vulkan ZIP SHA-256 matched the locked catalog |
| Existing normal settings and original speech/runtime markers | Preserved; normalized settings hash excluding setupComplete identical before/after; original two installed markers retained |
| Native idle state and graceful Quit | Passed after repair; normal menu handler used, no forced process termination |
| 0.1.2 NSIS installer assembly | Passed; installed-app update results belong to the matching release verification |
| Final installer/portable/source packages and hashes | See matching release verification and checksum files beside the deliverables |

Desktop setup and browser regressions use scripted Tauri IPC/events and synthetic tiny catalog entries. Native unit download tests use isolated fixtures. These automated tests remain distinct from the later actual 0.1.2 validation-copy startup and wizard repair using current application data and real multi-gigabyte cleanup downloads. The real repair's downloaded GGUF/archive hashes, installed markers, and unchanged normal settings were independently checked. Native verification/extraction labels completed too quickly to capture separately; those visible stages are covered by scripted UI/fixture tests, while actual downloaded hashes and installed readiness were checked directly. The wizard closed automatically, the app became idle with Test dictation enabled, and graceful Quit used its normal menu handler. Microphone, global hotkeys, and insertion were not tested. Final installer execution, update preservation, archive verification, and hashes are recorded beside the matching 0.1.2 deliverables in `release/VERIFICATION.json` and `release/SHA256SUMS.txt`, outside bundled documents.

The generated current-user NSIS installer was also reviewed read-only. Its `/UPDATE` mode skips old-version uninstallation and preserves application data; `/S /UPDATE` supports an unattended same-user update. Settings/history/models under `com.cridvoice.desktop` are separate from the executable/resource directory, and the installer contains no credential deletion operation. Silent installation can force-close a running target through Windows Restart Manager, so the app must be idle and quit normally before updating. This source review is separate from actual installer execution and before/after preservation verification, whose final outcomes belong to the external release verification.

## Historical 0.1.1 Windows validation

CridVoice 0.1.1 was built and checked on the user's local Windows 11 machine. The original unsigned 0.1.0 downloads were preserved. This report records a bounded Windows validation pass, not production readiness. Final artifact assembly, integrity, startup checks and hashes are recorded separately in `release/VERIFICATION.json` and `release/SHA256SUMS.txt` beside the deliverables.

The user reported a Processing freeze in the original application. Its actual cause remains unconfirmed. Synthetic worker inference passed, but no real microphone session or original desktop freeze was reproduced during these checks.

## Machine and toolchain

| Component | Checked value |
| --- | --- |
| OS | Windows 11 Pro, version 26H2, build 26300.9550 |
| CPU | AMD Ryzen 7 9800X3D |
| RAM | 64 GB |
| GPU | NVIDIA GeForce RTX 5070 Ti |
| Reported GPU memory | 16,303 MiB |
| NVIDIA driver | 616.56 |
| Microsoft WebView2 | 154.0.4258.62 |
| Native Rust toolchain | Rust 1.99, `x86_64-pc-windows-msvc` |
| Windows build prerequisites | MSVC 14.44 and Windows SDK 26100, prepared locally for this run |
| Packaged Python | Embedded Windows Python 3.12.10 |
| Windows inference dependencies | 23 distributions from the existing committed lock |
| Speech components | faster-whisper 1.2.1, CTranslate2 4.8.2 |
| Speech smoke model | Existing Whisper Large v3 Turbo |

The existing installed models were read through workspace scratch junctions. No model/voice downloads were required for speech tests. Real settings, history, credentials, and installed model files were preserved.

## Changes covered by this pass

- Ordered recording transitions and cancellation handling reduce start/stop races. The recording bar now distinguishes Transcribing, Cleaning, and Inserting and shows Escape cancellation.
- Local inference timeouts have separate queue and processing budgets. Final speech can wait behind a preview instead of timing out before that preview finishes.
- Child stdout/stderr pipes are drained concurrently. Only fixed diagnostic categories and safe numeric Windows codes survive classification; raw child output and sensitive content are discarded.
- The private speech protocol rejects malformed, non-object, and oversized requests without killing the worker. Native-library output is separated from protocol stdout.
- Live `engineStatus` separates a selected model, installed files, and an actual app-managed resident model. Events refresh all windows, and a two-second backend monitor checks child state and installed markers. No page reload or app restart is required for these updates.
- Saved microphone selections remain visible before device enumeration. Rejected shortcut drafts return to the persisted value.

Live model state describes CridVoice's own speech/cleanup processes. It does not inspect model residency in LM Studio, external llama.cpp, or cloud providers. Installed-marker monitoring does not re-hash every model file on each poll.

## Executed checks

| Check | Result |
| --- | --- |
| Original downloaded bundle hashes | Verified against supplied checksums |
| Original portable resource layout and executable version | Passed; Python/service/help/catalog present, executable 0.1.0 |
| Original packaged Python imports | Passed on Windows: NumPy, ONNX Runtime, CTranslate2, faster-whisper, PyAV, tokenizers |
| Original installed wheel RECORD checks | 2,179 file hashes verified across 23 distributions; no missing/mismatched files |
| Updated locked Python runtime preparation/imports | Passed with existing dependency lock |
| TypeScript / production frontend build | Passed |
| Frontend tests | 15 passed |
| Browser flow tests | 4 passed; browser preview does not validate native integration |
| Native Windows Rust tests | 21 passed, including DPAPI/provider binding, diagnostic handling, ordered controller, and speech queue checks |
| Additional Credential Manager dummy round-trip/deletion test | Passed; unique dummy record removed after the test, only provider-bound ciphertext stored |
| Native Windows strict Clippy | Passed |
| Python boundary/protocol tests | 10 passed |
| Portable rebuild data-preservation regression | Passed; a used portable output folder is left intact |
| Original Whisper Turbo CPU speech | Passed using local synthetic English audio |
| Original Whisper Turbo RTX 5070 Ti CUDA speech | Passed using local synthetic English audio |
| Updated Whisper Turbo CPU speech | Passed; actual loaded model/device and unload cache status verified |
| Updated Whisper Turbo RTX 5070 Ti CUDA speech | Passed; actual loaded model/device and unload cache status verified |
| Qwen3 cleanup completion in CPU/GPU modes | Passed using a scratch copy of the installed Vulkan distribution; Vulkan model buffer and 37/37 layers offloaded verified |
| 0.1.1 native release executable | Passed; native optimized x64 MSVC build |
| 0.1.1 installer / portable ZIP / release hashes | See the separate release verification and checksum files |
| Final extracted portable Python imports | Passed at a path containing spaces and Polish characters |
| Rebuilt portable application startup | Blocked by Windows Application Control before the process launched |

The initial Python test attempt failed because the sandbox-generated Temp directory denied access. Redirecting test temporary files to a workspace scratch directory allowed the original four tests to pass; this was an execution-environment issue, not a reproduced CridVoice failure. The final expanded Python suite passed ten tests.

DPAPI checks used dummy credentials. They verify the encryption/provider-binding boundary, not real provider authentication or the complete provider settings flow in an installed application. The browser and frontend tests cover live refresh behavior with controlled data; they do not establish microphone, global shortcut, target-app, or GPU integration.

## Speech smoke evidence

Windows desktop SAPI generated a fixed public English phrase as 16 kHz mono 16-bit PCM, lasting 2.625 seconds. Both workers returned successful health, transcription, and unload responses and detected English. Expected checks for meeting, Wednesday, and the equivalent number three or exact digit 3 all passed. Exact token matching excludes unrelated values such as 13 or 30.

| Worker | Device | Worker-process elapsed time |
| --- | --- | --- |
| Original 0.1.0 service/runtime | CPU | 6.609 seconds |
| Original 0.1.0 service/runtime | CUDA | 3.547 seconds |
| Updated service/fresh locked runtime | CPU | 6.094 seconds |
| Updated service/fresh locked runtime | CUDA | 3.531 seconds |

These measurements include process startup, imports, model loading, recognition, and unload, after fixture generation. They are smoke-test timings, not an isolated inference benchmark or a promise for longer recordings. File/device caches and other workloads can affect repeated runs.

The updated worker reported `modelLoaded: true` with `whisper-turbo` and the correct CPU/CUDA device after speech, then `loadedModel: null` after unload. This checks actual cache reporting rather than inferring loading from an installed marker or a successful health response.

Safe JSON reports are saved outside the source tree under the project's `validation/` folder:

- `speech-original-cpu-en.json`
- `speech-original-cuda-en.json`
- `speech-updated-cpu-en.json`
- `speech-updated-cuda-en.json`
- `speech-polish-availability.json`

Reports contain public fixture word checks, timings, model/device metadata, worker SHA-256, and protocol outcomes. They contain no transcript or real audio. Generated scratch WAV and PowerShell fixture files were removed. Existing models and their workspace mappings were preserved.

Polish recognition was not exercised. The enabled desktop SAPI voices on this machine were both `en-US`, so a Polish synthetic fixture was unavailable without installing a voice. No voice downloads were performed. This does not establish a limitation of Whisper's Polish support.

## Cleanup smoke evidence

The existing Qwen3 4B Q4_K_M and a scratch copy of the installed llama.cpp Vulkan distribution returned HTTP 200 and the expected public `READY` completion in both requested GPU and CPU modes:

| Requested mode | Readiness time | Completion time |
| --- | --- | --- |
| GPU, 99 requested GPU layers | 4.890 seconds | 0.828 seconds |
| CPU, zero GPU layers | 2.563 seconds | 0.328 seconds |

The CPU test used the copied GPU/Vulkan runtime with offload disabled. It does not validate the separately pinned CPU runtime distribution. A subsequent GPU-only check observed 37/37 layers offloaded to GPU and a Vulkan0 model buffer, with a successful READY completion; readiness took 3.922 seconds and the request took 0.063 seconds. Only fixed success flags and layer counts were retained from child output. These short readiness/completion tests do not assess dictation cleanup quality or real English/Polish intent preservation.

## Runtime budgets

| Stage | Limit |
| --- | --- |
| Local speech preview queue | 15 seconds |
| Local final speech queue | 60 seconds |
| Local speech preview processing | 45 seconds |
| Local final speech processing | 240 seconds |
| Managed cleanup startup/readiness | 120 seconds |
| Chat HTTP request | 180 seconds |

These are separate stage budgets, not one end-to-end deadline. Provider audio requests use the HTTP client's 180-second request timeout. Errors never cause automatic cloud fallback. Cancellation invalidates pending insertion even when a processing operation has already started.

## Artifact status

Artifact paths, relative to the source root, are below. Assembly, integrity and startup outcomes belong to the separate `release/VERIFICATION.json`; hashes are in `release/SHA256SUMS.txt`. Hashes are kept outside bundled documents to avoid changing an artifact's contents when recording its own checksum.

| Deliverable | Target location | Current status |
| --- | --- | --- |
| Native installer | `src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis/` | See release verification |
| Portable ZIP | `release/CridVoice-0.1.1-windows-x64-portable.zip` | See release verification |

The build remains an unsigned personal evaluation release. Installer assembly alone does not establish successful installation or clean-machine startup. NSIS includes English and Polish languages, but the bundler reports that some custom Tauri installer messages do not have Polish translations and may appear in English.

## Historical 0.1.1 application launch blocker

Launching the rebuilt extracted portable executable failed with: "An Application Control policy has blocked this file." Windows Code Integrity events 3033 and 3077 confirm an enforced signing-policy block for that executable, with policy ID `{0283ac0f-fff1-49ae-ada1-8a933130cad6}`. A separate event 3076 is audit-only and did not cause the block. The application and installer are unsigned. The Smart App Control policy-state registry value is 1; the enforcement event itself establishes that launch was blocked.

The app process did not launch, so desktop startup, microphone and insertion behavior remain unverified. Packaged Python imports and isolated CPU/CUDA/Vulkan inference did run successfully. Security policies and existing application data were not changed. This blocker is distinct from the user's earlier Processing freeze in 0.1.0.

Microsoft documents [trusted code signing for Smart App Control](https://learn.microsoft.com/en-us/windows/apps/develop/smart-app-control/code-signing-for-smart-app-control). No trusted signing identity was supplied for this personal build. The final release verification records the blocked startup, rather than claiming a passed desktop test.

## Remaining Windows acceptance work

- Reproduce the original Processing freeze with its exact settings and real microphone input.
- Test microphone permissions, device changes, unplugging, and real audio quality.
- Test both Ctrl/Windows press and release orders, left/right keys, toggle/rewrite shortcuts, rapid transitions, and Escape in the actual desktop application.
- Verify original-target insertion, focus changes, password exclusion, privilege restrictions, multiline behavior, and clipboard restoration in real target applications.
- Install and launch the new installer and fully extracted portable build; test tray, startup, offline operation, scaling, and recovery.
- Exercise the separately pinned CPU cleanup runtime and test selected external providers with intended configurations.
- Check real English/Polish accuracy, automatic/manual language selection, mixed speech, quotations, negation, uncertainty, and spoken self-corrections.

Use [WINDOWS-TESTING.md](WINDOWS-TESTING.md) for the complete acceptance matrix. Historical Linux/cloud checks remain in [VALIDATION.md](VALIDATION.md) and are not substituted for these Windows tests.
