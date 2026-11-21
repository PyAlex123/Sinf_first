namespace Sinf.Desktop;

/// <summary>
/// The thin strip over a practice program (stage 3, H6; CLAUDE.md §8): "back to the lesson" and
/// "help". It never takes the focus, so Paint keeps the keyboard while the child draws.
/// </summary>
internal sealed class ProgramPanel : Form
{
    private const int WsExNoActivate = 0x08000000;
    private const int WsExToolWindow = 0x00000080;
    private const int WsExTopMost = 0x00000008;

    public ProgramPanel(Action backToLesson, Action help)
    {
        FormBorderStyle = FormBorderStyle.None;
        StartPosition = FormStartPosition.Manual;
        ShowInTaskbar = false;
        TopMost = true;
        BackColor = Color.FromArgb(19, 35, 58);
        Font = new Font("Segoe UI", 11f, FontStyle.Bold);
        AutoSize = true;
        AutoSizeMode = AutoSizeMode.GrowAndShrink;
        Padding = new Padding(8, 4, 8, 4);

        var row = new FlowLayoutPanel { AutoSize = true, FlowDirection = FlowDirection.LeftToRight, WrapContents = false };
        var back = Pill("← Вернуться к уроку", Color.FromArgb(255, 106, 0));
        var hand = Pill("✋ Помогите", Color.FromArgb(24, 107, 94));
        back.Click += (_, _) => backToLesson();
        hand.Click += (_, _) => help();
        row.Controls.Add(back);
        row.Controls.Add(timer);
        row.Controls.Add(hand);
        Controls.Add(row);
        tick.Interval = 1000;
        tick.Tick += (_, _) => ShowTime();
    }

    /// <summary>The stage timer over the program (CLAUDE.md §8, H15): "⏱ 12:34", or nothing.</summary>
    private readonly Label timer = new()
    {
        AutoSize = true,
        ForeColor = Color.White,
        Margin = new Padding(10, 9, 10, 4),
        Text = string.Empty,
    };

    private readonly System.Windows.Forms.Timer tick = new();
    private DateTime? endsAt;

    /// <summary>When the stage ends, by this computer's clock; null when paused or untimed.</summary>
    public void SetDeadline(DateTime? until)
    {
        endsAt = until;
        ShowTime();
        if (until is null)
        {
            tick.Stop();
        }
        else
        {
            tick.Start();
        }
    }

    private void ShowTime()
    {
        if (endsAt is not { } end)
        {
            timer.Text = string.Empty;
            return;
        }

        var left = end - DateTime.UtcNow;
        if (left < TimeSpan.Zero)
        {
            left = TimeSpan.Zero;
        }

        timer.Text = $"⏱ {(int)left.TotalMinutes:00}:{left.Seconds:00}";
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            tick.Dispose();
        }

        base.Dispose(disposing);
    }

    protected override bool ShowWithoutActivation => true;

    protected override CreateParams CreateParams
    {
        get
        {
            var p = base.CreateParams;
            p.ExStyle |= WsExNoActivate | WsExToolWindow | WsExTopMost;
            return p;
        }
    }

    /// <summary>Top centre of the screen, over the program's title bar.</summary>
    public void ShowOnTop()
    {
        var screen = Screen.PrimaryScreen?.WorkingArea ?? new Rectangle(0, 0, 1366, 768);
        Show();
        Location = new Point(screen.Left + ((screen.Width - Width) / 2), screen.Top);
    }

    private static Button Pill(string text, Color colour) => new()
    {
        Text = text,
        AutoSize = true,
        FlatStyle = FlatStyle.Flat,
        BackColor = colour,
        ForeColor = Color.White,
        Margin = new Padding(4),
        Padding = new Padding(10, 4, 10, 4),
        // Clicks reach the button without taking the focus from the program.
        TabStop = false,
    };
}
