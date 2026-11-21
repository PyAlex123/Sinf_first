using Sinf.Desktop.Core;
using Xunit;

namespace Sinf.Desktop.Core.Tests;

public class StudentNavigationTests
{
    private const string Teacher = "http://192.168.1.15:3000";

    [Theory]
    [InlineData("http://192.168.1.15:3000/join")]
    [InlineData("http://192.168.1.15:3000/join?code=1234")]
    [InlineData("http://192.168.1.15:3000/s/43b489a2-bfde-4555-a9cb-01a246d84826")]
    public void The_way_in_and_the_lesson_are_open(string url)
    {
        Assert.True(StudentNavigation.IsAllowed(Teacher, url));
    }

    [Theory]
    [InlineData("http://192.168.1.15:3000/")]
    [InlineData("http://192.168.1.15:3000/teacher/login")]
    [InlineData("http://192.168.1.15:3000/teacher")]
    [InlineData("http://192.168.1.15:3000/present/abc")]
    [InlineData("http://192.168.1.15:3000/s/")]
    [InlineData("http://192.168.1.15:3000/s/abc/def")]
    [InlineData("http://192.168.1.15:3000/joined")]
    [InlineData("http://192.168.1.16:3000/join")]
    [InlineData("https://www.youtube.com/")]
    public void Everything_else_is_closed(string url)
    {
        Assert.False(StudentNavigation.IsAllowed(Teacher, url));
    }
}
