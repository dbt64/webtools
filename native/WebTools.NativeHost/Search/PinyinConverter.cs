using System.Reflection;
using System.IO;

namespace WebTools.NativeHost.Search;

public static class PinyinConverter
{
    private static readonly Lazy<IReadOnlyDictionary<int, string>> CharacterReadings = new(LoadReadings);
    private static readonly Dictionary<string, string[]> PhraseReadings = new(StringComparer.Ordinal)
    {
        ["重庆"] = ["chong", "qing"],
        ["银行"] = ["yin", "hang"],
        ["音乐"] = ["yin", "yue"],
        ["长安"] = ["chang", "an"],
        ["重复"] = ["chong", "fu"],
    };

    public static string[] Syllables(string text)
    {
        var result = new List<string>();
        for (var offset = 0; offset < text.Length;)
        {
            var phrase = PhraseReadings.FirstOrDefault(item => text.AsSpan(offset).StartsWith(item.Key.AsSpan(), StringComparison.Ordinal));
            if (phrase.Key is not null)
            {
                result.AddRange(phrase.Value);
                offset += phrase.Key.Length;
                continue;
            }
            var rune = System.Text.Rune.GetRuneAt(text, offset);
            result.Add(CharacterReadings.Value.GetValueOrDefault(rune.Value) ?? rune.ToString());
            offset += rune.Utf16SequenceLength;
        }
        return result.ToArray();
    }

    private static IReadOnlyDictionary<int, string> LoadReadings()
    {
        using var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream("WebTools.NativeHost.Search.pinyin-map.txt")
            ?? throw new InvalidOperationException("Native pinyin map is missing.");
        using var reader = new StreamReader(stream);
        var map = new Dictionary<int, string>();
        while (reader.ReadLine() is { } line)
        {
            var split = line.IndexOf('\t');
            if (split < 0) continue;
            map[Convert.ToInt32(line[..split], 16)] = line[(split + 1)..];
        }
        return map;
    }
}
