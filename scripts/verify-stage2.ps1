[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$taskProjectDirectory = Split-Path -Parent $PSScriptRoot
Push-Location -LiteralPath $taskProjectDirectory
try {
    & node native/analyzer/tests/run.mjs
    if ($LASTEXITCODE -ne 0) { throw 'Native analyzer verification failed.' }
    & npm.cmd run test
    if ($LASTEXITCODE -ne 0) { throw 'Browser scene unit checks failed.' }
    & pwsh -NoProfile -File scripts/tauri.ps1 test
    if ($LASTEXITCODE -ne 0) { throw 'Rust host checks failed.' }
    & npm.cmd run typecheck
    if ($LASTEXITCODE -ne 0) { throw 'TypeScript verification failed.' }
    Write-Host 'Core checks passed. Repeat the real-window ACC-05 with scripts/tauri-e2e.mjs; see docs/STAGE2_REPORT.md.'
}
finally { Pop-Location }
