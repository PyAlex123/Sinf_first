using System.Text.Json;

namespace Sinf.Desktop.Core;

/// <summary>What the installer was told about this computer (stage 3, H17).</summary>
/// <param name="Role">"teacher" or "student".</param>
/// <param name="PcName">The student computer's name in the room, "ПК-05"; null for the teacher.</param>
public sealed record SetupChoice(string Role, string? PcName);

/// <summary>What a Windows user's settings become after reading <c>setup.json</c>.</summary>
/// <param name="Role">The installer's role.</param>
/// <param name="PcName">The installer's computer name; null for the teacher.</param>
/// <param name="NewRole">The role is not the one this user had: the teacher met before is forgotten.</param>
/// <param name="AppliedKey">Remembered, so the same file is taken only once.</param>
public sealed record SetupDecision(string Role, string? PcName, bool NewRole, string AppliedKey);

/// <summary>
/// <c>setup.json</c> beside Sinf.exe (stage 3, H17; ADR-018). The installer writes it from
/// <c>/ROLE=student /PC=ПК-05</c> (or from its own page), so a room of computers is set up from a
/// flash drive without the role window on each. Sinf takes it at the first start of each Windows
/// user (the "Ученик" account the kiosk runs under is not the administrator who installed) and
/// again whenever the installer has said something new since: Sinf put back as the other kind of
/// computer keeps no role from before (test finding 2: a teacher's laptop reinstalled as a student's
/// opened as the teacher's again). The same file never overrides a choice made by hand afterwards
/// (<c>--setup</c>).
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

    /// <summary>One installer choice as the app remembers it: "teacher" or "student:ПК-05".</summary>
    public static string Key(SetupChoice choice) =>
        choice.PcName is null ? choice.Role : $"{choice.Role}:{choice.PcName}";

    /// <summary>
    /// Null — nothing to take: no usable file, or this file was taken already (a later choice by hand
    /// stands). Otherwise the user's role and name become the installer's.
    /// </summary>
    /// <param name="choice">What <see cref="Parse"/> read from the file.</param>
    /// <param name="role">This user's saved role; null when none yet.</param>
    /// <param name="pcName">This user's saved computer name.</param>
    /// <param name="appliedKey">The <see cref="Key"/> of the file taken last; null when none.</param>
    public static SetupDecision? Decide(SetupChoice? choice, string? role, string? pcName, string? appliedKey)
    {
        if (choice is null)
        {
            return null;
        }

        var key = Key(choice);
        var hasRole = role is TeacherRole or StudentRole;
        if (hasRole && appliedKey == key)
        {
            return null;
        }

        return new SetupDecision(choice.Role, choice.PcName, NewRole: hasRole && role != choice.Role, key);
    }

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
