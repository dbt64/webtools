using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using Microsoft.Win32.SafeHandles;

namespace WebTools.NativeHost.Services;

internal sealed record ManagerProcessLaunch(Process Process, ManagerLaunchIdentity Identity);

internal interface IManagerPipeClientProcessIdProvider
{
    int GetClientProcessId(SafePipeHandle serverPipeHandle);
}

internal interface IManagerPipePeerAuthenticator
{
    bool TryAuthenticate(int osObservedProcessId, out IAuthenticatedManagerPipePeer? peer, out string failureReason);
    bool IsCurrent(IAuthenticatedManagerPipePeer peer);
    bool TryAcquireCurrentOperation(IAuthenticatedManagerPipePeer peer, out IDisposable? lease);
}

internal interface IAuthenticatedManagerPipePeer : IDisposable
{
    int ClientProcessId { get; }
    long LaunchGeneration { get; }
}

internal interface IManagerProcessIdentityApi : IManagerPipeClientProcessIdProvider
{
    IManagerProcessObservation OpenProcess(int processId);
    IManagerLaunchJob CreateAndAssignLaunchJob(IManagerProcessObservation process);
    string CanonicalizeExecutablePath(string path);
}

internal interface IManagerProcessObservation : IDisposable
{
    int ProcessId { get; }
    long CreationFileTimeUtc { get; }
    string ImagePath { get; }
    bool IsAlive { get; }
}

internal interface IManagerLaunchJob : IDisposable
{
    bool Contains(IManagerProcessObservation process);
}

internal sealed class ManagerLaunchIdentity : IDisposable
{
    private int _disposed;

    internal ManagerLaunchIdentity(
        IManagerProcessObservation launchedProcess,
        IManagerLaunchJob? launchJob,
        string expectedLaunchRootImagePath,
        string expectedClientImagePath,
        bool developmentMode,
        long generation)
    {
        LaunchedProcess = launchedProcess;
        LaunchJob = launchJob;
        ExpectedLaunchRootImagePath = expectedLaunchRootImagePath;
        ExpectedClientImagePath = expectedClientImagePath;
        DevelopmentMode = developmentMode;
        Generation = generation;
    }

    internal IManagerProcessObservation LaunchedProcess { get; }
    internal IManagerLaunchJob? LaunchJob { get; }
    internal string ExpectedLaunchRootImagePath { get; }
    internal string ExpectedClientImagePath { get; }
    internal bool DevelopmentMode { get; }
    internal long Generation { get; }
    internal bool IsDisposed => Volatile.Read(ref _disposed) != 0;

    public void Dispose()
    {
        if (Interlocked.Exchange(ref _disposed, 1) != 0) return;
        try { LaunchJob?.Dispose(); }
        finally { LaunchedProcess.Dispose(); }
    }
}

internal sealed class ManagerPipePeerSession : IAuthenticatedManagerPipePeer
{
    private int _disposed;

    internal ManagerPipePeerSession(ManagerLaunchIdentity launchIdentity, IManagerProcessObservation clientProcess)
    {
        LaunchIdentity = launchIdentity;
        ClientProcess = clientProcess;
        ClientProcessId = clientProcess.ProcessId;
        LaunchGeneration = launchIdentity.Generation;
    }

    internal ManagerLaunchIdentity LaunchIdentity { get; }
    internal IManagerProcessObservation ClientProcess { get; }
    public int ClientProcessId { get; }
    public long LaunchGeneration { get; }
    internal bool IsDisposed => Volatile.Read(ref _disposed) != 0;

    public void Dispose()
    {
        if (Interlocked.Exchange(ref _disposed, 1) == 0) ClientProcess.Dispose();
    }
}

/// <summary>Validates the one current NativeHost-launched Manager and binds each pipe connection to it.</summary>
internal sealed class ManagerPeerIdentityService : IManagerPipePeerAuthenticator
{
    private readonly object _sync = new();
    private readonly IManagerProcessIdentityApi _identityApi;
    private ManagerLaunchIdentity? _current;
    private int _activeOperations;
    private TaskCompletionSource<bool> _operationsDrained = CompletedSignal();

    internal ManagerPeerIdentityService(IManagerProcessIdentityApi identityApi) => _identityApi = identityApi;

    internal ManagerLaunchIdentity CaptureLaunchIdentity(
        int processId,
        long retainedCreationFileTimeUtc,
        string expectedLaunchRootImagePath,
        string expectedClientImagePath,
        bool developmentMode,
        long generation)
    {
        IManagerProcessObservation? launched = null;
        IManagerLaunchJob? job = null;
        try
        {
            var expectedRoot = _identityApi.CanonicalizeExecutablePath(expectedLaunchRootImagePath);
            var expected = _identityApi.CanonicalizeExecutablePath(expectedClientImagePath);
            launched = _identityApi.OpenProcess(processId);
            if (!launched.IsAlive) throw new InvalidOperationException("The launched Manager process exited during identity capture.");
            if (launched.CreationFileTimeUtc != retainedCreationFileTimeUtc)
                throw new InvalidOperationException("The launched Manager PID no longer identifies the Process.Start instance.");
            if (!PathEquals(launched.ImagePath, expectedRoot))
                throw new InvalidOperationException("The launched Manager root image did not match its resolved executable.");
            if (!developmentMode && !PathEquals(launched.ImagePath, expected))
                throw new InvalidOperationException("The packaged Manager image did not match its expected peer executable.");
            if (developmentMode) job = _identityApi.CreateAndAssignLaunchJob(launched);
            if (!launched.IsAlive) throw new InvalidOperationException("The launched Manager process exited during identity capture.");

            var identity = new ManagerLaunchIdentity(launched, job, expectedRoot, expected, developmentMode, generation);
            launched = null;
            job = null;
            return identity;
        }
        finally
        {
            job?.Dispose();
            launched?.Dispose();
        }
    }

    internal void SetCurrent(ManagerLaunchIdentity identity)
    {
        ArgumentNullException.ThrowIfNull(identity);
        if (identity.IsDisposed) throw new ObjectDisposedException(nameof(identity));
        lock (_sync)
        {
            if (_activeOperations != 0) throw new InvalidOperationException("Cannot synchronously replace a Manager while an authenticated request is active.");
            _current = identity;
        }
    }

    internal async Task SetCurrentAsync(ManagerLaunchIdentity identity)
    {
        ArgumentNullException.ThrowIfNull(identity);
        if (identity.IsDisposed) throw new ObjectDisposedException(nameof(identity));
        while (true)
        {
            Task waitForDrain;
            lock (_sync)
            {
                if (identity.IsDisposed) throw new ObjectDisposedException(nameof(identity));
                if (_activeOperations == 0)
                {
                    _current = identity;
                    return;
                }
                waitForDrain = _operationsDrained.Task;
            }
            await waitForDrain.WaitAsync(TimeSpan.FromSeconds(30)).ConfigureAwait(false);
        }
    }

    internal void ClearCurrent(ManagerLaunchIdentity identity)
    {
        lock (_sync) if (ReferenceEquals(_current, identity)) _current = null;
    }

    public bool TryAuthenticate(int osObservedProcessId, out IAuthenticatedManagerPipePeer? peer, out string failureReason)
    {
        peer = null;
        ManagerLaunchIdentity? current;
        lock (_sync) current = _current;
        if (current is null || current.IsDisposed)
        {
            failureReason = "no-current-manager";
            return false;
        }

        IManagerProcessObservation? client = null;
        try
        {
            client = _identityApi.OpenProcess(osObservedProcessId);
            if (!Matches(current, client, out failureReason)) return false;
            lock (_sync)
            {
                if (!ReferenceEquals(_current, current) || current.IsDisposed || !Matches(current, client, out failureReason))
                    return false;
                peer = new ManagerPipePeerSession(current, client);
                client = null;
            }
            failureReason = string.Empty;
            return true;
        }
        catch (Exception)
        {
            failureReason = "identity-api-failure";
            return false;
        }
        finally { client?.Dispose(); }
    }

    public bool IsCurrent(IAuthenticatedManagerPipePeer peer)
    {
        try
        {
            if (peer is not ManagerPipePeerSession session || session.IsDisposed || session.LaunchIdentity.IsDisposed) return false;
            lock (_sync)
            {
                return ReferenceEquals(_current, session.LaunchIdentity)
                    && session.LaunchGeneration == _current?.Generation
                    && Matches(session.LaunchIdentity, session.ClientProcess, out _);
            }
        }
        catch (Exception) { return false; }
    }

    public bool TryAcquireCurrentOperation(IAuthenticatedManagerPipePeer peer, out IDisposable? lease)
    {
        lease = null;
        try
        {
            if (peer is not ManagerPipePeerSession session || session.IsDisposed || session.LaunchIdentity.IsDisposed) return false;
            lock (_sync)
            {
                if (!ReferenceEquals(_current, session.LaunchIdentity)
                    || session.LaunchGeneration != _current?.Generation
                    || !Matches(session.LaunchIdentity, session.ClientProcess, out _)) return false;
                if (_activeOperations++ == 0)
                    _operationsDrained = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
                lease = new AuthenticatedOperationLease(ReleaseOperation);
                return true;
            }
        }
        catch (Exception) { return false; }
    }

    private void ReleaseOperation()
    {
        lock (_sync)
        {
            if (_activeOperations <= 0) return;
            if (--_activeOperations == 0) _operationsDrained.TrySetResult(true);
        }
    }

    private static TaskCompletionSource<bool> CompletedSignal()
    {
        var completed = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
        completed.SetResult(true);
        return completed;
    }

    private sealed class AuthenticatedOperationLease(Action release) : IDisposable
    {
        private Action? _release = release;
        public void Dispose() => Interlocked.Exchange(ref _release, null)?.Invoke();
    }

    private bool Matches(ManagerLaunchIdentity launch, IManagerProcessObservation client, out string failureReason)
    {
        if (launch.IsDisposed || !launch.LaunchedProcess.IsAlive)
        {
            failureReason = "launched-manager-exited";
            return false;
        }
        if (!client.IsAlive)
        {
            failureReason = "pipe-client-exited";
            return false;
        }
        if (!PathEquals(client.ImagePath, launch.ExpectedClientImagePath))
        {
            failureReason = "unexpected-client-image";
            return false;
        }

        if (launch.DevelopmentMode)
        {
            if (launch.LaunchJob is null || !launch.LaunchJob.Contains(client))
            {
                failureReason = "client-outside-development-launch-chain";
                return false;
            }
        }
        else
        {
            if (client.ProcessId != launch.LaunchedProcess.ProcessId)
            {
                failureReason = "client-pid-not-launched-manager";
                return false;
            }
            if (client.CreationFileTimeUtc != launch.LaunchedProcess.CreationFileTimeUtc)
            {
                failureReason = "client-start-identity-mismatch";
                return false;
            }
            if (!PathEquals(client.ImagePath, launch.LaunchedProcess.ImagePath))
            {
                failureReason = "client-image-not-launched-manager";
                return false;
            }
        }

        if (!client.IsAlive || !launch.LaunchedProcess.IsAlive)
        {
            failureReason = "process-exited-during-authentication";
            return false;
        }
        failureReason = string.Empty;
        return true;
    }

    internal static bool PathEquals(string left, string right) =>
        string.Equals(left, right, StringComparison.OrdinalIgnoreCase);
}

internal sealed class WindowsManagerProcessIdentityApi : IManagerProcessIdentityApi
{
    private const uint ProcessQueryLimitedInformation = 0x1000;
    private const uint ProcessSynchronize = 0x00100000;
    private const uint ProcessSetQuota = 0x0100;
    private const uint ProcessTerminate = 0x0001;
    private const uint FileReadAttributes = 0x0080;
    private const uint ShareRead = 0x00000001;
    private const uint ShareWrite = 0x00000002;
    private const uint ShareDelete = 0x00000004;
    private const uint OpenExisting = 3;
    private const uint JobObjectLimitKillOnJobClose = 0x00002000;
    private const uint JobObjectExtendedLimitInformationClass = 9;
    private const uint WaitObject0 = 0;
    private const uint WaitTimeout = 258;
    private const uint WaitFailed = 0xFFFFFFFF;
    private const uint VolumeNameDos = 0;

    public int GetClientProcessId(Microsoft.Win32.SafeHandles.SafePipeHandle serverPipeHandle)
    {
        if (!GetNamedPipeClientProcessId(serverPipeHandle, out var processId) || processId == 0)
            throw new Win32Exception(Marshal.GetLastWin32Error(), "Could not obtain the OS-observed Named Pipe client PID.");
        return checked((int)processId);
    }

    public IManagerProcessObservation OpenProcess(int processId)
    {
        if (processId <= 0) throw new ArgumentOutOfRangeException(nameof(processId));
        var handle = OpenProcessNative(ProcessQueryLimitedInformation | ProcessSynchronize, false, checked((uint)processId));
        if (handle.IsInvalid)
        {
            var error = Marshal.GetLastWin32Error();
            handle.Dispose();
            throw new Win32Exception(error, "Could not open the observed Manager process.");
        }

        try
        {
            if (!GetProcessTimes(handle, out var creation, out _, out _, out _))
                throw new Win32Exception(Marshal.GetLastWin32Error(), "Could not read Manager process creation identity.");
            var image = ReadProcessImage(handle);
            return new WindowsProcessObservation(handle, processId, FileTimeToInt64(creation), CanonicalizeExecutablePath(image));
        }
        catch
        {
            handle.Dispose();
            throw;
        }
    }

    public IManagerLaunchJob CreateAndAssignLaunchJob(IManagerProcessObservation process)
    {
        var job = CreateJobObjectW(IntPtr.Zero, null);
        if (job.IsInvalid)
        {
            var error = Marshal.GetLastWin32Error();
            job.Dispose();
            throw new Win32Exception(error, "Could not create a Manager development launch job.");
        }

        try
        {
            var limits = new JobObjectExtendedLimitInformation
            {
                BasicLimitInformation = new JobObjectBasicLimitInformation { LimitFlags = JobObjectLimitKillOnJobClose },
            };
            if (!SetInformationJobObject(job, JobObjectExtendedLimitInformationClass, ref limits, (uint)Marshal.SizeOf<JobObjectExtendedLimitInformation>()))
                throw new Win32Exception(Marshal.GetLastWin32Error(), "Could not configure the development launch job.");

            if (process is not WindowsProcessObservation observed)
                throw new InvalidOperationException("Development launch job requires a retained Windows process handle.");
            using var assignmentProcess = OpenProcessNative(ProcessSetQuota | ProcessTerminate | ProcessQueryLimitedInformation, false, checked((uint)observed.ProcessId));
            if (assignmentProcess.IsInvalid) throw new Win32Exception(Marshal.GetLastWin32Error(), "Could not open the development launch root for job assignment.");
            if (!GetProcessTimes(assignmentProcess, out var creation, out _, out _, out _)
                || FileTimeToInt64(creation) != observed.CreationFileTimeUtc)
                throw new InvalidOperationException("The development Manager launch PID changed before job assignment.");
            if (!AssignProcessToJobObject(job, assignmentProcess))
                throw new Win32Exception(Marshal.GetLastWin32Error(), "Could not bind the development Manager launch root to its private job.");
            return new WindowsManagerLaunchJob(job);
        }
        catch
        {
            job.Dispose();
            throw;
        }
    }

    public string CanonicalizeExecutablePath(string path)
    {
        if (string.IsNullOrWhiteSpace(path)) throw new InvalidDataException("Manager executable path is empty.");
        var fullPath = Path.GetFullPath(path);
        using var file = CreateFileW(fullPath, FileReadAttributes, ShareRead | ShareWrite | ShareDelete, IntPtr.Zero, OpenExisting, 0, IntPtr.Zero);
        if (file.IsInvalid) throw new Win32Exception(Marshal.GetLastWin32Error(), "Could not resolve the canonical Manager executable path.");
        var buffer = new StringBuilder(32768);
        var length = GetFinalPathNameByHandleW(file, buffer, (uint)buffer.Capacity, VolumeNameDos);
        if (length == 0 || length >= buffer.Capacity) throw new Win32Exception(Marshal.GetLastWin32Error(), "Could not canonicalize the Manager executable path.");
        var result = buffer.ToString();
        if (result.StartsWith(@"\\?\UNC\", StringComparison.OrdinalIgnoreCase)) result = @"\\" + result[8..];
        else if (result.StartsWith(@"\\?\", StringComparison.OrdinalIgnoreCase)) result = result[4..];
        return Path.GetFullPath(result);
    }

    private static string ReadProcessImage(SafeProcessHandle process)
    {
        var capacity = 32768;
        var buffer = new StringBuilder(capacity);
        if (!QueryFullProcessImageNameW(process, 0, buffer, ref capacity) || capacity <= 0)
            throw new Win32Exception(Marshal.GetLastWin32Error(), "Could not read the Manager process image path.");
        return buffer.ToString();
    }

    private static long FileTimeToInt64(System.Runtime.InteropServices.ComTypes.FILETIME value) =>
        ((long)(uint)value.dwHighDateTime << 32) | (uint)value.dwLowDateTime;

    private sealed class WindowsProcessObservation(SafeProcessHandle handle, int processId, long creationFileTimeUtc, string imagePath) : IManagerProcessObservation
    {
        private int _disposed;
        public int ProcessId { get; } = processId;
        public long CreationFileTimeUtc { get; } = creationFileTimeUtc;
        public string ImagePath { get; } = imagePath;
        internal SafeProcessHandle Handle { get; } = handle;
        public bool IsAlive
        {
            get
            {
                ObjectDisposedException.ThrowIf(Volatile.Read(ref _disposed) != 0, this);
                var result = WaitForSingleObject(Handle, 0);
                if (result == WaitTimeout) return true;
                if (result == WaitObject0) return false;
                if (result == WaitFailed) throw new Win32Exception(Marshal.GetLastWin32Error(), "Could not verify Manager process lifetime.");
                throw new InvalidOperationException("Unexpected process wait result while validating the Manager peer.");
            }
        }
        public void Dispose() { if (Interlocked.Exchange(ref _disposed, 1) == 0) Handle.Dispose(); }
    }

    private sealed class WindowsManagerLaunchJob(SafeJobObjectHandle handle) : IManagerLaunchJob
    {
        private int _disposed;
        public bool Contains(IManagerProcessObservation process)
        {
            ObjectDisposedException.ThrowIf(Volatile.Read(ref _disposed) != 0, this);
            if (process is not WindowsProcessObservation observed) return false;
            if (!IsProcessInJob(observed.Handle, handle, out var inJob))
                throw new Win32Exception(Marshal.GetLastWin32Error(), "Could not validate development Manager launch-chain membership.");
            return inJob;
        }
        public void Dispose() { if (Interlocked.Exchange(ref _disposed, 1) == 0) handle.Dispose(); }
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct JobObjectBasicLimitInformation
    {
        public long PerProcessUserTimeLimit;
        public long PerJobUserTimeLimit;
        public uint LimitFlags;
        public UIntPtr MinimumWorkingSetSize;
        public UIntPtr MaximumWorkingSetSize;
        public uint ActiveProcessLimit;
        public UIntPtr Affinity;
        public uint PriorityClass;
        public uint SchedulingClass;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct IoCounters
    {
        public ulong ReadOperationCount;
        public ulong WriteOperationCount;
        public ulong OtherOperationCount;
        public ulong ReadTransferCount;
        public ulong WriteTransferCount;
        public ulong OtherTransferCount;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct JobObjectExtendedLimitInformation
    {
        public JobObjectBasicLimitInformation BasicLimitInformation;
        public IoCounters IoInfo;
        public UIntPtr ProcessMemoryLimit;
        public UIntPtr JobMemoryLimit;
        public UIntPtr PeakProcessMemoryUsed;
        public UIntPtr PeakJobMemoryUsed;
    }

    private sealed class SafeJobObjectHandle : SafeHandleZeroOrMinusOneIsInvalid
    {
        private SafeJobObjectHandle() : base(true) { }
        protected override bool ReleaseHandle() => CloseHandle(handle);
    }

    [DllImport("kernel32.dll", EntryPoint = "GetNamedPipeClientProcessId", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetNamedPipeClientProcessId(Microsoft.Win32.SafeHandles.SafePipeHandle pipe, out uint clientProcessId);

    [DllImport("kernel32.dll", EntryPoint = "OpenProcess", SetLastError = true)]
    private static extern Microsoft.Win32.SafeHandles.SafeProcessHandle OpenProcessNative(uint desiredAccess, [MarshalAs(UnmanagedType.Bool)] bool inheritHandle, uint processId);

    [DllImport("kernel32.dll", EntryPoint = "GetProcessTimes", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetProcessTimes(Microsoft.Win32.SafeHandles.SafeProcessHandle process, out System.Runtime.InteropServices.ComTypes.FILETIME creationTime, out System.Runtime.InteropServices.ComTypes.FILETIME exitTime, out System.Runtime.InteropServices.ComTypes.FILETIME kernelTime, out System.Runtime.InteropServices.ComTypes.FILETIME userTime);

    [DllImport("kernel32.dll", EntryPoint = "QueryFullProcessImageNameW", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool QueryFullProcessImageNameW(Microsoft.Win32.SafeHandles.SafeProcessHandle process, uint flags, StringBuilder imageName, ref int size);

    [DllImport("kernel32.dll", EntryPoint = "CreateFileW", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern SafeFileHandle CreateFileW(string fileName, uint desiredAccess, uint shareMode, IntPtr securityAttributes, uint creationDisposition, uint flagsAndAttributes, IntPtr templateFile);

    [DllImport("kernel32.dll", EntryPoint = "GetFinalPathNameByHandleW", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern uint GetFinalPathNameByHandleW(SafeFileHandle file, StringBuilder path, uint pathLength, uint flags);

    [DllImport("kernel32.dll", EntryPoint = "CreateJobObjectW", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern SafeJobObjectHandle CreateJobObjectW(IntPtr jobAttributes, string? name);

    [DllImport("kernel32.dll", EntryPoint = "SetInformationJobObject", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool SetInformationJobObject(SafeJobObjectHandle job, uint jobObjectInformationClass, ref JobObjectExtendedLimitInformation jobObjectInformation, uint jobObjectInformationLength);

    [DllImport("kernel32.dll", EntryPoint = "AssignProcessToJobObject", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool AssignProcessToJobObject(SafeJobObjectHandle job, Microsoft.Win32.SafeHandles.SafeProcessHandle process);

    [DllImport("kernel32.dll", EntryPoint = "IsProcessInJob", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool IsProcessInJob(Microsoft.Win32.SafeHandles.SafeProcessHandle process, SafeJobObjectHandle job, [MarshalAs(UnmanagedType.Bool)] out bool result);

    [DllImport("kernel32.dll", EntryPoint = "WaitForSingleObject", SetLastError = true)]
    private static extern uint WaitForSingleObject(Microsoft.Win32.SafeHandles.SafeProcessHandle handle, uint milliseconds);

    [DllImport("kernel32.dll", EntryPoint = "CloseHandle", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CloseHandle(IntPtr handle);
}
