using System.Net;
using System.Text;
using Sinf.Desktop.Core;
using Xunit;

namespace Sinf.Desktop.Core.Tests;

public class DiscoveryTests
{
    private static readonly TeacherIdentity Teacher = TeacherIdentity.Create();
    private const string Url = "http://192.168.1.15:3000";

    [Fact]
    public void A_request_carries_a_nonce_and_a_signed_answer_carries_the_address()
    {
        var nonce = Discovery.NewNonce();
        Assert.Equal(nonce, Discovery.ReadRequest(Discovery.Request(nonce)));
        Assert.NotEqual(nonce, Discovery.NewNonce());
        var answer = Discovery.Answer(nonce, Url, "Учитель", null, Teacher);
        Assert.Null(Discovery.ReadRequest(answer));
        Assert.Equal(new TeacherFound(Url, null, Teacher.PublicKey), Discovery.ReadAnswer(answer, nonce, null));
        Assert.True(answer.Length < Discovery.MaxMessageBytes / 2);
    }

    [Fact]
    public void Only_the_remembered_teacher_is_believed()
    {
        var nonce = Discovery.NewNonce();
        using var stranger = TeacherIdentity.Create();
        var fake = Discovery.Answer(nonce, "http://192.168.1.66:3000", "Учитель", ExitPassword.Hash("svoy-parol-1"), stranger);
        // A computer that has met nobody believes the first signed answer (author's choice)...
        Assert.NotNull(Discovery.ReadAnswer(fake, nonce, null));
        // ...and one that remembers its teacher does not believe anybody else.
        Assert.Null(Discovery.ReadAnswer(fake, nonce, Teacher.PublicKey));
        Assert.NotNull(Discovery.ReadAnswer(Discovery.Answer(nonce, Url, null, null, Teacher), nonce, Teacher.PublicKey));
    }

    [Fact]
    public void An_answer_to_another_question_is_not_ours()
    {
        var old = Discovery.NewNonce();
        var replayed = Discovery.Answer(old, Url, null, null, Teacher);
        Assert.Null(Discovery.ReadAnswer(replayed, Discovery.NewNonce(), Teacher.PublicKey));
    }

    [Theory]
    [InlineData("url", "http://192.168.1.66:3000")]
    [InlineData("exit", "pbkdf2-sha256$100000$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=")]
    [InlineData("name", "Другой")]
    [InlineData("sig", "AAAA")]
    public void A_changed_field_breaks_the_signature(string field, string value)
    {
        var nonce = Discovery.NewNonce();
        var answer = Discovery.Answer(nonce, Url, "Учитель", ExitPassword.Hash("parol-uchitelya"), Teacher);
        var json = System.Text.Json.Nodes.JsonNode.Parse(answer)!.AsObject();
        json[field] = value;
        Assert.Null(Discovery.ReadAnswer(Encoding.UTF8.GetBytes(json.ToJsonString()), nonce, null));
    }

    [Theory]
    [InlineData("")]
    [InlineData("hello")]
    [InlineData("{\"app\":\"other\",\"v\":2,\"type\":\"here\",\"url\":\"http://192.168.1.15:3000\"}")]
    [InlineData("{\"app\":\"sinf\",\"v\":1,\"type\":\"here\",\"url\":\"http://192.168.1.15:3000\"}")]
    [InlineData("{\"app\":\"sinf\",\"v\":2,\"type\":\"find\",\"n\":\"AAAAAAAAAAAAAAAAAAAAAA==\"}")]
    [InlineData("{\"app\":\"sinf\",\"v\":2,\"type\":\"here\",\"n\":\"AAAAAAAAAAAAAAAAAAAAAA==\",\"url\":\"http://192.168.1.15:3000\"}")]
    public void Unsigned_or_foreign_answers_are_dropped(string json)
    {
        Assert.Null(Discovery.ReadAnswer(Encoding.UTF8.GetBytes(json), "AAAAAAAAAAAAAAAAAAAAAA==", null));
    }

    [Theory]
    [InlineData("http://evil.example/")]
    [InlineData("http://8.8.8.8:3000")]
    public void A_signed_answer_still_points_into_the_school_network_only(string url)
    {
        var nonce = Discovery.NewNonce();
        Assert.Null(Discovery.ReadAnswer(Discovery.Answer(nonce, url, null, null, Teacher), nonce, null));
    }

    [Fact]
    public void The_exit_hash_travels_but_a_malformed_one_is_dropped()
    {
        var nonce = Discovery.NewNonce();
        var hash = ExitPassword.Hash("parol-uchitelya");
        Assert.Equal(hash, Discovery.ReadAnswer(Discovery.Answer(nonce, Url, null, hash, Teacher), nonce, null)?.ExitHash);
        var odd = Discovery.ReadAnswer(Discovery.Answer(nonce, Url, null, "plain-password", Teacher), nonce, null);
        Assert.NotNull(odd);
        Assert.Null(odd!.ExitHash);
    }

    [Theory]
    [InlineData("short")]
    [InlineData("has spaces in it, sixteen+")]
    public void A_question_without_a_proper_nonce_is_not_answered(string nonce)
    {
        Assert.Null(Discovery.ReadRequest(Discovery.Request(nonce)));
    }

    [Fact]
    public void Oversized_messages_are_not_read()
    {
        var big = Encoding.UTF8.GetBytes("{\"app\":\"sinf\",\"v\":2,\"type\":\"find\",\"n\":\"AAAAAAAAAAAAAAAAAAAAAA==\",\"pad\":\"" + new string('x', 1100) + "\"}");
        Assert.Null(Discovery.ReadRequest(big));
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
        var exit = ExitPassword.Hash("parol-uchitelya");
        using var beacon = new TeacherBeacon(
            () => "http://192.168.1.15:3123",
            "ПК учителя",
            Teacher,
            () => exit,
            new IPEndPoint(IPAddress.Loopback, 0));
        var found = await TeacherFinder.FindAsync(
            [new IPEndPoint(IPAddress.Loopback, beacon.Port)],
            TimeSpan.FromSeconds(3));
        Assert.Equal("http://192.168.1.15:3123", found?.Url);
        Assert.True(ExitPassword.Verify("parol-uchitelya", found?.ExitHash));
        Assert.Equal(Teacher.PublicKey, found?.TeacherKey);
        Assert.Equal(1, beacon.Answered);
    }

    [Fact]
    public async Task A_student_that_remembers_its_teacher_ignores_another_over_udp()
    {
        using var stranger = TeacherIdentity.Create();
        using var fake = new TeacherBeacon(
            () => "http://192.168.1.66:3000",
            "Не учитель",
            stranger,
            bind: new IPEndPoint(IPAddress.Loopback, 0));
        using var real = new TeacherBeacon(
            () => "http://192.168.1.15:3000",
            "ПК учителя",
            Teacher,
            bind: new IPEndPoint(IPAddress.Loopback, 0));
        var found = await TeacherFinder.FindAsync(
            [new IPEndPoint(IPAddress.Loopback, fake.Port), new IPEndPoint(IPAddress.Loopback, real.Port)],
            TimeSpan.FromSeconds(3),
            Teacher.PublicKey);
        Assert.Equal("http://192.168.1.15:3000", found?.Url);

        var onlyFake = await TeacherFinder.FindAsync(
            [new IPEndPoint(IPAddress.Loopback, fake.Port)],
            TimeSpan.FromMilliseconds(500),
            Teacher.PublicKey);
        Assert.Null(onlyFake);
        Assert.True(fake.Answered >= 1);
    }

    [Fact]
    public async Task Nobody_answers_while_the_teacher_has_no_address_yet()
    {
        using var beacon = new TeacherBeacon(() => null, null, Teacher, bind: new IPEndPoint(IPAddress.Loopback, 0));
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
