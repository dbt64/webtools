param(
    [Parameter(Mandatory = $true)]
    [string] $ExecutablePath,

    [string[]] $ArgumentList = @(),

    [int] $RunCount = 5,

    [int[]] $SampleAtSeconds = @(30, 600),

    [string] $OutputPath = (Join-Path $env:TEMP 'WebToolsNativeHost-PoC')
)

$ErrorActionPreference = 'Stop'
$resolvedExecutable = (Resolve-Path -LiteralPath $ExecutablePath).Path
$sampleTimes = @($SampleAtSeconds | Sort-Object -Unique)
if ($RunCount -lt 1 -or $sampleTimes.Count -eq 0 -or $sampleTimes[0] -lt 1) {
    throw 'RunCount must be positive and SampleAtSeconds must contain positive values.'
}

Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Runtime.InteropServices;

public static class Phase4BProcessTree
{
    [DllImport("user32.dll")] public static extern uint GetGuiResources(IntPtr process, uint flag);
    private const uint SnapshotAllProcesses = 0x00000002;
    private const uint InvalidHandle = 0xFFFFFFFF;

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct ProcessEntry32
    {
        public uint Size;
        public uint Usage;
        public uint ProcessId;
        public IntPtr DefaultHeapId;
        public uint ModuleId;
        public uint Threads;
        public uint ParentProcessId;
        public int Priority;
        public uint Flags;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)] public string Name;
    }

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr CreateToolhelp32Snapshot(uint flags, uint processId);

    [DllImport("kernel32.dll", EntryPoint = "Process32FirstW", SetLastError = true, CharSet = CharSet.Unicode)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool Process32First(IntPtr snapshot, ref ProcessEntry32 entry);

    [DllImport("kernel32.dll", EntryPoint = "Process32NextW", SetLastError = true, CharSet = CharSet.Unicode)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool Process32Next(IntPtr snapshot, ref ProcessEntry32 entry);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CloseHandle(IntPtr handle);

    public static int[] GetTree(int rootProcessId)
    {
        var snapshot = CreateToolhelp32Snapshot(SnapshotAllProcesses, 0);
        if (snapshot == new IntPtr(unchecked((int)InvalidHandle)))
            throw new Win32Exception(Marshal.GetLastWin32Error());

        try
        {
            var parents = new Dictionary<int, int>();
            var entry = new ProcessEntry32 { Size = (uint)Marshal.SizeOf<ProcessEntry32>() };
            if (Process32First(snapshot, ref entry))
            {
                do
                {
                    parents[(int)entry.ProcessId] = (int)entry.ParentProcessId;
                }
                while (Process32Next(snapshot, ref entry));
            }

            var result = new List<int> { rootProcessId };
            var known = new HashSet<int> { rootProcessId };
            for (var index = 0; index < result.Count; index++)
            {
                var parent = result[index];
                foreach (var pair in parents)
                {
                    if (pair.Value == parent && known.Add(pair.Key))
                        result.Add(pair.Key);
                }
            }

            return result.ToArray();
        }
        finally
        {
            CloseHandle(snapshot);
        }
    }
}
'@

New-Item -ItemType Directory -Path $OutputPath -Force | Out-Null
$outputFile = Join-Path $OutputPath ("memory-{0:yyyyMMdd-HHmmss}.csv" -f (Get-Date))
$rows = [System.Collections.Generic.List[object]]::new()

for ($run = 1; $run -le $RunCount; $run++) {
    $clock = [System.Diagnostics.Stopwatch]::StartNew()
    if ($ArgumentList.Count -gt 0) {
        $process = Start-Process -FilePath $resolvedExecutable -ArgumentList $ArgumentList -PassThru -WindowStyle Hidden
    }
    else {
        $process = Start-Process -FilePath $resolvedExecutable -PassThru -WindowStyle Hidden
    }

    try {
        foreach ($sampleSecond in $sampleTimes) {
            while ($clock.Elapsed.TotalSeconds -lt $sampleSecond) {
                if ($process.HasExited) {
                    throw "Process exited before the $sampleSecond-second sample (run $run)."
                }

                $remainingMs = [math]::Max(1, [int](($sampleSecond - $clock.Elapsed.TotalSeconds) * 1000))
                Start-Sleep -Milliseconds ([math]::Min($remainingMs, 1000))
            }

            $processIds = [Phase4BProcessTree]::GetTree($process.Id)
            $members = foreach ($processId in $processIds) {
                try { Get-Process -Id $processId -ErrorAction Stop } catch { }
            }

            $rows.Add([pscustomobject]@{
                Run = $run
                SampleSeconds = $sampleSecond
                SampleUtc = [DateTimeOffset]::UtcNow.ToString('O')
                RootPid = $process.Id
                ProcessCount = @($members).Count
                ProcessIds = ($processIds -join ';')
                PrivateBytes = [long](($members | Measure-Object -Property PrivateMemorySize64 -Sum).Sum)
                WorkingSetBytes = [long](($members | Measure-Object -Property WorkingSet64 -Sum).Sum)
                RootGdiHandles = [Phase4BProcessTree]::GetGuiResources($process.Handle, 0)
                RootUserHandles = [Phase4BProcessTree]::GetGuiResources($process.Handle, 1)
                RootThreads = (Get-Process -Id $process.Id).Threads.Count
            })
        }
    }
    finally {
        $tree = @([Phase4BProcessTree]::GetTree($process.Id))
        for ($index = $tree.Count - 1; $index -ge 0; $index--) {
            try { Stop-Process -Id $tree[$index] -Force -ErrorAction Stop } catch { }
        }
        $process.Dispose()
    }
}

$rows | Export-Csv -LiteralPath $outputFile -NoTypeInformation -Encoding utf8
$rows | Format-Table Run,SampleSeconds,ProcessCount,PrivateBytes,WorkingSetBytes,RootGdiHandles,RootUserHandles,RootThreads -AutoSize
Write-Output "CSV: $outputFile"
