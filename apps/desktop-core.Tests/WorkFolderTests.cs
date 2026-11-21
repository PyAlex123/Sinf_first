using Sinf.Desktop.Core;
using Xunit;

namespace Sinf.Desktop.Core.Tests;

public class WorkFolderTests
{
    [Theory]
    [InlineData("Рисунок.png", true)]
    [InlineData("Отчёт.DOCX", true)]
    [InlineData("~$Отчёт.docx", false)]
    [InlineData("~WRL0001.tmp", false)]
    [InlineData("Книга.xlsx.tmp", false)]
    [InlineData("game.exe", false)]
    [InlineData(".hidden.txt", false)]
    [InlineData("noext", false)]
    [InlineData("script.js", false)]
    public void Sends_only_the_child_s_work(string name, bool expected)
    {
        Assert.Equal(expected, WorkFolder.IsWork(name));
    }

    private static readonly Dictionary<string, string> Nothing = new();

    [Fact]
    public void At_the_start_everything_comes_from_the_server()
    {
        var plan = WorkFolder.Plan([new("1", "Рисунок.png", "aa", 10), new("2", "Текст.txt", "bb", 5)], [], Nothing);
        Assert.Equal(
            [new FolderAction.Download("Рисунок.png", "1", "aa"), new FolderAction.Download("Текст.txt", "2", "bb")],
            plan);
    }

    [Fact]
    public void A_saved_change_goes_up_with_the_version_it_was_made_from()
    {
        var known = new Dictionary<string, string> { ["Рисунок.png"] = "aa" };
        var plan = WorkFolder.Plan([new("1", "Рисунок.png", "aa", 10)], [new("Рисунок.png", "cc", 12)], known);
        Assert.Equal([new FolderAction.Upload("Рисунок.png", "aa")], plan);
    }

    [Fact]
    public void A_new_file_goes_up_as_new_and_Office_s_lock_files_stay()
    {
        var plan = WorkFolder.Plan([], [new("Отчёт.docx", "dd", 100), new("~$Отчёт.docx", "ee", 1)], Nothing);
        Assert.Equal([new FolderAction.Upload("Отчёт.docx", null)], plan);
    }

    [Fact]
    public void Nothing_to_do_when_both_sides_agree_whatever_the_letter_case()
    {
        var known = new Dictionary<string, string> { ["Рисунок.png"] = "aa" };
        Assert.Empty(WorkFolder.Plan([new("1", "рисунок.PNG", "aa", 10)], [new("Рисунок.png", "aa", 10)], known));
    }

    [Fact]
    public void A_newer_version_from_elsewhere_comes_down_over_an_unchanged_file()
    {
        var known = new Dictionary<string, string> { ["Рисунок.png"] = "aa" };
        var plan = WorkFolder.Plan([new("1", "Рисунок.png", "zz", 10)], [new("Рисунок.png", "aa", 10)], known);
        Assert.Equal([new FolderAction.Download("Рисунок.png", "1", "zz")], plan);
    }

    [Fact]
    public void A_file_deleted_here_is_deleted_there_but_a_new_one_there_comes_down()
    {
        var known = new Dictionary<string, string> { ["Старый.txt"] = "aa" };
        var plan = WorkFolder.Plan(
            [new("1", "Старый.txt", "aa", 1), new("2", "Из дома.txt", "bb", 1)],
            [],
            known);
        Assert.Equal(
            [new FolderAction.Delete("Старый.txt", "1"), new FolderAction.Download("Из дома.txt", "2", "bb")],
            plan);
    }

    [Fact]
    public void Hashes_a_file()
    {
        using var stream = new MemoryStream("abc"u8.ToArray());
        Assert.Equal("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", WorkFolder.Sha256Of(stream));
    }
}
