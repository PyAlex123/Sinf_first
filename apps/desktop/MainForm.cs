using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text.Json;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace Sinf.Desktop;

/// <summary>
/// The whole app: one window with the Sinf teacher panel inside it. The interface is the web client that
/// ships in the package, shown by WebView2 — no external browser is ever opened (ADR-001, ADR-008).
/// </summary>
internal sealed class MainForm : Form
{
    private static readonly Color BarColor = Color.FromArgb(19, 35, 58);
    private static readonly Color AccentColor = Color.FromArgb(255, 106, 0);

    private readonly AppPaths paths = AppPaths.Create();
    private readonly WebView2 view = new() { Dock = DockStyle.Fill, Visible = false };
    private readonly Panel bar = new() { Dock = DockStyle.Top, Height = 52, BackColor = BarColor };
    private readonly Label addressLabel = new() { AutoSize = true, ForeColor = Color.White };
    private readonly Label accountLabel = new() { AutoSize = true, ForeColor = Color.Gainsboro };
    private readonly Button copyButton = new() { Text = "Копировать адрес", AutoSize = true };
    private readonly Button fullScreenButton = new() { Text = "Во весь экран", AutoSize = true };
    private readonly Button reloadButton = new() { Text = "Обновить", AutoSize = true };
    private readonly Label splash = new()
    {
        Dock = DockStyle.Fill,
        TextAlign = ContentAlignment.MiddleCenter,
        Text = "Запускаем Sinf…",
        ForeColor = BarColor,
    };

    private readonly HostConfig config;
    private ServerProcess? server;
    private FormWindowState beforeFullScreen = FormWindowState.Maximized;
    private bool fullScreen;

    public MainForm()
    {
        config = HostConfig.Load(paths);

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
        foreach (var button in new[] { reloadButton, fullScreenButton, copyButton })
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

        var lan = LanAddress.Find();
        var lanUrl = lan is null ? null : $"http://{lan}:{server.Port}";
        addressLabel.Text = lanUrl is null
            ? "Сеть не найдена — ученики не смогут подключиться"
            : $"Ученики заходят: {lanUrl}";
        accountLabel.Text = $"Учитель: demo@sinf.local · пароль: {config.TeacherPassword}";
        copyButton.Enabled = lanUrl is not null;

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

        core.Navigate($"{server!.LocalUrl}/teacher");
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
        await stopping.DisposeAsync().ConfigureAwait(true);
        Close();
    }
}
