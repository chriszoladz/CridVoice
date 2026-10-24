# User guide

## Installation

Run the `.exe` installer for a current-user installation. Administrator access is not normally required. The installer checks Microsoft WebView2, which is normally included in Windows 11. Do not remove the packaged Python or service folders.

For the portable build, extract the complete ZIP to a writable folder, such as a folder inside your user directory. Start `CridVoice.exe`. Keep `portable.flag`, `python/`, `service/`, and `model-catalog.json` beside it. Do not run inside the ZIP or move the executable alone. Portable data is stored in `data/` beside the executable. API keys use Windows Credential Manager on that computer.

## First-run setup

1. In **AI processing**, choose **Managed local AI**, **Local server**, or **Connect a provider**. The first option manages local inference; the second connects an existing local server; the third connects a selected cloud API. Every option remains available later.
2. For an external provider, enter its base URL, API format, and optional API key, then choose **Fetch models** to request model IDs from that endpoint. Select the text model and, when appropriate, speech model. Lists do not identify capabilities: the provider must support the selected endpoint/model. Use **Enter a custom model ID** if discovery is unavailable or your intended ID is absent. Local servers often omit authentication. Anthropic format is for text; speech needs a separate compatible audio endpoint or local transcription.
3. In **Speech recognition**, choose the speech engine, device, model, and language. English/Polish automatic detection is the default. A local text server can be combined with app-managed local speech.
4. In **Preferences**, select the cleanup engine and its device/provider independently, then review context, transcript history, live preview, writing style, and startup preferences. **Off · raw transcript** requires no cleanup model/runtime.
5. In **Install components**, review the hold shortcut and complete required local components list. On the default managed RTX 5070 Ti route this contains Whisper Turbo, NVIDIA speech runtime, Whisper Tiny for enabled live preview, Qwen3 4B, and llama.cpp GPU runtime. The total missing download size is displayed before starting.
6. Choose **Install required components & finish**. The wizard automatically awaits each missing component, showing per-component and overall progress plus verification/extraction stages. Already-installed components are skipped and reused. Downloading 100% is not completion until verification/extraction succeeds.
7. Use **Pause setup** if needed, then **Resume setup**. A failed step keeps the wizard open with **Retry setup**, preserving usable partial files and completed components. The wizard finishes only after fresh installed-state checks and the native readiness check succeed. A route using providers for both stages needs no local assets and can choose **Finish setup** directly.

An installed app with missing selected local components opens setup repair at the final component list. The incomplete callout and **Test dictation** also lead to repair, rather than starting a take that needs missing models. **Settings → Run setup wizard** lets you revisit any route. Repair preserves existing provider IDs, separate speech/cleanup selections, saved keys, and other settings. Leave a saved key blank to keep it. Close repair only while it is idle, or pause first.

Use **Local models** for later optional model changes/removal and live in-memory status. Use **AI providers** to add or test connections and **Settings** to choose which connection each stage uses. Browser preview cannot install or prove local readiness and cannot finish a local setup; fully provider-based preview settings remain available.

## Navigation and status

The custom top bar replaces the Windows caption. Drag its text area to move the window, or double-click it to maximize or restore. The right-side controls minimize, maximize/restore, and close to the tray. **Quit CridVoice** in the tray menu exits the app. Help and window buttons are excluded from dragging.

Dialogs dim the whole window, including the header and logo. Tab and Shift + Tab cycle within the active dialog, including after an action becomes disabled or a toast is dismissed. Shared dialogs close with Escape, their Close control, or a click outside, then restore prior focus where available. A header click behind a shared dialog dismisses it without also operating the window. Close the dialog before using the header controls. Ctrl + K does not open Find a page over another active dialog. Setup retains its own mandatory/busy, pause, close, and Escape rules.

The sidebar groups **Overview**, **History**, **Vocabulary**, and **Writing styles** under Dictation. **AI providers**, **Local models**, **Appearance**, and **Settings** are grouped under Configuration. Use **Find a page** or **Ctrl + K** to search these pages, including keywords such as microphone, hotkey, clipboard, and retention. The expanded footer shows **About CridVoice**, the actual app version, and whether it is Installed or Portable. Settings has section jumps for its longer page.

Use **Collapse sidebar** in the top bar to give the main page more width while keeping a compact icon rail. Hover over an icon or focus it with the keyboard to see its page name, then select it to navigate. **Expand sidebar** restores the labels. The app remembers that choice, and **Ctrl + K** still opens page search while collapsed. At the default 1200×820 window and text size, idle Overview fits without page scrolling, including up to three recent entries. At 900×640, with a longer result, or with enlarged text, content can still scroll using the themed scrollbar.

Navigation icons stay in place when the sidebar expands or collapses. Sidebar width changes horizontally while labels fade; with a reduced-motion preference, the change is instant. Select either the full or compact logo to return to Overview. Its balanced Home control has visible keyboard focus and a brief activation pulse; reduced motion skips the pulse.

Overview shows plain dictation states such as **Ready**, **Recording**, **Transcribing**, **Cleaning**, **Inserting**, and **Setup required** beside the recording controls. The top bar shows whether settings are saved locally and whether each processing stage uses a local engine or a provider. **Installed**, **Selected**, **Loading**, and **Loaded** remain separate model states. The supplied waveform logo uses matching artwork for light and dark surfaces. The compact layout and custom title bar preserve shortcuts, downloads, and processing behavior.

## Customize shortcuts

In Settings, choose **Change** beside Hold to dictate, Toggle dictation, or Rewrite selected text. Press the desired chord together, then release every key. Review the captured shortcut and choose Save; capture alone does not change settings. Conflicting or unsupported chords cannot be saved. **Try again** starts a new capture, while Cancel or Escape leaves the saved binding unchanged. An incomplete capture stops after 30 seconds; it does not start dictation. Release held keys before trying again.

The reset action restores that binding's default, subject to conflict validation. Defaults remain **Ctrl + Windows** for hold, **Ctrl + Shift + Space** for toggle, and **Ctrl + Alt + R** for rewrite. Escape is reserved for cancellation in the recorder. Other applications can still own the same chord, so avoid duplicate bindings across dictation tools.

## Dictation

The header's processing button shows whether speech and text cleanup use local models or configured providers. Hover or focus it for the separate routes; click it to open the speech-processing settings. The adjacent save indicator reports settings saves. Model loading/readiness remains visible on Overview and Local models.

Installed selected local models warm in the background after launch. Overview shows their live readiness, and Local models offers **Load selected models** or **Retry model loading**. You can begin recording while they prepare; processing may still wait if warm-up has not finished. Explicitly unloading models cancels pending warm-up and releases the engines until you load or use them again, change the selected local route, or restart the app. Completed downloads alone do not undo explicit unloading. External providers remain under their own control and are not contacted by this preparation.

In the default **Text** output mode, place your cursor in the target text field. Hold **Ctrl + Windows**, speak naturally, and release both keys. The app captures only while recording, transcribes your audio, performs selected text cleanup, and inserts the result. Keep the field focused until insertion finishes. Technical modes can instead open the result for review as described below.

Either left/right Ctrl and Windows keys can be used. Release both keys between takes. Holding Windows while repeatedly tapping Ctrl is not a supported way to restart a take; release Windows and press the full chord again. Windows-key events involved in the hold chord are suppressed to avoid opening Start. Check conflicts with Wispr or any other tool registering the same shortcut; run one owner of the chord at a time.

Default insertion uses clipboard paste with restoration, supporting paragraphs without simulating Enter. If an existing format cannot be safely preserved before clipboard changes or input begin, CridVoice automatically uses Unicode typing and leaves the clipboard untouched. Settings also offers Unicode typing as the primary method. Busy-clipboard, paste, or restoration failures do not trigger a second insertion attempt; the output remains in Latest result and in History when history is enabled. New clipboard contents created during paste are preserved instead of overwritten by restoration.

For a partial-input error, check the target field before copying the full result. CridVoice stops further input rather than retrying a possibly incomplete insertion.

To keep a copy ready for manual paste, enable **Settings > Windows & storage > Copy dictation to clipboard**. Completed dictation then replaces your previous clipboard contents, even if automatic insertion is blocked. It works with clipboard paste or Unicode typing. The option is off by default; cancelled/test takes, failed-cleanup raw text and code requiring review are excluded. If an error warns that some text may already be inserted, inspect the field before pasting again.

The **Test dictation** button records a test take and shows its result in CridVoice. It does not insert into an unrelated application. Use global shortcuts for cross-application insertion. The tray **Toggle dictation** command also records into the current target.

**Ctrl + Shift + Space** starts recording with one press and finishes with the next. **Escape** cancels. The recording-length limit automatically ends a recording; the default is five minutes. Longer sessions can be selected in Settings.

The compact floating bar appears at the bottom center of the primary monitor's usable desktop area, with its status label and waveform centered within the popup. It shows recording/processing stages and up to two visible lines of live preview. Turning preview off makes the card shorter. Appearance provides independent controls for the waveform, preview, and whole bar. Live recognition is provisional and depends on inference speed. Final processing may revise it after you stop.

With local speech and live preview enabled, setup/repair includes Whisper Tiny, a separate CPU preview model of about 75 MiB. Its first request becomes due at about 750 milliseconds, then at minimum 300-millisecond intervals when free. Recognition still arrives in provisional chunks, so it can revise words rather than displaying every spoken word instantly. Only the latest six seconds are previewed; older words can leave the preview. Your selected final speech model independently recognizes the complete take after release, with its normal settings, then cleanup runs. Remote preview keeps its existing provider and cadence.

The popup's fixed two-line area follows the newest words. Overview follows updates while you are near the bottom; scrolling back keeps your reading position until you return near the bottom. The full current preview remains accessible without a live announcement for every partial word. A preview-only failure can show **Preview unavailable. Release to transcribe.** while final recognition remains available. You can turn live preview off in Appearance without changing the selected final speech model.

## Lower background audio

In **Settings → Speech recognition**, turn on **Lower background audio while speaking**, then adjust **Background audio reduction** from 10% to 90%. Higher values make other apps quieter. The default 60% reduction leaves playback at 40% of its original session volume. The switch is off by default; the slider remembers its amount when switched off.

The displayed amount follows the slider immediately. Release the slider, finish a keyboard adjustment, or leave it to save the amount. It applies to the next recording. The volume returns when you stop or cancel, before final recognition and cleanup. Observed manual volume changes during recording are kept. Settings stays visually stable while ordinary saves complete in the background.

This lowers computer playback such as music or a video. It does not remove room noise from the microphone recording. See Troubleshooting for supported playback devices and restoration behavior.

## Speaking naturally

Cleanup resolves corrections such as:

| Spoken input | Intended result |
| --- | --- |
| “Tuesday… actually Wednesday.” | “Wednesday.” |
| “At five, sorry, six in the evening.” | “At six in the evening.” |
| “We should not cancel it.” | Preserve the negation. |
| “We wtorek… nie, właściwie w środę.” | “W środę.” |

The editing prompt instructs models to preserve uncertainty, names, facts, quotations, meaningful alternatives, language choices, and Polish characters. Ambiguous revisions cannot always be resolved reliably. Check important output, and compare raw versus cleaned text in History. Selecting **Off · raw transcript** disables LLM cleanup and preserves recognized speech.

## English and Polish

Automatic mode leaves language detection to the multilingual speech model. It preserves the recognized language rather than translating. Mixed-language recognition varies by model and utterance. Use the language selector on Overview or in Settings for an explicit **English** or **Polski** override when detection is wrong or you need predictable language behavior.

## Code and CLI

Choose the output mode on Overview or in Writing styles. Both technical modes require text cleanup to be enabled, using the selected local model or text provider. Choosing cleanup Off returns output to Text. They reuse your speech model and shortcuts; no additional coding model is downloaded.

| Output mode | What to say | What happens |
| --- | --- | --- |
| Text | Ordinary dictation | Cleans up prose and inserts it into the original text field. |
| Dictate code or commands | The code or command itself, including symbols and flags | Treats the utterance as literal code, with instructions to preserve identifiers, operators, quoting, paths, and layout. Uses normal target-field insertion, except multiline output to a recognized terminal goes to review. |
| Generate code or commands | Instructions describing the code or command you want | Produces code, opens CridVoice for review, and lets you choose Copy. It does not automatically insert the generated result into an editor or terminal. |

**Output mode** is your choice; automatic language detection does not change it. Under **Code language or shell**, choose **Automatic**, a common language/shell, or **Other / custom…**. Automatic applies only to the language/shell used by code and command modes. When application context is enabled, it can use available editor/window titles, filename hints, selected or nearby text, and shell prompts. Where those hints are unavailable, it follows your spoken request and the model's interpretation.

Common choices include PowerShell, Windows CMD, Bash, Python, TypeScript, Rust, and SQL. Choose **Other / custom…** to reveal **Language or shell override** and enter a dialect or another model-supported language, up to 80 characters. Press Enter or leave the custom field to save it. Choose Automatic, or clear and save the hint, to return to automatic detection. These choices are hints rather than language-support guarantees. **Detected** or **Last detected** shows the available language result. This control is separate from the English/Polish speech-language selector. Password fields remain excluded from context.

For literal commands, choose **Dictate code or commands**, place the cursor in the target editor or terminal, and speak the command with explicit punctuation where needed. These are practice examples, not accuracy guarantees:

Clear command starts such as `git status` take precedence over unrelated nearby Python code or an editor filename. When a shell cannot be identified, the result can show **Command line** rather than assuming one. Manual and explicit spoken language hints still take priority. Recognized command keywords can correct incidental recognition capitalization or a sentence period, such as `Git status.` becoming `git status`; explicitly spoken dots and casing directives remain significant. Arguments and quoted text keep their case. Spell branch names with the intended dash, slash, quoting, and spacing; the app does not invent a dash or join ambiguous words.

| Manual hint | Spoken example | Intended text |
| --- | --- | --- |
| PowerShell | “Get dash ChildItem space dash Path space double quote C colon backslash Logs double quote” | `Get-ChildItem -Path "C:\Logs"` |
| Bash | “git space status space dash dash short” | `git status --short` |
| Python | “print open parenthesis double quote hello double quote close parenthesis” | `print("hello")` |

For generation, choose **Generate code or commands** and describe the goal, for example: “In PowerShell, list the log files in C:\Logs, newest first,” or “Write a Bash command that finds Python files below the current directory.” Review the plain code in CridVoice, then use **Copy** and decide where to paste it. The app does not run generated code. Literal multiline output to a recognized terminal also opens for review. A terminal can interpret a multiline paste differently from an editor, so inspect commands and their line breaks before pasting or submitting them. Literal command insertion adds no Enter action; press Enter yourself when ready.

If cleanup or conversion fails, the retained speech is labelled **Raw transcript** and history shows **conversion failed**. It is not presented as finished code or inserted automatically. If generation succeeds but history saving fails, the valid result remains available for review and Copy.

Recognition and code quality depend on the selected speech and cleanup models. Auto detection and manual hints do not establish accurate support for every language. Add exact identifiers or commands to Vocabulary, such as `Get-ChildItem` with the alias `get child item`, or `kubectl` with `kube control`. Aliases are hints, not guaranteed substitutions. Include intended casing, switches, paths, and quoting when speaking.

## Rewriting selected text

Select text in the target application. Press **Ctrl + Alt + R**, say the change you want, and press the shortcut again to finish. Examples: “Make this shorter, but keep the deadline,” “Change the tone to friendly,” or “Przepisz to bardziej formalnie.” The selected text is replaced with the model's answer.

This requires application context and text cleanup. Selection retrieval depends on the target app's Windows accessibility support. Missing selection produces an actionable error. If focus changes while processing, CridVoice saves output instead of typing into another field.

With text selected, the ordinary hold shortcut also recognizes explicit spoken instructions such as “Rewrite this…,” “Make this shorter…,” “Translate this…,” “Przepisz to…,” and “Skróć to….” These cues activate rewriting only when a selection exists and cleanup is enabled. Otherwise speech is treated as normal dictation. Quoted commands or incidental mentions do not match the prefix-based command detector.

## Vocabulary

Add a correct spelling and optional comma-separated aliases. Words are supplied as recognition hints and editing context. Useful examples include “CridVoice” with “crid voice,” “Łukasz” with a common mishearing, and exact code identifiers. Hints improve the chance of recognition; they are not unconditional replacements. Remove a word with its trash button. Search filters words and aliases.

Ordinary Text and literal code dictation use only the new spoken take as source material. Existing selected or nearby text is not included in their cleanup request, even with application context enabled. Explicit rewrites can still edit selected text, and code language detection still uses available context.

## Writing styles

Choose Natural, Professional, Casual, Concise, or Technical as the default for **Text** output. Style controls tone: Natural keeps your voice, Professional uses polished phrasing, Casual is conversational, Concise shortens wording while keeping each point, and Technical preserves identifiers in prose. Add app-specific rules using an executable-name substring such as `outlook`, `slack`, or `code`. Rules are matched case-insensitively; the first matching rule wins. Optional custom guidance accompanies that rule. Rules require cleanup to be enabled.

The separate **Rewrite strength** setting controls how much Text wording can change. Light makes grammar/punctuation edits close to your wording. Balanced smooths unclear sentences. Thorough can regroup a longer brain dump into a coherent message. Rephrasing is permitted; inventing details, reversing a negation or changing uncertainty is not. Strength applies across Text styles and application rules; it does not change code/CLI formatting or the speech model. Existing settings default to Balanced. AI editing can still make mistakes, so important details should be reviewed.

The Application selector groups common apps, recent History app names, and running visible-window process names. Refresh updates the running list; protected processes can be absent. Choose the custom option for an unlisted executable stem or substring. Existing rules can be edited without removing/recreating them. The running list uses names only, not window titles, document text, paths, or command lines.

Use **How should CridVoice write for you?** to set personal wording and tone preferences. For example: “Keep my slang, including bro. Do not add pet names or greetings. Use short paragraphs and avoid corporate wording.” Choose **Save preferences** to apply the draft, or **Use defaults** to clear it. The box accepts up to 2,000 characters. Preferences apply to every Text style and rewrite strength, including Balanced and Thorough. Slang, nicknames and forms of address are preserved by default; a stronger rewrite is not permission to replace “bro” with “buddy.” Explicit preferences can request a different tone while facts, uncertainty and intended meaning still come first.

The first matching application's **Extra guidance for this app** can refine your general tone or formatting preferences. Personal guidance does not change code/CLI modes and has no effect while cleanup is off. It uses the existing cleanup request, without another model call. Preferences are saved in local settings and included in requests to your selected text cleanup model or provider.

The **You say** / **CridVoice writes** example updates with both style and rewrite strength. These local illustrations use default preferences and show different wording and structure while retaining the example's facts, uncertainty and requests. Arbitrary personal instructions do not regenerate this illustration. Examples make no provider or model requests; exact AI wording may vary. Cleanup Off and code/generation modes show explicit notices because writing styles apply to Text cleanup.

The Technical writing style is a text-cleanup preset, stored under the existing `code` style ID for compatibility. Use the dedicated **Output mode** controls for literal code dictation or generation from instructions.

Multiline output sent to a recognized terminal opens in CridVoice for review and copying, including Text output. It is not inserted or automatically copied by the completed-dictation clipboard option. A single-line terminal result and multiline output in ordinary text editors keep their normal insertion behavior.

## History

Final and raw transcript text are saved automatically by default. Audio is not saved as history. Search finds text or application names; the language filter selects English or Polish. Open an entry to compare original recognition with cleanup. Copy, delete, export filtered history as JSON, or clear all history. Retention can be indefinite, 7, 30, or 90 days. Turn recording of future history off in Settings without deleting existing entries.

History counts drive Overview statistics. **Estimated time saved** compares typing at 40 words/minute with recorded speech time. Entries which were not inserted are labelled saved transcripts and remain available to copy.

Successful code and generation entries preserve whitespace in a monospace view and scroll within the result or history dialog when needed. Long prose wraps within the page. Entries labelled **Raw transcript · conversion failed** contain retained recognition rather than converted code.

## Appearance

Eight presets: Amethyst, Ocean, Forest, Rose, Ember, Graphite, Midnight, and Lagoon. Under **Theme and color mode**, select Light, Dark, or System mode. **Color and text size** lets you override the accent and scale text from 85% to 140%. Customize waveform, live preview, and the floating bar independently.

Presets apply to the background, navigation, cards, raised surfaces, hover colors, and borders. Selecting a preset also selects its accent while preserving text size, color mode, and recording-bar preferences. A custom accent survives saving/reopening and color-mode changes until another preset is selected. System mode follows the current system preference, including the theme previews. Custom accent text uses a derived foreground color to remain readable. Scrollbar tracks, thumbs, and corners follow the active theme and color mode. Buttons show a neutral hover state and a visible keyboard-focus outline; destructive actions retain a red tint/border with readable text.

## Tray and startup

Closing the main window hides it in the tray. **Open CridVoice** restores it. **Quit CridVoice** stops recording and local processes and exits. Startup is opt-in, starts with `--background`, and uses the Windows current-user startup registration. Portable startup refers to that folder; update the setting after moving it.
