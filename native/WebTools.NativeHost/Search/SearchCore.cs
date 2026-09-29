using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;
using WebTools.NativeHost.Data;

namespace WebTools.NativeHost.Search;

public sealed class SearchCore
{
    private static readonly CompareInfo ChineseCompare = CultureInfo.GetCultureInfo("zh-CN").CompareInfo;
    private static readonly Regex TokenPattern = new(@"[\p{L}\p{N}]+", RegexOptions.Compiled);
    private readonly IndexedEntry[] _apps;
    private readonly IndexedEntry[] _websites;
    private readonly Dictionary<string, AppSearchMemoryRecord> _remembered = new(StringComparer.Ordinal);

    public SearchCore(IEnumerable<SearchEntry> apps, IEnumerable<SearchEntry> websites, IEnumerable<AppSearchMemoryRecord>? remembered = null)
    {
        _apps = apps.Select((entry, index) => new IndexedEntry(entry, index)).ToArray();
        _websites = websites.Select((entry, index) => new IndexedEntry(entry, _apps.Length + index)).ToArray();
        foreach (var item in (remembered ?? []).Where(IsValidMemoryEntry).OrderByDescending(item => item.LastUsedAt).Take(100))
            _remembered[item.Query] = item;
    }

    public int IndexedCount => _apps.Length + _websites.Length;

    public IReadOnlyList<SearchResult> Search(SearchCommand command, string? rememberedAppId = null)
    {
        if (command.Mode is SearchMode.Files or SearchMode.Web) return [];
        var normalized = Normalize(command.Query);
        if (normalized.Length == 0) return [];
        var tokens = TokenPattern.Matches(command.Query.ToLowerInvariant()).Select(match => match.Value).ToArray();
        var candidates = command.Mode == SearchMode.SavedWebsites ? _websites.AsEnumerable() : _apps.Concat(_websites);
        var matches = candidates.Select(indexed => (indexed, match: Score(indexed, normalized, tokens)))
            .Where(item => item.match is not null)
            .OrderBy(item => item.match!.Value.Rank)
            .ThenBy(item => item.indexed.Entry.Name, Comparer<string>.Create((a, b) => ChineseCompare.Compare(a, b, CompareOptions.None)))
            .ThenBy(item => item.indexed.Order)
            .ToList();

        if (command.Mode == SearchMode.Local)
        {
            var preferredId = rememberedAppId ?? (_remembered.GetValueOrDefault(Normalize(command.Query))?.AppId);
            var rememberedIndex = matches.FindIndex(item => item.indexed.Entry.Kind == ResultKind.Application && item.indexed.Entry.Id == preferredId);
            if (rememberedIndex > 0)
            {
                var remembered = matches[rememberedIndex];
                matches.RemoveAt(rememberedIndex);
                matches.Insert(0, remembered);
            }
        }

        var results = matches.Take(8).Select(item =>
        {
            var entry = item.indexed.Entry;
            ResultAction action = entry.Kind switch
            {
                ResultKind.Application => new LaunchApplicationAction(entry.Id),
                ResultKind.Website => new OpenWebsiteAction(entry.Id, entry.Url ?? ""),
                _ => throw new InvalidOperationException("Unexpected indexed entry kind."),
            };
            return new SearchResult(entry.Id, entry.Kind, entry.Name, entry.Subtitle,
                item.match!.Value.Rank, item.match.Value.Kind, action, entry.IconReference);
        }).ToList();

        if (command.Mode == SearchMode.Local && IsTranslationCandidate(command.Raw))
            results.Add(new SearchResult("translation", ResultKind.Translation, "翻译", $"翻译“{command.Raw.Trim()}”",
                int.MaxValue, MatchKind.Name, new OpenTranslationAction(command.Raw)));
        return results;
    }

    public void RememberApplication(string query, string appId)
    {
        if (query.Length > 128 || appId.Length != 16 || !appId.All(Uri.IsHexDigit)) return;
        var key = Normalize(query);
        if (key.Length > 0) _remembered[key] = new AppSearchMemoryRecord(key, appId, DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
        if (_remembered.Count > 100)
        {
            foreach (var stale in _remembered.Values.OrderBy(item => item.LastUsedAt).Take(_remembered.Count - 100)) _remembered.Remove(stale.Query);
        }
    }

    public IReadOnlyList<AppSearchMemoryRecord> GetRememberedApplications() => _remembered.Values.OrderByDescending(item => item.LastUsedAt).Take(100).ToArray();

    private static bool IsValidMemoryEntry(AppSearchMemoryRecord item) => item.Query.Length is > 0 and <= 128
        && Normalize(item.Query) == item.Query && item.AppId.Length == 16 && item.AppId.All(Uri.IsHexDigit);

    public static string Normalize(string value)
    {
        var builder = new StringBuilder(value.Length);
        foreach (var rune in value.Normalize(NormalizationForm.FormKD).ToLowerInvariant().EnumerateRunes())
        {
            var category = Rune.GetUnicodeCategory(rune);
            if (category is UnicodeCategory.NonSpacingMark or UnicodeCategory.SpacingCombiningMark or UnicodeCategory.EnclosingMark) continue;
            if (Rune.IsLetterOrDigit(rune)) builder.Append(rune.ToString());
        }
        return builder.ToString();
    }

    public static bool IsTranslationCandidate(string raw)
    {
        var text = raw.Trim();
        return text.Length > 0 && text.EnumerateRunes().Any(IsLatinLetter)
            && text.EnumerateRunes().All(rune => Rune.IsWhiteSpace(rune)
                || IsLatinLetter(rune)
                || rune.Value is '\'' or '’' or '‘' or 0x02BC or '-' or >= 0x2010 and <= 0x2015);
    }

    private static bool IsLatinLetter(Rune rune)
    {
        var code = rune.Value;
        return Rune.IsLetter(rune) && (code is >= 0x0041 and <= 0x007A
            or >= 0x00C0 and <= 0x02AF
            or >= 0x1D00 and <= 0x1DBF
            or >= 0x1E00 and <= 0x1EFF
            or >= 0x2C60 and <= 0x2C7F
            or >= 0xA720 and <= 0xA7FF
            or >= 0xAB30 and <= 0xAB6F
            or >= 0xFB00 and <= 0xFB06
            or >= 0xFF21 and <= 0xFF5A
            or >= 0x10780 and <= 0x107BF
            or >= 0x1DF00 and <= 0x1DFFF);
    }

    private static (int Rank, MatchKind Kind)? Score(IndexedEntry entry, string query, string[] queryTokens)
    {
        if (entry.NormalizedName == query) return (0, MatchKind.Name);
        if (entry.NormalizedName.StartsWith(query, StringComparison.Ordinal)) return (1, MatchKind.Name);
        if (entry.NormalizedName.Contains(query, StringComparison.Ordinal)) return (2, MatchKind.Name);
        if (entry.NormalizedAliases.Contains(query)) return (3, MatchKind.Alias);
        if (entry.NormalizedAliases.Any(alias => alias.StartsWith(query, StringComparison.Ordinal))) return (4, MatchKind.Alias);
        if (MatchesWordInitials(queryTokens, entry.NameTokens)) return (5, MatchKind.Initials);
        if (entry.FullPinyin.StartsWith(query, StringComparison.Ordinal)) return (6, MatchKind.Pinyin);
        if (entry.FullPinyin.Contains(query, StringComparison.Ordinal)) return (7, MatchKind.Pinyin);
        if (entry.Initials.StartsWith(query, StringComparison.Ordinal)) return (8, MatchKind.Initials);
        if (entry.Initials.Contains(query, StringComparison.Ordinal)) return (9, MatchKind.Initials);
        if (entry.NormalizedText.Contains(query, StringComparison.Ordinal))
            return (10, entry.NormalizedAliases.Any(alias => alias.Contains(query, StringComparison.Ordinal)) ? MatchKind.Alias : MatchKind.Name);
        return null;
    }

    private static bool MatchesWordInitials(string[] query, string[] name, int queryIndex = 0, int nameIndex = 0)
    {
        if (queryIndex == query.Length) return true;
        if (nameIndex >= name.Length) return false;
        var token = query[queryIndex];
        if (name[nameIndex].StartsWith(token, StringComparison.Ordinal) && MatchesWordInitials(query, name, queryIndex + 1, nameIndex + 1)) return true;
        var initials = "";
        for (var end = nameIndex; end < name.Length && initials.Length < token.Length; end++)
        {
            initials += name[end].EnumerateRunes().First().ToString();
            if (initials == token && MatchesWordInitials(query, name, queryIndex + 1, end + 1)) return true;
        }
        return false;
    }

    private sealed class IndexedEntry
    {
        public IndexedEntry(SearchEntry entry, int order)
        {
            Entry = entry;
            Order = order;
            NormalizedName = Normalize(entry.Name);
            NormalizedAliases = entry.Aliases.Select(Normalize).ToArray();
            NormalizedText = Normalize($"{entry.Name} {string.Join(' ', entry.Aliases)} {entry.SearchText}");
            NameTokens = TokenPattern.Matches(entry.Name.ToLowerInvariant()).Select(match => match.Value).ToArray();
            var syllables = PinyinConverter.Syllables(entry.Name);
            FullPinyin = Normalize(string.Concat(syllables));
            Initials = Normalize(string.Concat(syllables.Select(syllable => syllable.EnumerateRunes().FirstOrDefault().ToString())));
        }

        public SearchEntry Entry { get; }
        public int Order { get; }
        public string NormalizedName { get; }
        public string[] NormalizedAliases { get; }
        public string NormalizedText { get; }
        public string[] NameTokens { get; }
        public string FullPinyin { get; }
        public string Initials { get; }
    }
}
