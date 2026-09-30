using WebTools.NativeHost.Models;
using WebTools.NativeHost.Search;
using WebTools.NativeHost.Catalog;
using WebTools.NativeHost.Data;
using WebTools.NativeHost.Files;
using WebTools.NativeHost.Services;
using System.Text.Json;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Reflection;
using System.IO;
using System.IO.Pipes;
using System.Security.Principal;
using System.Text;
using System.Threading;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Interop;
using WebTools.NativeHost.Interop;

void ReportSnapshotTiming()
{
    var store = new AppCatalogSnapshotStore(AppCatalogSnapshotStore.DefaultPath);
    var loadClock = Stopwatch.StartNew();
    if (!store.TryLoad(out var snapshot, out var reason) || snapshot is null)
    {
        Console.WriteLine($"Catalog snapshot timing unavailable: {reason}");
        return;
    }
    loadClock.Stop();
    var catalog = new AppCatalogService();
    var restoreClock = Stopwatch.StartNew();
    catalog.RestoreSnapshot(snapshot.Apps);
    restoreClock.Stop();
    var indexClock = Stopwatch.StartNew();
    var search = new SearchCore(catalog.Apps.Select(app => app.AsSearchEntry()), []);
    indexClock.Stop();
    var queryClock = Stopwatch.StartNew();
    _ = search.Search(SearchCommand.Parse("visual"));
    queryClock.Stop();
    Console.WriteLine($"Catalog snapshot timing: apps={catalog.Apps.Count}; deserialize+validate={loadClock.Elapsed.TotalMilliseconds:F2} ms; restore={restoreClock.Elapsed.TotalMilliseconds:F2} ms; app index build={indexClock.Elapsed.TotalMilliseconds:F2} ms; first query={queryClock.Elapsed.TotalMilliseconds:F2} ms; total={loadClock.Elapsed.TotalMilliseconds + restoreClock.Elapsed.TotalMilliseconds + indexClock.Elapsed.TotalMilliseconds:F2} ms");
}

if (args.Contains("--snapshot-timing-only", StringComparer.Ordinal))
{
    ReportSnapshotTiming();
    return 0;
}

if (args.Length == 2 && args[0] == "--verify-manager-discovery")
{
    try
    {
        VerifyPackagedManagerDiscovery(args[1]);
        return 0;
    }
    catch (Exception error)
    {
        Console.Error.WriteLine($"FAIL packaged Manager discovery: {error.GetBaseException().Message}");
        return 1;
    }
}

static string BuildLegacyV2Profile(bool invalidOptionalDescription = false)
{
    var description = invalidOptionalDescription ? (object)42 : "Legacy documentation entry";
    var profile = new
    {
        version = 2,
        webEntries = new[]
        {
            new
            {
                id = "legacy-docs",
                name = "Legacy Docs",
                url = "https://docs.example/manual?from=legacy",
                description,
                favicon = "legacy-favicon-fixture-only",
                folderIds = new[] { "legacy-folder" },
                createdAt = 1700000000000L,
            },
        },
        bookmarkFolders = new[]
        {
            new { id = "legacy-folder", name = "Legacy links", createdAt = 1690000000000L },
        },
        appSearchMemory = new Dictionary<string, object>
        {
            ["visualstudiocode"] = new { appId = "f000000000000001", lastUsedAt = 1700000000000L },
        },
        settings = new
        {
            searchEngines = new[]
            {
                new { id = "docs-custom", name = "Docs Search", template = "https://search.example/find?q=%s", builtIn = false, enabled = true, order = 0 },
            },
            defaultSearchEngineId = "docs-custom",
            quickSearchShortcut = "Control+Alt+J",
            launchOnStartup = true,
            websiteLayout = "list",
            everythingEnabled = true,
            everythingEsPath = @"C:\Program Files\Everything\es.exe",
            aiBaseUrl = "https://legacy-ai.example/v1",
            aiModel = "legacy-model-fixture-only",
            sharedAI = new
            {
                defaultProviderId = "custom",
                providers = new { custom = new { model = "legacy-model-fixture-only", baseUrl = "https://legacy-ai.example/v1" } },
            },
            translation = new { engine = "mymemory", sourceLanguage = "auto", targetLanguage = "zh-CN", qwenMtModel = "qwen-mt-flash" },
            theme = "light",
            launcherDisplayMode = "expanded",
        },
    };
    return JsonSerializer.Serialize(profile, new JsonSerializerOptions { WriteIndented = true });
}

var state = new LauncherInteractionState();
var checks = new List<(string Name, Action Run)>
{
    ("Phase 4E resource test mode is opt-in and validates isolated driver arguments", VerifyPhase4EResourceDriverOptions),
    ("update preparation protocol is available for strict validation", VerifyUpdatePreparationProtocol),
    ("real RegisterHotKey collision preserves the current shortcut", VerifyHotkeyConflictTransaction),
    ("pinyin and initials retain Electron corpus readings", () =>
    {
        Assert(PinyinConverter.Syllables("星河编辑器").SequenceEqual(["xing", "he", "bian", "ji", "qi"]), "Chinese display name reading");
        Assert(PinyinConverter.Syllables("重庆银行").SequenceEqual(["chong", "qing", "yin", "hang"]), "Polyphonic phrase reading");
        var search = new SearchCore([SearchEntry.Application("f000000000000003", "文件资源管理器", ["File Explorer"])], []);
        Assert(search.Search(SearchCommand.Parse("wenjian"))[0].Id == "f000000000000003", "Full pinyin query");
        Assert(search.Search(SearchCommand.Parse("wjzy"))[0].Id == "f000000000000003", "Initials query");
    }),
    ("translation candidate accepts extended Latin letters but excludes mixed scripts", () =>
    {
        Assert(SearchCore.IsTranslationCandidate("café ḍ"), "Extended Latin phrase should be eligible.");
        Assert(!SearchCore.IsTranslationCandidate("hello你好"), "Mixed Han and Latin should not show translation.");
    }),
    ("remembered app promotes matching result before top-eight limit", () =>
    {
        var apps = Enumerable.Range(1, 9).Select(n => SearchEntry.Application(n.ToString("x16"), $"Parity App {n:00}", [])).ToArray();
        var search = new SearchCore(apps, []);
        search.RememberApplication("parity", apps[8].Id);
        var results = search.Search(SearchCommand.Parse("parity"));
        Assert(results[0].Id == apps[8].Id, "Remembered application should be first.");
        Assert(results.Count == 9 && results[^1].Kind == ResultKind.Translation, "Eight local rows plus translation action.");
    }),
    ("actions use typed shell targets without command interpolation", () =>
    {
        var app = new CatalogApp("f000000000000000", "Device Manager", [], "system", new SystemTarget("device-manager"), null);
        var start = ResultActionExecutor.ForApplication(app);
        Assert(start.FileName == "mmc.exe" && start.ArgumentList.SequenceEqual(["devmgmt.msc"]), "Device Manager must use fixed executable and argument.");
        Assert(start.UseShellExecute, "Windows app launch must use shell integration.");
        Assert(ResultActionExecutor.ForUrl("https://example.com/path").FileName == "https://example.com/path", "Website action must open the stored URL.");
    }),
    ("Everything arguments keep query as one literal argument", () =>
    {
        var args = EverythingClient.BuildArguments("中文 notes", 8, true, true);
        Assert(args[^1] == "中文 notes" && args[^2] == "--", "Query must not be shell interpolated.");
        Assert(args.Contains("-json") && args.Contains("-argv"), "Current ES capabilities must select JSON and Unicode argv.");
    }),
    ("latest search generation rejects stale response", () =>
    {
        var generation = new LatestSearchGeneration();
        var old = generation.Next();
        var current = generation.Next();
        Assert(old.Token.IsCancellationRequested, "Older request must be cancelled.");
        Assert(!generation.IsCurrent(old.Sequence) && generation.IsCurrent(current.Sequence), "Only latest generation can publish results.");
        generation.Dispose();
    }),
    ("website loader is read-only and follows selected engine", () =>
    {
        var path = Path.Combine(Path.GetTempPath(), $"webtools-native-check-{Guid.NewGuid():N}.json");
        var json = """{"version":2,"webEntries":[{"id":"site-1","name":"Orbit Docs","url":"https://docs.example/handbook","description":"manual"}],"settings":{"searchEngines":[{"id":"google","name":"Google","template":"https://www.google.com/search?q=%s","enabled":true},{"id":"baidu","name":"百度","template":"https://www.baidu.com/s?wd=%s","enabled":true}],"defaultSearchEngineId":"baidu","everythingEnabled":true,"everythingEsPath":"C:\\Tools\\es.exe","launcherDisplayMode":"expanded"}}""";
        File.WriteAllText(path, json);
        try
        {
            var snapshot = WebsiteDataLoader.Read(path);
            Assert(snapshot.Websites.Count == 1 && snapshot.Websites[0].Aliases.Contains("https://docs.example/handbook"), "Website URL must be indexed as alias.");
            Assert(snapshot.BuildWebSearchUrl("hello world") == "https://www.baidu.com/s?wd=hello%20world", "Selected engine must be used.");
            Assert(snapshot.ExpandedByDefault, "Launcher display preference must be read.");
            Assert(File.ReadAllText(path) == json, "Loader must never write production data.");
        }
        finally { File.Delete(path); }
    }),
    ("saved website favicons remain native and never change the website projection", () =>
    {
        var path = Path.Combine(Path.GetTempPath(), $"webtools-native-icons-{Guid.NewGuid():N}.json");
        using var bitmap = new System.Drawing.Bitmap(2, 2);
        using var stream = new MemoryStream();
        bitmap.Save(stream, System.Drawing.Imaging.ImageFormat.Png);
        var icon = "data:image/png;base64," + Convert.ToBase64String(stream.ToArray());
        File.WriteAllText(path, JsonSerializer.Serialize(new { webEntries = new[] { new { id = "site-1", favicon = icon }, new { id = "site-2", favicon = "invalid" } } }));
        try
        {
            var icons = WebsiteFaviconReader.Read(path, ["site-1", "site-2"]);
            Assert(icons.Count == 1 && icons.TryGetValue("site-1", out var savedIcon) && savedIcon.PixelWidth > 0,
                $"A saved image favicon should render while malformed metadata falls back (count={icons.Count}).");
            Assert(WebsiteFaviconReader.Read(path, ["missing"]).Count == 0, "Only requested website icons should be retained.");
        }
        finally { File.Delete(path); }
    }),
    ("catalog merges aliases only for identical invocations", () =>
    {
        var sameTarget = new ExecutableTarget(@"C:\Tools\Editor.exe");
        var records = AppCatalogService.Merge([
            new AppRecord("Editor", ["First"], "desktop", sameTarget),
            new AppRecord("Editor Alias", ["Second"], "desktop", sameTarget),
            new AppRecord("Editor Workspace", [], "desktop", new ShortcutTarget("other.lnk", @"C:\Tools\Editor.exe", "--workspace", @"C:\Work")),
        ]);
        Assert(records.Count == 2, "Different arguments or cwd must retain distinct apps.");
        Assert(records[0].Aliases.Contains("Editor Alias"), "Duplicate name must remain searchable as alias.");
        Assert(records[0].Aliases.Contains("Second"), "Duplicate aliases must merge.");
        Assert(records[0].Id.Length == 16 && records[0].Id.All(Uri.IsHexDigit), "Catalog ID must retain Electron's hash format.");
    }),
    ("packaged catalog records retain a lazy AUMID icon reference", () =>
    {
        const string aumid = "Contoso.Reader_123abc!MainApp";
        var app = AppCatalogService.Merge([
            new AppRecord("Reader", [aumid], "packaged", new PackagedTarget(aumid)),
        ]).Single();
        Assert(app.IconReference == $"appx:{aumid}", "Packaged records need an opaque AUMID icon reference so visible rows can resolve their icon lazily.");
    }),
    ("package manifest icon application ID matching is exact", () =>
    {
        var root = Path.Combine(Path.GetTempPath(), $"webtools-packaged-icon-id-{Guid.NewGuid():N}");
        Directory.CreateDirectory(Path.Combine(root, "Assets"));
        File.WriteAllBytes(Path.Combine(root, "Assets", "Logo.png"), []);
        File.WriteAllText(Path.Combine(root, "AppxManifest.xml"), """<Package xmlns:uap="http://schemas.microsoft.com/appx/manifest/uap/windows10"><Applications><Application Id="mainapp"><uap:VisualElements Square44x44Logo="Assets\Logo.png" /></Application></Applications></Package>""");
        try
        {
            Assert(ResolvePackagedIconAsset(root, "MainApp", 32, 100, "dark") is null,
                "A different manifest application ID must not be mistaken for the requested app.");
        }
        finally { Directory.Delete(root, recursive: true); }
    }),
    ("package manifest icon selection honors target size and theme variants", () =>
    {
        var root = Path.Combine(Path.GetTempPath(), $"webtools-packaged-icon-{Guid.NewGuid():N}");
        var assets = Path.Combine(root, "Assets");
        Directory.CreateDirectory(assets);
        var manifest = """<Package xmlns:uap="http://schemas.microsoft.com/appx/manifest/uap/windows10"><Applications><Application Id="MainApp"><uap:VisualElements Square44x44Logo="Assets\Square44x44Logo.png" /></Application></Applications></Package>""";
        File.WriteAllText(Path.Combine(root, "AppxManifest.xml"), manifest);
        foreach (var file in new[]
        {
            "Square44x44Logo.png",
            "Square44x44Logo.scale-200.png",
            "Square44x44Logo.targetsize-32.png",
            "Square44x44Logo.targetsize-32.theme-dark.png",
            "Square44x44Logo.targetsize-32.theme-light.png",
        }) File.WriteAllBytes(Path.Combine(assets, file), []);

        try
        {
            var dark = ResolvePackagedIconAsset(root, "MainApp", 32, 200, "dark");
            var light = ResolvePackagedIconAsset(root, "MainApp", 32, 200, "light");
            Assert(dark is not null && Path.GetFileName(dark) == "Square44x44Logo.targetsize-32.theme-dark.png",
                "The matching dark target-size asset should win over a generic or scale-only image.");
            Assert(light is not null && Path.GetFileName(light) == "Square44x44Logo.targetsize-32.theme-light.png",
                "The matching light target-size asset should be selected for light mode.");
        }
        finally { Directory.Delete(root, recursive: true); }
    }),
    ("package manifest asset paths cannot escape the package root", () =>
    {
        var root = Path.Combine(Path.GetTempPath(), $"webtools-packaged-icon-traversal-{Guid.NewGuid():N}");
        Directory.CreateDirectory(root);
        File.WriteAllText(Path.Combine(root, "AppxManifest.xml"), """<Package xmlns:uap="http://schemas.microsoft.com/appx/manifest/uap/windows10"><Applications><Application Id="MainApp"><uap:VisualElements Square44x44Logo="../outside.png" /></Application></Applications></Package>""");
        try
        {
            Assert(ResolvePackagedIconAsset(root, "MainApp", 32, 100, "dark") is null,
                "A manifest path escaping the package root must be rejected.");
        }
        finally { Directory.Delete(root, recursive: true); }
    }),
    ("malformed package manifests safely return no icon", () =>
    {
        var root = Path.Combine(Path.GetTempPath(), $"webtools-packaged-icon-invalid-{Guid.NewGuid():N}");
        Directory.CreateDirectory(root);
        File.WriteAllText(Path.Combine(root, "AppxManifest.xml"), "<Package><Applications>");
        try
        {
            Assert(ResolvePackagedIconAsset(root, "MainApp", 32, 100, "dark") is null,
                "A damaged manifest must fall back without throwing.");
        }
        finally { Directory.Delete(root, recursive: true); }
    }),
    ("packaged icon cache dispatches lazily, caches per theme, and isolates failure", () =>
    {
        RunOnSta(() =>
        {
            var bitmap = System.Windows.Media.Imaging.BitmapSource.Create(1, 1, 96, 96,
                System.Windows.Media.PixelFormats.Bgra32, null, new byte[] { 0, 0, 0, 0 }, 4);
            bitmap.Freeze();
            var theme = "dark";
            var calls = 0;
            var outcomes = new List<string>();
            var cache = new NativeIconCache(64, () => theme, (aumid, requestedTheme) =>
            {
                calls++;
                Assert(aumid == "Contoso.Reader_123abc!MainApp", "Only the opaque AUMID should reach the package resolver.");
                return requestedTheme == "light"
                    ? new PackagedIconExtraction(null, "package-not-found")
                    : new PackagedIconExtraction(bitmap, "resolved");
            }, outcomes.Add);

            Assert(cache.Count == 0 && calls == 0, "Icon resolution must remain lazy until requested.");
            Assert(cache.GetAsync("appx:Contoso.Reader_123abc!MainApp").GetAwaiter().GetResult() is not null, "A packaged icon should be returned.");
            Assert(cache.GetAsync("appx:Contoso.Reader_123abc!MainApp").GetAwaiter().GetResult() is not null && calls == 1,
                "The same packaged icon should be served from cache.");
            theme = "light";
            Assert(cache.GetAsync("appx:Contoso.Reader_123abc!MainApp").GetAwaiter().GetResult() is null && calls == 2,
                "Theme-specific cache entries must re-resolve after the system theme changes.");
            Assert(cache.GetAsync("appx:Contoso.Reader_123abc!MainApp").GetAwaiter().GetResult() is null && calls == 2,
                "A failed lookup should be negatively cached and use the UI's generic icon fallback.");
            Assert(outcomes.SequenceEqual(["resolved", "package-not-found"]), "Only lookup outcomes should be recorded; package paths must not be exposed.");
            Assert(cache.Count == 2 && cache.ApproximateBitmapBytes == 4, "Both positive and negative entries remain bounded and accounted for.");
        });
    }),
    ("tray icon resolves app.ico from executable directory with safe fallback", () =>
    {
        var baseDirectory = Path.Combine(Path.GetTempPath(), $"webtools-tray-icon-{Guid.NewGuid():N}");
        Directory.CreateDirectory(baseDirectory);
        try
        {
            var expected = Path.Combine(baseDirectory, "app.ico");
            Assert(TrayIconService.ResolveIconPath(baseDirectory) is null, "Missing branded icon should select the system fallback.");
            File.WriteAllBytes(expected, []);
            Assert(TrayIconService.ResolveIconPath(baseDirectory) == expected, "Tray icon lookup must be relative to the executable directory.");
        }
        finally { Directory.Delete(baseDirectory, recursive: true); }
    }),
    ("launcher drag gesture waits for threshold and only starts once per press", () =>
    {
        RunOnSta(() =>
        {
            var surface = new Grid();
            var icon = new TextBlock();
            surface.Children.Add(icon);
            var gesture = new LauncherDragGesture();
            var origin = new System.Windows.Point(10, 10);
            Assert(gesture.BeginFrom(origin, icon, surface), "A designated drag surface should arm the gesture.");
            Assert(!gesture.TryBeginDrag(new System.Windows.Point(13, 10), true, 4, 4), "A click-sized movement should remain a click.");
            Assert(!gesture.TryBeginDrag(new System.Windows.Point(20, 10), false, 4, 4), "Released mouse must not begin a window drag.");
            Assert(gesture.BeginFrom(origin, icon, surface), "A new press should arm another gesture.");
            Assert(gesture.TryBeginDrag(new System.Windows.Point(14, 10), true, 4, 4), "Crossing the horizontal drag threshold should begin a window drag.");
            Assert(!gesture.TryBeginDrag(new System.Windows.Point(20, 10), true, 4, 4), "One press should start at most one window drag.");
            Assert(gesture.BeginFrom(origin, icon, surface), "A new press should arm another gesture.");
            Assert(gesture.TryBeginDrag(new System.Windows.Point(10, 14), true, 4, 4), "Crossing the vertical drag threshold should begin a window drag.");
        });
    }),
    ("launcher drag gesture starts only from designated non-interactive search bar surface", (Action)(() =>
    {
        RunOnSta(() =>
        {
            var window = new Grid();
            var searchBar = new Grid();
            var searchIcon = new TextBlock();
            var query = new TextBox { Text = "utools" };
            query.Select(1, 3);
            var brandButton = new Button();
            searchBar.Children.Add(searchIcon);
            searchBar.Children.Add(query);
            searchBar.Children.Add(brandButton);
            window.Children.Add(searchBar);

            var resultRow = new ListBoxItem();
            var resultContainer = new StackPanel();
            resultContainer.Children.Add(resultRow);
            window.Children.Add(resultContainer);
            var shortcutCard = new Button();
            window.Children.Add(shortcutCard);
            var scrollbar = new System.Windows.Controls.Primitives.ScrollBar();
            window.Children.Add(scrollbar);

            var gesture = new LauncherDragGesture();
            var origin = new System.Windows.Point(10, 10);
            bool BeginFrom(System.Windows.DependencyObject source) => gesture.BeginFrom(origin, source, searchBar);
            bool StartsWindowDrag() => gesture.TryBeginDrag(new System.Windows.Point(20, 10), true, 4, 4);

            Assert(BeginFrom(searchIcon) && StartsWindowDrag(), "The designated search bar surface should start a window drag after the threshold.");
            Assert(!BeginFrom(resultRow) && !StartsWindowDrag(), "Dragging a result row must not move the window.");
            Assert(!BeginFrom(shortcutCard) && !StartsWindowDrag(), "Dragging a shortcut card must not move the window.");
            Assert(!BeginFrom(scrollbar) && !StartsWindowDrag(), "Interacting with the scrollbar must not move the window.");
            Assert(!BeginFrom(brandButton) && !StartsWindowDrag(), "Clicking the brand button must not start a window drag.");
            Assert(!BeginFrom(query) && !StartsWindowDrag(), "Selecting text in the search box must not start a window drag.");
        });
    })),
    ("launcher drag allows blank SearchBox space while rendered text keeps native selection", (Action)(() =>
    {
        RunOnSta(() =>
        {
            var query = new TextBox
            {
                Text = "utools",
                Width = 420,
                Height = 56,
                Padding = new Thickness(0),
                VerticalContentAlignment = VerticalAlignment.Center,
            };
            var searchBar = new Grid { Width = 420, Height = 56 };
            searchBar.Children.Add(query);
            var window = new Window
            {
                Content = searchBar,
                Width = 440,
                Height = 76,
                Left = -2000,
                Top = -2000,
                ShowInTaskbar = false,
                ShowActivated = false,
                WindowStyle = WindowStyle.None,
            };

            try
            {
                window.Show();
                window.UpdateLayout();

                var leading = query.GetRectFromCharacterIndex(0, false);
                var trailing = query.GetRectFromCharacterIndex(0, true);
                var renderedTextPoint = new System.Windows.Point((leading.X + trailing.X) / 2, leading.Y + leading.Height / 2);
                var blankPoint = new System.Windows.Point(query.ActualWidth - 8, query.ActualHeight / 2);
                var renderedTextSource = System.Windows.Media.VisualTreeHelper.HitTest(query, renderedTextPoint)?.VisualHit ?? query;
                var blankTextSource = System.Windows.Media.VisualTreeHelper.HitTest(query, blankPoint)?.VisualHit ?? query;
                Assert(query.GetCharacterIndexFromPoint(renderedTextPoint, false) >= 0,
                    $"The measured point inside rendered query text should map to a text character (size={query.ActualWidth}x{query.ActualHeight}, leading={leading}, trailing={trailing}, point={renderedTextPoint}).");
                Assert(query.GetCharacterIndexFromPoint(blankPoint, false) == -1,
                    "The wide empty right side of the TextBox should not map to rendered text.");

                var gesture = new LauncherDragGesture();
                var origin = new System.Windows.Point(40, 40);
                Assert(!gesture.BeginFrom(origin, renderedTextSource, searchBar, query, renderedTextPoint),
                    "Rendered text must remain a native caret/selection target instead of becoming a drag source.");
                Assert(gesture.BeginFrom(origin, blankTextSource, searchBar, query, blankPoint),
                    "The blank right side of the TextBox should arm a window drag candidate.");
                Assert(gesture.TryBeginDrag(new System.Windows.Point(50, 40), true, 4, 4),
                    "Dragging from blank TextBox space beyond the system threshold should move the window.");
                Assert(gesture.BeginFrom(origin, searchBar, searchBar),
                    "The SearchBar blank surface should remain a draggable area.");
            }
            finally
            {
                window.Close();
            }
        });
    })),
    ("tray menu palette follows the launcher light and dark surfaces", () =>
    {
        var dark = LauncherTrayMenuPalette.ForTheme("dark");
        var light = LauncherTrayMenuPalette.ForTheme("light");
        Assert(dark.Background == System.Drawing.ColorTranslator.FromHtml("#18191b"), "Dark tray menu background should match the dark Launcher surface.");
        Assert(dark.Foreground == System.Drawing.ColorTranslator.FromHtml("#f4f4f5"), "Dark tray menu text should match the dark Launcher text.");
        Assert(dark.Hover == System.Drawing.ColorTranslator.FromHtml("#242528"), "Dark tray menu hover should match the dark Launcher hover surface.");
        Assert(light.Background == System.Drawing.ColorTranslator.FromHtml("#ffffff"), "Light tray menu background should match the light Launcher surface.");
        Assert(light.Foreground == System.Drawing.ColorTranslator.FromHtml("#1b2633"), "Light tray menu text should match the light Launcher text.");
        Assert(light.Hover == System.Drawing.ColorTranslator.FromHtml("#edf2f7"), "Light tray menu hover should match the light Launcher hover surface.");
    }),
    ("tray menu items leave enough width for their complete labels", () =>
    {
        RunOnSta(() =>
        {
            using var menu = new System.Windows.Forms.ContextMenuStrip { ShowCheckMargin = false, ShowImageMargin = false };
            foreach (var label in new[] { "Open WebTools", "Websites", "Translation", "Settings", "Exit" })
                menu.Items.Add(TrayIconService.CreateMenuItem(label, () => { }));
            TrayIconService.EnsureMenuWidth(menu);
            var preferred = menu.GetPreferredSize(System.Drawing.Size.Empty);
            Assert(preferred.Width >= 100, "Tray menu must size itself to the longest label.");
            menu.Show(new System.Drawing.Point(100, 100));
            menu.PerformLayout();
            Assert(menu.Width >= preferred.Width, "The displayed menu must not crop its preferred width.");
            Assert(menu.Items.OfType<System.Windows.Forms.ToolStripMenuItem>().All(item =>
                item.Bounds.Right <= menu.ClientRectangle.Right &&
                item.Width >= System.Windows.Forms.TextRenderer.MeasureText(item.Text, item.Font).Width),
                "Every displayed menu item must fit its full label: " + string.Join("; ", menu.Items.OfType<System.Windows.Forms.ToolStripMenuItem>().Select(item =>
                    $"{item.Text}: item={item.Width}, text={System.Windows.Forms.TextRenderer.MeasureText(item.Text, item.Font).Width}, right={item.Bounds.Right}, menu={menu.Width}")));
            menu.Close();
            Assert(menu.Items.OfType<System.Windows.Forms.ToolStripMenuItem>().All(item => item.AutoSize),
                "All tray entries must auto-size instead of using the default narrow item width.");
        });
    }),
    ("launcher theme palette follows explicit and system theme preferences", () =>
    {
        Assert(LauncherThemePalette.ResolveEffectiveTheme("light", "dark") == "light", "Explicit light theme must be honored.");
        Assert(LauncherThemePalette.ResolveEffectiveTheme("dark", "light") == "dark", "Explicit dark theme must be honored.");
        Assert(LauncherThemePalette.ResolveEffectiveTheme("system", "light") == "light", "System theme must follow Windows light mode.");
        Assert(LauncherThemePalette.ResolveEffectiveTheme("system", "dark") == "dark", "System theme must follow Windows dark mode.");
    }),
    ("packaged Manager discovery supports install paths with spaces and Chinese", () =>
    {
        var installRoot = Path.Combine(Path.GetTempPath(), $"WebTools Phase 4D 验收 {Guid.NewGuid():N}");
        var managerDirectory = Path.Combine(installRoot, "Manager");
        Directory.CreateDirectory(managerDirectory);
        try
        {
            File.WriteAllBytes(Path.Combine(managerDirectory, "WebTools.exe"), []);
            VerifyPackagedManagerDiscovery(installRoot);
        }
        finally { Directory.Delete(installRoot, recursive: true); }
    }),
    ("search contract parses commands without losing local text", () =>
    {
        Assert(SearchCommand.Parse("?openai").Mode == SearchMode.Web, "Web command");
        Assert(SearchCommand.Parse("FILE: notes ").Query == "notes", "Files command");
        Assert(SearchCommand.Parse("/handbook").Mode == SearchMode.SavedWebsites, "Website command");
        Assert(SearchCommand.Parse(" visual ").Query == "visual", "Local query");
    }),
    ("native search matches frozen Electron top-eight fixture", () =>
    {
        var path = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", "search-contract", "launcher-search-parity.json"));
        using var document = JsonDocument.Parse(File.ReadAllText(path));
        var root = document.RootElement;
        var apps = root.GetProperty("applications").EnumerateArray()
            .Select(item => SearchEntry.Application(item.GetProperty("id").GetString()!, item.GetProperty("name").GetString()!,
                item.GetProperty("aliases").EnumerateArray().Select(alias => alias.GetString()!).ToArray())).ToArray();
        var websites = root.GetProperty("websites").EnumerateArray()
            .Select(item => SearchEntry.Website(item.GetProperty("id").GetString()!, item.GetProperty("name").GetString()!,
                item.GetProperty("url").GetString()!, item.TryGetProperty("searchText", out var searchText) ? searchText.GetString() ?? "" : "")).ToArray();
        var search = new SearchCore(apps, websites);
        foreach (var testCase in root.GetProperty("cases").EnumerateArray())
        {
            var command = SearchCommand.Parse(testCase.GetProperty("raw").GetString()!);
            if (command.Mode is SearchMode.Web or SearchMode.Files) continue;
            var expected = testCase.GetProperty("results").EnumerateArray()
                .Select(result => result.GetProperty("id").GetString()!).ToArray();
            var actual = search.Search(command, null).Select(result => result.Id).ToArray();
            Assert(expected.SequenceEqual(actual), $"Fixture {testCase.GetProperty("raw").GetString()}: expected {string.Join(',', expected)}, got {string.Join(',', actual)}");
        }
    }),
    ("native integration exposes isolated launcher state and catalog snapshot stores", () =>
    {
        var hostAssembly = typeof(SearchCore).Assembly;
        Assert(hostAssembly.GetType("WebTools.NativeHost.Data.LauncherStateStore") is not null,
            "Launcher-owned settings and website projection need a dedicated store.");
        Assert(hostAssembly.GetType("WebTools.NativeHost.Catalog.AppCatalogSnapshotStore") is not null,
            "Application catalog needs a separately versioned startup snapshot store.");
        Assert(hostAssembly.GetType("WebTools.NativeHost.Services.NativePipeFrameCodec") is not null,
            "Named-pipe messages need a bounded framing codec.");
    }),
    ("website synchronization deserializes the object payload envelope", () =>
    {
        const string json = """{"websites":[{"id":"site-1","name":"Docs","url":"https://docs.example","description":"Guide","folderIds":["folder-1"]}]}""";
        var payload = JsonSerializer.Deserialize<WebsiteUpdatePayload>(json,
            new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
        Assert(payload?.Websites?.Count == 1 && payload.Websites[0].Id == "site-1",
            "Website updates must be accepted inside the object payload envelope.");
    }),
    ("manager renderer readiness releases stale waiters and retries only after a new lifecycle", () =>
    {
        var readiness = new ManagerRendererReadiness();
        var firstGeneration = readiness.Generation;
        var capturedBeforeNavigation = readiness.ReadyTask;
        readiness.MarkNotReady();
        Assert(capturedBeforeNavigation.IsCompleted, "Navigation must release waiters that captured the previous readiness signal.");
        var currentGenerationWait = readiness.ReadyTask;
        Assert(!currentGenerationWait.IsCompleted && !readiness.IsReady, "The replacement readiness signal must remain pending until the renderer is ready.");
        readiness.MarkReady();
        Assert(currentGenerationWait.IsCompleted && readiness.IsReady, "The latest renderer-ready event must release the current waiter.");
        Assert(readiness.ShouldRetryAfter(firstGeneration, hasPendingIntent: true, intentChanged: false, isDisposed: false, isShuttingDown: false),
            "A pending intent may retry after the renderer completes a new readiness cycle.");
        var stableGeneration = readiness.Generation;
        Assert(!readiness.ShouldRetryAfter(stableGeneration, hasPendingIntent: true, intentChanged: false, isDisposed: false, isShuttingDown: false),
            "An acknowledgement timeout in the same renderer generation must not retry indefinitely.");
        Assert(readiness.ShouldRetryAfter(stableGeneration, hasPendingIntent: true, intentChanged: true, isDisposed: false, isShuttingDown: false),
            "A newly queued latest intent should be attempted without waiting for another renderer lifecycle.");
        Assert(!readiness.ShouldRetryAfter(stableGeneration, hasPendingIntent: true, intentChanged: true, isDisposed: true, isShuttingDown: false),
            "Disposed controllers must not schedule retries.");
    }),
    ("application memory IPC rejects null, oversized, and malformed updates", () =>
    {
        const string appId = "f000000000000001";
        Assert(NativeManagerPipeServer.IsValidAppMemoryUpdate(new AppMemoryUpdate("vscode", appId)), "A valid application memory request should pass.");
        Assert(!NativeManagerPipeServer.IsValidAppMemoryUpdate(new AppMemoryUpdate(null, appId)), "A null query must be rejected.");
        Assert(!NativeManagerPipeServer.IsValidAppMemoryUpdate(new AppMemoryUpdate("", appId)), "An empty query must be rejected.");
        Assert(!NativeManagerPipeServer.IsValidAppMemoryUpdate(new AppMemoryUpdate(new string('x', 129), appId)), "An oversized query must be rejected.");
        Assert(!NativeManagerPipeServer.IsValidAppMemoryUpdate(new AppMemoryUpdate("vscode", null)), "A null app ID must be rejected.");
        Assert(!NativeManagerPipeServer.IsValidAppMemoryUpdate(new AppMemoryUpdate("vscode", "not-an-app-id")), "A malformed app ID must be rejected.");
        Assert(!NativeManagerPipeServer.IsValidAppMemoryUpdate(null), "A missing request must be rejected.");
    }),
    ("launcher state validation rejects malformed website projections", () =>
    {
        var malformed = LauncherStateStore.CreateDefault() with
        {
            Websites = [new LauncherWebsiteRecord("site-1", "Example", "https://example.com", "", [null!])],
        };
        Assert(!LauncherStateStore.IsValid(malformed), "A null folder ID must be rejected without throwing.");
    }),
    ("legacy Electron v2 profile imports Launcher-owned settings and excludes Manager secrets", () =>
    {
        var directory = Path.Combine(Path.GetTempPath(), $"webtools-native-migration-full-{Guid.NewGuid():N}");
        Directory.CreateDirectory(directory);
        var legacyPath = Path.Combine(directory, "nook-data.json");
        var statePath = Path.Combine(directory, "launcher-state.json");
        var secretPath = Path.Combine(directory, "secrets.json");
        var legacyFixture = BuildLegacyV2Profile();
        const string fakeSecretStore = "{\"ai-api-key\":\"fixture-only-ciphertext-not-a-real-credential\",\"openai-key\":\"fixture-only-provider-ciphertext\"}";
        File.WriteAllText(legacyPath, legacyFixture);
        File.WriteAllText(secretPath, fakeSecretStore);
        var legacyBefore = File.ReadAllText(legacyPath);
        try
        {
            var store = new LauncherStateStore(statePath);
            var migrated = store.LoadOrMigrate(legacyPath, out var status);
            Assert(status == "migrated-v2-once", $"The first isolated load should run the legacy v2 migration; actual status was '{status}'.");
            Assert(migrated.SchemaVersion == 1 && migrated.QuickSearchShortcut == "Control+Alt+J", "The Native schema version and hotkey should be imported.");
            Assert(migrated.Theme == "light" && migrated.LauncherDisplayMode == "expanded" && migrated.LaunchOnStartup, "Theme, display mode, and startup preference should be imported.");
            Assert(migrated.DefaultSearchEngineId == "docs-custom" && migrated.SearchEngines.Single().Template == "https://search.example/find?q=%s", "The selected custom engine and template should be imported.");
            Assert(migrated.EverythingEnabled && migrated.EverythingEsPath == @"C:\Program Files\Everything\es.exe", "The Launcher-owned Everything preference should be imported.");
            var website = migrated.Websites.Single();
            Assert(website.Id == "legacy-docs" && website.Name == "Legacy Docs" && website.Url == "https://docs.example/manual?from=legacy" && website.Description == "Legacy documentation entry" && website.FolderIds.SequenceEqual(["legacy-folder"]), "The website search projection should preserve supported fields.");
            Assert(migrated.AppSearchMemory.Count == 1 && migrated.AppSearchMemory[0] == new AppSearchMemoryRecord("visualstudiocode", "f000000000000001", 1700000000000L), "Application search memory should be imported.");

            var persisted = File.ReadAllText(statePath);
            using var document = JsonDocument.Parse(persisted);
            Assert(document.RootElement.GetProperty("schemaVersion").GetInt32() == 1, "launcher-state.json should use the current Native schema version.");
            Assert(!persisted.Contains("aiBaseUrl", StringComparison.Ordinal) && !persisted.Contains("sharedAI", StringComparison.Ordinal) && !persisted.Contains("translation", StringComparison.Ordinal), "Manager-only AI and translation settings must not enter Native launcher state.");
            Assert(!persisted.Contains("legacy-ai.example", StringComparison.Ordinal) && !persisted.Contains("legacy-model-fixture-only", StringComparison.Ordinal) && !persisted.Contains("fixture-only-ciphertext", StringComparison.Ordinal), "No AI endpoint, model, or SecretStore fixture data may enter Native state.");
            Assert(!persisted.Contains("legacy-favicon-fixture-only", StringComparison.Ordinal), "The Native website projection must not copy the stored favicon payload.");
            Assert(File.ReadAllText(legacyPath) == legacyBefore, "Migration must not rewrite the legacy Electron file.");
            Assert(File.ReadAllText(secretPath) == fakeSecretStore, "Migration must not rewrite the isolated SecretStore fixture.");
        }
        finally { Directory.Delete(directory, recursive: true); }
    }),
    ("legacy migration is idempotent on a second launch without duplicate data", () =>
    {
        var directory = Path.Combine(Path.GetTempPath(), $"webtools-native-migration-idempotent-{Guid.NewGuid():N}");
        Directory.CreateDirectory(directory);
        var legacyPath = Path.Combine(directory, "nook-data.json");
        var statePath = Path.Combine(directory, "launcher-state.json");
        var legacyFixture = BuildLegacyV2Profile();
        File.WriteAllText(legacyPath, legacyFixture);
        try
        {
            var first = new LauncherStateStore(statePath).LoadOrMigrate(legacyPath, out var firstStatus);
            var stateAfterFirstLaunch = File.ReadAllText(statePath);
            var second = new LauncherStateStore(statePath).LoadOrMigrate(legacyPath, out var secondStatus);
            Assert(firstStatus == "migrated-v2-once" && secondStatus == "loaded", $"The first launch should migrate and the next launch should load Native state; statuses were '{firstStatus}' and '{secondStatus}'.");
            Assert(second.Websites.Count == 1 && second.AppSearchMemory.Count == 1, "A repeated load must not duplicate website or app memory records.");
            Assert(File.ReadAllText(statePath) == stateAfterFirstLaunch, "A valid Native state must not be rewritten on the second launch.");
            Assert(File.ReadAllText(legacyPath) == legacyFixture, "Both launches must leave the legacy Electron profile byte-for-byte unchanged.");
            Assert(first.Websites.Count == second.Websites.Count && first.AppSearchMemory.Count == second.AppSearchMemory.Count, "The imported Launcher projection should be stable across launches.");
        }
        finally { Directory.Delete(directory, recursive: true); }
    }),
    ("existing valid Native state takes precedence over legacy Electron settings", () =>
    {
        var directory = Path.Combine(Path.GetTempPath(), $"webtools-native-migration-native-wins-{Guid.NewGuid():N}");
        Directory.CreateDirectory(directory);
        var legacyPath = Path.Combine(directory, "nook-data.json");
        var statePath = Path.Combine(directory, "launcher-state.json");
        var legacyFixture = BuildLegacyV2Profile();
        File.WriteAllText(legacyPath, legacyFixture);
        var nativeState = LauncherStateStore.CreateDefault() with
        {
            QuickSearchShortcut = "Control+Alt+K",
            Theme = "dark",
            LauncherDisplayMode = "compact",
            SearchEngines = [new SearchEngineData("native-engine", "Native Search", "https://native.example/?q=%s", true, false, 0)],
            DefaultSearchEngineId = "native-engine",
            Websites = [new LauncherWebsiteRecord("native-site", "Native Site", "https://native.example/", "Native-owned entry", [])],
            AppSearchMemory = [new AppSearchMemoryRecord("nativequery", "f000000000000002", 1700000000001L)],
        };
        File.WriteAllText(statePath, JsonSerializer.Serialize(nativeState, new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase, WriteIndented = true }));
        var nativeBytesBefore = File.ReadAllText(statePath);
        try
        {
            var loaded = new LauncherStateStore(statePath).LoadOrMigrate(legacyPath, out var status);
            Assert(status == "loaded", $"A valid existing Native state should load without re-importing legacy settings; actual status was '{status}'.");
            Assert(loaded.QuickSearchShortcut == "Control+Alt+K" && loaded.Theme == "dark" && loaded.LauncherDisplayMode == "compact", "Native-owned hotkey, theme, and display mode should win.");
            Assert(loaded.DefaultSearchEngineId == "native-engine" && loaded.Websites.Single().Id == "native-site", "Native search-engine selection and website projection should win.");
            Assert(loaded.AppSearchMemory.Single().Query == "nativequery", "Native app-search memory should win over the legacy fixture.");
            Assert(File.ReadAllText(statePath) == nativeBytesBefore && File.ReadAllText(legacyPath) == legacyFixture, "Loading existing Native state must not rewrite either source.");
        }
        finally { Directory.Delete(directory, recursive: true); }
    }),
    ("invalid optional website description is normalized without losing the migration", () =>
    {
        var directory = Path.Combine(Path.GetTempPath(), $"webtools-native-migration-optional-field-{Guid.NewGuid():N}");
        Directory.CreateDirectory(directory);
        var legacyPath = Path.Combine(directory, "nook-data.json");
        var statePath = Path.Combine(directory, "launcher-state.json");
        var legacyFixture = BuildLegacyV2Profile(invalidOptionalDescription: true);
        File.WriteAllText(legacyPath, legacyFixture);
        try
        {
            var loaded = new LauncherStateStore(statePath).LoadOrMigrate(legacyPath, out var status);
            Assert(status == "migrated-v2-once", $"An invalid optional website description should not abort the otherwise valid legacy migration; actual status was '{status}'.");
            Assert(loaded.Theme == "light" && loaded.DefaultSearchEngineId == "docs-custom" && loaded.Websites.Single().Id == "legacy-docs", "Valid Launcher fields should remain preserved when an optional description is invalid.");
            Assert(loaded.Websites.Single().Description == "", "An invalid optional description should normalize to an empty description.");
            Assert(File.ReadAllText(legacyPath) == legacyFixture, "Normalizing the optional field must not modify the legacy source.");
        }
        finally { Directory.Delete(directory, recursive: true); }
    }),
    ("malformed legacy profile falls back deterministically without changing its source", () =>
    {
        var directory = Path.Combine(Path.GetTempPath(), $"webtools-native-migration-bad-legacy-{Guid.NewGuid():N}");
        Directory.CreateDirectory(directory);
        var legacyPath = Path.Combine(directory, "nook-data.json");
        var statePath = Path.Combine(directory, "launcher-state.json");
        const string malformedLegacy = "{\"version\":2,";
        File.WriteAllText(legacyPath, malformedLegacy);
        try
        {
            var loaded = new LauncherStateStore(statePath).LoadOrMigrate(legacyPath, out var status);
            Assert(status.StartsWith("legacy-import-fallback:", StringComparison.Ordinal), "Malformed legacy JSON should report the deterministic default fallback.");
            var defaults = LauncherStateStore.CreateDefault();
            Assert(loaded.SchemaVersion == defaults.SchemaVersion && loaded.QuickSearchShortcut == defaults.QuickSearchShortcut && loaded.Theme == defaults.Theme && loaded.LauncherDisplayMode == defaults.LauncherDisplayMode && loaded.SearchEngines.SequenceEqual(defaults.SearchEngines) && loaded.DefaultSearchEngineId == defaults.DefaultSearchEngineId && loaded.Websites.Count == 0 && loaded.AppSearchMemory.Count == 0, "Malformed legacy input should result in the defined default Native state.");
            Assert(File.ReadAllText(legacyPath) == malformedLegacy && File.Exists(statePath), "Fallback should preserve the legacy source and persist the Native defaults.");
        }
        finally { Directory.Delete(directory, recursive: true); }
    }),
    ("corrupt existing Native state is preserved and does not trigger legacy overwrite", () =>
    {
        var directory = Path.Combine(Path.GetTempPath(), $"webtools-native-migration-bad-native-{Guid.NewGuid():N}");
        Directory.CreateDirectory(directory);
        var legacyPath = Path.Combine(directory, "nook-data.json");
        var statePath = Path.Combine(directory, "launcher-state.json");
        var legacyFixture = BuildLegacyV2Profile();
        const string corruptNative = "{corrupt-native-state";
        File.WriteAllText(legacyPath, legacyFixture);
        File.WriteAllText(statePath, corruptNative);
        try
        {
            var loaded = new LauncherStateStore(statePath).LoadOrMigrate(legacyPath, out var status);
            var preservedCopies = Directory.GetFiles(directory, "launcher-state.json.corrupt-*");
            Assert(status == "corrupt-state-defaulted", "An invalid existing Native state should follow the documented default fallback.");
            var defaults = LauncherStateStore.CreateDefault();
            Assert(loaded.QuickSearchShortcut == defaults.QuickSearchShortcut && loaded.Theme == defaults.Theme && loaded.LauncherDisplayMode == defaults.LauncherDisplayMode && loaded.SearchEngines.SequenceEqual(defaults.SearchEngines) && loaded.DefaultSearchEngineId == defaults.DefaultSearchEngineId && loaded.Websites.Count == 0 && loaded.AppSearchMemory.Count == 0, "Corrupt Native state should not silently re-import or overwrite from the legacy file.");
            Assert(preservedCopies.Length == 1 && File.ReadAllText(preservedCopies[0]) == corruptNative, "The corrupt Native source should be retained for recovery.");
            Assert(File.ReadAllText(legacyPath) == legacyFixture && File.Exists(statePath), "Native fallback must preserve the legacy profile and produce a valid new state file.");
            var reloaded = new LauncherStateStore(statePath).LoadOrMigrate(legacyPath, out var reloadStatus);
            Assert(reloadStatus == "loaded" && reloaded.SchemaVersion == loaded.SchemaVersion && reloaded.QuickSearchShortcut == loaded.QuickSearchShortcut && reloaded.Theme == loaded.Theme && reloaded.LauncherDisplayMode == loaded.LauncherDisplayMode && reloaded.SearchEngines.SequenceEqual(loaded.SearchEngines) && reloaded.Websites.Count == loaded.Websites.Count, "The deterministic fallback state should load normally on the next launch.");
        }
        finally { Directory.Delete(directory, recursive: true); }
    }),
    ("catalog snapshot reloads and safely rejects corruption", () =>
    {
        var directory = Path.Combine(Path.GetTempPath(), $"webtools-native-catalog-{Guid.NewGuid():N}");
        Directory.CreateDirectory(directory);
        var path = Path.Combine(directory, "catalog.json");
        try
        {
            var app = AppCatalogService.Merge([new AppRecord("Device Manager", ["设备管理器"], "system", new SystemTarget("device-manager"))]);
            var store = new AppCatalogSnapshotStore(path);
            Assert(store.SaveIfChangedAsync(app).GetAwaiter().GetResult(), "The first catalog write should create the snapshot.");
            Assert(store.TryLoad(out var loaded, out _) && loaded is not null && loaded.Apps[0].Id == app[0].Id, "A valid catalog snapshot should reload.");
            File.WriteAllText(path, "{broken json");
            Assert(!store.TryLoad(out var invalid, out _) && invalid is null, "Corrupt cache should be rejected for a full-scan fallback.");
        }
        finally { Directory.Delete(directory, recursive: true); }
    }),
    ("empty query has no results", () =>
    {
        Assert(!state.ResultsVisible, "Empty query must keep the results hidden.");
        Assert(state.SelectedIndex == -1, "Empty query must have no selected row.");
    }),
    ("WPF ItemsSource replacement preserves default first-result selection", () =>
    {
        RunOnSta(() =>
        {
            var selectionState = new LauncherInteractionState();
            var list = new ListBox();
            var selection = new LauncherResultSelectionController(selectionState);
            list.SelectionChanged += (_, _) => selection.AcceptUserSelection(list);

            var previousResult = new SearchResult("old", ResultKind.Application, "Old", "本地应用", 1, MatchKind.Name, new LaunchApplicationAction("old"));
            selectionState.SetQuery("v");
            selection.Present(list, [previousResult], new object[] { previousResult });

            var first = new SearchResult("first", ResultKind.Application, "uTools", "本地应用", 1, MatchKind.Name, new LaunchApplicationAction("first"));
            var second = new SearchResult("second", ResultKind.Application, "Other", "本地应用", 2, MatchKind.Name, new LaunchApplicationAction("second"));
            selectionState.SetQuery("ut");
            selection.Present(list, [first, second], new object[] { first, second });

            Assert(list.SelectedIndex == 0, "Replacing rows must retain the model's default first selection.");
            Assert(selectionState.SelectedIndex == 0, "A WPF reset event must not clear the model selection.");
            Assert(selectionState.GetSelectedResult()?.Id == "first", "Enter must resolve the first current result.");
        });
    }),
    ("changing query repeatedly selects the first result for Enter", () =>
    {
        RunOnSta(() =>
        {
            var selectionState = new LauncherInteractionState();
            var selection = new LauncherResultSelectionController(selectionState);
            var list = new ListBox();
            list.SelectionChanged += (_, _) => selection.AcceptUserSelection(list);
            foreach (var query in new[] { "u", "ut", "uto", "utoo", "utool", "utools" })
            {
                var first = new SearchResult(query, ResultKind.Application, "uTools", "本地应用", 1, MatchKind.Name, new LaunchApplicationAction(query));
                selectionState.SetQuery(query);
                selection.Present(list, [first], new object[] { new TestResultRow(query) });
                Assert(list.SelectedIndex == 0 && selectionState.SelectedIndex == 0, $"'{query}' must select the first WPF row.");
                Assert(selectionState.GetSelectedResult()?.Id == query, $"Enter for '{query}' must target its current first result.");
            }
        });
    }),
    ("icon-only updates do not reset arrow selection", () =>
    {
        RunOnSta(() =>
        {
            var selectionState = new LauncherInteractionState();
            var selection = new LauncherResultSelectionController(selectionState);
            var list = new ListBox();
            list.SelectionChanged += (_, _) => selection.AcceptUserSelection(list);
            var rows = new System.Collections.ObjectModel.ObservableCollection<TestResultRow>
            {
                new("One"), new("Two"),
            };
            var results = new[]
            {
                new SearchResult("one", ResultKind.Application, "One", "本地应用", 1, MatchKind.Name, new LaunchApplicationAction("one")),
                new SearchResult("two", ResultKind.Application, "Two", "本地应用", 2, MatchKind.Name, new LaunchApplicationAction("two")),
            };
            selectionState.SetQuery("query");
            selection.Present(list, results, rows);
            selection.MoveSelection(list, 1);
            var selectedBeforeIconUpdate = selectionState.GetSelectedResult()?.Id;
            rows[0].Icon = "loaded-icon";
            Assert(list.SelectedIndex == 1 && selectionState.SelectedIndex == 1 && selectionState.GetSelectedResult()?.Id == selectedBeforeIconUpdate,
                "An icon-only row update must leave the current keyboard selection unchanged.");
        });
    }),
    ("non-empty query selects the first real result", () =>
    {
        state.SetQuery("vsc");
        state.SetResults([
            new SearchResult("app-1", ResultKind.Application, "Visual Studio Code", "本地应用", 1, MatchKind.Name, new LaunchApplicationAction("app-1")),
            new SearchResult("app-2", ResultKind.Application, "Visual Studio Installer", "本地应用", 2, MatchKind.Name, new LaunchApplicationAction("app-2")),
            new SearchResult("site-1", ResultKind.Website, "VS Docs", "https://example.com", 3, MatchKind.Alias, new OpenWebsiteAction("site-1", "https://example.com")),
        ]);
        Assert(state.Query == "vsc", "Query should be kept exactly as entered.");
        Assert(state.ResultsVisible, "Non-empty query must show results.");
        Assert(state.Results.Count == 3, "The state must expose real search results.");
        Assert(state.SelectedIndex == 0, "The first result should be selected initially.");
    }),
    ("keyboard selection wraps in both directions", () =>
    {
        Assert(state.MoveSelection(1) == 1, "Down should select the next row.");
        Assert(state.MoveSelection(1) == 2, "Down should select the last row.");
        Assert(state.MoveSelection(1) == 0, "Down should wrap to the first row.");
        Assert(state.MoveSelection(-1) == 2, "Up should wrap to the last row.");
    }),
    ("hide reset clears query and selection", () =>
    {
        state.Reset();
        Assert(state.Query.Length == 0, "Hide should clear the temporary query.");
        Assert(!state.ResultsVisible, "Hide should remove result presentation.");
        Assert(state.SelectedIndex == -1, "Hide should clear selection.");
    }),
};

var failures = new List<string>();
foreach (var (name, run) in checks)
{
    try
    {
        run();
        Console.WriteLine($"PASS {name}");
    }
    catch (Exception error)
    {
        failures.Add($"FAIL {name}: {error.Message}");
        Console.WriteLine(failures[^1]);
    }
}

Console.WriteLine($"{checks.Count - failures.Count}/{checks.Count} checks passed.");
if (args.Contains("--snapshot-timing", StringComparer.Ordinal))
    ReportSnapshotTiming();
if (args.Contains("--catalog", StringComparer.Ordinal) || args.Contains("--pinyin-corpus", StringComparer.Ordinal) || args.Contains("--catalog-parity", StringComparer.Ordinal) || args.Contains("--icons", StringComparer.Ordinal) || args.Contains("--packaged-icons", StringComparer.Ordinal) || args.Contains("--search-stress", StringComparer.Ordinal))
{
    try
    {
        var catalog = new AppCatalogService();
        var clock = System.Diagnostics.Stopwatch.StartNew();
        await catalog.RefreshAsync();
        Console.WriteLine($"Catalog scan: {catalog.Apps.Count} apps in {clock.ElapsedMilliseconds} ms");
        foreach (var app in catalog.Apps.Take(12)) Console.WriteLine($"  {app.Name} [{app.Source}] {app.Id}");
        if (args.Contains("--pinyin-corpus", StringComparer.Ordinal))
        {
            var path = Path.Combine(Path.GetTempPath(), "webtools-native-pinyin-corpus.json");
            File.WriteAllText(path, JsonSerializer.Serialize(catalog.Apps.Select(app => new { app.Name, Native = PinyinConverter.Syllables(app.Name) })));
            Console.WriteLine($"Pinyin corpus: {path}");
        }
        if (args.Contains("--catalog-parity", StringComparer.Ordinal))
        {
            var websites = WebsiteDataLoader.Read().Websites;
            var search = new SearchCore(catalog.Apps.Select(app => app.AsSearchEntry()), websites);
            var queries = new[] { "", "visual", "chrome", "note", "code", "vsc", "文件", "设置", "wenjian", "wjzy", "google", "weixin", "微信", "控制面板", "explorer", "device", "devmgmt", "/google", "?openai", "file:notes" };
            var path = Path.Combine(Path.GetTempPath(), "webtools-native-catalog-parity.json");
            File.WriteAllText(path, JsonSerializer.Serialize(new
            {
                Apps = catalog.Apps.Select(app => new { app.Id, app.Name, app.Aliases }),
                Websites = websites.Select(site => new { site.Id, site.Name, site.Url, site.SearchText }),
                Cases = queries.Select(raw => new { Raw = raw, Results = search.Search(SearchCommand.Parse(raw)).Select(row => new { row.Id, row.Title, Kind = row.Kind.ToString() }) }),
            }));
            Console.WriteLine($"Catalog parity fixture: {path}");
        }
        if (args.Contains("--icons", StringComparer.Ordinal))
        {
            var cache = new NativeIconCache(64);
            var before = GuiResources.GetGuiResources(Process.GetCurrentProcess().Handle, 0);
            var resolved = 0;
            var iconApps = catalog.Apps.Where(app => app.IconReference is not null).Take(100).ToArray();
            foreach (var app in iconApps)
                if (await cache.GetAsync(app.IconReference) is not null) resolved++;
            var afterFirst = GuiResources.GetGuiResources(Process.GetCurrentProcess().Handle, 0);
            foreach (var app in iconApps) await cache.GetAsync(app.IconReference);
            var afterSecond = GuiResources.GetGuiResources(Process.GetCurrentProcess().Handle, 0);
            Console.WriteLine($"Icons: resolved={resolved}/100;cache={cache.Count};estimatedBitmapBytes={cache.ApproximateBitmapBytes};GDI={before}->{afterFirst}->{afterSecond}");
            Assert(cache.Count <= 64, "Icon cache must be bounded.");
            Assert(afterSecond <= afterFirst + 10, "Repeated extraction must not accumulate GDI handles.");
        }
        if (args.Contains("--packaged-icons", StringComparer.Ordinal))
        {
            var packagedApps = catalog.Apps.Where(app => app.Target is PackagedTarget && app.IconReference is not null).Take(12).ToArray();
            if (packagedApps.Length == 0)
            {
                Console.WriteLine("USER MANUAL VERIFICATION: no packaged Start Apps entries are installed in this environment.");
            }
            else
            {
                var cache = new NativeIconCache(64, outcome => Console.WriteLine($"  package icon lookup: {outcome}"));
                foreach (var app in packagedApps)
                {
                    var icon = await cache.GetAsync(app.IconReference);
                    Console.WriteLine($"  {(icon is null ? "generic fallback" : "resolved")} icon: {app.Name}");
                }
            }
        }
        if (args.Contains("--search-stress", StringComparer.Ordinal))
        {
            var snapshot = WebsiteDataLoader.Read();
            var search = new SearchCore(catalog.Apps.Select(app => app.AsSearchEntry()), snapshot.Websites);
            var everything = new EverythingClient(snapshot.EverythingEsPath);
            var process = Process.GetCurrentProcess();
            process.Refresh();
            var beforePrivate = process.PrivateMemorySize64;
            var beforeGdi = GuiResources.GetGuiResources(process.Handle, 0);
            var beforeUser = GuiResources.GetGuiResources(process.Handle, 1);
            var localMs = new List<double>();
            var fileMs = new List<double>();
            var queries = new[] { "visual", "chrome", "note", "code", "vsc", "文件", "设置", "控制", "wenjian", "kongzhi", "shebei", "wj", "kz", "sb", "google", "/google", "/baidu", "?openai", "file:codexLogin", "orbit" };
            for (var cycle = 0; cycle < 50; cycle++)
            {
                foreach (var raw in queries)
                {
                    var command = SearchCommand.Parse(raw);
                    var started = Stopwatch.GetTimestamp();
                    if (command.Mode == SearchMode.Files && snapshot.EverythingEnabled)
                        await everything.SearchAsync(command.Query, CancellationToken.None);
                    else search.Search(command);
                    var elapsed = Stopwatch.GetElapsedTime(started).TotalMilliseconds;
                    (command.Mode == SearchMode.Files ? fileMs : localMs).Add(elapsed);
                }
            }
            process.Refresh();
            static (double Median, double P95) Distribution(List<double> values)
            {
                values.Sort();
                return (values[values.Count / 2], values[(int)Math.Ceiling(values.Count * .95) - 1]);
            }
            var local = Distribution(localMs);
            var files = Distribution(fileMs);
            Console.WriteLine($"1000 searches: local n={localMs.Count} median={local.Median:F3}ms p95={local.P95:F3}ms; Everything n={fileMs.Count} median={files.Median:F3}ms p95={files.P95:F3}ms");
            Console.WriteLine($"Stress process: Private={beforePrivate}->{process.PrivateMemorySize64}; WorkingSet={process.WorkingSet64}; GDI={beforeGdi}->{GuiResources.GetGuiResources(process.Handle, 0)}; USER={beforeUser}->{GuiResources.GetGuiResources(process.Handle, 1)}; threads={process.Threads.Count}");
        }
        Assert(catalog.Apps.Count >= 3, "Windows system app records must exist.");
    }
    catch (Exception error)
    {
        failures.Add($"FAIL catalog integration: {error.Message}");
        Console.WriteLine(failures[^1]);
    }
}
if (args.Contains("--everything", StringComparer.Ordinal))
{
    try
    {
        var settings = WebsiteDataLoader.Read();
        Assert(settings.EverythingEnabled, "Production Everything setting is disabled.");
        var everything = new EverythingClient(settings.EverythingEsPath);
        var results = await everything.SearchAsync("codexLogin", CancellationToken.None);
        Console.WriteLine($"Everything integration: {results.Count} results for test query");
        foreach (var result in results.Take(4)) Console.WriteLine($"  {result.Title} [{result.Kind}]");
    }
    catch (Exception error)
    {
        failures.Add($"FAIL Everything integration: {error.Message}");
        Console.WriteLine(failures[^1]);
    }
}
if (args.Contains("--actions", StringComparer.Ordinal))
{
    var directory = Path.Combine(Path.GetTempPath(), $"webtools-native-action-{Guid.NewGuid():N}");
    Directory.CreateDirectory(directory);
    var shortcutPath = Path.Combine(directory, "launch-check.lnk");
    var markerPath = Path.Combine(directory, "launched.txt");
    object? shell = null;
    object? shortcut = null;
    try
    {
        var shellType = Type.GetTypeFromProgID("WScript.Shell") ?? throw new InvalidOperationException("WScript.Shell is unavailable.");
        shell = Activator.CreateInstance(shellType) ?? throw new InvalidOperationException("Cannot create WScript.Shell.");
        shortcut = shell.GetType().InvokeMember("CreateShortcut", BindingFlags.InvokeMethod, null, shell, [shortcutPath])
            ?? throw new InvalidOperationException("Cannot create test shortcut.");
        var shortcutType = shortcut.GetType();
        var command = Environment.GetEnvironmentVariable("ComSpec") ?? Path.Combine(Environment.SystemDirectory, "cmd.exe");
        shortcutType.InvokeMember("TargetPath", BindingFlags.SetProperty, null, shortcut, [command]);
        shortcutType.InvokeMember("Arguments", BindingFlags.SetProperty, null, shortcut, [$"/d /c echo launched>\"{markerPath}\""]);
        shortcutType.InvokeMember("Save", BindingFlags.InvokeMethod, null, shortcut, null);
        var app = new CatalogApp("f000000000000004", "Launch Check", [], "desktop",
            new ShortcutTarget(shortcutPath, command, "", directory), shortcutPath);
        _ = Process.Start(ResultActionExecutor.ForApplication(app));
        var timeout = Stopwatch.StartNew();
        while (!File.Exists(markerPath) && timeout.Elapsed < TimeSpan.FromSeconds(8)) await Task.Delay(100);
        Assert(File.Exists(markerPath) && File.ReadAllText(markerPath).Contains("launched"), "Shortcut action must execute the target and arguments.");
        Console.WriteLine("PASS real shortcut launch created the expected marker without Electron");
    }
    catch (Exception error)
    {
        failures.Add($"FAIL action integration: {error.Message}");
        Console.WriteLine(failures[^1]);
    }
    finally
    {
        if (shortcut is not null && Marshal.IsComObject(shortcut)) Marshal.FinalReleaseComObject(shortcut);
        if (shell is not null && Marshal.IsComObject(shell)) Marshal.FinalReleaseComObject(shell);
        try { Directory.Delete(directory, true); } catch (IOException) { /* the launched process may still release the shortcut */ }
    }
}
return failures.Count == 0 ? 0 : 1;

static void Assert(bool condition, string message)
{
    if (!condition)
    {
        throw new InvalidOperationException(message);
    }
}

static void RunOnSta(Action action)
{
    Exception? failure = null;
    var thread = new Thread(() =>
    {
        try { action(); }
        catch (Exception error) { failure = error; }
    });
    thread.SetApartmentState(ApartmentState.STA);
    thread.Start();
    thread.Join();
    if (failure is not null) throw new InvalidOperationException($"STA WPF regression failed: {failure.Message}", failure);
}

static void VerifyHotkeyConflictTransaction()
{
    RunOnSta(VerifyHotkeyConflictTransactionOnSta);
}

static void VerifyPhase4EResourceDriverOptions()
{
    var optionsType = typeof(SearchCore).Assembly.GetType("WebTools.NativeHost.Diagnostics.Phase4EResourceTestOptions");
    Assert(optionsType is not null, "The test-only resource driver options type must exist.");
    var parse = optionsType!.GetMethod("Parse", BindingFlags.Public | BindingFlags.Static);
    Assert(parse is not null, "The resource driver must expose a testable argument parser.");

    var normal = parse!.Invoke(null, [Array.Empty<string>()]);
    Assert(normal is null, "Normal startup arguments must not enable the resource driver.");

    var root = Path.Combine(Path.GetTempPath(), "WebTools Phase4E Test");
    var snapshot = Path.Combine(root, "catalog.v1.json");
    var pipe = "WebTools.NativeHost.Resource.test-123";
    var hotkey = "Control+Alt+Shift+F12";
    var valid = parse.Invoke(null, [new[] { "--phase4e-resource-test", root, snapshot, pipe, hotkey }]);
    Assert(valid is not null, "The explicit acceptance arguments must enable the driver.");
    Assert((string?)optionsType.GetProperty("ProfileRoot")?.GetValue(valid) == root, "The isolated profile path must be preserved.");
    Assert((string?)optionsType.GetProperty("CatalogSnapshotPath")?.GetValue(valid) == snapshot, "The isolated catalog path must be preserved.");
    Assert((string?)optionsType.GetProperty("ControlPipeName")?.GetValue(valid) == pipe, "The test pipe name must be preserved.");
    Assert((string?)optionsType.GetProperty("Hotkey")?.GetValue(valid) == hotkey, "The test hotkey must be preserved.");

    var malformedRejected = false;
    try { _ = parse.Invoke(null, [new[] { "--phase4e-resource-test", root }]); }
    catch (TargetInvocationException error) when (error.InnerException is ArgumentException) { malformedRejected = true; }
    Assert(malformedRejected, "Incomplete acceptance arguments must be rejected instead of silently starting normal mode.");

    var unsafePipeRejected = false;
    try { _ = parse.Invoke(null, [new[] { "--phase4e-resource-test", root, snapshot, "bad/pipe", hotkey }]); }
    catch (TargetInvocationException error) when (error.InnerException is ArgumentException) { unsafePipeRejected = true; }
    Assert(unsafePipeRejected, "A pipe name outside the test protocol's safe alphabet must be rejected.");
}

static void VerifyUpdatePreparationProtocol()
{
    var expectedPid = Environment.ProcessId;
    var request = new UpdatePreparationRequest(1, "prepare-update", expectedPid);
    Assert(UpdatePreparationProtocol.TryParseRequest(UpdatePreparationProtocol.SerializeRequest(request), expectedPid, out var parsed, out _)
        && parsed == request, "The exact update operation and expected host PID should be accepted.");
    Assert(!UpdatePreparationProtocol.TryParseRequest("{\"protocolVersion\":2,\"operation\":\"prepare-update\",\"expectedHostProcessId\":" + expectedPid + "}", expectedPid, out _, out var versionError)
        && versionError == "PROTOCOL_VERSION", "Unsupported update protocol versions should be rejected.");
    Assert(!UpdatePreparationProtocol.TryParseRequest("{\"protocolVersion\":1,\"operation\":\"run-command\",\"expectedHostProcessId\":" + expectedPid + "}", expectedPid, out _, out var operationError)
        && operationError == "UNKNOWN_OPERATION", "The update pipe must reject operations other than prepare-update.");
    Assert(!UpdatePreparationProtocol.TryParseRequest(UpdatePreparationProtocol.SerializeRequest(request), expectedPid + 1, out _, out var pidError)
        && pidError == "HOST_PID_MISMATCH", "The update pipe must reject a request targeting another Host PID.");
    Assert(!UpdatePreparationProtocol.TryParseRequest("{\"protocolVersion\":1,\"operation\":\"prepare-update\",\"expectedHostProcessId\":" + expectedPid + ",\"path\":\"C:\\\\unsafe\"}", expectedPid, out _, out var extraError)
        && extraError == "INVALID_REQUEST", "The update request must reject unrecognized path/command fields.");
    Assert(!UpdatePreparationProtocol.TryParseRequest("{\"protocolVersion\":1,\"protocolVersion\":1,\"operation\":\"prepare-update\",\"expectedHostProcessId\":" + expectedPid + "}", expectedPid, out _, out var duplicateError)
        && duplicateError == "INVALID_REQUEST", "Duplicate protocol fields must be rejected.");
    Assert(!UpdatePreparationProtocol.TryParseRequest("{broken", expectedPid, out _, out var malformedError)
        && malformedError == "INVALID_REQUEST", "Malformed JSON must be rejected.");

    Assert(UpdatePreparationProtocol.TryParseResponse("{\"protocolVersion\":1,\"success\":false,\"errorCode\":\"MANAGER_REFUSED\"}", out var response, out _)
        && response is { Success: false, ErrorCode: "MANAGER_REFUSED" }, "A structured refusal response should parse.");
    VerifyUpdatePreparationPipeRoundTrip(managerAccepts: true).GetAwaiter().GetResult();
    VerifyUpdatePreparationPipeRoundTrip(managerAccepts: false).GetAwaiter().GetResult();
    VerifyManagerUpdateTimeoutRefusalAsync().GetAwaiter().GetResult();
}

static async Task VerifyUpdatePreparationPipeRoundTrip(bool managerAccepts)
{
    var pipeName = $"WebTools.NativeHost.Update.Checks.{Guid.NewGuid():N}";
    using var cancellation = new CancellationTokenSource();
    var managerCalled = false;
    var hostExit = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
    var server = new UpdatePreparationServer(
        pipeName,
        (timeout, _) =>
        {
            managerCalled = true;
            Assert(timeout > TimeSpan.Zero && timeout <= TimeSpan.FromSeconds(15), "Manager preparation must receive a bounded timeout.");
            return Task.FromResult(managerAccepts);
        },
        () => { hostExit.TrySetResult(); return Task.CompletedTask; });
    var serverTask = server.RunAsync(cancellation.Token);
    try
    {
        using var client = new NamedPipeClientStream(".", pipeName, PipeDirection.InOut, PipeOptions.Asynchronous, TokenImpersonationLevel.Identification);
        await client.ConnectAsync(5_000);
        var request = UpdatePreparationProtocol.SerializeRequest(new UpdatePreparationRequest(1, "prepare-update", Environment.ProcessId)) + "\n";
        await client.WriteAsync(Encoding.UTF8.GetBytes(request));
        await client.FlushAsync();
        using var reader = new StreamReader(client, Encoding.UTF8, leaveOpen: true);
        var line = await reader.ReadLineAsync().WaitAsync(TimeSpan.FromSeconds(5));
        Assert(line is not null, "The update pipe must return a protocol response.");
        var parsedResponse = UpdatePreparationProtocol.TryParseResponse(line!, out var response, out _);
        Assert(parsedResponse, "The update pipe must return a valid protocol response.");
        Assert(response!.Success == managerAccepts, "The response must reflect Manager preparation success or refusal.");
        Assert(managerCalled, "A matching Host PID must invoke Manager preparation.");
        if (managerAccepts) await hostExit.Task.WaitAsync(TimeSpan.FromSeconds(5));
        else Assert(!hostExit.Task.IsCompleted, "A refused Manager shutdown must keep NativeHost running.");
    }
    finally
    {
        cancellation.Cancel();
        try { await serverTask.WaitAsync(TimeSpan.FromSeconds(3)); }
        catch (OperationCanceledException) { }
    }
}

static async Task VerifyManagerUpdateTimeoutRefusalAsync()
{
    var pipeName = $"WebTools.NativeHost.Manager.UpdateChecks.{Guid.NewGuid():N}";
    var directory = Path.Combine(Path.GetTempPath(), $"webtools-update-manager-check-{Guid.NewGuid():N}");
    Directory.CreateDirectory(directory);
    using var cancellation = new CancellationTokenSource();
    var stateStore = new LauncherStateStore(Path.Combine(directory, "launcher-state.json"));
    var diagnostics = new DiagnosticsService(Stopwatch.GetTimestamp());
    var managerPipe = new NativeManagerPipeServer(
        pipeName,
        stateStore,
        _ => Task.FromResult(stateStore.Snapshot),
        _ => Task.FromResult(stateStore.Snapshot),
        (_, _) => Task.FromResult(stateStore.Snapshot),
        diagnostics);
    var pipeTask = managerPipe.RunAsync(cancellation.Token);
    var processStart = new ProcessStartInfo(Environment.GetEnvironmentVariable("ComSpec") ?? Path.Combine(Environment.SystemDirectory, "cmd.exe"))
    {
        UseShellExecute = false,
        CreateNoWindow = true,
        WindowStyle = ProcessWindowStyle.Hidden,
    };
    processStart.ArgumentList.Add("/d");
    processStart.ArgumentList.Add("/c");
    processStart.ArgumentList.Add("ping -n 30 127.0.0.1 >nul");
    using var fakeManager = Process.Start(processStart) ?? throw new InvalidOperationException("Could not start the timeout fixture process.");
    var controller = new ManagerController(managerPipe, new ManagerProcessLauncher(allowDevelopmentLaunch: false), diagnostics, static _ => { });
    typeof(ManagerController).GetField("_managerProcess", BindingFlags.Instance | BindingFlags.NonPublic)!.SetValue(controller, fakeManager);

    try
    {
        using var client = new NamedPipeClientStream(".", pipeName, PipeDirection.InOut, PipeOptions.Asynchronous, TokenImpersonationLevel.Identification);
        await client.ConnectAsync(5_000);
        using var helloJson = JsonDocument.Parse("{\"processId\":" + fakeManager.Id + "}");
        await NativePipeFrameCodec.WriteAsync(client, new NativePipeEnvelope(1, Guid.NewGuid().ToString("N"), "hello", helloJson.RootElement.Clone()));
        var helloReply = await NativePipeFrameCodec.ReadAsync(client).WaitAsync(TimeSpan.FromSeconds(5));
        Assert(helloReply is { Type: "ack", Payload.ValueKind: JsonValueKind.Object }, "Fake Manager must complete the Native pipe handshake.");

        var prepareTask = controller.TryPrepareForUpdateAsync(TimeSpan.FromMilliseconds(600), cancellation.Token);
        var shutdownRequest = await NativePipeFrameCodec.ReadAsync(client).WaitAsync(TimeSpan.FromSeconds(5));
        Assert(shutdownRequest is { Type: "shutdown-manager" }, "Update preparation must ask the Manager to close gracefully.");
        var prepared = await prepareTask;
        Assert(!prepared, "A Manager that never acknowledges or exits must refuse update preparation.");
        Assert(!fakeManager.HasExited, "A Manager timeout must not force-kill the process.");
        var shuttingDown = (bool)typeof(ManagerController).GetField("_shuttingDown", BindingFlags.Instance | BindingFlags.NonPublic)!.GetValue(controller)!;
        Assert(!shuttingDown, "After refusal, the Manager controller must return to a usable state.");
    }
    finally
    {
        controller.Dispose();
        cancellation.Cancel();
        try { await pipeTask.WaitAsync(TimeSpan.FromSeconds(3)); }
        catch (OperationCanceledException) { }
        await managerPipe.DisposeAsync();
        try { if (!fakeManager.HasExited) { fakeManager.Kill(entireProcessTree: true); await fakeManager.WaitForExitAsync().WaitAsync(TimeSpan.FromSeconds(3)); } }
        catch (Exception error) when (error is InvalidOperationException or System.ComponentModel.Win32Exception or TimeoutException) { }
        try { Directory.Delete(directory, recursive: true); } catch (IOException) { }
    }
}

static void VerifyHotkeyConflictTransactionOnSta()
{
    static HwndSource CreateHiddenSource(string name) => new(new HwndSourceParameters(name)
    {
        Width = 0,
        Height = 0,
        WindowStyle = 0,
        ExtendedWindowStyle = 0,
    });

    using var blockerWindow = CreateHiddenSource("WebTools hotkey conflict blocker");
    using var serviceWindow = CreateHiddenSource("WebTools hotkey conflict service");
    using var verifierWindow = CreateHiddenSource("WebTools hotkey conflict verifier");

    const int blockerId = 0x7311;
    const int probeId = 0x7312;
    const int verifierId = 0x7313;
    var candidates = Enumerable.Range(1, 12)
        .Select(index => $"Control+Alt+Shift+F{index}")
        .Select(shortcut => GlobalHotkeyService.TryParse(shortcut, out var definition) ? definition : null)
        .Where(definition => definition is not null)
        .Cast<HotkeyDefinition>()
        .ToArray();
    HotkeyDefinition? blocked = null;
    HotkeyDefinition? original = null;
    GlobalHotkeyService? service = null;

    try
    {
        foreach (var candidate in candidates)
        {
            if (NativeMethods.RegisterHotKey(blockerWindow.Handle, blockerId, candidate.Modifiers, candidate.VirtualKey))
            {
                blocked = candidate;
                break;
            }
        }
        if (blocked is null)
            throw new InvalidOperationException("No free Control+Alt+Shift+F1..F12 chord was available for the temporary collision test.");

        foreach (var candidate in candidates.Where(candidate => candidate.Canonical != blocked.Canonical))
        {
            if (!NativeMethods.RegisterHotKey(serviceWindow.Handle, probeId, candidate.Modifiers, candidate.VirtualKey)) continue;
            _ = NativeMethods.UnregisterHotKey(serviceWindow.Handle, probeId);
            original = candidate;
            break;
        }
        if (original is null)
            throw new InvalidOperationException("No second free test chord was available to verify the preserved registration.");

        service = new GlobalHotkeyService(serviceWindow.Handle, original.Canonical, static () => { }, new DiagnosticsService(Environment.TickCount64));
        Assert(!service.TryReplace(blocked.Canonical, out var error), "The replacement must fail while another HWND owns the requested hotkey.");
        Assert(!string.IsNullOrWhiteSpace(error), "A failed replacement must explain that registration was rejected.");
        Assert(service.Shortcut == original.Canonical, "A failed replacement must keep the old canonical shortcut.");
        Assert(!NativeMethods.RegisterHotKey(verifierWindow.Handle, verifierId, original.Modifiers, original.VirtualKey), "The original shortcut must remain registered by the service.");
        Assert(!NativeMethods.RegisterHotKey(verifierWindow.Handle, verifierId, blocked.Modifiers, blocked.VirtualKey), "The conflicting shortcut must remain registered by the blocker.");
    }
    finally
    {
        service?.Dispose();
        if (blocked is not null) _ = NativeMethods.UnregisterHotKey(blockerWindow.Handle, blockerId);
        _ = NativeMethods.UnregisterHotKey(serviceWindow.Handle, probeId);
        _ = NativeMethods.UnregisterHotKey(verifierWindow.Handle, verifierId);
    }
}

static string? ResolvePackagedIconAsset(string packageRoot, string applicationId, int targetPixels, int preferredScale, string theme)
{
    var resolverType = typeof(SearchCore).Assembly.GetType("WebTools.NativeHost.Services.PackagedIconResolver", throwOnError: false)
        ?? throw new InvalidOperationException("PackagedIconResolver is not implemented.");
    var resolver = resolverType.GetMethod("ResolveManifestLogoPath", BindingFlags.Static | BindingFlags.NonPublic)
        ?? throw new MissingMethodException(resolverType.FullName, "ResolveManifestLogoPath");
    return resolver.Invoke(null, [packageRoot, applicationId, targetPixels, preferredScale, theme]) as string;
}

static void VerifyPackagedManagerDiscovery(string installRoot)
{
    var expected = Path.GetFullPath(Path.Combine(installRoot, "Manager", "WebTools.exe"));
    if (!File.Exists(expected)) throw new FileNotFoundException("The installed Manager executable is missing.", expected);

    var previousOverride = Environment.GetEnvironmentVariable("WEBTOOLS_MANAGER_EXE");
    try
    {
        Environment.SetEnvironmentVariable("WEBTOOLS_MANAGER_EXE", null);
        var launcherType = typeof(SearchCore).Assembly.GetType("WebTools.NativeHost.Services.ManagerProcessLauncher", throwOnError: true)!;
        var resolver = launcherType.GetMethod("ResolvePackagedManagerExecutable", BindingFlags.Static | BindingFlags.NonPublic)
            ?? throw new MissingMethodException(launcherType.FullName, "ResolvePackagedManagerExecutable");
        var actual = resolver.Invoke(null, [installRoot]) as string
            ?? throw new InvalidOperationException("Manager discovery returned no executable path.");
        if (!StringComparer.OrdinalIgnoreCase.Equals(Path.GetFullPath(actual), expected))
            throw new InvalidOperationException($"Expected '{expected}', resolved '{actual}'.");
        Console.WriteLine($"PASS Manager discovery resolved installed executable: {actual}");
    }
    finally
    {
        Environment.SetEnvironmentVariable("WEBTOOLS_MANAGER_EXE", previousOverride);
    }
}

internal static class GuiResources
{
    [DllImport("user32.dll")]
    internal static extern uint GetGuiResources(IntPtr process, uint flag);
}

internal sealed class TestResultRow(string title) : System.ComponentModel.INotifyPropertyChanged
{
    private string? _icon;
    public string Title { get; } = title;
    public string? Icon
    {
        get => _icon;
        set { _icon = value; PropertyChanged?.Invoke(this, new System.ComponentModel.PropertyChangedEventArgs(nameof(Icon))); }
    }
    public event System.ComponentModel.PropertyChangedEventHandler? PropertyChanged;
}
