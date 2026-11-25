using System.Text.Json;
using Sinf.Desktop.Core;
using Xunit;

namespace Sinf.Desktop.Core.Tests;

/// <summary>B7: what the agent changes in Windows, how it is undone, the watchdog and the pipe.</summary>
public class AgentTests
{
    private static readonly DateTimeOffset Now = DateTimeOffset.Parse("2026-11-21T10:00:00Z");

    [Fact]
    public void Logs_in_the_student_by_itself_without_a_password_in_the_registry()
    {
        var machine = AgentPlan.Machine("Ученик", "PC-05");
        Assert.Contains(machine, v => v is { Name: "AutoAdminLogon", Data: "1" });
        Assert.Contains(machine, v => v is { Name: "DefaultUserName", Data: "Ученик" });
        Assert.Contains(machine, v => v is { Name: "DefaultDomainName", Data: "PC-05" });
        // A plain-text password from an earlier tool is removed, never written.
        Assert.Contains(machine, v => v is { Name: "DefaultPassword", Data: null });
        Assert.All(machine, v => Assert.Equal(RegistryHive.LocalMachine, v.Hive));
    }

    [Fact]
    public void Changes_only_the_student_account_for_the_shell_and_the_policies()
    {
        var user = AgentPlan.StudentUser(@"C:\Program Files\Sinf\Sinf.exe");
        Assert.All(user, v => Assert.Equal(RegistryHive.StudentUser, v.Hive));
        Assert.Contains(user, v => v is { Name: "Shell", Data: @"C:\Program Files\Sinf\Sinf.exe" });
        foreach (var policy in new[] { "DisableTaskMgr", "DisableLockWorkstation", "DisableChangePassword", "NoLogoff", "DisableCMD" })
        {
            Assert.Contains(user, v => v.Name == policy && Equals(v.Data, 1));
        }

        Assert.Contains(user, v => v is { Name: "NoDrives", Data: AgentPlan.AllDrives });
        Assert.Equal(user.Count, user.Select(v => v.Id).Distinct().Count());
    }

    [Fact]
    public void Rolls_back_to_exactly_what_was_there()
    {
        var applied = AgentPlan.Machine("Ученик", "PC-05");
        var saved = new Dictionary<string, SavedValue>
        {
            // Autologon was off, with another user remembered; the rest did not exist.
            [applied[0].Id] = new(applied[0].Id, "0"),
            [applied[1].Id] = new(applied[1].Id, "Admin"),
            [applied[2].Id] = new(applied[2].Id, null),
            [applied[4].Id] = new(applied[4].Id, 1),
        };
        var back = AgentPlan.Rollback(applied, saved);
        Assert.Equal("0", back.Single(v => v.Name == "AutoAdminLogon").Data);
        Assert.Equal("Admin", back.Single(v => v.Name == "DefaultUserName").Data);
        Assert.Null(back.Single(v => v.Name == "DefaultDomainName").Data);
        // Never read, never touched on the way back.
        Assert.DoesNotContain(back, v => v.Name == "DefaultPassword");
    }

    [Fact]
    public void Remembers_the_old_values_across_a_restart()
    {
        var state = new AgentState("Ученик", AccountCreated: true, "S-1-5-21-1-2-3-1001", new Dictionary<string, SavedValue>
        {
            ["a"] = new("a", "0"),
            ["b"] = new("b", 1),
            ["c"] = new("c", null),
        });
        var back = AgentState.Parse(state.ToJson());
        Assert.NotNull(back);
        Assert.Equal("Ученик", back.User);
        Assert.True(back.AccountCreated);
        Assert.Equal("S-1-5-21-1-2-3-1001", back.UserSid);
        Assert.Equal("0", back.Saved["a"].Data);
        Assert.Equal(1, back.Saved["b"].Data);
        Assert.Null(back.Saved["c"].Data);
        Assert.Null(AgentState.Parse("{}"));
    }

    [Fact]
    public void Makes_passwords_windows_accepts_and_nobody_guesses()
    {
        var passwords = Enumerable.Range(0, 50).Select(_ => AgentPlan.NewPassword()).ToList();
        Assert.Equal(50, passwords.Distinct().Count());
        Assert.All(passwords, p =>
        {
            Assert.Equal(24, p.Length);
            Assert.Contains(p, char.IsUpper);
            Assert.Contains(p, char.IsLower);
            Assert.Contains(p, char.IsDigit);
            Assert.Contains(p, c => !char.IsLetterOrDigit(c));
        });
    }

    [Fact]
    public void Brings_the_shell_back_only_for_the_student_and_only_when_it_is_gone()
    {
        var memory = new AgentMemory();
        Assert.Equal(WatchdogStep.StartShell, memory.Decide(Now, "Ученик", "Ученик", shellRunning: false, null));
        Assert.Equal(WatchdogStep.StartShell, memory.Decide(Now, "ученик", "Ученик", false, null));
        Assert.Equal(WatchdogStep.Wait, memory.Decide(Now, "Ученик", "Ученик", shellRunning: true, null));
        // The administrator's own session is never touched, nor the logon screen.
        Assert.Equal(WatchdogStep.Wait, memory.Decide(Now, "Admin", "Ученик", false, null));
        Assert.Equal(WatchdogStep.Wait, memory.Decide(Now, null, "Ученик", false, null));
    }

    [Fact]
    public void Pauses_for_maintenance_and_updates_but_not_for_ever()
    {
        var memory = new AgentMemory();
        memory.BeginMaintenance(Now);
        Assert.Equal(WatchdogStep.Paused, memory.Decide(Now.AddMinutes(29), "Ученик", "Ученик", false, null));
        Assert.Equal(WatchdogStep.StartShell, memory.Decide(Now.AddMinutes(31), "Ученик", "Ученик", false, null));
        memory.EndMaintenance();
        Assert.Equal(WatchdogStep.Paused, memory.Decide(Now, "Ученик", "Ученик", false, updatingSince: Now.AddMinutes(-5)));
        // An installer stuck for an hour does not leave the child without a shell.
        Assert.Equal(WatchdogStep.StartShell, memory.Decide(Now, "Ученик", "Ученик", false, updatingSince: Now.AddHours(-1)));
    }

    [Fact]
    public void Keeps_the_teachers_lock_for_a_restarted_shell()
    {
        var memory = new AgentMemory();
        var answer = AgentConversation.Handle(memory, AgentRequest.Parse("""{"type":"lock","on":true}"""), [], Now);
        Assert.True(Read(answer).GetProperty("lock").GetBoolean());
        // Sinf crashed and came back: it asks first.
        var hello = AgentConversation.Handle(memory, AgentRequest.Parse("""{"type":"hello"}"""), [], Now.AddMinutes(1));
        Assert.True(Read(hello).GetProperty("lock").GetBoolean());
        AgentConversation.Handle(memory, AgentRequest.Parse("""{"type":"lock","on":false}"""), [], Now.AddMinutes(2));
        Assert.False(memory.Locked(Now.AddMinutes(2)));
        // A lock left from yesterday is not the teacher's will today.
        memory.SetLock(true, Now);
        Assert.False(memory.Locked(Now.AddHours(3)));
    }

    [Fact]
    public void Gives_maintenance_time_only_for_the_exit_password()
    {
        var hash = ExitPassword.Hash("учитель-2026");
        var memory = new AgentMemory();
        var wrong = AgentConversation.Handle(memory, new AgentRequest.Maintenance("угадал?"), [hash], Now);
        Assert.False(Read(wrong).GetProperty("ok").GetBoolean());
        Assert.False(memory.InMaintenance(Now));
        var none = AgentConversation.Handle(memory, new AgentRequest.Maintenance(null), [hash], Now);
        Assert.False(Read(none).GetProperty("ok").GetBoolean());
        var right = AgentConversation.Handle(memory, new AgentRequest.Maintenance("учитель-2026"), [hash], Now);
        Assert.True(Read(right).GetProperty("maintenance").GetBoolean());
        // Before any teacher handed out a password: setup time, as in Sinf itself.
        var setup = new AgentMemory();
        AgentConversation.Handle(setup, new AgentRequest.Maintenance(null), [], Now);
        Assert.True(setup.InMaintenance(Now));
    }

    [Theory]
    [InlineData("not json")]
    [InlineData("""{"type":"unlock-everything"}""")]
    [InlineData("""{"no":"type"}""")]
    public void Answers_nonsense_with_no(string line)
    {
        var memory = new AgentMemory();
        var answer = AgentConversation.Handle(memory, AgentRequest.Parse(line), [], Now);
        Assert.False(Read(answer).GetProperty("ok").GetBoolean());
        Assert.False(memory.InMaintenance(Now));
    }

    private static JsonElement Read(string json) => JsonDocument.Parse(json).RootElement.Clone();
}
