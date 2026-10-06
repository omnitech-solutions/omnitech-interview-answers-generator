# Native live-session panel cleanup: the owner's brief (verbatim, 2026-10-06)

Source of the visuals: the designer gallery `~/Downloads/AI Assistant Design Overhaul/Native Panel Cleanup.dc.html` (sections: Top toolbar, Main panels, Footer; ignore the Zoom-style board 1b). The owner's component direction:

- Native and Storybook share the SAME components (no native-only copies). Minimise the number of NEW components; prefer configuration-driven variations of existing ones.
- Implement only the components, states and variations that will actually be used.
- Every component used inside the native app must be data/configuration driven, INCLUDING callbacks (passed in), placement and slots, so it can be reused elsewhere.
- A part that is completely custom and does not fit the library may be omitted from the library (say so).
- Every new component or variation is added to Storybook, and a new showcase specifically for the Native App is added that matches the designer gallery view.
- The library is `~/dev/omnitech-solutions/omni-ui-components` (`packages/core/src/<Component>/`: `Component.tsx`, `.types.ts`, `.variants.ts`, `.stories.tsx`, `.factories.tsx`, `index.ts`; Storybook stories under `.storybook/getting-started/`; showcases under `packages/core/src/showcase`).

## The full instructions

Clean up the native live-session panel. Keep every behaviour and shortcut exactly as it is; only change layout, visuals and where state is shown.

### Top toolbar
T1. Merge the "Manual" dropdown into the capture split button
   Now: There's a separate "Manual ▾" pill next to the capture button, and the capture button has a coloured dot (red, green or grey) whose meaning isn't explained.
   Do: Remove the mode pill. In the capture caret menu, add a "When to analyse" section (Manual ⌘⇧S / Auto ⌥⇧U, keeping the current copy) above "Display". Show mode as a tint: neutral = Manual, blue = Auto. Remove the coloured dot. The tooltip names the mode. The click behaviour and ⌥⇧U stay the same.
T2. Show analysing on the capture button
   Now: While analysing, the icon turns into a small square and a second full-width "Capturing the screen" banner appears.
   Do: While a run is active, swap the icon for a progress ring (blue tone). Clicking or pressing ⌘⇧S stops it, the same as today. Delete the banner; progress shows in the Answer panel (M3).
T3. Mic uses Zoom semantics
   Now: When listening, the mic is a red pill with level bars, so "listening" looks like an error. Muted is a grey slash. A lost mic shows as a full-width banner that pushes the panels down.
   Do: Listening: neutral button with a white mic. Muted by you: red slashed mic. Lost or retrying: amber outline and an amber "!" badge at the top-right of the button. The caret menu shows the device list, the status ("Trying again · attempt n") and "Retry now". Remove the "Microphone lost. Trying again." banner. ⌥R is unchanged.
T4. Screen problems get the same badge
   Now: Capture failures and permission loss have no persistent indicator.
   Do: When screen recording permission is missing, the chosen display is disconnected, or the last capture failed: amber outline and "!" badge on the capture button. The caret menu leads with the reason and a fix action, such as "Open System Settings" or "Pick display".
T5. Answer style: no truncation, grouped menu
   Now: The label is cut to "Data Structures & Al…" and the menu is cut off at the bottom (DevOps & Infrastructure is half visible).
   Do: Show the full style name and allow up to 260px before ellipsis, with a tooltip for the full name. Size the menu to the viewport with max-height and internal scroll. Group items under Technical and Conversation, keep a fixed check column, and add a "⌘↑ ⌘↓" hint row.
T6. Panel toggles become one segmented group
   Now: Chat, Answer and Code are three loose circles with a faint active state, so it's hard to tell what's visible.
   Do: Wrap them in one bordered segmented control. Active = filled blue tint, inactive = transparent. The last visible panel can't be turned off (disable it with a tooltip).
T7. Shortcuts menu: one notation, grouped
   Now: Notation is mixed ("Alt+R" in the chat, ⌥R in the menu) and everything is in one flat list.
   Do: Use macOS glyphs everywhere (⌘ ⌥ ⇧). Group under Capture, Listening, View, Answer style and App. Put "Clear session memory" last with a destructive colour. Shortcut bindings are unchanged.
T8. Paused state
   Now: While paused, the toolbar still looks live.
   Do: Capture and mic show dimmed, slashed icons and can't be clicked (tooltip: "Resume to capture"). Answer style, panel toggles, see-through and shortcuts stay usable.
T9. One size system
   Now: Controls vary in height, radius and spacing, and the split chevron has a visible seam.
   Do: All controls are 36px high (52px in labelled mode) with 10px radius and 6px gaps, and separators are 20px tall. Icons are 20px outline, filled only for active or primary actions. Split buttons share one border with a 1px divider.

### Main panels
M1. Stop logging system messages in the transcript
   Now: "Recording in Progress. press Alt+R to stop recording." is appended about every minute and pushes real speech out of view.
   Do: Never write mic or recording status into the transcript; it belongs to the toolbar (T3). The transcript holds only speech turns, your chat messages and one-line capture event chips ("S1 · no question found · 08:33").
M2. Remove the red dot in the transcript header
   Now: A red dot in the panel header duplicates the recording indicator.
   Do: Delete it. The footer record icon is the single "session live" indicator.
M3. One place for analysis progress
   Now: Progress shows in three places at once: the top banner, the step list and a "Capturing the screen…" chat message.
   Do: Keep only the step list in the Answer panel (done ✓ / current ring / pending ○) and put a "Stop ⌘⇧S" button in the Answer header. Remove the banner and the chat message.
M4. "No question found" goes into the header meta
   Now: "No question found in the last capture." sits as loose text in the top-left above an empty state that says "Nothing analysed yet", so the two contradict each other.
   Do: Show "Last capture 08:33 · no question found" as right-aligned meta in the Answer header, plus the event chip in the transcript (M1). The empty state body stays as it is.
M5. Keep the Capture button inside its panel
   Now: When the panels resize, the Capture screenshot button escapes the Answer panel and overlaps the footer.
   Do: Each panel is a flex column (header 40px, body flex:1 with overflow:auto, optional dock). Never position anything absolutely against the window. The empty-state button sits inside the body.
M6. Dock the "To apply" tray inside the Answer panel
   Now: The "To apply (1) + Add screenshot" tray overlaps the footer timer and Pause button.
   Do: Render it as a dock at the bottom of the Answer panel: count, thumbnails, "Add screenshot", "Clear" and a primary "Apply". It only appears while items are pending. The apply behaviour is unchanged.
M7. Consistent panel chrome and empty states
   Now: The Answer empty state uses an icon tile, while Code uses a bare "<>" glyph. Headers differ in height and some are missing.
   Do: Every panel has a 40px header with title, meta and an optional action. Empty states always use a 40px icon tile, an optional title, one line of copy and an optional action. Code waiting copy: "Starts automatically after the approach."
M8. Composer buttons
   Now: The chat mic button is solid red, which reads as "recording" or "danger", and the disabled send button is bright blue.
   Do: The mic is neutral and turns red only while dictating. Send is muted until there's text.
M9. Transcript scrolling
   Now: The top message is cut mid-line, the scrollbar is thick and always visible, and new messages don't stick to the bottom.
   Do: Add a 28px top fade mask and a thin overlay scrollbar. Stick to the bottom; when the user has scrolled up, show a "Jump to latest" pill.
M10. Reflow when panels change
   Now: When the banner appeared or panels toggled, the right panel was cropped and the footer was misaligned.
   Do: The transcript is 330px (minimum 300). Other visible panels share the remaining width equally. The footer always spans the full panel row width. Nothing is cropped at any window width of 900px or more.
M11. See-through keeps text readable
   Now: See-through lowers the opacity of everything, text included.
   Do: Apply the see-through opacity to panel backgrounds only. Text and icons stay at full opacity.

### Footer
F1. Record icon + timer, no "Live" text
   Now: The footer shows "dev ● 2:17:55" on the right, with an empty left side.
   Do: Left side: a filled record icon (red) and a monospace elapsed timer. When paused: an amber pause icon, amber timer and a "Paused" label. Nothing else changes colour.
F2. Replace "dev" with a build tag
   Now: "dev" doesn't say which build is running.
   Do: Development builds only (for example when !app.isPackaged): show "<short sha> · <branch>" in mono after a divider, with the full SHA in the tooltip and click to copy. Hide it in production builds.
F3. One Resume, one primary action
   Now: The paused banner and the footer both show "Resume session", and their play icons differ (one outline, one filled).
   Do: Delete the paused banner. The footer button toggles between "Pause session" (outline, filled pause icon) and "Resume session" (green filled, filled play icon). Pause and resume behaviour is unchanged.
F4. Lighter End session
   Now: A solid red End button competes with Resume.
   Do: Use an outlined red button. The behaviour, including any confirmation, is unchanged.
F5. Nothing floats in the footer
   Now: The Capture button and the To apply tray overlap the footer.
   Do: The footer only contains its own items. See M5 and M6.
F6. No tint on pause
   Now: The paused footer turned muddy yellow.
   Do: The footer background never changes. State is shown only by the icon and timer colour.
