using System.IO;
using System.Text.Json;
using WebTools.NativeHost.Data;
using WebTools.NativeHost.Services;
using WebTools.NativeHost.SuperPanel;

namespace WebTools.NativeHost.Checks;

internal static class Phase6G2SelectedTextChecks
{
    internal static async Task<int> RunAsync()
    {
        var total = 0; var failed = 0;
        async Task Check(string name, Func<Task> action)
        {
            total++;
            try { await action(); Console.WriteLine("PASS " + name); }
            catch (Exception error) { failed++; Console.WriteLine("FAIL " + name + ": " + error.Message); }
        }
        NativeFeatureProjectionV2 Projection(string? match = "http-url")
        {
            var context = new Dictionary<string, object> { ["type"] = "text", ["sources"] = new[] { "selected-text" } };
            if (match is not null) context["textMatch"] = match;
            using var json = JsonDocument.Parse(JsonSerializer.Serialize(new { projectionVersion = 2,
                hostSessionId = "2e83e777-81e5-47bb-8a5e-1f52e5d7bd34", revision = 2, generatedAtUnixMs = 1,
                features = new[] { new { @ref = new { pluginId = "org.example.actions", featureId = "open-link" },
                    pluginName = "Text Actions", title = "Open link", commands = Array.Empty<string>(),
                    acceptedContexts = new[] { context }, iconToken = "globe", featureKind = "runtime-v3", presentation = "command", group = "plugin-features" } } }));
            return NativeFeatureProjectionStore.Parse(json.RootElement);
        }
        await Check("Native and SDK share the HTTP URL eligibility corpus", () =>
        {
            var row = Projection().Features[0];
            using var corpus = JsonDocument.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "selected-text-matching.json")));
            foreach (var item in corpus.RootElement.EnumerateArray())
            {
                var text = item.GetProperty("text").GetString()!;
                var context = new NativeLauncherTextContext("text", "selected-text", text, 1);
                if (SuperPanelFeatureMatcher.MatchesSelection(row, context) != item.GetProperty("matches").GetBoolean())
                    throw new Exception("URL eligibility differs from shared expected result.");
            }
            return Task.CompletedTask;
        });
        await Check("no-rule translation remains applicable and URL-only action does not enter no-context board", () =>
        {
            var url = Projection().Features[0]; var general = Projection(null).Features[0];
            var context = new NativeLauncherTextContext("text", "selected-text", "PRIVATE_SELECTION_SENTINEL 中文", 1);
            if (SuperPanelFeatureMatcher.MatchesSelection(url, context) || !SuperPanelFeatureMatcher.MatchesSelection(general, context)
                || SuperPanelFeatureMatcher.IsGeneral(url)) throw new Exception("Legacy context behavior changed.");
            return Task.CompletedTask;
        });
        await Check("URL matching uses original bounded text and rejects malformed Unicode", () =>
        {
            var row = Projection().Features[0]; const string prefix = "https://example.com/?q=";
            bool Match(string text) => SuperPanelFeatureMatcher.MatchesSelection(row, new("text", "selected-text", text, 1));
            if (!Match(prefix + new string('x', 3000 - prefix.Length)) || Match(prefix + new string('x', 3001 - prefix.Length))
                || Match(prefix + new string('x', 500) + " interior space") || Match(prefix + "\uD800"))
                throw new Exception("Selection bounds or full-text predicate changed.");
            return Task.CompletedTask;
        });
        await Check("isolated cache round trip persists metadata only and rejects unknown rules", async () =>
        {
            var root = Path.Combine(Path.GetTempPath(), "WebTools-6G2-" + Guid.NewGuid().ToString("N")); Directory.CreateDirectory(root);
            try
            {
                var store = new NativeFeatureProjectionStore(root);
                var value = Projection();
                using var json = JsonDocument.Parse(JsonSerializer.Serialize(value, new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase }));
                await store.AcceptAsync(json.RootElement);
                var loaded = new NativeFeatureProjectionStore(root).Load(out var status);
                if (status != "loaded" || loaded is null || !File.ReadAllText(store.CachePath).Contains("http-url")
                    || File.ReadAllText(store.CachePath).Contains("PRIVATE_SELECTION_SENTINEL")) throw new Exception("Cache did not preserve metadata-only rule.");
                try { _ = Projection("regex"); throw new Exception("Unknown rule accepted."); }
                catch (InvalidDataException) { }
            }
            finally { Directory.Delete(root, true); }
        });
        await Check("built-in selected-text actions use the current search engine and bounded URL rule", () =>
        {
            var ordinary = new NativeLauncherTextContext("text", "selected-text", "WebTools 插件平台", 1);
            var url = new NativeLauncherTextContext("text", "selected-text", "  https://example.com/path?q=1  ", 1);
            var none = SuperPanelBuiltInTextActions.Create(null);
            var ordinaryActions = SuperPanelBuiltInTextActions.Create(ordinary);
            var urlActions = SuperPanelBuiltInTextActions.Create(url);
            if (none.Count != 0 || ordinaryActions.Select(item => item.Kind).SequenceEqual([SuperPanelBuiltInTextActionKind.SearchSelectedText]) is false
                || urlActions.Select(item => item.Kind).SequenceEqual([SuperPanelBuiltInTextActionKind.SearchSelectedText, SuperPanelBuiltInTextActionKind.OpenSelectedLink]) is false)
                throw new Exception("Built-in action discovery does not match selected-text context.");

            var snapshot = new WebsiteSnapshot([], [
                new("google", "Google", "https://www.google.com/search?q=%s", true),
                new("custom", "Custom", "https://search.example.test/find?term=%s", true),
            ], "custom", false, "", false);
            var search = SuperPanelBuiltInTextActions.CreateStartInfo(ordinaryActions[0], ordinary, snapshot);
            var open = SuperPanelBuiltInTextActions.CreateStartInfo(urlActions[1], url, snapshot);
            if (!search.UseShellExecute || search.FileName != "https://search.example.test/find?term=WebTools%20%E6%8F%92%E4%BB%B6%E5%B9%B3%E5%8F%B0"
                || !open.UseShellExecute || open.FileName != "https://example.com/path?q=1")
                throw new Exception("Built-in action launch did not use the current engine or validated URL.");
            return Task.CompletedTask;
        });
        await Check("built-in selected-text actions reject mismatched activation context", () =>
        {
            var action = SuperPanelBuiltInTextActions.Create(new("text", "selected-text", "query", 1)).Single();
            var snapshot = WebsiteDataLoader.Empty();
            foreach (var invalid in new NativeLauncherTextContext?[]
            {
                null,
                new("text", "launcher-input", "query", 1),
                new("files", "explorer-selection", null, 1, [new("file", @"C:\fixture.txt")]),
                new("text", "selected-text", "", 1),
            })
            {
                try { _ = SuperPanelBuiltInTextActions.CreateStartInfo(action, invalid, snapshot); throw new Exception("Mismatched context was accepted."); }
                catch (InvalidOperationException) { }
            }
            return Task.CompletedTask;
        });
        Console.WriteLine($"Selected-text matching checks: {total - failed}/{total} PASS");
        return failed == 0 ? 0 : 1;
    }
}
