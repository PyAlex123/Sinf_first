using System.Net;
using System.Text;
using Sinf.Desktop.Core;
using Xunit;

namespace Sinf.Desktop.Core.Tests;

public class DiscoveryTests
{
    [Fact]
    public void A_request_is_recognised_and_an_answer_carries_the_address()
    {
        Assert.True(Discovery.IsRequest(Discovery.Request()));
        var answer = Discovery.Answer("http://192.168.1.15:3000", "Учитель");
        Assert.False(Discovery.IsRequest(answer));
        Assert.Equal("http://192.168.1.15:3000", Discovery.ReadAnswer(answer));
    }

    [Theory]
    [InlineData("")]
    [InlineData("hello")]
    [InlineData("{\"app\":\"other\",\"v\":1,\"type\":\"here\",\"url\":\"http://192.168.1.15:3000\"}")]
    [InlineData("{\"app\":\"sinf\",\"v\":2,\"type\":\"here\",\"url\":\"http://192.168.1.15:3000\"}")]
    [InlineData("{\"app\":\"sinf\",\"v\":1,\"type\":\"find\"}")]
    [InlineData("{\"app\":\"sinf\",\"v\":1,\"type\":\"here\",\"url\":\"http://evil.example/\"}")]
    [InlineData("{\"app\":\"sinf\",\"v\":1,\"type\":\"here\",\"url\":\"http://8.8.8.8:3000\"}")]
    [InlineData("{\"app\":\"sinf\",\"v\":1,\"type\":\"here\"}")]
    public void Answers_we_cannot_trust_are_dropped(string json)
    {
        Assert.Null(Discovery.ReadAnswer(Encoding.UTF8.GetBytes(json)));
    }

    [Fact]
    public void Oversized_messages_are_not_read()
    {
        var big = Encoding.UTF8.GetBytes("{\"app\":\"sinf\",\"v\":1,\"type\":\"find\",\"pad\":\"" + new string('x', 600) + "\"}");
        Assert.False(Discovery.IsRequest(big));
    }

    [Theory]
    [InlineData("192.168.1.15", "255.255.255.0", "192.168.1.255")]
    [InlineData("10.12.3.4", "255.255.0.0", "10.12.255.255")]
    [InlineData("172.16.5.9", "255.255.240.0", "172.16.15.255")]
    public void Directed_broadcast_of_a_network(string address, string mask, string expected)
    {
        Assert.Equal(
            IPAddress.Parse(expected),
            Discovery.DirectedBroadcast(IPAddress.Parse(address), IPAddress.Parse(mask)));
    }

    [Fact]
    public async Task A_student_finds_the_teacher_over_udp()
    {
        using var beacon = new TeacherBeacon(
            () => "http://192.168.1.15:3123",
            "ПК учителя",
            new IPEndPoint(IPAddress.Loopback, 0));
        var url = await TeacherFinder.FindAsync(
            [new IPEndPoint(IPAddress.Loopback, beacon.Port)],
            TimeSpan.FromSeconds(3));
        Assert.Equal("http://192.168.1.15:3123", url);
        Assert.Equal(1, beacon.Answered);
    }

    [Fact]
    public async Task Nobody_answers_while_the_teacher_has_no_address_yet()
    {
        using var beacon = new TeacherBeacon(() => null, null, new IPEndPoint(IPAddress.Loopback, 0));
        var url = await TeacherFinder.FindAsync(
            [new IPEndPoint(IPAddress.Loopback, beacon.Port)],
            TimeSpan.FromMilliseconds(400));
        Assert.Null(url);
    }

    [Fact]
    public void Broadcast_targets_always_include_the_limited_broadcast()
    {
        var targets = TeacherFinder.BroadcastTargets();
        Assert.Contains(targets, t => t.Address.Equals(IPAddress.Broadcast) && t.Port == Discovery.Port);
    }
}
