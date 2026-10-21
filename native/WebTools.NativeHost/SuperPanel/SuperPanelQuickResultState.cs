using WebTools.NativeHost.Data;
using WebTools.NativeHost.Services;

namespace WebTools.NativeHost.SuperPanel;

/// <summary>One Native-owned slot. Pipe lifetime owns pending work, never accepted inert text.</summary>
public sealed class SuperPanelQuickResultState
{
    private readonly object _gate = new();
    private NativeFeatureResultControl? _binding;
    private NativeFeatureTextResult? _result;
    private NativeFeatureAIConfirmation? _confirmation;
    private long _generation;
    public NativeFeatureTextResult? Result { get { lock (_gate) return _result; } }
    public NativeFeatureResultControl? Binding { get { lock (_gate) return _binding; } }
    public NativeFeatureResultControl? AcceptedBinding { get { lock (_gate) return _result is null ? null : _binding; } }
    public NativeFeatureAIConfirmation? Confirmation { get { lock (_gate) return _confirmation; } }
    public long Generation { get { lock (_gate) return _generation; } }
    public void Begin(string requestId, NativeFeatureRef reference, long localGeneration)
    { lock (_gate) { _binding = new(requestId, reference with { }); _result = null; _confirmation = null; _generation = localGeneration; } }
    public bool TryAccept(NativeFeatureTextResult result)
    {
        lock (_gate)
        {
            if (_binding is null || _result is not null || _binding.RequestId != result.RequestId || _binding.Ref != result.Ref) return false;
            _result = result; _confirmation = null; return true;
        }
    }
    public bool TryClear(string requestId, NativeFeatureRef reference)
    {
        lock (_gate)
        {
            if (_binding?.RequestId != requestId || _binding.Ref != reference) return false;
            _binding = null; _result = null; _confirmation = null; return true;
        }
    }
    public bool TryConfirm(NativeFeatureAIConfirmation confirmation)
    {
        lock (_gate)
        {
            if (_binding?.RequestId != confirmation.RequestId || _binding.Ref != confirmation.Ref || _result is not null || _confirmation is not null) return false;
            _confirmation = confirmation; return true;
        }
    }
    public NativeFeatureAIConfirmation? TakeConfirmation() { lock (_gate) { var current = _confirmation; _confirmation = null; return current; } }
    public void OnTransportDisconnected() { lock (_gate) if (_result is null) { _binding = null; _confirmation = null; } }
    public void Dismiss() { lock (_gate) { _binding = null; _result = null; _confirmation = null; } }
}
