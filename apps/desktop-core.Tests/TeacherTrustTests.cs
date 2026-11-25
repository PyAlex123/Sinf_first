using Sinf.Desktop.Core;
using Xunit;

namespace Sinf.Desktop.Core.Tests;

/// <summary>Author's decision 2026-11-25: the first teacher of a new computer, confirmed by an administrator.</summary>
public class TeacherTrustTests
{
    private static readonly HashSet<string> None = [];

    [Fact]
    public void A_computer_keeps_its_own_teacher_and_no_other()
    {
        Assert.Equal(TeacherTrust.Accept, TeacherTrustRule.Decide("key-a", "key-a", true, None));
        Assert.Equal(TeacherTrust.Refuse, TeacherTrustRule.Decide("key-a", "key-b", true, None));
        Assert.Equal(TeacherTrust.Refuse, TeacherTrustRule.Decide("key-a", "key-b", false, None));
    }

    [Fact]
    public void A_new_computer_with_the_installer_password_asks_the_administrator()
    {
        Assert.Equal(TeacherTrust.AskAdministrator, TeacherTrustRule.Decide(null, "key-a", true, None));
    }

    [Fact]
    public void A_new_computer_without_one_trusts_the_first_teacher_as_before()
    {
        Assert.Equal(TeacherTrust.Accept, TeacherTrustRule.Decide(null, "key-a", false, None));
    }

    [Fact]
    public void A_teacher_the_administrator_refused_is_not_asked_about_again()
    {
        Assert.Equal(TeacherTrust.Refuse, TeacherTrustRule.Decide(null, "key-b", true, new HashSet<string> { "key-b" }));
        Assert.Equal(TeacherTrust.AskAdministrator, TeacherTrustRule.Decide(null, "key-a", true, new HashSet<string> { "key-b" }));
    }
}
