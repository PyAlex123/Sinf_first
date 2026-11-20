using System.Net;
using Sinf.Desktop.Core;
using Xunit;

namespace Sinf.Desktop.Core.Tests;

public class TeacherAddressTests
{
    [Theory]
    [InlineData("192.168.1.15", "http://192.168.1.15:3000")]
    [InlineData(" 192.168.1.15:3123 ", "http://192.168.1.15:3123")]
    [InlineData("http://192.168.1.15:3000/", "http://192.168.1.15:3000")]
    [InlineData("10.0.0.7:80", "http://10.0.0.7:80")]
    [InlineData("172.20.1.2", "http://172.20.1.2:3000")]
    [InlineData("127.0.0.1:3000", "http://127.0.0.1:3000")]
    public void Accepts_school_network_addresses(string input, string expected)
    {
        Assert.True(TeacherAddress.TryNormalize(input, out var url));
        Assert.Equal(expected, url);
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("8.8.8.8")]
    [InlineData("https://192.168.1.15:3000")]
    [InlineData("http://192.168.1.15:3000/teacher")]
    [InlineData("http://192.168.1.15:3000/?x=1")]
    [InlineData("example.com")]
    [InlineData("172.32.0.1")]
    [InlineData("file:///C:/Windows")]
    [InlineData("javascript:alert(1)")]
    public void Refuses_anything_outside_the_school_network(string input)
    {
        Assert.False(TeacherAddress.TryNormalize(input, out _));
    }

    [Fact]
    public void Same_origin_means_same_host_and_port()
    {
        const string teacher = "http://192.168.1.15:3000";
        Assert.True(TeacherAddress.IsSameOrigin(teacher, "http://192.168.1.15:3000/join?code=1234"));
        Assert.True(TeacherAddress.IsSameOrigin(teacher, "http://192.168.1.15:3000/s/abc"));
        Assert.False(TeacherAddress.IsSameOrigin(teacher, "http://192.168.1.15:3001/join"));
        Assert.False(TeacherAddress.IsSameOrigin(teacher, "http://192.168.1.16:3000/join"));
        Assert.False(TeacherAddress.IsSameOrigin(teacher, "https://192.168.1.15:3000/join"));
        Assert.False(TeacherAddress.IsSameOrigin(teacher, "https://youtube.com/"));
    }

    [Fact]
    public void Only_ipv4_is_allowed()
    {
        Assert.False(TeacherAddress.IsAllowed(IPAddress.IPv6Loopback));
    }
}
