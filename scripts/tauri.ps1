[CmdletBinding()]
param([Parameter(Position=0)][ValidateSet('dev','build','check','test','driver','webdriver')][string]$Mode = 'dev')
$ErrorActionPreference = 'Stop'
$taskProjectDirectory = Split-Path -Parent $PSScriptRoot
$env:CARGO_HOME = Join-Path $taskProjectDirectory 'tools/cargo'
$env:RUSTUP_HOME = Join-Path $taskProjectDirectory 'tools/rustup'
$taskRustBin = Join-Path $env:CARGO_HOME 'bin'
if (-not (Test-Path -LiteralPath (Join-Path $taskRustBin 'cargo.exe'))) { throw 'Run scripts/bootstrap-rust.ps1 first.' }
$env:PATH = $taskRustBin + ';' + $env:PATH
$env:CARGO_BUILD_JOBS = '2'
Push-Location -LiteralPath $taskProjectDirectory
try {
    switch ($Mode) {
        'dev' { & npm.cmd exec -- tauri dev }
        'build' { & npm.cmd exec -- tauri build --debug --no-bundle }
        'webdriver' { & npm.cmd exec -- tauri build --debug --no-bundle --features webdriver --config src-tauri/tauri.webdriver.conf.json }
        'check' { & cargo.exe check --manifest-path src-tauri/Cargo.toml }
        'test' { & cargo.exe test --manifest-path src-tauri/Cargo.toml --lib }
        'driver' { & cargo.exe install tauri-driver --locked }
    }
    if ($LASTEXITCODE -ne 0) { throw ('Tauri ' + $Mode + ' failed with exit code ' + $LASTEXITCODE) }
}
finally { Pop-Location }
