namespace WebTools.NativeHost.Search;

public enum SearchMode { Local, Web, Files, SavedWebsites }
public enum ResultKind { Application, Website, File, Folder, Translation, SearchFiles }
public enum MatchKind { Name, Alias, Pinyin, Initials }

public sealed record SearchCommand(SearchMode Mode, string Query, string Raw)
{
    public static SearchCommand Parse(string raw)
    {
        if (raw.StartsWith('?')) return new(SearchMode.Web, raw[1..].Trim(), raw);
        if (raw.StartsWith("file:", StringComparison.OrdinalIgnoreCase)) return new(SearchMode.Files, raw[5..].Trim(), raw);
        if (raw.StartsWith('/')) return new(SearchMode.SavedWebsites, raw[1..].Trim(), raw);
        return new(SearchMode.Local, raw.Trim(), raw);
    }
}

public abstract record ResultAction;
public sealed record LaunchApplicationAction(string AppId) : ResultAction;
public sealed record OpenWebsiteAction(string WebsiteId, string Url) : ResultAction;
public sealed record OpenFileAction(string Token) : ResultAction;
public sealed record OpenTranslationAction(string Text) : ResultAction;
public sealed record SearchFilesAction(string Query) : ResultAction;

public sealed record SearchResult(
    string Id, ResultKind Kind, string Title, string Subtitle, int Rank,
    MatchKind Match, ResultAction Action, string? IconReference = null);

public sealed record SearchEntry(
    string Id, string Name, ResultKind Kind, string Subtitle, IReadOnlyList<string> Aliases,
    string SearchText = "", string? Url = null, string? IconReference = null)
{
    public static SearchEntry Application(string id, string name, IReadOnlyList<string> aliases, string? iconReference = null) =>
        new(id, name, ResultKind.Application, "本地应用", aliases, IconReference: iconReference);

    public static SearchEntry Website(string id, string name, string url, string description = "") =>
        new(id, name, ResultKind.Website, url, [url], description, url);
}
