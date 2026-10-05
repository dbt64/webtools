using System.Diagnostics;
using System.IO;
using WebTools.NativeHost.Catalog;
using WebTools.NativeHost.Data;
using WebTools.NativeHost.Files;
using WebTools.NativeHost.Search;

namespace WebTools.NativeHost.Services;

public sealed class ResultActionExecutor(AppCatalogService catalog, EverythingClient everything)
{
    public void Execute(SearchResult result)
    {
        ProcessStartInfo start = result.Action switch
        {
            LaunchApplicationAction app => ForApplication(catalog.Find(app.AppId)
                ?? throw new InvalidOperationException("找不到这个应用，请刷新后重试。")),
            OpenWebsiteAction website => ForUrl(website.Url),
            OpenFileAction file => ForFile(everything.ResolvePath(file.Token)),
            OpenTranslationAction => throw new NotSupportedException("翻译需要 Phase 4D 的 Manager 通信，当前独立 Native Host 尚不能打开该模块。"),
            _ => throw new InvalidOperationException("未知搜索操作。"),
        };
        // ShellExecute may hand a URL or document to an existing process and return null on success.
        _ = Process.Start(start);
    }

    public static ProcessStartInfo ForApplication(CatalogApp app)
    {
        switch (app.Target)
        {
            case ShortcutTarget shortcut: return Shell(shortcut.ShortcutPath);
            case ExecutableTarget executable: return Shell(executable.Path);
            case PackagedTarget packaged:
                if (!AppFolderIdValidator.IsPackageAumid(packaged.AppId)) throw new InvalidOperationException("打包应用标识无效。");
                var packagedStart = Shell("explorer.exe");
                packagedStart.ArgumentList.Add($@"shell:AppsFolder\{packaged.AppId}");
                return packagedStart;
            case AppFolderTarget appFolder:
                if (!AppFolderIdValidator.IsValid(appFolder.AppId) || AppFolderIdValidator.IsPackageAumid(appFolder.AppId))
                    throw new InvalidOperationException("Windows 应用标识无效。");
                var appFolderStart = Shell("explorer.exe");
                appFolderStart.ArgumentList.Add($@"shell:AppsFolder\{appFolder.AppId}");
                return appFolderStart;
            case SystemTarget system:
                var fileName = system.App switch
                {
                    "file-explorer" => "explorer.exe",
                    "control-panel" => "control.exe",
                    "device-manager" => "mmc.exe",
                    "disk-management" => "mmc.exe",
                    _ => throw new InvalidOperationException("未知系统应用。"),
                };
                var systemStart = Shell(fileName);
                if (system.App == "device-manager") systemStart.ArgumentList.Add("devmgmt.msc");
                else if (system.App == "disk-management") systemStart.ArgumentList.Add("diskmgmt.msc");
                return systemStart;
            default: throw new InvalidOperationException("未知应用启动类型。");
        }
    }

    public static ProcessStartInfo ForUrl(string url)
    {
        if (!Uri.TryCreate(url, UriKind.Absolute, out var uri) || uri.Scheme is not ("http" or "https") || uri.UserInfo.Length > 0)
            throw new InvalidOperationException("网址无效或不允许打开。");
        return Shell(uri.AbsoluteUri);
    }

    public void OpenWebsite(string url) => _ = Process.Start(ForUrl(url));

    public void SearchWeb(WebsiteSnapshot snapshot, string query) => OpenWebsite(snapshot.BuildWebSearchUrl(query));

    public static ProcessStartInfo ForFile(string path)
    {
        if (!File.Exists(path) && !Directory.Exists(path)) throw new FileNotFoundException("文件或文件夹已不存在。", path);
        return Shell(path);
    }

    private static ProcessStartInfo Shell(string path) => new(path) { UseShellExecute = true };
}
