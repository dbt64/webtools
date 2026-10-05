using WebTools.NativeHost.Search;

namespace WebTools.NativeHost.Files;

/// <summary>
/// Bounded presentation state for the existing Everything result set.
/// This does not run another search or retain results from prior queries.
/// </summary>
public sealed class FileSearchProjection
{
    public const int MaximumResults = 20;

    private static readonly FileCategory[] CategoryValues =
    [
        FileCategory.All,
        FileCategory.Folder,
        FileCategory.Application,
        FileCategory.Document,
        FileCategory.Image,
        FileCategory.Video,
        FileCategory.Audio,
        FileCategory.Archive,
        FileCategory.Other,
    ];

    private IReadOnlyList<SearchResult> _results = [];

    public IReadOnlyList<FileCategory> Categories => CategoryValues;
    public string RawQuery { get; private set; } = string.Empty;
    public bool IsActive => SearchCommand.Parse(RawQuery).Mode == SearchMode.Files;
    public FileCategory SelectedCategory { get; private set; } = FileCategory.All;
    public int SelectedCategoryIndex => Array.IndexOf(CategoryValues, SelectedCategory);
    public IReadOnlyList<SearchResult> Results => _results;

    public IReadOnlyList<SearchResult> VisibleResults => SelectedCategory == FileCategory.All
        ? _results
        : _results.Where(result => Classify(result) == SelectedCategory).ToArray();

    public static string BuildSearchCommand(SearchFilesAction action)
    {
        var parsed = SearchCommand.Parse(action.Query);
        return parsed.Mode == SearchMode.Files ? parsed.Raw : $"file:{action.Query}";
    }

    public void SetQuery(string? rawQuery)
    {
        var wasActive = IsActive;
        RawQuery = rawQuery ?? string.Empty;
        if (!IsActive)
        {
            _results = [];
            SelectedCategory = FileCategory.All;
        }
        else if (!wasActive)
        {
            SelectedCategory = FileCategory.All;
        }
    }

    public void SetResults(IEnumerable<SearchResult> results)
    {
        _results = results
            .Where(result => result.Kind is ResultKind.File or ResultKind.Folder)
            .Take(MaximumResults)
            .ToArray();
    }

    public bool SelectCategory(FileCategory category)
    {
        if (Array.IndexOf(CategoryValues, category) < 0) return false;
        SelectedCategory = category;
        return true;
    }

    public int MoveCategorySelection(int offset)
    {
        if (offset == 0) return SelectedCategoryIndex;
        var count = CategoryValues.Length;
        var next = (SelectedCategoryIndex + offset % count + count) % count;
        SelectedCategory = CategoryValues[next];
        return next;
    }

    private static FileCategory Classify(SearchResult result) => result.Kind switch
    {
        ResultKind.Folder => FileCategory.Folder,
        ResultKind.File => FileCategoryClassifier.Classify(result.IconReference ?? result.Title, isDirectory: false),
        _ => FileCategory.Other,
    };
}
