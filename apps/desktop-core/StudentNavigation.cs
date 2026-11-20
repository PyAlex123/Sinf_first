namespace Sinf.Desktop.Core;

/// <summary>
/// The pages a student's window may show (stage 3, H3): the way into the lesson and the lesson
/// itself, on the teacher's computer — never its home page with "I am a teacher", never anything else.
/// Only top-level navigations go through here; the lesson's own requests (API, pictures) are not pages.
/// </summary>
public static class StudentNavigation
{
    public static bool IsAllowed(string teacherUrl, string candidate)
    {
        if (!TeacherAddress.IsSameOrigin(teacherUrl, candidate)
            || !Uri.TryCreate(candidate, UriKind.Absolute, out var page))
        {
            return false;
        }

        var path = page.AbsolutePath;
        if (path is "/join" or "/join/")
        {
            return true;
        }

        // `/s/<session id>`: one segment after /s/, nothing below it.
        const string lesson = "/s/";
        if (!path.StartsWith(lesson, StringComparison.Ordinal))
        {
            return false;
        }

        var id = path[lesson.Length..].TrimEnd('/');
        return id.Length > 0 && !id.Contains('/', StringComparison.Ordinal);
    }
}
