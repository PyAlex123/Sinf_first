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
    private readonly Label splash = new()
    {
        Dock = DockStyle.Fill,
        TextAlign = ContentAlignment.MiddleCenter,
        Text = "Запускаем Sinf…",
        ForeColor = BarColor,
    };

    private HostConfig config;
    private readonly Platform platform;
    private ServerProcess? server;
    private ActivityBeat? beat;
    /// <summary>"Мой экран" (H14): this computer's screen for the class, while the teacher shows it.</summary>
    private ScreenShare? share;
    /// <summary>Answers student computers that look for this lesson on the network (ADR-014 §3).</summary>
    private TeacherBeacon? beacon;
    private TeacherIdentity? identity;
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
        Controls.Add(view);
        Controls.Add(splash);
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
        foreach (var button in new[] { reloadButton, fullScreenButton, updateButton, schoolButton, exitPasswordButton, copyButton })
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
        updateButton.Click += async (_, _) => await UpdateContentAsync(manual: true).ConfigureAwait(true);

        bar.Controls.Add(left);
        bar.Controls.Add(right);
    }

    protected override async void OnShown(EventArgs e)
    {
        base.OnShown(e);
        await StartAsync().ConfigureAwait(true);
    }

    private async Task StartAsync()
    {
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
            ShowFailure(error.Message);
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
        accountLabel.Text = $"Учитель: demo@sinf.local · пароль: {config.TeacherPassword}";
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
            beacon = new TeacherBeacon(() => lanUrl, Environment.MachineName, identity, () => config.ExitPasswordHash);
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

    private void ShowFailure(string message)
    {
        splash.Visible = true;
        view.Visible = false;
        splash.Text = $"{message}\n\nЖурнал: {paths.LogFile}";
        splash.Font = new Font("Segoe UI", 11f);
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
        beacon = null;
        beat?.Dispose();
        beat = null;
        identity?.Dispose();
        identity = null;
        await stopping.DisposeAsync().ConfigureAwait(true);
        Close();
    }
}
