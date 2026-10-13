param([int]$Jobs = 2)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$sdkRoot = Join-Path $projectRoot 'tools\clang-sdk\llvm-23.1.3'
if (!(Test-Path -LiteralPath (Join-Path $sdkRoot 'include\clang\Tooling\Tooling.h')) -or !(Test-Path -LiteralPath (Join-Path $projectRoot 'tools\clang-sdk\dependencies.json'))) {
  & (Join-Path $PSScriptRoot 'bootstrap-clang-sdk.ps1')
}
$vsWhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
$vsRoot = & $vsWhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if (!$vsRoot) { throw 'MSVC x64 build tools are required for the official Windows Clang SDK.' }
$devCmd = Join-Path $vsRoot 'Common7\Tools\VsDevCmd.bat'
if (!(Test-Path -LiteralPath $devCmd)) { throw "Missing VsDevCmd: $devCmd" }
# Initialize only this PowerShell process and its children. Never persist PATH/registry settings.
$originalEnvironment = @{}
Get-ChildItem Env: | ForEach-Object { $originalEnvironment[$_.Name] = $_.Value }
try {
  $environmentLines = & $env:ComSpec /d /c ('call "' + $devCmd + '" -no_logo -arch=x64 -host_arch=x64 >nul && set')
  if ($LASTEXITCODE -ne 0) { throw 'VsDevCmd failed.' }
  foreach ($entry in $environmentLines) {
    if ($entry -match '^([^=]+)=(.*)$') { [Environment]::SetEnvironmentVariable($matches[1], $matches[2], 'Process') }
  }
  $cmake = (Get-Command cmake.exe -ErrorAction Stop).Source
  $ninja = (Get-Command ninja.exe -ErrorAction Stop).Source
  $compiler = Join-Path $sdkRoot 'bin\clang-cl.exe'
  $depsRoot = Join-Path $projectRoot 'tools\clang-sdk\deps'
  $depsPrefix = Join-Path $depsRoot 'installed'
  foreach ($dependency in @(
    @{name='zlib';source=(Join-Path $depsRoot 'zlib-1.3.2');options=@('-DZLIB_BUILD_SHARED=OFF','-DZLIB_BUILD_TESTING=OFF')},
    @{name='zstd';source=(Join-Path $depsRoot 'zstd-1.5.7\build\cmake');options=@('-DZSTD_BUILD_SHARED=OFF','-DZSTD_BUILD_PROGRAMS=OFF','-DZSTD_BUILD_TESTS=OFF','-DZSTD_USE_STATIC_RUNTIME=ON')}
  )) {
    $installedLibrary = Join-Path $depsPrefix $(if ($dependency.name -eq 'zlib') { 'lib\zs.lib' } else { 'lib\zstd_static.lib' })
    if (Test-Path -LiteralPath $installedLibrary) { continue }
    $depBuild = Join-Path $depsRoot ($dependency.name + '-build')
    & $cmake -S $dependency.source -B $depBuild -G Ninja '-DCMAKE_BUILD_TYPE=Release' '-DCMAKE_MSVC_RUNTIME_LIBRARY=MultiThreaded' "-DCMAKE_C_COMPILER=$compiler" "-DCMAKE_CXX_COMPILER=$compiler" "-DCMAKE_MAKE_PROGRAM=$ninja" "-DCMAKE_INSTALL_PREFIX=$depsPrefix" @($dependency.options)
    if ($LASTEXITCODE -ne 0) { throw ($dependency.name + ' configuration failed.') }
    & $cmake --build $depBuild --parallel $Jobs
    if ($LASTEXITCODE -ne 0) { throw ($dependency.name + ' build failed.') }
    & $cmake --install $depBuild
    if ($LASTEXITCODE -ne 0) { throw ($dependency.name + ' local install failed.') }
  }
  $buildRoot = Join-Path $projectRoot 'native\analyzer\build'
  & $cmake -S (Join-Path $projectRoot 'native\analyzer') -B $buildRoot -G Ninja '-DCMAKE_BUILD_TYPE=Release' '-DCMAKE_MSVC_RUNTIME_LIBRARY=MultiThreaded' "-DCMAKE_C_COMPILER=$compiler" "-DCMAKE_CXX_COMPILER=$compiler" "-DCMAKE_MAKE_PROGRAM=$ninja" "-DLLVM_DIR=$sdkRoot\lib\cmake\llvm" "-DClang_DIR=$sdkRoot\lib\cmake\clang" "-DCMAKE_PREFIX_PATH=$depsPrefix" "-DZLIB_LIBRARY=$depsPrefix\lib\zs.lib" "-DZLIB_INCLUDE_DIR=$depsPrefix\include"
  if ($LASTEXITCODE -ne 0) { throw 'Native analyzer CMake configuration failed.' }
  & $cmake --build $buildRoot --parallel $Jobs
  if ($LASTEXITCODE -ne 0) { throw 'Native analyzer build failed.' }
  $exe = Join-Path $buildRoot 'bin\flowsketch-analyzer.exe'
  if (!(Test-Path -LiteralPath $exe)) { throw 'Build completed without analyzer executable.' }
  & $exe --version
  if ($LASTEXITCODE -ne 0) { throw 'Analyzer version smoke failed.' }
  Write-Output $exe
} finally {
  Get-ChildItem Env: | ForEach-Object {
    if (!$originalEnvironment.ContainsKey($_.Name)) { [Environment]::SetEnvironmentVariable($_.Name, $null, 'Process') }
  }
  foreach ($name in $originalEnvironment.Keys) { [Environment]::SetEnvironmentVariable($name, $originalEnvironment[$name], 'Process') }
}
