<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="src/assets/branding/lockup-dark.png">
  <img src="src/assets/branding/lockup-light.png" alt="CridVoice" width="440">
</picture>

### Voice dictation that still sounds like you.

Speak into your everyday apps. Turn a rough thought into clear writing.<br>
Keep your own words, your own slang, and your own voice.

**Windows 11 x64 · Local AI or your chosen provider · English + Polish**

[Download for Windows](https://github.com/chriszoladz/CridVoice/releases/tag/v0.1.20) · [See the app](#a-look-inside) · [Getting started](#getting-started) · [User guide](docs/USER-GUIDE.md)

</div>

---

## Speak. Release. Keep going.

Click a text field, hold <kbd>Ctrl</kbd> + <kbd>Windows</kbd>, and speak. Release the keys to transcribe, clean up, and insert your words.

Live preview follows along while you talk. With local AI, a separate small Whisper Tiny model supplies provisional text while your selected speech model handles the complete take. Preview words may revise as more speech arrives.

| Write naturally | Make it yours |
| --- | --- |
| **Everyday dictation** for messages, notes, email, and longer thoughts. | **Writing styles and rewrite strength** for lighter cleanup or more thorough editing. |
| **Code and CLI modes** for literal dictation or generating output from spoken instructions. | **Personal instructions** for your preferred wording, tone, and formatting. |
| **English and Polish** with automatic detection or a manual language choice. | **App-specific guidance and vocabulary** for different tools, names, and spellings. |
| **Local models or connected providers**, configured separately for speech and cleanup. | **Themes, text sizing, a compact overlay, and adjustable background-audio reduction.** |

An optional **10–90% audio reduction** slider temporarily lowers other apps' playback while you record, then restores it when you finish or cancel.

## A look inside

Previews captured from the **0.1.20 interface**, using demonstration text and simulated desktop state.

**Your workspace.** Dictation controls, recent transcripts, model readiness, and processing settings together.

![CridVoice Overview with dictation controls, ready local models, and sample transcripts](docs/images/overview.png)

**The recording popup.** Hold <kbd>Ctrl</kbd> + <kbd>Windows</kbd> to see the waveform and provisional words without opening the main window.

<p align="center">
  <img src="docs/images/recording-preview.png" alt="Compact CridVoice recording popup with a waveform and the sample preview: Let's move the review to Wednesday at three" width="560">
</p>

<details>
<summary><strong>Preview writing styles and personal preferences</strong></summary>

Choose the tone, adjust rewrite strength, and describe how you want the result to sound.

![Writing styles with Natural tone, Balanced rewrite strength, and saved sample writing preferences](docs/images/writing-styles.png)

</details>

## Keep the result in your voice

In **Writing styles → How should CridVoice write for you?**, describe what you want:

> Keep my own words and slang. Fix grammar without making me sound formal. Use short paragraphs.

Choose **Save preferences** to apply it, or **Use defaults** to clear it. Light, Balanced, and Thorough control how much editing happens. Your selected style supplies the default tone; personal instructions can refine it.

Text preferences stay separate from coding modes. Code and command output can use automatic language/shell hints or a manual override. Generated code and multiline output for a recognized terminal open for review and **Copy**.

## Getting started

**[Download CridVoice 0.1.20](https://github.com/chriszoladz/CridVoice/releases/tag/v0.1.20)** for Windows 11 x64.

| Install it | Keep it portable |
| --- | --- |
| [Windows installer EXE](https://github.com/chriszoladz/CridVoice/releases/download/v0.1.20/CridVoice-0.1.20-windows-x64-setup.exe) | [Portable ZIP](https://github.com/chriszoladz/CridVoice/releases/download/v0.1.20/CridVoice-0.1.20-windows-x64-portable.zip) |

An [installer ZIP](https://github.com/chriszoladz/CridVoice/releases/download/v0.1.20/CridVoice-0.1.20-windows-x64-installer.zip), SHA-256 checksums, and build information are also attached to the release. The packages are unsigned evaluation builds.

**Using an installer or portable build?** Install it, or extract the entire portable ZIP and run `CridVoice.exe`. Keep the portable files together. Python is bundled; Microsoft WebView2 is required.

On first launch, the setup wizard lets you choose managed local AI, an existing LM Studio/llama.cpp server, or a compatible provider. It shows the download size and visible progress while installing and verifying the components your choices require. Models are downloaded during setup rather than bundled with the installer or portable ZIP.

For local AI, NVIDIA GPU speech recognition uses CUDA; text inference uses llama.cpp with Vulkan. CPU processing is also available. The [models and hardware guide](docs/MODELS.md) explains model sizes, runtime choices, and drivers.

Selected installed engines warm in the background. Overview shows when they are ready. Setup and repair can be reopened from Settings.

| Shortcut | Action |
| --- | --- |
| <kbd>Ctrl</kbd> + <kbd>Windows</kbd> | Hold to dictate, release to finish |
| <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>Space</kbd> | Start or stop toggle dictation |
| <kbd>Ctrl</kbd> + <kbd>Alt</kbd> + <kbd>R</kbd> | Rewrite selected text using spoken instructions |
| <kbd>Escape</kbd> | Cancel |

Shortcuts can be changed by pressing the new combination in Settings.

## Your processing, your choice

With managed local models, speech recognition and cleanup run on your PC. If you choose a provider, the data needed for that stage is sent to that provider. Read [Privacy and storage](docs/PRIVACY.md) for audio handling, application context, saved history, keys, and portable mode.

Transcripts can be saved locally with search, export, retention, and deletion controls. Optional completed-dictation clipboard copying is **off by default** and replaces the previous clipboard contents when enabled. Output awaiting review keeps its explicit Copy action.

## Guides

| Using CridVoice | Developing CridVoice |
| --- | --- |
| [User guide](docs/USER-GUIDE.md) | [Development and tests](docs/DEVELOPMENT.md) |
| [Models and hardware](docs/MODELS.md) | [Architecture](docs/ARCHITECTURE.md) |
| [Providers](docs/PROVIDERS.md) | [Build and release](docs/RELEASING.md) |
| [Configuration reference](docs/CONFIGURATION.md) | [Windows acceptance checks](docs/WINDOWS-TESTING.md) |
| [Troubleshooting](docs/TROUBLESHOOTING.md) | [Security review](docs/SECURITY-REVIEW-2026-10-24.md) |
| [Polski: szybki start](docs/QUICKSTART-PL.md) | [Validation scope and history](docs/VALIDATION.md) |

## Build from source

The tested Windows release workflow uses **Node.js 24, Rust 1.99.0, and Python 3.12**. Install Visual Studio Build Tools with **Desktop Development with C++** too. If you use Node.js 22, Vite requires **22.12 or newer**. End users do not need Node.js, Rust, or Python.

```powershell
npm ci
python scripts/package_python.py --locked
npm run desktop
```

For a browser preview on Windows, Linux, or macOS:

```sh
npm ci
npm run dev
```

Browser preview uses simulated desktop integration. Microphone capture, Windows insertion, and native model readiness require the desktop app. See [Development](docs/DEVELOPMENT.md) for tests and [Build and release](docs/RELEASING.md) for installer/portable packaging.

## Current version

**0.1.20** adds personal writing preferences and stronger preservation of intentional slang and forms of address. Personalized cleanup checks your requested wording and may take a little longer; live preview and ordinary dictation keep their existing paths. See the [changelog](CHANGELOG.md) for version history.

Rewriting remains model-dependent. In local Qwen3-4B testing, one personalized Polish case kept an explicit spoken correction instead of removing the abandoned word. Important facts still need review. Automated checks and user feedback have different scopes, described in the [validation documentation](docs/VALIDATION.md).

Windows packages are currently unsigned evaluation builds. Third-party components retain their own [licenses and notices](THIRD-PARTY-NOTICES.md).

Releases build and verify the installer, portable ZIP, and checksums through GitHub Actions. See [browser-free publishing](docs/RELEASING.md#browser-free-release-publishing) for the release process.
