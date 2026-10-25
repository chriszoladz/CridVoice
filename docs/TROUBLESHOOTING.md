# Troubleshooting

## Speech is in History but did not insert

The transcript is saved before insertion, so a saved result does not prove the target field accepted it. Copy the result from History if needed.

CridVoice 0.1.16 rechecks a transient missing/different accessibility node for up to five samples, spaced 20 ms apart, accepting only the original window and field. Stable focus adds no wait. A real window change or password field stops immediately. It never forces another window into focus or replays input after a partial paste/type.

The message distinguishes a changed window, a different field and a field Windows could not identify. Keep the original field focused until insertion completes. If an app does not expose a verifiable input field through Windows accessibility, Copy remains available. For administrator apps, CridVoice needs compatible elevation; running normal applications normally is preferable.

## Lower background audio

**Settings → Speech recognition → Lower background audio while speaking** is off by default. **Background audio reduction** controls the reduction from 10% to 90%; the new default is 60%. If 0.1.16's fixed 25% sounded too subtle, raise the slider and start a new recording. It affects supported per-session playback on currently active outputs and restores volumes after stop/cancel, recording errors, or normal exit. It leaves system volume, mute state, microphone and system sounds alone. Observed manual session-volume adjustments during a take are retained.

Windows audio support varies: exclusive-mode playback and devices connected after recording starts may not expose an adjustable session. An abrupt process termination or power loss cannot run normal restoration; use Windows Volume mixer if needed. This is playback reduction, not microphone noise removal. It adds no model or download.

## Navigation labels are hidden

Choose **Expand sidebar** to restore page labels. Collapsed navigation keeps its icons: hover or keyboard-focus an icon to see its name, or use **Ctrl + K** to find a page. The collapse preference is remembered without changing your processing settings.

## Header is dimmed while a dialog is open

The full-window backdrop dims the header and logo along with the page. Close the shared dialog before using header controls; a header click dismisses the dialog without also minimizing or closing the window. Tab or Shift + Tab returns navigation to the active dialog if a disabled action or dismissed toast left focus outside. Ctrl + K is ignored while another dialog is active. Setup keeps its existing busy and mandatory-close restrictions.

## No microphone or no speech

Open Windows **Settings → Privacy & security → Microphone** and enable microphone access and desktop-app access. Check **System → Sound → Input**, choose the correct device, then use CridVoice Settings to refresh/select microphones. Bluetooth headset mode and other apps can alter input quality. Try a direct/built-in microphone. Silent takes intentionally produce no text rather than guessed speech.

Settings loads microphone choices when opened. Use **Refresh microphones** after reconnecting a device, or select **Windows default microphone**. A saved disconnected device is kept visible rather than silently replaced. Find a page accepts microphone/audio keywords, and Settings section buttons jump to the relevant controls.

## Shortcut does nothing

Complete first-run setup, keep CridVoice in the tray, and ensure another app is not owning Ctrl+Windows. Test both key press orders and left/right keys. Check configured shortcuts in Settings. Avoid overlapping chords and remappers that intercept the Windows key. Use Test dictation to separate audio/inference problems from hotkey problems. Release both Ctrl and Windows between takes. Version 0.1.14 clears stale modifier state and requires a fresh Windows press after a suppressed hold ends.

If a second chat dictation repeats the earlier draft, update to 0.1.14. Ordinary cleanup now excludes existing selected/nearby text, while explicit rewrite still uses a selection. Compare History raw and cleaned text to distinguish recognition from cleanup, without reposting private content.

To change a binding, choose **Change**, press the chord, release all keys, and Save. Capture reserves Escape for cancel and stops after 30 seconds without a completed chord. Cancel or Try again does not change the saved binding. Fix the displayed conflict or restore a default. Close capture before testing dictation; no take should start while it is listening.

## Provider model list is empty or cannot load

Check the draft API root/protocol/key, then choose **Fetch models** explicitly. A compatible text/audio endpoint does not necessarily implement model listing. Choose **Enter a custom model ID** when discovery is unavailable, incomplete, or unsupported. Returned IDs do not prove text/speech capability or account access. After changing an endpoint, supply a typed key or use no authentication; a saved key is never sent under a different provider binding.

## Application is missing from writing-style choices

Use Refresh while the app has a visible window, or choose a common/recent entry. Protected processes can be absent. The custom option accepts its executable stem or a matching substring, not a window/document title. Existing rules can be edited. The first case-insensitive matching rule wins.

## Model is not installed

Run setup repair to install the complete selected component plan. Local speech needs its selected final model, the NVIDIA runtime when using CUDA, and the separate Tiny model when live preview is enabled. Managed cleanup also needs its model and CPU/GPU runtime. A partial `.part` file is not an installed model; resume the download. After a checksum error, download again.

**Selected**, **Installed**, and **Loaded** have separate meanings. Selected is your configured choice. Installed means the files are on disk. **Models in memory** shows whether CridVoice's local final speech, CPU preview, and cleanup engines are unloaded, loading, loaded, or in an error state, including the actual model/device. Installed files can remain available while the managed engines are unloaded. Changes refresh automatically across app windows, with a two-second backend check for exited children or changed installed markers. No reload or restart is needed. External LM Studio/cloud model residency is controlled by that provider.

## Processing takes too long

Local preview uses a separate two-thread CPU Tiny model, with the first request due around 750 milliseconds and minimum 300-millisecond hops while free. It recognizes a rolling six-second window in provisional chunks; words can revise or disappear as that window advances. Model warming and CPU speed can delay visible text. Final recognition independently processes the complete take using your selected final model; remote preview keeps its existing provider/cadence. Check the separate Preview memory status in Local models. If Tiny is missing, complete its visible setup/repair download. A preview-only error can show **Preview unavailable. Release to transcribe.** without replacing final recognition. Turning preview off removes that local component requirement.

The recording bar distinguishes **Transcribing**, **Cleaning**, and **Inserting**. Press Escape to cancel and prevent stale insertion. Record the displayed stage, model/device choices, and exact safe error before changing settings.

The independent local preview skips a busy lane instead of queueing and has a five-second request budget; preview warm-up allows thirty seconds. Final recognition retains a separate 60-second queue limit and 240-second processing budget. Managed cleanup startup has a 120-second readiness limit; chat requests have a 180-second HTTP limit. These limits apply to separate stages, so they are not a single total recording deadline. A timeout is reported without automatic cloud fallback.

To isolate the problem, disable live preview, select CPU speech with cleanup off, and use **Test dictation**. Then enable cleanup and GPU stages separately. Reuse an already-installed speech model; download Whisper Small only if you choose that lighter option. A reported Processing freeze in the original build has not yet been reproduced with a real microphone, so its cause remains unconfirmed.

## Child process exits or cannot start

CridVoice now reports fixed diagnostic hints and numeric Windows error/exit codes where available. Categories cover NVIDIA libraries, GPU memory, graphics initialization, model loading, speech dependencies, permissions, port binding, and invalid speech requests. It drains child pipes concurrently and does not expose raw output, transcripts, provider responses, or command lines containing API keys. Share the safe error shown in the interface with the model/device and failing stage; a category is a troubleshooting hint rather than a confirmed root cause.

## NVIDIA or DLL errors

Update the NVIDIA driver. Install the NVIDIA speech runtime through Models; CUDA speech requires cuBLAS 12 and cuDNN 9. CridVoice downloads pinned CUDA 12.9/cuDNN 9 libraries. Selecting GPU on a machine without NVIDIA speech support produces an error. Select CPU to diagnose independently, and use Whisper Small for lower resource requirements. GPU text runs through Vulkan, not the speech CUDA runtime.

## GPU memory is full or inference is slow

Close other GPU-heavy applications or unload LM Studio models. Choose CPU for one stage or a smaller speech model. Disable live preview for long takes/CPU workloads. In 0.1.4, installed selected local models warm in the background after launch. Check the live warming/loaded state on Overview and Local models. Recording can begin while warming, but final processing may still wait if preparation has not finished. Use the manual loading action to retry a failed warm-up. **Unload models from memory** releases engines when idle and cancels pending warming; the next use needs loading again.

## Wrong language or Polish spelling

Choose **Polski** explicitly if automatic detection guesses incorrectly. Add proper names and technical terms to Vocabulary. Larger multilingual recognition models generally improve results but need more compute. Mixed English/Polish recognition remains model-dependent. CridVoice requests transcription, not translation.

## Cleanup changed what I meant

Compare original and final text in History. Select Natural style to minimize stylistic rewriting. Check vocabulary and app-specific guidance. Try a stronger local/server/cloud cleanup model you select yourself. Turn cleanup off to preserve raw recognition when necessary. Self-correction and subtle intent handling are probabilistic and cannot be guaranteed by the app alone.

## Provider cannot connect

Verify that the local server is running, the URL includes the correct API prefix/port, and the exact model ID is loaded. Remote URLs need HTTPS. Check the selected API format and stored key. Anthropic-compatible APIs handle text; cloud audio requires an audio-capable OpenAI-compatible endpoint. Test uses a short nonsensitive completion. HTTP status messages distinguish endpoint/key/model failures without logging response bodies.

## Text was saved but not inserted

Keep the original text field focused through processing. CridVoice deliberately prevents insertion after a window/control focus change. Release modifiers before insertion. Windows blocks input into administrator/elevated applications from a normal app; copy from History or the Latest result card. Some terminals, remote desktops, secure controls, or apps that reject Unicode injection may require manual paste. Do not assume input-event success proves a target rendered text.

If an existing clipboard format cannot be safely preserved, CridVoice automatically uses Unicode typing before changing the clipboard or sending paste input. A busy clipboard or a paste/restoration error still reports a failure rather than risking duplicate text. The result remains available in Latest result, and in History when enabled. You can select **Unicode typing** in Settings as the primary method if clipboard paste remains unsuitable for your target app.

If the error says some text may already have been inserted, check the target field before copying the full result. The app stops sending further input after a partial send, cancellation, or focus change.

## Code or CLI output is wrong

Check **Output mode** first: **Dictate code or commands** is for speaking literal code/commands; **Generate code or commands** is for describing a task and reviewing its result in CridVoice. Both need cleanup enabled. Automatic language detection does not choose the output mode. Under **Code language or shell**, choose a common language/shell or **Other / custom…** to reveal **Language or shell override** if detection guessed the wrong editor language, shell, or dialect. Choose Automatic, or clear and save the hint, to restore detection. Context hints require application context and remain unavailable in password fields.

Speak operators, quoting, paths, and flags explicitly, and add repeated identifiers with aliases to Vocabulary. Compare the raw recognition with the final result in History to locate a speech versus cleanup error. The selected model determines code quality; changing the hint does not make every language accurate. Generation and literal multiline output to recognized terminal targets intentionally open for review instead of automatic insertion. Use Copy after inspecting the command and its line breaks.

**Raw transcript** or **conversion failed** means code conversion did not succeed. The retained recognition is shown as speech text, with no inferred code-language label or automatic insertion. Review the underlying cleanup/provider error before retrying. A history-save error after successful generation leaves the generated result available to Copy.

## Rewrite says no text is selected

Enable application context, select text in the target app, then use the rewrite shortcut. The target must expose its selection through Windows UI Automation. If it does not, use another accessible editor or edit/copy manually. Context is captured at recording start; selecting text later does not change the input for that session.

## Portable app does not open

Extract every file into a writable directory and keep resources beside `CridVoice.exe`. Ensure Microsoft WebView2 is present. Do not run directly in a ZIP or use a read-only network/Program Files location for portable data. Windows Defender/reputation prompts can appear for unsigned personal builds. Verify the provided artifact hash and source before running.

## Settings or startup issues

The local 0.1.1 startup smoke was blocked by Windows Application Control before CridVoice launched. An Application Control signing-policy block is separate from a model or Python error and from a SmartScreen reputation warning. See the [dated Windows report](WINDOWS-VALIDATION-2026-10-13.md) for the exact event evidence and current validation limits. No security policy was changed during testing.

Quit through the tray before manually editing `settings.json`. Invalid values are rejected. Back up the file before restoring defaults; keep model/history directories if you want to retain them. For portable startup, disable/re-enable the setting after moving its folder. Only one instance should run at a time.

The saved microphone remains visible before refreshing the device list, including when that device is disconnected. Refresh to see currently available inputs. If a shortcut is rejected, its input returns to the persisted shortcut instead of continuing to show an unsaved value.

## Reporting a problem

Record app version, installed/portable mode, Windows build, device/driver, model IDs and device choices, target app, expected/observed behavior, and minimal reproduction steps. Avoid sharing API keys or personal context. A short non-sensitive example in English/Polish is more useful than a large private recording. Use the Windows acceptance checklist to identify the failing stage.
