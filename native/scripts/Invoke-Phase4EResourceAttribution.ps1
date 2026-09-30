[CmdletBinding()]
param(
    [string] $OutputDirectory = (Join-Path $env:TEMP 'WebTools-Phase4E-ResourceAttribution'),
    [string] $ResumeDirectory,
    [switch] $SkipBuild
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$samplerPath = Join-Path $PSScriptRoot 'Measure-Phase4EResources.ps1'
$projectPath = Join-Path $repositoryRoot 'native\WebTools.NativeHost\WebTools.NativeHost.csproj'
$stateSource = Join-Path $env:APPDATA 'Nook\launcher-state.json'
$catalogSource = Join-Path $env:LOCALAPPDATA 'WebTools\app-catalog.v1.json'
$managerProcessName = 'WebTools'
$nativeProcessName = 'WebTools.NativeHost'
$sessionStamp = Get-Date -Format 'yyyyMMdd-HHmmss'
if ([string]::IsNullOrWhiteSpace($ResumeDirectory)) { $sessionRoot = Join-Path $OutputDirectory "run-$sessionStamp" }
else { $sessionRoot = (Resolve-Path -LiteralPath $ResumeDirectory).Path }
$publishDirectory = Join-Path $sessionRoot 'publish'
$profilesRoot = Join-Path $sessionRoot 'profiles'
$publishLog = Join-Path $sessionRoot 'dotnet-publish.log'
$manifestPath = Join-Path $sessionRoot 'run-manifest.json'

if ([string]::IsNullOrWhiteSpace($ResumeDirectory)) { New-Item -ItemType Directory -Path $sessionRoot, $profilesRoot -Force | Out-Null }

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class Phase4EResourceHotkeyProbe
{
    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool RegisterHotKey(IntPtr hWnd, int id, uint modifiers, uint virtualKey);
    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool UnregisterHotKey(IntPtr hWnd, int id);
    public static int FindAvailableFunctionKey()
    {
        for (var key = 0x7B; key >= 0x70; key--)
        {
            if (IsFunctionKeyAvailable(key)) return key;
        }
        return 0;
    }
    public static bool IsFunctionKeyAvailable(int key)
    {
        const uint modifiers = 0x0002 | 0x0001 | 0x0004 | 0x4000; // Ctrl+Alt+Shift+NoRepeat
        var id = (int)((uint)Environment.TickCount % 0xBFFEu) + 1;
        if (!RegisterHotKey(IntPtr.Zero, id, modifiers, (uint)key)) return false;
        UnregisterHotKey(IntPtr.Zero, id);
        return true;
    }
}
'@

function Get-ProcessSnapshot {
    @(Get-Process -Name $nativeProcessName -ErrorAction SilentlyContinue | Sort-Object Id)
}

function Get-ManagerProcessCount {
    @(Get-Process -Name $managerProcessName -ErrorAction SilentlyContinue).Count
}

function Assert-BaselineProcessesUnchanged {
    param([int[]] $ExpectedIds)
    $currentIds = @((Get-ProcessSnapshot).Id)
    foreach ($expectedId in $ExpectedIds) {
        if ($expectedId -notin $currentIds) { throw "Pre-existing NativeHost PID $expectedId exited during resource attribution; no process was terminated by this script." }
    }
}

function Get-ExistingResourceTestProcesses {
    try {
        return @(Get-CimInstance -ClassName Win32_Process -Filter "Name='$nativeProcessName.exe'" -ErrorAction Stop |
            Where-Object { [string]$_.CommandLine -match '--phase4e-resource-test' })
    }
    catch {
        throw "Could not verify whether a previous Phase 4E test instance is running: $($_.Exception.Message)"
    }
}

function Save-RunManifest {
    $manifest | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $manifestPath -Encoding utf8
}

function Confirm-CompletedNoUIAExperiment {
    param([int[]] $PreservedPids, [int] $ExpectedCount)
    $csvFiles = @(Get-ChildItem -LiteralPath $sessionRoot -Filter 'phase4e-resource-stress-A-1-*.csv' -File)
    $managedFiles = @(Get-ChildItem -LiteralPath $sessionRoot -Filter 'phase4e-managed-A-1-*.csv' -File)
    if ($csvFiles.Count -ne 1 -or $managedFiles.Count -ne 1) { throw 'Resume requires exactly one completed Experiment A process CSV and managed-checkpoint CSV.' }
    $rows = @(Import-Csv -LiteralPath $csvFiles[0].FullName)
    $required = @('A-IDLE','A-R1-SETTLE','A-R2-SETTLE','A-R3-SETTLE','A-HOTKEY-SETTLE')
    foreach ($round in 1..3) { $required += @(100..1000 | Where-Object { $_ % 100 -eq 0 } | ForEach-Object { "A-R$round-$_" }) }
    $required += @(50..300 | Where-Object { $_ % 50 -eq 0 } | ForEach-Object { "A-HOTKEY-$_" })
    $actualStages = @($rows | Select-Object -ExpandProperty Stage -Unique)
    $missing = @($required | Where-Object { $_ -notin $actualStages })
    if ($missing.Count -gt 0) { throw "Resume found incomplete Experiment A checkpoints: $($missing -join ', ')." }
    $expectedPid = [string]$manifest.experimentAPid
    $invalid = @($rows | Where-Object {
        $_.PID -ne $expectedPid -or $_.ProcessPresent -ne 'True' -or
        $_.NativeHostCount -ne [string]$ExpectedCount -or $_.ElectronProcessCount -ne '0' -or
        $_.WorkloadDriver -ne 'Dispatcher-pipe-real-WPF-no-UIA'
    })
    if ($invalid.Count -gt 0) { throw "Resume found $($invalid.Count) invalid Experiment A resource samples." }
    $managed = @(Import-Csv -LiteralPath $managedFiles[0].FullName)
    $managedStages = @($managed | Select-Object -ExpandProperty Stage -Unique)
    $managedRequired = @('A-IDLE','A-R1-SETTLE','A-R2-SETTLE','A-R3-SETTLE','A-HOTKEY-SETTLE')
    $missingManaged = @($managedRequired | Where-Object { $_ -notin $managedStages })
    if ($missingManaged.Count -gt 0) { throw "Resume found missing Experiment A managed heap snapshots: $($missingManaged -join ', ')." }
    if (@(Get-Process -Id ([int]$manifest.experimentAPid) -ErrorAction SilentlyContinue).Count -gt 0) { throw 'Experiment A PID is still running; resume will not launch another Host.' }
    if ($PreservedPids.Count -gt 0) {
        $currentIds = @((Get-ProcessSnapshot).Id)
        $missingPids = @($PreservedPids | Where-Object { $_ -notin $currentIds })
        if ($missingPids.Count -gt 0) { throw "A pre-existing NativeHost PID exited since Experiment A: $($missingPids -join ', ')." }
    }
    return [pscustomobject]@{ ResourceCsv = $csvFiles[0].FullName; ManagedCsv = $managedFiles[0].FullName; Stages = $required.Count }
}

function Confirm-CompletedUIAExperiment {
    param([int[]] $PreservedPids, [int] $ExpectedCount)
    $csvFiles = @(Get-ChildItem -LiteralPath $sessionRoot -Filter 'phase4e-resource-stress-B-1-*.csv' -File)
    $managedFiles = @(Get-ChildItem -LiteralPath $sessionRoot -Filter 'phase4e-managed-B-1-*.csv' -File)
    if ($csvFiles.Count -ne 1 -or $managedFiles.Count -ne 1) { throw 'Resume requires exactly one completed Experiment B process CSV and managed-checkpoint CSV.' }
    $rows = @(Import-Csv -LiteralPath $csvFiles[0].FullName)
    $required = @('B-IDLE','B-SETTLE') + @(100..1000 | Where-Object { $_ % 100 -eq 0 } | ForEach-Object { "B-$_" })
    $actualStages = @($rows | Select-Object -ExpandProperty Stage -Unique)
    $missing = @($required | Where-Object { $_ -notin $actualStages })
    if ($missing.Count -gt 0) { throw "Resume found incomplete Experiment B checkpoints: $($missing -join ', ')." }
    $expectedPid = [string]$manifest.experimentBPid
    $invalid = @($rows | Where-Object {
        $_.PID -ne $expectedPid -or $_.ProcessPresent -ne 'True' -or
        $_.NativeHostCount -ne [string]$ExpectedCount -or $_.ElectronProcessCount -ne '0' -or
        $_.WorkloadDriver -ne 'UIAutomation-ValuePattern-real-WPF'
    })
    if ($invalid.Count -gt 0) { throw "Resume found $($invalid.Count) invalid Experiment B resource samples." }
    $managed = @(Import-Csv -LiteralPath $managedFiles[0].FullName)
    $managedStages = @($managed | Select-Object -ExpandProperty Stage -Unique)
    $missingManaged = @($required | Where-Object { $_ -notin $managedStages })
    if ($missingManaged.Count -gt 0) { throw "Resume found missing Experiment B managed heap snapshots: $($missingManaged -join ', ')." }
    if (@(Get-Process -Id ([int]$manifest.experimentBPid) -ErrorAction SilentlyContinue).Count -gt 0) { throw 'Experiment B PID is still running; resume will not start another Host.' }
    if ($PreservedPids.Count -gt 0) {
        $currentIds = @((Get-ProcessSnapshot).Id)
        $missingPids = @($PreservedPids | Where-Object { $_ -notin $currentIds })
        if ($missingPids.Count -gt 0) { throw "A pre-existing NativeHost PID exited since Experiment B: $($missingPids -join ', ')." }
    }
    return [pscustomobject]@{ ResourceCsv = $csvFiles[0].FullName; ManagedCsv = $managedFiles[0].FullName; Stages = $required.Count }
}

function New-IsolatedProfile {
    param([string] $Label, [string] $SourceProfileRoot)
    $profileRoot = Join-Path $profilesRoot $Label
    New-Item -ItemType Directory -Path $profileRoot -Force | Out-Null
    $profileStateSource = if ([string]::IsNullOrWhiteSpace($SourceProfileRoot)) { $stateSource } else { Join-Path $SourceProfileRoot 'launcher-state.json' }
    $profileCatalogSource = if ([string]::IsNullOrWhiteSpace($SourceProfileRoot)) { $catalogSource } else { Join-Path $SourceProfileRoot 'app-catalog.v1.json' }
    Copy-Item -LiteralPath $profileStateSource -Destination (Join-Path $profileRoot 'launcher-state.json')
    $catalogPath = Join-Path $profileRoot 'app-catalog.v1.json'
    Copy-Item -LiteralPath $profileCatalogSource -Destination $catalogPath

    if (-not [string]::IsNullOrWhiteSpace($SourceProfileRoot)) {
        Copy-Item -LiteralPath (Join-Path $SourceProfileRoot 'nook-data.json') -Destination (Join-Path $profileRoot 'nook-data.json')
        return [pscustomobject]@{ Root = $profileRoot; StatePath = (Join-Path $profileRoot 'launcher-state.json'); CatalogPath = $catalogPath }
    }

    $state = Get-Content -Raw -LiteralPath $profileStateSource | ConvertFrom-Json
    $legacyPath = Join-Path $env:APPDATA 'Nook\nook-data.json'
    $projectedEntries = @()
    if (Test-Path -LiteralPath $legacyPath) {
        $websiteIds = @($state.websites | ForEach-Object { [string]$_.id })
        $legacy = Get-Content -Raw -LiteralPath $legacyPath | ConvertFrom-Json
        if ($null -ne $legacy.webEntries) {
            $projectedEntries = @($legacy.webEntries | Where-Object {
                $idProperty = $_.PSObject.Properties['id']
                $faviconProperty = $_.PSObject.Properties['favicon']
                $null -ne $idProperty -and [string]$idProperty.Value -in $websiteIds -and
                    $null -ne $faviconProperty -and -not [string]::IsNullOrWhiteSpace([string]$faviconProperty.Value)
            } | ForEach-Object {
                [ordered]@{ id = [string]$_.PSObject.Properties['id'].Value; favicon = [string]$_.PSObject.Properties['favicon'].Value }
            })
        }
    }
    [ordered]@{ webEntries = $projectedEntries } |
        ConvertTo-Json -Depth 5 -Compress |
        Set-Content -LiteralPath (Join-Path $profileRoot 'nook-data.json') -Encoding utf8

    [pscustomobject]@{ Root = $profileRoot; StatePath = (Join-Path $profileRoot 'launcher-state.json'); CatalogPath = $catalogPath }
}

function New-ControlPipeName {
    'WebTools.NativeHost.Resource.' + [guid]::NewGuid().ToString('N')
}

function Start-IsolatedNativeHost {
    param($Profile, [string] $PipeName, [string] $Hotkey)
    $executable = Join-Path $publishDirectory 'WebTools.NativeHost.exe'
    $startInfo = [System.Diagnostics.ProcessStartInfo]::new()
    $startInfo.FileName = $executable
    $startInfo.WorkingDirectory = $publishDirectory
    $startInfo.UseShellExecute = $false
    foreach ($argument in @('--phase4e-resource-test', $Profile.Root, $Profile.CatalogPath, $PipeName, $Hotkey)) {
        [void]$startInfo.ArgumentList.Add($argument)
    }
    return [System.Diagnostics.Process]::Start($startInfo)
}

function Invoke-AttributionSampler {
    param(
        [ValidateSet('A', 'B')] [string] $Scenario,
        [bool] $NoUIA,
        [int] $TargetProcessId,
        [int] $ExpectedCount,
        [string] $PipeName,
        [string] $StatePath,
        [string] $Hotkey
    )
    $arguments = @(
        '-Mode', 'Stress',
        '-OutputDirectory', $sessionRoot,
        '-TargetProcessId', [string]$TargetProcessId,
        '-ExpectedNativeHostCount', [string]$ExpectedCount,
        '-ResourceControlPipeName', $PipeName,
        '-StatePath', $StatePath,
        '-TestHotkey', $Hotkey,
        '-ScenarioName', $Scenario,
        '-RunNumber', '1',
        '-ExitTestHost'
    )
    if ($NoUIA) { $arguments += @('-NoUIA', '-RepeatedRounds', '3') }
    else { $arguments += '-Automated' }

    & (Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe') -NoProfile -ExecutionPolicy Bypass -File $samplerPath @arguments
    if ($LASTEXITCODE -ne 0) { throw "Phase 4E $Scenario sampler failed with exit code $LASTEXITCODE." }
}

function Send-TestHostExit {
    param([string] $PipeName)
    $client = [System.IO.Pipes.NamedPipeClientStream]::new('.', $PipeName, [System.IO.Pipes.PipeDirection]::InOut)
    try {
        $client.Connect(5000)
        $reader = [System.IO.StreamReader]::new($client, [System.Text.UTF8Encoding]::new($false), $false, 4096, $true)
        $writer = [System.IO.StreamWriter]::new($client, [System.Text.UTF8Encoding]::new($false), 4096, $true)
        $writer.AutoFlush = $true
        $null = $reader.ReadLine() # ready
        $writer.WriteLine('{"type":"exit"}')
        $response = $reader.ReadLine() | ConvertFrom-Json
        if ($response.ok -ne $true -or $response.type -ne 'exit') { throw 'Test-host normal-exit request was not acknowledged.' }
    }
    finally { $client.Dispose() }
}

function Wait-TestHostExit {
    param([int] $ProcessId)
    $deadline = [DateTimeOffset]::Now.AddSeconds(180)
    while ([DateTimeOffset]::Now -lt $deadline) {
        if (@(Get-Process -Id $ProcessId -ErrorAction SilentlyContinue).Count -eq 0) { return }
        Start-Sleep -Milliseconds 250
    }
    throw "Isolated test NativeHost PID $ProcessId did not exit normally within 180 seconds. It was not force-terminated."
}

if (-not (Test-Path -LiteralPath $stateSource)) { throw "Installed launcher state was not found: $stateSource" }
if (-not (Test-Path -LiteralPath $catalogSource)) { throw "Installed application-catalog snapshot was not found: $catalogSource" }
if ((Get-ManagerProcessCount) -ne 0) { throw 'Close the WebTools/Electron Manager normally before resource attribution. This script will not close it.' }
if (@(Get-ExistingResourceTestProcesses).Count -gt 0) { throw 'A previous --phase4e-resource-test NativeHost is already running; close it normally before starting a new attribution run.' }

$baselineProcesses = Get-ProcessSnapshot
$resumeA = -not [string]::IsNullOrWhiteSpace($ResumeDirectory)
if ($resumeA) {
    if (-not (Test-Path -LiteralPath $manifestPath)) { throw "Resume manifest does not exist: $manifestPath" }
    $manifest = Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json
    if ($null -eq $manifest.PSObject.Properties['endedAt']) { $manifest | Add-Member -MemberType NoteProperty -Name endedAt -Value $null }
    if ($manifest.branch -ne (git -C $repositoryRoot branch --show-current) -or $manifest.head -ne (git -C $repositoryRoot rev-parse HEAD)) {
        throw 'Resume requires the same branch and HEAD recorded for Experiment A.'
    }
    $baselineIds = @($manifest.preservedNativeHostPids | ForEach-Object { [int]$_ })
    $expectedNativeHostCount = [int]$manifest.expectedNativeHostCount
    $aEvidence = Confirm-CompletedNoUIAExperiment -PreservedPids $baselineIds -ExpectedCount $expectedNativeHostCount
    $manifest.experimentA = 'verified-workload-and-resource-checkpoints; normal-exit-confirmed; post-run-summary-only-error'
    Save-RunManifest
    Write-Host "Resuming with validated Experiment A artifacts: $($aEvidence.ResourceCsv)"
}
else {
    $baselineIds = @($baselineProcesses.Id)
    $expectedNativeHostCount = $baselineIds.Count + 1
    $manifest = [ordered]@{
        startedAt = [DateTimeOffset]::Now.ToString('o')
        branch = (git -C $repositoryRoot branch --show-current)
        head = (git -C $repositoryRoot rev-parse HEAD)
        sourceExePath = $null
        sourceDllPath = $null
        executableSha256 = $null
        assemblySha256 = $null
        testHotkey = $null
        preservedNativeHostPids = $baselineIds
        expectedNativeHostCount = $expectedNativeHostCount
        electronProcessCountBefore = Get-ManagerProcessCount
        experimentA = 'not-started'
        experimentAPid = $null
        experimentB = 'not-started'
        experimentBPid = $null
        endedAt = $null
        result = 'in-progress'
    }
    Save-RunManifest
}
Write-Host "Pre-existing NativeHost PID(s) preserved: $(if ($baselineIds.Count) { $baselineIds -join ', ' } else { 'none' })"
Write-Host "Each isolated run will expect NativeHost count=$expectedNativeHostCount and Electron count=0."

if (-not $SkipBuild -and -not $resumeA) {
    $publishOutput = & dotnet publish $projectPath --configuration Release --runtime win-x64 --self-contained true -p:PublishSingleFile=false -o $publishDirectory 2>&1
    $publishOutput | Set-Content -LiteralPath $publishLog -Encoding utf8
    if ($LASTEXITCODE -ne 0) { throw "NativeHost publish failed. See $publishLog" }
}
$nativeExecutable = Join-Path $publishDirectory 'WebTools.NativeHost.exe'
$nativeAssembly = Join-Path $publishDirectory 'WebTools.NativeHost.dll'
if (-not (Test-Path -LiteralPath $nativeExecutable) -or -not (Test-Path -LiteralPath $nativeAssembly)) {
    throw "Published NativeHost executable or assembly is missing under $publishDirectory."
}
$executableHash = (Get-FileHash -LiteralPath $nativeExecutable -Algorithm SHA256).Hash
$assemblyHash = (Get-FileHash -LiteralPath $nativeAssembly -Algorithm SHA256).Hash
$functionKey = [Phase4EResourceHotkeyProbe]::FindAvailableFunctionKey()
if ($resumeA) {
    if ($manifest.executableSha256 -ne $executableHash -or $manifest.assemblySha256 -ne $assemblyHash) { throw 'Resume publish binaries do not match the SHA256 values recorded for Experiment A.' }
    if ([string]$manifest.testHotkey -notmatch '^Control\+Alt\+Shift\+F(1[0-2]|[1-9])$') { throw 'Resume manifest does not contain a valid test hotkey.' }
    $functionKey = 0x70 + [int]$Matches[1] - 1
    if (-not [Phase4EResourceHotkeyProbe]::IsFunctionKeyAvailable($functionKey)) { throw "The Experiment A test hotkey $($manifest.testHotkey) is no longer available; A/B must use the same chord." }
    $hotkey = [string]$manifest.testHotkey
}
else {
    $functionKey = [Phase4EResourceHotkeyProbe]::FindAvailableFunctionKey()
    if ($functionKey -eq 0) { throw 'No free Ctrl+Alt+Shift+F1..F12 chord was available. No test process was launched.' }
    $hotkey = "Control+Alt+Shift+F$($functionKey - 0x70 + 1)"
    $manifest.sourceExePath = $nativeExecutable
    $manifest.sourceDllPath = $nativeAssembly
    $manifest.executableSha256 = $executableHash
    $manifest.assemblySha256 = $assemblyHash
    $manifest.testHotkey = $hotkey
    Save-RunManifest
}
Write-Host "Published NativeHost SHA256: $executableHash"
Write-Host "Published assembly SHA256:   $assemblyHash"
Write-Host "Probed available isolated test hotkey: $hotkey"

if (-not $resumeA) {
    $aProfile = New-IsolatedProfile -Label 'A-NoUIA'
    $aPipe = New-ControlPipeName
    $aProcess = $null
    try {
        $aProcess = Start-IsolatedNativeHost -Profile $aProfile -PipeName $aPipe -Hotkey $hotkey
        $manifest.experimentAPid = $aProcess.Id
        $manifest.experimentA = 'running'
        Save-RunManifest
        Write-Host "Started Experiment A fresh NativeHost PID $($aProcess.Id), profile=$($aProfile.Root), same binary hash=$executableHash"
        Invoke-AttributionSampler -Scenario 'A' -NoUIA $true -TargetProcessId $aProcess.Id -ExpectedCount $expectedNativeHostCount -PipeName $aPipe -StatePath $aProfile.StatePath -Hotkey $hotkey
        Wait-TestHostExit -ProcessId $aProcess.Id
        Assert-BaselineProcessesUnchanged -ExpectedIds $baselineIds
        if ((Get-ManagerProcessCount) -ne 0) { throw 'Experiment A unexpectedly started Electron/Manager. The result is invalid.' }
        Write-Host 'Experiment A exited normally; pre-existing NativeHost process identities remain unchanged; Electron=0.'
        $manifest.experimentA = 'passed-process-safety-and-normal-exit'
        Save-RunManifest
    }
    catch {
        if ($null -ne $aProcess -and @(Get-Process -Id $aProcess.Id -ErrorAction SilentlyContinue).Count -gt 0) {
            try { Send-TestHostExit -PipeName $aPipe; Wait-TestHostExit -ProcessId $aProcess.Id }
            catch { Write-Warning "Could not request normal exit for isolated A PID $($aProcess.Id): $($_.Exception.Message)" }
        }
        throw
    }
}
else { $aProfile = [pscustomobject]@{ Root = (Join-Path $profilesRoot 'A-NoUIA'); StatePath = (Join-Path $profilesRoot 'A-NoUIA\launcher-state.json'); CatalogPath = (Join-Path $profilesRoot 'A-NoUIA\app-catalog.v1.json') } }

$bEvidence = $null
if ($resumeA -and $manifest.experimentB -eq 'passed-process-safety-and-normal-exit') {
    $bEvidence = Confirm-CompletedUIAExperiment -PreservedPids $baselineIds -ExpectedCount $expectedNativeHostCount
    Write-Host "Resuming with validated Experiment B artifacts: $($bEvidence.ResourceCsv)"
}
else {
    $bProfile = New-IsolatedProfile -Label 'B-UIA' -SourceProfileRoot $aProfile.Root
    $bPipe = New-ControlPipeName
    $bProcess = $null
    try {
        $bProcess = Start-IsolatedNativeHost -Profile $bProfile -PipeName $bPipe -Hotkey $hotkey
        $manifest.experimentBPid = $bProcess.Id
        $manifest.experimentB = 'running'
        Save-RunManifest
        Write-Host "Started Experiment B fresh NativeHost PID $($bProcess.Id), profile=$($bProfile.Root), same binary hash=$executableHash"
        Invoke-AttributionSampler -Scenario 'B' -NoUIA $false -TargetProcessId $bProcess.Id -ExpectedCount $expectedNativeHostCount -PipeName $bPipe -StatePath $bProfile.StatePath -Hotkey $hotkey
        Wait-TestHostExit -ProcessId $bProcess.Id
        Assert-BaselineProcessesUnchanged -ExpectedIds $baselineIds
        if ((Get-ManagerProcessCount) -ne 0) { throw 'Experiment B unexpectedly started Electron/Manager. The result is invalid.' }
        Write-Host 'Experiment B exited normally; pre-existing NativeHost process identities remain unchanged; Electron=0.'
        $manifest.experimentB = 'passed-process-safety-and-normal-exit'
        Save-RunManifest
    }
    catch {
        if ($null -ne $bProcess -and @(Get-Process -Id $bProcess.Id -ErrorAction SilentlyContinue).Count -gt 0) {
            try { Send-TestHostExit -PipeName $bPipe; Wait-TestHostExit -ProcessId $bProcess.Id }
            catch { Write-Warning "Could not request normal exit for isolated B PID $($bProcess.Id): $($_.Exception.Message)" }
        }
        throw
    }
}

Assert-BaselineProcessesUnchanged -ExpectedIds $baselineIds
if ((Get-ManagerProcessCount) -ne 0) { throw 'Resource attribution finished with Electron/Manager running; the phase gate is invalid.' }
$manifest.endedAt = [DateTimeOffset]::Now.ToString('o')
$manifest.result = 'completed'
Save-RunManifest
Write-Host "Attribution artifacts are outside Git: $sessionRoot"
Write-Host "NativeHost binary SHA256: $executableHash"
Write-Host "Managed DLL SHA256: $assemblyHash"
Write-Host 'Both A/B used separate fresh WPF processes, independent projected profiles from the same snapshots, the same executable and corpus, the same 1-second sampler, and a normal test-pipe exit.'
