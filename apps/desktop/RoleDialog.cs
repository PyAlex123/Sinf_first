using Sinf.Desktop.Core;

namespace Sinf.Desktop;

/// <summary>
/// First start (ADR-014 §1): is this the teacher's computer or a student's, and what does the school
/// call it? Asked once; `Sinf.exe --setup` asks again.
/// </summary>
internal sealed class RoleDialog : Form
{
    private readonly RadioButton teacher = new() { Text = "Компьютер учителя — на нём идёт урок", AutoSize = true };
    private readonly RadioButton student = new() { Text = "Компьютер ученика", AutoSize = true };
    private readonly TextBox name = new() { Width = 160, MaxLength = Core.PcName.MaxLength };
    private readonly Label nameLabel = new() { Text = "Как он называется в кабинете (например, ПК-05):", AutoSize = true };
    private readonly Label error = new() { AutoSize = true, ForeColor = Color.Firebrick };

    public RoleDialog(HostConfig current)
    {
        Text = "Sinf — что это за компьютер?";
        FormBorderStyle = FormBorderStyle.FixedDialog;
        StartPosition = FormStartPosition.CenterScreen;
        MaximizeBox = false;
        MinimizeBox = false;
        AutoSize = true;
        AutoSizeMode = AutoSizeMode.GrowAndShrink;
        Font = new Font("Segoe UI", 11f);
        Padding = new Padding(20);
        // Also opened from the kiosk, which stays on top of everything.
        TopMost = true;

        teacher.Checked = !current.IsStudent;
        student.Checked = current.IsStudent;
        name.Text = current.PcName ?? string.Empty;

        var ok = new Button { Text = "Готово", AutoSize = true, DialogResult = DialogResult.None };
        var cancel = new Button { Text = "Отмена", AutoSize = true, DialogResult = DialogResult.Cancel };
        ok.Click += (_, _) => Confirm();
        AcceptButton = ok;
        CancelButton = cancel;

        var buttons = new FlowLayoutPanel { AutoSize = true, FlowDirection = FlowDirection.LeftToRight };
        buttons.Controls.Add(ok);
        buttons.Controls.Add(cancel);

        var layout = new FlowLayoutPanel
        {
            AutoSize = true,
            FlowDirection = FlowDirection.TopDown,
            WrapContents = false,
            Dock = DockStyle.Fill,
        };
        layout.Controls.Add(new Label { Text = "Что это за компьютер?", AutoSize = true, Font = new Font("Segoe UI", 13f, FontStyle.Bold) });
        layout.Controls.Add(teacher);
        layout.Controls.Add(student);
        layout.Controls.Add(nameLabel);
        layout.Controls.Add(name);
        layout.Controls.Add(error);
        layout.Controls.Add(buttons);
        Controls.Add(layout);

        teacher.CheckedChanged += (_, _) => ShowName();
        ShowName();
    }

    public string Role { get; private set; } = HostConfig.TeacherRole;

    public string? PcName { get; private set; }

    private void ShowName()
    {
        nameLabel.Enabled = student.Checked;
        name.Enabled = student.Checked;
    }

    private void Confirm()
    {
        if (teacher.Checked)
        {
            Role = HostConfig.TeacherRole;
            PcName = null;
            DialogResult = DialogResult.OK;
            return;
        }

        if (!Core.PcName.TryNormalize(name.Text, out var normalized))
        {
            error.Text = $"Введите имя компьютера, не длиннее {Core.PcName.MaxLength} знаков.";
            name.Focus();
            return;
        }

        Role = HostConfig.StudentRole;
        PcName = normalized;
        DialogResult = DialogResult.OK;
    }
}
