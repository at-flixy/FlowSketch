[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$taskProjectDirectory = Split-Path -Parent $PSScriptRoot
$taskBootstrapDirectory = Join-Path $taskProjectDirectory 'tools/rust-bootstrap'
New-Item -ItemType Directory -Force -Path $taskBootstrapDirectory | Out-Null
$taskInstaller = Join-Path $taskBootstrapDirectory 'rustup-init.exe'
$taskChecksum = Join-Path $taskBootstrapDirectory 'rustup-init.exe.sha256'
$taskInstallerUrl = 'https://static.rust-lang.org/rustup/dist/x86_64-pc-windows-msvc/rustup-init.exe'
& curl.exe --fail --location --retry 2 --connect-timeout 15 --max-time 180 --silent --show-error $taskInstallerUrl --output $taskInstaller
if ($LASTEXITCODE -ne 0) { throw 'Could not download Rustup from the official distribution server.' }
& curl.exe --fail --location --retry 2 --connect-timeout 15 --max-time 60 --silent --show-error ($taskInstallerUrl + '.sha256') --output $taskChecksum
if ($LASTEXITCODE -ne 0) { throw 'Could not download the official Rustup checksum.' }
$taskExpectedChecksum = ((Get-Content -LiteralPath $taskChecksum -Raw).Trim() -split '\s+')[0]
$taskActualChecksum = (Get-FileHash -LiteralPath $taskInstaller -Algorithm SHA256).Hash.ToLowerInvariant()
if ($taskActualChecksum -ne $taskExpectedChecksum) { throw 'Rustup checksum mismatch; installer was not executed.' }
$env:CARGO_HOME = Join-Path $taskProjectDirectory 'tools/cargo'
$env:RUSTUP_HOME = Join-Path $taskProjectDirectory 'tools/rustup'
& $taskInstaller -y --no-modify-path --profile minimal --default-host x86_64-pc-windows-msvc --default-toolchain 1.99.0
if ($LASTEXITCODE -ne 0) { throw 'Project-local Rust installation failed.' }
$taskCargo = Join-Path $env:CARGO_HOME 'bin/cargo.exe'
$taskRustc = Join-Path $env:CARGO_HOME 'bin/rustc.exe'
$taskManifest = [ordered]@{
    source = $taskInstallerUrl
    rustupSha256 = $taskActualChecksum
    cargoHome = $env:CARGO_HOME
    rustupHome = $env:RUSTUP_HOME
    rustcVersion = (& $taskRustc --version | Out-String).Trim()
    cargoVersion = (& $taskCargo --version | Out-String).Trim()
    target = 'x86_64-pc-windows-msvc'
    persistentPathChanged = $false
}
$taskManifest | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $taskProjectDirectory 'docs/rust-toolchain.json') -Encoding utf8
$taskManifest | ConvertTo-Json
