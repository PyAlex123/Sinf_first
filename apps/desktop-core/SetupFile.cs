using System.Text.Json;

namespace Sinf.Desktop.Core;

/// <summary>What the installer was told about this computer (stage 3, H17).</summary>
/// <param name="Role">"teacher" or "student".</param>
/// <param name="PcName">The student computer's name in the room, "ПК-05"; null for the teacher.</param>
public sealed record SetupChoice(string Role, string? PcName);

/// <summary>
/// <c>setup.json</c> beside Sinf.exe (stage 3, H17; ADR-018). The installer writes it from
/// <c>/ROLE=student /PC=ПК-05</c> (or from its own page), so a room of computers is set up from a
/// flash drive without the role window on each. Sinf reads it once, at the first start of each
/// Windows user that has no role yet: the "Ученик" account the kiosk runs under is not the
/// administrator who installed.
///
/// Anything doubtful gives nothing, and the role window asks as before: a teacher's computer
/// must never become a kiosk by a typo, nor a kiosk a teacher's computer.
/// </summary>
public static class SetupFile
{
    public const string FileName = "setup.json";

    public const string TeacherRole = "teacher";

    public const string StudentRole = "student";

    /// <summary>Larger than this is not ours: a few dozen bytes are expected.</summary>
    public const int MaxBytes = 4096;

    public static SetupChoice? Parse(string? json)
    {
        if (string.IsNullOrWhiteSpace(json) || json.Length > MaxBytes)
        {
            return null;
        }

        try
        {
            // Inno Setup writes UTF-8 with a byte-order mark.
            using var document = JsonDocument.Parse(json.TrimStart('﻿'));
            var root = document.RootElement;
            if (root.ValueKind != JsonValueKind.Object
                || !root.TryGetProperty("role", out var roleValue)
                || roleValue.ValueKind != JsonValueKind.String)
            {
                return null;
            }

            var role = roleValue.GetString()?.Trim().ToLowerInvariant();
            if (role == TeacherRole)
            {
                return new SetupChoice(TeacherRole, null);
            }

            if (role != StudentRole)
            {
                return null;
            }

            // A student computer without a proper name cannot sit in a seating plan: ask instead.
            var pc = root.TryGetProperty("pc", out var pcValue) && pcValue.ValueKind == JsonValueKind.String
                ? pcValue.GetString()
                : null;
            return Core.PcName.TryNormalize(pc, out var name) ? new SetupChoice(StudentRole, name) : null;
        }
        catch (JsonException)
        {
            return null;
        }
    }
}
