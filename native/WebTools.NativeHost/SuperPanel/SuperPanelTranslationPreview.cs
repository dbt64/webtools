using WebTools.NativeHost.Data;

namespace WebTools.NativeHost.SuperPanel;

internal static class SuperPanelTranslationPreview
{
    internal static readonly NativeFeatureRef Reference = new("webtools.translation", "translate-text");
    // Same bounded grammar as Main's translation-preview.ts; not language detection.
    internal static bool IsCandidate(string? text) => text is { Length: > 0 and <= 3000 }
        && text.Any(c => c is >= 'A' and <= 'Z' or >= 'a' and <= 'z')
        && text.All(c => c is >= 'A' and <= 'Z' or >= 'a' and <= 'z' or >= '0' and <= '9'
            or ' ' or '\t' or '\r' or '\n' or '.' or ',' or '?' or '!' or ':' or ';' or '\'' or '"' or '(' or ')' or '_' or '-'
            or '\u2018' or '\u2019' or '\u201c' or '\u201d' or '\u2013' or '\u2014');
}
