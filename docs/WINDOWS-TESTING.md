# Windows 11 acceptance checklist

Run this on the actual Windows 11 machine before treating CridVoice as production-ready. Use both installer and portable artifacts. Record findings rather than assuming compilation establishes behavior.

## Record the machine

- Windows version/build, CPU, RAM, and display scaling.
- GPU model and VRAM (RTX 5070 Ti desktop/laptop variants can differ).
- NVIDIA driver version and `nvidia-smi` output.
- CridVoice build/hash, model IDs, and runtime catalog versions.

## Packaging and first run

- [ ] Installer runs as the current user, offers English/Polish installer language, and checks WebView2.
- [ ] Installed app starts without a system Python installation.
- [ ] Portable ZIP works after full extraction; data stays in its `data/` directory.
- [ ] A path containing spaces and Polish characters works for both forms.
- [ ] First-run managed, LM Studio, and cloud routes persist their choices.
- [ ] No model downloads happen unless selected; displayed sizes are accurate.
- [ ] Download interruption/pause resumes; completed models verify and work offline.
- [ ] API keys can be saved, preserved when blank, and removed with a provider.
- [ ] Keys do not appear in settings/history/export files.
- [ ] Closing hides to tray, reopening works, Quit stops inference children.
- [ ] Startup launches quietly and disabling startup removes the registration.

## Audio and shortcuts

- [ ] Repeat short takes in the same chat field with Ctrl first and Windows first, releasing both between takes. Each take inserts once without including the earlier result.
- [ ] Keep the caret in the same field through preview and processing; check automatic insertion. Deliberately focus another field/window during processing and confirm insertion is blocked with the appropriate message.
- [ ] Enable **Lower background audio while speaking** while music/video plays. Check the slight reduction during recording and restoration on release, Escape, microphone error and normal Quit. Turn it off and confirm playback stays unchanged.
- [ ] Change the player's Windows session volume during recording and confirm that adjustment is retained afterward. Test newly started playback on an already connected output. Record unsupported exclusive-mode/device-switch behavior separately.

- [ ] Default and explicitly chosen microphones work, with Windows privacy permissions on/off.
- [ ] Test dictation returns text without inserting into another app.
- [ ] Ctrl alone and Windows alone never start recording, including after earlier takes.
- [ ] Ctrl then Windows, and Windows then Ctrl, both begin hold recording.
- [ ] Release either modifier first; recording stops, both keys are released, and insertion happens once.
- [ ] Left/right Ctrl and Windows combinations work without opening Start.
- [ ] Rapid taps, repeated presses, and an empty/silent take do not leave recording stuck.
- [ ] Two different takes in the same unsent chat draft append only each new take; no previous sentence is repeated.
- [ ] Toggle shortcut starts/stops; Escape cancels and prevents stale insertion.
- [ ] Unplugging/changing a microphone produces an actionable error or recoverable state.
- [ ] Recording limit ends cleanly; no temporary WAV survives a completed request.
- [ ] Waveform, transcript preview, and floating bar toggle independently.
- [ ] Multi-monitor / 100%, 125%, 150%, 200% scaling leaves the bar visible and legible.

## Inference

- [ ] GPU speech starts on the RTX 5070 Ti with installed NVIDIA speech runtime.
- [ ] CPU speech starts on the same machine without GPU runtime dependence.
- [ ] CPU text cleanup and GPU text cleanup both start and return text.
- [ ] Cold-load and subsequent-take latency are recorded.
- [ ] Unload frees process/GPU resources when idle.
- [ ] GPU memory pressure, missing libraries, and an unavailable driver produce clear messages.
- [ ] Local errors never cause cloud requests.
- [ ] A complete local setup works with the network disabled.
- [ ] LM Studio and external llama.cpp connections work with exact model IDs.
- [ ] Selected OpenAI-compatible text/audio and Anthropic-compatible text providers work with real credentials.
- [ ] An invalid key/model/URL, rate limit, and disconnected provider are handled without exposing sensitive data.

## Language and intent matrix

Speak naturally rather than reading punctuation symbols. Test English, Polish, language switches across takes, and mixed speech. Compare both raw and cleaned history.

| Input | Check |
| --- | --- |
| “Let's meet Tuesday, actually Wednesday, at three.” | Wednesday replaces Tuesday; time retained |
| “At five, sorry six. Don't cancel the booking.” | Final time and negation retained |
| “I might choose Tuesday or Wednesday.” | Alternatives and uncertainty preserved |
| “She said, ‘Actually Wednesday,’ but I disagreed.” | Quotation is not treated as your correction |
| “Spotkajmy się we wtorek, nie, właściwie w środę o piętnastej.” | Środa and time retained with Polish spelling |
| “Nie odwołuj spotkania z Łukaszem.” | Negation, diacritics, and vocabulary name retained |
| “Wyślij update do teamu, actually do klienta.” | Mixed-language meaning preserved, no automatic translation |
| “First… no, let me start again…” with a revised sentence | Abandoned start handled without invented facts |

Add real subtle corrections you use. An LLM prompt test is not an accuracy benchmark. If a selected model repeatedly changes intent, reduce stylistic rewriting or select a stronger external cleanup model.

## Target applications and context

- [ ] Notepad multiline text and Polish characters.
- [ ] Chrome/Edge ordinary textarea and contenteditable editor.
- [ ] Outlook, Teams/Slack, VS Code, and your usual applications.
- [ ] Selection rewrite replaces only the selected text.
- [ ] Changing windows or input fields while processing prevents wrong-field insertion.
- [ ] Password fields do not contribute context or receive dictation.
- [ ] Disabled context omits selected/nearby text from provider requests.
- [ ] Unicode insertion leaves clipboard data unchanged.
- [ ] Default clipboard paste preserves existing text, images, rich text, and file lists; concurrent new clipboard contents are not overwritten.
- [ ] An unpreservable clipboard format triggers Unicode typing before any clipboard write, while busy/paste/partial-input/restoration failures do not duplicate insertion.
- [ ] Multiline dictation does not send a chat message, submit a form, or execute terminal commands automatically.
- [ ] Elevated targets / secure desktops reject input clearly; saved output can be copied.
- [ ] Remote desktop and terminal behavior is recorded separately if used.

## Interface and data

- [ ] Minimum window dimensions, scrolling, all presets, both modes, system changes, and large text work.
- [ ] Keyboard navigation reaches settings and dialog actions; focus remains visible.
- [ ] Vocabulary aliases and per-app styles persist and affect actual output.
- [ ] History saves, filters, searches, copies, exports, deletes, clears, and applies retention.
- [ ] Cleanup failure saves recognized text without silently inserting it.
- [ ] A restart recovers from interrupted inference/downloads and removes leftover recordings.

## Result record

Copy this document into a dated test report, mark pass/fail, attach concise reproduction steps for failures, and list any app/model/driver combinations excluded from the release. Public distribution additionally requires signing and installation tests on clean Windows machines.
