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

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class Phase4EResourceSamplerInterop
{
    [DllImport("user32.dll", SetLastError = true)]
    public static extern uint GetGuiResources(IntPtr processHandle, uint flags);

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
$outputPath = Join-Path $OutputDirectory ("phase4e-resource-{0}-{1}-{2}-{3}.csv" -f $Mode.ToLowerInvariant(), $safeScenarioName, $RunNumber, $runStamp)
$managedOutputPath = Join-Path $OutputDirectory ("phase4e-managed-{0}-{1}-{2}.csv" -f $safeScenarioName, $RunNumber, $runStamp)
$managedRows = [System.Collections.Generic.List[object]]::new()
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
    param([string] $Stage)
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

function Get-ResourceQueryCorpus {
    $searchChar = [string]([char]0x6D4B) + [string]([char]0x8BD5)
    $wechat = [string]([char]0x5FAE) + [string]([char]0x4FE1)
    $controlPanel = [string]([char]0x63A7) + [string]([char]0x5236) + [string]([char]0x9762) + [string]([char]0x677F)
    return @('visual', $wechat, 'weixin', 'wx', 'bilibili', '/bili', '?test', 'file:codex', ('file:' + $searchChar), $controlPanel)
}

function Invoke-ResourceTestWorkload {
    param(
        [long] $WindowHandle,
        [string] $StagePath,
        [int] $TargetProcessId,
        [string] $ErrorPath,
        [System.Management.Automation.Job] $SamplerJob
    )

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

    $driverDescription = if ($NoUIA) { 'no-UIA real WPF dispatcher test host' } elseif ($Automated) { 'UI Automation real WPF test host' } else { 'user-operated installed NativeHost' }
    Write-Host "Sampling $driverDescription PID $($nativeProcess.Id); expected NativeHost count=$ExpectedNativeHostCount, Electron count=0."
    Write-Host ""
    $stagePath = Join-Path $OutputDirectory ("phase4e-stress-stage-{0}.txt" -f $runStamp)
    $stopPath = Join-Path $OutputDirectory ("phase4e-stress-stop-{0}.txt" -f $runStamp)
    $errorPath = Join-Path $OutputDirectory ("phase4e-stress-error-{0}.txt" -f $runStamp)
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

    $driverName = if ($NoUIA) { 'Dispatcher-pipe-real-WPF-no-UIA' } elseif ($Automated) { 'UIAutomation-ValuePattern-real-WPF' } else { 'user-operated-real-WPF' }
    $job = Start-Job -ScriptBlock $jobScript -ArgumentList @($outputPath, $stagePath, $stopPath, $errorPath, $nativeProcess.Id, $SampleIntervalSeconds, $driverName, $ScenarioName, $RunNumber, $ExpectedNativeHostCount)
    try {
        Start-Sleep -Seconds 2
        if ($job.State -ne 'Running') {
            Receive-Job -Job $job -ErrorAction Continue | Out-Host
            throw 'The stress sampler background job did not start.'
        }
        Write-Host ""
        Write-Host "Sampling PID $($nativeProcess.Id) every $SampleIntervalSeconds second(s). CSV is written outside the repository."
        if ($Automated -or $NoUIA) {
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
                if ($NoUIA) {
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
        [System.IO.File]::WriteAllText($stopPath, 'STOP', [System.Text.Encoding]::ASCII)
        if ($null -ne $job) {
            $completedJob = Wait-Job -Job $job -Timeout 15
            Receive-Job -Job $job -ErrorAction Continue | Out-Host
            if ($null -ne $completedJob) {
                Remove-Job -Job $job -ErrorAction SilentlyContinue
            }
            else {
                Write-Warning 'The sampler did not confirm graceful shutdown within 15 seconds; the stop signal was written. No WebTools process was touched.'
            }
        }
        Remove-Item -LiteralPath $stagePath, $stopPath, $errorPath -Force -ErrorAction SilentlyContinue
    }

    if (-not (Test-Path -LiteralPath $outputPath)) {
        throw 'The stress sampler did not create its CSV output.'
    }
    $samples = @(Import-Csv -LiteralPath $outputPath)
    Write-Host ""
    Write-Host "Stress CSV: $outputPath"
    Write-Host ("Samples: {0}; NativeHost PID: {1}; absent samples: {2}" -f $samples.Count, $nativeProcess.Id, @($samples | Where-Object { $_.ProcessPresent -ne 'True' }).Count)

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

        if ($NoUIA) {
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

    foreach ($batchPrefix in @('SEARCH-', 'HOTKEY-', 'A-R1-', 'A-R2-', 'A-R3-', 'A-HOTKEY-', 'B-')) {
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

if ($Mode -eq 'Baseline') {
    Invoke-Baseline
}
else {
    Invoke-Stress
}

if ($null -ne $resourcePipe) { $resourcePipe.Client.Dispose() }
