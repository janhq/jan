# Windows portable package

Extract `Jan_<version>_x64-portable.zip` into a writable folder and run
`Jan-Desktop.exe` (`Jan-Desktop-beta.exe` or `Jan-Desktop-nightly.exe` for
those channels). Keep the entire extracted directory together.

Microsoft Edge WebView2 Runtime and the Microsoft Visual C++ x64 runtime must
already be installed. GPU acceleration needs a compatible graphics driver.
The ZIP contains the desktop app, the llama.cpp worker, its runtime DLLs,
Bun, uv, and the license, following the Windows bundle configuration.
Models are downloaded separately.

This is an installation-free app package. Settings, conversations, and models
still use Jan's normal user data folder. Copying the ZIP to a USB drive does
not transfer that data. To update, extract a newer ZIP; the in-app updater
downloads an installer intended for an installed copy of Jan.

## Build locally

Run the normal Windows build with `make build`, then:

```powershell
yarn package:portable:win32
```

The package is written to `src-tauri/target/portable/`. The packager respects
`CARGO_TARGET_DIR` when locating the release executable, or accepts an explicit
release directory:

```powershell
./scripts/package-windows-portable.ps1 -ReleaseDir C:/build/release
```

Resources come from `src-tauri/resources/`, prepared by the same build. Rebuild
before packaging after changing the app, engine, or channel. Packaging fails
if a required resource is missing or empty.

## GitHub Actions

Run **Manual build portable (windows)** on the branch containing these changes.
Leave `build_ref` empty to build that branch, or select a ref that also contains
the packager. Set the version and channel. Download the
`jan-windows-portable-<version>` artifact after the job succeeds; it contains
the portable ZIP.

The manual build uses the fork's reusable workflow. Build-only runs can produce
unsigned packages without the upstream signing secrets. Publishing runs retain
the existing engine, code-signing, and updater-signature requirements. The
reusable workflow also attaches the portable ZIP when publishing to GitHub.

## Verify packaging

Run the packaging checks without compiling the app or installing test tools:

```powershell
./scripts/tests/package-windows-portable.Tests.ps1
```

These checks use small fixture files to verify archive layout, channel names,
GitHub Actions outputs, missing dependencies, and replacement of older archives.
They do not test the desktop UI or model inference.
