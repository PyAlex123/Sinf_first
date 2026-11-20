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
        row.Controls.Add(hand);
        Controls.Add(row);
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
