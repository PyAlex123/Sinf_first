using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;

namespace Sinf.Desktop.Core;

/// <summary>
/// Runs on a student's computer: asks the network where the teacher's lesson is (ADR-014 §3).
/// One call is one round — a question to every local network, then a short wait for an answer.
/// </summary>
public static class TeacherFinder
{
    public static readonly TimeSpan DefaultWait = TimeSpan.FromMilliseconds(1500);

    /// <summary>
    /// What the teacher answered, or null when nobody we trust answered in time. Answers with another
    /// nonce, a bad signature or another key than the remembered one are passed over (H9): the real
    /// teacher may still answer after a fake one.
    /// </summary>
    /// <param name="targets">Where to ask; every local network by default, a loopback port in tests.</param>
    /// <param name="pinnedKey">The teacher this computer met first; null on a computer that has met none.</param>
    /// <param name="pc">This computer's name: the teacher's answer says whether it stays locked.</param>
    /// <param name="refused">Keys an administrator refused on this computer (review 2026-11-25): passed over.</param>
    public static async Task<TeacherFound?> FindAsync(
        IReadOnlyList<IPEndPoint>? targets = null,
        TimeSpan? wait = null,
        string? pinnedKey = null,
        CancellationToken token = default,
        string? pc = null,
        IReadOnlySet<string>? refused = null)
    {
        using var socket = new UdpClient(new IPEndPoint(IPAddress.Any, 0)) { EnableBroadcast = true };
        var nonce = Discovery.NewNonce();
        var request = Discovery.Request(nonce, pc);
        foreach (var target in targets ?? BroadcastTargets())
        {
            try
            {
                await socket.SendAsync(request, target, token).ConfigureAwait(false);
            }
            catch (SocketException)
            {
                // One adapter refused to send; the others may still reach the teacher.
            }
        }

        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(token);
        timeout.CancelAfter(wait ?? DefaultWait);
        while (true)
        {
            UdpReceiveResult received;
            try
            {
                received = await socket.ReceiveAsync(timeout.Token).ConfigureAwait(false);
            }
            catch (OperationCanceledException)
            {
                return null;
            }
            catch (SocketException)
            {
                continue;
            }

            var found = Discovery.ReadAnswer(received.Buffer, nonce, pinnedKey, pc);
            if (found is not null && refused?.Contains(found.TeacherKey) != true)
            {
                return found;
            }
        }
    }

    /// <summary>
    /// Asks one computer directly — the address remembered from last time or typed by hand — whether it
    /// is the teacher's (H9). Only a signed answer counts: a web page that answers on that address
    /// proves nothing, the computer behind it may have changed overnight.
    /// </summary>
    public static Task<TeacherFound?> ConfirmAsync(
        string url,
        string? pinnedKey,
        TimeSpan? wait = null,
        CancellationToken token = default,
        string? pc = null,
        IReadOnlySet<string>? refused = null)
    {
        if (!TeacherAddress.TryNormalize(url, out var normal)
            || !IPAddress.TryParse(new Uri(normal).Host, out var host))
        {
            return Task.FromResult<TeacherFound?>(null);
        }

        return FindAsync([new IPEndPoint(host, Discovery.Port)], wait, pinnedKey, token, pc, refused);
    }

    /// <summary>The broadcast address of every working IPv4 network here, plus 255.255.255.255.</summary>
    public static IReadOnlyList<IPEndPoint> BroadcastTargets()
    {
        var targets = new List<IPEndPoint> { new(IPAddress.Broadcast, Discovery.Port) };
        foreach (var adapter in NetworkInterface.GetAllNetworkInterfaces())
        {
            if (adapter.OperationalStatus != OperationalStatus.Up
                || adapter.NetworkInterfaceType is NetworkInterfaceType.Loopback or NetworkInterfaceType.Tunnel)
            {
                continue;
            }

            foreach (var entry in adapter.GetIPProperties().UnicastAddresses)
            {
                if (entry.Address.AddressFamily != AddressFamily.InterNetwork
                    || entry.IPv4Mask is null
                    || entry.IPv4Mask.Equals(IPAddress.Any))
                {
                    continue;
                }

                var broadcast = Discovery.DirectedBroadcast(entry.Address, entry.IPv4Mask);
                if (!targets.Any(t => t.Address.Equals(broadcast)))
                {
                    targets.Add(new IPEndPoint(broadcast, Discovery.Port));
                }
            }
        }

        return targets;
    }
}
