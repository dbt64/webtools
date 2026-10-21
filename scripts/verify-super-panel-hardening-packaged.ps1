param([Parameter(Mandatory)][string]$Stage, [Parameter(Mandatory)][string]$EvidenceRoot)
$ErrorActionPreference = 'Stop'
$taskTemp = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')
$taskRoot = [IO.Path]::GetFullPath($EvidenceRoot).TrimEnd('\')
if (!$taskRoot.StartsWith($taskTemp + '\', [StringComparison]::OrdinalIgnoreCase) -or !(Test-Path -LiteralPath $taskRoot -PathType Container)) { throw 'Disposable TEMP root required' }
for ($p = $taskRoot; $p.Length -gt $taskTemp.Length; $p = [IO.Path]::GetDirectoryName($p)) {
    if ([IO.File]::GetAttributes($p).HasFlag([IO.FileAttributes]::ReparsePoint)) { throw 'Reparse path rejected' }
}
$Stage = (Resolve-Path -LiteralPath $Stage).Path
if (!(Test-Path -LiteralPath (Join-Path $Stage 'WebTools.NativeHost.exe')) -or !(Test-Path -LiteralPath (Join-Path $Stage 'Manager\resources\app.asar'))) { throw 'Real canonical NativeHost + Manager stage required' }
$metadata = Get-Content -LiteralPath (Join-Path $Stage 'preview-build.json') -Raw | ConvertFrom-Json
if ($metadata.previewName -ne 'WebTools-SuperPanel-Hardening-R2-Preview' -or $metadata.superPanelUxRevision -ne 'superpanel-hardening-r2') { throw 'Wrong preview identity' }
$installParent = Join-Path $taskRoot ('packaged 验收 ' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $installParent | Out-Null
Copy-Item -LiteralPath $Stage -Destination $installParent -Recurse
$install = Join-Path $installParent ([IO.Path]::GetFileName($Stage))
$exe = Join-Path $install 'WebTools.NativeHost.exe'
$profile = Join-Path $installParent 'profile'
New-Item -ItemType Directory -Path $profile | Out-Null
& dotnet (Join-Path $PSScriptRoot '..\native\WebTools.NativeHost.Checks\bin\Release\net10.0-windows\WebTools.NativeHost.Checks.dll') --super-panel-prepare-profile $profile
if ($LASTEXITCODE -ne 0) { throw 'Isolated profile preparation failed' }
$witnesses = @(Get-Process 'WebTools.NativeHost' -ErrorAction SilentlyContinue | Select-Object Id, Path, StartTime)
$pipeName = 'WebTools.NativeHost.Resource.HardeningR2.' + [guid]::NewGuid().ToString('N')
$start = [Diagnostics.ProcessStartInfo]::new($exe)
$start.UseShellExecute = $false; $start.CreateNoWindow = $true
$start.Environment['WEBTOOLS_SUPER_PANEL_ACCEPTANCE'] = '1'
foreach ($arg in @('--phase4e-resource-test', $profile, (Join-Path $profile 'catalog.json'), $pipeName, 'Control+Alt+Shift+F12')) { $start.ArgumentList.Add($arg) }
$hostProcess = [Diagnostics.Process]::Start($start)
$hostCreation = $hostProcess.StartTime
$client = $null; $sampler = $null; $fixtureProcess = $null; $stop = [Threading.CancellationTokenSource]::new()
$samplesPath = Join-Path $installParent 'resources.jsonl'
$result = [ordered]@{ executable = $exe; executableSHA256 = (Get-FileHash -LiteralPath $exe -Algorithm SHA256).Hash; processId = $hostProcess.Id; build = $metadata; rounds = @(); normalExit = $false }
Add-Type -AssemblyName UIAutomationClient
Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public static class SuperPanelSampleNative{[DllImport("user32.dll")]public static extern uint GetGuiResources(IntPtr h,uint f);[DllImport("user32.dll")]public static extern bool SetForegroundWindow(IntPtr h);[DllImport("user32.dll")]public static extern IntPtr GetForegroundWindow();[StructLayout(LayoutKind.Explicit,Size=40)]public struct Input{[FieldOffset(0)]public uint Type;[FieldOffset(8)]public ushort Key;[FieldOffset(12)]public uint Flags;}[DllImport("user32.dll")]static extern uint SendInput(uint n,Input[] i,int s);public static void Select(bool selected){var keys=selected?new[]{new Input{Type=1,Key=17},new Input{Type=1,Key=65},new Input{Type=1,Key=65,Flags=2},new Input{Type=1,Key=17,Flags=2}}:new[]{new Input{Type=1,Key=39},new Input{Type=1,Key=39,Flags=2}};SendInput((uint)keys.Length,keys,40);}}'
try {
    $client = [IO.Pipes.NamedPipeClientStream]::new('.', $pipeName, [IO.Pipes.PipeDirection]::InOut, [IO.Pipes.PipeOptions]::Asynchronous)
    $client.Connect(20000)
    $reader = [IO.StreamReader]::new($client, [Text.UTF8Encoding]::new($false), $false, 4096, $true)
    $writer = [IO.StreamWriter]::new($client, [Text.UTF8Encoding]::new($false), 4096, $true); $writer.AutoFlush = $true
    $ready = $reader.ReadLineAsync().WaitAsync([TimeSpan]::FromSeconds(25)).GetAwaiter().GetResult() | ConvertFrom-Json
    if (!$ready.ok -or $ready.processId -ne $hostProcess.Id -or $hostProcess.MainModule.FileName -ne $exe) { throw 'Target identity mismatch' }
    function Rpc([string]$type, [hashtable]$extra = @{}) {
        $request = @{ type = $type }; foreach ($key in $extra.Keys) { $request[$key] = $extra[$key] }
        $writer.WriteLine(($request | ConvertTo-Json -Compress))
        $reply = $reader.ReadLineAsync().WaitAsync([TimeSpan]::FromSeconds(10)).GetAwaiter().GetResult() | ConvertFrom-Json
        if (!$reply.ok -or $reply.processId -ne $hostProcess.Id) { throw 'Isolated driver command rejected' }
        return $reply
    }
    function ElectronCount {
        return @(Get-CimInstance Win32_Process -Filter "Name='WebTools.exe'" | Where-Object { $_.ExecutablePath -eq (Join-Path $install 'Manager\WebTools.exe') }).Count
    }
    function FocusFixture([IntPtr]$handle) {
        # Focus only the already identity-checked synthetic fixture. Never send keys to another foreground.
        [SuperPanelSampleNative]::SetForegroundWindow($handle) | Out-Null
        if ([SuperPanelSampleNative]::GetForegroundWindow() -ne $handle) {
            try { [System.Windows.Automation.AutomationElement]::FromHandle($handle).SetFocus() } catch { }
        }
        return [SuperPanelSampleNative]::GetForegroundWindow() -eq $handle
    }
    $sampler = Start-ThreadJob -ArgumentList $hostProcess.Id, $exe, $hostCreation.ToUniversalTime().Ticks, $samplesPath, $stop -ScriptBlock {
        param($TargetPid, $Image, $CreationTicks, $Output, $StopSource)
        $lastCpu = $null; $lastAt = $null
        while (!$StopSource.IsCancellationRequested) {
            $process = $null
            try {
                $process = Get-Process -Id $TargetPid -ErrorAction Stop
                if ($process.Path -ne $Image -or $process.StartTime.ToUniversalTime().Ticks -ne $CreationTicks) { throw 'Identity changed' }
                $now = [DateTimeOffset]::UtcNow; $cpu = $process.TotalProcessorTime.TotalMilliseconds
                $percent = if ($null -ne $lastCpu) { 100 * ($cpu - $lastCpu) / ($now - $lastAt).TotalMilliseconds } else { 0 }
                [ordered]@{ utc = $now.ToString('O'); pid = $TargetPid; ws = $process.WorkingSet64; pb = $process.PrivateMemorySize64;
                    handles = $process.HandleCount; threads = $process.Threads.Count; gdi = [SuperPanelSampleNative]::GetGuiResources($process.Handle, 0);
                    user = [SuperPanelSampleNative]::GetGuiResources($process.Handle, 1); cpuOneCorePercent = $percent } | ConvertTo-Json -Compress | Add-Content -LiteralPath $Output
                $lastCpu = $cpu; $lastAt = $now
            } catch { @{ utc = [DateTimeOffset]::UtcNow.ToString('O'); samplingError = $_.Exception.GetType().Name } | ConvertTo-Json -Compress | Add-Content -LiteralPath $Output; break }
            finally { if ($process) { $process.Dispose() } }
            Start-Sleep -Seconds 1
        }
    }
    $initial = Rpc 'super-panel-state'
    if ($initial.panelWindowCount -ne 1 -or (ElectronCount) -ne 0) { throw 'Native-only architecture gate failed' }
    for ($i = 0; $i -lt 30; $i++) { Start-Sleep -Seconds 1; if ($hostProcess.HasExited) { throw 'NativeHost exited during settle' } }
    $result.initialSettleUtc = [DateTimeOffset]::UtcNow.ToString('O')
    if (@(Get-Process Notepad -ErrorAction SilentlyContinue).Count) { throw 'Cannot safely own a new Notepad fixture' }
    $fixtureName = 'super-panel-packaged-fixture-' + [guid]::NewGuid().ToString('N') + '.txt'
    $fixturePath = Join-Path $installParent $fixtureName
    Set-Content -LiteralPath $fixturePath -NoNewline -Value 'Super Panel packaged controlled selection.'
    $fixtureStart = [Diagnostics.ProcessStartInfo]::new('C:\Windows\System32\notepad.exe'); $fixtureStart.UseShellExecute = $false; $fixtureStart.CreateNoWindow = $true
    $fixtureStart.ArgumentList.Add($fixturePath); $launched = [Diagnostics.Process]::Start($fixtureStart)
    $deadline = (Get-Date).AddSeconds(20)
    while ((Get-Date) -lt $deadline) {
        $fixtureProcess = Get-Process Notepad -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle.Contains($fixtureName) } | Select-Object -First 1
        if ($fixtureProcess) { break }; Start-Sleep -Milliseconds 100
    }
    if (!$fixtureProcess) { throw 'Owned fixture not ready' }
    $fixtureCreation = $fixtureProcess.StartTime; $fixtureImage = $fixtureProcess.Path
    $panelHandle = 0
    for ($i = 0; $i -lt 30; $i++) {
        $fixtureProcess.Refresh()
        if ($fixtureProcess.Path -ne $fixtureImage -or $fixtureProcess.StartTime -ne $fixtureCreation) { throw 'Fixture identity changed' }
        $h = $fixtureProcess.MainWindowHandle
        if (!(FocusFixture $h)) { throw 'Fixture foreground unavailable' }
        $selected = $i % 2 -eq 0
        [SuperPanelSampleNative]::Select($selected)
        $null = Rpc 'super-panel-open'
        $state = Rpc 'super-panel-state'
        $expected = if ($selected) { 'SelectedText' } else { 'NoContext' }
        if (!$state.panel.visible -or $state.panel.mode -ne $expected -or $state.panelWindowCount -ne 1 -or $state.workers -ne 0) { throw 'Packaged capture/presentation assertion failed' }
        if ($panelHandle -ne 0 -and $state.panel.windowHandle -ne $panelHandle) { throw 'Panel HWND changed' }
        $panelHandle = $state.panel.windowHandle
        $result.rounds += @{ index = $i; expected = $expected; mode = $state.panel.mode; characterCount = $state.panel.characterCount; windowHandle = $panelHandle; events = $state.events }
        $null = Rpc 'super-panel-dismiss'
        $hidden = Rpc 'super-panel-state'
        if ($hidden.panel.visible -or !$hidden.panel.transientCleared -or $hidden.pending) { throw 'Packaged dismiss did not clear transient state' }
        if (($i + 1) % 10 -eq 0) {
            if ((ElectronCount) -ne 0) { throw 'Unexpected target Electron process' }
            Write-Output "PACKAGED_CHECKPOINT cycles=$($i+1) hwnd=$panelHandle workers=$($hidden.workers) Electron=0"
        }
    }
    for ($i = 0; $i -lt 5; $i++) {
        if (!(FocusFixture $fixtureProcess.MainWindowHandle)) { throw 'Fixture foreground unavailable' }
        $null = Rpc 'super-panel-start'; $null = Rpc 'super-panel-dismiss'
        $deadline = (Get-Date).AddSeconds(3)
        do { $state = Rpc 'super-panel-state'; if (!$state.pending -and $state.workers -eq 0) { break }; Start-Sleep -Milliseconds 50 } while ((Get-Date) -lt $deadline)
        if ($state.panel.visible -or $state.pending -or $state.workers -ne 0) { throw 'Rapid cancellation left active ownership' }
    }
    $result.endBurstUtc = [DateTimeOffset]::UtcNow.ToString('O')
    for ($i = 0; $i -lt 30; $i++) { Start-Sleep -Seconds 1; if ($hostProcess.HasExited) { throw 'NativeHost exited during settle' } }
    if ((ElectronCount) -ne 0) { throw 'Target Electron remains' }
    $result.finalSettleUtc = [DateTimeOffset]::UtcNow.ToString('O'); $result.panelHandle = $panelHandle
    $null = Rpc 'exit'; $result.normalExit = $hostProcess.WaitForExit(15000)
    if (!$result.normalExit) { throw 'NativeHost normal shutdown was not confirmed' }
    $result.targetElectronAfterExit = ElectronCount
    $result.unrelatedWitnesses = @($witnesses | ForEach-Object { $current = Get-Process -Id $_.Id -ErrorAction SilentlyContinue; @{ pid = $_.Id; remains = [bool]($current -and $current.Path -eq $_.Path -and $current.StartTime -eq $_.StartTime) } })
    $result.result = 'PASS'
} catch {
    $result.result = 'FAIL'; $result.failureCategory = $_.Exception.GetType().Name; $result.failure = $_.Exception.Message
    throw
} finally {
    $stop.Cancel()
    if ($sampler) { $null = Wait-Job $sampler -Timeout 5; $null = Receive-Job $sampler }
    if ($fixtureProcess) {
        $check = Get-Process -Id $fixtureProcess.Id -ErrorAction SilentlyContinue
        if ($check -and $check.Path -eq $fixtureImage -and $check.StartTime -eq $fixtureCreation) { $null = $check.CloseMainWindow(); $null = $check.WaitForExit(15000) }
    }
    if (!$hostProcess.HasExited -and $client -and $client.IsConnected) {
        try { $null = Rpc 'exit'; $null = $hostProcess.WaitForExit(15000) } catch { }
    }
    $result.cleanupNativeExitConfirmed = $hostProcess.HasExited
    if ($client) { $client.Dispose() }
    $stop.Dispose()
    $result | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath (Join-Path $installParent 'acceptance.json')
    Write-Output (Join-Path $installParent 'acceptance.json')
    # Evidence/profile retained. No kill, delete, uninstall or production registration operation.
}
