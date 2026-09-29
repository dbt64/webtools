using System.Windows;
using System.Windows.Controls;
using System.Windows.Controls.Primitives;
using System.Windows.Documents;
using System.Windows.Media;
using System.Windows.Media.Media3D;
using Point = System.Windows.Point;
using WpfTextBox = System.Windows.Controls.TextBox;

namespace WebTools.NativeHost.Services;

internal sealed class LauncherDragGesture
{
    private Point? _origin;

    public bool BeginFrom(
        Point origin,
        DependencyObject? source,
        DependencyObject designatedSurface,
        WpfTextBox? blankTextAreaCandidate = null,
        Point? pointInTextBox = null)
    {
        _origin = null;
        var encounteredScrollViewer = false;
        var isBlankTextArea = false;
        for (var current = source; current is not null; current = GetParent(current))
        {
            if (current is System.Windows.Controls.Primitives.ButtonBase or
                System.Windows.Controls.Primitives.ScrollBar or ListBoxItem)
                return false;

            if (current is ScrollViewer)
            {
                encounteredScrollViewer = true;
                continue;
            }

            if (current is System.Windows.Controls.Primitives.TextBoxBase)
            {
                if (current is not WpfTextBox textBox ||
                    !ReferenceEquals(textBox, blankTextAreaCandidate) ||
                    pointInTextBox is not { } point ||
                    HasTextAtPoint(textBox, point))
                    return false;

                isBlankTextArea = true;
                continue;
            }

            if (ReferenceEquals(current, designatedSurface))
            {
                if (encounteredScrollViewer && !isBlankTextArea) return false;
                _origin = origin;
                return true;
            }
        }
        return false;
    }

    public bool TryBeginDrag(Point current, bool leftButtonPressed, double horizontalThreshold, double verticalThreshold)
    {
        if (_origin is not { } origin) return false;
        if (!leftButtonPressed)
        {
            _origin = null;
            return false;
        }

        var horizontalDistance = Math.Abs(current.X - origin.X);
        var verticalDistance = Math.Abs(current.Y - origin.Y);
        if (horizontalDistance < horizontalThreshold && verticalDistance < verticalThreshold) return false;

        _origin = null;
        return true;
    }

    public void End() => _origin = null;

    private static bool HasTextAtPoint(WpfTextBox textBox, Point point)
    {
        try { return textBox.GetCharacterIndexFromPoint(point, snapToText: false) >= 0; }
        catch (InvalidOperationException) { return true; }
    }

    private static DependencyObject? GetParent(DependencyObject current) => current switch
    {
        Visual or Visual3D => VisualTreeHelper.GetParent(current),
        ContentElement content => ContentOperations.GetParent(content),
        _ => LogicalTreeHelper.GetParent(current),
    };
}
