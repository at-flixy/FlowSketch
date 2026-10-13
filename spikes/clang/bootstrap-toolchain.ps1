[CmdletBinding()]
param([string]$ProjectRoot = (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)))
$ErrorActionPreference = 'Stop'
$taskProjectRoot = [IO.Path]::GetFullPath($ProjectRoot)
$taskToolsRoot = Join-Path $taskProjectRoot 'tools'
$taskReleaseTag = '20261006'
$taskAssetName = 'llvm-mingw-20261006-ucrt-x86_64.zip'
$taskExpectedSha256 = '317492c456aa27ee607a5919f1d2d38dcdc1112516a24d0bf4b00d078f52d17a'
$taskExpectedSize = 190836485
$taskDownloadUrl = 'https://github.com/mstorsjo/llvm-mingw/releases/download/20261006/llvm-mingw-20261006-ucrt-x86_64.zip'
$taskArchivePath = Join-Path $taskToolsRoot $taskAssetName
$taskToolchainRoot = Join-Path $taskToolsRoot 'llvm-mingw-20261006-ucrt-x86_64'
New-Item -ItemType Directory -Path $taskToolsRoot -Force | Out-Null
if (-not (Test-Path -LiteralPath $taskArchivePath)) {
    Write-Host 'Downloading pinned official portable llvm-mingw UCRT x86_64 toolchain...'
    Invoke-WebRequest -Uri $taskDownloadUrl -OutFile $taskArchivePath -Headers @{'User-Agent'='FlowSketch-Clang-Spike'}
}
$taskArchiveInfo = Get-Item -LiteralPath $taskArchivePath
if ($taskArchiveInfo.Length -ne $taskExpectedSize) { throw 'Archive size mismatch; leave the file for inspection and do not execute it.' }
$taskSha256 = (Get-FileHash -LiteralPath $taskArchivePath -Algorithm SHA256).Hash.ToLowerInvariant()
if ($taskSha256 -ne $taskExpectedSha256) { throw 'Published GitHub asset SHA256 mismatch; do not extract or execute.' }
$taskClangPath = Join-Path $taskToolchainRoot 'bin\clang++.exe'
if (-not (Test-Path -LiteralPath $taskClangPath)) {
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $taskZip = [IO.Compression.ZipFile]::OpenRead($taskArchivePath)
    try {
        foreach ($taskEntry in $taskZip.Entries) {
            $taskExtractedPath = [IO.Path]::GetFullPath((Join-Path $taskToolsRoot $taskEntry.FullName))
            if (-not $taskExtractedPath.StartsWith($taskToolchainRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) -and $taskExtractedPath -ne $taskToolchainRoot) {
                throw 'Archive entry escapes its expected toolchain directory.'
            }
        }
    } finally { $taskZip.Dispose() }
    Write-Host 'Extracting locally inside project/tools; no system install or PATH change.'
    Expand-Archive -LiteralPath $taskArchivePath -DestinationPath $taskToolsRoot -Force
}
if (-not (Test-Path -LiteralPath $taskClangPath)) { throw 'Expected clang++.exe is missing after extraction.' }
$taskManifest = [ordered]@{
    repository = 'https://github.com/mstorsjo/llvm-mingw'
    releaseTag = $taskReleaseTag
    releaseUrl = 'https://github.com/mstorsjo/llvm-mingw/releases/tag/20261006'
    assetUrl = $taskDownloadUrl
    assetName = $taskAssetName
    assetSizeBytes = $taskArchiveInfo.Length
    assetSha256 = $taskSha256
    publishedDigestVerified = $true
    toolchainRoot = $taskToolchainRoot
    executable = $taskClangPath
    executableSha256 = (Get-FileHash -LiteralPath $taskClangPath -Algorithm SHA256).Hash.ToLowerInvariant()
    installationScope = 'project-local portable; no PATH or registry modifications'
}
$taskManifest | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $PSScriptRoot 'toolchain.json') -Encoding utf8
$taskManifest | ConvertTo-Json -Depth 4
