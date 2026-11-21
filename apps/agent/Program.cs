using System.Security.Principal;
using System.ServiceProcess;
using Sinf.Desktop.Core;

namespace Sinf.Agent;

/// <summary>
/// Sinf.Agent.exe (PLAN.md 6.4; stage 6, B7; ADR-024):
///
///   Sinf.Agent.exe enable [--user Ученик]   — the closed environment on this computer;
///   Sinf.Agent.exe disable [--remove-account] — ordinary Windows again;
///   Sinf.Agent.exe status                   — what is on, line by line;
///   Sinf.Agent.exe run                      — the service itself (Windows starts it).
///
/// The installer runs `enable` only when asked (checkbox, /AGENT=1) and `disable` when Sinf is
/// removed. Everything but `status` and `run` needs an administrator.
/// </summary>
internal static class Program
{
    private static int Main(string[] args)
    {
        var command = args.FirstOrDefault()?.ToLowerInvariant();
        if (command == "run")
        {
            ServiceBase.Run(new AgentService());
            return 0;
        }

        // Russian messages in any console, and in CI's capture (a service has no console).
        Console.OutputEncoding = System.Text.Encoding.UTF8;

        if (command is "enable" or "disable" && !IsAdministrator())
        {
            Console.WriteLine("Нужны права администратора: запустите командную строку от имени администратора.");
            return 5;
        }

        try
        {
            return command switch
            {
                "enable" => Setup.Enable(Arg(args, "--user") ?? AgentPlan.DefaultUser),
                "disable" => Setup.Disable(args.Contains("--remove-account")),
                "status" => Setup.Status(),
                _ => Usage(),
            };
        }
        catch (Exception error) when (error is System.ComponentModel.Win32Exception or InvalidOperationException or IOException or UnauthorizedAccessException)
        {
            Console.WriteLine($"Не получилось: {error.Message}");
            return 1;
        }
    }

    private static int Usage()
    {
        Console.WriteLine("Sinf.Agent.exe enable [--user Ученик] | disable [--remove-account] | status");
        return 1;
    }

    private static bool IsAdministrator() =>
        new WindowsPrincipal(WindowsIdentity.GetCurrent()).IsInRole(WindowsBuiltInRole.Administrator);

    private static string? Arg(string[] args, string name)
    {
        var i = Array.IndexOf(args, name);
        return i >= 0 && i + 1 < args.Length ? args[i + 1] : null;
    }
}
