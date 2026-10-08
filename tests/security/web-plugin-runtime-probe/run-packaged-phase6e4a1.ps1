$ErrorActionPreference = 'Stop'

$probeDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = (Resolve-Path (Join-Path $probeDir '..\..\..')).Path
$artifact = Join-Path $probeDir 'release\win-unpacked\WebTools Plugin Security Probe.exe'
$builderConfig = Join-Path $probeDir 'electron-builder.yml'
$rawId = [guid]::NewGuid().ToString('N')
$rawReport = Join-Path $env:TEMP "webtools-phase6e4a1-$rawId-raw.json"
$profile = Join-Path $env:TEMP "webtools-phase6e4a1-profile-$rawId"
$evidence = Join-Path $probeDir 'results\phase6e4a1-security-evidence.json'
$sanitize = Join-Path $probeDir 'sanitize-evidence.cjs'

Push-Location $repoRoot
try {
    & pnpm exec electron-builder --projectDir 'tests/security/web-plugin-runtime-probe' --config 'electron-builder.yml' --win --x64 --dir
    if ($LASTEXITCODE -ne 0) { throw "electron-builder failed with exit code $LASTEXITCODE" }
} finally { Pop-Location }

if (-not (Test-Path -LiteralPath $artifact -PathType Leaf)) { throw 'Packaged probe executable was not produced.' }
$artifact = (Resolve-Path -LiteralPath $artifact).Path
$process = Start-Process -FilePath $artifact -ArgumentList @(
    '--probe-phase=security-closure',
    "--probe-output=$rawReport",
    "--probe-user-data=$profile"
) -PassThru -WindowStyle Hidden

$identity = Get-CimInstance Win32_Process -Filter "ProcessId = $($process.Id)" -ErrorAction SilentlyContinue
$identityMatched = $identity -and [string]::Equals($identity.ExecutablePath, $artifact, [StringComparison]::OrdinalIgnoreCase)
if (-not $identityMatched) { throw 'Could not verify packaged probe executable identity for the started process.' }

if (-not $process.WaitForExit(180000)) {
    $matching = Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and [string]::Equals($_.ExecutablePath, $artifact, [StringComparison]::OrdinalIgnoreCase) }
    throw "Packaged probe exceeded 180-second bound. Exact-path process count=$(@($matching).Count); PIDs=$(@($matching | Select-Object -ExpandProperty ProcessId) -join ','). Isolated processes were left for diagnosis."
}
if ($process.ExitCode -ne 0) { throw "Packaged probe exited with code $($process.ExitCode). Raw report: $rawReport" }
if (-not (Test-Path -LiteralPath $rawReport -PathType Leaf)) { throw 'Packaged probe did not produce its raw report.' }

$deadline = [DateTime]::UtcNow.AddSeconds(10)
do {
    $matching = @(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and [string]::Equals($_.ExecutablePath, $artifact, [StringComparison]::OrdinalIgnoreCase) })
    if ($matching.Count -eq 0) { break }
    Start-Sleep -Milliseconds 100
} while ([DateTime]::UtcNow -lt $deadline)

$remainingCount = @($matching).Count
Push-Location $repoRoot
try {
    & node $sanitize --raw $rawReport --output $evidence --remaining-process-count $remainingCount --main-process-identity-matched ([string]$identityMatched).ToLowerInvariant()
    if ($LASTEXITCODE -ne 0) { throw "Packaged evidence assertions reported BLOCKED. Raw report: $rawReport" }
    & node --test 'tests/security/web-plugin-runtime-probe/evidence.test.cjs'
    if ($LASTEXITCODE -ne 0) { throw 'Machine evidence regression test failed.' }
} finally { Pop-Location }

$tempRoot = [IO.Path]::GetFullPath($env:TEMP).TrimEnd('\') + '\'
$resolvedProfile = [IO.Path]::GetFullPath($profile)
if ($resolvedProfile.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase) -and (Split-Path -Leaf $resolvedProfile) -match '^webtools-phase6e4a1-profile-[0-9a-f]{32}$') {
    Remove-Item -LiteralPath $resolvedProfile -Recurse -Force -ErrorAction SilentlyContinue
}
Remove-Item -LiteralPath $rawReport -Force -ErrorAction SilentlyContinue
Write-Output "PACKAGED_PHASE6E4A1_EVIDENCE=$evidence"
