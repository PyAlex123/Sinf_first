using System.Security.Cryptography;
using System.Text;

namespace Sinf.Desktop.Core;

/// <summary>
/// The administrator's password that lets a person out of a student's kiosk (stage 3, H3). Set once
/// on the teacher's computer; only its hash travels to the student computers, which then check it
/// without a network. PBKDF2-SHA256, because the hash is visible on the classroom network.
/// </summary>
public static class ExitPassword
{
    public const int MinLength = 8;
    private const int Iterations = 100_000;
    private const int SaltBytes = 16;
    private const int HashBytes = 32;
    private const string Prefix = "pbkdf2-sha256";

    public static bool IsStrongEnough(string? password) => (password ?? string.Empty).Length >= MinLength;

    /// <summary>`pbkdf2-sha256$100000$salt$hash` (salt and hash in base64).</summary>
    public static string Hash(string password, byte[]? salt = null)
    {
        salt ??= RandomNumberGenerator.GetBytes(SaltBytes);
        var hash = Derive(password, salt, Iterations);
        return $"{Prefix}${Iterations}${Convert.ToBase64String(salt)}${Convert.ToBase64String(hash)}";
    }

    public static bool Verify(string? password, string? stored)
    {
        if (password is null || !TryParse(stored, out var iterations, out var salt, out var expected))
        {
            return false;
        }

        var actual = Derive(password, salt, iterations);
        return CryptographicOperations.FixedTimeEquals(actual, expected);
    }

    /// <summary>True when the password matches any of the hashes.</summary>
    public static bool VerifyAny(string? password, IReadOnlyCollection<string> stored) =>
        stored.Any(hash => Verify(password, hash));

    /// <summary>Does this look like a hash we made? Anything else from the network is ignored.</summary>
    public static bool IsWellFormed(string? stored) => TryParse(stored, out _, out _, out _);

    private static bool TryParse(string? stored, out int iterations, out byte[] salt, out byte[] hash)
    {
        iterations = 0;
        salt = [];
        hash = [];
        var parts = (stored ?? string.Empty).Split('$');
        if (parts.Length != 4 || parts[0] != Prefix || !int.TryParse(parts[1], out iterations))
        {
            return false;
        }

        // Too few rounds would make a hash from the network cheap to guess; too many would hang the PC.
        if (iterations is < 10_000 or > 1_000_000)
        {
            return false;
        }

        try
        {
            salt = Convert.FromBase64String(parts[2]);
            hash = Convert.FromBase64String(parts[3]);
        }
        catch (FormatException)
        {
            return false;
        }

        return salt.Length >= 8 && hash.Length == HashBytes;
    }

    private static byte[] Derive(string password, byte[] salt, int iterations) =>
        Rfc2898DeriveBytes.Pbkdf2(Encoding.UTF8.GetBytes(password), salt, iterations, HashAlgorithmName.SHA256, HashBytes);
}

/// <summary>
/// Wrong passwords at the kiosk: after five in a row the window stops asking for a minute, so a
/// child cannot sit and guess. Pure, with the clock passed in.
/// </summary>
public sealed class ExitGate
{
    public const int MaxFailures = 5;
    public static readonly TimeSpan Pause = TimeSpan.FromMinutes(1);

    private int failures;
    private DateTimeOffset? lockedUntil;

    /// <summary>How long to wait before the next try; zero when a try is allowed.</summary>
    public TimeSpan Wait(DateTimeOffset now) =>
        lockedUntil is { } until && until > now ? until - now : TimeSpan.Zero;

    /// <summary>Checks a password, counting failures. False also while locked.</summary>
    public bool TryOpen(string? password, string? stored, DateTimeOffset now) =>
        TryOpen(password, stored is null ? [] : [stored], now);

    /// <summary>The same against several passwords, any of which opens (<see cref="KioskPasswords"/>).</summary>
    public bool TryOpen(string? password, IReadOnlyCollection<string> stored, DateTimeOffset now)
    {
        if (Wait(now) > TimeSpan.Zero)
        {
            return false;
        }

        if (ExitPassword.VerifyAny(password, stored))
        {
            failures = 0;
            lockedUntil = null;
            return true;
        }

        failures++;
        if (failures >= MaxFailures)
        {
            failures = 0;
            lockedUntil = now + Pause;
        }

        return false;
    }
}

/// <summary>
/// The passwords that let a person out of a student's kiosk: the room's password the teacher's
/// computer hands out (H3) and the one given to the installer (test finding 4: until the computer
/// met its teacher, it knew none and let anyone out). Either opens. With neither the computer is
/// still being set up, and the way out asks for nothing.
/// </summary>
public static class KioskPasswords
{
    /// <summary>Where the installer's password is kept: HKLM, which only administrators may change.</summary>
    public const string MachineKey = @"SOFTWARE\Sinf";

    public const string MachineValue = "ExitPasswordHash";

    /// <summary>The installer hands the password to <c>Sinf.exe --set-exit-password</c> in this variable,
    /// never on the command line.</summary>
    public const string InstallerVariable = "SINF_EXIT_PASSWORD";

    public static IReadOnlyList<string> From(string? teacherHash, string? machineHash) =>
        new[] { teacherHash, machineHash }
            .Where(ExitPassword.IsWellFormed)
            .Select(hash => hash!)
            .Distinct(StringComparer.Ordinal)
            .ToArray();
}
