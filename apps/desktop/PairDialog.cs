namespace Sinf.Desktop;

/// <summary>
/// Attaching this computer to a school (S2.4): the address of the platform and the code the school read
/// out. Deliberately plain — it is filled in once, by a teacher standing at a classroom machine.
/// </summary>
internal sealed class PairDialog : Form
{
    private readonly TextBox urlBox = new() { Width = 360 };
    private readonly TextBox codeBox = new() { Width = 360, CharacterCasing = CharacterCasing.Upper };
    private readonly Label status = new() { AutoSize = false, Width = 360, Height = 44 };
    private readonly Button pairButton = new() { Text = "Привязать", AutoSize = true };
    private readonly Platform platform;

    public PairDialog(Platform platform, string? platformUrl)
    {
        this.platform = platform;
        urlBox.Text = platformUrl ?? string.Empty;

        Text = "Привязать компьютер к школе";
        FormBorderStyle = FormBorderStyle.FixedDialog;
        StartPosition = FormStartPosition.CenterParent;
        MaximizeBox = false;
        MinimizeBox = false;
        ClientSize = new Size(400, 260);
        Font = new Font("Segoe UI", 9.75f);

        var layout = new FlowLayoutPanel
        {
            Dock = DockStyle.Fill,
            FlowDirection = FlowDirection.TopDown,
            Padding = new Padding(16),
            WrapContents = false,
        };
        layout.Controls.Add(new Label { Text = "Адрес платформы", AutoSize = true });
        layout.Controls.Add(urlBox);
        layout.Controls.Add(new Label { Text = "Код из кабинета школы", AutoSize = true, Margin = new Padding(0, 10, 0, 0) });
        layout.Controls.Add(codeBox);
        layout.Controls.Add(status);
        layout.Controls.Add(pairButton);
        Controls.Add(layout);

        pairButton.Click += async (_, _) => await PairAsync().ConfigureAwait(true);
        AcceptButton = pairButton;
    }

    /// <summary>Filled in once the computer is attached; the caller saves it.</summary>
    public Platform.PairResult? Result { get; private set; }

    public string PlatformUrl => urlBox.Text.Trim();

    private async Task PairAsync()
    {
        if (urlBox.Text.Trim().Length == 0 || codeBox.Text.Trim().Length < 4)
        {
            status.Text = "Введите адрес платформы и код.";
            return;
        }

        pairButton.Enabled = false;
        status.Text = "Связываемся с платформой…";
        try
        {
            Result = await platform
                .PairAsync(urlBox.Text, codeBox.Text, CancellationToken.None)
                .ConfigureAwait(true);
            DialogResult = DialogResult.OK;
            Close();
        }
        catch (Exception error)
        {
            status.Text = error.Message;
        }
        finally
        {
            pairButton.Enabled = true;
        }
    }
}
