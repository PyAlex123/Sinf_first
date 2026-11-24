using Sinf.Desktop.Core;
using Xunit;

namespace Sinf.Desktop.Core.Tests;

/// <summary>H17: what the installer leaves beside Sinf.exe for the first start.</summary>
public class SetupFileTests
{
    [Fact]
    public void A_student_computer_with_its_name()
    {
        Assert.Equal(
            new SetupChoice("student", "ПК-05"),
            SetupFile.Parse("{\"role\":\"student\",\"pc\":\"ПК-05\"}"));
    }

    [Fact]
    public void The_byte_order_mark_and_spaces_of_the_installer_do_not_matter()
    {
        Assert.Equal(
            new SetupChoice("student", "ПК 12"),
            SetupFile.Parse("﻿{ \"role\": \" Student \", \"pc\": \"  ПК   12 \" }\r\n"));
    }

    [Fact]
    public void A_teacher_computer_needs_no_name()
    {
        Assert.Equal(new SetupChoice("teacher", null), SetupFile.Parse("{\"role\":\"teacher\",\"pc\":\"\"}"));
        Assert.Equal(new SetupChoice("teacher", null), SetupFile.Parse("{\"role\":\"teacher\"}"));
    }

    [Theory]
    [InlineData("{\"role\":\"student\"}")]
    [InlineData("{\"role\":\"student\",\"pc\":\"\"}")]
    [InlineData("{\"role\":\"student\",\"pc\":\"Очень длинное имя компьютера\"}")]
    [InlineData("{\"role\":\"student\",\"pc\":5}")]
    public void A_student_computer_without_a_proper_name_asks(string json)
    {
        Assert.Null(SetupFile.Parse(json));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("not json")]
    [InlineData("[]")]
    [InlineData("{\"role\":\"admin\"}")]
    [InlineData("{\"role\":1}")]
    [InlineData("{\"pc\":\"ПК-05\"}")]
    public void Anything_doubtful_gives_nothing(string? json)
    {
        Assert.Null(SetupFile.Parse(json));
    }

    [Fact]
    public void A_huge_file_is_not_ours()
    {
        Assert.Null(SetupFile.Parse("{\"role\":\"teacher\",\"x\":\"" + new string('a', SetupFile.MaxBytes) + "\"}"));
    }

    // Finding 2 of the author's test: a reinstall as the other kind of computer must take effect.
    private static readonly SetupChoice Student05 = new("student", "ПК-05");
    private static readonly SetupChoice Teacher = new("teacher", null);

    [Fact]
    public void The_first_start_takes_the_installer_choice()
    {
        var decision = SetupFile.Decide(Student05, role: null, pcName: null, appliedKey: null);
        Assert.Equal(new SetupDecision("student", "ПК-05", NewRole: false, "student:ПК-05"), decision);
    }

    [Fact]
    public void The_same_file_is_taken_once()
    {
        Assert.Null(SetupFile.Decide(Student05, "student", "ПК-05", appliedKey: "student:ПК-05"));
    }

    [Fact]
    public void A_teacher_computer_reinstalled_as_a_student_one_becomes_a_student_one()
    {
        var decision = SetupFile.Decide(Student05, "teacher", null, appliedKey: "teacher");
        Assert.Equal(new SetupDecision("student", "ПК-05", NewRole: true, "student:ПК-05"), decision);
    }

    [Fact]
    public void A_student_computer_reinstalled_as_the_teacher_one_becomes_the_teacher_one()
    {
        var decision = SetupFile.Decide(Teacher, "student", "ПК-05", appliedKey: "student:ПК-05");
        Assert.Equal(new SetupDecision("teacher", null, NewRole: true, "teacher"), decision);
    }

    [Fact]
    public void A_settings_file_from_before_the_fix_follows_the_installer()
    {
        // The author's laptop: the role was saved before the app remembered which file it took.
        var decision = SetupFile.Decide(Student05, "teacher", null, appliedKey: null);
        Assert.Equal(new SetupDecision("student", "ПК-05", NewRole: true, "student:ПК-05"), decision);
    }

    [Fact]
    public void The_same_role_from_before_the_fix_only_remembers_the_file()
    {
        var decision = SetupFile.Decide(Student05, "student", "ПК-05", appliedKey: null);
        Assert.Equal(new SetupDecision("student", "ПК-05", NewRole: false, "student:ПК-05"), decision);
    }

    [Fact]
    public void A_new_name_for_the_same_student_computer_is_taken_without_forgetting_the_teacher()
    {
        var decision = SetupFile.Decide(new SetupChoice("student", "ПК-07"), "student", "ПК-05", "student:ПК-05");
        Assert.Equal(new SetupDecision("student", "ПК-07", NewRole: false, "student:ПК-07"), decision);
    }

    [Fact]
    public void A_choice_made_by_hand_after_the_install_stands()
    {
        // Installed as a student computer, then turned into the teacher's with --setup: the file it
        // was installed with is the one already taken, so nothing changes at the next start.
        Assert.Null(SetupFile.Decide(Student05, "teacher", null, appliedKey: "student:ПК-05"));
    }

    [Fact]
    public void No_usable_file_changes_nothing()
    {
        Assert.Null(SetupFile.Decide(null, "teacher", null, appliedKey: "teacher"));
        Assert.Null(SetupFile.Decide(null, role: null, pcName: null, appliedKey: null));
    }

    [Fact]
    public void Keys_name_the_role_and_the_computer()
    {
        Assert.Equal("teacher", SetupFile.Key(Teacher));
        Assert.Equal("student:ПК-05", SetupFile.Key(Student05));
    }
}
