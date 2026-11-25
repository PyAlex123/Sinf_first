using System.Diagnostics;
using System.Net.Http;
using System.Runtime.InteropServices;
using System.Text.Json;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;
using Sinf.Desktop.Core;

namespace Sinf.Desktop;

/// <summary>
/// The whole app: one window with the Sinf teacher panel inside it. The interface is the web client that
/// ships in the package, shown by WebView2 — no external browser is ever opened (ADR-001, ADR-008).
/// </summary>
internal sealed class MainForm : Form
{
    private static readonly Color BarColor = Color.FromArgb(19, 35, 58);
    private static readonly Color AccentColor = Color.FromArgb(255, 106, 0);

    private readonly AppPaths paths;
    private readonly WebView2 view = new() { Dock = DockStyle.Fill, Visible = false };
    private readonly Panel bar = new() { Dock = DockStyle.Top, Height = 52, BackColor = BarColor };
    private readonly Label addressLabel = new() { AutoSize = true, ForeColor = Color.White };
    private readonly Label accountLabel = new() { AutoSize = true, ForeColor = Color.Gainsboro };
    private readonly Button copyButton = new() { Text = "Копировать адрес", AutoSize = true };
    private readonly Button fullScreenButton = new() { Text = "Во весь экран", AutoSize = true };
    private readonly Button reloadButton = new() { Text = "Обновить", AutoSize = true };
    private readonly Button schoolButton = new() { Text = "Школа", AutoSize = true };
    private readonly Button updateButton = new() { Text = "Обновить материалы", AutoSize = true };
    private readonly Button exitPasswordButton = new() { Text = "Пароль учеников", AutoSize = true };
    /// <summary>The demo account's password, on request only: the bar is on the projector (review 2026-11-25).</summary>
    private readonly Button demoPasswordButton = new() { Text = "Пароль демо", AutoSize = true };
    private readonly Label splash = new()
    {
        Dock = DockStyle.Fill,
        TextAlign = ContentAlignment.MiddleCenter,
        Text = "Запускаем Sinf…",
        ForeColor = BarColor,
    };

    // When the start fails, the reason is on the screen: the end of the server's log, where it is
    // kept, and a second try. The author once had to dig the log out of AppData (pc-test.md 8.3).
    private readonly Panel failurePanel = new()
    {
        Dock = DockStyle.Bottom,
        Height = 280,
        Padding = new Padding(32, 0, 32, 24),
        Visible = false,
    };
    private readonly TextBox failureLog = new()
    {
        Dock = DockStyle.Fill,
        Multiline = true,
        ReadOnly = true,
        ScrollBars = ScrollBars.Vertical,
        BorderStyle = BorderStyle.FixedSingle,
        BackColor = Color.FromArgb(246, 247, 249),
        ForeColor = Color.FromArgb(19, 35, 58),
    };
    private readonly Button openLogButton = new() { Text = "Открыть журнал", AutoSize = true };
    private readonly Button retryButton = new() { Text = "Повторить", AutoSize = true };

    private HostConfig config;
    private readonly Platform platform;
    private ServerProcess? server;
    private ActivityBeat? beat;
    /// <summary>"Мой экран" (H14): this computer's screen for the class, while the teacher shows it.</summary>
    private ScreenShare? share;
    /// <summary>Answers student computers that look for this lesson on the network (ADR-014 §3).</summary>
    private TeacherBeacon? beacon;
    private TeacherIdentity? identity;
    /// <summary>For the beacon's question to the lesson server; short, the student asks again in 5 s.</summary>
    private readonly HttpClient lockClient = new() { Timeout = TimeSpan.FromMilliseconds(700) };
    private FormWindowState beforeFullScreen = FormWindowState.Maximized;
    private bool fullScreen;

    public MainForm(AppPaths paths, HostConfig config)
    {
        this.paths = paths;
        this.config = config;
        platform = new Platform(message => BeginInvoke(() => accountLabel.Text = message));

        Text = "Sinf";
        WindowState = FormWindowState.Maximized;
        MinimumSize = new Size(1024, 640);
        BackColor = Color.White;
        Font = new Font("Segoe UI", 9.75f);
        splash.Font = new Font("Segoe UI", 14f);
        try
        {
            Icon = new Icon(Path.Combine(paths.Root, "sinf.ico"));
        }
        catch (Exception error) when (error is IOException or ArgumentException)
        {
            // The window simply keeps the default icon.
        }

        BuildBar();
        BuildFailurePanel();
        Controls.Add(view);
        Controls.Add(splash);
        Controls.Add(failurePanel);
        Controls.Add(bar);
        bar.Visible = false;
    }

    private void BuildBar()
    {
        var left = new FlowLayoutPanel
        {
            Dock = DockStyle.Left,
            AutoSize = true,
            FlowDirection = FlowDirection.TopDown,
            Padding = new Padding(12, 7, 12, 7),
            WrapContents = false,
        };
        addressLabel.Font = new Font("Segoe UI", 11f, FontStyle.Bold);
        addressLabel.ForeColor = AccentColor;
        left.Controls.Add(addressLabel);
        left.Controls.Add(accountLabel);

        var right = new FlowLayoutPanel
        {
            Dock = DockStyle.Right,
            AutoSize = true,
            FlowDirection = FlowDirection.RightToLeft,
            Padding = new Padding(8, 10, 12, 10),
            WrapContents = false,
        };
        foreach (var button in new[] { reloadButton, fullScreenButton, updateButton, schoolButton, exitPasswordButton, demoPasswordButton, copyButton })
        {
            button.FlatStyle = FlatStyle.Flat;
            button.BackColor = Color.White;
            button.Margin = new Padding(6, 0, 0, 0);
            button.Padding = new Padding(10, 4, 10, 4);
            right.Controls.Add(button);
        }

        copyButton.Click += (_, _) => CopyAddress();
        reloadButton.Click += (_, _) => view.CoreWebView2?.Reload();
        fullScreenButton.Click += (_, _) => ToggleFullScreen();
        schoolButton.Click += (_, _) => PairWithSchool();
        exitPasswordButton.Click += (_, _) => SetExitPassword();
        demoPasswordButton.Click += (_, _) => MessageBox.Show(
            this,
            $"Демо-учётка: demo@sinf.local\nПароль: {config.TeacherPassword}\n\nВойти ею можно только на этом компьютере.",
            "Sinf",
            MessageBoxButtons.OK,
            MessageBoxIcon.Information);
        updateButton.Click += async (_, _) => await UpdateContentAsync(manual: true).ConfigureAwait(true);

        bar.Controls.Add(left);
        bar.Controls.Add(right);
    }

    private void BuildFailurePanel()
    {
        failureLog.Font = new Font("Consolas", 9.75f);
        var buttons = new FlowLayoutPanel
        {
            Dock = DockStyle.Top,
            AutoSize = true,
            Padding = new Padding(0, 0, 0, 8),
            WrapContents = false,
        };
        foreach (var button in new[] { retryButton, openLogButton })
        {
            button.FlatStyle = FlatStyle.Flat;
            button.BackColor = Color.White;
            button.Padding = new Padding(10, 4, 10, 4);
            button.Margin = new Padding(0, 0, 8, 0);
            buttons.Controls.Add(button);
        }

        openLogButton.Click += (_, _) => OpenLog();
        retryButton.Click += async (_, _) => await StartAsync().ConfigureAwait(true);
        failurePanel.Controls.Add(failureLog);
        failurePanel.Controls.Add(buttons);
    }

    private void OpenLog()
    {
        try
        {
            Process.Start(new ProcessStartInfo(paths.LogFile) { UseShellExecute = true })?.Dispose();
        }
        catch (Exception error) when (error is System.ComponentModel.Win32Exception or IOException)
        {
            failureLog.AppendText($"{Environment.NewLine}Не удалось открыть журнал: {error.Message}");
        }
    }

    protected override async void OnShown(EventArgs e)
    {
        base.OnShown(e);
        await StartAsync().ConfigureAwait(true);
    }

    private async Task StartAsync()
    {
        failurePanel.Visible = false;
        splash.Font = new Font("Segoe UI", 14f);
        splash.Text = "Запускаем Sinf…";
        splash.Visible = true;
        view.Visible = false;
        // Before the server starts, so a lesson that arrived on the platform is there from the first screen.
        if (config.IsPaired)
        {
            splash.Text = "Проверяем материалы уроков…";
            await UpdateContentAsync(manual: false).ConfigureAwait(true);
        }

        try
        {
            server = await ServerProcess
                .StartAsync(paths, config, message => splash.Text = message, CancellationToken.None)
                .ConfigureAwait(true);
        }
        catch (Exception error)
        {
            // Nothing is running yet, so a second try starts from scratch.
            ShowFailure(error.Message, (error as ServerStartException)?.LogTail, canRetry: true);
            return;
        }

        // For the updater (B6): this computer's own lesson server, which also says when a lesson is on.
        var local = server.LocalUrl;
        beat = new ActivityBeat(paths, () => new Core.Activity(
            DateTimeOffset.UtcNow,
            HostConfig.TeacherRole,
            InLesson: false,
            ServerUrl: local,
            PlatformUrl: config.IsPaired ? config.PlatformUrl : null));

        var lan = LanAddress.Find();
        var lanUrl = lan is null ? null : $"http://{lan}:{server.Port}";
        addressLabel.Text = lanUrl is null
            ? "Сеть не найдена — ученики не смогут подключиться"
            : $"Ученики заходят: {lanUrl}";
        // The password is not on the bar any more: the bar is on the projector, and pupils read it for
        // the address. The teacher signs in only on this computer anyway (auth/local.ts).
        accountLabel.Text = "Учитель: demo@sinf.local · пароль — кнопка «Пароль демо»";
        copyButton.Enabled = lanUrl is not null;
        StartBeacon(lanUrl);
        if (identity is not null)
        {
            // Read off this screen and the student's when a student computer meets its teacher (H9).
            accountLabel.Text += $" · ключ: {TeacherIdentity.Fingerprint(identity.PublicKey)}";
        }

        splash.Text = "Открываем панель учителя…";
        try
        {
            await OpenPanelAsync(lanUrl).ConfigureAwait(true);
        }
        catch (WebView2RuntimeNotFoundException)
        {
            OfferRuntimeInstall();
            return;
        }
        catch (Exception error)
        {
            ShowFailure(error.Message);
            return;
        }

        splash.Visible = false;
        view.Visible = true;
        bar.Visible = true;
        ShowSchool();
        platform.StartHeartbeat(config);
        if (!config.HasExitPassword)
        {
            // Without it the student kiosks have no way out for the administrator (H3).
            SetExitPassword();
        }
    }

    /// <summary>
    /// The one exit password of the student kiosks in this room (H3, author's choice). Only the hash
    /// is kept; the beacon hands it to student computers at their next search.
    /// </summary>
    private void SetExitPassword()
    {
        using var dialog = new NewExitPasswordDialog();
        if (dialog.ShowDialog(this) != DialogResult.OK)
        {
            return;
        }

        config = config with { ExitPasswordHash = dialog.Hash };
        HostConfig.Save(paths, config);
        MessageBox.Show(
            this,
            "Пароль сохранён. Компьютеры учеников получат его, когда в следующий раз найдут этот компьютер.",
            "Sinf",
            MessageBoxButtons.OK,
            MessageBoxIcon.Information);
    }

    /// <summary>
    /// Whether a student computer is to stay locked, from this computer's own lesson server (review
    /// 2026-11-25). The beacon signs the answer, so the kiosk takes an unlock only from here, never
    /// from a page. Asked on the beacon's thread; a server that does not answer says "not locked".
    /// </summary>
    private bool LockedOnServer(string? pc)
    {
        var current = server;
        if (current is null)
        {
            return false;
        }

        try
        {
            var query = pc is null ? string.Empty : $"?pc={Uri.EscapeDataString(pc)}";
            using var request = new HttpRequestMessage(HttpMethod.Get, $"{current.LocalUrl}/api/join/room/locked{query}");
            request.Headers.Add("x-host-token", current.HostToken);
            using var answer = lockClient.Send(request);
            if (!answer.IsSuccessStatusCode)
            {
                return false;
            }

            using var body = answer.Content.ReadAsStream();
            using var document = JsonDocument.Parse(body);
            return document.RootElement.TryGetProperty("locked", out var locked) && locked.ValueKind == JsonValueKind.True;
        }
        catch (Exception error) when (error is HttpRequestException or TaskCanceledException or JsonException or IOException or InvalidOperationException)
        {
            return false;
        }
    }

    /// <summary>
    /// Student computers find this one by a broadcast question (ADR-014 §3). If the port is taken —
    /// another Sinf already answers on this machine — the lesson still runs; students type the address.
    /// </summary>
    private void StartBeacon(string? lanUrl)
    {
        if (lanUrl is null)
        {
            return;
        }

        try
        {
            // The key that signs every answer (H9); student computers remember it at their first meeting.
            identity = TeacherIdentity.LoadOrCreate(paths.TeacherKeyFile);
            beacon = new TeacherBeacon(
                () => lanUrl,
                Environment.MachineName,
                identity,
                () => config.ExitPasswordHash,
                isLocked: LockedOnServer);
        }
        catch (System.Net.Sockets.SocketException)
        {
            accountLabel.Text += " · поиск по сети недоступен: ученики вводят адрес вручную";
        }
    }

    /// <summary>
    /// Fetches whatever lesson material this computer lacks (S2.5). No internet is not a failure: the
    /// lesson runs from the copy already here.
    /// </summary>
    private async Task UpdateContentAsync(bool manual)
    {
        if (!config.IsPaired)
        {
            if (manual)
            {
                MessageBox.Show(
                    this,
                    "Сначала привяжите компьютер к школе.",
                    "Sinf",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Information);
            }

            return;
        }

        updateButton.Enabled = false;
        try
        {
            var sync = new ContentSync(platform.Http, paths);
            var result = await sync.SyncAsync(config, CancellationToken.None).ConfigureAwait(true);
            if (manual)
            {
                MessageBox.Show(
                    this,
                    result.Downloaded == 0
                        ? "Материалы уже свежие."
                        : $"Загружено файлов: {result.Downloaded}. Перезапустите Sinf, чтобы новые уроки появились в списке.",
                    "Sinf",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Information);
            }
        }
        catch (Exception error) when (error is HttpRequestException or TaskCanceledException)
        {
            if (manual)
            {
                MessageBox.Show(
                    this,
                    "Нет связи с платформой. Урок идёт на материалах, которые уже есть на этом компьютере.",
                    "Sinf",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Information);
            }
        }
        catch (Exception error) when (error is InvalidOperationException or IOException)
        {
            if (manual)
            {
                MessageBox.Show(this, error.Message, "Sinf", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            }
        }
        finally
        {
            updateButton.Enabled = true;
        }
    }

    /// <summary>Says which school this computer belongs to, or offers to attach it (S2.4).</summary>
    private void ShowSchool()
    {
        schoolButton.Text = config.IsPaired ? "Школа: привязан" : "Привязать к школе";
    }

    private void PairWithSchool()
    {
        using var dialog = new PairDialog(platform, config.PlatformUrl);
        if (dialog.ShowDialog(this) != DialogResult.OK || dialog.Result is null)
        {
            return;
        }

        config = config with
        {
            PlatformUrl = Platform.Normalize(dialog.PlatformUrl),
            DeviceToken = dialog.Result.DeviceToken,
        };
        HostConfig.Save(paths, config);
        ShowSchool();
        platform.StartHeartbeat(config);
        MessageBox.Show(
            this,
            $"Компьютер «{dialog.Result.Name}» привязан к школе «{dialog.Result.School.Name}».",
            "Sinf",
            MessageBoxButtons.OK,
            MessageBoxIcon.Information);
    }

    private async Task OpenPanelAsync(string? lanUrl)
    {
        var environment = await CoreWebView2Environment
            .CreateAsync(browserExecutableFolder: null, userDataFolder: paths.WebViewDir)
            .ConfigureAwait(true);
        await view.EnsureCoreWebView2Async(environment).ConfigureAwait(true);

        var core = view.CoreWebView2;
        var settings = core.Settings;
        settings.AreDevToolsEnabled = false;
        settings.AreDefaultContextMenusEnabled = false;
        settings.IsStatusBarEnabled = false;
        settings.AreBrowserAcceleratorKeysEnabled = false;
        settings.IsSwipeNavigationEnabled = false;
        settings.IsPasswordAutosaveEnabled = false;
        settings.IsGeneralAutofillEnabled = false;

        // The bridge of CLAUDE.md §5.5: the web client reads this through `platform.ts`.
        var host = JsonSerializer.Serialize(new
        {
            isDesktop = true,
            role = "teacher",
            version = typeof(MainForm).Assembly.GetName().Version?.ToString() ?? "0",
            lanUrl,
        });
        await core.AddScriptToExecuteOnDocumentCreatedAsync($"window.sinfHost = {host};")
            .ConfigureAwait(true);

        // Everything stays in this window: no new windows, no navigation away from our own server.
        core.NewWindowRequested += (_, e) =>
        {
            e.Handled = true;
            if (IsOurs(e.Uri))
            {
                core.Navigate(e.Uri);
            }
        };
        core.NavigationStarting += (_, e) =>
        {
            if (!IsOurs(e.Uri))
            {
                e.Cancel = true;
            }
        };

        // The panel asks this app for one thing only: to film this screen for the class (H14).
        core.WebMessageReceived += (_, e) =>
        {
            if (server is not null && Uri.TryCreate(e.Source, UriKind.Absolute, out var from) && IsOurs(from.ToString()))
            {
                OnPanelMessage(e.WebMessageAsJson);
            }
        };

        core.Navigate($"{server!.LocalUrl}/teacher");
    }

    private void OnPanelMessage(string json)
    {
        try
        {
            using var document = JsonDocument.Parse(json);
            var root = document.RootElement;
            if (root.ValueKind != JsonValueKind.Object
                || !root.TryGetProperty("type", out var type)
                || type.GetString() != "share")
            {
                return;
            }

            var on = root.TryGetProperty("on", out var o) && o.ValueKind == JsonValueKind.True;
            var sessionId = root.TryGetProperty("sessionId", out var s) ? s.GetString() : null;
            _ = SetShareAsync(on ? sessionId : null);
        }
        catch (JsonException)
        {
            // Not ours.
        }
    }

    /// <summary>
    /// "Мой экран" on (a lesson id) or off (null). The screen goes to this computer's own lesson
    /// server with the secret it was started with; the server passes it on to every child.
    /// </summary>
    private async Task SetShareAsync(string? sessionId)
    {
        var old = share;
        share = null;
        if (old is not null)
        {
            await old.DisposeAsync().ConfigureAwait(true);
        }

        if (sessionId is null || server is null)
        {
            return;
        }

        var next = new ScreenShare(
            new Uri($"ws://127.0.0.1:{server.Port}/ws/demo?session={Uri.EscapeDataString(sessionId)}"),
            server.HostToken);
        try
        {
            await next.StartAsync().ConfigureAwait(true);
            share = next;
        }
        catch (Exception error) when (error is System.Net.WebSockets.WebSocketException or OperationCanceledException)
        {
            await next.DisposeAsync().ConfigureAwait(true);
        }
    }

    private bool IsOurs(string uri)
    {
        return Uri.TryCreate(uri, UriKind.Absolute, out var parsed)
            && parsed.Port == server?.Port
            && parsed.Host is "127.0.0.1" or "localhost";
    }

    private void CopyAddress()
    {
        var text = addressLabel.Text.Split(": ", 2) is [_, var url] ? url : addressLabel.Text;
        try
        {
            Clipboard.SetText(text);
        }
        catch (ExternalException)
        {
            // Another program held the clipboard; nothing to do but let the teacher read the address.
        }
    }

    private void ToggleFullScreen()
    {
        fullScreen = !fullScreen;
        if (fullScreen)
        {
            beforeFullScreen = WindowState;
            FormBorderStyle = FormBorderStyle.None;
            WindowState = FormWindowState.Normal;
            WindowState = FormWindowState.Maximized;
            fullScreenButton.Text = "Выйти из полного экрана";
        }
        else
        {
            FormBorderStyle = FormBorderStyle.Sizable;
            WindowState = beforeFullScreen;
            fullScreenButton.Text = "Во весь экран";
        }
    }

    private void ShowFailure(string message, string? logTail = null, bool canRetry = false)
    {
        splash.Visible = true;
        view.Visible = false;
        splash.Text = message;
        splash.Font = new Font("Segoe UI", 12f);
        var nl = Environment.NewLine;
        failureLog.Text = string.IsNullOrWhiteSpace(logTail)
            ? $"Журнал: {paths.LogFile}"
            : $"Конец журнала ({paths.LogFile}):{nl}{nl}{logTail}";
        retryButton.Visible = canRetry;
        openLogButton.Enabled = File.Exists(paths.LogFile);
        failurePanel.Visible = true;
    }

    private void OfferRuntimeInstall()
    {
        var installer = Path.Combine(paths.Root, "MicrosoftEdgeWebview2Setup.exe");
        if (!File.Exists(installer))
        {
            ShowFailure(
                "На этом компьютере нет WebView2 Runtime, и установщика нет в папке программы. "
                + "Установите Microsoft Edge WebView2 Runtime и запустите Sinf снова.");
            return;
        }

        var answer = MessageBox.Show(
            this,
            "Для работы нужен компонент Windows «WebView2 Runtime». Установить его сейчас?",
            "Sinf",
            MessageBoxButtons.YesNo,
            MessageBoxIcon.Question);
        if (answer != DialogResult.Yes)
        {
            ShowFailure("Без WebView2 Runtime программа работать не может.");
            return;
        }

        try
        {
            Process.Start(new ProcessStartInfo(installer) { UseShellExecute = true })?.Dispose();
            ShowFailure("Установите компонент и запустите Sinf снова.");
        }
        catch (Exception error) when (error is System.ComponentModel.Win32Exception or IOException)
        {
            ShowFailure($"Не удалось запустить установщик: {error.Message}");
        }
    }

    protected override async void OnFormClosing(FormClosingEventArgs e)
    {
        base.OnFormClosing(e);
        if (e.Cancel || server is null)
        {
            return;
        }

        // Hold the window open until the server is really gone, otherwise node.exe can outlive it.
        e.Cancel = true;
        var stopping = server;
        server = null;
        view.Visible = false;
        splash.Text = "Завершаем урок…";
        splash.Visible = true;
        platform.Dispose();
        if (share is not null)
        {
            await share.DisposeAsync().ConfigureAwait(true);
            share = null;
        }

        beacon?.Dispose();
        lockClient.Dispose();
        beacon = null;
        beat?.Dispose();
        beat = null;
        identity?.Dispose();
        identity = null;
        await stopping.DisposeAsync().ConfigureAwait(true);
        Close();
    }
}
