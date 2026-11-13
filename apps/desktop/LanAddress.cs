using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;

namespace Sinf.Desktop;

/// <summary>
/// The address student devices type to join the lesson. Only the classroom network is of interest, so
/// virtual adapters and link-local addresses are skipped and a private IPv4 address wins.
/// </summary>
internal static class LanAddress
{
    public static string? Find()
    {
        var candidates = new List<IPAddress>();
        foreach (var adapter in NetworkInterface.GetAllNetworkInterfaces())
        {
            if (adapter.OperationalStatus != OperationalStatus.Up)
            {
                continue;
            }

            if (adapter.NetworkInterfaceType is NetworkInterfaceType.Loopback or NetworkInterfaceType.Tunnel)
            {
                continue;
            }

            foreach (var entry in adapter.GetIPProperties().UnicastAddresses)
            {
                if (entry.Address.AddressFamily != AddressFamily.InterNetwork)
                {
                    continue;
                }

                if (IsLinkLocal(entry.Address))
                {
                    continue;
                }

                candidates.Add(entry.Address);
            }
        }

        return candidates.FirstOrDefault(IsPrivate)?.ToString() ?? candidates.FirstOrDefault()?.ToString();
    }

    private static bool IsLinkLocal(IPAddress address)
    {
        var bytes = address.GetAddressBytes();
        return bytes[0] == 169 && bytes[1] == 254;
    }

    private static bool IsPrivate(IPAddress address)
    {
        var bytes = address.GetAddressBytes();
        return bytes[0] switch
        {
            10 => true,
            172 => bytes[1] >= 16 && bytes[1] <= 31,
            192 => bytes[1] == 168,
            _ => false,
        };
    }
}
