param(
    [string] $ExecutablePath = (Join-Path $PSScriptRoot '..\WebTools.NativeHost\publish\WebTools.NativeHost.exe'),
    [int] $ToggleCycles = 30
)

$ErrorActionPreference = 'Stop'
$resolvedExecutable = (Resolve-Path -LiteralPath $ExecutablePath).Path

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;

public static class Phase4BSmokeNative
{
    public delegate bool EnumWindowsCallback(IntPtr window, IntPtr state);

    [StructLayout(LayoutKind.Sequential)]
    public struct NativeRect { public int Left; public int Top; public int Right; public int Bottom; }

    [StructLayout(LayoutKind.Sequential)]
    private struct Input { public uint Type; public InputUnion Data; }

    [StructLayout(LayoutKind.Explicit)]
    private struct InputUnion
    {
        [FieldOffset(0)] public KeyboardInput Keyboard;
        [FieldOffset(0)] public MouseInput Mouse;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct KeyboardInput { public ushort VirtualKey; public ushort Scan; public uint Flags; public uint Time; public UIntPtr ExtraInfo; }

    [StructLayout(LayoutKind.Sequential)]
    private struct MouseInput { public int X; public int Y; public uint Data; public uint Flags; public uint Time; public UIntPtr ExtraInfo; }

    [DllImport("user32.dll")] private static extern bool EnumWindows(EnumWindowsCallback callback, IntPtr state);
    [DllImport("user32.dll", SetLastError = true)] private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetWindowText(IntPtr window, StringBuilder text, int maxCount);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll", SetLastError = true)] public static extern bool GetWindowRect(IntPtr window, out NativeRect rect);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW")] private static extern IntPtr GetWindowLongPtr(IntPtr window, int index);
    [DllImport("user32.dll", SetLastError = true)] private static extern uint SendInput(uint count, Input[] inputs, int size);
    [DllImport("user32.dll", SetLastError = true)] public static extern bool PostMessage(IntPtr window, uint message, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] public static extern bool GetCursorPos(out NativePoint point);

    [StructLayout(LayoutKind.Sequential)]
    public struct NativePoint { public int X; public int Y; }

    private const uint InputKeyboard = 1;
    private const uint InputMouse = 0;
    private const uint KeyUp = 2;
    private const uint MouseLeftDown = 2;
    private const uint MouseLeftUp = 4;
    private const uint MouseMove = 1;
    private const uint MouseAbsolute = 0x8000;
    [DllImport("user32.dll")] private static extern int GetSystemMetrics(int index);

    public static IntPtr FindWindow(int ownerProcessId)
    {
        var found = IntPtr.Zero;
        EnumWindows((window, _) =>
        {
            GetWindowThreadProcessId(window, out var processId);
            if (processId == (uint)ownerProcessId)
            {
                var title = new StringBuilder(256);
                if (GetWindowText(window, title, title.Capacity) > 0)
                {
                    found = window;
                    return false;
                }
            }

            return true;
        }, IntPtr.Zero);
        return found;
    }

    public static bool IsTopmost(IntPtr window) => (GetWindowLongPtr(window, -20).ToInt64() & 0x00000008L) != 0;

    public static void SendHotkey()
    {
        SendKeys(new ushort[] { 0x11, 0x12, 0x20 }, new bool[] { false, false, false });
        SendKeys(new ushort[] { 0x20, 0x12, 0x11 }, new bool[] { true, true, true });
    }

    public static void SendKey(ushort key)
    {
        SendKeys(new ushort[] { key }, new bool[] { false });
        SendKeys(new ushort[] { key }, new bool[] { true });
    }

    public static void SendUnicodeText(string text)
    {
        foreach (var character in text)
        {
            var inputs = new Input[]
            {
                new Input { Type = InputKeyboard, Data = new InputUnion { Keyboard = new KeyboardInput { Scan = character, Flags = 0x0004 } } },
                new Input { Type = InputKeyboard, Data = new InputUnion { Keyboard = new KeyboardInput { Scan = character, Flags = 0x0006 } } },
            };
            if (SendInput((uint)inputs.Length, inputs, Marshal.SizeOf<Input>()) != (uint)inputs.Length)
                throw new InvalidOperationException("SendInput failed for text input.");
        }
    }

    public static void Click(int x, int y)
    {
        SetCursorPos(x, y);
        SendMouse(MouseLeftDown);
        SendMouse(MouseLeftUp);
    }

    public static void BeginDrag(int x, int y)
    {
        SetCursorPos(x, y);
        SendMouse(MouseLeftDown);
    }

    public static void EndDrag(int x, int y)
    {
        var width = GetSystemMetrics(0);
        var height = GetSystemMetrics(1);
        var move = new Input
        {
            Type = InputMouse,
            Data = new InputUnion
            {
                Mouse = new MouseInput
                {
                    X = (int)Math.Round(x * 65535.0 / Math.Max(1, width - 1)),
                    Y = (int)Math.Round(y * 65535.0 / Math.Max(1, height - 1)),
                    Flags = MouseMove | MouseAbsolute,
                }
            }
        };
        if (SendInput(1, new Input[] { move }, Marshal.SizeOf<Input>()) != 1)
            throw new InvalidOperationException("SendInput failed for drag movement.");
        System.Threading.Thread.Sleep(120);
        SendMouse(MouseLeftUp);
    }

    private static void SendMouse(uint flags)
    {
        var input = new Input { Type = InputMouse, Data = new InputUnion { Mouse = new MouseInput { Flags = flags } } };
        if (SendInput(1, new Input[] { input }, Marshal.SizeOf<Input>()) != 1)
            throw new InvalidOperationException("SendInput failed for mouse action.");
    }

    private static void SendKeys(ushort[] keys, bool[] keyUps)
    {
        if (keys.Length != keyUps.Length) throw new ArgumentException("Key data length mismatch.");
        var inputs = new Input[keys.Length];
        for (var index = 0; index < keys.Length; index++)
        {
            inputs[index] = new Input
            {
                Type = InputKeyboard,
                Data = new InputUnion
                {
                    Keyboard = new KeyboardInput { VirtualKey = keys[index], Flags = keyUps[index] ? KeyUp : 0 }
                }
            };
        }

        if (SendInput((uint)inputs.Length, inputs, Marshal.SizeOf<Input>()) != (uint)inputs.Length)
            throw new InvalidOperationException("SendInput failed for keyboard action.");
    }
}
'@

function Assert-Check([bool] $Condition, [string] $Name) {
    if (-not $Condition) { throw "FAIL $Name" }
    Write-Output "PASS $Name"
}

function Wait-LauncherVisibility([int] $ProcessId, [bool] $ExpectedVisible, [int] $TimeoutMs = 2500) {
    $clock = [System.Diagnostics.Stopwatch]::StartNew()
    do {
        $window = [Phase4BSmokeNative]::FindWindow($ProcessId)
        if ($window -ne [IntPtr]::Zero -and [Phase4BSmokeNative]::IsWindowVisible($window) -eq $ExpectedVisible) {
            return $window
        }
        Start-Sleep -Milliseconds 20
    } while ($clock.ElapsedMilliseconds -lt $TimeoutMs)

    return [IntPtr]::Zero
}

function Get-TextBox([IntPtr] $Window) {
    $root = [System.Windows.Automation.AutomationElement]::FromHandle($Window)
    $condition = [System.Windows.Automation.PropertyCondition]::new(
        [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
        [System.Windows.Automation.ControlType]::Edit)
    return $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $condition)
}

function Wait-TextBoxFocus([IntPtr] $Window, [int] $TimeoutMs = 1000) {
    $clock = [System.Diagnostics.Stopwatch]::StartNew()
    do {
        $textbox = Get-TextBox $Window
        if ($textbox -and $textbox.Current.HasKeyboardFocus) {
            return $textbox
        }
        Start-Sleep -Milliseconds 20
    } while ($clock.ElapsedMilliseconds -lt $TimeoutMs)
    return $null
}

$latencies = [System.Collections.Generic.List[double]]::new()
$memorySamples = [System.Collections.Generic.List[object]]::new()
$memoryMilestones = @(1, 10, 30, 100, $ToggleCycles) | Where-Object { $_ -le $ToggleCycles } | Sort-Object -Unique
$nativeProcess = $null
$externalProcess = $null

function Add-MemorySample([string] $Stage, [int] $ProcessId) {
    $process = Get-Process -Id $ProcessId -ErrorAction Stop
    $memorySamples.Add([pscustomobject]@{
        Stage = $Stage
        SampleUtc = [DateTimeOffset]::UtcNow.ToString('O')
        ProcessId = $ProcessId
        ProcessCount = 1
        PrivateBytes = [long]$process.PrivateMemorySize64
        WorkingSetBytes = [long]$process.WorkingSet64
    })
}

try {
    $nativeProcess = Start-Process -FilePath $resolvedExecutable -PassThru -WindowStyle Hidden
    Start-Sleep -Milliseconds 700
    Assert-Check (-not $nativeProcess.HasExited) 'Native Host cold-starts and remains alive in tray'
    $window = Wait-LauncherVisibility $nativeProcess.Id $false
    Assert-Check ($window -ne [IntPtr]::Zero) 'Launcher HWND exists but starts hidden'
    Add-MemorySample 'before_first_show' $nativeProcess.Id

    $secondInstance = Start-Process -FilePath $resolvedExecutable -PassThru -WindowStyle Hidden
    if (-not $secondInstance.WaitForExit(5000)) {
        Stop-Process -Id $secondInstance.Id -Force -ErrorAction SilentlyContinue
        throw 'FAIL second instance exits without creating another Host'
    }
    Assert-Check ($secondInstance.ExitCode -eq 0) 'Second instance exits without duplicating the Host'

    $clock = [System.Diagnostics.Stopwatch]::StartNew()
    [Phase4BSmokeNative]::SendHotkey()
    $window = Wait-LauncherVisibility $nativeProcess.Id $true
    $firstShowLatency = $clock.Elapsed.TotalMilliseconds
    Assert-Check ($window -ne [IntPtr]::Zero) 'First Ctrl+Alt+Space shows the launcher'
    Assert-Check ([Phase4BSmokeNative]::IsTopmost($window)) 'Launcher window is topmost'
    $textbox = Wait-TextBoxFocus $window
    Assert-Check ($null -ne $textbox) 'First hotkey focuses the WPF TextBox'
    Add-MemorySample 'after_first_show' $nativeProcess.Id

    [Phase4BSmokeNative]::SendUnicodeText('visual')
    Start-Sleep -Milliseconds 150
    Add-MemorySample 'after_typing' $nativeProcess.Id
    $textbox = Get-TextBox $window
    $valuePattern = $null
    $textValue = ''
    if ($textbox -and $textbox.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$valuePattern)) {
        $textValue = $valuePattern.Current.Value
    }
    Assert-Check ($textValue -eq 'visual') 'TextBox accepts immediate English typing'

    $root = [System.Windows.Automation.AutomationElement]::FromHandle($window)
    $itemsCondition = [System.Windows.Automation.PropertyCondition]::new(
        [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
        [System.Windows.Automation.ControlType]::ListItem)
    $items = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $itemsCondition)
    Assert-Check ($items.Count -eq 3) 'Non-empty query shows exactly three dummy results'
    Add-MemorySample 'after_dummy_results' $nativeProcess.Id
    $rect = [Phase4BSmokeNative+NativeRect]::new()
    [void][Phase4BSmokeNative]::GetWindowRect($window, [ref]$rect)
    Assert-Check (($rect.Bottom - $rect.Top) -gt 160) 'Results expand the compact window'

    $firstItemRect = $items.Item(0).Current.BoundingRectangle
    [Phase4BSmokeNative]::Click([int]($firstItemRect.Left + $firstItemRect.Width / 2), [int]($firstItemRect.Top + $firstItemRect.Height / 2))
    Start-Sleep -Milliseconds 100
    Assert-Check ([Phase4BSmokeNative]::IsWindowVisible($window)) 'Clicking a dummy result selects without prematurely hiding'
    [Phase4BSmokeNative]::SendKey(0x28)
    [Phase4BSmokeNative]::SendKey(0x0D)
    Assert-Check ((Wait-LauncherVisibility $nativeProcess.Id $false) -ne [IntPtr]::Zero) 'Arrow navigation and Enter activate a dummy result and hide'
    Add-MemorySample 'after_hide' $nativeProcess.Id

    [Phase4BSmokeNative]::SendHotkey()
    $window = Wait-LauncherVisibility $nativeProcess.Id $true
    Assert-Check ($window -ne [IntPtr]::Zero) 'Hotkey reopens after result activation'
    [Phase4BSmokeNative]::SendKey(0x1B)
    Assert-Check ((Wait-LauncherVisibility $nativeProcess.Id $false) -ne [IntPtr]::Zero) 'Escape hides the launcher'

    [Phase4BSmokeNative]::SendHotkey()
    $window = Wait-LauncherVisibility $nativeProcess.Id $true
    $beforeDrag = [Phase4BSmokeNative+NativeRect]::new()
    [void][Phase4BSmokeNative]::GetWindowRect($window, [ref]$beforeDrag)
    $cursor = [Phase4BSmokeNative+NativePoint]::new()
    [void][Phase4BSmokeNative]::GetCursorPos([ref]$cursor)
    $dragX = $beforeDrag.Left + [int](($beforeDrag.Right - $beforeDrag.Left) / 2)
    $dragY = $beforeDrag.Top + 15
    [Phase4BSmokeNative]::BeginDrag($dragX, $dragY)
    Start-Sleep -Milliseconds 80
    [Phase4BSmokeNative]::EndDrag($dragX + 60, $dragY + 35)
    Start-Sleep -Milliseconds 150
    $afterDrag = [Phase4BSmokeNative+NativeRect]::new()
    [void][Phase4BSmokeNative]::GetWindowRect($window, [ref]$afterDrag)
    [void][Phase4BSmokeNative]::SetCursorPos($cursor.X, $cursor.Y)
    $dragged = ($afterDrag.Left -ne $beforeDrag.Left) -or ($afterDrag.Top -ne $beforeDrag.Top)
    if (-not $dragged) {
        Write-Output ("Drag bounds unchanged: before=({0},{1})-({2},{3}); after=({4},{5})-({6},{7})" -f $beforeDrag.Left, $beforeDrag.Top, $beforeDrag.Right, $beforeDrag.Bottom, $afterDrag.Left, $afterDrag.Top, $afterDrag.Right, $afterDrag.Bottom)
    }
    Assert-Check $dragged 'Dedicated header drag area moves the window'
    [Phase4BSmokeNative]::SendKey(0x1B)
    [void](Wait-LauncherVisibility $nativeProcess.Id $false)

    $toggleFailures = 0
    for ($cycle = 0; $cycle -lt $ToggleCycles; $cycle++) {
        $clock = [System.Diagnostics.Stopwatch]::StartNew()
        [Phase4BSmokeNative]::SendHotkey()
        $window = Wait-LauncherVisibility $nativeProcess.Id $true
        $latencies.Add($clock.Elapsed.TotalMilliseconds)
        if ($window -eq [IntPtr]::Zero) { $toggleFailures++; break }
        $textbox = Wait-TextBoxFocus $window
        if (-not $textbox -or -not $textbox.Current.HasKeyboardFocus) { $toggleFailures++ }

        [Phase4BSmokeNative]::SendHotkey()
        if ((Wait-LauncherVisibility $nativeProcess.Id $false) -eq [IntPtr]::Zero) { $toggleFailures++ }

        $completedCycles = $cycle + 1
        if ($completedCycles -in $memoryMilestones) {
            Add-MemorySample "after_${completedCycles}_toggle_cycles" $nativeProcess.Id
        }
    }
    Assert-Check ($toggleFailures -eq 0) "$ToggleCycles rapid hotkey toggles show, hide, and focus correctly"

    [Phase4BSmokeNative]::SendHotkey()
    $window = Wait-LauncherVisibility $nativeProcess.Id $true
    $externalProcess = Start-Process -FilePath 'notepad.exe' -PassThru
    Start-Sleep -Milliseconds 800
    Assert-Check ((Wait-LauncherVisibility $nativeProcess.Id $false) -ne [IntPtr]::Zero) 'Activating another Windows application blur-hides the launcher'

    Write-Output ("First hotkey → visible: {0:F2} ms" -f $firstShowLatency)
    if ($latencies.Count -gt 0) {
        $sorted = @($latencies | Sort-Object)
        $median = if ($sorted.Count % 2 -eq 0) { ($sorted[$sorted.Count / 2 - 1] + $sorted[$sorted.Count / 2]) / 2 } else { $sorted[[int][math]::Floor($sorted.Count / 2)] }
        $p95 = $sorted[[int][math]::Ceiling($sorted.Count * 0.95) - 1]
        Write-Output ("30 toggle show cycles → visible: n={0}, median={1:F2} ms, p95={2:F2} ms, max={3:F2} ms" -f $sorted.Count, $median, $p95, $sorted[-1])
    }
}
finally {
    if ($externalProcess -and -not $externalProcess.HasExited) {
        Stop-Process -Id $externalProcess.Id -Force -ErrorAction SilentlyContinue
    }
    if ($nativeProcess -and -not $nativeProcess.HasExited) {
        $window = [Phase4BSmokeNative]::FindWindow($nativeProcess.Id)
        if ($window -ne [IntPtr]::Zero) { [void][Phase4BSmokeNative]::PostMessage($window, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero) }
        if (-not $nativeProcess.WaitForExit(5000)) { Stop-Process -Id $nativeProcess.Id -Force -ErrorAction SilentlyContinue }
    }

    if ($nativeProcess -and $memorySamples.Count -gt 0) {
        $memoryPath = Join-Path (Join-Path $env:TEMP 'WebToolsNativeHost-PoC') ("interaction-memory-{0:yyyyMMdd-HHmmss}-{1}.csv" -f (Get-Date), $nativeProcess.Id)
        $memorySamples | Export-Csv -LiteralPath $memoryPath -NoTypeInformation -Encoding utf8
        Write-Output "Interaction memory samples: $memoryPath"
        $memorySamples | Format-Table Stage,ProcessCount,PrivateBytes,WorkingSetBytes -AutoSize
    }
}

if ($nativeProcess) {
    $log = Get-ChildItem -LiteralPath (Join-Path $env:TEMP 'WebToolsNativeHost-PoC') -Filter "*-$($nativeProcess.Id).csv" -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($log) {
        Write-Output "Diagnostics: $($log.FullName)"
    }
}
