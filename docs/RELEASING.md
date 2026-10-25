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

The workflow `.github/workflows/windows.yml` validates on Windows and creates verified CI artifacts. Normal pushes, pull requests and default manual runs do not publish releases. The public repository is [chriszoladz/CridVoice](https://github.com/chriszoladz/CridVoice).

## Browser-free release publishing

Codex can request a release through the connected GitHub plugin. No browser, personal access token, local GitHub CLI sign-in, provider key or password-manager access is needed. The publishing job uses GitHub's repository-scoped temporary credential, which expires when its job ends.

First commit the intended application changes and make the version agree in `package.json`, both root entries of `package-lock.json`, `src-tauri/Cargo.toml`, the package entry in `src-tauri/Cargo.lock`, and `src-tauri/tauri.conf.json`.

Then create or update `.github/release-request.json` on **main** through the plugin:

```json
{
  "version": "0.1.20",
  "publish": true,
  "request_id": "12345678-1234-4234-8234-123456789abc"
}
```

Use the current intended version and a **new UUID** for each request. Do not put `[skip ci]` in the request commit message. That exact immutable request commit is built and becomes the release tag's source. Later commits that leave the request file unchanged do not publish again. Pull requests, forks and other branches cannot publish through this workflow.

For a rehearsal, use `"publish": false`. It runs the same tests, Windows build, packaging and asset verification, then retains downloadable CI artifacts without creating a GitHub Release. Setting up this pipeline does not itself authorize publishing a version; an explicit publishing request is still needed.

The workflow runs frontend, Python, native Rust, Clippy and browser-flow checks; packages the Windows interpreter; builds the installer and portable app; verifies PE architectures, Windows file versions, portable-resource equality, archive layout and SHA-256 checksums; then uploads this exact asset set:

| Asset | Contents |
| --- | --- |
| `CridVoice-VERSION-windows-x64-setup.exe` | Windows installer |
| `CridVoice-VERSION-windows-x64-installer.zip` | The same installer with start instructions and notices |
| `CridVoice-VERSION-windows-x64-portable.zip` | Complete portable folder with Python, service, help and documentation |
| `SHA256SUMS.txt` | Checksums of the release payloads and build information |
| `BUILD-INFO.json` | Version, immutable source commit and verified artifact hashes; no private machine paths |

The read-only Windows build job uploads an immutable artifact. A separate publication job receives **contents: write** only for this repository, downloads that run's exact artifact ID and checks it again. It creates a draft, uploads the files, downloads each uploaded asset to verify its checksum, then publishes an **unsigned evaluation pre-release**. It never marks an unsigned build as the latest production release. Managed setup downloads the selected models separately; personal settings, recordings, history, credentials and local model weights are excluded.

Publication is serialized. Existing version tags pointing to another commit, unrelated drafts, unexpected assets, mismatched checksums and already published releases with different content stop the process without overwriting them. A failed upload can be resumed by rerunning only the failed publish job with its original immutable artifact. Rerunning an entire build can produce different binary bytes; a mismatched older draft is preserved for inspection.

The GitHub plugin can inspect workflow jobs, logs and artifacts and rerun a failed job. If you already use an authenticated GitHub CLI, `gh workflow run windows.yml --ref main -f publish_release=true` is an alternative explicit request, using the current main commit. Running without that flag builds and verifies only. This local CLI route is optional and is not needed for plugin-based publishing.

The pipeline checks packaging and automated behavior. It does not replace real microphone, GPU, accessibility/focus or target-application acceptance tests. No signing certificate is currently configured; stable signed releases require a separately reviewed signing setup.

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
