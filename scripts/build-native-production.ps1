param(
    [string]$NodeExe,
    [string]$DotnetExe = "dotnet",
    [string]$OutputDirectory,
    [switch]$PreviewOnly,
    [ValidatePattern('^[A-Za-z0-9][A-Za-z0-9._-]{0,100}$')]
    [string]$PreviewName,
    [ValidatePattern('^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$')]
    [string]$PreviewUxRevision,
    [ValidateSet("stable", "beta")]
    [string]$Channel = "stable"
)

$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
if ($PreviewOnly -and -not $PreviewName) { throw "PreviewOnly requires an explicit PreviewName." }
if ($PreviewName -and -not $PreviewOnly) { throw "PreviewName is only valid with PreviewOnly." }
if ($PreviewUxRevision -and -not $PreviewOnly) { throw "PreviewUxRevision is only valid with PreviewOnly." }
$effectivePreviewUxRevision = if ($PreviewUxRevision) { $PreviewUxRevision } else { 'phase6f3-super-panel-final' }
$packageManifest = Get-Content -Raw -LiteralPath (Join-Path $repoRoot "package.json") | ConvertFrom-Json
$productVersion = [string]$packageManifest.version
$versionPattern = '^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$'
$versionMatch = [regex]::Match($productVersion, $versionPattern)
if (-not $versionMatch.Success) { throw "package.json version is not valid SemVer: $productVersion" }
$major = [int64]$versionMatch.Groups[1].Value
$minor = [int64]$versionMatch.Groups[2].Value
$patch = [int64]$versionMatch.Groups[3].Value
if (@($major, $minor, $patch) | Where-Object { $_ -gt 65535 }) { throw "Product version components exceed the Windows file-version limit: $productVersion" }
if ($Channel -eq "stable" -and $versionMatch.Groups[4].Success) { throw "Prerelease versions require the beta release channel." }
$windowsFileVersion = "$major.$minor.$patch.0"
$expectedPackageManager = ([regex]::Match([string]$packageManifest.packageManager, '^pnpm@([0-9]+\.[0-9]+\.[0-9]+)$')).Groups[1].Value
if (-not $expectedPackageManager) { throw "package.json must pin an exact pnpm packageManager version." }
if ($OutputDirectory) {
    $releaseWorkRoot = [IO.Path]::GetFullPath((Join-Path $repoRoot "release\.phase6a-work"))
    $releaseWorkPrefix = $releaseWorkRoot.TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
    $releaseRoot = [IO.Path]::GetFullPath($OutputDirectory)
    if (-not $releaseRoot.StartsWith($releaseWorkPrefix, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Release build output must stay within the repository-owned release work directory."
    }
} else {
    $outputPrefix = if ($PreviewOnly -and $PreviewName -eq 'WebTools-Phase6F3-Selection-Diagnostic-Preview') {
        'phase6f3-selection-diagnostic-preview'
    } elseif ($PreviewOnly) { "native-preview" } else { "native-production" }
    $releaseRoot = Join-Path $repoRoot "release\$outputPrefix-$stamp"
}
$stageRoot = Join-Path $releaseRoot "stage"
$applicationStage = Join-Path $stageRoot "application"
$hostStage = $applicationStage
$managerBuild = Join-Path $releaseRoot "manager-build"
$managerStage = Join-Path $applicationStage "Manager"
$updaterStage = Join-Path $stageRoot "updater"
$updateHelperExe = Join-Path $updaterStage "WebTools.UpdateHelper.exe"
$installerName = if ($PreviewOnly) { "$PreviewName-Setup-$productVersion.exe" }
    elseif ($Channel -eq "stable") { "WebTools-Setup-$productVersion.exe" }
    else { "WebTools-Setup-$productVersion-$Channel.exe" }
$installer = Join-Path $releaseRoot $installerName
$smokeInstall = Join-Path $releaseRoot "smoke-install\WebTools Phase 4F 中文 空格"
$testUninstallKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\WebToolsNativePhase4FTest"

if (Test-Path -LiteralPath $releaseRoot) { throw "Refusing to reuse existing candidate directory: $releaseRoot" }
if (-not $PreviewOnly -and (Test-Path -LiteralPath $testUninstallKey)) { throw "A stale Phase 4F smoke-install registry entry exists: $testUninstallKey" }

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
if ($pnpmVersion -ne $expectedPackageManager) { throw "Expected pnpm $expectedPackageManager from package.json, found $pnpmVersion." }

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
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
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
    $standardOutput = $process.StandardOutput.ReadToEndAsync()
    $standardError = $process.StandardError.ReadToEndAsync()
    # The retained Round 2 solid-LZMA compile took over five minutes.
    # Give only the compiler more time; installer execution retains its existing deadline.
    $timeoutMilliseconds = if ([IO.Path]::GetFileName($FilePath).Equals('makensis.exe', [StringComparison]::OrdinalIgnoreCase)) { 900000 } else { 300000 }
    if (-not $process.WaitForExit($timeoutMilliseconds)) {
        $process.Kill()
        throw "Process timed out: $FilePath $($ArgumentList -join ' ')"
    }
    $process.WaitForExit()
    if ($process.ExitCode -ne 0) {
        throw "Process failed with exit code $($process.ExitCode): $FilePath`n$($standardOutput.Result)`n$($standardError.Result)"
    }
}

if (-not $PreviewOnly) {
Invoke-Checked $pnpmExe @("run", "typecheck")
Invoke-Checked $pnpmExe @("test")
}
Invoke-Checked $pnpmExe @("run", "build")
if (-not $PreviewOnly) {
Invoke-Checked $DotnetExe @(
    "run", "--project", "native\WebTools.NativeHost.Checks\WebTools.NativeHost.Checks.csproj",
    "--configuration", "Release"
)
Invoke-Checked $DotnetExe @(
    "run", "--project", "native\WebTools.UpdateHelper.Checks\WebTools.UpdateHelper.Checks.csproj",
    "--configuration", "Release"
)
}

Invoke-Checked $DotnetExe @(
    "publish", "native\WebTools.NativeHost\WebTools.NativeHost.csproj",
    "--configuration", "Release", "--runtime", "win-x64", "--self-contained", "true",
    "-p:UseAppHost=true", "-p:PublishSingleFile=false", "-p:PublishTrimmed=false",
    "-p:Version=$productVersion", "-p:AssemblyVersion=$windowsFileVersion", "-p:FileVersion=$windowsFileVersion",
    "-p:InformationalVersion=$productVersion", "-p:IncludeSourceRevisionInInformationalVersion=false", "-p:Product=WebTools",
    "-o", $hostStage
)

$nativeHostVersion = (Get-Item -LiteralPath (Join-Path $hostStage "WebTools.NativeHost.exe")).VersionInfo
if ($nativeHostVersion.FileVersion -ne $windowsFileVersion -or $nativeHostVersion.ProductVersion -ne $productVersion) {
    throw "NativeHost version metadata does not match product version $productVersion."
}

Invoke-Checked $DotnetExe @(
    "publish", "native\WebTools.UpdateHelper\WebTools.UpdateHelper.csproj",
    "--configuration", "Release", "--runtime", "win-x64", "--self-contained", "true",
    "-p:UseAppHost=true", "-p:PublishSingleFile=true", "-p:IncludeNativeLibrariesForSelfExtract=true",
    "-p:Version=$productVersion", "-p:AssemblyVersion=$windowsFileVersion", "-p:FileVersion=$windowsFileVersion",
    "-p:InformationalVersion=$productVersion", "-p:IncludeSourceRevisionInInformationalVersion=false", "-p:Product=WebTools",
    "-o", $updaterStage
)
if (-not (Test-Path -LiteralPath $updateHelperExe)) { throw "Self-contained update helper was not published: $updateHelperExe" }
$updateHelperVersion = (Get-Item -LiteralPath $updateHelperExe).VersionInfo
if ($updateHelperVersion.FileVersion -ne $windowsFileVersion -or $updateHelperVersion.ProductVersion -ne $productVersion) {
    throw "UpdateHelper version metadata does not match product version $productVersion."
}

$electronBuilder = Join-Path $repoRoot "node_modules\electron-builder\cli.js"
Invoke-Checked $NodeExe @(
    $electronBuilder, "--win", "--x64", "--dir",
    "--config.directories.output=$managerBuild"
)

$unpackedManager = Join-Path $managerBuild "win-unpacked"
$managerExe = Join-Path $unpackedManager "WebTools.exe"
if (-not (Test-Path -LiteralPath $managerExe)) {
    throw "electron-builder output did not contain win-unpacked\WebTools.exe."
}
$managerVersion = (Get-Item -LiteralPath $managerExe).VersionInfo
$managerVersionForms = @("$major.$minor.$patch", $windowsFileVersion)
if ($managerVersion.FileVersion -notin $managerVersionForms -or $managerVersion.ProductVersion -notin $managerVersionForms) {
    throw "Manager version metadata does not match product version $productVersion."
}
Copy-Item -Path (Join-Path $unpackedManager "*") -Destination $managerStage -Recurse -Force
Copy-Item -LiteralPath (Join-Path $repoRoot "resources\app.ico") -Destination (Join-Path $applicationStage "app.ico")

if ($PreviewOnly) {
    $previewHead = ((& git -C $repoRoot rev-parse HEAD) | Out-String).Trim()
    if ($LASTEXITCODE -ne 0 -or $previewHead -notmatch '^[a-fA-F0-9]{40}$') { throw "Could not identify preview source HEAD." }
    $previewStatus = (& git -C $repoRoot status --porcelain) | Out-String
    if ($LASTEXITCODE -ne 0) { throw "Could not identify preview source status." }
    $previewMetadata = [ordered]@{
        productVersion = $productVersion
        previewName = $PreviewName
        gitHead = $previewHead
        dirty = -not [string]::IsNullOrWhiteSpace($previewStatus)
        buildTimestamp = [DateTime]::UtcNow.ToString('o')
        superPanelUxRevision = $effectivePreviewUxRevision
    } | ConvertTo-Json
    [IO.File]::WriteAllText((Join-Path $applicationStage 'preview-build.json'), $previewMetadata + [Environment]::NewLine, [Text.UTF8Encoding]::new($false))
}

$makensisCache = Join-Path $env:LOCALAPPDATA "electron-builder\Cache\nsis-3.0.4.1"
$makensis = Get-ChildItem -LiteralPath $makensisCache -Recurse -Filter "makensis.exe" -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -match "\\Bin\\makensis\.exe$" } |
    Select-Object -First 1 -ExpandProperty FullName
if (-not $makensis) { throw "electron-builder NSIS compiler not found in $makensisCache" }
$installerScript = Join-Path $releaseRoot "native-production.nsi"
$installerScriptText = [System.IO.File]::ReadAllText((Join-Path $PSScriptRoot "native-production.nsi"))
[System.IO.File]::WriteAllText($installerScript, $installerScriptText, [System.Text.UTF8Encoding]::new($true))

Push-Location $releaseRoot
try {
    $nsisArguments = @(
        "-DWEBTOOLS_PRODUCT_VERSION=$productVersion",
        "-DWEBTOOLS_FILE_VERSION=$windowsFileVersion",
        "-DWEBTOOLS_CHANNEL=$Channel"
    )
    if ($PreviewOnly) { $nsisArguments += "-DWEBTOOLS_PREVIEW_NAME=$PreviewName" }
    $nsisArguments += "native-production.nsi"
    Invoke-Nsis $makensis $nsisArguments
}
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
$installerVersion = (Get-Item -LiteralPath $installer).VersionInfo
if ($installerVersion.ProductVersion -ne $productVersion) { throw "Installer version metadata does not match product version $productVersion." }

# Exercise the complete previous-uninstall/new-install chain in a private registry
# namespace. Fresh smoke installation alone cannot detect unwaited uninstallers.
if (-not $PreviewOnly) {
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
$installedVersion = (Get-ItemProperty -LiteralPath $testUninstallKey).DisplayVersion
if ([IO.Path]::GetFullPath($installedLocation) -ne [IO.Path]::GetFullPath($smokeInstall)) {
    throw "Smoke-install registry points to an unexpected directory: $installedLocation"
}
if ($installedVersion -ne $productVersion) { throw "Isolated install registered version $installedVersion instead of $productVersion." }

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
}

if ($PreviewOnly) {
    # Both artifacts consume this exact tree. No second Native publish/copy source is allowed.
    $previewZip = Join-Path $releaseRoot ($PreviewName + '.zip')
    Compress-Archive -Path (Join-Path $applicationStage '*') -DestinationPath $previewZip -CompressionLevel Optimal
    Write-Output "Portable preview ZIP: $previewZip"
    Write-Output "Canonical unpacked entry: $(Join-Path $applicationStage 'WebTools.NativeHost.exe')"
    Write-Output "Build/packaging only: automated checks and installation smoke NOT RUN."
}

$installerLabel = if ($PreviewOnly) { "Local preview installer" } else { "Production candidate installer" }
Write-Output "$($installerLabel): $installer"
Write-Output "Product version: $productVersion ($Channel)"
Write-Output "NativeHost staged path: $(Join-Path $hostStage 'WebTools.NativeHost.exe')"
Write-Output "Manager staged path: $(Join-Path $managerStage 'WebTools.exe')"
if (-not $PreviewOnly) { Write-Output "Unicode/space install and self-uninstall: PASS ($smokeInstall)" }
