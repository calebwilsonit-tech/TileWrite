# Decide what the pause button does

In a new project every scene starts with this Quick Action (open **Events** to see it):

> When the "pause" button is pressed: open the Pause screen

That is all the pause button does. To change it:
- **Open something else**: pick another screen in the action, or *The screen used as...* a part.
- **Do two things**: add actions to the row (play a sound, write a variable).
- **Only sometimes**: add a condition ("the player is not in a conversation"...).
- **Nothing at all** (a game without a pause menu): delete the row. Back still closes any screen that is open.

The pause button also means **Back** on a screen that is open (Esc, the gamepad's Start or B). Which of the two a press is, is decided in one place: a screen opened by this very press is not also told to go back.

Projects made before this existed keep the older rule, where the button opens Pause by itself and the rule is not shown anywhere. **Project settings, Compatibility, The pause button is a Quick Action...** turns the new way on for such a project (the rows are not added to its scenes for you: add the Quick Action above to the scenes that need it).
