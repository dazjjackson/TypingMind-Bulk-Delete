# TypingMind Bulk Message Delete Extension

This script adds functionality to the TypingMind web interface to allow for the bulk deletion of messages within a chat.

## Features

*   **Toggle Mode:** Adds a small trash can icon button next to the "Chat Info" button in the header to enable/disable bulk delete mode.
*   **Message Selection:** When bulk delete mode is enabled:
    *   Clicking on a message block toggles its selection.
    *   Selected messages are highlighted with a light red background.
    *   The mouse cursor changes to a pointer over message blocks.
*   **Bulk Delete Button:**
    *   A "Delete (X)" button appears in the action button area (near "Regenerate", "New Chat", etc.) when one or more messages are selected.
    *   The button shows the count of currently selected messages.
*   **Two-Step Confirmation:**
    *   Clicking "Delete (X)" changes the button text to "Sure?" and starts a 2-second timer. The button remains red and maintains its width.
    *   Clicking "Sure?" within 2 seconds initiates the deletion process.
    *   If the timer expires or the user clicks elsewhere/deselects messages, the button reverts to "Delete (X)".
*   **Deletion Process:**
    *   The script simulates the necessary UI clicks (More Actions -> Delete -> Sure?) for each selected message.
    *   A delay is added between deleting each message to avoid overwhelming the UI.
    *   The button text updates to show "Deleting... (Y/X)" during the process.
*   **"Done" Status:** After deletion, the button briefly displays "Done (Deleted/Total)" for 1.5 seconds before disappearing (if no messages remain selected).
*   **DOM Monitoring:** Uses a `MutationObserver` to automatically re-apply button states and message click listeners if the TypingMind UI redraws parts of the page.

## How to Use

1.  **Load the Script:** This script is designed to be loaded as a TypingMind extension.
2.  **Toggle Mode:** Click the trash can icon button in the chat header to enable bulk delete mode. The icon will get a subtle red background highlight.
3.  **Select Messages:** Click on the message blocks you want to delete. They will turn light red. Click again to deselect.
4.  **Delete:** Once messages are selected, the "Delete (X)" button will appear in the bottom action bar.
    *   Click "Delete (X)".
    *   Click "Sure?" within 2 seconds to confirm.
5.  **Toggle Off:** Click the trash can icon again to disable bulk delete mode. Selection highlights and the "Delete (X)" button will disappear.

## Important Notes

*   **React Internal Access:** The script uses `__reactFiber` to find message UUIDs. This is an internal React implementation detail and might break if TypingMind significantly changes its frontend structure.
*   **UI Simulation:** Deletion relies on simulating clicks on the existing UI elements. Changes to TypingMind's selectors (`data-element-id`, button text) could break this functionality.
*   **Delays:** Delays (`setTimeout`) are used during UI simulation and status display. These might need adjustment based on system performance or TypingMind responsiveness.
*   **Error Handling:** Basic error handling is included, and errors during the UI simulation for a specific message are logged to the console. The script attempts to continue deleting other selected messages if one fails.
