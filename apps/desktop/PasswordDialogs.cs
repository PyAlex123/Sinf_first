using Sinf.Desktop.Core;

namespace Sinf.Desktop;

/// <summary>Small dialogs share one look: a title, fields, a red line for mistakes, two buttons.</summary>
internal abstract class SmallDialog : Form
{
    protected readonly Label Error = new() { AutoSize = true, ForeColor = Color.Firebrick, MaximumSize = new Size(420, 0) };
    protected readonly FlowLayoutPanel Body = new()
    {
        AutoSize = true,
        FlowDirection = FlowDirection.TopDown,
        WrapContents = false,
        Dock = DockStyle.Fill,
    };

    protected SmallDialog(string title, bool topMost)
    {
        Text = title;
        FormBorderStyle = FormBorderStyle.FixedDialog;
        StartPosition = FormStartPosition.CenterScreen;
        MaximizeBox = false;
        MinimizeBox = false;
        ShowInTaskbar = false;
        // Over the kiosk window, which is itself always on top.
        TopMost = topMost;
        AutoSize = true;
        AutoSizeMode = AutoSizeMode.GrowAndShrink;
        Font = new Font("Segoe UI", 11f);
        Padding = new Padding(20);
        Controls.Add(Body);
    }

    protected static TextBox PasswordBox() => new() { Width = 260, UseSystemPasswordChar = true };

    protected static Label Hint(string text) => new() { Text = text, AutoSize = true, MaximumSize = new Size(420, 0) };

    protected void AddButtons(params Button[] buttons)
    {
        var row = new FlowLayoutPanel { AutoSize = true, FlowDirection = FlowDirection.LeftToRight };
        foreach (var button in buttons)
        {
            button.AutoSize = true;
            row.Controls.Add(button);
        }

        Body.Controls.Add(Error);
        Body.Controls.Add(row);
    }
}

/// <summary>
/// The administrator's way out of a student's kiosk (H3): the exit password, then what to do —
/// leave Sinf or change this computer's settings. Five wrong tries close it for a minute.
/// </summary>
internal sealed class ExitPasswordDialog : SmallDialog
{
    /// <summary>One gate per running app, so closing and reopening the dialog does not reset the count.</summary>
    private static readonly ExitGate Gate = new();

    public enum Choice
    {
        None,
        Exit,
        Setup,
    }

    private readonly TextBox password = PasswordBox();
    private readonly string hash;

    /// <param name="offerSetup">On the kiosk both ways out are offered; elsewhere only "continue".</param>
    public ExitPasswordDialog(string hash, bool offerSetup, string purpose)
        : base("Sinf — пароль администратора", topMost: true)
    {
        this.hash = hash;
        Body.Controls.Add(Hint(purpose));
        Body.Controls.Add(password);

        var cancel = new Button { Text = "Отмена", DialogResult = DialogResult.Cancel };
        CancelButton = cancel;
        if (offerSetup)
        {
            var exit = new Button { Text = "Выйти из Sinf" };
            var setup = new Button { Text = "Сменить настройки" };
            exit.Click += (_, _) => Confirm(Choice.Exit);
            setup.Click += (_, _) => Confirm(Choice.Setup);
            AcceptButton = exit;
            AddButtons(exit, setup, cancel);
        }
        else
        {
            var ok = new Button { Text = "Продолжить" };
            ok.Click += (_, _) => Confirm(Choice.Exit);
            AcceptButton = ok;
            AddButtons(ok, cancel);
        }
    }

    public Choice Chosen { get; private set; }

    /// <summary>The password that opened the dialog, for the agent's maintenance time (B7).</summary>
    public string Password => password.Text;

    private void Confirm(Choice choice)
    {
        var now = DateTimeOffset.UtcNow;
        var wait = Gate.Wait(now);
        if (wait > TimeSpan.Zero)
        {
            Error.Text = $"Слишком много попыток. Подождите {Math.Ceiling(wait.TotalSeconds)} с.";
            return;
        }

        if (!Gate.TryOpen(password.Text, hash, now))
        {
            password.Clear();
            password.Focus();
            var locked = Gate.Wait(now);
            Error.Text = locked > TimeSpan.Zero
                ? "Слишком много попыток. Подождите минуту."
                : "Пароль не подошёл.";
            return;
        }

        Chosen = choice;
        DialogResult = DialogResult.OK;
    }
}

/// <summary>
/// The exit password for all student kiosks of this room, set on the teacher's computer (H3,
/// author's choice). Typed twice; only its hash is kept and handed out.
/// </summary>
internal sealed class NewExitPasswordDialog : SmallDialog
{
    private readonly TextBox first = PasswordBox();
    private readonly TextBox second = PasswordBox();

    public NewExitPasswordDialog()
        : base("Sinf — пароль для компьютеров учеников", topMost: false)
    {
        Body.Controls.Add(Hint(
            "Этим паролем администратор выходит из Sinf на компьютерах учеников (Ctrl+Alt+Shift+F12). "
            + $"Не короче {ExitPassword.MinLength} знаков. Ученики его не знают; компьютеры учеников "
            + "получат его сами, когда найдут этот компьютер."));
        Body.Controls.Add(Hint("Пароль:"));
        Body.Controls.Add(first);
        Body.Controls.Add(Hint("Ещё раз:"));
        Body.Controls.Add(second);
        var ok = new Button { Text = "Сохранить" };
        var cancel = new Button { Text = "Позже", DialogResult = DialogResult.Cancel };
        ok.Click += (_, _) => Confirm();
        AcceptButton = ok;
        CancelButton = cancel;
        AddButtons(ok, cancel);
    }

    public string Hash { get; private set; } = string.Empty;

    private void Confirm()
    {
        if (!ExitPassword.IsStrongEnough(first.Text))
        {
            Error.Text = $"Пароль не короче {ExitPassword.MinLength} знаков.";
            first.Focus();
            return;
        }

        if (first.Text != second.Text)
        {
            Error.Text = "Пароли не совпадают.";
            second.Clear();
            second.Focus();
            return;
        }

        Hash = ExitPassword.Hash(first.Text);
        DialogResult = DialogResult.OK;
    }
}
