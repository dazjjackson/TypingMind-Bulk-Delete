/**
 * @fileoverview Adds bulk message deletion functionality to the TypingMind interface.
 * Allows users to select multiple messages and delete them in one go,
 * mimicking the application's native single-message delete confirmation flow.
 * Includes a toggle button added near the "Chat Info" button and a "Delete Selected"
 * button that appears in the action button area when messages are selected.
 *
 * @version 1.0.0
 */
(function () {
  "use strict";

  // --- State Variables ---
  /** @type {boolean} Tracks if bulk delete mode is currently active. */
  let bulkDeleteEnabled = false;
  /** @type {Set<string>} Stores the UUIDs of currently selected messages. */
  let selectedMessages = new Set();
  /** @type {boolean} Tracks if the bulk delete button is in the 'Sure?' confirmation state. */
  let isConfirmingBulkDelete = false;
  /** @type {?number} Timer ID for the 'Sure?' confirmation timeout. */
  let bulkDeleteConfirmTimer = null;
  /** @type {boolean} Flag to prevent UI updates during the asynchronous deletion loop. */
  let isBulkDeleting = false;

  // --- UI Element References ---
  /** @type {?HTMLButtonElement} Reference to the toggle button for enabling/disabling bulk delete mode. */
  let toggleButton = null;
  /** @type {?HTMLButtonElement} Reference to the main bulk delete button ('Delete (X)' / 'Sure?'). */
  let bulkDeleteButton = null;

  // -- MutationObserver Variables ---
  /** @type {?MutationObserver} Observer to detect DOM changes and re-apply listeners/buttons. */
  let observer = null;
  /** @type {?number} Timer ID for debouncing mutation observer callbacks. */
  let debounceTimer = null;

  // --- Constants ---
  /** @const {number} Delay in milliseconds for debouncing mutation observer calls. */
  const DEBOUNCE_DELAY = 300;
  /** @const {string} CSS selector for the toolbar where the bulk delete button is added. */
  const TOOLBAR_SELECTOR = '#elements-in-action-buttons';
  /** @const {string} Background color applied to selected messages. */
  const SELECTED_BACKGROUND_COLOR = 'rgba(239, 68, 68, 0.15)'; // Tailwind's red-500 at 15% opacity

  // --- React Internal Access (Fragile) ---
  /**
   * Attempts to find the message data (including UUID) associated with a DOM element
   * by traversing React's internal Fiber nodes. This is fragile and might break
   * with future TypingMind updates.
   * @param {HTMLElement} element The message block DOM element.
   * @returns {{message: ?object, element: HTMLElement}} An object containing the found message data or null, and the original element.
   */
  function findMessageData(element) {
    const keys = Object.keys(element);
    const fiberKey = keys.find(key => key.startsWith('__reactFiber')); // Find the key React uses for Fiber nodes
    if (!fiberKey) return { message: null, element: element }; // Exit if no Fiber node found
    let current = element[fiberKey];
    let depth = 0;
    const maxDepth = 20; // Limit traversal depth to prevent infinite loops
    const data = { message: null, element: element };

    // Traverse up the Fiber tree
    while (current && depth < maxDepth) {
      // Check if the current node's props contain the message object with a UUID
      if (current.memoizedProps?.message?.uuid) {
        data.message = current.memoizedProps.message;
        break; // Found the message data
      }
      current = current.return; // Move to the parent node
      depth++;
    }
    return data; // Return found data or null
  }

  // --- UI Interaction Helpers ---
  /**
   * Finds a button within a parent element based on its visible text content.
   * Prioritizes buttons with role="menuitem".
   * @param {?HTMLElement} parentElement The container element to search within.
   * @param {string} text The text content to match (case-insensitive).
   * @returns {?HTMLButtonElement} The found button element or null.
   */
  function findButtonByText(parentElement, text) {
    if (!parentElement || parentElement.offsetParent === null) return null; // Ensure parent is valid and visible
    const lowerText = text.toLowerCase();
    // Prioritize menu items
    let button = Array.from(parentElement.querySelectorAll('button[role="menuitem"]'))
      .find(el => el.textContent?.trim().toLowerCase() === lowerText);
    // Fallback to any button if no menu item matches
    if (!button) {
      button = Array.from(parentElement.querySelectorAll('button'))
        .find(el => el.textContent?.trim().toLowerCase() === lowerText);
    }
    // Return button only if found and visible
    return (button && button.offsetParent !== null) ? button : null;
  }

  /**
   * Waits for an element selected by a function to appear in the DOM and be visible.
   * @param {Function} selectorFn A function that attempts to select the element.
   * @param {Array} [args=[]] Arguments to pass to the selector function.
   * @param {number} [timeout=1500] Maximum time to wait in milliseconds.
   * @returns {Promise<HTMLElement>} A promise that resolves with the element or rejects on timeout.
   */
  function waitForElement(selectorFn, args = [], timeout = 1500) {
    return new Promise((resolve, reject) => {
      const startTime = Date.now();
      const interval = 50; // Check frequency
      const check = () => {
        let element = null;
        try {
          element = selectorFn.apply(null, args); // Execute the selector function
        } catch (e) { /* Ignore errors during selection */ }

        // Check if element exists and is visible (offsetParent is null for hidden elements)
        if (element && element.offsetParent !== null) {
          resolve(element); // Element found and visible
        } else if (Date.now() - startTime > timeout) {
          // Timeout reached
          reject(new Error(`[BulkDelete] Element via selectorFn not found or not visible after ${timeout}ms`));
        } else {
          // Element not found/visible yet, check again after interval
          setTimeout(check, interval);
        }
      };
      check(); // Start checking
    });
  }

  /**
   * Simulates the UI interaction required to delete a single message.
   * Scrolls to the message, triggers hover, clicks 'More Actions', 'Delete', and 'Sure?'.
   * @param {HTMLElement} messageElement The DOM element of the message block.
   * @param {string} uuid The UUID of the message being deleted (for logging).
   * @returns {Promise<boolean>} True if the deletion UI interaction sequence completed successfully, false otherwise.
   */
  async function deleteMessageViaUI(messageElement, uuid) {
      const hoverMenuContainerSelector = 'div.dark\\:bg-slate-950.absolute.items-center'; // Selector for the hover menu

      try {
          if (!messageElement?.isConnected) throw new Error(`Target element not connected.`); // Check if element is still in DOM

          // Ensure the hover menu area is potentially visible
          messageElement.scrollIntoView({ behavior: 'instant', block: 'end' });
          await new Promise(resolve => setTimeout(resolve, 100)); // Short delay for scroll

          // Force the hover menu to be visible if it exists (sometimes hover state is tricky)
          const hoverMenuContainer = messageElement.querySelector(hoverMenuContainerSelector);
          if (hoverMenuContainer) {
              hoverMenuContainer.classList.remove('hidden'); // Ensure it's not hidden by default class
              hoverMenuContainer.classList.add('flex'); // Ensure it uses flex display
              await new Promise(resolve => setTimeout(resolve, 50)); // Short delay for potential transition
          }

          // Find and click the 'More Actions' (...) button
          const actionsButton = messageElement.querySelector('[data-element-id="more-actions-menu-button"]');
          if (!actionsButton || actionsButton.offsetParent === null) throw new Error(`'More Actions' button not found or not visible.`);
          actionsButton.click();
          await new Promise(resolve => setTimeout(resolve, 100)); // Wait for menu to open

          // Wait for the action menu itself to appear
          const menuElement = await waitForElement(() => document.querySelector('div[role="menu"][data-headlessui-state="open"]'), [], 1000);
          // Find and click the 'Delete' button within the menu
          const deleteButton = await waitForElement(findButtonByText, [menuElement, 'Delete']);
          deleteButton.click();
          await new Promise(resolve => setTimeout(resolve, 100)); // Wait for 'Sure?' button to appear

          // Find and click the 'Sure?' confirmation button
          const confirmButton = await waitForElement(findButtonByText, [menuElement, 'Sure?'], 500); // Shorter timeout for confirmation
          confirmButton.click();

          return true; // Sequence successful
      } catch (error) {
          // Log errors encountered during the UI simulation
          console.error(`[BulkDelete - ${uuid}] Error simulating delete:`, error.message);
          return false; // Sequence failed
      }
  }

  // --- Core Bulk Delete Logic ---
  /**
   * Handles click events on message blocks when bulk delete mode is enabled.
   * Toggles the selection state of the clicked message and updates the UI.
   * @param {MouseEvent} event The click event object.
   */
  function handleMessageClick(event) {
    const block = event.currentTarget; // The message block element that was clicked
    const messageUuid = block.dataset.messageUuid; // Get UUID stored in data attribute
    if (!messageUuid) return; // Ignore if UUID couldn't be determined

    // If user clicks a message while delete confirmation is active, cancel confirmation
    if (isConfirmingBulkDelete) {
      resetBulkDeleteConfirmation();
    }

    // Toggle selection state
    if (selectedMessages.has(messageUuid)) {
      selectedMessages.delete(messageUuid); // Remove from set
      block.style.backgroundColor = ''; // Remove selection highlight
    } else {
      selectedMessages.add(messageUuid); // Add to set
      block.style.backgroundColor = SELECTED_BACKGROUND_COLOR; // Apply selection highlight
    }
    updateBulkDeleteButtonUI(); // Update the delete button's state (count, visibility)
  }

  /**
   * Attaches click listeners and necessary data attributes to message blocks
   * to enable selection functionality. Also ensures the bulk delete button exists.
   */
  function enableClickSelection() {
    const responseBlocks = document.querySelectorAll('[data-element-id="response-block"]');
    responseBlocks.forEach((block) => {
      const existingUuid = block.dataset.messageUuid;
      const listenerAlreadyAdded = block.dataset.bulkDeleteEnabled === 'true';
      // Try to find UUID if not already stored or if element might be new
      let messageUuid = existingUuid || findMessageData(block).message?.uuid;
      if (!messageUuid) return; // Skip if no UUID found

      // Store UUID if not already present
      if (!existingUuid) block.dataset.messageUuid = messageUuid;
      // Add listener if not already added for this element instance
      if (!listenerAlreadyAdded) {
        block.addEventListener('click', handleMessageClick);
        block.dataset.bulkDeleteEnabled = 'true'; // Mark as having listener attached
      }
      // Apply visual cues for selection mode
      block.style.cursor = 'pointer';
      // Ensure background reflects current selection state
      block.style.backgroundColor = selectedMessages.has(messageUuid) ? SELECTED_BACKGROUND_COLOR : '';
    });
    ensureBulkDeleteButtonExists(); // Make sure the delete button is visible if needed
    updateBulkDeleteButtonUI(); // Update delete button text/state
  }

  /**
   * Removes click listeners and selection-related styles/attributes from message blocks.
   */
  function removeMessageSelectionListeners() {
    document.querySelectorAll('[data-element-id="response-block"][data-bulk-delete-enabled="true"]').forEach(block => {
      block.removeEventListener('click', handleMessageClick);
      block.style.cursor = ''; // Reset cursor
      block.style.backgroundColor = ''; // Reset background
      // Clean up data attributes
      delete block.dataset.bulkDeleteEnabled;
      // Keep messageUuid for potential re-enabling? Maybe remove if causing issues.
      // delete block.dataset.messageUuid;
    });
  }

  /**
   * Disables the bulk selection mode by removing listeners and the delete button.
   */
  function disableClickSelection() {
    removeMessageSelectionListeners();
    // Remove the bulk delete button if it exists
    if (bulkDeleteButton) {
      bulkDeleteButton.remove();
      bulkDeleteButton = null;
    }
  }

  /**
   * Toggles the bulk delete mode on or off.
   */
  function toggleBulkDeleteMode() {
    bulkDeleteEnabled = !bulkDeleteEnabled; // Flip the state
    if (bulkDeleteEnabled) {
      enableClickSelection(); // Enable mode: add listeners, show button
    } else {
      // Disable mode: cancel confirmation, remove listeners, hide button, clear selection
      if (isConfirmingBulkDelete) {
        resetBulkDeleteConfirmation();
      }
      disableClickSelection();
      selectedMessages.clear();
    }
    updateToggleButtonVisualState(); // Update toggle button appearance
  }

  // --- UI Element Management ---
  /**
   * Updates the text, visibility, and disabled state of the bulk delete button
   * based on the current selection count and confirmation state.
   * Does nothing if the deletion process is actively running (`isBulkDeleting`).
   */
  function updateBulkDeleteButtonUI() {
    // Ensure button exists if mode is enabled, otherwise ignore.
    if (bulkDeleteEnabled && (!bulkDeleteButton || !bulkDeleteButton.isConnected)) {
      ensureBulkDeleteButtonExists();
    }
    // If button still doesn't exist (e.g., toolbar not found), exit.
    if (!bulkDeleteButton || !bulkDeleteButton.isConnected) return;
    // Prevent UI updates if the deletion loop is active.
    if (isBulkDeleting) return;

    const selectedCount = selectedMessages.size;
    const buttonTextSpan = bulkDeleteButton.querySelector('span');

    // Button should be visible if messages are selected OR if we are in the confirmation step
    // Determine visibility: Show if messages are selected OR if confirming delete
    bulkDeleteButton.style.display = (selectedCount > 0 || isConfirmingBulkDelete) ? 'inline-flex' : 'none';

    // Update button text
    if (buttonTextSpan) {
        buttonTextSpan.textContent = isConfirmingBulkDelete ? 'Sure?' : `Delete (${selectedCount})`;
    }

    // Update disabled state: Disable if no messages selected AND not in confirmation mode
    bulkDeleteButton.disabled = selectedCount === 0 && !isConfirmingBulkDelete;
  }

  /**
   * Creates and injects the bulk delete button into the UI if it doesn't exist or isn't connected.
   * Finds the target toolbar using `TOOLBAR_SELECTOR`.
   */
  function ensureBulkDeleteButtonExists() {
    const toolbar = document.querySelector(TOOLBAR_SELECTOR);
    // Exit if the target toolbar isn't found
    if (!toolbar) {
      if (bulkDeleteButton) bulkDeleteButton = null; // Clear reference if toolbar disappeared
      return;
    }
    // Exit if button already exists and is in the correct place
    if (bulkDeleteButton?.isConnected && bulkDeleteButton.parentElement === toolbar) return;
    // Remove existing button reference if it's disconnected or elsewhere
    if (bulkDeleteButton) bulkDeleteButton.remove();

    // Create the button element
    bulkDeleteButton = document.createElement('button');
    bulkDeleteButton.id = 'bulk-delete-button';
    // Apply necessary classes for styling (matches TypingMind's buttons)
    bulkDeleteButton.className = `pl-2.5 pr-3.5 inline-flex items-center justify-center rounded-lg h-9 transition-all group font-semibold text-xs focus-visible:outline-offset-2 focus-visible:outline-red-500 bg-red-600 text-white hover:bg-red-700 active:bg-red-800 disabled:bg-slate-400 dark:disabled:bg-slate-600 disabled:text-slate-100 dark:disabled:text-slate-400 disabled:cursor-not-allowed`;
    // Tooltip attributes
    bulkDeleteButton.dataset.tooltipId = "global";
    bulkDeleteButton.dataset.tooltipContent = "Delete Selected Messages";
    // Initial content (icon + text span)
    bulkDeleteButton.innerHTML = `<svg class="w-[18px] h-[18px] transition-all shrink-0" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg" fill="currentColor"><path d="m13.474,7.25l-.374,7.105c-.056,1.062-.934,1.895-1.997,1.895h-4.205c-1.064,0-1.941-.833-1.997-1.895l-.374-7.105" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"></path><path d="m6.75,4.75v-2c0-.552.448-1,1-1h2.5c.552,0,1,.448,1,1v2" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"></path><line fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" x1="2.75" x2="15.25" y1="4.75" y2="4.75"></line></svg><span class="antialiased ml-1.5 text-center text-sm font-semibold leading-5">Delete (0)</span>`;
    // Attach click handler
    bulkDeleteButton.addEventListener('click', handleBulkDeleteExecution);
    // Append to the toolbar
    toolbar.appendChild(bulkDeleteButton);
    updateBulkDeleteButtonUI(); // Set initial state (likely hidden)
  }

  /**
   * Resets the bulk delete confirmation state (clears timer, resets button appearance).
   * Called when the timer expires, selection changes, or mode is toggled off.
   */
  function resetBulkDeleteConfirmation() {
    if (!bulkDeleteButton || !bulkDeleteButton.isConnected) return;
    clearTimeout(bulkDeleteConfirmTimer); // Clear the confirmation timer
    bulkDeleteConfirmTimer = null;
    isConfirmingBulkDelete = false; // Reset confirmation flag
    bulkDeleteButton.style.width = ''; // Reset dynamic width
    // Ensure text color is white (it should be, but double-check)
    if (!bulkDeleteButton.classList.contains('text-white')) {
        bulkDeleteButton.classList.add('text-white');
    }
    // Update button text and disabled state based on current selection
    const buttonTextSpan = bulkDeleteButton.querySelector('span');
    if (buttonTextSpan) buttonTextSpan.textContent = `Delete (${selectedMessages.size})`;
    bulkDeleteButton.disabled = selectedMessages.size === 0;
    // Update visibility (will hide if selectedMessages is empty)
    updateBulkDeleteButtonUI();
  }

  /**
   * Handles clicks on the bulk delete button. Manages the two-step confirmation
   * process and triggers the deletion loop.
   */
  async function handleBulkDeleteExecution() {
    if (!bulkDeleteButton || !bulkDeleteButton.isConnected) return;
    const buttonTextSpan = bulkDeleteButton.querySelector('span'); // Get text span reference

    // Ignore clicks if button is disabled (unless in confirmation state, where it shouldn't be disabled)
    if (bulkDeleteButton.disabled && !isConfirmingBulkDelete) return;
    const selectedUuids = Array.from(selectedMessages);
    // Ignore if no messages selected and not already confirming
    if (selectedUuids.length === 0 && !isConfirmingBulkDelete) return;


    if (!isConfirmingBulkDelete) {
      // --- First Click: Enter Confirmation State ---
      isConfirmingBulkDelete = true;
      // Capture current width and set it explicitly to prevent resize
      const currentWidth = getComputedStyle(bulkDeleteButton).width;
      bulkDeleteButton.style.width = currentWidth;
      // Update text to 'Sure?'
      if (buttonTextSpan) buttonTextSpan.textContent = 'Sure?';
      // Ensure button remains visible during confirmation
      bulkDeleteButton.style.display = 'inline-flex';

      // Start timer to automatically cancel confirmation after 2 seconds
      bulkDeleteConfirmTimer = setTimeout(() => {
        resetBulkDeleteConfirmation(); // Reset if timer expires
      }, 2000);

    } else {
      // --- Second Click: Execute Deletion ---
      resetBulkDeleteConfirmation(); // Reset confirmation state immediately

      isBulkDeleting = true; // Set flag to block UI updates during deletion
      bulkDeleteButton.disabled = true; // Disable button during operation
      if (buttonTextSpan) buttonTextSpan.textContent = 'Deleting...'; // Update text

      let deletedCount = 0;
      let failedCount = 0;
      // Get message elements, filter out nulls, sort by document order (important for UI stability)
      const sortedElements = selectedUuids
          .map(uuid => document.querySelector(`[data-element-id="response-block"][data-message-uuid="${uuid}"]`))
          .filter(el => el !== null)
          .sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) ? -1 : 1);

      const totalToDelete = sortedElements.length;

      // Process deletions in reverse document order to minimize UI shifts affecting subsequent elements
      for (const element of sortedElements.reverse()) {
          const uuid = element.dataset.messageUuid;
        // Update button text to show progress
        const currentProgress = deletedCount + failedCount + 1;
        if (buttonTextSpan) buttonTextSpan.textContent = `Deleting... (${currentProgress}/${totalToDelete})`;

        // Attempt to delete the message via UI simulation
        if (await deleteMessageViaUI(element, uuid)) {
          deletedCount++;
          selectedMessages.delete(uuid); // Remove from selection set on success
        } else {
          failedCount++;
          // If deletion failed but element still exists, reset its appearance
          if (element?.isConnected) {
             element.style.backgroundColor = '';
             if (bulkDeleteEnabled) element.style.cursor = 'pointer';
          }
          // Still remove from selection set even if delete failed, to avoid retrying
          selectedMessages.delete(uuid);
        }

        // Add a delay between deleting items to avoid overwhelming the UI/rate limits
        const delayBetweenItems = 1500; // Adjust delay as needed
        if (deletedCount + failedCount < totalToDelete) {
          await new Promise(resolve => setTimeout(resolve, delayBetweenItems));
        }
      }

      // --- Post-Deletion Handling ---
      // Re-enable button after deletion loop completes BEFORE setting text/delay
      if (bulkDeleteButton?.isConnected) {
         bulkDeleteButton.disabled = false; // Re-enable
      }

      // --- Corrected "Done" Status Logic ---
      const showDoneStatus = true; // Set to false to disable "Done" message

      if (showDoneStatus && buttonTextSpan && bulkDeleteButton?.isConnected) {
         // Show "Done" status
         buttonTextSpan.textContent = `Done (${deletedCount}/${totalToDelete})`;
         bulkDeleteButton.style.display = 'inline-flex'; // Force visible

         // After delay, clear flag and update UI
         setTimeout(() => {
           isBulkDeleting = false; // Clear flag *after* delay
           if (bulkDeleteButton?.isConnected) {
                updateBulkDeleteButtonUI(); // Update text/visibility (will likely hide button)
           }
           // Optionally toggle off mode after showing status
           // if (bulkDeleteEnabled) toggleBulkDeleteMode();
         }, 1500);

      } else {
        // If not showing "Done" status, clear flag and update UI immediately
        isBulkDeleting = false; // Clear flag now
        if (bulkDeleteButton?.isConnected) {
            updateBulkDeleteButtonUI(); // Update UI immediately
        }
        // Optionally toggle off mode immediately
        // if (bulkDeleteEnabled) toggleBulkDeleteMode();
      }
      // --- End Corrected Logic ---
    }
  }

  /**
   * Updates the visual state (background highlight) of the toggle button.
   */
  function updateToggleButtonVisualState() {
    if (toggleButton?.isConnected) {
      const span = toggleButton.querySelector('span'); // The span containing the SVG
      if (span) {
        // Apply a subtle background when enabled, remove when disabled
        span.style.backgroundColor = bulkDeleteEnabled ? 'rgba(239, 68, 68, 0.2)' : ''; // Red tint
      }
    }
  }

  /**
   * Creates and injects the bulk delete toggle button next to the "Chat Info" button
   * if it doesn't already exist or isn't connected.
   */
  function ensureToggleButtonExists() {
    const wasDisconnected = (toggleButton && !toggleButton.isConnected);
    if (toggleButton?.isConnected) return; // Already exists and connected

    // Find the anchor point ("Chat Info" button)
    const chatInfoButton = document.querySelector('button[data-tooltip-content="Chat Info"]');
    if (chatInfoButton?.parentNode) { // Ensure anchor and its parent exist
      // Create the button if it's the first time
      if (!toggleButton) {
        toggleButton = document.createElement('button');
        toggleButton.id = 'bulk-delete-toggle-button';
        // Inner HTML includes SVG icon and accessible title
        toggleButton.innerHTML = `<span class="relative block text-gray-400 hover:text-gray-500 dark:hover:text-white/80 hover:bg-black/5 dark:hover:bg-white/20 rounded-md p-1.5 transition-colors"><svg class="w-5 h-5 md:w-4 md:h-4 flex-shrink-0" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><g fill="currentColor"><path d="m13.474,7.25l-.374,7.105c-.056,1.062-.934,1.895-1.997,1.895h-4.205c-1.064,0-1.941-.833-1.997-1.895l-.374-7.105" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"></path><path d="m6.75,4.75v-2c0-.552.448-1,1-1h2.5c.552,0,1,.448,1,1v2" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"></path><line fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" x1="2.75" x2="15.25" y1="4.75" y2="4.75"></line></g></svg><title>Toggle Bulk Message Delete</title></span>`;
        // Basic styling to make it look like other header buttons
        toggleButton.style.cssText = `background: none; border: none; cursor: pointer; margin-left: 4px; padding: 0; line-height: 0;`;
        toggleButton.addEventListener('click', toggleBulkDeleteMode);
      }
      // Insert the toggle button after the "Chat Info" button
      chatInfoButton.parentNode.insertBefore(toggleButton, chatInfoButton.nextSibling);

      // If the button was re-added after being disconnected, reset the mode state
      if (wasDisconnected && bulkDeleteEnabled) {
        bulkDeleteEnabled = false;
        disableClickSelection();
        selectedMessages.clear();
      }
      updateToggleButtonVisualState(); // Set initial visual state
    }
  }

  /**
   * Debounced handler for MutationObserver callbacks. Ensures UI elements
   * (toggle button, delete button, message listeners) are correctly
   * present or removed based on the `bulkDeleteEnabled` state after DOM changes settle.
   * @param {MutationRecord[]} mutationsList List of mutations observed.
   */
  const handleMutations = (mutationsList) => {
    clearTimeout(debounceTimer); // Clear previous debounce timer
    // Set a new timer to run the update logic after DEBOUNCE_DELAY
    debounceTimer = setTimeout(() => {
      ensureToggleButtonExists(); // Always ensure toggle button is present
      if (bulkDeleteEnabled) {
        // If mode is enabled, ensure delete button exists and listeners are attached
        ensureBulkDeleteButtonExists();
        enableClickSelection(); // Re-applies listeners/styles to potentially new/changed messages
      } else {
        // If mode is disabled, ensure delete button is removed and listeners are detached
        if (bulkDeleteButton?.isConnected) {
          bulkDeleteButton.remove();
          bulkDeleteButton = null;
        }
        removeMessageSelectionListeners();
      }
    }, DEBOUNCE_DELAY);
  };

  // --- Initialization function ---
  /**
   * Sets up the bulk delete functionality by ensuring the toggle button exists
   * and starting the MutationObserver to watch for DOM changes.
   */
  function initializeBulkDelete() {
    ensureToggleButtonExists(); // Add the toggle button initially

    const targetNode = document.querySelector('main'); // Target the main content area
    if (!observer) {
      // Create observer only once
      observer = new MutationObserver(handleMutations);
    }

    if (targetNode) {
      // Configuration for the observer (watch for additions/removals in the subtree)
      const config = { childList: true, subtree: true };
      try {
        observer.disconnect(); // Disconnect previous observer instance if any
        observer.observe(targetNode, config); // Start observing
      } catch (error) {
        console.error("[BulkDelete] Failed to start MutationObserver:", error);
      }
    } else {
      console.warn("[BulkDelete] Could not find target node ('main') for MutationObserver.");
    }
  }

  // --- Script Execution ---
  // Wait for the DOM to be ready before initializing
  if (document.readyState === "complete" || document.readyState === "interactive") {
    initializeBulkDelete();
  } else {
    document.addEventListener("DOMContentLoaded", initializeBulkDelete);
  }

  console.log("[BulkDelete] Initialized TypingMind Bulk Delete extension.");

})();
