using System.IO;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace WebTools.NativeHost.SuperPanel;

public sealed record SuperPanelSettings(bool Enabled, string MouseButton, string Gesture, int HoldMilliseconds, bool AutoTranslationPreview = false)
{
    public static SuperPanelSettings FromState(SuperPanelState state) => new(state.Enabled, state.MouseButton, state.Gesture, state.HoldMilliseconds, state.AutoTranslationPreview);
    public static SuperPanelSettings Parse(JsonElement value)
    {
        var names = new HashSet<string>(StringComparer.Ordinal);
        if (value.ValueKind != JsonValueKind.Object) throw new InvalidDataException("Super Panel 设置格式无效。");
        foreach (var property in value.EnumerateObject())
            if (property.Name is not ("enabled" or "mouseButton" or "gesture" or "holdMilliseconds" or "autoTranslationPreview") || !names.Add(property.Name))
                throw new InvalidDataException("Super Panel 设置包含未知或重复字段。");
        if (names.Count != (names.Contains("autoTranslationPreview") ? 5 : 4)
            || names.Contains("autoTranslationPreview") && value.GetProperty("autoTranslationPreview").ValueKind is not (JsonValueKind.True or JsonValueKind.False)
            || value.GetProperty("enabled").ValueKind is not (JsonValueKind.True or JsonValueKind.False)
            || value.GetProperty("mouseButton").ValueKind != JsonValueKind.String
            || value.GetProperty("gesture").ValueKind != JsonValueKind.String
            || value.GetProperty("holdMilliseconds").ValueKind != JsonValueKind.Number
            || !value.GetProperty("holdMilliseconds").TryGetInt32(out var hold))
            throw new InvalidDataException("Super Panel 设置字段无效。");
        var result = new SuperPanelSettings(value.GetProperty("enabled").GetBoolean(), value.GetProperty("mouseButton").GetString()!,
            value.GetProperty("gesture").GetString()!, hold, names.Contains("autoTranslationPreview") && value.GetProperty("autoTranslationPreview").GetBoolean());
        if (!result.IsValid) throw new InvalidDataException("鼠标触发设置无效，长按时间须为 300–1500 毫秒。");
        return result;
    }
    [JsonIgnore] public bool IsValid => MouseButton is "middle" or "xbutton1" or "xbutton2"
        && Gesture is "press" or "hold" && HoldMilliseconds is >= 300 and <= 1500;
}

public sealed record SuperPanelSettingsStatus(SuperPanelSettings Settings, string TriggerStatus, SuperPanelSettings? ActiveTrigger, string? Error);

/// <summary>Native Dispatcher authority. Manager owns the only trigger settings UI.</summary>
internal sealed class SuperPanelSettingsController(SuperPanelStateStore store, SuperPanelTriggerController triggers)
{
    private string? _operationError;
    public event Action<SuperPanelSettingsStatus>? Changed;
    public SuperPanelSettingsStatus Read()
    {
        var error = string.Join("\n", new[] { _operationError, triggers.Error }.Where(message => !string.IsNullOrEmpty(message)).Distinct());
        return new(SuperPanelSettings.FromState(store.Snapshot), triggers.TriggerStatus, triggers.ActiveTrigger, error.Length == 0 ? null : error);
    }
    public void Initialize(string? loadWarning = null) { _operationError = loadWarning; triggers.Initialize(store.Snapshot); }
    public SuperPanelSettingsStatus Update(SuperPanelSettings settings)
    {
        _operationError = null;
        if (!settings.IsValid) { _operationError = "鼠标触发设置无效。"; return Publish(); }
        var previous = store.Snapshot;
        var next = previous with { Enabled = settings.Enabled, MouseButton = settings.MouseButton, Gesture = settings.Gesture, HoldMilliseconds = settings.HoldMilliseconds, AutoTranslationPreview = settings.AutoTranslationPreview };
        if (!triggers.Configure(next, out _)) return Publish();
        try { store.Save(next); }
        catch
        {
            var restored = triggers.Configure(previous, out var rollbackError);
            _operationError = restored ? "设置保存失败，已恢复原触发器。" : "设置保存失败；恢复原触发器失败：" + rollbackError;
        }
        return Publish();
    }
    private SuperPanelSettingsStatus Publish() { var result = Read(); Changed?.Invoke(result); return result; }
}
