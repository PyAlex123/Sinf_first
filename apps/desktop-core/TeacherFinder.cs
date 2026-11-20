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

    /// <summary>The lesson address, or null when nobody answered in time.</summary>
    /// <param name="targets">Where to ask; every local network by default, a loopback port in tests.</param>
    public static async Task<string?> FindAsync(
        IReadOnlyList<IPEndPoint>? targets = null,
        TimeSpan? wait = null,
        CancellationToken token = default)
    {
        using var socket = new UdpClient(new IPEndPoint(IPAddress.Any, 0)) { EnableBroadcast = true };
        var request = Discovery.Request();
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

            var url = Discovery.ReadAnswer(received.Buffer);
            if (url is not null)
            {
                return url;
            }
        }
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
