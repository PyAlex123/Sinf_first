using System.Net.Http;
using System.Runtime.InteropServices;
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
    /// <summary>A thumbnail at most every three seconds (CLAUDE.md §3.1).</summary>
    private static readonly TimeSpan ThumbPeriod = TimeSpan.FromSeconds(3);

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
    /// <summary>The way out anyone can see (finding 4): it asks for the password, as the key combination does.</summary>
    private readonly Button exitButton = new() { Text = "Выход", AutoSize = false, Size = new Size(200, 60) };
    private readonly System.Windows.Forms.Timer watch = new();

    private readonly bool dev;
    private readonly KeyboardGuard? keyboard;
    /// <summary>Exists only while the teacher's "Attention!" is on (H4).</summary>
    private MouseGuard? mouse;
    /// <summary>What the teacher asked for, so the lock comes back after the administrator's dialog.</summary>
    private bool lockedByTeacher;
    /// <summary>Teacher computers an administrator said no to since Sinf started (review 2026-11-25).</summary>
    private readonly HashSet<string> refusedTeachers = [];
    /// <summary>Thumbnails for the teacher's tiles, only while a teacher's panel is open (H5).</summary>
    private readonly System.Windows.Forms.Timer thumbs = new();
    private byte[] lastFingerprint = [];
    private bool capturing;

    /// <summary>A practice program is open (H6): it may have the focus, the lesson steps back.</summary>
    private bool appMode;
    private bool appWasRunning;
    /// <summary>This child's screen is being shown to the class (H14).</summary>
    private ScreenShare? share;
    /// <summary>"Мой экран в окне" over a program: the lesson is a small picture in a corner (H14).</summary>
    private bool pip;
    /// <summary>The lesson's working folder: the child's files while the lesson lasts (H15).</summary>
    private WorkFolderSync? folder;
    /// <summary>Which programs the force-close after the grace is for: all of them, or only these.</summary>
    private IReadOnlyList<AppSpec>? closing;
    private DateTime? stageEndsAt;
    private ProgramPanel? panel;
    private readonly System.Windows.Forms.Timer appWatch = new() { Interval = 1000 };
    private readonly System.Windows.Forms.Timer closeDeadline = new();
    private readonly AccessibilityGuard? accessibility;
    private readonly System.Windows.Forms.Timer focusBack = new();
    /// <summary>The kiosk stepped behind Task Manager (finding 3) and goes on top again once it closes.</summary>
    private bool behindTaskManager;

    private string? teacherUrl;
    private readonly ActivityBeat beat;
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
        // For the updater (B6): a child in a lesson here, and the teacher's server it found.
        beat = new ActivityBeat(paths, () => new Core.Activity(
            DateTimeOffset.UtcNow,
            HostConfig.StudentRole,
            InLesson: folder is not null,
            ServerUrl: teacherUrl ?? this.config.TeacherUrl,
            PlatformUrl: this.config.IsPaired ? this.config.PlatformUrl : null));

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
                if (dialogOpen || closeAllowed)
                {
                    return;
                }

                // Task Manager from Ctrl+Alt+Del (finding 3): the kiosk steps behind it and keeps
                // looking until it is gone. With the agent a policy does not let it open at all.
                if (AppLauncher.TaskManagerInFront())
                {
                    if (TopMost)
                    {
                        TopMost = false;
                        behindTaskManager = true;
                    }

                    focusBack.Start();
                    return;
                }

                if (behindTaskManager)
                {
                    behindTaskManager = false;
                    TopMost = true;
                }

                // Paint of the practice may keep the focus (H6); nothing else may.
                if (!(appMode && AppLauncher.OwnsForegroundWindow()))
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

        exitButton.FlatStyle = FlatStyle.Flat;
        exitButton.BackColor = Color.White;
        exitButton.ForeColor = Dark;
        exitButton.Font = new Font("Segoe UI", 15f, FontStyle.Bold);
        exitButton.Click += (_, _) => AskPassword();
        var exitBar = new Panel { Dock = DockStyle.Bottom, Height = 96 };
        exitBar.Controls.Add(exitButton);
        exitBar.Resize += (_, _) =>
        {
            exitButton.Left = exitBar.Width - exitButton.Width - 32;
            exitButton.Top = (exitBar.Height - exitButton.Height) / 2;
        };

        waiting.Controls.Add(bottom);
        waiting.Controls.Add(status);
        waiting.Controls.Add(title);
        waiting.Controls.Add(name);
        waiting.Controls.Add(exitBar);
        Controls.Add(view);
        Controls.Add(waiting);

        appWatch.Tick += (_, _) => WatchApp();
        closeDeadline.Interval = (int)AppCatalog.CloseGrace.TotalMilliseconds;
        closeDeadline.Tick += (_, _) =>
        {
            closeDeadline.Stop();
            AppLauncher.CloseByForce(closing);
        };
        // Back in the lesson: the strip over Paint is not needed.
        Activated += (_, _) => panel?.Hide();

        thumbs.Interval = (int)ThumbPeriod.TotalMilliseconds;
        thumbs.Tick += async (_, _) => await SendThumbAsync().ConfigureAwait(true);

        watch.Interval = (int)WatchPeriod.TotalMilliseconds;
        watch.Tick += async (_, _) => await CheckTeacherAsync().ConfigureAwait(true);
    }

    protected override async void OnShown(EventArgs e)
    {
        base.OnShown(e);
        // A Sinf that died under "Attention!" comes back locked (B7): the agent remembers, and the
        // teacher's computer confirms or lifts it once found.
        var agent = await Task.Run(AgentPipe.Hello).ConfigureAwait(true);
        if (agent is { Lock: true } && !dev)
        {
            lockedByTeacher = true;
            SetLock(true);
        }

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
                // The remembered address is asked directly, but it too must answer with the teacher's
                // signature (H9): overnight another machine may have got that address.
                var url = config.TeacherUrl is { } remembered
                    ? await ConfirmTeacherAsync(remembered).ConfigureAwait(true)
                    : null;
                url ??= await FindTeacherAsync().ConfigureAwait(true);
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

    /// <summary>
    /// One round of the network search. Only answers signed by this computer's teacher count (H9); a
    /// computer that has met none believes the first signed answer and remembers its key (author's
    /// choice). The exit password's hash comes with the answer (H3).
    /// </summary>
    private async Task<string?> FindTeacherAsync() =>
        Accept(await TeacherFinder
            .FindAsync(pinnedKey: config.TeacherKey, token: life.Token, pc: config.PcName, refused: refusedTeachers)
            .ConfigureAwait(true));

    /// <summary>Is the computer at this address still our teacher's? Asked over UDP, signed (H9).</summary>
    private async Task<string?> ConfirmTeacherAsync(string url) =>
        Accept(await TeacherFinder
            .ConfirmAsync(url, config.TeacherKey, token: life.Token, pc: config.PcName, refused: refusedTeachers)
            .ConfigureAwait(true));

    /// <summary>The installer's exit password, which an administrator confirms a first teacher with.</summary>
    private static string? InstallerHash() =>
        MachinePassword.Read() is { } hash && ExitPassword.IsWellFormed(hash) ? hash : null;

    private string? Accept(TeacherFound? found)
    {
        if (found is null)
        {
            return null;
        }

        // The first teacher of a new computer: an administrator confirms it with the installer's exit
        // password (author's decision 2026-11-25); without one, the first is trusted, as before (H9).
        var installer = InstallerHash();
        switch (TeacherTrustRule.Decide(config.TeacherKey, found.TeacherKey, installer is not null, refusedTeachers))
        {
            case TeacherTrust.Refuse:
                return null;
            case TeacherTrust.AskAdministrator when !AdministratorConfirms(found, installer!):
                refusedTeachers.Add(found.TeacherKey);
                status.Text = "Компьютер учителя не подтверждён — ищем дальше…";
                return null;
        }

        var updated = config with
        {
            TeacherKey = config.TeacherKey ?? found.TeacherKey,
            ExitPasswordHash = found.ExitHash ?? config.ExitPasswordHash,
        };
        if (updated != config)
        {
            config = updated;
            HostConfig.Save(paths, config);
        }

        // The same eight characters stand in the teacher's window: an administrator can compare them.
        status.Text = $"Компьютер учителя найден · ключ {TeacherIdentity.Fingerprint(found.TeacherKey)}";
        ApplySignedLock(found.Locked);
        return found.Url;
    }

    /// <summary>
    /// "A teacher's computer was found — is it ours?" On the kiosk, over a lock if there is one: only
    /// the installer's password of this computer counts here, never one the newcomer brought along.
    /// </summary>
    private bool AdministratorConfirms(TeacherFound found, string installerHash)
    {
        using var dialog = new ExitPasswordDialog(
            [installerHash],
            offerSetup: false,
            $"Найден компьютер учителя «{found.Name ?? "без имени"}», ключ {TeacherIdentity.Fingerprint(found.TeacherKey)}. "
            + "Сверьте ключ с синей полосой окна учителя и введите пароль выхода этого компьютера, чтобы ему доверять.");
        SetLock(false);
        dialogOpen = true;
        var answer = dialog.ShowDialog(this);
        dialogOpen = false;
        SetLock(lockedByTeacher);
        Activate();
        return answer == DialogResult.OK;
    }

    /// <summary>
    /// "Attention!" as the teacher's computer signed it for this computer (review 2026-11-25). The
    /// lesson page may lock at once, but only this signed answer unlocks.
    /// </summary>
    private void ApplySignedLock(bool locked)
    {
        if (locked == lockedByTeacher)
        {
            return;
        }

        lockedByTeacher = locked;
        SetLock(locked);
        // The agent remembers it for a Sinf that dies and comes back (B7).
        AgentPipe.Lock(locked);
    }

    /// <summary>The page says "unlocked": believed only when the teacher's computer signs the same.</summary>
    private async Task ConfirmUnlockAsync()
    {
        if (teacherUrl is null || config.TeacherKey is null)
        {
            return;
        }

        var found = await TeacherFinder
            .ConfirmAsync(teacherUrl, config.TeacherKey, token: life.Token, pc: config.PcName)
            .ConfigureAwait(true);
        if (found is { Locked: false })
        {
            ApplySignedLock(false);
        }
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

        // Alive and still ours: the web server answers and the teacher's key signs the answer, so
        // nobody who took the teacher's address keeps the class (review 2026-11-25). The same answer
        // carries this computer's lock.
        var signed = await IsAliveAsync(teacherUrl).ConfigureAwait(true) && config.TeacherKey is not null
            ? await TeacherFinder
                .ConfirmAsync(teacherUrl, config.TeacherKey, token: life.Token, pc: config.PcName)
                .ConfigureAwait(true)
            : null;
        if (signed is not null)
        {
            failedChecks = 0;
            ApplySignedLock(signed.Locked);
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
                    // Locking is taken from the page at once; unlocking only from the teacher's
                    // signed answer (review 2026-11-25), so a substituted page cannot free the class.
                    if (root.TryGetProperty("on", out var on) && on.ValueKind == JsonValueKind.True)
                    {
                        ApplySignedLock(true);
                    }
                    else
                    {
                        _ = ConfirmUnlockAsync();
                    }

                    break;
                case "thumbs":
                    SetThumbs(root.TryGetProperty("on", out var wanted) && wanted.ValueKind == JsonValueKind.True);
                    break;
                case "hello":
                    // The page asks which programs this computer has: tiles only for those (H15).
                    PostToPage(new { type = "installed", apps = AppLauncher.Installed() });
                    break;
                case "launch":
                    _ = StartAppAsync(
                        root.TryGetProperty("app", out var app) ? app.GetString() : null,
                        root.TryGetProperty("file", out var file) ? file.GetString() : null);
                    break;
                case "closeApps":
                    CloseApps(root.TryGetProperty("keep", out var keep) && keep.ValueKind == JsonValueKind.Array
                        ? keep.EnumerateArray().Select(k => k.GetString() ?? string.Empty).ToList()
                        : null);
                    break;
                case "timer":
                    stageEndsAt = root.TryGetProperty("inMs", out var inMs) && inMs.ValueKind == JsonValueKind.Number
                        ? DateTime.UtcNow.AddMilliseconds(inMs.GetDouble())
                        : null;
                    panel?.SetDeadline(stageEndsAt);
                    break;
                case "folder":
                    var folderOn = root.TryGetProperty("on", out var fo) && fo.ValueKind == JsonValueKind.True;
                    _ = SetFolderAsync(
                        folderOn && root.TryGetProperty("sessionId", out var fs) ? fs.GetString() : null,
                        folderOn && root.TryGetProperty("token", out var ft) ? ft.GetString() : null);
                    break;
                case "screenshot":
                    var reason = root.TryGetProperty("reason", out var r) ? r.GetString() : null;
                    _ = SendScreenshotAsync(reason is "before_end" or "stage_end" ? reason : "manual");
                    break;
                case "share":
                    var shareOn = root.TryGetProperty("on", out var so) && so.ValueKind == JsonValueKind.True;
                    var sessionId = root.TryGetProperty("sessionId", out var sid) ? sid.GetString() : null;
                    var lessonToken = root.TryGetProperty("token", out var tk) ? tk.GetString() : null;
                    _ = SetShareAsync(shareOn ? sessionId : null, lessonToken);
                    break;
                case "pip":
                    SetPip(root.TryGetProperty("on", out var po) && po.ValueKind == JsonValueKind.True);
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
            panel?.Hide();
            TopMost = true;
            Activate();
        }
        else
        {
            mouse?.Dispose();
            mouse = null;
        }
    }

    /// <summary>Opens Paint for the practice (H6), or brings it back; the lesson steps behind it.</summary>
    /// <summary>
    /// Opens a lesson program (H6, H15) — only an id of the catalog, never a path; a file only by its
    /// name in the lesson's working folder. Paint without a file gets a blank picture there, so that
    /// Ctrl+S saves the drawing into the child's folder, not somewhere on the disk.
    /// </summary>
    /// <summary>
    /// A file the lesson names may not have come into the working folder yet — the practice's template
    /// is put into "Мои работы" at login (H16): one exchange first, then the program opens it.
    /// </summary>
    private async Task StartAppAsync(string? id, string? fileName)
    {
        if (fileName is not null && folder is not null)
        {
            var path = folder.PathOf(fileName);
            if (path is not null && !File.Exists(path))
            {
                await folder.SyncAsync().ConfigureAwait(true);
            }
        }

        StartApp(id, fileName);
    }

    private void StartApp(string? id, string? fileName = null)
    {
        if (lockedByTeacher || id is null)
        {
            return;
        }

        string? file = null;
        if (folder is not null)
        {
            if (fileName is not null)
            {
                file = id == "arduino" ? folder.IntoSketchFolder(fileName) : folder.PathOf(fileName);
            }
            else if (id == "paint")
            {
                file = folder.PathOf("Рисунок.png");
                if (file is not null && !File.Exists(file))
                {
                    using var blank = new Bitmap(1024, 640);
                    using (var g = Graphics.FromImage(blank))
                    {
                        g.Clear(Color.White);
                    }

                    blank.Save(file, System.Drawing.Imaging.ImageFormat.Png);
                }
            }

            if (file is not null && !File.Exists(file))
            {
                file = null;
            }
        }

        if (!AppLauncher.Launch(id, file))
        {
            return;
        }

        appMode = true;
        TopMost = false;
        panel ??= new ProgramPanel(BackToLessonFromApp, () => PostToPage(new { type = "hand" }));
        panel.SetDeadline(stageEndsAt);
        panel.ShowOnTop();
        appWatch.Start();
    }

    /// <summary>The lesson's working folder (H15): the child's files come in, every save goes back.</summary>
    private async Task SetFolderAsync(string? sessionId, string? lessonToken)
    {
        var old = folder;
        folder = null;
        if (old is not null)
        {
            beat.Write();
            await old.DisposeAsync().ConfigureAwait(true);
        }

        if (sessionId is null || lessonToken is null || teacherUrl is null)
        {
            return;
        }

        var next = new WorkFolderSync(
            Path.Combine(paths.Data, "work"),
            teacherUrl,
            sessionId,
            lessonToken,
            name => BeginInvoke(() => PostToPage(new { type = "saved", name })));
        folder = next;
        beat.Write();
        await next.StartAsync().ConfigureAwait(true);
    }

    private void BackToLessonFromApp()
    {
        Activate();
        BringToFront();
    }

    /// <summary>Reports the program's state to the page; when it is gone, the kiosk takes the screen back.</summary>
    private void WatchApp()
    {
        var running = AppLauncher.AnyRunning();
        if (running != appWasRunning)
        {
            appWasRunning = running;
            PostToPage(new { type = "app", running });
        }

        if (!running && appMode)
        {
            appMode = false;
            SetPip(false);
            appWatch.Stop();
            closeDeadline.Stop();
            panel?.Hide();
            TopMost = !dev;
            Activate();
        }
    }

    /// <summary>The practice is over (H6): Paint is asked to close — it offers to save — and after the grace, closed.</summary>
    /// <summary>
    /// Closes the lesson's programs: all of them (the practice is over), or those no longer allowed
    /// (the teacher changed the tiles, H15). They are asked first — and offer to save — then closed.
    /// </summary>
    private void CloseApps(IReadOnlyList<string>? keep = null)
    {
        closing = keep is null ? null : AppCatalog.ToClose(keep, AppLauncher.RunningIds());
        if (closing is { Count: 0 } || !AppLauncher.AnyRunning())
        {
            return;
        }

        AppLauncher.AskToClose(closing);
        closeDeadline.Stop();
        closeDeadline.Start();
    }

    private void SetThumbs(bool on)
    {
        if (on)
        {
            // The first thumbnail goes at once, then only changes.
            lastFingerprint = [];
            thumbs.Start();
            _ = SendThumbAsync();
        }
        else
        {
            thumbs.Stop();
        }
    }

    /// <summary>One look at the screen; a thumbnail goes to the page only when the picture changed.</summary>
    private async Task SendThumbAsync()
    {
        if (capturing || !view.Visible || view.CoreWebView2 is null)
        {
            return;
        }

        capturing = true;
        try
        {
            using var screen = ScreenCapture.Grab();
            var fingerprint = ScreenCapture.Fingerprint(screen);
            if (!FrameDiff.HasChanged(lastFingerprint, fingerprint))
            {
                return;
            }

            lastFingerprint = fingerprint;
            using var copy = (Bitmap)screen.Clone();
            var picture = await Task.Run(() => ScreenCapture.Encode(copy, ScreenCapture.ThumbWidth, ScreenCapture.ThumbMaxBytes))
                .ConfigureAwait(true);
            PostToPage(new { type = "thumb", jpeg = Convert.ToBase64String(picture.Jpeg) });
        }
        catch (Exception error) when (error is ExternalException or ArgumentException or InvalidOperationException)
        {
            // A locked workstation or a changing display mode: the next tick tries again.
        }
        finally
        {
            capturing = false;
        }
    }

    /// <summary>A screenshot for the gallery, handed to the page, which uploads it (H5, CLAUDE.md §4.8).</summary>
    private async Task SendScreenshotAsync(string reason)
    {
        if (view.CoreWebView2 is null)
        {
            return;
        }

        try
        {
            using var screen = ScreenCapture.Grab();
            using var copy = (Bitmap)screen.Clone();
            var picture = await Task.Run(() => ScreenCapture.Encode(copy, ScreenCapture.ShotWidth, ScreenCapture.ShotMaxBytes))
                .ConfigureAwait(true);
            PostToPage(new
            {
                type = "screenshot",
                jpeg = Convert.ToBase64String(picture.Jpeg),
                width = picture.Width,
                height = picture.Height,
                reason,
            });
        }
        catch (Exception error) when (error is ExternalException or ArgumentException or InvalidOperationException)
        {
            // Nothing to send this time; the teacher can ask again.
        }
    }

    private void PostToPage(object message)
    {
        view.CoreWebView2?.PostWebMessageAsJson(JsonSerializer.Serialize(message));
    }

    /// <summary>
    /// "Экран ученика" (H14): this computer films its screen for the class while the teacher shows it.
    /// The lesson token proves to the teacher's computer that this child is the one shown.
    /// </summary>
    private async Task SetShareAsync(string? sessionId, string? lessonToken)
    {
        var old = share;
        share = null;
        if (old is not null)
        {
            await old.DisposeAsync().ConfigureAwait(true);
        }

        if (sessionId is null || lessonToken is null || teacherUrl is null)
        {
            return;
        }

        var ws = new UriBuilder(teacherUrl) { Scheme = "ws", Path = "/ws/demo" };
        ws.Query = $"session={Uri.EscapeDataString(sessionId)}&participant={Uri.EscapeDataString(lessonToken)}";
        var next = new ScreenShare(ws.Uri, hostToken: null);
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

    /// <summary>
    /// "Мой экран в окне" while a program is open (H14): the lesson window shrinks into the bottom
    /// right corner, over the program, and does not take the keyboard; off — full screen again.
    /// </summary>
    private void SetPip(bool on)
    {
        if (dev || on == pip)
        {
            return;
        }

        pip = on && appMode;
        var area = Screen.PrimaryScreen?.WorkingArea ?? new Rectangle(0, 0, 1366, 728);
        if (pip)
        {
            WindowState = FormWindowState.Normal;
            var width = Math.Min(560, area.Width * 2 / 5);
            var height = width * 9 / 16;
            Bounds = new Rectangle(area.Right - width - 12, area.Bottom - height - 12, width, height);
            TopMost = true;
        }
        else
        {
            WindowState = FormWindowState.Maximized;
            TopMost = true;
            if (!appMode)
            {
                Activate();
            }
        }
    }

    private void BackToSearch(string reason)
    {
        // "Attention!" stays while the teacher's computer is away (author's decision 2026-11-25): a
        // pupil who drops the connection must not free the class. The teacher, found again, lifts it
        // with a signed answer; the administrator's exit password works as ever.
        if (lockedByTeacher)
        {
            reason += " Экран закрыт, пока учитель не снимет «Внимание!».";
        }

        SetThumbs(false);
        SetPip(false);
        _ = SetShareAsync(null, null);
        _ = SetFolderAsync(null, null);
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

        // A typed address is believed only when the computer there signs as our teacher (H9): a child
        // must not lead the kiosk to a laptop of their own.
        var url = await ConfirmTeacherAsync(dialog.Url).ConfigureAwait(true);
        if (url is null || !await IsAliveAsync(url).ConfigureAwait(true))
        {
            MessageBox.Show(
                this,
                config.KnowsTeacher
                    ? "По этому адресу не отвечает компьютер учителя этого класса. Проверьте адрес и что Sinf у учителя запущен."
                    : "По этому адресу компьютер учителя не отвечает. Проверьте адрес и что Sinf у учителя запущен.",
                "Sinf",
                MessageBoxButtons.OK,
                MessageBoxIcon.Warning);
            return;
        }

        // The remembered address is tried first by the search loop, which is already running.
        config = config with { TeacherUrl = url };
        HostConfig.Save(paths, config);
        status.Text = "Подключаемся…";
    }

    /// <summary>
    /// Ctrl+Alt+Shift+F12 (H3, author's choice) or the "Выход" button of the waiting screen (finding 4).
    /// The room's password from the teacher's computer and the installer's both open. With neither
    /// this computer is still being set up: the kiosk guards nothing yet and lets out without asking.
    /// </summary>
    private void AskPassword()
    {
        if (dialogOpen || closeAllowed)
        {
            return;
        }

        var hashes = MachinePassword.KioskHashes(config);
        if (hashes.Count == 0)
        {
            AgentPipe.Maintenance(string.Empty);
            LeaveKiosk();
            return;
        }

        using var dialog = new ExitPasswordDialog(hashes, offerSetup: true, "Выход из режима ученика.");
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

        // With the agent (B7), the administrator gets maintenance time: the watchdog does not
        // bring the kiosk back, and an ordinary desktop opens.
        AgentPipe.Maintenance(dialog.Password);

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
            // It waits for this one to close (one Sinf per session, H17).
            System.Diagnostics.Process.Start(Application.ExecutablePath, "--restart")?.Dispose();
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
        thumbs.Dispose();
        appWatch.Dispose();
        closeDeadline.Dispose();
        panel?.Dispose();
        keyboard?.Dispose();
        accessibility?.Dispose();
        mouse?.Dispose();
        http.Dispose();
        _ = share?.DisposeAsync();
        _ = folder?.DisposeAsync();
        beat.Dispose();
        base.OnFormClosed(e);
    }
}
