using System.Diagnostics;
using System.IO;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using WebTools.NativeHost.Search;

namespace WebTools.NativeHost.Files;

public sealed class EverythingClient
{
    private readonly string _configuredPath;
    private Dictionary<string, string> _paths = new();
    private (DateTimeOffset At, string? Exe, bool Running, Version? Version)? _status;

    public EverythingClient(string configuredPath) => _configuredPath = configuredPath;

    public static string[] BuildArguments(string query, int maximum, bool json, bool utf8) =>
    [
        ..(json ? new[] { "-argv" } : Array.Empty<string>()),
        ..(utf8 ? new[] { "-cp", "65001" } : Array.Empty<string>()),
        ..(json ? new[] { "-json" } : new[] { "-csv", "-no-header" }),
        "-full-path-and-name", "-n", maximum.ToString(), "-timeout", "1000", "--", query,
    ];

    public async Task<IReadOnlyList<SearchResult>> SearchAsync(string query, CancellationToken token)
    {
        query = query.Trim();
        if (query.Length == 0) return [];
        if (query.Length > 300 || query.IndexOfAny(['\0', '\r', '\n']) >= 0) throw new ArgumentException("文件搜索关键词太长或包含无效字符。");
        var status = await DetectAsync(token);
        if (status.Exe is null) throw new FileNotFoundException("没有找到 ES 命令行工具。请在设置中选择 es.exe。");
        if (!status.Running) throw new InvalidOperationException("Everything 没有运行。请先启动 Everything，再搜索文件。");
        var json = status.Version is not null && status.Version >= new Version(1, 1, 0, 37);
        var utf8 = status.Version is not null && status.Version >= new Version(1, 1, 0, 27);
        var output = await RunAsync(status.Exe, BuildArguments(query, 20, json, utf8), 1500, token);
        var paths = json ? ParseJson(output) : ParseCsv(output).Where(Path.IsPathFullyQualified).ToArray();
        var results = new List<SearchResult>();
        var nextPaths = new Dictionary<string, string>();
        foreach (var raw in paths.Take(20))
        {
            token.ThrowIfCancellationRequested();
            var path = raw.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
            if (path.Length == 0) path = raw;
            if (!File.Exists(path) && !Directory.Exists(path)) continue;
            var folder = Directory.Exists(path);
            var id = Guid.NewGuid().ToString("N");
            nextPaths[id] = path;
            var name = Path.GetFileName(path);
            var location = Path.GetFileName(Path.GetDirectoryName(path)) ?? Path.GetPathRoot(path) ?? "";
            results.Add(new SearchResult(id, folder ? ResultKind.Folder : ResultKind.File, name, location,
                results.Count, MatchKind.Name, new OpenFileAction(id), path));
        }
        token.ThrowIfCancellationRequested();
        _paths = nextPaths;
        return results;
    }

    public string ResolvePath(string token) => _paths.GetValueOrDefault(token)
        ?? throw new InvalidOperationException("这个搜索结果已过期，请重新搜索。");

    private async Task<(string? Exe, bool Running, Version? Version)> DetectAsync(CancellationToken token)
    {
        if (_status is { } cache && DateTimeOffset.UtcNow - cache.At < TimeSpan.FromSeconds(10))
            return (cache.Exe, cache.Running, cache.Version);
        var exe = FindExecutable();
        if (exe is null) return Save(null, false, null);
        Version? version = null;
        try
        {
            var text = await RunAsync(exe, ["-version"], 1000, token);
            var match = Regex.Match(text, @"\d+\.\d+\.\d+\.\d+");
            if (match.Success) version = Version.Parse(match.Value);
        }
        catch (Exception error) when (error is not OperationCanceledException) { /* old ES may omit version output */ }
        try
        {
            await RunAsync(exe, ["-get-everything-version"], 1000, token);
            return Save(exe, true, version);
        }
        catch (Exception error) when (error is not OperationCanceledException) { return Save(exe, false, version); }
    }

    private (string? Exe, bool Running, Version? Version) Save(string? exe, bool running, Version? version)
    {
        _status = (DateTimeOffset.UtcNow, exe, running, version);
        return (exe, running, version);
    }

    private string? FindExecutable()
    {
        var candidates = new List<string> { _configuredPath };
        foreach (var root in new[] { Environment.GetEnvironmentVariable("ProgramFiles"), Environment.GetEnvironmentVariable("ProgramFiles(x86)") })
            if (!string.IsNullOrEmpty(root)) candidates.Add(Path.Combine(root, "Everything", "es.exe"));
        var local = Environment.GetEnvironmentVariable("LOCALAPPDATA");
        if (!string.IsNullOrEmpty(local)) candidates.Add(Path.Combine(local, "Microsoft", "WindowsApps", "es.exe"));
        foreach (var root in (Environment.GetEnvironmentVariable("PATH") ?? "").Split(Path.PathSeparator))
            if (root.Length > 0) candidates.Add(Path.Combine(root, "es.exe"));
        return candidates.Distinct(StringComparer.OrdinalIgnoreCase)
            .FirstOrDefault(path => Path.IsPathFullyQualified(path) && Path.GetFileName(path).Equals("es.exe", StringComparison.OrdinalIgnoreCase) && File.Exists(path));
    }

    private static async Task<string> RunAsync(string exe, IReadOnlyList<string> args, int timeoutMs, CancellationToken token)
    {
        var start = new ProcessStartInfo(exe)
        {
            UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true,
            StandardOutputEncoding = Encoding.UTF8,
        };
        foreach (var arg in args) start.ArgumentList.Add(arg);
        using var process = Process.Start(start) ?? throw new IOException("无法启动 ES。");
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(token);
        timeout.CancelAfter(timeoutMs);
        try
        {
            var output = await process.StandardOutput.ReadToEndAsync(timeout.Token);
            if (output.Length > 1_000_000) throw new IOException("ES 输出超过限制。");
            await process.WaitForExitAsync(timeout.Token);
            if (process.ExitCode == 9) return "";
            if (process.ExitCode != 0) throw new IOException($"ES 命令失败，退出码 {process.ExitCode}。");
            return output;
        }
        catch
        {
            if (!process.HasExited) process.Kill(entireProcessTree: true);
            throw;
        }
    }

    private static string[] ParseJson(string output)
    {
        try
        {
            using var document = JsonDocument.Parse(string.IsNullOrWhiteSpace(output) ? "[]" : output);
            var rows = document.RootElement.ValueKind == JsonValueKind.Array ? document.RootElement.EnumerateArray().ToArray() : [document.RootElement];
            var paths = new List<string>();
            foreach (var row in rows)
            {
                if (row.ValueKind == JsonValueKind.String)
                {
                    var value = row.GetString();
                    if (value is not null && Path.IsPathFullyQualified(value)) paths.Add(value);
                    continue;
                }
                if (row.ValueKind != JsonValueKind.Object) continue;
                var fields = row.EnumerateObject().ToDictionary(property => property.Name.Replace(" ", "").Replace("_", "").Replace("-", "").ToLowerInvariant(), property => property.Value);
                string? Field(string name) => fields.TryGetValue(name, out var value) && value.ValueKind == JsonValueKind.String ? value.GetString() : null;
                var full = new[] { "fullpathandname", "filename", "fullname", "name" }.Select(Field).FirstOrDefault(value => value is not null && Path.IsPathFullyQualified(value));
                if (full is null && Field("path") is { } directory && Field("name") is { } name && Path.IsPathFullyQualified(directory)) full = Path.Combine(directory, name);
                if (full is not null) paths.Add(full);
            }
            return paths.ToArray();
        }
        catch (JsonException) { throw new InvalidDataException("当前 ES JSON 输出格式无法读取，请更新 ES 后重试。"); }
    }

    private static string[] ParseCsv(string text)
    {
        var results = new List<string>();
        var value = new StringBuilder();
        var quoted = false;
        for (var i = 0; i < text.Length; i++)
        {
            var current = text[i];
            if (quoted && current == '"' && i + 1 < text.Length && text[i + 1] == '"') { value.Append('"'); i++; }
            else if (current == '"') quoted = !quoted;
            else if (!quoted && current is '\r' or '\n' or ',')
            {
                if (value.Length > 0) results.Add(value.ToString().Trim());
                value.Clear();
                if (current == '\r' && i + 1 < text.Length && text[i + 1] == '\n') i++;
            }
            else value.Append(current);
        }
        if (value.Length > 0) results.Add(value.ToString().Trim());
        return results.Where(value => value.Length > 0).ToArray();
    }
}
