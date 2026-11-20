using System.Net;
using System.Net.Sockets;

namespace Sinf.Desktop.Core;

/// <summary>
/// The address of the teacher's lesson, as a student computer may open it (ADR-014 §3). Only plain
/// http to an address inside the school network: a stray answer must never take a child's screen to
/// the internet.
/// </summary>
public static class TeacherAddress
{
    public const int DefaultPort = 3000;

    /// <summary>
    /// Accepts what a person types — "192.168.1.15", "192.168.1.15:3000", "http://192.168.1.15:3000/" —
    /// and gives back "http://192.168.1.15:3000", or false when it is not an address we allow.
    /// </summary>
    public static bool TryNormalize(string? input, out string url)
    {
        url = string.Empty;
        var text = (input ?? string.Empty).Trim();
        if (text.Length == 0)
        {
            return false;
        }

        if (!text.Contains("://", StringComparison.Ordinal))
        {
            text = "http://" + text;
        }

        if (!Uri.TryCreate(text, UriKind.Absolute, out var parsed) || parsed.Scheme != Uri.UriSchemeHttp)
        {
            return false;
        }

        if (parsed.AbsolutePath != "/" || parsed.Query.Length > 0 || parsed.Fragment.Length > 0)
        {
            return false;
        }

        if (!IPAddress.TryParse(parsed.Host, out var ip) || !IsAllowed(ip))
        {
            return false;
        }

        var port = parsed.IsDefaultPort && !text.Contains($"{parsed.Host}:80", StringComparison.Ordinal)
            ? DefaultPort
            : parsed.Port;
        url = $"http://{ip}:{port}";
        return true;
    }

    /// <summary>A private IPv4 address of the school network, or this computer itself (one-PC tests).</summary>
    public static bool IsAllowed(IPAddress address)
    {
        if (address.AddressFamily != AddressFamily.InterNetwork)
        {
            return false;
        }

        var b = address.GetAddressBytes();
        return b[0] switch
        {
            10 => true,
            127 => true,
            172 => b[1] >= 16 && b[1] <= 31,
            192 => b[1] == 168,
            _ => false,
        };
    }

    /// <summary>Is this page on the teacher's computer — same host and port? Everything else is cut off.</summary>
    public static bool IsSameOrigin(string teacherUrl, string candidate)
    {
        return Uri.TryCreate(teacherUrl, UriKind.Absolute, out var teacher)
            && Uri.TryCreate(candidate, UriKind.Absolute, out var page)
            && page.Scheme == teacher.Scheme
            && page.Port == teacher.Port
            && string.Equals(page.Host, teacher.Host, StringComparison.OrdinalIgnoreCase);
    }
}
