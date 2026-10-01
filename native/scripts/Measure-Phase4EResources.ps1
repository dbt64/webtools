[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('Baseline', 'Stress')]
    [string] $Mode,

    [ValidateRange(1, 5)]
    [int] $SampleIntervalSeconds = 1,

    [ValidateRange(30, 900)]
    [int] $ProcessDiscoveryTimeoutSeconds = 300,

    [string] $OutputDirectory = (Join-Path $env:TEMP 'WebTools-Phase4E-Resources'),

    [switch] $Automated,

    [switch] $NoUIA,

    [switch] $Phase4G2,

    [switch] $Phase4G2Remaining,

    [switch] $TargetedAttribution,

    [switch] $WarmRepetition,

    [switch] $CollectorSmokeOnly,

    [switch] $CollectorErrorProbe,

    [ValidateRange(1, 3)]
    [int] $RepeatedRounds = 1,

    [string] $ResourceControlPipeName,

    [int] $TargetProcessId = 0,

    [int] $ExpectedNativeHostCount = 1,

    [string] $StatePath,

    [string] $TestHotkey = 'Control+Alt+Space',

    [string] $ScenarioName = 'Stress',

    [int] $RunNumber = 1,

    [switch] $ExitTestHost
)

$ErrorActionPreference = 'Stop'
if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
    throw 'This resource sampler is for Windows only.'
}
if ($Automated -and $Mode -ne 'Stress') {
    throw '-Automated is only supported with -Mode Stress.'
}
if ($Automated -and $NoUIA) { throw '-Automated and -NoUIA are mutually exclusive.' }
if (($Automated -or $NoUIA) -and $Mode -ne 'Stress') { throw 'Automated resource drivers are only supported with -Mode Stress.' }
if ($Phase4G2 -and ($Mode -ne 'Stress' -or -not $NoUIA -or $Automated)) { throw '-Phase4G2 requires -Mode Stress -NoUIA and cannot be combined with -Automated.' }
if ($Phase4G2 -and $RepeatedRounds -ne 3) { throw '-Phase4G2 requires exactly three search rounds.' }
if ($Phase4G2 -and -not $ExitTestHost) { throw '-Phase4G2 requires -ExitTestHost so the isolated Host exits normally after sampling.' }
if ($Phase4G2Remaining -and ($Mode -ne 'Stress' -or -not $NoUIA -or $Automated -or $Phase4G2 -or $TargetedAttribution)) { throw '-Phase4G2Remaining requires -Mode Stress -NoUIA and cannot be combined with other workload modes.' }
if ($Phase4G2Remaining -and $RepeatedRounds -ne 1) { throw '-Phase4G2Remaining requires -RepeatedRounds 1.' }
if ($Phase4G2Remaining -and -not $ExitTestHost) { throw '-Phase4G2Remaining requires -ExitTestHost so the isolated Host exits normally after sampling.' }
if ($TargetedAttribution -and ($Mode -ne 'Stress' -or -not $NoUIA -or $Automated -or $Phase4G2)) { throw '-TargetedAttribution requires -Mode Stress -NoUIA and cannot be combined with -Automated or -Phase4G2.' }
if ($TargetedAttribution -and $RepeatedRounds -ne 1) { throw '-TargetedAttribution uses focused blocks and requires -RepeatedRounds 1.' }
if ($WarmRepetition -and -not $TargetedAttribution) { throw '-WarmRepetition requires -TargetedAttribution.' }
if ($WarmRepetition -and ($CollectorSmokeOnly -or $CollectorErrorProbe)) { throw '-WarmRepetition cannot be combined with collector smoke or error-probe mode.' }
if (($CollectorSmokeOnly -or $CollectorErrorProbe) -and -not $TargetedAttribution) { throw 'Collector smoke/probe modes require -TargetedAttribution.' }
if ($CollectorSmokeOnly -and $CollectorErrorProbe) { throw '-CollectorSmokeOnly and -CollectorErrorProbe are mutually exclusive.' }
if ($TargetedAttribution -and -not $ExitTestHost -and -not $CollectorErrorProbe) { throw '-TargetedAttribution requires -ExitTestHost except for the non-exiting collector error probe.' }
if ($CollectorErrorProbe -and $ExitTestHost) { throw '-CollectorErrorProbe must not exit the test Host; run a separate normal-exit smoke afterward.' }
if ($NoUIA -and [string]::IsNullOrWhiteSpace($ResourceControlPipeName)) { throw '-NoUIA requires the explicit Phase 4E resource control pipe name.' }
if (($Automated -or $NoUIA) -and [string]::IsNullOrWhiteSpace($ResourceControlPipeName)) { throw 'Automated test drivers require the Phase 4E resource control pipe name.' }
if ($ExitTestHost -and [string]::IsNullOrWhiteSpace($ResourceControlPipeName)) { throw '-ExitTestHost requires the Phase 4E resource control pipe name.' }
if (($Automated -or $NoUIA) -and $TargetProcessId -le 0) { throw 'Automated test drivers require an explicit -TargetProcessId.' }
if ($ExpectedNativeHostCount -lt 1) { throw '-ExpectedNativeHostCount must be at least 1.' }
if ($RepeatedRounds -gt 1 -and -not $NoUIA) { throw 'Repeated search rounds are only supported by the no-UIA dispatcher driver.' }

$nativeProcessName = 'WebTools.NativeHost'
# electron-builder productName is WebTools, so the installed Manager process
# group (main, renderer, GPU, utility) uses the WebTools.exe image name.
$managerProcessName = 'WebTools'
$artifactPrefix = if ($Phase4G2 -or $Phase4G2Remaining) { 'phase4g2' } elseif ($TargetedAttribution) { 'phase4g2-attribution' } else { 'phase4e' }
$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path

Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

public static class Phase4EResourceSamplerInterop
{
    private delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern uint GetGuiResources(IntPtr processHandle, uint flags);

    [DllImport("user32.dll")]
    private static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int maxCount);

    public static long[] FindLauncherWindows(int targetProcessId)
    {
        var handles = new List<long>();
        EnumWindows((hWnd, _) =>
        {
            uint processId;
            GetWindowThreadProcessId(hWnd, out processId);
            if (processId == targetProcessId)
            {
                var title = new StringBuilder(256);
                GetWindowText(hWnd, title, title.Capacity);
                if (String.Equals(title.ToString(), "WebTools Native Launcher", StringComparison.Ordinal))
                    handles.Add(hWnd.ToInt64());
            }
            return true;
        }, IntPtr.Zero);
        return handles.ToArray();
    }

    [DllImport("user32.dll")]
    private static extern short GetAsyncKeyState(int virtualKey);

    [DllImport("user32.dll")]
    private static extern void keybd_event(byte virtualKey, byte scanCode, uint flags, UIntPtr extraInfo);

    public static bool TestHotkeyKeysAreReleased(int functionKey)
    {
        return !IsDown(0x11) && !IsDown(0x12) && !IsDown(0x10) && !IsDown(functionKey);
    }

    public static void SendRegisteredTestHotkey(int functionKey)
    {
        keybd_event(0x11, 0, 0, UIntPtr.Zero);
        keybd_event(0x12, 0, 0, UIntPtr.Zero);
        keybd_event(0x10, 0, 0, UIntPtr.Zero);
        keybd_event((byte)functionKey, 0, 0, UIntPtr.Zero);
        keybd_event((byte)functionKey, 0, 2, UIntPtr.Zero);
        keybd_event(0x10, 0, 2, UIntPtr.Zero);
        keybd_event(0x12, 0, 2, UIntPtr.Zero);
        keybd_event(0x11, 0, 2, UIntPtr.Zero);
    }

    private static bool IsDown(int virtualKey)
    {
        return (GetAsyncKeyState(virtualKey) & 0x8000) != 0;
    }
}
'@ -ErrorAction SilentlyContinue

if ($null -eq ('Phase4EResourceSamplerInterop' -as [type])) {
    throw 'Unable to load the read-only GetGuiResources helper.'
}

if ($Automated) {
    Add-Type -AssemblyName UIAutomationClient
    Add-Type -AssemblyName UIAutomationTypes
    Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

public static class Phase4EAutomationInterop
{
    private delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [DllImport("user32.dll")]
    private static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);

    [DllImport("user32.dll")]
    private static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int maxCount);

    [DllImport("user32.dll")]
    private static extern void keybd_event(byte virtualKey, byte scanCode, uint flags, UIntPtr extraInfo);

    [DllImport("user32.dll")]
    private static extern short GetAsyncKeyState(int virtualKey);

    public static long[] FindLauncherWindows(int targetProcessId)
    {
        var handles = new List<long>();
        EnumWindows((hWnd, _) =>
        {
            uint processId;
            GetWindowThreadProcessId(hWnd, out processId);
            if (processId == targetProcessId)
            {
                var title = new StringBuilder(256);
                GetWindowText(hWnd, title, title.Capacity);
                if (String.Equals(title.ToString(), "WebTools Native Launcher", StringComparison.Ordinal))
                    handles.Add(hWnd.ToInt64());
            }
            return true;
        }, IntPtr.Zero);
        return handles.ToArray();
    }

    public static bool IsVisible(long handle)
    {
        return IsWindowVisible(new IntPtr(handle));
    }

    public static bool TestHotkeyKeysAreReleased(int functionKey)
    {
        return !IsDown(0x11) && !IsDown(0x12) && !IsDown(0x10) && !IsDown(functionKey);
    }

    public static void SendRegisteredTestHotkey(int functionKey)
    {
        keybd_event(0x11, 0, 0, UIntPtr.Zero); // Control down
        keybd_event(0x12, 0, 0, UIntPtr.Zero); // Alt down
        keybd_event(0x10, 0, 0, UIntPtr.Zero); // Shift down
        keybd_event((byte)functionKey, 0, 0, UIntPtr.Zero); // Function key down
        keybd_event((byte)functionKey, 0, 2, UIntPtr.Zero); // Function key up
        keybd_event(0x10, 0, 2, UIntPtr.Zero); // Shift up
        keybd_event(0x12, 0, 2, UIntPtr.Zero); // Alt up
        keybd_event(0x11, 0, 2, UIntPtr.Zero); // Control up
    }

    private static bool IsDown(int virtualKey)
    {
        return (GetAsyncKeyState(virtualKey) & 0x8000) != 0;
    }
}
'@
}

New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
$runStamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$safeScenarioName = $ScenarioName -replace '[^A-Za-z0-9._-]', '_'
$outputPath = Join-Path $OutputDirectory ("{0}-resource-{1}-{2}-{3}-{4}.csv" -f $artifactPrefix, $Mode.ToLowerInvariant(), $safeScenarioName, $RunNumber, $runStamp)
$managedOutputPath = Join-Path $OutputDirectory ("{0}-managed-{1}-{2}-{3}.csv" -f $artifactPrefix, $safeScenarioName, $RunNumber, $runStamp)
$lifecycleOutputPath = Join-Path $OutputDirectory ("phase4g2-lifecycle-{0}-{1}-{2}.csv" -f $safeScenarioName, $RunNumber, $runStamp)
$corpusOutputPath = Join-Path $OutputDirectory ("phase4g2-corpus-{0}-{1}-{2}.json" -f $safeScenarioName, $RunNumber, $runStamp)
$managedRows = [System.Collections.Generic.List[object]]::new()
$phase4G2LifecycleRows = [System.Collections.Generic.List[object]]::new()
$targetedAttributionRows = [System.Collections.Generic.List[object]]::new()
$targetedAttributionStages = [System.Collections.Generic.List[string]]::new()
$resourcePipe = $null

function ConvertFrom-ResourceHotkey {
    param([string] $Shortcut)
    if ($Shortcut -notmatch '^Control\+Alt\+Shift\+F(1[0-2]|[1-9])$') {
        throw "The test hotkey must be Control+Alt+Shift+F1 through F12 (received '$Shortcut')."
    }
    $functionNumber = [int]$Matches[1]
    return [pscustomobject]@{ Name = "Control+Alt+Shift+F$functionNumber"; VirtualKey = (0x70 + $functionNumber - 1) }
}

function Connect-ResourceControlPipe {
    param([string] $PipeName)
    $client = [System.IO.Pipes.NamedPipeClientStream]::new('.', $PipeName, [System.IO.Pipes.PipeDirection]::InOut)
    try {
        $client.Connect(60000)
        $reader = [System.IO.StreamReader]::new($client, [System.Text.UTF8Encoding]::new($false), $false, 4096, $true)
        $writer = [System.IO.StreamWriter]::new($client, [System.Text.UTF8Encoding]::new($false), 4096, $true)
        $writer.AutoFlush = $true
        $readyTask = $reader.ReadLineAsync()
        if (-not $readyTask.Wait(60000)) { throw 'Timed out waiting for the NativeHost resource driver ready handshake.' }
        $ready = $readyTask.Result | ConvertFrom-Json
        if ($ready.ok -ne $true -or $ready.type -ne 'ready') { throw 'The NativeHost resource driver returned an invalid ready handshake.' }
        return [pscustomobject]@{ Client = $client; Reader = $reader; Writer = $writer; ProcessId = [int]$ready.processId }
    }
    catch {
        $client.Dispose()
        throw
    }
}

function Send-ResourceControlCommand {
    param(
        [Parameter(Mandatory = $true)] $Pipe,
        [Parameter(Mandatory = $true)] $Command
    )
    $Pipe.Writer.WriteLine(($Command | ConvertTo-Json -Compress -Depth 5))
    $responseTask = $Pipe.Reader.ReadLineAsync()
    if (-not $responseTask.Wait(60000)) { throw "Timed out waiting for resource control response '$($Command.type)'." }
    $response = $responseTask.Result | ConvertFrom-Json
    if ($response.ok -ne $true) { throw "Resource control '$($Command.type)' failed: $($response.error) $($response.message)" }
    return $response
}

function Add-ManagedSnapshot {
    param([string] $Stage, [switch] $ReturnSnapshot)
    if ($null -eq $resourcePipe) { return }
    $sample = Send-ResourceControlCommand -Pipe $resourcePipe -Command @{ type = 'snapshot' }
    if ([int]$sample.processId -ne $TargetProcessId) { throw "Managed heap snapshot PID $($sample.processId) did not match target PID $TargetProcessId." }
    [void]$managedRows.Add([pscustomobject]@{
        Scenario = $ScenarioName
        Run = $RunNumber
        Stage = $Stage
        Timestamp = [DateTimeOffset]::Now.ToString('o')
        PID = [int]$sample.processId
        Query = [string]$sample.query
        SearchMode = [string]$sample.searchMode
        WindowVisible = [bool]$sample.windowVisible
        WindowHandle = [long]$sample.windowHandle
        IsActive = [bool]$sample.isActive
        QueryHasKeyboardFocus = [bool]$sample.queryHasKeyboardFocus
        EverythingEnabled = [bool]$sample.everythingEnabled
        ResultCount = [int]$sample.resultCount
        RealizedResultCount = [int]$sample.realizedResultCount
        IconCount = [int]$sample.iconCount
        IconCacheCount = [int]$sample.iconCacheCount
        IconCacheBitmapBytes = [long]$sample.iconCacheBitmapBytes
        ManagedHeapUsedBytes = [long]$sample.managedHeapUsedBytes
        ManagedHeapSizeBytes = [long]$sample.managedHeapSizeBytes
        ManagedFragmentedBytes = [long]$sample.managedFragmentedBytes
        Status = [string]$sample.status
    })

    # Phase 4G-2 can stop at any review gate. Persist every managed checkpoint
    # as it is captured so an interrupted run still has the evidence collected
    # up to that point. Keep Phase 4E's existing end-of-run export behavior.
    if ($Phase4G2 -or $Phase4G2Remaining -or $TargetedAttribution) {
        $managedRows | Export-Csv -LiteralPath $managedOutputPath -NoTypeInformation -Encoding UTF8
        $persistedRows = @(Import-Csv -LiteralPath $managedOutputPath)
        if ($persistedRows.Count -ne $managedRows.Count) {
            throw "Managed checkpoint CSV flush verification failed at '$Stage' (expected $($managedRows.Count), found $($persistedRows.Count))."
        }
    }
    if ($ReturnSnapshot) { return $sample }
}

if ($Automated -or $NoUIA) {
    $null = ConvertFrom-ResourceHotkey -Shortcut $TestHotkey
    if ([string]::IsNullOrWhiteSpace($StatePath) -or -not (Test-Path -LiteralPath $StatePath)) {
        throw 'Automated isolated-driver runs require -StatePath pointing to the projected test profile.'
    }
    $resourcePipe = Connect-ResourceControlPipe -PipeName $ResourceControlPipeName
    if ($resourcePipe.ProcessId -ne $TargetProcessId) {
        $resourcePipe.Client.Dispose()
        throw "Resource control connected to PID $($resourcePipe.ProcessId), expected $TargetProcessId."
    }
}

function Get-NativeHostProcesses {
    @(Get-Process -Name $nativeProcessName -ErrorAction SilentlyContinue)
}

function Get-ManagerProcessCount {
    try {
        return [int]@((Get-Process -Name $managerProcessName -ErrorAction SilentlyContinue)).Count
    }
    catch {
        return -1
    }
}

function Get-ProcessMetrics {
    param(
        [Parameter(Mandatory = $true)]
        [int] $TargetProcessId,

        [Parameter(Mandatory = $true)]
        [string] $Scenario,

        [Parameter(Mandatory = $true)]
        [int] $RunNumber,

        [Parameter(Mandatory = $true)]
        [string] $Stage
    )

    $managerCount = Get-ManagerProcessCount
    $nativeCount = @(Get-NativeHostProcesses).Count
    try {
        $process = Get-Process -Id $TargetProcessId -ErrorAction Stop
        try { $gdi = [long][Phase4EResourceSamplerInterop]::GetGuiResources($process.Handle, 0) } catch { $gdi = $null }
        try { $user = [long][Phase4EResourceSamplerInterop]::GetGuiResources($process.Handle, 1) } catch { $user = $null }

        [pscustomobject]@{
            Scenario = $Scenario
            Run = $RunNumber
            Stage = $Stage
            Timestamp = [DateTimeOffset]::Now.ToString('o')
            ProcessName = $process.ProcessName
            PID = $TargetProcessId
            ProcessPresent = $true
            PrivateBytes = [long]$process.PrivateMemorySize64
            WorkingSet = [long]$process.WorkingSet64
            GDI = $gdi
            USER = $user
            Handles = [long]$process.HandleCount
            Threads = [int]$process.Threads.Count
            ElectronProcessCount = $managerCount
            NativeHostCount = $nativeCount
            WorkloadDriver = 'process-sampler'
        }
    }
    catch {
        [pscustomobject]@{
            Scenario = $Scenario
            Run = $RunNumber
            Stage = $Stage
            Timestamp = [DateTimeOffset]::Now.ToString('o')
            ProcessName = $nativeProcessName
            PID = $TargetProcessId
            ProcessPresent = $false
            PrivateBytes = $null
            WorkingSet = $null
            GDI = $null
            USER = $null
            Handles = $null
            Threads = $null
            ElectronProcessCount = $managerCount
            NativeHostCount = $nativeCount
            WorkloadDriver = 'process-sampler'
        }
    }
}

function Wait-ForNoWebToolsProcesses {
    param([int] $RunNumber)

    while ($true) {
        $nativeProcesses = @(Get-NativeHostProcesses)
        $managerCount = Get-ManagerProcessCount
        if ($nativeProcesses.Count -eq 0 -and $managerCount -eq 0) {
            return
        }

        $nativeIds = if ($nativeProcesses.Count -gt 0) { ($nativeProcesses.Id -join ', ') } else { 'none' }
        Write-Host "Run $RunNumber requires a clean start. NativeHost PID(s): $nativeIds; Electron/WebTools process count: $managerCount."
        [void](Read-Host 'Use WebTools tray Exit and close Manager normally, then press Enter to recheck')
    }
}

function Wait-ForNativeHostStart {
    param(
        [int[]] $PreviousProcessIds,
        [string] $Context
    )

    $deadline = [DateTimeOffset]::Now.AddSeconds($ProcessDiscoveryTimeoutSeconds)
    while ([DateTimeOffset]::Now -lt $deadline) {
        $newProcesses = @(Get-NativeHostProcesses | Where-Object { $_.Id -notin $PreviousProcessIds })
        if ($newProcesses.Count -eq 1) {
            return $newProcesses[0]
        }
        if ($newProcesses.Count -gt 1) {
            throw "$Context found more than one new NativeHost process. No process was changed."
        }
        Start-Sleep -Seconds 1
    }

    throw "$Context did not detect a new $nativeProcessName process within $ProcessDiscoveryTimeoutSeconds seconds."
}

function Wait-ForProcessExit {
    param([int] $TargetProcessId)

    $deadline = [DateTimeOffset]::Now.AddSeconds(180)
    while ([DateTimeOffset]::Now -lt $deadline) {
        $stillRunning = @(Get-Process -Id $TargetProcessId -ErrorAction SilentlyContinue)
        if ($stillRunning.Count -eq 0) {
            return $true
        }
        Start-Sleep -Seconds 1
    }
    return $false
}

function Get-MedianOfFive {
    param([object[]] $Values)

    $numbers = @($Values | Where-Object { $null -ne $_ -and "$_" -ne '' } | ForEach-Object { [long]$_ } | Sort-Object)
    if ($numbers.Count -ne 5) {
        return $null
    }
    return [long]$numbers[2]
}

function Invoke-Baseline {
    $rows = [System.Collections.Generic.List[object]]::new()

    for ($runNumber = 1; $runNumber -le 5; $runNumber++) {
        Wait-ForNoWebToolsProcesses -RunNumber $runNumber
        $previousIds = @((Get-NativeHostProcesses).Id)
        Write-Host ""
        Write-Host "Baseline run $runNumber/5: start the installed Phase 4E acceptance build now."
        [void](Read-Host 'After launching WebTools, return here; the sampler will discover its new NativeHost PID')

        $nativeProcess = Wait-ForNativeHostStart -PreviousProcessIds $previousIds -Context "Baseline run $runNumber"
        Write-Host "Detected PID $($nativeProcess.Id). Sampling after 30 seconds of idle."
        Start-Sleep -Seconds 30

        $row = Get-ProcessMetrics -TargetProcessId $nativeProcess.Id -Scenario 'Baseline' -RunNumber $runNumber -Stage 'IDLE-30S'
        [void]$rows.Add($row)
        $rows | Export-Csv -LiteralPath $outputPath -NoTypeInformation -Encoding UTF8
        $row | Format-List Run,Timestamp,PID,ProcessPresent,PrivateBytes,WorkingSet,GDI,USER,Handles,Threads,ElectronProcessCount

        [void](Read-Host 'Use the WebTools tray Exit to close NativeHost normally, then press Enter')
        if (-not (Wait-ForProcessExit -TargetProcessId $nativeProcess.Id)) {
            throw "Run $runNumber NativeHost PID $($nativeProcess.Id) did not exit normally within 180 seconds. No process was terminated."
        }
        if ((Get-ManagerProcessCount) -ne 0) {
            throw "Run $runNumber ended with an Electron/WebTools Manager process still present. Close it normally before continuing."
        }
    }

    $rows | Export-Csv -LiteralPath $outputPath -NoTypeInformation -Encoding UTF8
    Write-Host ""
    Write-Host "Five-run baseline CSV: $outputPath"
    Write-Host 'Median uses the third sorted value from five present-process samples:'
    foreach ($metric in @('PrivateBytes', 'WorkingSet', 'GDI', 'USER', 'Handles', 'Threads')) {
        $median = Get-MedianOfFive -Values @($rows | ForEach-Object { $_.$metric })
        $display = if ($null -eq $median) { 'not available (one or more samples missing)' } else { $median }
        Write-Host ("  {0}: {1}" -f $metric, $display)
    }

    $electronRuns = @($rows | Where-Object { $_.ElectronProcessCount -ne 0 }).Count
    $missingRuns = @($rows | Where-Object { -not $_.ProcessPresent }).Count
    Write-Host ("Runs with nonzero Electron/WebTools process count: {0}/5" -f $electronRuns)
    Write-Host ("Runs where NativeHost was absent at the 30-second sample: {0}/5" -f $missingRuns)
    Write-Host 'This records the baseline only; it does not decide the full Phase 4E resource gate.'
}

function Set-StressStage {
    param([string] $StagePath, [string] $Stage)
    [System.IO.File]::WriteAllText($StagePath, $Stage, [System.Text.Encoding]::ASCII)
}

function Wait-StressSeconds {
    param(
        [int] $Seconds,
        [string] $StagePath,
        [string] $Stage
    )
    Set-StressStage -StagePath $StagePath -Stage $Stage
    for ($remaining = $Seconds; $remaining -gt 0; $remaining--) {
        if ($remaining -eq $Seconds -or $remaining -le 10 -or ($remaining % 10) -eq 0) {
            Write-Host ("{0}: {1}s remaining" -f $Stage, $remaining)
        }
        Start-Sleep -Seconds 1
    }
}

function Invoke-UserWorkloadBatch {
    param(
        [string] $StagePath,
        [string] $Stage,
        [string] $Instruction,
        [string] $CheckpointStage
    )

    Set-StressStage -StagePath $StagePath -Stage $Stage
    Write-Host ""
    Write-Host ("[{0}] {1}" -f $Stage, $Instruction)
    [void](Read-Host 'Complete this real WPF workload batch, then return here and press Enter')
    if ([string]::IsNullOrWhiteSpace($CheckpointStage)) {
        $CheckpointStage = "{0}-CHECKPOINT" -f $Stage
    }
    Set-StressStage -StagePath $StagePath -Stage $CheckpointStage
    Start-Sleep -Seconds ([Math]::Max(2, $SampleIntervalSeconds + 1))
}

function Assert-AutomatedRuntimeHealthy {
    param(
        [int] $TargetProcessId,
        [string] $ErrorPath,
        [System.Management.Automation.Job] $SamplerJob
    )

    if (Test-Path -LiteralPath $ErrorPath) {
        throw (Get-Content -Raw -LiteralPath $ErrorPath)
    }
    if ($null -ne $SamplerJob -and $SamplerJob.State -ne 'Running') {
        throw "The resource sampler stopped unexpectedly (state=$($SamplerJob.State))."
    }

    $nativeProcesses = @(Get-NativeHostProcesses)
    if ($nativeProcesses.Count -ne $ExpectedNativeHostCount -or $TargetProcessId -notin @($nativeProcesses.Id)) {
        $ids = if ($nativeProcesses.Count -gt 0) { $nativeProcesses.Id -join ', ' } else { 'none' }
        throw "Aborting automated stress: expected $ExpectedNativeHostCount NativeHost process(es) including PID $TargetProcessId; current PID(s): $ids."
    }

    $managerCount = Get-ManagerProcessCount
    if ($managerCount -ne 0) {
        throw "Aborting automated stress: unexpected Electron/Manager process count $managerCount. No process was closed."
    }
}

function Get-AutomationElementById {
    param(
        [long] $WindowHandle,
        [string] $AutomationId
    )

    $window = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$WindowHandle)
    if ($null -eq $window) { return $null }
    $condition = [System.Windows.Automation.PropertyCondition]::new(
        [System.Windows.Automation.AutomationElement]::AutomationIdProperty,
        $AutomationId)
    return $window.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $condition)
}

function Get-AutomatedQueryPresentation {
    param([long] $WindowHandle)

    $window = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$WindowHandle)
    if ($null -eq $window) { throw 'UI Automation could not attach to the visible Launcher window.' }

    $queryElement = Get-AutomationElementById -WindowHandle $WindowHandle -AutomationId 'QueryBox'
    if ($null -eq $queryElement) { throw 'The real WPF QueryBox is missing from the Launcher automation tree.' }
    $queryPattern = $queryElement.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)

    $resultsElement = Get-AutomationElementById -WindowHandle $WindowHandle -AutomationId 'ResultsList'
    $itemCount = 0
    if ($null -ne $resultsElement) {
        $itemCondition = [System.Windows.Automation.PropertyCondition]::new(
            [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
            [System.Windows.Automation.ControlType]::ListItem)
        $items = $resultsElement.FindAll([System.Windows.Automation.TreeScope]::Descendants, $itemCondition)
        $itemCount = $items.Count
    }

    $statusElement = Get-AutomationElementById -WindowHandle $WindowHandle -AutomationId 'StatusText'
    $status = if ($null -ne $statusElement) { $statusElement.Current.Name } else { '' }

    [pscustomobject]@{
        Query = $queryPattern.Current.Value
        QueryHasKeyboardFocus = $queryElement.Current.HasKeyboardFocus
        ResultItemCount = $itemCount
        Status = $status
        HasPresentation = ($itemCount -gt 0 -or -not [string]::IsNullOrWhiteSpace($status))
    }
}

function Wait-AutomatedWindowVisibility {
    param(
        [long] $WindowHandle,
        [bool] $ExpectedVisible,
        [int] $TargetProcessId,
        [string] $ErrorPath,
        [System.Management.Automation.Job] $SamplerJob,
        [int] $TimeoutSeconds = 8
    )

    $deadline = [DateTimeOffset]::Now.AddSeconds($TimeoutSeconds)
    while ([DateTimeOffset]::Now -lt $deadline) {
        Assert-AutomatedRuntimeHealthy -TargetProcessId $TargetProcessId -ErrorPath $ErrorPath -SamplerJob $SamplerJob
        $visible = [Phase4EAutomationInterop]::IsVisible($WindowHandle)
        if ($visible -eq $ExpectedVisible) { return }
        Start-Sleep -Milliseconds 100
    }

    $state = if ([Phase4EAutomationInterop]::IsVisible($WindowHandle)) { 'visible' } else { 'hidden' }
    throw "Launcher did not become $ExpectedVisible within $TimeoutSeconds seconds (actual: $state)."
}

function Invoke-RegisteredLauncherHotkey {
    param(
        [long] $WindowHandle,
        [bool] $ExpectedVisible,
        [int] $TargetProcessId,
        [string] $ErrorPath,
        [System.Management.Automation.Job] $SamplerJob
    )

    Assert-AutomatedRuntimeHealthy -TargetProcessId $TargetProcessId -ErrorPath $ErrorPath -SamplerJob $SamplerJob
    $functionKey = (ConvertFrom-ResourceHotkey -Shortcut $TestHotkey).VirtualKey
    if (-not [Phase4EAutomationInterop]::TestHotkeyKeysAreReleased($functionKey)) {
        throw 'Aborting: Control, Alt, Shift, or the test function key is already held; the automation will not interfere with current keyboard input.'
    }

    [Phase4EAutomationInterop]::SendRegisteredTestHotkey($functionKey)
    Wait-AutomatedWindowVisibility -WindowHandle $WindowHandle -ExpectedVisible $ExpectedVisible -TargetProcessId $TargetProcessId -ErrorPath $ErrorPath -SamplerJob $SamplerJob
}

function Wait-ResourceDriverVisibility {
    param(
        [Parameter(Mandatory = $true)] [bool] $ExpectedVisible,
        [Parameter(Mandatory = $true)] [int] $TargetProcessId,
        [Parameter(Mandatory = $true)] [string] $ErrorPath,
        [Parameter(Mandatory = $true)] [System.Management.Automation.Job] $SamplerJob,
        [int] $TimeoutSeconds = 8
    )
    $deadline = [DateTimeOffset]::Now.AddSeconds($TimeoutSeconds)
    while ([DateTimeOffset]::Now -lt $deadline) {
        Assert-AutomatedRuntimeHealthy -TargetProcessId $TargetProcessId -ErrorPath $ErrorPath -SamplerJob $SamplerJob
        $state = Send-ResourceControlCommand -Pipe $resourcePipe -Command @{ type = 'state' }
        if ([bool]$state.windowVisible -eq $ExpectedVisible) { return }
        Start-Sleep -Milliseconds 100
    }
    throw "Real WPF Launcher did not become visible=$ExpectedVisible within $TimeoutSeconds seconds."
}

function Invoke-ResourceDriverHotkey {
    param(
        [bool] $ExpectedVisible,
        [int] $TargetProcessId,
        [string] $ErrorPath,
        [System.Management.Automation.Job] $SamplerJob
    )
    Assert-AutomatedRuntimeHealthy -TargetProcessId $TargetProcessId -ErrorPath $ErrorPath -SamplerJob $SamplerJob
    $functionKey = (ConvertFrom-ResourceHotkey -Shortcut $TestHotkey).VirtualKey
    if (-not [Phase4EResourceSamplerInterop]::TestHotkeyKeysAreReleased($functionKey)) {
        throw 'Aborting: Control, Alt, Shift, or the test function key is already held; the test will not interfere with current keyboard input.'
    }
    [Phase4EResourceSamplerInterop]::SendRegisteredTestHotkey($functionKey)
    Wait-ResourceDriverVisibility -ExpectedVisible $ExpectedVisible -TargetProcessId $TargetProcessId -ErrorPath $ErrorPath -SamplerJob $SamplerJob
}

function Wait-AutomatedQueryUpdate {
    param(
        [long] $WindowHandle,
        [string] $ExpectedQuery,
        [bool] $WaitForEverything,
        [int] $TargetProcessId,
        [string] $ErrorPath,
        [System.Management.Automation.Job] $SamplerJob,
        [int] $TimeoutSeconds = 30
    )

    $deadline = [DateTimeOffset]::Now.AddSeconds($TimeoutSeconds)
    $lastPresentation = $null
    while ([DateTimeOffset]::Now -lt $deadline) {
        Assert-AutomatedRuntimeHealthy -TargetProcessId $TargetProcessId -ErrorPath $ErrorPath -SamplerJob $SamplerJob
        if (-not [Phase4EAutomationInterop]::IsVisible($WindowHandle)) {
            throw 'Launcher hid while a query was being driven; the workload stopped without reopening it.'
        }

        $lastPresentation = Get-AutomatedQueryPresentation -WindowHandle $WindowHandle
        if ($lastPresentation.Query -eq $ExpectedQuery -and $lastPresentation.HasPresentation) {
            $everythingStillRunning = $WaitForEverything -and [regex]::IsMatch([string]$lastPresentation.Status, 'Everything\u2026$')
            if (-not $everythingStillRunning) { return $lastPresentation }
        }
        Start-Sleep -Milliseconds 100
    }

    $itemCount = if ($null -ne $lastPresentation) { $lastPresentation.ResultItemCount } else { 0 }
    $status = if ($null -ne $lastPresentation) { $lastPresentation.Status } else { '' }
    throw "WPF did not finish presenting the current query within $TimeoutSeconds seconds (results=$itemCount; status='$status')."
}

function Wait-AutomatedSeconds {
    param(
        [int] $Seconds,
        [string] $StagePath,
        [string] $Stage,
        [int] $TargetProcessId,
        [string] $ErrorPath,
        [System.Management.Automation.Job] $SamplerJob
    )

    Set-StressStage -StagePath $StagePath -Stage $Stage
    $deadline = [DateTimeOffset]::Now.AddSeconds($Seconds)
    while ([DateTimeOffset]::Now -lt $deadline) {
        Assert-AutomatedRuntimeHealthy -TargetProcessId $TargetProcessId -ErrorPath $ErrorPath -SamplerJob $SamplerJob
        Start-Sleep -Milliseconds 250
    }
}

function Get-Phase4G2QueryCorpus {
    $fileExplorer = [string]([char]0x6587) + [string]([char]0x4EF6) + [string]([char]0x8D44) + [string]([char]0x6E90) + [string]([char]0x7BA1) + [string]([char]0x7406) + [string]([char]0x5668)
    $controlPanel = [string]([char]0x63A7) + [string]([char]0x5236) + [string]([char]0x9762) + [string]([char]0x677F)
    $deviceManager = [string]([char]0x8BBE) + [string]([char]0x5907) + [string]([char]0x7BA1) + [string]([char]0x7406) + [string]([char]0x5668)
    return @(
        [pscustomobject]@{ Query = 'control'; ExpectedMode = 'Local'; Expectation = 'kind'; RequiredKind = 'Application'; Category = 'application-prefix' },
        [pscustomobject]@{ Query = 'Control Panel'; ExpectedMode = 'Local'; Expectation = 'kind'; RequiredKind = 'Application'; Category = 'application-alias' },
        [pscustomobject]@{ Query = $controlPanel; ExpectedMode = 'Local'; Expectation = 'kind'; RequiredKind = 'Application'; Category = 'application-chinese' },
        [pscustomobject]@{ Query = 'kongzhimianban'; ExpectedMode = 'Local'; Expectation = 'kind'; RequiredKind = 'Application'; Category = 'application-pinyin' },
        [pscustomobject]@{ Query = 'kzmb'; ExpectedMode = 'Local'; Expectation = 'kind'; RequiredKind = 'Application'; Category = 'application-initials' },
        [pscustomobject]@{ Query = 'File Explorer'; ExpectedMode = 'Local'; Expectation = 'kind'; RequiredKind = 'Application'; Category = 'application-alias' },
        [pscustomobject]@{ Query = 'explorer.exe'; ExpectedMode = 'Local'; Expectation = 'kind'; RequiredKind = 'Application'; Category = 'application-executable-alias' },
        [pscustomobject]@{ Query = $fileExplorer; ExpectedMode = 'Local'; Expectation = 'kind'; RequiredKind = 'Application'; Category = 'application-chinese' },
        [pscustomobject]@{ Query = 'wenjian'; ExpectedMode = 'Local'; Expectation = 'kind'; RequiredKind = 'Application'; Category = 'application-pinyin' },
        [pscustomobject]@{ Query = 'wjzy'; ExpectedMode = 'Local'; Expectation = 'kind'; RequiredKind = 'Application'; Category = 'application-initials' },
        [pscustomobject]@{ Query = 'Device Manager'; ExpectedMode = 'Local'; Expectation = 'kind'; RequiredKind = 'Application'; Category = 'application-alias' },
        [pscustomobject]@{ Query = 'devmgmt.msc'; ExpectedMode = 'Local'; Expectation = 'kind'; RequiredKind = 'Application'; Category = 'application-executable-alias' },
        [pscustomobject]@{ Query = $deviceManager; ExpectedMode = 'Local'; Expectation = 'kind'; RequiredKind = 'Application'; Category = 'application-chinese' },
        [pscustomobject]@{ Query = 'Phase4G2 Acceptance Site'; ExpectedMode = 'Local'; Expectation = 'kind'; RequiredKind = 'Website'; Category = 'website-name' },
        [pscustomobject]@{ Query = 'phase4g2-resource-check.invalid'; ExpectedMode = 'Local'; Expectation = 'kind'; RequiredKind = 'Website'; Category = 'website-url-fragment' },
        [pscustomobject]@{ Query = '/phase4g2-resource-check.invalid'; ExpectedMode = 'SavedWebsites'; Expectation = 'kind'; RequiredKind = 'Website'; Category = 'website-command' },
        [pscustomobject]@{ Query = '__phase4g2_no_result_marker_9b57__'; ExpectedMode = 'Local'; Expectation = 'no-result'; RequiredKind = ''; Category = 'no-result' },
        [pscustomobject]@{ Query = ''; ExpectedMode = 'Local'; Expectation = 'empty'; RequiredKind = ''; Category = 'empty-query' },
        [pscustomobject]@{ Query = '?phase4g2 test'; ExpectedMode = 'Web'; Expectation = 'status'; RequiredKind = ''; Category = 'web-command' },
        [pscustomobject]@{ Query = 'file:phase4g2-no-existing-file-9b57'; ExpectedMode = 'Files'; Expectation = 'file-search'; RequiredKind = ''; Category = 'file-command' }
    )
}

function Assert-Phase4G2Presentation {
    param(
        [Parameter(Mandatory = $true)] $Presentation,
        [Parameter(Mandatory = $true)] $Expected,
        [Parameter(Mandatory = $true)] [int] $TargetProcessId,
        [Parameter(Mandatory = $true)] [long] $WindowHandle,
        [bool] $RequireVisible = $true
    )

    if ([int]$Presentation.processId -ne $TargetProcessId -or [long]$Presentation.windowHandle -ne $WindowHandle) {
        throw "Phase 4G-2 presentation identity changed for '$($Expected.Category)' (PID/HWND mismatch)."
    }
    if ([bool]$Presentation.windowVisible -ne $RequireVisible) {
        throw "Phase 4G-2 presentation visibility was incorrect for '$($Expected.Category)'."
    }
    if ([string]$Presentation.query -cne [string]$Expected.Query -or [string]$Presentation.searchMode -cne [string]$Expected.ExpectedMode) {
        throw "Phase 4G-2 did not present the exact query/mode for '$($Expected.Category)'."
    }

    $kinds = @($Presentation.resultKinds | ForEach-Object { [string]$_ })
    $resultCount = [int]$Presentation.resultCount
    $status = [string]$Presentation.status
    switch ([string]$Expected.Expectation) {
        'kind' {
            if ([string]$Expected.RequiredKind -notin $kinds) { throw "Phase 4G-2 expected a '$($Expected.RequiredKind)' result for '$($Expected.Category)' but saw [$($kinds -join ',')]." }
        }
        'no-result' {
            if ($resultCount -ne 0 -or [string]::IsNullOrWhiteSpace($status)) { throw 'Phase 4G-2 no-result query did not produce the expected empty result status.' }
        }
        'empty' {
            if ($resultCount -ne 0 -or $kinds.Count -ne 0) { throw 'Phase 4G-2 empty query unexpectedly produced result rows.' }
        }
        'status' {
            if ([string]::IsNullOrWhiteSpace($status)) { throw 'Phase 4G-2 web command did not produce its search instruction status.' }
        }
        'file-search' {
            if ($resultCount -eq 0 -and [string]::IsNullOrWhiteSpace($status)) { throw 'Phase 4G-2 file command produced neither rows nor an explicit Everything status.' }
            if ($kinds.Count -gt 0 -and @($kinds | Where-Object { $_ -in @('File', 'Folder') }).Count -eq 0) { throw 'Phase 4G-2 file command returned a non-file result kind.' }
        }
        default { throw "Unknown Phase 4G-2 expectation '$($Expected.Expectation)'." }
    }
}

function Add-Phase4G2LifecycleRow {
    param([string] $Stage, [string] $Operation, $Presentation, [string] $Hotkey = '')
    [void]$phase4G2LifecycleRows.Add([pscustomobject]@{
        Stage = $Stage
        Operation = $Operation
        Timestamp = [DateTimeOffset]::Now.ToString('o')
        PID = [int]$(if ($null -ne $Presentation.processId) { $Presentation.processId } else { 0 })
        WindowHandle = [long]$(if ($null -ne $Presentation.windowHandle) { $Presentation.windowHandle } else { 0 })
        WindowVisible = [bool]$Presentation.windowVisible
        IsActive = [bool]$Presentation.isActive
        QueryHasKeyboardFocus = [bool]$Presentation.queryHasKeyboardFocus
        QueryLength = [int]([string]$Presentation.query).Length
        ResultCount = [int]$Presentation.resultCount
        ResultKinds = @($Presentation.resultKinds | ForEach-Object { [string]$_ }) -join ';'
        Hotkey = $Hotkey
    })
}

function Save-Phase4G2LifecycleRows {
    if ($phase4G2LifecycleRows.Count -gt 0) {
        $phase4G2LifecycleRows | Export-Csv -LiteralPath $lifecycleOutputPath -NoTypeInformation -Encoding UTF8
    }
}

function Assert-Phase4G2SingleWindow {
    param([int] $TargetProcessId, [long] $ExpectedHandle)
    $handles = @([Phase4EResourceSamplerInterop]::FindLauncherWindows($TargetProcessId))
    if ($handles.Count -ne 1 -or [long]$handles[0] -ne $ExpectedHandle) {
        throw "Phase 4G-2 expected one reused Launcher HWND $ExpectedHandle for PID $TargetProcessId; observed $($handles.Count) handle(s)."
    }
}

function Confirm-Phase4G2TrendReview {
    param([string] $StagePath, [string] $Checkpoint)
    Set-StressStage -StagePath $StagePath -Stage "G2-$Checkpoint-REVIEW"
    $answer = Read-Host "Review the settled 60-second resource samples for $Checkpoint. Enter CONTINUE to proceed; any other input stops additional scenarios and preserves the isolated host/evidence"
    if ($answer -cne 'CONTINUE') { throw "Phase 4G-2 stopped after $Checkpoint at the requested review gate; current CSV and isolated test process are preserved." }
}

function Invoke-Phase4G2Workload {
    param([string] $StagePath, [int] $TargetProcessId, [string] $ErrorPath, [System.Management.Automation.Job] $SamplerJob, [switch] $Remaining)

    $initial = Send-ResourceControlCommand -Pipe $resourcePipe -Command @{ type = 'snapshot' }
    if ([int]$initial.processId -ne $TargetProcessId -or [long]$initial.windowHandle -le 0 -or [bool]$initial.windowVisible -or [string]$initial.query -ne '') {
        throw 'Phase 4G-2 requires its isolated NativeHost to start with one created, hidden Launcher and an empty query.'
    }
    $windowHandle = [long]$initial.windowHandle
    Assert-Phase4G2SingleWindow -TargetProcessId $TargetProcessId -ExpectedHandle $windowHandle
    $corpus = @()
    $corpusHash = $null
    if (-not $Remaining) {
        $corpus = @(Get-Phase4G2QueryCorpus)
        $corpusJson = $corpus | ConvertTo-Json -Depth 4
        Set-Content -LiteralPath $corpusOutputPath -Value $corpusJson -Encoding utf8
        $corpusHash = (Get-FileHash -LiteralPath $corpusOutputPath -Algorithm SHA256).Hash
    }
    $everythingEnabled = [bool]$initial.everythingEnabled

    Write-Host "Phase 4G-2 no-UIA real-WPF workload; PID=$TargetProcessId; HWND=$windowHandle; isolated startup hotkey=$TestHotkey."
    if ($Remaining) {
        Write-Host 'Scenario A is intentionally not rerun; this isolated process will execute only the remaining Scenario B and C workloads.'
    }
    else {
        Write-Host "Frozen corpus entries=$($corpus.Count); Everything enabled in isolated projection=$everythingEnabled; corpus SHA-256=$corpusHash."
        Write-Host 'Queries are injected only through the isolated current-user pipe into the real WPF QueryBox. No result action, URL open, translation, or web request is activated.'
    }

    $initialSettleStage = if ($Remaining) { 'G2-BC-IDLE-30' } else { 'G2-IDLE-30' }
    Wait-AutomatedSeconds -Seconds 30 -StagePath $StagePath -Stage $initialSettleStage -TargetProcessId $TargetProcessId -ErrorPath $ErrorPath -SamplerJob $SamplerJob
    Add-ManagedSnapshot -Stage $initialSettleStage

    if (-not $Remaining) {
        $lastWindows = @([Phase4EResourceSamplerInterop]::FindLauncherWindows($TargetProcessId))
        if ($lastWindows.Count -ne 1 -or [long]$lastWindows[0] -ne $windowHandle) { throw 'The isolated Launcher HWND changed before Scenario A.' }

        for ($round = 1; $round -le 3; $round++) {
            Assert-AutomatedRuntimeHealthy -TargetProcessId $TargetProcessId -ErrorPath $ErrorPath -SamplerJob $SamplerJob
            $show = Send-ResourceControlCommand -Pipe $resourcePipe -Command @{ type = 'show' }
            if ([int]$show.processId -ne $TargetProcessId -or [long]$show.windowHandle -ne $windowHandle -or -not [bool]$show.windowVisible) {
                throw "Scenario A could not show the existing Launcher HWND before round $round."
            }

            $roundLabel = "G2-A-R$round"
            for ($queryIndex = 0; $queryIndex -lt 1000; $queryIndex++) {
                Assert-AutomatedRuntimeHealthy -TargetProcessId $TargetProcessId -ErrorPath $ErrorPath -SamplerJob $SamplerJob
                $expected = $corpus[$queryIndex % $corpus.Count]
                $presentation = Send-ResourceControlCommand -Pipe $resourcePipe -Command @{ type = 'query'; query = $expected.Query }
                Assert-Phase4G2Presentation -Presentation $presentation -Expected $expected -TargetProcessId $TargetProcessId -WindowHandle $windowHandle

                if ((($queryIndex + 1) % 100) -eq 0) {
                    $count = $queryIndex + 1
                    $stage = "$roundLabel-$count"
                    Set-StressStage -StagePath $StagePath -Stage $stage
                    Write-Host "$roundLabel completed $count/1000 validated WPF queries; category=$($expected.Category)."
                    Wait-AutomatedSeconds -Seconds 2 -StagePath $StagePath -Stage $stage -TargetProcessId $TargetProcessId -ErrorPath $ErrorPath -SamplerJob $SamplerJob
                }
            }

            $hide = Send-ResourceControlCommand -Pipe $resourcePipe -Command @{ type = 'hide' }
            Assert-Phase4G2HiddenAndClear -Presentation $hide -TargetProcessId $TargetProcessId -WindowHandle $windowHandle -Stage "$roundLabel-HIDE"
            $settleStage = "$roundLabel-SETTLE-60"
            Wait-AutomatedSeconds -Seconds 60 -StagePath $StagePath -Stage $settleStage -TargetProcessId $TargetProcessId -ErrorPath $ErrorPath -SamplerJob $SamplerJob
            Add-ManagedSnapshot -Stage $settleStage
            Write-Host "$roundLabel settled for 60 seconds. Resource samples are available for attribution review."
            Confirm-Phase4G2TrendReview -StagePath $StagePath -Checkpoint "A-R$round"
        }

        Write-Host 'Scenario A complete: 3 x 1000 queries in the same PID. The latest settled samples have been reviewed before proceeding to Scenario B.'
    }

    for ($cycle = 1; $cycle -le 300; $cycle++) {
        Assert-AutomatedRuntimeHealthy -TargetProcessId $TargetProcessId -ErrorPath $ErrorPath -SamplerJob $SamplerJob
        $stage = 'G2-B-CYCLE-{0:D3}' -f $cycle
        Set-StressStage -StagePath $StagePath -Stage $stage
        $show = Send-ResourceControlCommand -Pipe $resourcePipe -Command @{ type = 'show' }
        if ([int]$show.processId -ne $TargetProcessId -or [long]$show.windowHandle -ne $windowHandle -or -not [bool]$show.windowVisible) {
            throw "Scenario B show assertion failed at cycle $cycle."
        }
        Assert-Phase4G2SingleWindow -TargetProcessId $TargetProcessId -ExpectedHandle $windowHandle
        Add-Phase4G2LifecycleRow -Stage $stage -Operation 'show' -Presentation $show

        if (($cycle % 50) -eq 0) {
            $checkpointExpected = [pscustomobject]@{ Query = 'Control Panel'; ExpectedMode = 'Local'; Expectation = 'kind'; RequiredKind = 'Application'; Category = 'periodic-query-clear' }
            $query = Send-ResourceControlCommand -Pipe $resourcePipe -Command @{ type = 'query'; query = $checkpointExpected.Query }
            Assert-Phase4G2Presentation -Presentation $query -Expected $checkpointExpected -TargetProcessId $TargetProcessId -WindowHandle $windowHandle
            Add-Phase4G2LifecycleRow -Stage $stage -Operation 'checkpoint-query' -Presentation $query
        }

        $hide = Send-ResourceControlCommand -Pipe $resourcePipe -Command @{ type = 'hide' }
        Assert-Phase4G2HiddenAndClear -Presentation $hide -TargetProcessId $TargetProcessId -WindowHandle $windowHandle -Stage $stage
        Assert-Phase4G2SingleWindow -TargetProcessId $TargetProcessId -ExpectedHandle $windowHandle
        Add-Phase4G2LifecycleRow -Stage $stage -Operation 'hide' -Presentation $hide

        if (($cycle % 50) -eq 0) {
            Write-Host "Scenario B completed $cycle/300 visibility cycles, including one query-clear checkpoint. Focus/active values are diagnostic only."
            Save-Phase4G2LifecycleRows
            Wait-AutomatedSeconds -Seconds 2 -StagePath $StagePath -Stage "G2-B-CHECKPOINT-$cycle" -TargetProcessId $TargetProcessId -ErrorPath $ErrorPath -SamplerJob $SamplerJob
        }
    }

    Wait-AutomatedSeconds -Seconds 60 -StagePath $StagePath -Stage 'G2-B-SETTLE-60' -TargetProcessId $TargetProcessId -ErrorPath $ErrorPath -SamplerJob $SamplerJob
    Add-ManagedSnapshot -Stage 'G2-B-SETTLE-60'
    Write-Host 'Scenario B settled for 60 seconds. It performed 300 visibility cycles and six query-clear checkpoints.'
    Save-Phase4G2LifecycleRows
    if (-not $Remaining) { Confirm-Phase4G2TrendReview -StagePath $StagePath -Checkpoint 'B-SETTLE-60' }

    for ($cycle = 1; $cycle -le 10; $cycle++) {
        $sequence = @($TestHotkey, 'DoubleModifier:Control', 'DoubleModifier:Alt', $TestHotkey)
        foreach ($shortcut in $sequence[1..3]) {
            Assert-AutomatedRuntimeHealthy -TargetProcessId $TargetProcessId -ErrorPath $ErrorPath -SamplerJob $SamplerJob
            $stage = 'G2-C-CYCLE-{0:D2}' -f $cycle
            Set-StressStage -StagePath $StagePath -Stage $stage
            $replacement = Send-ResourceControlCommand -Pipe $resourcePipe -Command @{ type = 'replace-hotkey'; shortcut = $shortcut }
            if (-not [bool]$replacement.ok -or [int]$replacement.processId -ne $TargetProcessId -or [string]$replacement.shortcut -cne [string]$shortcut) {
                throw "Scenario C hotkey transition failed at cycle $cycle."
            }
            $replacementState = Send-ResourceControlCommand -Pipe $resourcePipe -Command @{ type = 'snapshot' }
            if ([int]$replacementState.processId -ne $TargetProcessId -or [long]$replacementState.windowHandle -ne $windowHandle -or [bool]$replacementState.windowVisible -or [string]$replacementState.query -ne '') {
                throw "Scenario C must preserve the same hidden Launcher HWND and process after hotkey transition $cycle."
            }
            Add-Phase4G2LifecycleRow -Stage $stage -Operation 'replace-hotkey' -Presentation $replacementState -Hotkey $shortcut
        }
        Save-Phase4G2LifecycleRows
    }

    Wait-AutomatedSeconds -Seconds 2 -StagePath $StagePath -Stage 'G2-C-POST-TRANSITIONS' -TargetProcessId $TargetProcessId -ErrorPath $ErrorPath -SamplerJob $SamplerJob
    $cSnapshot = Send-ResourceControlCommand -Pipe $resourcePipe -Command @{ type = 'snapshot' }
    if ([int]$cSnapshot.processId -ne $TargetProcessId -or [long]$cSnapshot.windowHandle -ne $windowHandle -or [bool]$cSnapshot.windowVisible) {
        throw 'Scenario C must preserve the same hidden Launcher HWND and process.'
    }
    $finalStage = 'G2-C-SETTLE-60'
    Wait-AutomatedSeconds -Seconds 60 -StagePath $StagePath -Stage $finalStage -TargetProcessId $TargetProcessId -ErrorPath $ErrorPath -SamplerJob $SamplerJob
    Add-ManagedSnapshot -Stage $finalStage

    Save-Phase4G2LifecycleRows
    $runRecord = [ordered]@{
        phase = 'Phase 4G-2'
        sourceBranch = (git -C $repositoryRoot branch --show-current)
        sourceHead = (git -C $repositoryRoot rev-parse HEAD)
        processId = $TargetProcessId
        initialWindowHandle = $windowHandle
        expectedNativeHostCount = $ExpectedNativeHostCount
        managerProcessCount = 0
        everythingEnabledInIsolatedProjection = $everythingEnabled
        queryCountPerRound = if ($Remaining) { 0 } else { 1000 }
        searchRounds = if ($Remaining) { 0 } else { 3 }
        scenarioAPreviouslyPassed = [bool]$Remaining
        visibilityCycles = 300
        queryClearCheckpoints = 6
        fakeHotkeyCycles = 300
        realHotkeyModeCycles = 10
        queryCorpusPath = if ($Remaining) { $null } else { [IO.Path]::GetFileName($corpusOutputPath) }
        queryCorpusSha256 = $corpusHash
        generatedAt = [DateTimeOffset]::Now.ToString('o')
    }
    $runRecord | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $OutputDirectory ("phase4g2-run-{0}-{1}-{2}.json" -f $safeScenarioName, $RunNumber, $runStamp)) -Encoding utf8
    Write-Host "Scenario C settled for 60 seconds. Lifecycle diagnostics: $lifecycleOutputPath; frozen corpus: $corpusOutputPath."
}

function Assert-Phase4G2HiddenAndClear {
    param([Parameter(Mandatory = $true)] $Presentation, [int] $TargetProcessId, [long] $WindowHandle, [string] $Stage)
    if ([int]$Presentation.processId -ne $TargetProcessId -or [long]$Presentation.windowHandle -ne $WindowHandle -or [bool]$Presentation.windowVisible) {
        throw "Phase 4G-2 hide assertion failed at $Stage (PID/HWND/visibility)."
    }
    if ([string]$Presentation.query -cne '' -or [int]$Presentation.resultCount -ne 0 -or @($Presentation.resultKinds).Count -ne 0) {
        throw "Phase 4G-2 hide did not clear transient query/results at $Stage."
    }
}

function Get-ResourceQueryCorpus {
    $searchChar = [string]([char]0x6D4B) + [string]([char]0x8BD5)
    $wechat = [string]([char]0x5FAE) + [string]([char]0x4FE1)
    $controlPanel = [string]([char]0x63A7) + [string]([char]0x5236) + [string]([char]0x9762) + [string]([char]0x677F)
    return @('visual', $wechat, 'weixin', 'wx', 'bilibili', '/bili', '?test', 'file:codex', ('file:' + $searchChar), $controlPanel)
}

function Set-TargetedAttributionStage {
    param([string] $StagePath, [string] $Stage)
    Set-StressStage -StagePath $StagePath -Stage $Stage
    # Warm-up presentation/hide are validated from the managed checkpoint CSV;
    # they are intentionally too brief to require a one-second OS sample.
    if ($Stage -notin @('ATTR-WARMUP-PRESENTED', 'ATTR-WARMUP-HIDDEN') -and
        $Stage -match '^ATTR-(INITIAL-IDLE-30|SMOKE-FINAL|[A-Z0-9-]+-(IMMEDIATE|HIDDEN|SETTLE-60|SETTLE-120))$' -and
        $Stage -notin $targetedAttributionStages) {
        [void]$targetedAttributionStages.Add($Stage)
    }
}

function Get-TargetedResourceRows {
    try { return @(Import-Csv -LiteralPath $outputPath -ErrorAction Stop) }
    catch { return @() }
}

function Wait-TargetedAttributionSample {
    param([string] $Stage, [int] $TimeoutSeconds = 10)
    $deadline = [DateTimeOffset]::Now.AddSeconds($TimeoutSeconds)
    do {
        $rows = @(Get-TargetedResourceRows | Where-Object { $_.Stage -eq $Stage })
        if ($rows.Count -gt 0) { return $rows }
        Start-Sleep -Milliseconds 100
    } while ([DateTimeOffset]::Now -lt $deadline)
    throw "The resource collector did not flush a sample for attribution stage '$Stage'."
}

function Get-TargetedMetricMedian {
    param([object[]] $Rows, [string] $Metric)
    $values = @($Rows | ForEach-Object { [long]$_.$Metric } | Sort-Object)
    if ($values.Count -eq 0) { return $null }
    return [long]$values[[int][Math]::Floor($values.Count / 2)]
}

function Get-TargetedWindowStats {
    param([object[]] $Rows, [string] $Stage)
    if ($Rows.Count -eq 0) { throw "No resource samples exist for stage '$Stage'." }
    $lastTen = @($Rows | Select-Object -Last ([Math]::Min(10, $Rows.Count)))
    $metrics = [ordered]@{ Stage = $Stage; Samples = $Rows.Count }
    foreach ($metric in @('PrivateBytes', 'WorkingSet', 'GDI', 'USER', 'Threads', 'Handles')) {
        $values = @($Rows | Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_.$metric) } | ForEach-Object { [long]$_.$metric } | Sort-Object)
        $metrics["${metric}Median"] = if ($values.Count -gt 0) { [long]$values[[int][Math]::Floor($values.Count / 2)] } else { $null }
        $metrics["${metric}Min"] = if ($values.Count -gt 0) { [long]$values[0] } else { $null }
        $metrics["${metric}Max"] = if ($values.Count -gt 0) { [long]$values[-1] } else { $null }
        $metrics["${metric}Last10Median"] = Get-TargetedMetricMedian -Rows $lastTen -Metric $metric
    }
    return [pscustomobject]$metrics
}

function Get-TargetedHandleWindowTrend {
    param([object[]] $Rows)
    if ($Rows.Count -eq 0) { throw 'Cannot classify a Handle trend without resource samples.' }
    $firstTen = @(Get-TargetedMetricMedian -Rows @($Rows | Select-Object -First 10) -Metric 'Handles')
    $lastTen = @(Get-TargetedMetricMedian -Rows @($Rows | Select-Object -Last 10) -Metric 'Handles')
    $delta = [long]$lastTen[0] - [long]$firstTen[0]
    $trend = if ($delta -ge 2) { 'UPWARD' } elseif ($delta -le -2) { 'DOWNWARD' } else { 'STABLE / NOISE' }
    return [pscustomobject]@{
        FirstTenMedian = [long]$firstTen[0]
        LastTenMedian = [long]$lastTen[0]
        Delta = $delta
        Direction = $trend
    }
}

function Assert-TargetedAttributionPresentation {
    param(
        [Parameter(Mandatory = $true)] $Presentation,
        [Parameter(Mandatory = $true)] [string] $Query,
        [Parameter(Mandatory = $true)] [string] $ExpectedMode,
        [string] $ExpectedKind,
        [switch] $AllowNoResult,
        [switch] $RequireNoResult
    )
    if ([int]$Presentation.processId -ne $TargetProcessId -or [long]$Presentation.windowHandle -ne $script:targetedWindowHandle) {
        throw "Targeted attribution PID/HWND identity changed for query '$Query'."
    }
    if (-not [bool]$Presentation.windowVisible -or [string]$Presentation.query -cne $Query -or [string]$Presentation.searchMode -cne $ExpectedMode) {
        throw "Targeted attribution did not present query/mode/visibility exactly (query='$Query', expectedMode='$ExpectedMode', actualMode='$($Presentation.searchMode)')."
    }
    $kinds = @($Presentation.resultKinds | ForEach-Object { [string]$_ })
    if ($RequireNoResult) {
        if ([int]$Presentation.resultCount -ne 0 -or $kinds.Count -ne 0) { throw "Control query '$Query' unexpectedly produced result rows." }
        return
    }
    if (-not [string]::IsNullOrWhiteSpace($ExpectedKind)) {
        if ($ExpectedKind -notin $kinds) {
            if ($AllowNoResult -and [int]$Presentation.resultCount -eq 0 -and -not [string]::IsNullOrWhiteSpace([string]$Presentation.status)) { return }
            throw "Targeted attribution expected result kind '$ExpectedKind' for '$Query'; observed [$($kinds -join ',')] with status '$($Presentation.status)'."
        }
    }
    if ($ExpectedMode -eq 'Files') {
        if ($kinds.Count -gt 0 -and @($kinds | Where-Object { $_ -in @('File', 'Folder') }).Count -ne $kinds.Count) {
            throw "Everything query '$Query' returned a non-file result kind."
        }
        if ([string]$Presentation.status -match '没有找到 ES|Everything 没有运行|无法启动 ES|命令失败|timed out') {
            throw "Everything was not operational for query '$Query': $($Presentation.status)"
        }
        if ($kinds.Count -eq 0 -and [string]$Presentation.status -notmatch '没有找到匹配的文件或文件夹') {
            throw "Everything query '$Query' did not complete with a file result or the expected empty-result status: $($Presentation.status)"
        }
    }
}

function Get-TargetedAttributionBlock {
    param([string] $Id, [bool] $IncludeEverything)
    switch ($Id) {
        'A' {
            return [pscustomobject]@{
                Id = $Id; Name = 'Local app/search core'; ExpectedMode = 'Local'; ExpectedKind = 'Application';
                Queries = @('Control Panel', '控制面板', 'kongzhimianban', 'File Explorer', '文件资源管理器', 'explorer.exe', 'Device Manager', 'devmgmt.msc', '设备管理器', 'wenjian')
            }
        }
        'B' {
            return [pscustomobject]@{
                Id = $Id; Name = 'Saved website search/presentation'; ExpectedMode = 'Local'; ExpectedKind = 'Website';
                Queries = @('Phase4G2 Acceptance Site', 'phase4g2-resource-check.invalid', '/Phase4G2 Acceptance Site', '/phase4g2-resource-check.invalid/launcher-check')
            }
        }
        'C' {
            if (-not $IncludeEverything) { return $null }
            return [pscustomobject]@{
                Id = $Id; Name = 'Everything file search'; ExpectedMode = 'Files'; ExpectedKind = '';
                Queries = @()
            }
        }
        'D' {
            return [pscustomobject]@{
                Id = $Id; Name = 'Clear/no-result control'; ExpectedMode = 'Local'; ExpectedKind = '';
                Queries = @()
            }
        }
        default { throw "Unknown targeted attribution block '$Id'." }
    }
}

function Invoke-TargetedAttributionBlock {
    param(
        [Parameter(Mandatory = $true)] $Block,
        [Parameter(Mandatory = $true)] [string] $Label,
        [Parameter(Mandatory = $true)] [string] $StagePath,
        [Parameter(Mandatory = $true)] [int] $TargetProcessId,
        [Parameter(Mandatory = $true)] [string] $ErrorPath,
        [Parameter(Mandatory = $true)] [System.Management.Automation.Job] $SamplerJob,
        [Parameter(Mandatory = $true)] [string] $BaselineStage,
        [Parameter(Mandatory = $true)] [long] $BaselineHandles
    )

    Assert-AutomatedRuntimeHealthy -TargetProcessId $TargetProcessId -ErrorPath $ErrorPath -SamplerJob $SamplerJob
    $windowList = @([Phase4EResourceSamplerInterop]::FindLauncherWindows($TargetProcessId))
    if ($windowList.Count -ne 1 -or [long]$windowList[0] -ne $script:targetedWindowHandle) {
        throw "Targeted attribution block $Label did not reuse the same sole Launcher HWND."
    }
    $baselineRows = @(Get-TargetedResourceRows | Where-Object { $_.Stage -eq $BaselineStage })
    $baselineStats = Get-TargetedWindowStats -Rows $baselineRows -Stage $BaselineStage

    $show = Send-ResourceControlCommand -Pipe $resourcePipe -Command @{ type = 'show' }
    if ([int]$show.processId -ne $TargetProcessId -or [long]$show.windowHandle -ne $script:targetedWindowHandle -or -not [bool]$show.windowVisible) {
        throw "Targeted attribution block $Label could not show its existing Launcher window."
    }

    Set-TargetedAttributionStage -StagePath $StagePath -Stage "ATTR-$Label-WORKLOAD"
    $queryCount = 300
    for ($index = 1; $index -le $queryCount; $index++) {
        Assert-AutomatedRuntimeHealthy -TargetProcessId $TargetProcessId -ErrorPath $ErrorPath -SamplerJob $SamplerJob
        $query = switch ($Block.Id) {
            'A' { [string]$Block.Queries[($index - 1) % $Block.Queries.Count] }
            'B' { [string]$Block.Queries[($index - 1) % $Block.Queries.Count] }
            'C' { 'file:__phase4g2_missing_marker_' + $index.ToString('D4') }
            'D' { if (($index % 2) -eq 1) { '' } else { '__phase4g2_control_no_result_' + $index.ToString('D4') } }
            default { throw "No query generator exists for block '$($Block.Id)'." }
        }
        $presentation = Send-ResourceControlCommand -Pipe $resourcePipe -Command @{ type = 'query'; query = $query }
        if ($query.Length -eq 0) {
            Assert-TargetedAttributionPresentation -Presentation $presentation -Query $query -ExpectedMode 'Local' -RequireNoResult
        }
        elseif ($Block.Id -eq 'D') {
            Assert-TargetedAttributionPresentation -Presentation $presentation -Query $query -ExpectedMode 'Local' -RequireNoResult
        }
        else {
            $expectedMode = if ($Block.Id -eq 'B' -and $query.StartsWith('/')) { 'SavedWebsites' } else { $Block.ExpectedMode }
            Assert-TargetedAttributionPresentation -Presentation $presentation -Query $query -ExpectedMode $expectedMode -ExpectedKind $Block.ExpectedKind -AllowNoResult:($Block.Id -eq 'C')
        }

        if (($index % 100) -eq 0) {
            $checkpoint = "ATTR-$Label-WORKLOAD-$index"
            Set-TargetedAttributionStage -StagePath $StagePath -Stage $checkpoint
            $null = Add-ManagedSnapshot -Stage $checkpoint
            Write-Host "$($Block.Name): $index/$queryCount query changes; mode=$($presentation.searchMode); rows=$($presentation.resultCount); icons=$($presentation.iconCount); iconCache=$($presentation.iconCacheCount)."
        }
    }

    $visibleCheckpointStage = "ATTR-$Label-IMMEDIATE"
    Set-TargetedAttributionStage -StagePath $StagePath -Stage $visibleCheckpointStage
    $visibleSnapshot = Add-ManagedSnapshot -Stage $visibleCheckpointStage -ReturnSnapshot
    $visibleSamples = @(Wait-TargetedAttributionSample -Stage $visibleCheckpointStage)
    $visibleStats = Get-TargetedWindowStats -Rows $visibleSamples -Stage $visibleCheckpointStage

    $hidden = Send-ResourceControlCommand -Pipe $resourcePipe -Command @{ type = 'hide' }
    Assert-Phase4G2HiddenAndClear -Presentation $hidden -TargetProcessId $TargetProcessId -WindowHandle $script:targetedWindowHandle -Stage "ATTR-$Label-HIDDEN"
    $hiddenStage = "ATTR-$Label-HIDDEN"
    Set-TargetedAttributionStage -StagePath $StagePath -Stage $hiddenStage
    $null = Add-ManagedSnapshot -Stage $hiddenStage
    $hiddenSamples = @(Wait-TargetedAttributionSample -Stage $hiddenStage)
    $hiddenStats = Get-TargetedWindowStats -Rows $hiddenSamples -Stage $hiddenStage
    Assert-AutomatedRuntimeHealthy -TargetProcessId $TargetProcessId -ErrorPath $ErrorPath -SamplerJob $SamplerJob

    $settleStage = "ATTR-$Label-SETTLE-60"
    Wait-AutomatedSeconds -Seconds 60 -StagePath $StagePath -Stage $settleStage -TargetProcessId $TargetProcessId -ErrorPath $ErrorPath -SamplerJob $SamplerJob
    [void]$targetedAttributionStages.Add($settleStage)
    $null = Add-ManagedSnapshot -Stage $settleStage
    $settledRows = @(Get-TargetedResourceRows | Where-Object { $_.Stage -eq $settleStage })
    if ($settledRows.Count -lt 50) { throw "Attribution settle stage '$settleStage' contains only $($settledRows.Count) samples; expected at least 50 of the 60 one-second samples." }
    $settledStats = Get-TargetedWindowStats -Rows $settledRows -Stage $settleStage
    $firstWindowTrend = Get-TargetedHandleWindowTrend -Rows $settledRows
    $upwardAfterFirstWindow = $firstWindowTrend.Direction -eq 'UPWARD'
    $additionalSettleRows = @()
    $additionalSettleStats = $null
    $additionalWindowTrend = $null
    $stillTrendingUpAfterAdditional60 = $false
    if ($upwardAfterFirstWindow) {
        $additionalStage = "ATTR-$Label-SETTLE-120"
        Wait-AutomatedSeconds -Seconds 60 -StagePath $StagePath -Stage $additionalStage -TargetProcessId $TargetProcessId -ErrorPath $ErrorPath -SamplerJob $SamplerJob
        [void]$targetedAttributionStages.Add($additionalStage)
        $null = Add-ManagedSnapshot -Stage $additionalStage
        $additionalSettleRows = @(Get-TargetedResourceRows | Where-Object { $_.Stage -eq $additionalStage })
        if ($additionalSettleRows.Count -lt 50) { throw "Additional idle stage '$additionalStage' contains only $($additionalSettleRows.Count) samples." }
        $additionalSettleStats = Get-TargetedWindowStats -Rows $additionalSettleRows -Stage $additionalStage
        $additionalWindowTrend = Get-TargetedHandleWindowTrend -Rows $additionalSettleRows
        $stillTrendingUpAfterAdditional60 = $additionalWindowTrend.Direction -eq 'UPWARD'
        $settledStats = $additionalSettleStats
        $settledRows = $additionalSettleRows
    }

    $delta = [long]$settledStats.HandlesLast10Median - $BaselineHandles
    $blockRow = [pscustomobject]@{
        Block = $Label
        Name = $Block.Name
        QueryChanges = $queryCount
        ExpectedMode = $Block.ExpectedMode
        ExpectedResultKind = $Block.ExpectedKind
        BaselineHandles = $BaselineHandles
        ImmediateVisibleHandles = [long]$visibleSamples[-1].Handles
        SettledHandles = [long]$settledStats.HandlesLast10Median
        SettledDeltaHandles = $delta
        First60sHandlesFirst10Median = $firstWindowTrend.FirstTenMedian
        First60sHandlesLast10Median = $firstWindowTrend.LastTenMedian
        First60sHandlesDelta = $firstWindowTrend.Delta
        First60sHandlesTrend = $firstWindowTrend.Direction
        Additional60sObserved = $upwardAfterFirstWindow
        Additional60sHandlesFirst10Median = if ($null -ne $additionalWindowTrend) { $additionalWindowTrend.FirstTenMedian } else { $null }
        Additional60sHandlesLast10Median = if ($null -ne $additionalWindowTrend) { $additionalWindowTrend.LastTenMedian } else { $null }
        Additional60sHandlesDelta = if ($null -ne $additionalWindowTrend) { $additionalWindowTrend.Delta } else { $null }
        Additional60sHandlesTrend = if ($null -ne $additionalWindowTrend) { $additionalWindowTrend.Direction } else { $null }
        StillTrendingUpAfterAdditional60 = $stillTrendingUpAfterAdditional60
        ImmediateStage = $visibleCheckpointStage
        HiddenStage = $hiddenStage
        SettleStage = if ($null -ne $additionalSettleStats) { $additionalSettleStats.Stage } else { $settleStage }
        BaselineResourceStats = $baselineStats
        ImmediateResourceStats = $visibleStats
        HiddenResourceStats = $hiddenStats
        SettledResourceStats = $settledStats
        AdditionalIdleResourceStats = $additionalSettleStats
        ImmediatePresentationResultCount = [int]$visibleSnapshot.ResultCount
        ImmediatePresentationIconCount = [int]$visibleSnapshot.IconCount
        ImmediatePresentationIconCacheCount = [int]$visibleSnapshot.IconCacheCount
    }
    [void]$targetedAttributionRows.Add($blockRow)
    Write-Host ("{0}: baseline handles={1}; immediate={2}; settled={3}; delta={4}; first-settle trend={5}; extra idle={6}; still trending upward={7}." -f $Label, $BaselineHandles, $blockRow.ImmediateVisibleHandles, $settledStats.HandlesLast10Median, $delta, $firstWindowTrend.Direction, $upwardAfterFirstWindow, $stillTrendingUpAfterAdditional60)
    return $blockRow
}

function Invoke-WarmMemoryConvergenceWorkload {
    param([string] $StagePath, [int] $TargetProcessId, [string] $ErrorPath, [System.Management.Automation.Job] $SamplerJob)

    $block = Get-TargetedAttributionBlock -Id 'A' -IncludeEverything $false
    $show = Send-ResourceControlCommand -Pipe $resourcePipe -Command @{ type = 'show' }
    if ([int]$show.processId -ne $TargetProcessId -or [long]$show.windowHandle -ne $script:targetedWindowHandle -or -not [bool]$show.windowVisible) {
        throw 'Warm-up could not show the existing isolated Launcher window.'
    }

    Set-TargetedAttributionStage -StagePath $StagePath -Stage 'ATTR-WARMUP-WORKLOAD'
    foreach ($query in $block.Queries) {
        Assert-AutomatedRuntimeHealthy -TargetProcessId $TargetProcessId -ErrorPath $ErrorPath -SamplerJob $SamplerJob
        $presentation = Send-ResourceControlCommand -Pipe $resourcePipe -Command @{ type = 'query'; query = [string]$query }
        Assert-TargetedAttributionPresentation -Presentation $presentation -Query ([string]$query) -ExpectedMode 'Local' -ExpectedKind 'Application'
    }

    Set-TargetedAttributionStage -StagePath $StagePath -Stage 'ATTR-WARMUP-PRESENTED'
    $warmPresentation = Add-ManagedSnapshot -Stage 'ATTR-WARMUP-PRESENTED' -ReturnSnapshot
    if ([int]$warmPresentation.resultCount -le 0 -or [int]$warmPresentation.realizedResultCount -le 0) {
        throw 'Warm-up did not realize local app result rows before establishing the warm baseline.'
    }

    $hidden = Send-ResourceControlCommand -Pipe $resourcePipe -Command @{ type = 'hide' }
    Assert-Phase4G2HiddenAndClear -Presentation $hidden -TargetProcessId $TargetProcessId -WindowHandle $script:targetedWindowHandle -Stage 'ATTR-WARMUP-HIDDEN'
    Set-TargetedAttributionStage -StagePath $StagePath -Stage 'ATTR-WARMUP-HIDDEN'
    $null = Add-ManagedSnapshot -Stage 'ATTR-WARMUP-HIDDEN'

    $warmBaselineStage = 'ATTR-WARM-BASELINE-SETTLE-60'
    Wait-AutomatedSeconds -Seconds 60 -StagePath $StagePath -Stage $warmBaselineStage -TargetProcessId $TargetProcessId -ErrorPath $ErrorPath -SamplerJob $SamplerJob
    [void]$targetedAttributionStages.Add($warmBaselineStage)
    $null = Add-ManagedSnapshot -Stage $warmBaselineStage
    $warmBaselineRows = @(Get-TargetedResourceRows | Where-Object { $_.Stage -eq $warmBaselineStage })
    if ($warmBaselineRows.Count -lt 50) { throw "Warm baseline contains only $($warmBaselineRows.Count) samples; expected at least 50." }
    $warmBaselineStats = Get-TargetedWindowStats -Rows $warmBaselineRows -Stage $warmBaselineStage
    $warmBaselineHandles = [long]$warmBaselineStats.HandlesLast10Median

    $blockA1 = Invoke-TargetedAttributionBlock -Block $block -Label 'A1' -StagePath $StagePath -TargetProcessId $TargetProcessId -ErrorPath $ErrorPath -SamplerJob $SamplerJob -BaselineStage $warmBaselineStage -BaselineHandles $warmBaselineHandles
    $blockA2 = Invoke-TargetedAttributionBlock -Block $block -Label 'A2' -StagePath $StagePath -TargetProcessId $TargetProcessId -ErrorPath $ErrorPath -SamplerJob $SamplerJob -BaselineStage ([string]$blockA1.SettleStage) -BaselineHandles ([long]$blockA1.SettledHandles)
    $blockA3 = Invoke-TargetedAttributionBlock -Block $block -Label 'A3' -StagePath $StagePath -TargetProcessId $TargetProcessId -ErrorPath $ErrorPath -SamplerJob $SamplerJob -BaselineStage ([string]$blockA2.SettleStage) -BaselineHandles ([long]$blockA2.SettledHandles)
    $blockA4 = Invoke-TargetedAttributionBlock -Block $block -Label 'A4' -StagePath $StagePath -TargetProcessId $TargetProcessId -ErrorPath $ErrorPath -SamplerJob $SamplerJob -BaselineStage ([string]$blockA3.SettleStage) -BaselineHandles ([long]$blockA3.SettledHandles)

    return [pscustomobject]@{
        WarmupQueryCount = $block.Queries.Count
        WarmupPresentation = $warmPresentation
        WarmBaselineStage = $warmBaselineStage
        WarmBaselineStats = $warmBaselineStats
        BlockA1 = $blockA1
        BlockA2 = $blockA2
        BlockA3 = $blockA3
        BlockA4 = $blockA4
    }
}

function Invoke-TargetedAttributionWorkload {
    param([string] $StagePath, [int] $TargetProcessId, [string] $ErrorPath, [System.Management.Automation.Job] $SamplerJob)
    $targetedStartedAt = [DateTimeOffset]::Now.ToString('o')
    $initial = Send-ResourceControlCommand -Pipe $resourcePipe -Command @{ type = 'snapshot' }
    if ([int]$initial.processId -ne $TargetProcessId -or [long]$initial.windowHandle -le 0 -or [bool]$initial.windowVisible -or [string]$initial.query -ne '') {
        throw 'Targeted attribution requires one created, hidden Launcher with an empty query in the isolated NativeHost.'
    }
    $script:targetedWindowHandle = [long]$initial.windowHandle
    Assert-Phase4G2SingleWindow -TargetProcessId $TargetProcessId -ExpectedHandle $script:targetedWindowHandle

    Set-TargetedAttributionStage -StagePath $StagePath -Stage 'ATTR-INITIAL-IDLE-30'
    Wait-AutomatedSeconds -Seconds 30 -StagePath $StagePath -Stage 'ATTR-INITIAL-IDLE-30' -TargetProcessId $TargetProcessId -ErrorPath $ErrorPath -SamplerJob $SamplerJob
    $null = Add-ManagedSnapshot -Stage 'ATTR-INITIAL-IDLE-30'
    $initialRows = @(Wait-TargetedAttributionSample -Stage 'ATTR-INITIAL-IDLE-30')
    $initialHandleBaseline = Get-TargetedMetricMedian -Rows @($initialRows | Select-Object -Last ([Math]::Min(10, $initialRows.Count))) -Metric 'Handles'

    if ($CollectorSmokeOnly) {
        $noReturnSnapshot = @(Add-ManagedSnapshot -Stage 'ATTR-SMOKE-NO-RETURN')
        if ($noReturnSnapshot.Count -ne 0) { throw "Collector snapshot isolation smoke expected no default pipeline output, received $($noReturnSnapshot.Count) object(s)." }
        $returnedSnapshot = @(Add-ManagedSnapshot -Stage 'ATTR-SMOKE-RETURN-OPT-IN' -ReturnSnapshot)
        if ($returnedSnapshot.Count -ne 1 -or [int]$returnedSnapshot[0].processId -ne $TargetProcessId) { throw 'Collector snapshot isolation smoke expected exactly one matching opt-in snapshot.' }

        $smokeQueries = @('Control Panel', 'Phase4G2 Acceptance Site', '/phase4g2-resource-check.invalid', '__phase4g2_smoke_no_result__', '')
        $show = Send-ResourceControlCommand -Pipe $resourcePipe -Command @{ type = 'show' }
        if (-not [bool]$show.windowVisible -or [long]$show.windowHandle -ne $script:targetedWindowHandle) { throw 'Collector smoke could not show the existing test Launcher.' }
        for ($index = 1; $index -le 10; $index++) {
            $query = [string]$smokeQueries[($index - 1) % $smokeQueries.Count]
            $presentation = Send-ResourceControlCommand -Pipe $resourcePipe -Command @{ type = 'query'; query = $query }
            if ([int]$presentation.processId -ne $TargetProcessId -or [long]$presentation.windowHandle -ne $script:targetedWindowHandle -or [string]$presentation.query -cne $query -or -not [bool]$presentation.windowVisible) {
                throw "Collector smoke query $index did not return the expected real-WPF presentation identity."
            }
            $kinds = @($presentation.resultKinds | ForEach-Object { [string]$_ })
            if ($query -eq 'Control Panel' -and 'Application' -notin $kinds) { throw 'Collector smoke local-app query did not present an application result.' }
            if ($query -eq 'Phase4G2 Acceptance Site' -and 'Website' -notin $kinds) { throw 'Collector smoke website query did not present the isolated website fixture.' }
            if ($query.StartsWith('/') -and 'Website' -notin $kinds) { throw 'Collector smoke saved-website command did not present the isolated website fixture.' }
            if ($query -eq '' -and ([int]$presentation.resultCount -ne 0 -or @($presentation.resultKinds).Count -ne 0)) { throw 'Collector smoke empty query did not clear results.' }
            if ($query -eq '__phase4g2_smoke_no_result__' -and [int]$presentation.resultCount -ne 0) { throw 'Collector smoke no-result query unexpectedly matched.' }
            if (($index % 2) -eq 0) {
                $checkpoint = "ATTR-SMOKE-$index"
                Set-TargetedAttributionStage -StagePath $StagePath -Stage $checkpoint
                $null = Add-ManagedSnapshot -Stage $checkpoint
            }
        }
        $hide = Send-ResourceControlCommand -Pipe $resourcePipe -Command @{ type = 'hide' }
        Assert-Phase4G2HiddenAndClear -Presentation $hide -TargetProcessId $TargetProcessId -WindowHandle $script:targetedWindowHandle -Stage 'ATTR-SMOKE-HIDDEN'
        Set-TargetedAttributionStage -StagePath $StagePath -Stage 'ATTR-SMOKE-FINAL'
        $null = Add-ManagedSnapshot -Stage 'ATTR-SMOKE-FINAL'
        $null = Wait-TargetedAttributionSample -Stage 'ATTR-SMOKE-FINAL'

        $smokeRows = @(Import-Csv -LiteralPath $outputPath)
        if ($smokeRows.Count -eq 0) { throw 'Collector smoke could not validate a non-empty OS sample CSV.' }
        $requiredStages = @('IDLE-START', 'ATTR-INITIAL-IDLE-30', 'ATTR-SMOKE-FINAL')
        $observedStages = @($smokeRows.Stage | Sort-Object -Unique)
        $missingStages = @($requiredStages | Where-Object { $_ -notin $observedStages })
        if ($missingStages.Count -gt 0) { throw "Collector smoke CSV is missing required stages: $($missingStages -join ', ')." }
        if (@($smokeRows | Where-Object { [int]$_.PID -ne $TargetProcessId -or $_.ProcessPresent -ne 'True' -or [string]::IsNullOrWhiteSpace($_.Timestamp) }).Count -gt 0) {
            throw 'Collector smoke CSV contains a missing target process, PID mismatch, or missing timestamp.'
        }
        $persistedManagedRows = @(Import-Csv -LiteralPath $managedOutputPath)
        if ($persistedManagedRows.Count -lt 9) { throw "Collector smoke expected at least nine incrementally persisted managed checkpoints, found $($persistedManagedRows.Count)." }
        if ((Get-ManagerProcessCount) -ne 0) { throw 'Collector smoke observed a Manager/Electron process; expected zero.' }

        $smokeManifestPath = Join-Path $OutputDirectory ("phase4g2-attribution-manifest-{0}-{1}-{2}.json" -f $safeScenarioName, $RunNumber, $runStamp)
        $smokeManifest = [ordered]@{
            startedAt = $targetedStartedAt
            endedAt = [DateTimeOffset]::Now.ToString('o')
            mode = 'CollectorSmokeOnly'
            result = 'collector-smoke-pass'
            targetPid = $TargetProcessId
            windowHandle = $script:targetedWindowHandle
            osSampleCount = $smokeRows.Count
            managedCheckpointCount = $persistedManagedRows.Count
            snapshotDefaultOutputCount = $noReturnSnapshot.Count
            snapshotOptInOutputCount = $returnedSnapshot.Count
            stages = $observedStages
            launchActionsPerformed = $false
            managerElectronCount = 0
            resourceCsv = [IO.Path]::GetFileName($outputPath)
            managedCheckpointCsv = [IO.Path]::GetFileName($managedOutputPath)
        }
        $smokeManifest | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $smokeManifestPath -Encoding utf8
        $persistedManifest = Get-Content -Raw -LiteralPath $smokeManifestPath | ConvertFrom-Json
        if ($persistedManifest.result -ne 'collector-smoke-pass' -or [int]$persistedManifest.targetPid -ne $TargetProcessId -or [int]$persistedManifest.osSampleCount -le 0 -or [int]$persistedManifest.managedCheckpointCount -lt 9) {
            throw 'Collector smoke aggregate manifest failed read-back validation.'
        }
        Write-Host "Collector smoke aggregate manifest PASS: $smokeManifestPath"
        return
    }

    if ($WarmRepetition) {
        $repetition = Invoke-WarmMemoryConvergenceWorkload -StagePath $StagePath -TargetProcessId $TargetProcessId -ErrorPath $ErrorPath -SamplerJob $SamplerJob
        $repetitionManifestPath = Join-Path $OutputDirectory ("phase4g2-warm-memory-manifest-{0}-{1}-{2}.json" -f $safeScenarioName, $RunNumber, $runStamp)
        $repetitionManifest = [ordered]@{
            startedAt = $targetedStartedAt
            endedAt = [DateTimeOffset]::Now.ToString('o')
            mode = 'WarmMemoryConvergence'
            result = 'four-equivalent-local-blocks-completed'
            targetPid = $TargetProcessId
            windowHandle = $script:targetedWindowHandle
            initialHiddenSettleSeconds = 30
            warmupQueryCount = $repetition.WarmupQueryCount
            warmupPresentationResultCount = [int]$repetition.WarmupPresentation.resultCount
            warmBaselineStage = $repetition.WarmBaselineStage
            warmBaselineStats = $repetition.WarmBaselineStats
            repeatedQueryChangesPerBlock = 300
            blocks = @($repetition.BlockA1, $repetition.BlockA2, $repetition.BlockA3, $repetition.BlockA4)
            managerElectronCount = Get-ManagerProcessCount
            resourceCsv = [IO.Path]::GetFileName($outputPath)
            managedCheckpointCsv = [IO.Path]::GetFileName($managedOutputPath)
            launchActionsPerformed = $false
        }
        $repetitionManifest | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $repetitionManifestPath -Encoding utf8
        $persistedRepetitionManifest = Get-Content -Raw -LiteralPath $repetitionManifestPath | ConvertFrom-Json
        if ($persistedRepetitionManifest.result -ne 'four-equivalent-local-blocks-completed' -or
            [int]$persistedRepetitionManifest.targetPid -ne $TargetProcessId -or
            [long]$persistedRepetitionManifest.windowHandle -ne $script:targetedWindowHandle -or
            @($persistedRepetitionManifest.blocks).Count -ne 4) {
            throw 'Warm-memory convergence aggregate manifest failed read-back validation.'
        }
        Write-Host "Warm-memory convergence aggregate manifest PASS: $repetitionManifestPath"
        return
    }

    $state = Get-Content -Raw -LiteralPath $StatePath | ConvertFrom-Json
    $everythingExe = [string]$state.everythingEsPath
    $everythingProcess = @(Get-Process -Name 'Everything' -ErrorAction SilentlyContinue)
    $everythingExePresent = -not [string]::IsNullOrWhiteSpace($everythingExe) -and (Test-Path -LiteralPath $everythingExe -PathType Leaf)
    $everythingAvailable = [bool]$initial.everythingEnabled -and $everythingExePresent -and $everythingProcess.Count -gt 0
    $attributionManifest = [ordered]@{
        startedAt = $targetedStartedAt
        targetPid = $TargetProcessId
        windowHandle = $script:targetedWindowHandle
        initialNativeHostCount = @(Get-NativeHostProcesses).Count
        managerElectronCount = Get-ManagerProcessCount
        everythingEnabled = [bool]$initial.everythingEnabled
        everythingExe = $everythingExe
        everythingExePresent = $everythingExePresent
        everythingProcessIds = @($everythingProcess | ForEach-Object { $_.Id })
        everythingBlockAvailable = $everythingAvailable
        queryChangesPerBlock = 300
        launchActionsPerformed = $false
        corpus = [ordered]@{
            A = @('Control Panel', '控制面板', 'kongzhimianban', 'File Explorer', '文件资源管理器', 'explorer.exe', 'Device Manager', 'devmgmt.msc', '设备管理器', 'wenjian')
            B = @('Phase4G2 Acceptance Site', 'phase4g2-resource-check.invalid', '/Phase4G2 Acceptance Site', '/phase4g2-resource-check.invalid/launcher-check')
            C = if ($everythingAvailable) { 'file:__phase4g2_missing_marker_<0001..0300>' } else { 'NOT RUN — Everything unavailable' }
            D = @('empty query', '__phase4g2_control_no_result_<0002..0300>')
        }
    }
    $manifestPath = Join-Path $OutputDirectory ("phase4g2-attribution-manifest-{0}-{1}-{2}.json" -f $safeScenarioName, $RunNumber, $runStamp)
    $baseline = [long]$initialHandleBaseline
    $baselineStage = 'ATTR-INITIAL-IDLE-30'
    $outcome = 'completed'
    foreach ($blockId in @('A', 'B', 'C', 'D')) {
        $block = Get-TargetedAttributionBlock -Id $blockId -IncludeEverything $everythingAvailable
        if ($null -eq $block) {
            [void]$targetedAttributionRows.Add([pscustomobject]@{ Block = 'C'; Name = 'Everything file search'; Status = 'NOT RUN — Everything unavailable'; EverythingEnabled = [bool]$initial.everythingEnabled; EverythingExePresent = $everythingExePresent; EverythingProcessCount = $everythingProcess.Count })
            $outcome = 'inconclusive-everything-unavailable'
            continue
        }
        $blockResult = Invoke-TargetedAttributionBlock -Block $block -Label $blockId -StagePath $StagePath -TargetProcessId $TargetProcessId -ErrorPath $ErrorPath -SamplerJob $SamplerJob -BaselineStage $baselineStage -BaselineHandles $baseline
        $settleStats = Get-TargetedWindowStats -Rows @(Get-TargetedResourceRows | Where-Object { $_.Stage -eq $blockResult.SettleStage }) -Stage $blockResult.SettleStage
        $baseline = [long]$settleStats.HandlesLast10Median
        $baselineStage = [string]$blockResult.SettleStage

        if ($blockResult.StillTrendingUpAfterAdditional60) {
            $outcome = 'inconclusive-still-trending-up-after-120s'
            break
        }
        if ($blockResult.SettledDeltaHandles -gt 0) {
            $repeatLabel = "$blockId-REPEAT"
            $repeatResult = Invoke-TargetedAttributionBlock -Block $block -Label $repeatLabel -StagePath $StagePath -TargetProcessId $TargetProcessId -ErrorPath $ErrorPath -SamplerJob $SamplerJob -BaselineStage $baselineStage -BaselineHandles $baseline
            $repeatSettleStats = Get-TargetedWindowStats -Rows @(Get-TargetedResourceRows | Where-Object { $_.Stage -eq $repeatResult.SettleStage }) -Stage $repeatResult.SettleStage
            $baseline = [long]$repeatSettleStats.HandlesLast10Median
            $baselineStage = [string]$repeatResult.SettleStage
            if ($repeatResult.StillTrendingUpAfterAdditional60) {
                $outcome = 'inconclusive-repeat-still-trending-up'
                break
            }
            if ($repeatResult.SettledDeltaHandles -gt 0) {
                $outcome = 'repeatable-retained-handle-growth'
                break
            }
        }
    }

    $attributionManifest.endedAt = [DateTimeOffset]::Now.ToString('o')
    $attributionManifest.result = $outcome
    $attributionManifest.blocks = @($targetedAttributionRows)
    $attributionManifest.managedCheckpointCsv = [IO.Path]::GetFileName($managedOutputPath)
    $attributionManifest.resourceCsv = [IO.Path]::GetFileName($outputPath)
    $attributionManifest.samplerErrorArtifact = [IO.Path]::GetFileName($ErrorPath)
    $attributionManifest | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $manifestPath -Encoding utf8
    Write-Host "Targeted attribution manifest: $manifestPath"
    Write-Host "Targeted attribution outcome: $outcome"
}

function Invoke-ResourceTestWorkload {
    param(
        [long] $WindowHandle,
        [string] $StagePath,
        [int] $TargetProcessId,
        [string] $ErrorPath,
        [System.Management.Automation.Job] $SamplerJob
    )

    if ($TargetedAttribution) {
        Invoke-TargetedAttributionWorkload -StagePath $StagePath -TargetProcessId $TargetProcessId -ErrorPath $ErrorPath -SamplerJob $SamplerJob
        return
    }
    if ($Phase4G2) {
        Invoke-Phase4G2Workload -StagePath $StagePath -TargetProcessId $TargetProcessId -ErrorPath $ErrorPath -SamplerJob $SamplerJob
        return
    }
    if ($Phase4G2Remaining) {
        Invoke-Phase4G2Workload -StagePath $StagePath -TargetProcessId $TargetProcessId -ErrorPath $ErrorPath -SamplerJob $SamplerJob -Remaining
        return
    }

    $queries = Get-ResourceQueryCorpus
    $functionKey = (ConvertFrom-ResourceHotkey -Shortcut $TestHotkey).VirtualKey
    $driver = if ($NoUIA) { 'Dispatcher-pipe-real-WPF-no-UIA' } else { 'UIAutomation-ValuePattern-real-WPF' }
    Write-Host "Automated $driver workload; test hotkey=$TestHotkey. Corpus: $($queries -join ' | ')"
    Write-Host 'All queries set the actual WPF QueryBox and traverse its normal TextChanged, SearchCore/Everything, result binding, and icon path. No result, website, Manager, or translation action is activated.'
    Wait-AutomatedSeconds -Seconds 30 -StagePath $StagePath -Stage "$ScenarioName-IDLE" -TargetProcessId $TargetProcessId -ErrorPath $ErrorPath -SamplerJob $SamplerJob
    Add-ManagedSnapshot -Stage "$ScenarioName-IDLE"

    if ($NoUIA) {
        Invoke-ResourceDriverHotkey -ExpectedVisible $true -TargetProcessId $TargetProcessId -ErrorPath $ErrorPath -SamplerJob $SamplerJob
        for ($round = 1; $round -le $RepeatedRounds; $round++) {
            $roundLabel = "A-R$round"
            for ($queryIndex = 0; $queryIndex -lt 1000; $queryIndex++) {
                $query = $queries[$queryIndex % $queries.Count]
                Assert-AutomatedRuntimeHealthy -TargetProcessId $TargetProcessId -ErrorPath $ErrorPath -SamplerJob $SamplerJob
                $presentation = Send-ResourceControlCommand -Pipe $resourcePipe -Command @{ type = 'query'; query = $query }
                if ([int]$presentation.processId -ne $TargetProcessId -or [string]$presentation.query -cne $query -or -not [bool]$presentation.windowVisible) {
                    throw "No-UIA real-WPF query did not present the exact visible query '$query'."
                }
                if ([int]$presentation.resultCount -eq 0 -and [string]::IsNullOrWhiteSpace([string]$presentation.status)) {
                    throw "No-UIA real-WPF query '$query' produced neither visible result rows nor a status message."
                }

                if ((($queryIndex + 1) % 100) -eq 0) {
                    $count = $queryIndex + 1
                    $stage = "$roundLabel-$count"
                    Set-StressStage -StagePath $StagePath -Stage $stage
                    Write-Host "$roundLabel completed $count/1000 real WPF QueryBox updates. Results=$($presentation.resultCount); realized=$($presentation.realizedResultCount); icons=$($presentation.iconCount)"
                    Add-ManagedSnapshot -Stage $stage
                    Wait-AutomatedSeconds -Seconds 2 -StagePath $StagePath -Stage $stage -TargetProcessId $TargetProcessId -ErrorPath $ErrorPath -SamplerJob $SamplerJob
                }
            }

            Invoke-ResourceDriverHotkey -ExpectedVisible $false -TargetProcessId $TargetProcessId -ErrorPath $ErrorPath -SamplerJob $SamplerJob
            $settleStage = "$roundLabel-SETTLE"
            Wait-AutomatedSeconds -Seconds 60 -StagePath $StagePath -Stage $settleStage -TargetProcessId $TargetProcessId -ErrorPath $ErrorPath -SamplerJob $SamplerJob
            Add-ManagedSnapshot -Stage $settleStage
            if ($round -lt $RepeatedRounds) {
                Invoke-ResourceDriverHotkey -ExpectedVisible $true -TargetProcessId $TargetProcessId -ErrorPath $ErrorPath -SamplerJob $SamplerJob
            }
        }

        for ($cycle = 1; $cycle -le 300; $cycle++) {
            Invoke-ResourceDriverHotkey -ExpectedVisible $true -TargetProcessId $TargetProcessId -ErrorPath $ErrorPath -SamplerJob $SamplerJob
            Invoke-ResourceDriverHotkey -ExpectedVisible $false -TargetProcessId $TargetProcessId -ErrorPath $ErrorPath -SamplerJob $SamplerJob
            if (($cycle % 50) -eq 0) {
                $stage = "A-HOTKEY-$cycle"
                Set-StressStage -StagePath $StagePath -Stage $stage
                Write-Host "Completed $cycle/300 registered test-hotkey show/hide cycles."
                Add-ManagedSnapshot -Stage $stage
                Wait-AutomatedSeconds -Seconds 2 -StagePath $StagePath -Stage $stage -TargetProcessId $TargetProcessId -ErrorPath $ErrorPath -SamplerJob $SamplerJob
            }
        }
        Wait-AutomatedSeconds -Seconds 60 -StagePath $StagePath -Stage 'A-HOTKEY-SETTLE' -TargetProcessId $TargetProcessId -ErrorPath $ErrorPath -SamplerJob $SamplerJob
        Add-ManagedSnapshot -Stage 'A-HOTKEY-SETTLE'
        return
    }

    Invoke-RegisteredLauncherHotkey -WindowHandle $WindowHandle -ExpectedVisible $true -TargetProcessId $TargetProcessId -ErrorPath $ErrorPath -SamplerJob $SamplerJob
    $initialPresentation = Get-AutomatedQueryPresentation -WindowHandle $WindowHandle
    if (-not $initialPresentation.QueryHasKeyboardFocus) {
        throw 'The registered test hotkey showed the window, but the actual WPF QueryBox did not receive keyboard focus.'
    }

    for ($queryIndex = 0; $queryIndex -lt 1000; $queryIndex++) {
        $query = $queries[$queryIndex % $queries.Count]
        Assert-AutomatedRuntimeHealthy -TargetProcessId $TargetProcessId -ErrorPath $ErrorPath -SamplerJob $SamplerJob
        if (-not [Phase4EAutomationInterop]::IsVisible($WindowHandle)) {
            throw 'Launcher unexpectedly hid during the UI Automation search workload.'
        }
        $queryElement = Get-AutomationElementById -WindowHandle $WindowHandle -AutomationId 'QueryBox'
        if ($null -eq $queryElement) { throw 'The real WPF QueryBox disappeared during the UI Automation workload.' }
        $queryPattern = $queryElement.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
        $queryPattern.SetValue($query)
        $null = Wait-AutomatedQueryUpdate -WindowHandle $WindowHandle -ExpectedQuery $query -WaitForEverything ($query.StartsWith('file:', [StringComparison]::OrdinalIgnoreCase)) -TargetProcessId $TargetProcessId -ErrorPath $ErrorPath -SamplerJob $SamplerJob

        if ((($queryIndex + 1) % 100) -eq 0) {
            $count = $queryIndex + 1
            $stage = "B-$count"
            Set-StressStage -StagePath $StagePath -Stage $stage
            Write-Host "UIA completed $count/1000 real WPF QueryBox updates."
            Add-ManagedSnapshot -Stage $stage
            Wait-AutomatedSeconds -Seconds 2 -StagePath $StagePath -Stage $stage -TargetProcessId $TargetProcessId -ErrorPath $ErrorPath -SamplerJob $SamplerJob
        }
    }

    Invoke-RegisteredLauncherHotkey -WindowHandle $WindowHandle -ExpectedVisible $false -TargetProcessId $TargetProcessId -ErrorPath $ErrorPath -SamplerJob $SamplerJob
    Wait-AutomatedSeconds -Seconds 60 -StagePath $StagePath -Stage 'B-SETTLE' -TargetProcessId $TargetProcessId -ErrorPath $ErrorPath -SamplerJob $SamplerJob
    Add-ManagedSnapshot -Stage 'B-SETTLE'
}

function Invoke-Stress {
    $nativeProcesses = @(Get-NativeHostProcesses)
    if ($Automated -or $NoUIA) {
        if ($nativeProcesses.Count -ne $ExpectedNativeHostCount -or $TargetProcessId -notin @($nativeProcesses.Id)) {
            $ids = if ($nativeProcesses.Count -gt 0) { $nativeProcesses.Id -join ', ' } else { 'none' }
            throw "Isolated driver stress requires $ExpectedNativeHostCount NativeHost process(es) including PID $TargetProcessId (found: $ids)."
        }
        $nativeProcess = Get-Process -Id $TargetProcessId -ErrorAction Stop
    }
    else {
        if ($nativeProcesses.Count -ne 1) {
            throw "Stress mode requires exactly one already-running NativeHost (found $($nativeProcesses.Count)). Start the installed Phase 4E build manually, leave it running, then start the sampler again. The sampler will not start or stop WebTools."
        }
        $nativeProcess = $nativeProcesses[0]
    }

    $managerCount = Get-ManagerProcessCount
    if ($managerCount -ne 0) {
        throw "Stress must begin with Electron/WebTools Manager closed; current process count is $managerCount."
    }

    $launcherWindowHandle = 0L
    if ($Automated -or $NoUIA) {
        if (-not (Test-Path -LiteralPath $statePath)) {
            throw "Automated mode requires the isolated test profile at $statePath."
        }
        if ($Automated) {
            $windowHandles = @([Phase4EAutomationInterop]::FindLauncherWindows($TargetProcessId))
            if ($windowHandles.Count -ne 1) {
                throw "UI Automation mode expected one WebTools Native Launcher HWND for PID $TargetProcessId, found $($windowHandles.Count). No process was changed."
            }
            $launcherWindowHandle = [long]$windowHandles[0]
            if ([Phase4EAutomationInterop]::IsVisible($launcherWindowHandle)) {
                throw 'Automated mode requires the isolated test Launcher to start hidden.'
            }
        }
    }

    $driverDescription = if ($TargetedAttribution) { 'Phase 4G-2 targeted no-UIA real WPF isolated test host' } elseif ($Phase4G2Remaining) { 'Phase 4G-2 remaining no-UIA real WPF isolated test host' } elseif ($Phase4G2) { 'Phase 4G-2 no-UIA real WPF isolated test host' } elseif ($NoUIA) { 'no-UIA real WPF dispatcher test host' } elseif ($Automated) { 'UI Automation real WPF test host' } else { 'user-operated installed NativeHost' }
    Write-Host "Sampling $driverDescription PID $($nativeProcess.Id); expected NativeHost count=$ExpectedNativeHostCount, Electron count=0."
    Write-Host ""
    $stagePath = Join-Path $OutputDirectory ("{0}-stress-stage-{1}.txt" -f $artifactPrefix, $runStamp)
    $stopPath = Join-Path $OutputDirectory ("{0}-stress-stop-{1}.txt" -f $artifactPrefix, $runStamp)
    $errorPath = Join-Path $OutputDirectory ("{0}-stress-error-{1}.txt" -f $artifactPrefix, $runStamp)
    Remove-Item -LiteralPath $stagePath, $stopPath, $errorPath -Force -ErrorAction SilentlyContinue
    Set-StressStage -StagePath $stagePath -Stage 'IDLE-START'

    $jobScript = {
        param(
            [string] $CsvPath,
            [string] $StagePath,
            [string] $StopPath,
            [string] $ErrorPath,
            [int] $NativeProcessId,
            [int] $IntervalSeconds,
            [string] $Driver,
            [string] $Scenario,
            [int] $Run,
            [int] $ExpectedNativeCount
        )

        $ErrorActionPreference = 'Stop'
        Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class Phase4EStressSamplerInterop
{
    [DllImport("user32.dll", SetLastError = true)]
    public static extern uint GetGuiResources(IntPtr processHandle, uint flags);
}
'@ -ErrorAction SilentlyContinue

        function ConvertTo-CsvField {
            param([object] $Value)
            if ($null -eq $Value) { return '""' }
            $text = [Convert]::ToString($Value, [Globalization.CultureInfo]::InvariantCulture)
            return '"' + $text.Replace('"', '""') + '"'
        }

        $writer = $null
        try {
            $writer = [System.IO.StreamWriter]::new($CsvPath, $false, [System.Text.UTF8Encoding]::new($true))
            $writer.WriteLine('Scenario,Run,Stage,Timestamp,ProcessName,PID,ProcessPresent,PrivateBytes,WorkingSet,GDI,USER,Handles,Threads,ElectronProcessCount,NativeHostCount,WorkloadDriver')
            while (-not (Test-Path -LiteralPath $StopPath)) {
                $clock = [System.Diagnostics.Stopwatch]::StartNew()
                $stage = 'UNMARKED'
                try {
                    $stage = [System.IO.File]::ReadAllText($StagePath).Trim()
                    if ([string]::IsNullOrWhiteSpace($stage)) { $stage = 'STAGE-READ-EMPTY' }
                }
                catch {
                    $stage = 'STAGE-READ-FAILED'
                }

                $nativeCount = @(Get-Process -Name 'WebTools.NativeHost' -ErrorAction SilentlyContinue).Count
                $electronCount = @(Get-Process -Name 'WebTools' -ErrorAction SilentlyContinue).Count
                $present = $false
                $privateBytes = $null
                $workingSet = $null
                $gdi = $null
                $user = $null
                $handles = $null
                $threads = $null
                $processName = 'WebTools.NativeHost'
                try {
                    $process = Get-Process -Id $NativeProcessId -ErrorAction Stop
                    $present = $true
                    $processName = $process.ProcessName
                    $privateBytes = [long]$process.PrivateMemorySize64
                    $workingSet = [long]$process.WorkingSet64
                    $handles = [long]$process.HandleCount
                    $threads = [int]$process.Threads.Count
                    try { $gdi = [long][Phase4EStressSamplerInterop]::GetGuiResources($process.Handle, 0) } catch { }
                    try { $user = [long][Phase4EStressSamplerInterop]::GetGuiResources($process.Handle, 1) } catch { }
                }
                catch {
                    $present = $false
                }

                $healthFailure = $null
                if ($nativeCount -ne $ExpectedNativeCount) { $healthFailure = "Expected $ExpectedNativeCount NativeHost process(es); found $nativeCount." }
                elseif (-not $present) { $healthFailure = "NativeHost PID $NativeProcessId disappeared." }
                elseif ($electronCount -ne 0) { $healthFailure = "Unexpected Electron/Manager process count $electronCount." }
                if ($null -ne $healthFailure) {
                    [System.IO.File]::WriteAllText($ErrorPath, $healthFailure, [System.Text.Encoding]::UTF8)
                }

                $values = @(
                    $Scenario, $Run, $stage, [DateTimeOffset]::Now.ToString('o'),
                    $processName, $NativeProcessId, $present, $privateBytes,
                    $workingSet, $gdi, $user, $handles, $threads, $electronCount, $nativeCount, $Driver
                )
                $line = (($values | ForEach-Object { ConvertTo-CsvField $_ }) -join ',')
                $writer.WriteLine($line)
                $writer.Flush()
                if ($null -ne $healthFailure) { break }

                $remainingMilliseconds = [int][Math]::Max(0, ($IntervalSeconds * 1000) - $clock.ElapsedMilliseconds)
                if ($remainingMilliseconds -gt 0) {
                    Start-Sleep -Milliseconds $remainingMilliseconds
                }
            }
        }
        finally {
            if ($null -ne $writer) { $writer.Dispose() }
        }
    }

    $driverName = if ($TargetedAttribution) { 'Phase4G2-targeted-real-WPF-no-UIA-pipe' } elseif ($Phase4G2Remaining) { 'Phase4G2-remaining-real-WPF-no-UIA-pipe' } elseif ($Phase4G2) { 'Phase4G2-real-WPF-no-UIA-pipe' } elseif ($NoUIA) { 'Dispatcher-pipe-real-WPF-no-UIA' } elseif ($Automated) { 'UIAutomation-ValuePattern-real-WPF' } else { 'user-operated-real-WPF' }
    $samplerExpectedNativeHostCount = if ($CollectorErrorProbe) { $ExpectedNativeHostCount + 1 } else { $ExpectedNativeHostCount }
    $job = Start-Job -ScriptBlock $jobScript -ArgumentList @($outputPath, $stagePath, $stopPath, $errorPath, $nativeProcess.Id, $SampleIntervalSeconds, $driverName, $ScenarioName, $RunNumber, $samplerExpectedNativeHostCount)
    try {
        Start-Sleep -Seconds 2
        if ($CollectorErrorProbe) {
            $probeCompletion = Wait-Job -Job $job -Timeout 15
            if ($null -eq $probeCompletion) { throw 'The controlled sampler-error probe did not finish after recording its expected mismatch.' }
            Receive-Job -Job $job -ErrorAction Continue | Out-Host
        }
        elseif ($job.State -ne 'Running') {
            Receive-Job -Job $job -ErrorAction Continue | Out-Host
            throw 'The stress sampler background job did not start.'
        }
        Write-Host ""
        Write-Host "Sampling PID $($nativeProcess.Id) every $SampleIntervalSeconds second(s). CSV is written outside the repository."
        if ($CollectorErrorProbe) {
            Write-Host 'Controlled collector error probe: the sampler is expected to stop after persisting its deliberate process-count mismatch.'
        }
        elseif ($Automated -or $NoUIA) {
            Invoke-ResourceTestWorkload -WindowHandle $launcherWindowHandle -StagePath $stagePath -TargetProcessId $nativeProcess.Id -ErrorPath $errorPath -SamplerJob $job
        }
        else {
            Wait-StressSeconds -Seconds 30 -StagePath $stagePath -Stage 'IDLE-START'

            for ($batch = 1; $batch -le 10; $batch++) {
                $searchCount = $batch * 100
                $label = 'SEARCH-BATCH-{0:D2}' -f $batch
                $instruction = 'Perform 100 distinct query updates in the real WPF QueryBox; after each replacement, wait for the result list to update. Rotate normal app names, Chinese/pinyin/initials, saved website names or URL fragments, ?test, /bili, and file:filename. Reusing representative queries is allowed. Use normal keyboard input (for example Ctrl+A then type); no harness. Leave the Launcher hidden when the batch ends.'
                Invoke-UserWorkloadBatch -StagePath $stagePath -Stage $label -Instruction $instruction -CheckpointStage ("SEARCH-{0}" -f $searchCount)
            }
            Set-StressStage -StagePath $stagePath -Stage 'SEARCH-POST-1000'
            Start-Sleep -Seconds ([Math]::Max(2, $SampleIntervalSeconds + 1))
            Wait-StressSeconds -Seconds 60 -StagePath $stagePath -Stage 'SEARCH-1000-SETTLE-60'
            Set-StressStage -StagePath $stagePath -Stage 'SEARCH-FINAL-SETTLE'
            Start-Sleep -Seconds ([Math]::Max(2, $SampleIntervalSeconds + 1))

            for ($batch = 1; $batch -le 6; $batch++) {
                $cycleCount = $batch * 50
                $label = 'HOTKEY-BATCH-{0:D2}' -f $batch
                $instruction = 'Perform 50 show/hide cycles using the registered WebTools global hotkey: press once to show and again to hide. Do not use tray actions or call internal methods. Leave the Launcher hidden at the end of the batch.'
                Invoke-UserWorkloadBatch -StagePath $stagePath -Stage $label -Instruction $instruction -CheckpointStage ("HOTKEY-{0}" -f $cycleCount)
            }
            Set-StressStage -StagePath $stagePath -Stage 'HOTKEY-POST-300'
            Start-Sleep -Seconds ([Math]::Max(2, $SampleIntervalSeconds + 1))
            Wait-StressSeconds -Seconds 60 -StagePath $stagePath -Stage 'HOTKEY-SETTLE-60'
            Set-StressStage -StagePath $stagePath -Stage 'HOTKEY-FINAL-SETTLE'
            Start-Sleep -Seconds ([Math]::Max(2, $SampleIntervalSeconds + 1))
        }
    }
    catch {
        $stillSafeToRestoreHidden = @(Get-NativeHostProcesses).Count -eq $ExpectedNativeHostCount -and $TargetProcessId -in @((Get-NativeHostProcesses).Id) -and (Get-ManagerProcessCount) -eq 0
        if (($Automated -or $NoUIA) -and $stillSafeToRestoreHidden) {
            try {
                if ($Phase4G2 -or $Phase4G2Remaining -or $TargetedAttribution) {
                    $state = Send-ResourceControlCommand -Pipe $resourcePipe -Command @{ type = 'state' }
                    if ([bool]$state.windowVisible) { $null = Send-ResourceControlCommand -Pipe $resourcePipe -Command @{ type = 'hide' } }
                }
                elseif ($NoUIA) {
                    $state = Send-ResourceControlCommand -Pipe $resourcePipe -Command @{ type = 'state' }
                    if ([bool]$state.windowVisible) {
                        Invoke-ResourceDriverHotkey -ExpectedVisible $false -TargetProcessId $nativeProcess.Id -ErrorPath $errorPath -SamplerJob $job
                    }
                }
                elseif ($launcherWindowHandle -ne 0 -and [Phase4EAutomationInterop]::IsVisible($launcherWindowHandle)) {
                    [Phase4EAutomationInterop]::SendRegisteredTestHotkey((ConvertFrom-ResourceHotkey -Shortcut $TestHotkey).VirtualKey)
                    $deadline = [DateTimeOffset]::Now.AddSeconds(2)
                    while ([DateTimeOffset]::Now -lt $deadline -and [Phase4EAutomationInterop]::IsVisible($launcherWindowHandle)) { Start-Sleep -Milliseconds 100 }
                }
            }
            catch { Write-Warning 'The automated run stopped; it could not restore the Launcher to hidden state. The NativeHost process was left running.' }
        }
        throw
    }
    finally {
        $samplerStopped = $true
        [System.IO.File]::WriteAllText($stopPath, 'STOP', [System.Text.Encoding]::ASCII)
        if ($null -ne $job) {
            $completedJob = Wait-Job -Job $job -Timeout 15
            Receive-Job -Job $job -ErrorAction Continue | Out-Host
            if ($null -ne $completedJob) {
                Remove-Job -Job $job -ErrorAction SilentlyContinue
            }
            else {
                $samplerStopped = $false
                Write-Warning 'The sampler did not confirm graceful shutdown within 15 seconds; the stop signal was written. No WebTools process was touched.'
            }
        }
        if ($Phase4G2 -or $Phase4G2Remaining -or $TargetedAttribution) {
            Remove-Item -LiteralPath $stagePath, $stopPath -Force -ErrorAction SilentlyContinue
            if (-not $samplerStopped) {
                Write-Host "Sampler job did not stop in time; leaving its error artifact path untouched: $errorPath"
            }
            elseif ((Test-Path -LiteralPath $errorPath -PathType Leaf) -and (Get-Item -LiteralPath $errorPath).Length -gt 0) {
                Write-Host "Phase 4G-2 sampler error evidence preserved: $errorPath"
            }
            else {
                Remove-Item -LiteralPath $errorPath -Force -ErrorAction SilentlyContinue
            }
        }
        else {
            Remove-Item -LiteralPath $stagePath, $stopPath, $errorPath -Force -ErrorAction SilentlyContinue
        }
    }

    if (-not (Test-Path -LiteralPath $outputPath)) {
        throw 'The stress sampler did not create its CSV output.'
    }
    $samples = @(Import-Csv -LiteralPath $outputPath)
    Write-Host ""
    Write-Host "Stress CSV: $outputPath"
    Write-Host ("Samples: {0}; NativeHost PID: {1}; absent samples: {2}" -f $samples.Count, $nativeProcess.Id, @($samples | Where-Object { $_.ProcessPresent -ne 'True' }).Count)

    if ($TargetedAttribution) {
        $requiredColumns = @('Stage','Timestamp','PID','ProcessPresent','PrivateBytes','WorkingSet','GDI','USER','Handles','Threads','ElectronProcessCount','NativeHostCount','WorkloadDriver')
        if ($samples.Count -eq 0) { throw 'Targeted attribution collector CSV is empty.' }
        $actualColumns = @($samples[0].PSObject.Properties.Name)
        $missingColumns = @($requiredColumns | Where-Object { $_ -notin $actualColumns })
        if ($missingColumns.Count -gt 0) { throw "Targeted attribution collector CSV is missing columns: $($missingColumns -join ', ')." }
        foreach ($sample in $samples) {
            $parsedTimestamp = [DateTimeOffset]::MinValue
            if (-not [DateTimeOffset]::TryParse([string]$sample.Timestamp, [ref]$parsedTimestamp) -or
                [string]::IsNullOrWhiteSpace([string]$sample.Stage) -or
                [int]$sample.PID -ne $nativeProcess.Id -or
                [string]$sample.ProcessPresent -ne 'True' -or
                [long]$sample.PrivateBytes -le 0 -or
                [long]$sample.WorkingSet -le 0 -or
                [long]$sample.Handles -le 0 -or
                [int]$sample.Threads -le 0 -or
                [string]::IsNullOrWhiteSpace([string]$sample.GDI) -or
                [string]::IsNullOrWhiteSpace([string]$sample.USER) -or
                [long]$sample.GDI -lt 0 -or [long]$sample.GDI -gt 100000 -or
                [long]$sample.USER -lt 0 -or [long]$sample.USER -gt 100000) {
                throw "Targeted attribution collector produced an invalid or implausible sample at stage '$($sample.Stage)'."
            }
        }
        Write-Host 'Collector CSV validation passed: timestamps, stages, PID, Private Bytes, Working Set, GDI, USER, Handles, and Threads are populated and within plausible bounds.'
    }

    if ($CollectorErrorProbe) {
        if (-not (Test-Path -LiteralPath $errorPath -PathType Leaf) -or (Get-Item -LiteralPath $errorPath).Length -eq 0) {
            throw 'The controlled collector error probe did not preserve a non-empty sampler error artifact.'
        }
        $errorEvidence = Get-Content -Raw -LiteralPath $errorPath
        if ($errorEvidence -notmatch [regex]::Escape("Expected $($ExpectedNativeHostCount + 1) NativeHost process(es)")) {
            throw "The persisted sampler error did not contain the deliberately injected expected-count mismatch: $errorEvidence"
        }
        if ($samples.Count -lt 1) { throw 'The controlled sampler error probe did not persist the sample written before the error.' }
        $probeRecord = [ordered]@{
            result = 'PASS — sampler error evidence survives job completion and cleanup'
            csvPath = $outputPath
            errorPath = $errorPath
            sampleCount = $samples.Count
            targetPid = $nativeProcess.Id
            injectedExpectedNativeHostCount = $ExpectedNativeHostCount + 1
            actualNativeHostCount = [int]$samples[0].NativeHostCount
            error = $errorEvidence.Trim()
            checkedAt = [DateTimeOffset]::Now.ToString('o')
        }
        $probePath = Join-Path $OutputDirectory ("phase4g2-attribution-collector-error-probe-{0}-{1}.json" -f $safeScenarioName, $runStamp)
        $probeRecord | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $probePath -Encoding utf8
        Write-Host "Collector error persistence PASS; error artifact retained: $errorPath"
        Write-Host "Collector error probe record: $probePath"
    }

    if ($Automated -or $NoUIA) {
        $invalidSamples = @($samples | Where-Object {
            $_.PID -ne [string]$nativeProcess.Id -or
            $_.ProcessPresent -ne 'True' -or
            $_.NativeHostCount -ne [string]$ExpectedNativeHostCount -or
            $_.ElectronProcessCount -ne '0' -or
            $_.WorkloadDriver -ne $driverName
        })
        if ($invalidSamples.Count -gt 0) {
            throw "Automated stress contains $($invalidSamples.Count) unsafe or incomplete process samples. The CSV is preserved outside Git."
        }

        if ($CollectorErrorProbe) {
            $requiredStages = @()
        }
        elseif ($TargetedAttribution) {
            $requiredStages = @($targetedAttributionStages)
        }
        elseif ($Phase4G2Remaining) {
            $requiredStages = @('G2-BC-IDLE-30','G2-B-SETTLE-60','G2-C-SETTLE-60','G2-C-POST-TRANSITIONS')
            $requiredStages += @(50..300 | Where-Object { $_ % 50 -eq 0 } | ForEach-Object { "G2-B-CHECKPOINT-$_" })
        }
        elseif ($Phase4G2) {
            $requiredStages = @('G2-IDLE-30','G2-A-R1-SETTLE-60','G2-A-R2-SETTLE-60','G2-A-R3-SETTLE-60','G2-B-SETTLE-60','G2-C-SETTLE-60')
            foreach ($round in 1..3) { $requiredStages += @(100..1000 | Where-Object { $_ % 100 -eq 0 } | ForEach-Object { "G2-A-R$round-$_" }) }
            $requiredStages += @(50..300 | Where-Object { $_ % 50 -eq 0 } | ForEach-Object { "G2-B-CHECKPOINT-$_" })
            $requiredStages += 'G2-C-POST-TRANSITIONS'
        }
        elseif ($NoUIA) {
            $requiredStages = @('A-IDLE','A-HOTKEY-50','A-HOTKEY-100','A-HOTKEY-150','A-HOTKEY-200','A-HOTKEY-250','A-HOTKEY-300','A-HOTKEY-SETTLE')
            for ($round = 1; $round -le $RepeatedRounds; $round++) {
                $roundPrefix = "A-R$round"
                $requiredStages += @("$roundPrefix-SETTLE")
                $requiredStages += @(100..1000 | Where-Object { $_ % 100 -eq 0 } | ForEach-Object { "$roundPrefix-$_" })
            }
        }
        else { $requiredStages = @('B-IDLE') + @(100..1000 | Where-Object { $_ % 100 -eq 0 } | ForEach-Object { "B-$_" }) + @('B-SETTLE') }
        $sampledStages = @($samples | Select-Object -ExpandProperty Stage -Unique)
        $missingStages = @($requiredStages | Where-Object { $_ -notin $sampledStages })
        if ($missingStages.Count -gt 0) {
            throw "Automated stress did not capture required checkpoints: $($missingStages -join ', '). The CSV is preserved outside Git."
        }

        if ($WarmRepetition) {
            $persistedManagedRows = @(Import-Csv -LiteralPath $managedOutputPath)
            $warmupPresented = @($persistedManagedRows | Where-Object { $_.Stage -eq 'ATTR-WARMUP-PRESENTED' })
            $warmupHidden = @($persistedManagedRows | Where-Object { $_.Stage -eq 'ATTR-WARMUP-HIDDEN' })
            if ($warmupPresented.Count -ne 1 -or $warmupHidden.Count -ne 1) {
                throw 'Warm repetition managed checkpoints must contain exactly one presented and one hidden warm-up snapshot.'
            }
            if ([long]$warmupPresented[0].WindowHandle -ne $script:targetedWindowHandle -or
                [string]$warmupPresented[0].WindowVisible -ne 'True' -or
                [int]$warmupPresented[0].ResultCount -le 0 -or
                [int]$warmupPresented[0].RealizedResultCount -le 0 -or
                [long]$warmupHidden[0].WindowHandle -ne $script:targetedWindowHandle -or
                [string]$warmupHidden[0].WindowVisible -ne 'False' -or
                [string]$warmupHidden[0].Query -cne '' -or
                [int]$warmupHidden[0].ResultCount -ne 0 -or
                [int]$warmupHidden[0].RealizedResultCount -ne 0) {
                throw 'Warm repetition managed checkpoints did not preserve the expected same-HWND presentation and cleared-hidden states.'
            }
        }

        Write-Host "Automated process-safety checks passed for every sample; required checkpoints were captured (driver=$driverName)."
        Write-Host 'This verifies workload completion and sampling continuity only; review the resource trend before deciding whether the plateau gate passes.'
    }

    if ($managedRows.Count -gt 0) {
        $managedRows | Export-Csv -LiteralPath $managedOutputPath -NoTypeInformation -Encoding UTF8
        Write-Host "Managed heap/checkpoint CSV: $managedOutputPath"
    }

    if ($ExitTestHost) {
        $exitReply = Send-ResourceControlCommand -Pipe $resourcePipe -Command @{ type = 'exit' }
        if ($exitReply.type -ne 'exit' -or -not (Wait-ForProcessExit -TargetProcessId $nativeProcess.Id)) {
            throw "The isolated NativeHost PID $($nativeProcess.Id) did not close normally through its test control pipe."
        }
        Write-Host "Isolated test NativeHost PID $($nativeProcess.Id) closed normally through the explicit test-only control command."
    }

    foreach ($batchPrefix in @('SEARCH-', 'HOTKEY-', 'A-R1-', 'A-R2-', 'A-R3-', 'A-HOTKEY-', 'B-', 'G2-A-R1-', 'G2-A-R2-', 'G2-A-R3-', 'G2-B-CHECKPOINT-', 'G2-C-CYCLE-')) {
        Write-Host ""
        Write-Host "$batchPrefix checkpoint trend (latest sample at each workload count):"
        $escapedPrefix = [regex]::Escape($batchPrefix)
        $batchRows = @($samples | Where-Object { $_.Stage -match "^$escapedPrefix\d+$" } | Group-Object Stage | Sort-Object { if ($_.Name -match '(\d+)$') { [int]$Matches[1] } else { 0 } })
        foreach ($batchRow in $batchRows) {
            $sample = $batchRow.Group | Sort-Object Timestamp | Select-Object -Last 1
            Write-Host ("  {0}: Private={1}; WS={2}; GDI={3}; USER={4}; Handles={5}; Threads={6}; Electron={7}" -f $sample.Stage, $sample.PrivateBytes, $sample.WorkingSet, $sample.GDI, $sample.USER, $sample.Handles, $sample.Threads, $sample.ElectronProcessCount)
        }
    }
    Write-Host 'Review the complete time series; a single peak or one-time allocation increase is not a leak verdict.'
    if ($null -ne $resourcePipe) { $resourcePipe.Client.Dispose(); $resourcePipe = $null }
}

try {
    if ($Mode -eq 'Baseline') {
        Invoke-Baseline
    }
    else {
        Invoke-Stress
    }
}
finally {
    if ($null -ne $resourcePipe) { $resourcePipe.Client.Dispose() }
}
