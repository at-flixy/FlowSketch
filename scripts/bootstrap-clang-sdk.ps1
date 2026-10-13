[CmdletBinding()]
param([string]$ProjectRoot=(Split-Path -Parent $PSScriptRoot))
$ErrorActionPreference='Stop'
$taskProjectRoot=[IO.Path]::GetFullPath($ProjectRoot)
$taskSdkRoot=Join-Path $taskProjectRoot 'tools\clang-sdk'
$taskArchiveName='clang+llvm-23.1.3-x86_64-pc-windows-msvc.tar.zst'
$taskArchivePath=Join-Path $taskSdkRoot $taskArchiveName
$taskExpectedSize=276320456
$taskExpectedSha='7e69dc07a4536b79ff24a651a2611990bf8eaab17ea560f1092707c4f31ba01d'
$taskSdkDirectory=Join-Path $taskSdkRoot 'llvm-23.1.3'
$taskUrl='https://github.com/llvm/llvm-project/releases/download/llvmorg-23.1.3/clang%2Bllvm-23.1.3-x86_64-pc-windows-msvc.tar.zst'
New-Item -ItemType Directory -Path $taskSdkRoot -Force | Out-Null
if(-not (Test-Path -LiteralPath $taskArchivePath) -or (Get-Item -LiteralPath $taskArchivePath).Length -lt $taskExpectedSize){
  Write-Host 'Downloading official portable LLVM23 SDK locally (276.3MB)...'
  $taskCurlPath=Join-Path $env:SystemRoot 'System32\curl.exe'
  & $taskCurlPath --silent --show-error --location --fail --retry 5 --retry-delay 2 --continue-at - --output $taskArchivePath $taskUrl
  if($LASTEXITCODE -ne 0){throw 'SDK download failed; partial archive is retained for resume.'}
}
if((Get-Item -LiteralPath $taskArchivePath).Length -ne $taskExpectedSize){throw 'SDK asset size mismatch.'}
$taskSha=(Get-FileHash -LiteralPath $taskArchivePath -Algorithm SHA256).Hash.ToLowerInvariant()
if($taskSha -ne $taskExpectedSha){throw 'Published SDK asset SHA256 mismatch; no extraction/execution.'}
if(-not (Test-Path -LiteralPath (Join-Path $taskSdkDirectory 'include\clang\Tooling\Tooling.h'))){
  New-Item -ItemType Directory -Path $taskSdkDirectory -Force | Out-Null
  $taskTarPath=(Get-Command tar -CommandType Application | Select-Object -First 1).Source
  # Official LLVM zstd assets use a long window exceeding bsdtar's default.
  $taskDecoderZip=Join-Path $taskSdkRoot 'zstd-v1.5.7-win64.zip'
  $taskDecoderSha='acb4e8111511749dc7a3ebedca9b04190e37a17afeb73f55d4425dbf0b90fad9'
  if(-not (Test-Path -LiteralPath $taskDecoderZip)){
    Invoke-WebRequest -Uri 'https://github.com/facebook/zstd/releases/download/v1.5.7/zstd-v1.5.7-win64.zip' -OutFile $taskDecoderZip
  }
  if((Get-FileHash -LiteralPath $taskDecoderZip -Algorithm SHA256).Hash.ToLowerInvariant() -ne $taskDecoderSha){throw 'Pinned local decoder SHA256 mismatch.'}
  $taskDecoderExe=Join-Path $taskSdkRoot 'decoder\zstd-v1.5.7-win64\zstd.exe'
  if(-not (Test-Path -LiteralPath $taskDecoderExe)){Expand-Archive -LiteralPath $taskDecoderZip -DestinationPath (Join-Path $taskSdkRoot 'decoder') -Force}
  $taskUncompressedTar=Join-Path $taskSdkRoot 'llvm-23.1.3-sdk.tar'
  & $taskDecoderExe --decompress --long=31 --force -o $taskUncompressedTar $taskArchivePath
  if($LASTEXITCODE -ne 0){throw 'Long-window zstd SDK decompression failed.'}
  $taskEntries=& $taskTarPath -tf $taskUncompressedTar
  if($LASTEXITCODE -ne 0){throw 'tar cannot inspect the official SDK archive.'}
  foreach($taskEntry in $taskEntries){if($taskEntry -match '(^/|^[A-Za-z]:|(^|/)\.\.(/|$))'){throw 'Unsafe archive path.'}}
  Write-Host 'Extracting LLVM headers/libraries locally; no installation or registry/PATH modification...'
  & $taskTarPath -xf $taskUncompressedTar -C $taskSdkDirectory --strip-components=1
  if($LASTEXITCODE -ne 0){throw 'SDK extraction failed.'}
}
foreach($taskRequired in @('include\clang\Tooling\Tooling.h','lib\clangTooling.lib','lib\clangAST.lib','lib\cmake\llvm\LLVMConfig.cmake','lib\cmake\clang\ClangConfig.cmake')){if(-not (Test-Path -LiteralPath (Join-Path $taskSdkDirectory $taskRequired))){throw ('Missing SDK component: '+$taskRequired)}}
# The official SDK exports static compression-library targets, but omits their
# developer headers/libraries. Fetch only their pinned official source releases.
$taskDependencySpecs=@(
 @{name='zlib';version='1.3.2';asset='zlib-1.3.2.tar.gz';sha='bb329a0a2cd0274d05519d61c667c062e06990d72e125ee2dfa8de64f0119d16';url='https://github.com/madler/zlib/releases/download/v1.3.2/zlib-1.3.2.tar.gz';digestOrigin='published GitHub release SHA256'},
 @{name='zstd';version='1.5.7';asset='zstd-1.5.7.tar.gz';sha='eb33e51f49a15e023950cd7825ca74a4a2b43db8354825ac24fc1b7ee09e6fa3';url='https://github.com/facebook/zstd/releases/download/v1.5.7/zstd-1.5.7.tar.gz';digestOrigin='observed official source asset SHA256 pinned locally'}
)
$taskDeps=Join-Path $taskSdkRoot 'deps'
New-Item -ItemType Directory -Path $taskDeps -Force | Out-Null
foreach($taskDependency in $taskDependencySpecs){
 $taskDepArchive=Join-Path $taskDeps $taskDependency.asset
 if(-not (Test-Path -LiteralPath $taskDepArchive)){Invoke-WebRequest -Uri $taskDependency.url -OutFile $taskDepArchive}
 if((Get-FileHash -LiteralPath $taskDepArchive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $taskDependency.sha){throw ('Dependency digest mismatch: '+$taskDependency.name)}
 $taskDepSource=Join-Path $taskDeps ($taskDependency.name+'-'+$taskDependency.version)
 if(-not (Test-Path -LiteralPath (Join-Path $taskDepSource 'CMakeLists.txt')) -and -not (Test-Path -LiteralPath (Join-Path $taskDepSource 'build\cmake\CMakeLists.txt'))){
  $taskNativeTar=Join-Path $env:SystemRoot 'System32\tar.exe'
  & $taskNativeTar -xf $taskDepArchive -C $taskDeps '--exclude=*/tests/*'
  if($LASTEXITCODE -ne 0){throw ('Dependency extraction failed: '+$taskDependency.name)}
 }
}
$taskManifest=[ordered]@{version='23.1.3';tag='llvmorg-23.1.3';repository='https://github.com/llvm/llvm-project';releaseUrl='https://github.com/llvm/llvm-project/releases/tag/llvmorg-23.1.3';assetUrl=$taskUrl;assetSizeBytes=$taskExpectedSize;assetSha256=$taskSha;publishedDigestVerified=$true;sdkRoot=$taskSdkDirectory;decoder=@{version='1.5.7';assetUrl='https://github.com/facebook/zstd/releases/download/v1.5.7/zstd-v1.5.7-win64.zip';assetSha256='acb4e8111511749dc7a3ebedca9b04190e37a17afeb73f55d4425dbf0b90fad9';digestOrigin='Observed official release asset SHA256 pinned locally; upstream asset API did not provide digest'};scope='project-local portable SDK; no system-wide install, persistent PATH or registry changes'}
$taskManifest | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $taskSdkRoot 'manifest.json') -Encoding utf8
$taskDependencySpecs | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $taskSdkRoot 'dependencies.json') -Encoding utf8
$taskManifest | ConvertTo-Json -Depth 4
