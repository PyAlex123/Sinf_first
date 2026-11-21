using Sinf.Desktop.Core;
using Xunit;

namespace Sinf.Desktop.Core.Tests;

public class KeyRulesTests
{
    private const int A = 0x41;
    private const int D = 0x44;
    private const int Enter = 0x0D;
    private const int Backspace = 0x08;

    private static KeyDecision Press(int key, bool ctrl = false, bool alt = false, bool shift = false, bool win = false) =>
        KeyRules.Decide(key, ctrl, alt, shift, win);

    [Theory]
    [InlineData(KeyRules.Tab)]
    [InlineData(KeyRules.Escape)]
    [InlineData(KeyRules.F4)]
    [InlineData(KeyRules.Space)]
    public void Alt_combinations_that_leave_the_window_are_swallowed(int key)
    {
        Assert.Equal(KeyDecision.Swallow, Press(key, alt: true));
    }

    [Fact]
    public void Windows_key_and_everything_with_it_is_swallowed()
    {
        Assert.Equal(KeyDecision.Swallow, Press(KeyRules.LeftWin));
        Assert.Equal(KeyDecision.Swallow, Press(KeyRules.RightWin));
        Assert.Equal(KeyDecision.Swallow, Press(D, win: true));
        Assert.Equal(KeyDecision.Swallow, Press(KeyRules.Tab, win: true));
    }

    [Fact]
    public void Start_menu_and_task_manager_shortcuts_are_swallowed()
    {
        Assert.Equal(KeyDecision.Swallow, Press(KeyRules.Escape, ctrl: true));
        Assert.Equal(KeyDecision.Swallow, Press(KeyRules.Escape, ctrl: true, shift: true));
        Assert.Equal(KeyDecision.Swallow, Press(KeyRules.Apps));
        Assert.Equal(KeyDecision.Swallow, Press(KeyRules.F11));
    }

    [Fact]
    public void Only_the_full_combination_asks_for_the_password()
    {
        Assert.Equal(KeyDecision.AskPassword, Press(KeyRules.F12, ctrl: true, alt: true, shift: true));
        Assert.Equal(KeyDecision.Pass, Press(KeyRules.F12, ctrl: true, alt: true));
        Assert.Equal(KeyDecision.Pass, Press(KeyRules.F12));
    }

    [Fact]
    public void Under_attention_every_key_is_swallowed_but_the_way_out()
    {
        Assert.Equal(KeyDecision.Swallow, KeyRules.Decide(A, false, false, false, false, locked: true));
        Assert.Equal(KeyDecision.Swallow, KeyRules.Decide(Enter, false, false, false, false, locked: true));
        Assert.Equal(KeyDecision.Swallow, KeyRules.Decide(Backspace, false, false, true, false, locked: true));
        Assert.Equal(
            KeyDecision.AskPassword,
            KeyRules.Decide(KeyRules.F12, ctrl: true, alt: true, shift: true, win: false, locked: true));
    }

    [Theory]
    [InlineData(A, false, false)]
    [InlineData(A, false, true)]
    [InlineData(Enter, false, false)]
    [InlineData(Backspace, false, false)]
    [InlineData(KeyRules.Tab, false, false)]
    [InlineData(KeyRules.Escape, false, false)]
    public void Typing_in_the_lesson_still_works(int key, bool ctrl, bool shift)
    {
        Assert.Equal(KeyDecision.Pass, Press(key, ctrl: ctrl, shift: shift));
    }
}
