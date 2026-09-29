param(
    [string]$NodeExe,
    [string]$DotnetExe = "dotnet"
)

$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$releaseRoot = Join-Path $repoRoot "release\native-phase4e-acceptance-$stamp"
$stageRoot = Join-Path $releaseRoot "stage"
$hostStage = Join-Path $stageRoot "host"
$managerBuild = Join-Path $releaseRoot "manager-build"
$managerStage = Join-Path $stageRoot "manager"
$nativeExe = Join-Path $hostStage "WebTools.NativeHost.exe"
$managerExe = Join-Path $managerStage "WebTools.exe"
$installer = Join-Path $releaseRoot "WebTools-Native-Phase4E-Setup.exe"

if (-not $NodeExe) {
    $nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
    if ($nodeCommand) {
        $NodeExe = $nodeCommand.Source
    } else {
        $fallbackNode = Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
        if (Test-Path $fallbackNode) { $NodeExe = $fallbackNode }
    }
}
if (-not $NodeExe -or -not (Test-Path $NodeExe)) { throw "Node.js executable not found. Pass -NodeExe <path>." }

$npmCommand = Get-Command npm.cmd -ErrorAction SilentlyContinue
if ($npmCommand) {
    $env:Path = "$(Split-Path $npmCommand.Source);$env:Path"
} elseif (Test-Path "C:\Program Files\nodejs\npm.cmd") {
    $env:Path = "C:\Program Files\nodejs;$env:Path"
}

New-Item -ItemType Directory -Path $hostStage, $managerStage -Force | Out-Null

function Invoke-Checked {
    param([string]$FilePath, [string[]]$ArgumentList)
    & $FilePath @ArgumentList
    if ($LASTEXITCODE -ne 0) { throw "$FilePath failed with exit code $LASTEXITCODE" }
}

function Invoke-Nsis {
    param([string]$FilePath, [string]$RawArguments)
    $startInfo = [System.Diagnostics.ProcessStartInfo]::new()
    $startInfo.FileName = $FilePath
    $startInfo.Arguments = $RawArguments
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $process = [System.Diagnostics.Process]::Start($startInfo)
    if (-not $process) { throw "Could not start NSIS executable: $FilePath" }
    if (-not $process.WaitForExit(300000)) {
        $process.Kill()
        throw "NSIS process timed out: $FilePath $RawArguments"
    }
    if ($process.ExitCode -ne 0) { throw "NSIS process failed with exit code $($process.ExitCode): $FilePath" }
}

$electronVite = Join-Path $repoRoot "node_modules\electron-vite\bin\electron-vite.js"
$electronBuilder = Join-Path $repoRoot "node_modules\electron-builder\cli.js"
Invoke-Checked $NodeExe @($electronVite, "build")
Invoke-Checked $DotnetExe @(
    "publish", "native\WebTools.NativeHost\WebTools.NativeHost.csproj",
    "--configuration", "Release", "--runtime", "win-x64", "--self-contained", "true",
    "-p:UseAppHost=true", "-p:PublishSingleFile=false", "-p:PublishTrimmed=false",
    "-o", $hostStage
)
Invoke-Checked $NodeExe @(
    $electronBuilder, "--win", "--x64", "--dir",
    "--config.directories.output=$managerBuild"
)

$unpackedManager = Join-Path $managerBuild "win-unpacked"
if (-not (Test-Path (Join-Path $unpackedManager "WebTools.exe"))) {
    throw "electron-builder output did not contain win-unpacked\WebTools.exe."
}
Copy-Item -Path (Join-Path $unpackedManager "*") -Destination $managerStage -Recurse -Force
Copy-Item -LiteralPath (Join-Path $repoRoot "resources\app.ico") -Destination (Join-Path $stageRoot "app.ico")

$makensisCache = Join-Path $env:LOCALAPPDATA "electron-builder\Cache\nsis-3.0.4.1"
$makensis = Get-ChildItem -LiteralPath $makensisCache -Recurse -Filter "makensis.exe" -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -match "\\Bin\\makensis\.exe$" } |
    Select-Object -First 1 -ExpandProperty FullName
if (-not $makensis) { throw "electron-builder NSIS compiler not found in $makensisCache" }
Copy-Item -LiteralPath (Join-Path $PSScriptRoot "native-phase4e-acceptance.nsi") -Destination (Join-Path $releaseRoot "native-phase4e-acceptance.nsi")

Push-Location $releaseRoot
try {
    Invoke-Checked $makensis @("native-phase4e-acceptance.nsi")
} finally {
    Pop-Location
}

foreach ($required in @(
    $nativeExe,
    (Join-Path $hostStage "WebTools.NativeHost.dll"),
    $managerExe,
    (Join-Path $managerStage "resources\app.asar")
)) {
    if (-not (Test-Path -LiteralPath $required)) { throw "Required staged file missing: $required" }
}
if (-not (Test-Path -LiteralPath $installer)) { throw "Installer was not created: $installer" }

$smokeRoot = Join-Path $releaseRoot "smoke-install"
$smokeInstall = Join-Path $smokeRoot "Phase 4E 中文 空格验证"
$defaultSmokeInstall = Join-Path $env:LOCALAPPDATA "Programs\WebTools Native Phase 4E"
if (Test-Path -LiteralPath $defaultSmokeInstall) {
    throw "Refusing to run smoke install because its unique default path already exists: $defaultSmokeInstall"
}
New-Item -ItemType Directory -Path $smokeRoot -Force | Out-Null
Invoke-Nsis $installer "/S /D=$smokeInstall"

foreach ($required in @(
    (Join-Path $smokeInstall "WebTools.NativeHost.exe"),
    (Join-Path $smokeInstall "Manager\WebTools.exe"),
    (Join-Path $smokeInstall "Manager\resources\app.asar")
)) {
    if (-not (Test-Path -LiteralPath $required)) { throw "Installed file missing: $required" }
}

Invoke-Checked $DotnetExe @(
    "run", "--project", "native\WebTools.NativeHost.Checks\WebTools.NativeHost.Checks.csproj",
    "--configuration", "Release", "--", "--verify-manager-discovery", $smokeInstall
)

$uninstaller = Join-Path $smokeInstall "Uninstall.exe"
if (-not (Test-Path -LiteralPath $uninstaller)) { throw "Uninstaller missing from smoke install." }
Invoke-Nsis $uninstaller "/S"
$cleanupClock = [System.Diagnostics.Stopwatch]::StartNew()
while ((Test-Path -LiteralPath $smokeInstall) -and $cleanupClock.Elapsed -lt [TimeSpan]::FromSeconds(15)) {
    Start-Sleep -Milliseconds 200
}
if (Test-Path -LiteralPath $smokeInstall) { throw "Smoke install directory remains after uninstaller cleanup: $smokeInstall" }

Write-Output "Acceptance installer: $installer"
Write-Output "Native Host staged path: $nativeExe"
Write-Output "Manager staged path: $managerExe"
Write-Output "Chinese/space install path tested: $smokeInstall"
