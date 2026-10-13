[CmdletBinding()]
param([switch]$Bootstrap)
$ErrorActionPreference='Stop'
if($Bootstrap){ & (Join-Path $PSScriptRoot 'bootstrap-toolchain.ps1') }
if(-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'toolchain.json'))){throw 'Run bootstrap-toolchain.ps1 once before this spike.'}
$taskNodeExecutable=(Get-Command node -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
& $taskNodeExecutable (Join-Path $PSScriptRoot 'run-spike.mjs')
if($LASTEXITCODE -ne 0){throw 'Clang spike checks failed. Inspect evidence.json and per-fixture artifacts.'}
