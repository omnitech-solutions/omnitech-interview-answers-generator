# OpenCluely video — the acceptance spec ("nothing less, nothing more")

Source: the user's recording `~/Desktop/open-cluely.mov` (1920×1080, 106 s, a LeetCode page with
OpenCluely floating over Chrome). Frames, one per 4 s, are in contact sheets 0–6 under the session
scratchpad `vid/sheet-N.jpg`. This file is the written form; the target is **exactly this**.

## What it is
A small set of **translucent dark-grey panels floating over whatever window you are working in**
(the page shows through them; no title bars, rounded corners, no window chrome). There is **no
session setup, no task list, no tabs of tasks, no answer/code "slots", no revision bars, no Auto
toggle, no companion/locality/retention UI.** You press a hotkey; panels fill; you read.

## The four panels

1. **Bar** — a tiny pill at the top centre of the screen (~520×35): camera icon + hotkey hint
   `⌘⇧S`, a mic icon, the current **skill name** (DSA / System Design / Behavioral), and a status
   **dot** (red = interaction mode OFF / recording, green = interaction mode ON). Always visible.

2. **Analysis** (centre-left over the page, ~700×400). Press the capture hotkey → the panel shows
   **"Analyzing ● ●"** centred → it fills with a scrollable formatted analysis:
   problem title ("Koko Eating Bananas Problem Analysis"), **Problem Type**, **Constraints** (as
   small chips), **Input/Output**, **1. Naive Solution (Quick Start)**, … complexity. Right of it,
   a **separate code card**: dark, header label (`PYTHON` / `TEXT`), syntax-highlighted code (and
   a `TEXT` block with a worked example above the code). Capturing a new problem replaces both.

3. **Live Transcription & Chat** (left, ~320×440). Header "Live Transcription & Chat" with a red
   dot while recording. A message list of cards with a timestamp each:
   - system lines (blue-grey): "Recording in Progress. press Alt+R to stop recording.",
     "Session memory has been cleared";
   - **heard speech** (green card): the transcribed question/sentence;
   - **assistant reply** (purple card): "…" while loading, then the formatted answer (bullets,
     bold headings, code);
   - a light **interim line** (italic) above the input while speech is being recognised
     ("OK can you explain the");
   - input "Type a message or transcription…", a red mic button and a send button.
   Speech is continuous while recording: each finished utterance becomes a green card and gets a
   purple reply, using the **current skill** to shape the answer.

4. **Settings** (top right, small): title "Settings", **Quit** (red) and **Close** buttons; section
   "Language & Skills": **Coding Language** dropdown and **Active Skill** dropdown.

## Behaviour
- Hotkeys (global): **⌘⇧S** capture whole screen + analyse; **⌥R** start/stop recording;
  **⌘⇧I** toggle interaction mode; **⌘⇧V** show/hide panels; **⌘⇧C** show/focus chat;
  **⌘⇧\\** clear session memory; **⌘↑ / ⌘↓** change skill (only in interaction mode); **⌘,**
  settings.
- **Interaction mode**: OFF = every panel is click-through (you keep using the page underneath);
  ON = you can scroll, copy, move the panels. The bar dot shows which.
- **Toasts** (bottom-left, large white text over a dark gradient, fade out):
  "Interaction Mode: ON — Green dot, Interact with window like scroll, copy, move" /
  "Interaction Mode: OFF — Red dot shows interaction mode is off";
  "Start/Stop Recording — option + R";
  "Skill changed to - System Design — Look in the small tab above";
  "Current Skill - DSA — Change Skill: Cmd + Arrow Up/Down (Only in interaction mode)".
- Skills (the dropdown, in order): Programming, Data Structures & Algorithms, System Design,
  Behavioral Interview, Data Science, Sales & Business, Presentation Skills, Negotiation,
  DevOps & Infrastructure. The skill changes the style of every answer.
- The screenshot is **the whole main display** (not a chosen window).

## Not built (refused or out of scope)
Stealth / app-icon-and-name disguise / hidden-from-screen-share (ADR-0018: panels stay visible in
screen shares and the footer says so), the Terminal/Activity/Settings tab strip, Azure speech
keys. Studio is the brain: capture → Studio's existing owner-capture + assist + code stages;
heard speech → Studio's existing heard path; the panels only present what Studio returns.
