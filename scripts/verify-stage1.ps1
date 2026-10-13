param()
$ErrorActionPreference = 'Stop'
$projectDirectory = Split-Path -Parent $PSScriptRoot
Push-Location -LiteralPath $projectDirectory
try {
    if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
        throw 'Node.js is required. See README.md for prerequisites.'
    }
    # Fixed local checks; submitted C++ is parsed and never executed.
    $checks = @(
        @{ Name = 'Clang AST/CFG and semantic fixture checks'; Arguments = @('spikes/clang/run-spike.mjs') },
        @{ Name = 'Layout/export regression tests'; Arguments = @('--test', 'spikes/layout-export/test.mjs') },
        @{ Name = 'Independent semantic oracle tests'; Arguments = @('--test', 'spikes/integration/oracle.test.mjs') },
        @{ Name = 'Synthetic layout/export and independent PDF rendering'; Arguments = @('spikes/layout-export/run.mjs') },
        @{ Name = 'Written-scene port and flow-direction observations'; Arguments = @('spikes/layout-export/observe.mjs') },
        @{ Name = 'Real C++ to SVG/PDF/PNG integration'; Arguments = @('spikes/integration/run.mjs') },
        @{ Name = 'All supported Clang graphs through layout'; Arguments = @('spikes/integration/audit-clang-layout.mjs') }
    )
    foreach ($check in $checks) {
        Write-Host $check.Name
        $taskArguments = $check.Arguments
        & node @taskArguments
        if ($LASTEXITCODE -ne 0) {
            throw ('Stage 1 check failed: ' + $check.Name + ', exit code ' + $LASTEXITCODE)
        }
    }
    Write-Host 'Stage 1 technical checks passed. This does not accept the full specification or the Windows installer.'
}
finally {
    Pop-Location
}
