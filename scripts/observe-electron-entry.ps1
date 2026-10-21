param([Parameter(Mandatory=$true)][int]$NativePid, [int]$Seconds = 90)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public static class TranslationEntryWindows {
  public delegate bool EnumProc(IntPtr hwnd, IntPtr param);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc callback, IntPtr param);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr hwnd, StringBuilder text, int size);
  public static object[] Read(int process) {
    var result = new List<object>();
    EnumWindows((hwnd, param) => {
      uint pid; GetWindowThreadProcessId(hwnd, out pid); if (pid != process) return true;
      var text = new StringBuilder(128); GetWindowText(hwnd, text, text.Capacity);
      // Only report fixed host titles; never record arbitrary/plugin/source text.
      var title = text.ToString(); var kind = title == "WebTools \u7ffb\u8bd1" ? "translation" : title == "WebTools" ? "manager" : "other";
      result.Add(new { hwnd = hwnd.ToInt64(), kind, visible = IsWindowVisible(hwnd), minimized = IsIconic(hwnd), foreground = hwnd == GetForegroundWindow() });
      return true;
    }, IntPtr.Zero);
    return result.ToArray();
  }
}
'@
$started = Get-Date
$events = [Collections.Generic.List[object]]::new()
$owned = [Collections.Generic.HashSet[int]]::new()
$lastState = ''
while (((Get-Date) - $started).TotalSeconds -lt $Seconds) {
    $rows = @(Get-CimInstance Win32_Process -Filter "Name='WebTools.exe'")
    foreach ($row in $rows) { if ($row.ParentProcessId -eq $NativePid -or $owned.Contains([int]$row.ParentProcessId)) { $null = $owned.Add([int]$row.ProcessId) } }
    $state = @($rows | Where-Object { $owned.Contains([int]$_.ProcessId) } | ForEach-Object {
        [pscustomobject]@{ pid=$_.ProcessId; parentPid=$_.ParentProcessId; executable=$_.ExecutablePath; windows=@([TranslationEntryWindows]::Read([int]$_.ProcessId)) }
    })
    $json = ConvertTo-Json -InputObject $state -Depth 6 -Compress
    if ($json -ne $lastState) {
        $record = [pscustomobject]@{ elapsedMs=[int]((Get-Date)-$started).TotalMilliseconds; processes=$state }
        $events.Add($record); $record | ConvertTo-Json -Depth 7 -Compress
        $lastState=$json
    }
    Start-Sleep -Milliseconds 500
}
$output = Join-Path $PSScriptRoot ('../release/translation-entry-observation-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.json')
ConvertTo-Json -InputObject $events.ToArray() -Depth 7 | Set-Content -LiteralPath $output -Encoding UTF8
Write-Output $output
