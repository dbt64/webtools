using System.Collections.Specialized;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;

namespace WebTools.NativeHost.Files;

public enum FileResultOperation
{
    Open,
    ShowInFolder,
    CopyObject,
    CopyPath,
    CopyParentPath,
}

public sealed record FileResultOperationResult(bool Succeeded, string Message);

public interface IFileResultOperationPlatform
{
    void Open(string path);
    void ShowInFolder(string path, bool isDirectory);
    void CopyObject(string path);
    void CopyText(string value);
}

public sealed class FileResultOperations(Func<string, string> resolvePath, IFileResultOperationPlatform platform)
{
    public const int MaximumPathCharacters = 32_767;

    public static bool TryParseContextMenuOperation(string? value, out FileResultOperation operation) =>
        Enum.TryParse(value, ignoreCase: false, out operation) && Enum.IsDefined(operation);

    public FileResultOperationResult Execute(string token, Search.ResultKind expectedKind, FileResultOperation operation)
    {
        if (!Guid.TryParseExact(token, "N", out _)) return Failure("这个搜索结果已过期，请重新搜索。");

        string path;
        try { path = resolvePath(token); }
        catch (Exception error) when (IsExpectedFailure(error)) { return Failure("这个搜索结果已过期，请重新搜索。"); }

        if (string.IsNullOrWhiteSpace(path) || path.Length > MaximumPathCharacters || path.IndexOf('\0') >= 0 || !Path.IsPathFullyQualified(path))
            return Failure("无法访问此项目，请重新搜索。");

        var isDirectory = Directory.Exists(path);
        var isFile = !isDirectory && File.Exists(path);
        if (!isDirectory && !isFile) return Failure("此项目已不存在或无法访问，请重新搜索。");
        if (expectedKind is not (Search.ResultKind.File or Search.ResultKind.Folder)
            || isDirectory != (expectedKind == Search.ResultKind.Folder))
            return Failure("搜索结果已发生变化，请重新搜索。");

        try
        {
            switch (operation)
            {
                case FileResultOperation.Open:
                    platform.Open(path);
                    break;
                case FileResultOperation.ShowInFolder:
                    platform.ShowInFolder(path, isDirectory);
                    break;
                case FileResultOperation.CopyObject:
                    platform.CopyObject(path);
                    break;
                case FileResultOperation.CopyPath:
                    platform.CopyText(path);
                    break;
                case FileResultOperation.CopyParentPath:
                    platform.CopyText(Path.GetDirectoryName(path) ?? Path.GetPathRoot(path) ?? path);
                    break;
                default:
                    return Failure("不支持此文件操作。");
            }
            return new(true, "操作已完成。");
        }
        catch (Exception error) when (IsExpectedFailure(error))
        {
            return Failure("无法完成此操作，请检查项目是否仍可访问。");
        }
    }

    private static FileResultOperationResult Failure(string message) => new(false, message);

    private static bool IsExpectedFailure(Exception error) => error is not (OutOfMemoryException or StackOverflowException);
}

public sealed class WindowsFileResultOperationPlatform : IFileResultOperationPlatform
{
    public void Open(string path) => StartShellItem(path);

    public void ShowInFolder(string path, bool isDirectory)
    {
        if (isDirectory)
        {
            StartShellItem(path);
            return;
        }

        if (Thread.CurrentThread.GetApartmentState() != ApartmentState.STA)
            throw new InvalidOperationException("Explorer item selection requires the Windows UI apartment.");

        IntPtr itemPidl = IntPtr.Zero;
        IntPtr parentPidl = IntPtr.Zero;
        try
        {
            ThrowIfShellFailed(SHParseDisplayName(path, IntPtr.Zero, out itemPidl, 0, out _));
            parentPidl = ILClone(itemPidl);
            if (parentPidl == IntPtr.Zero) throw new IOException("Could not resolve the item's parent folder.");
            if (!ILRemoveLastID(parentPidl)) throw new IOException("Could not resolve the item's parent folder.");
            var childPidl = ILFindLastID(itemPidl);
            if (childPidl == IntPtr.Zero) throw new IOException("Could not resolve the item inside its parent folder.");
            ThrowIfShellFailed(SHOpenFolderAndSelectItems(parentPidl, 1, [childPidl], 0));
        }
        finally
        {
            if (parentPidl != IntPtr.Zero) ILFree(parentPidl);
            if (itemPidl != IntPtr.Zero) ILFree(itemPidl);
        }
    }

    public void CopyObject(string path)
    {
        var files = new StringCollection { path };
        System.Windows.Clipboard.SetFileDropList(files);
    }

    public void CopyText(string value) => System.Windows.Clipboard.SetText(value);

    private static void StartShellItem(string path)
    {
        if (Process.Start(new ProcessStartInfo(path) { UseShellExecute = true }) is null)
            throw new IOException("Windows shell did not open the item.");
    }

    private static void ThrowIfShellFailed(int hresult)
    {
        if (hresult < 0) Marshal.ThrowExceptionForHR(hresult);
    }

    [DllImport("shell32.dll", CharSet = CharSet.Unicode, ExactSpelling = true, PreserveSig = true)]
    private static extern int SHParseDisplayName(string displayName, IntPtr bindContext, out IntPtr itemPidl, uint attributesIn, out uint attributesOut);

    [DllImport("shell32.dll", PreserveSig = true)]
    private static extern int SHOpenFolderAndSelectItems(IntPtr folderPidl, uint itemCount, [In] IntPtr[] childPidls, uint flags);

    [DllImport("shell32.dll", PreserveSig = true)]
    private static extern IntPtr ILClone(IntPtr pidl);

    [DllImport("shell32.dll", PreserveSig = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool ILRemoveLastID(IntPtr pidl);

    [DllImport("shell32.dll", PreserveSig = true)]
    private static extern IntPtr ILFindLastID(IntPtr pidl);

    [DllImport("shell32.dll", PreserveSig = true)]
    private static extern void ILFree(IntPtr pidl);
}
