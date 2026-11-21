using System.IO.Pipes;
using System.Text.Json;
using Sinf.Desktop.Core;

namespace Sinf.Desktop;

/// <summary>
/// Sinf's side of the agent's pipe (B7, ADR-024). Without the agent (it is opt-in) every call simply
/// answers null within a fraction of a second, and the kiosk works as before.
/// </summary>
internal static class AgentPipe
{
    public sealed record Answer(bool Ok, bool Lock, bool Maintenance);

    private static Answer? Ask(object message)
    {
        try
        {
            using var pipe = new NamedPipeClientStream(".", AgentPlan.PipeName, PipeDirection.InOut);
            pipe.Connect(300);
            using var writer = new StreamWriter(pipe, leaveOpen: true) { AutoFlush = true };
            using var reader = new StreamReader(pipe, leaveOpen: true);
            writer.WriteLine(JsonSerializer.Serialize(message));
            var line = reader.ReadLine();
            if (line is null)
            {
                return null;
            }

            using var doc = JsonDocument.Parse(line);
            var r = doc.RootElement;
            return new Answer(
                r.GetProperty("ok").GetBoolean(),
                r.GetProperty("lock").GetBoolean(),
                r.GetProperty("maintenance").GetBoolean());
        }
        catch (Exception error) when (error is TimeoutException or IOException or UnauthorizedAccessException or JsonException or KeyNotFoundException or InvalidOperationException)
        {
            return null;
        }
    }

    /// <summary>At start: was this computer locked when the previous Sinf died?</summary>
    public static Answer? Hello() => Ask(new { type = "hello" });

    /// <summary>The teacher's lock, remembered outside Sinf; in the background, never in the way.</summary>
    public static void Lock(bool on) => _ = Task.Run(() => Ask(new { type = "lock", on }));

    /// <summary>Maintenance time for the administrator: the agent checks the password itself.</summary>
    public static Answer? Maintenance(string password) => Ask(new { type = "maintenance", password });
}
