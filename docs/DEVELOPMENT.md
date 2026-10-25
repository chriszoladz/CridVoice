# Development

## Windows prerequisites

- Windows 11 x64, current Microsoft WebView2.
- Node.js 24 and npm match the Windows release workflow. Node.js 22.12+ also meets Vite's requirement.
- Rust 1.99.0 matches the tested Windows release workflow.
- Visual Studio Build Tools, Desktop Development with C++, and a Windows SDK.
- Python 3.12+ to assemble the packaged runtime; end users do not need Python.
- For GPU testing: an NVIDIA GPU and current driver. Download GPU speech libraries through the app.

```powershell
npm ci
python scripts/package_python.py --locked
npm run desktop
```

The packaging script builds `src-tauri/resources/python/` from the embedded Windows interpreter and hash-locked Windows wheels. Debug fallback to a developer Python executable is only for incomplete local development; complete runtime packaging is required for releases.

## Frontend work

```sh
npm ci
npm run dev
npm run build
```

Browser preview uses explicitly labelled localStorage state and no fake native results. It permits theme, vocabulary, style, routing, and onboarding review. Native operations produce a “Windows desktop app required” message. Microphone/GPU fields do not simulate a machine.

## Tests

```sh
npm test
python -m unittest discover -s tests -p "test_*.py"
cargo test --manifest-path src-tauri/Cargo.toml --lib
npx playwright install chromium
npm run test:ui
```

Python format tests require NumPy (`python -m pip install numpy==2.2.6` in a development environment). Core Rust tests run on Linux because desktop dependencies are Windows-targeted. Frontend tests check switch and language semantics and configuration. Browser tests cover the complete setup flow and persisted theme, vocabulary, and provider routing. Do not mistake mocked/browser checks for OS integration or recognition accuracy tests.

## Dependency locks

- `package-lock.json`: npm dependencies; use `npm ci`.
- `src-tauri/Cargo.lock`: Rust dependencies; use `--locked` for release/reproducibility.
- `python-windows.lock.json`: Python ZIP and every Windows wheel's immutable URL/hash.
- `src-tauri/resources/model-catalog.json`: downloaded inference assets and model hashes.

`scripts/package_python.py --locked` verifies hashes before extraction. Generating a new Python lock without `--locked` is a maintainer operation; review versions, wheel ABI/platform, license changes, and Windows import smoke tests. Model catalog updates are separate and should remain pinned.

## Design and accessibility

CSS theme variables drive surfaces, colors, and text scaling. Interactive controls use semantic buttons, labels, selects, switch roles, keyboard focus, and reduced-motion behavior. System color mode is observed dynamically. Browser review should include small/minimum Windows dimensions, both modes, every preset, larger text, and keyboard navigation. A user-defined accent can affect contrast; choose readable combinations.

## Adding a provider

Add protocol-specific request construction and response extraction in `core.rs` / `inference.rs`, preserve Rust-only credentials, add meaningful fixture tests, and expose a named protocol in the provider form. Do not treat text-only providers as audio-capable. Keep network routing explicit and forbid automatic cloud fallbacks.

## Adding a model

Add a pinned model record with exact SHA-256 and byte counts, update safe model ID validation in the speech worker when applicable, update the settings/selectors and managed GGUF loading, then test CPU and GPU startup. Do not enable repository `trust_remote_code` or execute model-provided scripts.
