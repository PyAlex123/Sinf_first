namespace Sinf.Desktop.Core;

/// <summary>What the kiosk does with one key press (stage 3, H3).</summary>
public enum KeyDecision
{
    /// <summary>Goes to the lesson as usual: letters, digits, Enter, Backspace.</summary>
    Pass,

    /// <summary>Never reaches Windows: the ways out of the lesson.</summary>
    Swallow,

    /// <summary>The administrator's combination: ask for the exit password.</summary>
    AskPassword,
}

/// <summary>
/// Which keys a student's window keeps from Windows (CLAUDE.md §8, PLAN.md 0.2). Pure, so every rule
/// is tested without Windows; the low-level hook in the app only feeds it what it sees.
/// Ctrl+Alt+Del and Win+L are not here: Windows handles them before any program can — they are
/// closed by policies of the agent (6.4), not by the shell.
/// </summary>
public static class KeyRules
{
    // Windows virtual-key codes.
    public const int Tab = 0x09;
    public const int Escape = 0x1B;
    public const int Space = 0x20;
    public const int LeftWin = 0x5B;
    public const int RightWin = 0x5C;
    public const int Apps = 0x5D;
    public const int F4 = 0x73;
    public const int F11 = 0x7A;
    public const int F12 = 0x7B;

    /// <summary>The way out for the administrator (author's choice): Ctrl+Alt+Shift+F12.</summary>
    public static bool IsExitCombination(int key, bool ctrl, bool alt, bool shift) =>
        key == F12 && ctrl && alt && shift;

    public static KeyDecision Decide(int key, bool ctrl, bool alt, bool shift, bool win)
    {
        if (IsExitCombination(key, ctrl, alt, shift))
        {
            return KeyDecision.AskPassword;
        }

        // Start menu, Win+D (desktop), Win+E (Explorer), Win+R (Run), Win+Tab and the rest.
        if (key is LeftWin or RightWin || win)
        {
            return KeyDecision.Swallow;
        }

        if (alt && key is Tab or Escape or F4 or Space)
        {
            return KeyDecision.Swallow;
        }

        // Ctrl+Esc opens Start; Ctrl+Shift+Esc opens the task manager.
        if (ctrl && key == Escape)
        {
            return KeyDecision.Swallow;
        }

        // The context-menu key and full-screen toggling do nothing useful in a lesson.
        if (key is Apps or F11)
        {
            return KeyDecision.Swallow;
        }

        return KeyDecision.Pass;
    }
}
