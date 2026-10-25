# Build and release

## Windows build

```powershell
npm ci
python scripts/package_python.py --locked
npm run build
npm test
python -m unittest discover -s tests -p "test_*.py"
cargo test --locked --manifest-path src-tauri/Cargo.toml --lib
npm run tauri -- build --target x86_64-pc-windows-msvc --bundles nsis
python scripts/package_portable.py
```

NSIS creates a current-user `.exe` installer with English and Polish installer languages and a WebView2 bootstrapper check. Python resources and the service are bundled beside the installed executable. Models are not shipped inside the installer.

Packaging includes the app-local Microsoft C++ DLLs required by the inference wheels. The Microsoft desktop runtime archive and its selected DLLs are pinned in `python-windows.lock.json`; packaging verifies its SHA-256 before copying them beside `python.exe`. Before starting a managed llama.cpp engine, CridVoice copies these libraries alongside that engine too. No separate Python or Visual C++ installation is needed for the packaged speech service or managed text engines.

`package_portable.py` copies the same release executable and resources, adds `portable.flag`, includes documentation, and creates a portable ZIP. Extract the ZIP fully into a writable directory. The portable archive depends on the system's WebView2; Windows 11 normally provides it.

The workflow `.github/workflows/windows.yml` validates on Windows and creates downloadable CI artifacts. It does not publish a release or upload provider secrets. Starting that workflow requires placing the repository in a GitHub repository under your control; no repository has been published automatically.

## Cross-compilation

Linux cross-builds can use Rust's `x86_64-pc-windows-msvc` target, LLVM (including clang-cl/lld-link/llvm-rc), cargo-xwin, and NSIS. Tauri recommends Windows/CI builds where available; cross-builds require a Windows acceptance pass.

```sh
rustup target add x86_64-pc-windows-msvc
cargo install --locked cargo-xwin
npm ci
python scripts/package_python.py --locked
npm run tauri -- build --runner cargo-xwin --target x86_64-pc-windows-msvc --bundles nsis
python scripts/package_portable.py
```

Use a writable `XWIN_CACHE_DIR` when the home directory is restricted. LLVM and NSIS need their libraries/stubs/plugins available. `NSISDIR` can select a portable NSIS installation. Cross-compilation does not exercise Windows UI Automation, WASAPI, keyboard hooks, Credential Manager, or NVIDIA drivers.

## Artifact verification

Verify PE architecture, manifest/version/icon, Python ZIP/wheel hashes, service availability, installer resource paths, the portable folder layout, and archive contents. Generate SHA-256 for each deliverable:

```powershell
Get-FileHash .\release\* -Algorithm SHA256
```

Run the packaged interpreter's import smoke test, then follow [Windows testing](WINDOWS-TESTING.md). Build artifacts should never contain user `data/`, provider keys, audio recordings, environment files, or machine-specific settings.

## Signing

Personal evaluation artifacts are unsigned. For public distribution, obtain a Windows code-signing identity, configure Tauri's supported signing command/certificate settings, timestamp signatures, and verify both the app and installer. Keep signing credentials in CI secrets, never repository files. Unsigned binaries can show Windows reputation prompts; that is separate from whether the build compiles.

## Release gate

Do not label a build production-ready until automated checks and the real Windows acceptance matrix pass. Record OS/build, CPU/RAM, GPU/VRAM, NVIDIA driver, model/runtime versions, tested applications, language/correction examples, latency, packaging, and remaining issues in the validation report. Initial 0.1.0 checks ran in Linux. The [0.1.1 local Windows report](WINDOWS-VALIDATION-2026-10-13.md) records native checks and remaining acceptance work. No signing identity is configured.
