param(
    [Parameter(Mandatory = $true)][string]$TestRoot,
    [string]$NativeRoot,
    [string]$ManagerRoot,
    [ValidateRange(1, 60)][int]$SampleIntervalSeconds = 1,
    [switch]$Sampler
)
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$root = [IO.Path]::GetFullPath($TestRoot).TrimEnd('\')
$tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')
$tempPrefix = $tempRoot + [IO.Path]::DirectorySeparatorChar
if (-not $root.StartsWith($tempPrefix, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Test root must be a strict descendant of user TEMP.'
}
$relativeRoot = $root.Substring($tempPrefix.Length)
if (-not [IO.Directory]::Exists($root)) { throw 'Test root must already exist.' }

# The script writes stage/sampler files directly under TestRoot, so validate
# the complete existing path before creating or appending any of those files.
$volumeRoot = [IO.Path]::GetPathRoot($tempRoot)
$separators = [char[]]@([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar)
$current = $volumeRoot
foreach ($part in $tempRoot.Substring($volumeRoot.Length).Split($separators, [StringSplitOptions]::RemoveEmptyEntries)) {
    $current = [IO.Path]::Combine($current, $part)
    if (-not [IO.Directory]::Exists($current) -or ([IO.File]::GetAttributes($current) -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw 'User TEMP path cannot contain missing directories or reparse points.'
    }
}
foreach ($part in $relativeRoot.Split($separators, [StringSplitOptions]::RemoveEmptyEntries)) {
    $current = [IO.Path]::Combine($current, $part)
    if (-not [IO.Directory]::Exists($current) -or ([IO.File]::GetAttributes($current) -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw 'Test root path cannot contain missing directories, junctions, symlinks, or reparse points.'
    }
}
function Assert-TempDescendantDirectory([string]$path, [string]$label) {
    $normalized = [IO.Path]::GetFullPath($path).TrimEnd('\')
    if (-not $normalized.StartsWith($tempPrefix, [StringComparison]::OrdinalIgnoreCase)) {
        throw "$label must be a strict descendant of user TEMP."
    }
    if (-not [IO.Directory]::Exists($normalized)) { throw "$label must already exist." }
    $currentPath = $tempRoot
    $relativePath = $normalized.Substring($tempPrefix.Length)
    foreach ($part in $relativePath.Split($separators, [StringSplitOptions]::RemoveEmptyEntries)) {
        $currentPath = [IO.Path]::Combine($currentPath, $part)
        if (-not [IO.Directory]::Exists($currentPath) -or ([IO.File]::GetAttributes($currentPath) -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw "$label cannot contain missing directories, junctions, symlinks, or reparse points."
        }
    }
    return $normalized
}
$nativeRoot = Assert-TempDescendantDirectory $(if ($NativeRoot) { $NativeRoot } else { Join-Path $root 'Native' }) 'NativeHost root'
$managerBinaryRoot = Assert-TempDescendantDirectory $(if ($ManagerRoot) { $ManagerRoot } else { Join-Path $root 'manager-build\win-unpacked' }) 'Manager root'
$userProfile = [IO.Path]::GetFullPath([IO.Path]::Combine($env:APPDATA, 'Nook')).TrimEnd('\')
$profileVolumeRoot = [IO.Path]::GetPathRoot($userProfile)
$profileCurrent = $profileVolumeRoot
foreach ($part in $userProfile.Substring($profileVolumeRoot.Length).Split($separators, [StringSplitOptions]::RemoveEmptyEntries)) {
    $profileCurrent = [IO.Path]::Combine($profileCurrent, $part)
    if (-not [IO.Directory]::Exists($profileCurrent) -and -not [IO.File]::Exists($profileCurrent)) { break }
    if (([IO.File]::GetAttributes($profileCurrent) -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw 'Real WebTools profile path contains a reparse point; refusing to run the process sampler.'
    }
}
function Test-SameOrWithin([string]$parent, [string]$candidate) {
    $normalizedParent = [IO.Path]::GetFullPath($parent).TrimEnd('\')
    $normalizedCandidate = [IO.Path]::GetFullPath($candidate).TrimEnd('\')
    return [string]::Equals($normalizedParent, $normalizedCandidate, [StringComparison]::OrdinalIgnoreCase) -or
        $normalizedCandidate.StartsWith($normalizedParent + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)
}
if ((Test-SameOrWithin $userProfile $root) -or (Test-SameOrWithin $root $userProfile)) { throw 'Test root cannot overlap the real WebTools user profile.' }
$nativePath = Join-Path $nativeRoot 'WebTools.NativeHost.exe'
$managerPath = Join-Path $managerBinaryRoot 'WebTools.exe'
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public static class Phase4G3Windows {
  public delegate bool EnumProc(IntPtr hwnd, IntPtr lparam);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc callback, IntPtr lparam);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr hwnd, StringBuilder text, int count);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hwnd, uint msg, IntPtr wparam, IntPtr lparam);
  [DllImport("user32.dll")] public static extern uint GetGuiResources(IntPtr process, uint flags);
  public static long[] Windows(int target, bool visibleOnly) {
    var list = new List<long>();
    EnumWindows((h, l) => { uint pid; GetWindowThreadProcessId(h, out pid); if(pid == target && (!visibleOnly || IsWindowVisible(h))) list.Add(h.ToInt64()); return true; }, IntPtr.Zero);
    return list.ToArray();
  }
  public static long[] WindowsWithTitle(int target, string title) {
    var list = new List<long>();
    EnumWindows((h, l) => { uint pid; GetWindowThreadProcessId(h, out pid); var text = new StringBuilder(512); GetWindowText(h, text, text.Capacity); if(pid == target && String.Equals(text.ToString(), title, StringComparison.Ordinal)) list.Add(h.ToInt64()); return true; }, IntPtr.Zero);
    return list.ToArray();
  }
}
'@
function Get-Inventory {
    $items = @(Get-CimInstance Win32_Process | Where-Object {
        $_.ExecutablePath -eq $nativePath -or ($_.ExecutablePath -and $_.ExecutablePath.StartsWith($managerBinaryRoot + '\', [StringComparison]::OrdinalIgnoreCase))
    })
    $records = @()
    foreach ($item in $items) {
        $role = if ($item.ExecutablePath -eq $nativePath) { 'native' } elseif ($item.CommandLine -match '--type=([^\s"]+)') { $Matches[1] } else { 'main' }
        $windows = @()
        try {
            $process = [Diagnostics.Process]::GetProcessById([int]$item.ProcessId)
            $process.Refresh()
            $windows = @([Phase4G3Windows]::Windows([int]$item.ProcessId, $true))
            $records += [ordered]@{
                pid = [int]$item.ProcessId; parentPid = [int]$item.ParentProcessId
                path = $item.ExecutablePath; created = $item.CreationDate.ToUniversalTime().ToString('O')
                role = $role; commandLine = $item.CommandLine; windows = $windows
                privateBytes = $process.PrivateMemorySize64; workingSet = $process.WorkingSet64
                handles = $process.HandleCount; threads = $process.Threads.Count
                gdi = [Phase4G3Windows]::GetGuiResources($process.Handle, 0)
                user = [Phase4G3Windows]::GetGuiResources($process.Handle, 1)
                exited = $false
            }
            $process.Dispose()
        } catch {
            # CIM and Process metrics are separate snapshots: an exiting Chromium
            # child can vanish between them. Do not misclassify this as a product fault.
            if (Get-Process -Id ([int]$item.ProcessId) -ErrorAction SilentlyContinue) {
                $records += [ordered]@{
                    pid = [int]$item.ProcessId; parentPid = [int]$item.ParentProcessId
                    path = $item.ExecutablePath; created = $item.CreationDate.ToUniversalTime().ToString('O')
                    role = $role; windows = $windows; metricsUnavailable = $_.Exception.Message
                }
            }
        }
    }
    return $records
}
if ($Sampler) {
    $output = Join-Path $root 'process-samples.jsonl'
    $stop = Join-Path $root 'sampler.stop'
    $control = Join-Path $root 'stage.json'
    while (-not (Test-Path -LiteralPath $stop)) {
        $clock = [Diagnostics.Stopwatch]::StartNew()
        $stage = $null
        $stageError = $null
        try { if (Test-Path -LiteralPath $control) { $stage = Get-Content -LiteralPath $control -Raw | ConvertFrom-Json } }
        catch { $stageError = $_.Exception.Message }
        $sample = [ordered]@{ utc = [DateTime]::UtcNow.ToString('O'); stage = $stage; stageError = $stageError; processes = @(Get-Inventory) }
        $sample | ConvertTo-Json -Depth 7 -Compress | Add-Content -LiteralPath $output -Encoding UTF8
        $remaining = ($SampleIntervalSeconds * 1000) - $clock.ElapsedMilliseconds
        if ($remaining -gt 0) { Start-Sleep -Milliseconds $remaining }
    }
    exit 0
}
while ($null -ne ($line = [Console]::ReadLine())) {
    try {
        $request = $line | ConvertFrom-Json
        $inventory = @(Get-Inventory)
        if ($request.type -eq 'close-native') {
            $target = @($inventory | Where-Object { $_.pid -eq $request.pid -and $_.created -eq $request.created -and $_.path -eq $nativePath -and $_.role -eq 'native' })
            if ($target.Count -ne 1) { throw 'NativeHost identity mismatch; refusing process operation.' }
            $windows = @([Phase4G3Windows]::WindowsWithTitle([int]$target[0].pid, 'WebTools Native Launcher'))
            if ($windows.Count -ne 1) { throw 'Expected exactly one NativeHost Launcher window for WM_CLOSE.' }
            if (-not [Phase4G3Windows]::PostMessage([IntPtr][long]$windows[0], 0x0010, [IntPtr]::Zero, [IntPtr]::Zero)) { throw 'NativeHost WM_CLOSE failed.' }
        } elseif ($request.type -in @('close', 'terminate-main')) {
            $target = @($inventory | Where-Object { $_.pid -eq $request.pid -and $_.created -eq $request.created -and $_.path -eq $managerPath -and $_.role -eq 'main' })
            if ($target.Count -ne 1) { throw 'Manager identity mismatch; refusing process operation.' }
            if ($request.type -eq 'close') {
                # The Manager BrowserWindow is intentionally created hidden and
                # shown only after renderer readiness. Target its fixed title
                # within the already identity-checked Main PID so a startup
                # timeout can still request a normal close before it is visible.
                $windows = @([Phase4G3Windows]::WindowsWithTitle([int]$target[0].pid, 'WebTools'))
                if ($windows.Count -ne 1) { throw 'Expected exactly one Manager HWND titled WebTools for WM_CLOSE.' }
                if (-not [Phase4G3Windows]::PostMessage([IntPtr][long]$windows[0], 0x0010, [IntPtr]::Zero, [IntPtr]::Zero)) { throw 'Manager WM_CLOSE failed.' }
            } else {
                $process = [Diagnostics.Process]::GetProcessById([int]$request.pid)
                # CIM has microsecond precision; Process.StartTime retains 100 ns.
                # The exact CIM identity/path was checked above. Corroborate it
                # against the newly acquired process handle without string rounding.
                $created = [DateTime]::Parse($request.created).ToUniversalTime()
                if (($process.StartTime.ToUniversalTime() - $created).Duration().TotalMilliseconds -gt 0.01) { throw 'PID creation time changed.' }
                $process.Kill() # Scenario F: confirmed isolated Main only, never its children.
                $process.Dispose()
            }
        } elseif ($request.type -ne 'scan') { throw 'Unsupported process probe command.' }
        [Console]::WriteLine((@{ ok = $true; processes = $inventory } | ConvertTo-Json -Depth 7 -Compress))
    } catch {
        [Console]::WriteLine((@{ ok = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress))
    }
}
