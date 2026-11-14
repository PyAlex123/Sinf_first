using System.Net.Http;
using System.Net.Http.Json;
using System.Text.Json.Serialization;

namespace Sinf.Desktop;

/// <summary>
/// The link between this computer and the platform (S2.4). The school adds the machine in its cabinet
/// and reads out a pairing code; the app trades it for a token of its own and then reports in, so the
/// school sees which machines are alive. Nothing of the lesson goes through here yet: lessons still run
/// on this computer (ADR-009), and content and results follow in S2.5 and S2.6.
/// </summary>
internal sealed class Platform : IDisposable
{
    /// <summary>Often enough for "на связи" in the cabinet, rare enough to cost nothing.</summary>
    private static readonly TimeSpan HeartbeatPeriod = TimeSpan.FromMinutes(2);

    private readonly HttpClient http = new() { Timeout = TimeSpan.FromSeconds(15) };
    private readonly Action<string> report;
    private CancellationTokenSource? beating;

    public Platform(Action<string> report)
    {
        this.report = report;
    }

    public sealed record PairedSchool(string Id, string Name);

    public sealed record PairResult(
        [property: JsonPropertyName("deviceId")] string DeviceId,
        [property: JsonPropertyName("deviceToken")] string DeviceToken,
        [property: JsonPropertyName("name")] string Name,
        [property: JsonPropertyName("room")] string? Room,
        [property: JsonPropertyName("school")] PairedSchool School);

    private sealed record ErrorBody(
        [property: JsonPropertyName("error")] string? Error,
        [property: JsonPropertyName("message")] string? Message);

    /// <summary>Trades the code the school read out for this computer's own token.</summary>
    public async Task<PairResult> PairAsync(string platformUrl, string code, CancellationToken token)
    {
        var baseUrl = Normalize(platformUrl);
        var response = await http
            .PostAsJsonAsync(
                $"{baseUrl}/api/devices/pair",
                new
                {
                    code = code.Trim().ToUpperInvariant(),
                    appVersion = Version,
                    platform = Environment.OSVersion.VersionString,
                },
                token)
            .ConfigureAwait(false);
        if (!response.IsSuccessStatusCode)
        {
            var body = await ReadErrorAsync(response, token).ConfigureAwait(false);
            throw new InvalidOperationException(body);
        }

        var result =
            await response.Content.ReadFromJsonAsync<PairResult>(token).ConfigureAwait(false)
            ?? throw new InvalidOperationException("Платформа ответила пустым сообщением.");
        return result;
    }

    /// <summary>Starts reporting in, if this computer is attached to a school.</summary>
    public void StartHeartbeat(HostConfig config)
    {
        if (!config.IsPaired)
        {
            return;
        }

        beating?.Cancel();
        beating = new CancellationTokenSource();
        var token = beating.Token;
        _ = Task.Run(() => BeatAsync(config, token), token);
    }

    private async Task BeatAsync(HostConfig config, CancellationToken token)
    {
        while (!token.IsCancellationRequested)
        {
            try
            {
                using var message = new HttpRequestMessage(
                    HttpMethod.Post,
                    $"{Normalize(config.PlatformUrl!)}/api/devices/heartbeat")
                {
                    Content = JsonContent.Create(new { appVersion = Version }),
                };
                message.Headers.TryAddWithoutValidation("Authorization", $"Device {config.DeviceToken}");
                using var response = await http.SendAsync(message, token).ConfigureAwait(false);
                if (response.StatusCode == System.Net.HttpStatusCode.Unauthorized)
                {
                    // The school unpaired this machine: stop and say so instead of knocking forever.
                    report("Школа отвязала этот компьютер. Введите новый код.");
                    return;
                }
            }
            catch (Exception error) when (error is HttpRequestException or TaskCanceledException)
            {
                // No internet right now: the lesson does not depend on it (CLAUDE.md §3.3).
            }

            try
            {
                await Task.Delay(HeartbeatPeriod, token).ConfigureAwait(false);
            }
            catch (TaskCanceledException)
            {
                return;
            }
        }
    }

    public static string Version =>
        typeof(Platform).Assembly.GetName().Version?.ToString(3) ?? "0";

    /// <summary>Accepts "sinf.uz", "https://sinf.uz" and a trailing slash alike.</summary>
    public static string Normalize(string url)
    {
        var trimmed = url.Trim().TrimEnd('/');
        if (trimmed.Length == 0)
        {
            throw new InvalidOperationException("Адрес платформы не указан.");
        }

        return trimmed.StartsWith("http://", StringComparison.OrdinalIgnoreCase)
            || trimmed.StartsWith("https://", StringComparison.OrdinalIgnoreCase)
            ? trimmed
            : $"https://{trimmed}";
    }

    private static async Task<string> ReadErrorAsync(HttpResponseMessage response, CancellationToken token)
    {
        try
        {
            var body = await response.Content.ReadFromJsonAsync<ErrorBody>(token).ConfigureAwait(false);
            if (body?.Error == "bad_code")
            {
                return "Код не подошёл. Попросите в школе новый.";
            }

            if (body?.Error == "too_many_attempts")
            {
                return "Слишком много попыток. Подождите и попробуйте снова.";
            }

            return body?.Message ?? $"Платформа ответила ошибкой {(int)response.StatusCode}.";
        }
        catch (Exception error) when (error is HttpRequestException or NotSupportedException)
        {
            return $"Платформа ответила ошибкой {(int)response.StatusCode}.";
        }
    }

    public void Dispose()
    {
        beating?.Cancel();
        beating?.Dispose();
        http.Dispose();
    }
}
