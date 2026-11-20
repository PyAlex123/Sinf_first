using System.Net;
using System.Net.Sockets;

namespace Sinf.Desktop.Core;

/// <summary>
/// Runs on the teacher's computer: hears "where is the lesson?" on the network and answers with the
/// lesson address (ADR-014 §3), signed with this computer's key together with the asker's nonce (H9).
/// It answers only the asker, never broadcasts on its own.
/// </summary>
public sealed class TeacherBeacon : IDisposable
{
    private readonly UdpClient socket;
    private readonly CancellationTokenSource stop = new();
    private readonly Func<string?> lessonUrl;
    private readonly string? name;
    private readonly Func<string?> exitHash;
    private readonly TeacherIdentity identity;

    /// <param name="lessonUrl">Read on every question: the address may appear after the network does.</param>
    /// <param name="exitHash">Read on every question too: a new password reaches students at their next search.</param>
    /// <param name="identity">This computer's key; the beacon signs with it and does not own it.</param>
    /// <param name="bind">Where to listen; the whole network by default, loopback in tests.</param>
    public TeacherBeacon(
        Func<string?> lessonUrl,
        string? name,
        TeacherIdentity identity,
        Func<string?>? exitHash = null,
        IPEndPoint? bind = null)
    {
        this.lessonUrl = lessonUrl;
        this.identity = identity;
        this.name = name;
        this.exitHash = exitHash ?? (() => null);
        socket = new UdpClient(bind ?? new IPEndPoint(IPAddress.Any, Discovery.Port));
        _ = Task.Run(() => ListenAsync(stop.Token));
    }

    /// <summary>The port actually listened on (tests ask for any free one).</summary>
    public int Port => ((IPEndPoint)socket.Client.LocalEndPoint!).Port;

    /// <summary>How many questions were answered — for the window and for tests.</summary>
    public int Answered { get; private set; }

    private async Task ListenAsync(CancellationToken token)
    {
        while (!token.IsCancellationRequested)
        {
            UdpReceiveResult received;
            try
            {
                received = await socket.ReceiveAsync(token).ConfigureAwait(false);
            }
            catch (OperationCanceledException)
            {
                return;
            }
            catch (ObjectDisposedException)
            {
                return;
            }
            catch (SocketException)
            {
                // A reset from an asker that went away; keep listening.
                continue;
            }

            var url = lessonUrl();
            var nonce = Discovery.ReadRequest(received.Buffer);
            if (url is null || nonce is null)
            {
                continue;
            }

            try
            {
                var answer = Discovery.Answer(nonce, url, name, exitHash(), identity);
                await socket.SendAsync(answer, received.RemoteEndPoint, token).ConfigureAwait(false);
                Answered++;
            }
            catch (Exception error) when (error is SocketException or OperationCanceledException or ObjectDisposedException)
            {
                // The asker will ask again in three seconds.
            }
        }
    }

    public void Dispose()
    {
        stop.Cancel();
        socket.Dispose();
        stop.Dispose();
    }
}
