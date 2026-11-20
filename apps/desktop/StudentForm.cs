using System.Net.Http;
using System.Text.Json;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;
using Sinf.Desktop.Core;

namespace Sinf.Desktop;

/// <summary>
/// A student's computer (ADR-014): no server of its own. It finds the teacher's computer on the network,
/// opens the lesson there in WebView2 and stays on it. When the teacher's computer goes away, it goes
/// back to looking.
///
/// The kiosk (H3, CLAUDE.md §8) is what the shell itself can do: always on top, keys that lead out
/// swallowed, focus taken back, no closing, only the lesson's own pages, the way out behind the
/// administrator's password. Ctrl+Alt+Del and Win+L stay open until the agent (6.4).
/// </summary>
internal sealed class StudentForm : Form
{
    private static readonly Color Dark = Color.FromArgb(19, 35, 58);
    private static readonly TimeSpan SearchPause = TimeSpan.FromSeconds(3);
    private static readonly TimeSpan WatchPeriod = TimeSpan.FromSeconds(5);
    private static readonly TimeSpan TakeFocusBack = TimeSpan.FromMilliseconds(300);

    private readonly AppPaths paths;
    private HostConfig config;
    private readonly HttpClient http = new() { Timeout = TimeSpan.FromSeconds(2) };
    private readonly CancellationTokenSource life = new();
    private readonly WebView2 view = new() { Dock = DockStyle.Fill, Visible = false };
    private readonly Panel waiting = new() { Dock = DockStyle.Fill, BackColor = Dark };
    private readonly Label title = new()
    {
        AutoSize = false,
        Dock = DockStyle.Top,
        Height = 120,
        TextAlign = ContentAlignment.BottomCenter,
        ForeColor = Color.White,
        Text = "Ищем компьютер учителя…",
    };
    private readonly Label status = new()
    {
        AutoSize = false,
        Dock = DockStyle.Top,
        Height = 80,
        TextAlign = ContentAlignment.MiddleCenter,
        ForeColor = Color.Gainsboro,
    };
    private readonly Button manual = new() { Text = "Ввести адрес вручную", AutoSize = true };
    private readonly System.Windows.Forms.Timer watch = new();

    private readonly bool dev;
    private readonly KeyboardGuard? keyboard;
    /// <summary>Exists only while the teacher's "Attention!" is on (H4).</summary>
    private MouseGuard? mouse;
    /// <summary>What the teacher asked for, so the lock comes back after the administrator's dialog.</summary>
    private bool lockedByTeacher;
    private readonly AccessibilityGuard? accessibility;
    private readonly System.Windows.Forms.Timer focusBack = new();

    private string? teacherUrl;
    private bool webReady;
    private bool searching;
    private int failedChecks;
    /// <summary>Our own dialog is up: it may have the focus, and the window must not take it back.</summary>
    private bool dialogOpen;
    /// <summary>Set only after the administrator's password (or by Windows shutting down).</summary>
    private bool closeAllowed;

    /// <param name="dev">`--dev` (CLAUDE.md §9.9, after the password): a normal window, no kiosk.</param>
    public StudentForm(AppPaths paths, HostConfig config, bool dev = false)
    {
        this.paths = paths;
        this.config = config;
        this.dev = dev;

        Text = $"Sinf — {config.PcName ?? "ученик"}" + (dev ? " — РЕЖИМ РАЗРАБОТКИ" : string.Empty);
        if (dev)
        {
            FormBorderStyle = FormBorderStyle.Sizable;
            WindowState = FormWindowState.Normal;
            Size = new Size(1280, 800);
            StartPosition = FormStartPosition.CenterScreen;
        }
        else
        {
            FormBorderStyle = FormBorderStyle.None;
            WindowState = FormWindowState.Maximized;
            TopMost = true;
            keyboard = new KeyboardGuard(() => BeginInvoke(AskPassword));
            accessibility = new AccessibilityGuard();
            focusBack.Interval = (int)TakeFocusBack.TotalMilliseconds;
            focusBack.Tick += (_, _) =>
            {
                focusBack.Stop();
                if (!dialogOpen && !closeAllowed)
                {
                    Activate();
                }
            };
            Deactivate += (_, _) =>
            {
                if (!dialogOpen)
                {
                    focusBack.Start();
                }
            };
        }

        BackColor = Dark;
        Font = new Font("Segoe UI", 12f);
        title.Font = new Font("Segoe UI", 26f, FontStyle.Bold);
        status.Font = new Font("Segoe UI", 13f);
        try
        {
            Icon = new Icon(Path.Combine(paths.Root, "sinf.ico"));
        }
        catch (Exception error) when (error is IOException or ArgumentException)
        {
            // The window keeps the default icon.
        }

        manual.FlatStyle = FlatStyle.Flat;
        manual.BackColor = Color.White;
        manual.Padding = new Padding(12, 6, 12, 6);
        manual.Click += (_, _) => EnterAddress();
        var bottom = new FlowLayoutPanel
        {
            Dock = DockStyle.Top,
            Height = 70,
            FlowDirection = FlowDirection.LeftToRight,
            Padding = new Padding(0, 10, 0, 0),
        };
        bottom.Controls.Add(manual);
        bottom.Resize += (_, _) => manual.Left = (bottom.Width - manual.Width) / 2;
        var name = new Label
        {
            AutoSize = false,
            Dock = DockStyle.Bottom,
            Height = 40,
            TextAlign = ContentAlignment.MiddleCenter,
            ForeColor = Color.Gray,
            Text = config.PcName ?? string.Empty,
        };

        waiting.Controls.Add(bottom);
        waiting.Controls.Add(status);
        waiting.Controls.Add(title);
        waiting.Controls.Add(name);
        Controls.Add(view);
        Controls.Add(waiting);

        watch.Interval = (int)WatchPeriod.TotalMilliseconds;
        watch.Tick += async (_, _) => await CheckTeacherAsync().ConfigureAwait(true);
    }

    protected override async void OnShown(EventArgs e)
    {
        base.OnShown(e);
        await SearchAsync().ConfigureAwait(true);
    }

    /// <summary>Asks until the teacher answers: the address remembered from last time first, then the network.</summary>
    private async Task SearchAsync()
    {
        if (searching)
        {
            return;
        }

        searching = true;
        try
        {
            while (!life.IsCancellationRequested)
            {
                var url = config.TeacherUrl is { } remembered && await IsAliveAsync(remembered).ConfigureAwait(true)
                    ? remembered
                    : await FindTeacherAsync().ConfigureAwait(true);
                if (url is not null && await IsAliveAsync(url).ConfigureAwait(true))
                {
                    await OpenLessonAsync(url).ConfigureAwait(true);
                    return;
                }

                status.Text = "Компьютер учителя пока не отвечает. Учитель запустил Sinf? Ищем снова…";
                await Task.Delay(SearchPause, life.Token).ConfigureAwait(true);
            }
        }
        catch (OperationCanceledException)
        {
            // The window is closing.
        }
        finally
        {
            searching = false;
        }
    }

    /// <summary>One round of the network search; the exit password's hash comes with the answer (H3).</summary>
    private async Task<string?> FindTeacherAsync()
    {
        var found = await TeacherFinder.FindAsync(token: life.Token).ConfigureAwait(true);
        if (found?.ExitHash is { } hash && hash != config.ExitPasswordHash)
        {
            config = config with { ExitPasswordHash = hash };
            HostConfig.Save(paths, config);
        }

        return found?.Url;
    }

    private async Task<bool> IsAliveAsync(string url)
    {
        try
        {
            using var answer = await http.GetAsync($"{url}/health", life.Token).ConfigureAwait(true);
            return answer.IsSuccessStatusCode;
        }
        catch (Exception error) when (error is HttpRequestException or TaskCanceledException)
        {
            return false;
        }
    }

    private async Task OpenLessonAsync(string url)
    {
        teacherUrl = url;
        if (config.TeacherUrl != url)
        {
            config = config with { TeacherUrl = url };
            HostConfig.Save(paths, config);
        }

        try
        {
            await EnsureWebViewAsync().ConfigureAwait(true);
        }
        catch (WebView2RuntimeNotFoundException)
        {
            title.Text = "Нет компонента WebView2 Runtime";
            status.Text = "Попросите администратора установить Microsoft Edge WebView2 Runtime.";
            return;
        }

        failedChecks = 0;
        view.CoreWebView2.Navigate($"{url}/join");
        waiting.Visible = false;
        view.Visible = true;
        watch.Start();
    }

    private async Task EnsureWebViewAsync()
    {
        if (webReady)
        {
            return;
        }

        var environment = await CoreWebView2Environment
            .CreateAsync(browserExecutableFolder: null, userDataFolder: paths.WebViewDir)
            .ConfigureAwait(true);
        await view.EnsureCoreWebView2Async(environment).ConfigureAwait(true);

        // A file dragged onto the window must not be opened by it.
        view.AllowExternalDrop = false;
        var core = view.CoreWebView2;
        var settings = core.Settings;
        settings.AreDevToolsEnabled = false;
        settings.AreDefaultContextMenusEnabled = false;
        settings.IsStatusBarEnabled = false;
        settings.AreBrowserAcceleratorKeysEnabled = false;
        settings.IsSwipeNavigationEnabled = false;
        settings.IsPasswordAutosaveEnabled = false;
        settings.IsGeneralAutofillEnabled = false;

        // The bridge of CLAUDE.md §5.5, read by `platform.ts`.
        var host = JsonSerializer.Serialize(new
        {
            isDesktop = true,
            role = "student",
            version = typeof(StudentForm).Assembly.GetName().Version?.ToString() ?? "0",
            pcName = config.PcName,
        });
        await core.AddScriptToExecuteOnDocumentCreatedAsync($"window.sinfHost = {host};").ConfigureAwait(true);

        // Only the way into the lesson and the lesson itself, on the teacher's computer (H3): no new
        // windows, no other sites, not even the teacher's own pages, no downloads.
        core.NewWindowRequested += (_, e) =>
        {
            e.Handled = true;
            if (teacherUrl is not null && StudentNavigation.IsAllowed(teacherUrl, e.Uri))
            {
                core.Navigate(e.Uri);
            }
        };
        core.NavigationStarting += (_, e) =>
        {
            if (teacherUrl is null || !StudentNavigation.IsAllowed(teacherUrl, e.Uri))
            {
                e.Cancel = true;
            }
        };
        core.DownloadStarting += (_, e) => e.Cancel = true;
        // Commands from the lesson page (stage 3): only from the teacher's computer, never from elsewhere.
        core.WebMessageReceived += (_, e) =>
        {
            if (teacherUrl is null || !TeacherAddress.IsSameOrigin(teacherUrl, e.Source))
            {
                return;
            }

            OnPageMessage(e.WebMessageAsJson);
        };
        core.NavigationCompleted += (_, e) =>
        {
            // The teacher's computer went away while the page was loading.
            if (!e.IsSuccess && e.WebErrorStatus != CoreWebView2WebErrorStatus.OperationCanceled)
            {
                BackToSearch("Связь с компьютером учителя потеряна.");
            }
        };
        webReady = true;
    }

    /// <summary>The lesson page cannot tell that the teacher closed Sinf; this check can.</summary>
    private async Task CheckTeacherAsync()
    {
        if (teacherUrl is null || searching)
        {
            return;
        }

        if (await IsAliveAsync(teacherUrl).ConfigureAwait(true))
        {
            failedChecks = 0;
            return;
        }

        failedChecks++;
        if (failedChecks >= 2)
        {
            BackToSearch("Связь с компьютером учителя потеряна.");
        }
    }

    /// <summary>What the lesson page asks for; anything unknown is ignored.</summary>
    private void OnPageMessage(string json)
    {
        try
        {
            using var document = JsonDocument.Parse(json);
            var root = document.RootElement;
            if (root.ValueKind != JsonValueKind.Object || !root.TryGetProperty("type", out var type))
            {
                return;
            }

            switch (type.GetString())
            {
                case "lock":
                    lockedByTeacher = root.TryGetProperty("on", out var on) && on.ValueKind == JsonValueKind.True;
                    SetLock(lockedByTeacher);
                    break;
            }
        }
        catch (JsonException)
        {
            // Not ours.
        }
    }

    /// <summary>
    /// The teacher's "Attention!" (H4, CLAUDE.md §4.5): the lesson window comes to the front and no key
    /// or click reaches anything until the teacher unlocks. The administrator's combination still works.
    /// </summary>
    private void SetLock(bool on)
    {
        if (dev)
        {
            return;
        }

        if (keyboard is not null)
        {
            keyboard.LockAll = on;
        }

        if (on)
        {
            mouse ??= new MouseGuard();
            TopMost = true;
            Activate();
        }
        else
        {
            mouse?.Dispose();
            mouse = null;
        }
    }

    private void BackToSearch(string reason)
    {
        // No lesson, no "Attention!": a lost teacher must not leave the computer frozen.
        lockedByTeacher = false;
        SetLock(false);
        if (searching)
        {
            return;
        }

        watch.Stop();
        view.Visible = false;
        waiting.Visible = true;
        title.Text = "Ищем компьютер учителя…";
        status.Text = reason;
        _ = SearchAsync();
    }

    private async void EnterAddress()
    {
        using var dialog = new ManualAddressDialog(config.TeacherUrl);
        dialogOpen = true;
        var answer = dialog.ShowDialog(this);
        dialogOpen = false;
        if (answer != DialogResult.OK)
        {
            return;
        }

        if (!await IsAliveAsync(dialog.Url).ConfigureAwait(true))
        {
            MessageBox.Show(
                this,
                "По этому адресу компьютер учителя не отвечает. Проверьте адрес и что Sinf у учителя запущен.",
                "Sinf",
                MessageBoxButtons.OK,
                MessageBoxIcon.Warning);
            return;
        }

        // The remembered address is tried first by the search loop, which is already running.
        config = config with { TeacherUrl = dialog.Url };
        HostConfig.Save(paths, config);
        status.Text = "Подключаемся…";
    }

    /// <summary>
    /// Ctrl+Alt+Shift+F12 (H3, author's choice). Until this computer has met the teacher's, it knows no
    /// password: that is setup time, the kiosk guards nothing yet, and the combination simply lets out.
    /// </summary>
    private void AskPassword()
    {
        if (dialogOpen || closeAllowed)
        {
            return;
        }

        if (!config.HasExitPassword)
        {
            LeaveKiosk();
            return;
        }

        using var dialog = new ExitPasswordDialog(config.ExitPasswordHash!, offerSetup: true, "Выход из режима ученика.");
        // Under "Attention!" the administrator still has to type and click.
        SetLock(false);
        dialogOpen = true;
        var answer = dialog.ShowDialog(this);
        dialogOpen = false;
        if (answer != DialogResult.OK)
        {
            SetLock(lockedByTeacher);
            Activate();
            return;
        }

        if (dialog.Chosen == ExitPasswordDialog.Choice.Setup)
        {
            using var setup = new RoleDialog(config);
            dialogOpen = true;
            var chosen = setup.ShowDialog(this);
            dialogOpen = false;
            if (chosen != DialogResult.OK)
            {
                SetLock(lockedByTeacher);
                Activate();
                return;
            }

            HostConfig.Save(paths, config with { Role = setup.Role, PcName = setup.PcName });
            // The new role takes effect in a fresh start of the app.
            System.Diagnostics.Process.Start(Application.ExecutablePath)?.Dispose();
        }

        LeaveKiosk();
    }

    private void LeaveKiosk()
    {
        closeAllowed = true;
        Close();
    }

    protected override void OnFormClosing(FormClosingEventArgs e)
    {
        // Windows shutting down or logging off is not a child leaving the lesson.
        if (!dev && !closeAllowed && e.CloseReason is CloseReason.UserClosing or CloseReason.None)
        {
            e.Cancel = true;
            return;
        }

        base.OnFormClosing(e);
    }

    protected override void OnFormClosed(FormClosedEventArgs e)
    {
        life.Cancel();
        watch.Dispose();
        focusBack.Dispose();
        keyboard?.Dispose();
        accessibility?.Dispose();
        mouse?.Dispose();
        http.Dispose();
        base.OnFormClosed(e);
    }
}
