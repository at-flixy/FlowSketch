# Build and run FlowSketch on Windows

FlowSketch is a Windows desktop prototype built with Tauri, React and a native
Clang analyzer. It draws the supported normal control flow of educational C++17
functions. It parses submitted C++ without linking or executing the program.
No AI service or API key is required.

The current desktop export is **SVG**. The browser scene module and the earlier
experiments also exercise PNG/PDF export, but those formats are not yet exposed
as completed desktop features. Full C++ coverage and a clean-Windows offline
installer remain future work.

## Prerequisites

Use an x64 Windows development machine. The original prototype was verified on
Windows 11 x64; that result is not a completed Windows 10/11 installation matrix.

| Requirement | Purpose |
| --- | --- |
| Node.js 24.11.1, or a compatible Node 24 version, with npm | Frontend tooling and test runners. Node 24.11.1 is the verified baseline. |
| PowerShell 7 (`pwsh`) | The documented wrappers use `pwsh`; Windows PowerShell 5 alone is insufficient for these commands. |
| Visual Studio / Build Tools with Desktop development with C++, x64 MSVC tools and a Windows SDK | Link the Rust application and the native Windows Clang SDK. |
| CMake 3.25 or newer and Ninja, available to the build script | Build the analyzer and its static compression dependencies. Enable the Visual Studio C++ CMake tools component or install these tools separately. |
| Microsoft Edge WebView2 Runtime | Run the desktop interface. |
| Git and an internet connection during initial dependency setup | Retrieve the repository, npm/Cargo dependencies and pinned toolchain archives. |

Reserve **20 GiB of free workspace disk space** as a conservative planning
budget. This is not a measured minimum. The pinned Clang SDK download is about
276 MB and llvm-mingw about 191 MB, but extracted libraries, retained tar files,
Rust dependencies and build outputs are much larger. In the original development
workspace, `tools/clang-sdk` occupied 4.27 GiB and a target tree containing repeated
builds occupied 4.54 GiB. A fresh build can differ.

The setup scripts install Rust 1.99.0, LLVM/Clang 23.1.3 and llvm-mingw release
20261006 under `tools/`. They verify pinned archive hashes and do not modify the
persistent PATH. A system Rust installation alone does not replace the local
bootstrap used by the current wrappers and Windows process tests.

Run the following commands from the repository root. If a native command exits
with an error, stop and fix that error before continuing.

## Frontend-only checks

These checks do not need the LLVM SDK or a running Tauri window:

```powershell
npm ci
npm run typecheck
npm test
npm run build
```

The semantic graph fixtures used by the scene tests are versioned test inputs.
They are references from earlier Clang runs, not a substitute analyzer in the
application. The tests measure real local font bytes, run ELK, check geometry,
and test cancellation/resource cleanup. They do not exercise WebView2 or native
file dialogs.

`npm run dev` serves the interface at `http://127.0.0.1:1420`. Native analysis
requires the Tauri host; opening that URL in an ordinary browser does not provide
the native analyzer commands.

## Build the ordinary desktop prototype

```powershell
npm ci
pwsh -NoProfile -File scripts/bootstrap-rust.ps1
pwsh -NoProfile -File spikes/clang/bootstrap-toolchain.ps1
pwsh -NoProfile -File scripts/bootstrap-clang-sdk.ps1
pwsh -NoProfile -File scripts/build-analyzer.ps1
pwsh -NoProfile -File scripts/tauri.ps1 build
pwsh -NoProfile -File scripts/verify-stage2.ps1
```

`tauri.ps1 build` runs the frontend build and creates an ordinary **debug-mode**
prototype without the optional WebDriver feature. It is not an optimized release
installer. Its executable is `src-tauri/target/debug/flowsketch.exe`.
`verify-stage2.ps1` runs the native analyzer corpus, browser-independent scene
tests, Windows Rust host tests and TypeScript checks. It does not launch the GUI.

For development after the native setup:

```powershell
npm run desktop:dev
```

The development host resolves the analyzer and toolchain relative to this
checkout. The packaged host uses the `analyzer` and `toolchain` folders next to
the executable.

## Refresh notices and package the folder

The repository carries the notices and supplemental upstream declarations for
the recorded dependency versions. Refresh the dependency inventory before
distributing a new build, especially after changing either lockfile. Cargo
metadata needs registry source packages in the local cache; do not assume that
an initial Windows-only build has cached every non-Windows package included in
the inventory. The first metadata command below permits those downloads.

```powershell
$env:CARGO_HOME = Join-Path $PWD 'tools/cargo'
$env:RUSTUP_HOME = Join-Path $PWD 'tools/rustup'
$env:PATH = (Join-Path $env:CARGO_HOME 'bin') + ';' + $env:PATH
$flowSketchCargo = Join-Path $env:CARGO_HOME 'bin/cargo.exe'

New-Item -ItemType Directory -Force -Path spikes/tauri | Out-Null
& $flowSketchCargo metadata --manifest-path src-tauri/Cargo.toml --locked --format-version 1 |
    Set-Content -LiteralPath spikes/tauri/cargo-metadata.json -Encoding utf8
if ($LASTEXITCODE -ne 0) { throw 'Cargo metadata failed.' }

node scripts/collect-notices.mjs
if ($LASTEXITCODE -ne 0) { throw 'Notice collection failed.' }

pwsh -NoProfile -File scripts/package-prototype.ps1
```

The collector copies installed license files. Retain the supplemental
`UPSTREAM-*` declarations and license texts already under
`docs/distribution-notices`, and review notices when updating dependencies.
See [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md).

Packaging produces `prototype/windows-x64/` with the executable, analyzer,
the complete pinned header roots, notices and a manifest. It verifies the copied
payload against the local build and pinned header profile. It does **not** create
a ZIP by itself. To create and read back the current prototype archive:

```powershell
Compress-Archive -Path prototype/windows-x64 -DestinationPath prototype/FlowSketch-0.1-prototype-windows-x64.zip -Force
python scripts/verify-prototype-zip.py
```

The ZIP readback uses only the Python standard library. Python is optional if
you do not run that check. The verifier expects the archive name and
`windows-x64/` prefix shown above; update it when changing the package version.

Run `prototype/windows-x64/FlowSketch.exe` and keep its sibling folders intact.
Node.js, Rust, the Clang compiler executable and the full LLVM SDK are not needed
to run this folder. WebView2 is still required. Hash/manifest verification does
not replace testing on a clean Windows installation.

## Optional experiment and desktop checks

Stage 1 PDF readback additionally needs Python with Pillow and pypdf, plus a
working Poppler `pdftoppm` executable. Set `FLOWSKETCH_PYTHON` and
`FLOWSKETCH_PDFTOPPM` to their absolute paths before running
`scripts/verify-stage1.ps1`. These are test dependencies, not desktop runtime
dependencies. Scripts otherwise look for `python` (`python3` on non-Windows)
and `pdftoppm` on PATH; explicit environment variables remove ambiguity.

The real Tauri E2E uses an optional `webdriver` build and a running Windows
window. Its setup and coverage are documented in
[STAGE2_REPORT.md](STAGE2_REPORT.md). `prototype-smoke.cjs` is a separate optional
CDP/Playwright smoke check; it needs its own Playwright installation and a
desktop process launched with the temporary diagnostic port enabled. Neither
check belongs to the basic headless CI gate. Install Playwright separately for
this optional smoke check, for example `npm install --no-save --package-lock=false playwright`.
The script resolves it from this checkout's `node_modules` by default. To reuse
another installation, set `FLOWSKETCH_PLAYWRIGHT_MODULES` to the directory containing
its `playwright` package. Do not commit that temporary installation or modify the lockfile.

## CI without a desktop window

Use separate gates for frontend checks and native Windows checks. A Windows
runner must have the prerequisites above; inspect the
[official runner inventory](https://github.com/actions/runner-images/blob/main/images/windows/Windows2025-Readme.md)
and keep explicit preflight checks for CMake, Ninja and the x64 VS toolchain.
Use the verified Node version rather than relying on the image's default Node.

The current [CI workflow](../.github/workflows/ci.yml) has an Ubuntu frontend gate
(`npm ci`, type checking, scene/layout/oracle tests and `npm run build`) and a
Windows Rust-host gate (frontend build, project-local Rust bootstrap, host tests
and `cargo check`). It does not download LLVM or build the analyzer. A future
native artifact gate can add the Clang bootstrap/build, native corpus, ordinary
Tauri build, notices, package manifest checks and ZIP readback. Those commands
are already available above, but are not implied by a green default CI run.

Do not invoke `desktop:dev`, native file pickers, WebDriver E2E or the CDP smoke
test in these headless gates. A passing hosted build checks dependency
installation, frontend compilation and the covered protocol/logic invariants;
package manifest/ZIP consistency, GUI behavior, packaged-origin
Worker behavior, DPI and clean-machine installation remain separate gates.
