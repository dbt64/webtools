using System.ComponentModel;

namespace WebTools.UpdateHelper;

internal static class Program
{
    private static async Task<int> Main(string[] args)
    {
        if (args.Length != 2 || args[0] is not ("--check-install" or "--prepare-install"))
        {
            Console.Error.WriteLine("用法：WebTools.UpdateHelper.exe --check-install|--prepare-install <安装目录>");
            return 2;
        }

        try
        {
            var root = InstallProcessTargets.NormalizeInstallRoot(args[1]);
            if (args[0] == "--prepare-install")
            {
                var prepared = await new InstallPreparationService().PrepareAsync(root, TimeSpan.FromSeconds(35)).ConfigureAwait(false);
                if (!prepared) Console.Error.WriteLine("WebTools 未能正常退出。请从托盘退出后，在当前安装窗口继续重试。");
                return prepared ? 0 : 12;
            }
            var snapshot = InstallProcessTargets.Discover(root);
            if (snapshot.UnresolvedCandidateProcessIds.Count > 0)
            {
                Console.Error.WriteLine("无法确认 WebTools 进程是否已退出，请正常退出后台后重试。");
                return 11;
            }
            if (snapshot.Targets.Count > 0)
            {
                Console.Error.WriteLine("WebTools 仍在运行，请从系统托盘正常退出后重试。");
                return 10;
            }
            return 0;
        }
        catch (OperationCanceledException)
        {
            Console.Error.WriteLine("等待 WebTools 退出超时；未卸载或替换文件，可以在当前安装窗口重试。");
            return 12;
        }
        catch (Exception error) when (error is ArgumentException or NotSupportedException or IOException or UnauthorizedAccessException or InvalidOperationException or Win32Exception)
        {
            Console.Error.WriteLine("无法安全检查 WebTools 安装目录，请退出后台后重试。");
            return 11;
        }
    }
}
