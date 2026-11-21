namespace Sinf.Desktop.Core;

/// <summary>What the school calls a student computer: "ПК-05". Short, so it fits on a tile.</summary>
public static class PcName
{
    public const int MaxLength = 20;

    public static bool TryNormalize(string? input, out string name)
    {
        name = string.Join(' ', (input ?? string.Empty).Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries));
        return name.Length is > 0 and <= MaxLength && !name.Any(char.IsControl);
    }
}
