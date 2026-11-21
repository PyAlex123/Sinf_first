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
}
