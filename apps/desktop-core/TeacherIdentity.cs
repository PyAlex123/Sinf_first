using System.Security.Cryptography;
using System.Text;

namespace Sinf.Desktop.Core;

/// <summary>
/// The teacher's computer's own key (stage 3, H9; CLAUDE.md §5.6). It signs every answer to "where is
/// the lesson?", so a student computer can tell its own teacher from a laptop or phone in the same
/// network pretending to be one. ECDSA P-256: built into .NET everywhere, small signatures.
/// </summary>
public sealed class TeacherIdentity : IDisposable
{
    private readonly ECDsa key;

    private TeacherIdentity(ECDsa key)
    {
        this.key = key;
        PublicKey = Convert.ToBase64String(key.ExportSubjectPublicKeyInfo());
    }

    /// <summary>The public half, SubjectPublicKeyInfo in base64: what student computers remember.</summary>
    public string PublicKey { get; }

    public static TeacherIdentity Create() => new(ECDsa.Create(ECCurve.NamedCurves.nistP256));

    /// <summary>The private key as saved on the teacher's computer (PKCS#8).</summary>
    public byte[] Export() => key.ExportPkcs8PrivateKey();

    /// <summary>A saved key, or null when the bytes are not a P-256 private key.</summary>
    public static TeacherIdentity? Import(byte[] pkcs8)
    {
        var imported = ECDsa.Create();
        try
        {
            imported.ImportPkcs8PrivateKey(pkcs8, out _);
            if (imported.KeySize != 256)
            {
                imported.Dispose();
                return null;
            }

            return new TeacherIdentity(imported);
        }
        catch (CryptographicException)
        {
            imported.Dispose();
            return null;
        }
    }

    /// <summary>The key kept in a file, created there on the first run.</summary>
    public static TeacherIdentity LoadOrCreate(string path)
    {
        if (File.Exists(path) && Import(File.ReadAllBytes(path)) is { } saved)
        {
            return saved;
        }

        var created = Create();
        Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(path))!);
        File.WriteAllBytes(path, created.Export());
        return created;
    }

    public string Sign(string text) =>
        Convert.ToBase64String(key.SignData(Encoding.UTF8.GetBytes(text), HashAlgorithmName.SHA256));

    /// <summary>Does `signature` say that the owner of `publicKey` signed `text`? Never throws.</summary>
    public static bool Verify(string? publicKey, string text, string? signature)
    {
        if (publicKey is null || signature is null)
        {
            return false;
        }

        try
        {
            using var verifier = ECDsa.Create();
            verifier.ImportSubjectPublicKeyInfo(Convert.FromBase64String(publicKey), out _);
            return verifier.KeySize == 256
                && verifier.VerifyData(Encoding.UTF8.GetBytes(text), Convert.FromBase64String(signature), HashAlgorithmName.SHA256);
        }
        catch (Exception error) when (error is FormatException or CryptographicException)
        {
            return false;
        }
    }

    /// <summary>
    /// Eight characters an administrator can read off two screens and compare: "3F9A-01C7". It names
    /// the key, it is not a secret.
    /// </summary>
    public static string Fingerprint(string publicKey)
    {
        var hash = SHA256.HashData(Encoding.ASCII.GetBytes(publicKey));
        var hex = Convert.ToHexString(hash, 0, 4);
        return $"{hex[..4]}-{hex[4..]}";
    }

    public void Dispose() => key.Dispose();
}
