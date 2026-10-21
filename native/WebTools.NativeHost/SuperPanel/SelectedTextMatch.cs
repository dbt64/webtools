using System.Text.RegularExpressions;

namespace WebTools.NativeHost.SuperPanel;

/// <summary>Bounded Native-only discovery. Must agree with the SDK's shared corpus.</summary>
internal static class SelectedTextMatch
{
    private static bool EcmaWhitespace(char c) => c is '\u0009' or '\u000a' or '\u000b' or '\u000c' or '\u000d' or '\u0020'
        or '\u00a0' or '\u1680' or '\u2028' or '\u2029' or '\u202f' or '\u205f' or '\u3000' or '\ufeff' || c is >= '\u2000' and <= '\u200a';
    internal static bool Matches(string? text, string? rule)
    {
        if (rule is null) return true;
        if (rule != "http-url" || text is null || text.Length > 3000) return false;
        var start = 0; var end = text.Length;
        while (start < end && EcmaWhitespace(text[start])) start++;
        while (end > start && EcmaWhitespace(text[end - 1])) end--;
        var value = text[start..end];
        if (!value.StartsWith("http://", StringComparison.OrdinalIgnoreCase) && !value.StartsWith("https://", StringComparison.OrdinalIgnoreCase)) return false;
        for (var index = 0; index < value.Length; index++)
        {
            var c = value[index];
            if (c <= 0x20 || c is >= '\u007f' and <= '\u009f' || EcmaWhitespace(c) || c == '\\') return false;
            if (char.IsHighSurrogate(c)) { if (++index >= value.Length || !char.IsLowSurrogate(value[index])) return false; }
            else if (char.IsLowSurrogate(c)) return false;
        }
        var authority = value[(value.IndexOf("://", StringComparison.Ordinal) + 3)..].Split(['/', '?', '#'], 2)[0];
        if (authority.Length == 0 || authority.Contains('@')) return false;
        var ipv6 = authority.StartsWith('[');
        var parts = Regex.Match(authority, ipv6 ? @"^\[([0-9a-fA-F:]+)\](?::([0-9]+))?$" : @"^([^:]+)(?::([0-9]+))?$", RegexOptions.CultureInvariant);
        if (!parts.Success || parts.Groups[2].Success && (parts.Groups[2].Length > 5 || !int.TryParse(parts.Groups[2].Value, out var port) || port is < 1 or > 65535)) return false;
        var host = parts.Groups[1].Value;
        if (ipv6)
        {
            var halves = host.Split("::", StringSplitOptions.None);
            if (halves.Length > 2) return false;
            var groups = halves.SelectMany(half => half.Length == 0 ? Array.Empty<string>() : half.Split(':')).ToArray();
            return groups.All(group => Regex.IsMatch(group, "^[0-9a-fA-F]{1,4}$", RegexOptions.CultureInvariant))
                && (halves.Length == 2 ? groups.Length < 8 : groups.Length == 8);
        }
        if (host.Length > 253 || host.Any(char.IsSurrogate)) return false;
        var labels = (host.EndsWith('.') ? host[..^1] : host).Split('.');
        if (Regex.IsMatch(labels[^1], "^(?:[0-9]+|0[xX][0-9a-fA-F]+)$", RegexOptions.CultureInvariant))
            return labels.Length == 4 && labels.All(label => Regex.IsMatch(label, "^(?:0|[1-9][0-9]{0,2})$", RegexOptions.CultureInvariant) && int.Parse(label) <= 255);
        // Same syntactic rule as JS; no DNS reachability or full IDNA promise.
        return labels.All(label => label.Length is >= 1 and <= 63
            && Regex.IsMatch(label, @"^[\p{L}\p{N}](?:[\p{L}\p{N}\p{M}-]*[\p{L}\p{N}\p{M}])?$", RegexOptions.CultureInvariant));
    }
}
