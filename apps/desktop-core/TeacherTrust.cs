namespace Sinf.Desktop.Core;

/// <summary>What a student computer does with a teacher computer that answered its search.</summary>
public enum TeacherTrust
{
    /// <summary>Its own teacher, or a first one on a computer nobody can confirm for (H9 as before).</summary>
    Accept,

    /// <summary>A first teacher on a computer with the installer's exit password: an administrator confirms.</summary>
    AskAdministrator,

    /// <summary>Another teacher than its own, or one an administrator already said no to.</summary>
    Refuse,
}

/// <summary>
/// The first meeting of a student computer and a teacher's (author's decision, 2026-11-25). A new
/// computer used to trust the first signed answer for good, and a pupil with Sinf on a laptop could
/// become the "teacher" of a freshly installed computer. Where the installer left an exit password,
/// an administrator now confirms the first teacher with it; elsewhere the first one is trusted, as
/// before.
/// </summary>
public static class TeacherTrustRule
{
    /// <param name="pinnedKey">The teacher this computer already trusts; null on a new computer.</param>
    /// <param name="foundKey">The key that signed the answer.</param>
    /// <param name="hasInstallerPassword">The installer left an exit password an administrator knows.</param>
    /// <param name="refused">Keys an administrator refused since Sinf started.</param>
    public static TeacherTrust Decide(
        string? pinnedKey,
        string foundKey,
        bool hasInstallerPassword,
        IReadOnlySet<string> refused)
    {
        if (pinnedKey is not null)
        {
            return pinnedKey == foundKey ? TeacherTrust.Accept : TeacherTrust.Refuse;
        }

        if (refused.Contains(foundKey))
        {
            return TeacherTrust.Refuse;
        }

        return hasInstallerPassword ? TeacherTrust.AskAdministrator : TeacherTrust.Accept;
    }
}
