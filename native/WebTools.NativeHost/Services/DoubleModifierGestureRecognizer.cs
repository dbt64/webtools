using WebTools.NativeHost.Models;

namespace WebTools.NativeHost.Services;

/// <summary>Recognizes a safe double tap of Ctrl or Alt from normalized key transitions.</summary>
internal sealed class DoubleModifierGestureRecognizer
{
    internal const long DoubleTapIntervalMilliseconds = 350;
    internal const long MaximumTapDurationMilliseconds = 300;

    private readonly HotkeyModifier _targetModifier;
    private readonly HashSet<uint> _pressedNonModifiers = [];
    private readonly HashSet<HotkeyModifier> _pressedModifiers = [];
    private long? _candidateCompletedAt;
    private long _targetTapStartedAt;
    private bool _targetTapActive;
    private bool _targetTapInvalid;
    private bool _currentTapIsSecond;

    internal DoubleModifierGestureRecognizer(HotkeyModifier targetModifier)
    {
        if (targetModifier is not (HotkeyModifier.Control or HotkeyModifier.Alt))
            throw new ArgumentOutOfRangeException(nameof(targetModifier), "Only Ctrl and Alt double taps are supported.");
        _targetModifier = targetModifier;
    }

    internal bool ProcessKeyEvent(uint virtualKey, HotkeyModifier? modifier, bool isDown, long timestampMilliseconds)
    {
        ExpireCandidate(timestampMilliseconds);
        if (modifier is { } keyModifier)
            return ProcessModifier(keyModifier, isDown, timestampMilliseconds);

        _candidateCompletedAt = null;
        if (_targetTapActive) _targetTapInvalid = true;
        if (isDown) _pressedNonModifiers.Add(virtualKey);
        else _pressedNonModifiers.Remove(virtualKey);
        return false;
    }

    private bool ProcessModifier(HotkeyModifier modifier, bool isDown, long timestampMilliseconds)
    {
        if (isDown)
        {
            if (!_pressedModifiers.Add(modifier))
            {
                if (modifier == _targetModifier && _targetTapActive) _targetTapInvalid = true;
                return false;
            }

            if (modifier != _targetModifier)
            {
                _candidateCompletedAt = null;
                if (_targetTapActive) _targetTapInvalid = true;
                return false;
            }

            _targetTapActive = true;
            _targetTapStartedAt = timestampMilliseconds;
            _targetTapInvalid = _pressedNonModifiers.Count > 0 || _pressedModifiers.Any(pressed => pressed != _targetModifier);
            _currentTapIsSecond = false;

            if (_targetTapInvalid)
            {
                _candidateCompletedAt = null;
            }
            else if (_candidateCompletedAt is { } candidateAt)
            {
                _currentTapIsSecond = timestampMilliseconds >= candidateAt
                    && timestampMilliseconds - candidateAt <= DoubleTapIntervalMilliseconds;
                if (!_currentTapIsSecond) _candidateCompletedAt = null;
            }
            return false;
        }

        if (!_pressedModifiers.Remove(modifier)) return false;
        if (modifier != _targetModifier || !_targetTapActive) return false;

        var tapDuration = timestampMilliseconds - _targetTapStartedAt;
        var validTap = !_targetTapInvalid
            && tapDuration >= 0
            && tapDuration <= MaximumTapDurationMilliseconds
            && _pressedNonModifiers.Count == 0
            && _pressedModifiers.Count == 0;
        var triggered = false;

        if (validTap)
        {
            if (_currentTapIsSecond && _candidateCompletedAt is { } candidateAt
                && timestampMilliseconds >= candidateAt
                && timestampMilliseconds - candidateAt <= DoubleTapIntervalMilliseconds)
            {
                triggered = true;
                _candidateCompletedAt = null;
            }
            else
            {
                _candidateCompletedAt = timestampMilliseconds;
            }
        }
        else
        {
            _candidateCompletedAt = null;
        }

        _targetTapActive = false;
        _targetTapInvalid = false;
        _currentTapIsSecond = false;
        return triggered;
    }

    private void ExpireCandidate(long timestampMilliseconds)
    {
        if (_candidateCompletedAt is not { } candidateAt) return;
        if (timestampMilliseconds < candidateAt || timestampMilliseconds - candidateAt > DoubleTapIntervalMilliseconds)
            _candidateCompletedAt = null;
    }
}
