using Sinf.Desktop.Core;

namespace Sinf.Desktop;

/// <summary>When the network drops broadcasts, the address from the teacher's window is typed once.</summary>
internal sealed class ManualAddressDialog : Form
{
    private readonly TextBox address = new() { Width = 260 };
    private readonly Label error = new() { AutoSize = true, ForeColor = Color.Firebrick };

    public ManualAddressDialog(string? current)
    {
        Text = "Адрес компьютера учителя";
        FormBorderStyle = FormBorderStyle.FixedDialog;
        StartPosition = FormStartPosition.CenterParent;
        MaximizeBox = false;
        MinimizeBox = false;
        AutoSize = true;
        AutoSizeMode = AutoSizeMode.GrowAndShrink;
        Font = new Font("Segoe UI", 11f);
        Padding = new Padding(20);
        address.Text = current ?? string.Empty;

        var ok = new Button { Text = "Подключиться", AutoSize = true };
        var cancel = new Button { Text = "Отмена", AutoSize = true, DialogResult = DialogResult.Cancel };
        ok.Click += (_, _) => Confirm();
        AcceptButton = ok;
        CancelButton = cancel;

        var buttons = new FlowLayoutPanel { AutoSize = true };
        buttons.Controls.Add(ok);
        buttons.Controls.Add(cancel);

        var layout = new FlowLayoutPanel
        {
            AutoSize = true,
            FlowDirection = FlowDirection.TopDown,
            WrapContents = false,
            Dock = DockStyle.Fill,
        };
        layout.Controls.Add(new Label
        {
            Text = "Адрес написан в синей полосе окна учителя, например 192.168.1.15:3000",
            AutoSize = true,
            MaximumSize = new Size(420, 0),
        });
        layout.Controls.Add(address);
        layout.Controls.Add(error);
        layout.Controls.Add(buttons);
        Controls.Add(layout);
    }

    public string Url { get; private set; } = string.Empty;

    private void Confirm()
    {
        if (!TeacherAddress.TryNormalize(address.Text, out var url))
        {
            error.Text = "Это не адрес компьютера в сети школы.";
            address.Focus();
            return;
        }

        Url = url;
        DialogResult = DialogResult.OK;
    }
}
