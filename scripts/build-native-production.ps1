param(
    [string]$NodeExe,
    [string]$DotnetExe = "dotnet"
)

$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$releaseRoot = Join-Path $repoRoot "release\native-production-$stamp"
$stageRoot = Join-Path $releaseRoot "stage"
$hostStage = Join-Path $stageRoot "host"
$managerBuild = Join-Path $releaseRoot "manager-build"
$managerStage = Join-Path $stageRoot "manager"
$updaterStage = Join-Path $stageRoot "updater"
$updateHelperExe = Join-Path $updaterStage "WebTools.UpdateHelper.exe"
$installer = Join-Path $releaseRoot "WebTools-Setup-0.1.0.exe"
$smokeInstall = Join-Path $releaseRoot "smoke-install\WebTools Phase 4F 中文 空格"
$testUninstallKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\WebToolsNativePhase4FTest"

if (Test-Path -LiteralPath $releaseRoot) { throw "Refusing to reuse existing candidate directory: $releaseRoot" }
if (Test-Path -LiteralPath $testUninstallKey) { throw "A stale Phase 4F smoke-install registry entry exists: $testUninstallKey" }

if (-not $NodeExe) {
    $nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
    if ($nodeCommand) { $NodeExe = $nodeCommand.Source }
    else {
        $fallbackNode = Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
        if (Test-Path -LiteralPath $fallbackNode) { $NodeExe = $fallbackNode }
    }
}
if (-not $NodeExe -or -not (Test-Path -LiteralPath $NodeExe)) { throw "Node.js executable not found. Pass -NodeExe <path>." }

$pnpmCommand = Get-Command pnpm.cmd -ErrorAction SilentlyContinue
if ($pnpmCommand) {
    $env:Path = "$(Split-Path $pnpmCommand.Source);$env:Path"
    $pnpmExe = $pnpmCommand.Source
} else {
    throw "pnpm.cmd was not found. Enable Corepack or install pnpm@9.15.9."
}
# Corepack sets this marker for its own dispatch. Clear it so direct pnpm child processes
# (including electron-builder's dependency collector) can honor packageManager as well.
Remove-Item Env:COREPACK_ROOT -ErrorAction SilentlyContinue
$pnpmVersion = ((& $pnpmExe --version) | Out-String).Trim()
$pnpmExitCode = $LASTEXITCODE
if ($pnpmExitCode -ne 0) { throw "Could not query pnpm version (exit code $pnpmExitCode)." }
if ($pnpmVersion -ne "9.15.9") { throw "Expected pinned pnpm 9.15.9, found $pnpmVersion." }

New-Item -ItemType Directory -Path $hostStage, $managerStage, $updaterStage -Force | Out-Null

function Invoke-Checked {
    param([string]$FilePath, [string[]]$ArgumentList)
    Push-Location $repoRoot
    try {
        & $FilePath @ArgumentList
        if ($LASTEXITCODE -ne 0) { throw "$FilePath failed with exit code $LASTEXITCODE" }
    } finally { Pop-Location }
}

function Invoke-Nsis {
    param([string]$FilePath, [string[]]$ArgumentList)
    $startInfo = [System.Diagnostics.ProcessStartInfo]::new()
    $startInfo.FileName = $FilePath
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.WorkingDirectory = (Get-Location).ProviderPath
    $formattedArguments = foreach ($argument in $ArgumentList) {
        # NSIS requires /D= to be the final raw argument and forbids quoting it,
        # even when the selected installation directory contains spaces.
        if ($argument.StartsWith('/D=', [StringComparison]::OrdinalIgnoreCase)) { $argument; continue }
        if ($argument.Contains(' ') -or $argument.Contains('"')) { '"' + $argument.Replace('"', '\"') + '"' }
        else { $argument }
    }
    $startInfo.Arguments = $formattedArguments -join ' '
    $process = [System.Diagnostics.Process]::Start($startInfo)
    if (-not $process) { throw "Could not start process: $FilePath" }
    if (-not $process.WaitForExit(300000)) {
        $process.Kill()
        throw "Process timed out: $FilePath $($ArgumentList -join ' ')"
    }
    if ($process.ExitCode -ne 0) { throw "Process failed with exit code $($process.ExitCode): $FilePath" }
}

Invoke-Checked $pnpmExe @("run", "typecheck")
Invoke-Checked $pnpmExe @("test")
Invoke-Checked $pnpmExe @("run", "build")
Invoke-Checked $DotnetExe @(
    "run", "--project", "native\WebTools.UpdateHelper.Checks\WebTools.UpdateHelper.Checks.csproj",
    "--configuration", "Release"
)

Invoke-Checked $DotnetExe @(
    "publish", "native\WebTools.NativeHost\WebTools.NativeHost.csproj",
    "--configuration", "Release", "--runtime", "win-x64", "--self-contained", "true",
    "-p:UseAppHost=true", "-p:PublishSingleFile=false", "-p:PublishTrimmed=false",
    "-o", $hostStage
)

Invoke-Checked $DotnetExe @(
    "publish", "native\WebTools.UpdateHelper\WebTools.UpdateHelper.csproj",
    "--configuration", "Release", "--runtime", "win-x64", "--self-contained", "true",
    "-p:UseAppHost=true", "-p:PublishSingleFile=true", "-p:IncludeNativeLibrariesForSelfExtract=true",
    "-o", $updaterStage
)
if (-not (Test-Path -LiteralPath $updateHelperExe)) { throw "Self-contained update helper was not published: $updateHelperExe" }

$electronBuilder = Join-Path $repoRoot "node_modules\electron-builder\cli.js"
Invoke-Checked $NodeExe @(
    $electronBuilder, "--win", "--x64", "--dir",
    "--config.directories.output=$managerBuild"
)

$unpackedManager = Join-Path $managerBuild "win-unpacked"
if (-not (Test-Path -LiteralPath (Join-Path $unpackedManager "WebTools.exe"))) {
    throw "electron-builder output did not contain win-unpacked\WebTools.exe."
}
Copy-Item -Path (Join-Path $unpackedManager "*") -Destination $managerStage -Recurse -Force
Copy-Item -LiteralPath (Join-Path $repoRoot "resources\app.ico") -Destination (Join-Path $stageRoot "app.ico")

$makensisCache = Join-Path $env:LOCALAPPDATA "electron-builder\Cache\nsis-3.0.4.1"
$makensis = Get-ChildItem -LiteralPath $makensisCache -Recurse -Filter "makensis.exe" -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -match "\\Bin\\makensis\.exe$" } |
    Select-Object -First 1 -ExpandProperty FullName
if (-not $makensis) { throw "electron-builder NSIS compiler not found in $makensisCache" }
$installerScript = Join-Path $releaseRoot "native-production.nsi"
$installerScriptText = [System.IO.File]::ReadAllText((Join-Path $PSScriptRoot "native-production.nsi"))
[System.IO.File]::WriteAllText($installerScript, $installerScriptText, [System.Text.UTF8Encoding]::new($true))

Push-Location $releaseRoot
try { Invoke-Nsis $makensis @("native-production.nsi") }
finally { Pop-Location }

foreach ($required in @(
    (Join-Path $hostStage "WebTools.NativeHost.exe"),
    (Join-Path $hostStage "WebTools.NativeHost.dll"),
    $updateHelperExe,
    (Join-Path $managerStage "WebTools.exe"),
    (Join-Path $managerStage "resources\app.asar")
)) {
    if (-not (Test-Path -LiteralPath $required)) { throw "Required staged file missing: $required" }
}
if (-not (Test-Path -LiteralPath $installer)) { throw "Production candidate installer was not created: $installer" }

# Exercise the complete previous-uninstall/new-install chain in a private registry
# namespace. Fresh smoke installation alone cannot detect unwaited uninstallers.
Invoke-Checked $NodeExe @(
    (Join-Path $repoRoot "scripts\verify-cover-install.mjs"), $updateHelperExe
)

New-Item -ItemType Directory -Path (Split-Path -Parent $smokeInstall) -Force | Out-Null
Invoke-Nsis $installer @("/S", "/PHASE4FTEST", "/D=$smokeInstall")

foreach ($required in @(
    (Join-Path $smokeInstall "WebTools.NativeHost.exe"),
    (Join-Path $smokeInstall "Manager\WebTools.exe"),
    (Join-Path $smokeInstall "Manager\resources\app.asar"),
    (Join-Path $smokeInstall "Uninstall.exe")
)) {
    if (-not (Test-Path -LiteralPath $required)) { throw "Installed smoke fixture is missing: $required" }
}

if (-not (Test-Path -LiteralPath $testUninstallKey)) { throw "Isolated smoke-install registry entry was not written." }
$installedLocation = (Get-ItemProperty -LiteralPath $testUninstallKey).InstallLocation
if ([IO.Path]::GetFullPath($installedLocation) -ne [IO.Path]::GetFullPath($smokeInstall)) {
    throw "Smoke-install registry points to an unexpected directory: $installedLocation"
}

Invoke-Checked $DotnetExe @(
    "run", "--project", "native\WebTools.NativeHost.Checks\WebTools.NativeHost.Checks.csproj",
    "--configuration", "Release", "--", "--verify-manager-discovery", $smokeInstall
)

Invoke-Nsis (Join-Path $smokeInstall "Uninstall.exe") @("/S")
$cleanupClock = [System.Diagnostics.Stopwatch]::StartNew()
while (((Test-Path -LiteralPath $smokeInstall) -or (Test-Path -LiteralPath $testUninstallKey)) -and $cleanupClock.Elapsed -lt [TimeSpan]::FromSeconds(15)) {
    Start-Sleep -Milliseconds 200
}
if ((Test-Path -LiteralPath $smokeInstall) -or (Test-Path -LiteralPath $testUninstallKey)) {
    throw "The isolated smoke installation did not clean up through its own uninstaller."
}

Write-Output "Production candidate installer: $installer"
Write-Output "NativeHost staged path: $(Join-Path $hostStage 'WebTools.NativeHost.exe')"
Write-Output "Manager staged path: $(Join-Path $managerStage 'WebTools.exe')"
Write-Output "Unicode/space install and self-uninstall: PASS ($smokeInstall)"
