# OpenCluely reference study (code-grounded, for Studio implementers)

Status: research input, not a decision. Source: TechyCSR/OpenCluely `main`, read at
`/private/tmp/claude-501/-Users-desoleary-dev-omnitech-solutions-omnitech-active-session/a2423c52-6dea-4b0c-8098-9a6f1c9780d9/scratchpad/opencluely`.
Purpose: copy the approach (floating panels, hands-free listening, screenshot assist, streamed
answers), not the code, and stop repeating its mistakes. We refuse its concealment features (section 8).

Citation keys (all `path:line` under the download root): MAIN=`main.js`, PRE=`preload.js`,
WM=`src/managers/window.manager.js`, SESS=`src/managers/session.manager.js`,
SPEECH=`src/services/speech.service.js`, LLM=`src/services/llm.service.js`,
CAP=`src/services/capture.service.js`, MW=`src/ui/main-window.js`, CW=`src/ui/chat-window.js`,
SW=`src/ui/settings-window.js`, PL=`prompt-loader.js`, CFG=`src/core/config.js`, IDX=`index.html`.

Coverage gap: the download omits `chat.html`, `llm-response.html`, `onboarding.html`, `src/core/logger.js`,
`first-run.js`, `whisper-installer.js`, `whisper-worker.service.js` (WM:44-81 references the HTML files).
The response-panel renderer is therefore inferred from WM and PRE channels, not read.
There is no "Auto mode" in OpenCluely. Its nearest equivalent is the VAD-driven continuous listening
plus 800 ms coalescing plus an LLM prompt that decides whether the speech deserves an answer.

## 1. Window architecture

Four persistent windows created hidden at startup (WM:103-141), plus a first-run wizard (WM:1360-1380).
`skills` is referenced (WM:1034, WM:1647, MAIN:559) but never defined, so those paths are dead.

| Window | Size | File | Notes |
|---|---|---|---|
| `main` (command bar) | 520x35 content, minWidth 60, maxWidth 520 (WM:41-45, WM:350-353) | index.html | Always visible by default. Height locked, width resizable (WM:493-514). Content-driven resize through IPC `resize-window` (MAIN:564-581, MW:241-266). |
| `chat` | 500x700 (WM:47-52) | chat.html | Hidden at creation (WM:233-236). Shown on mic start (WM:1795-1801, MAIN:968). |
| `llmResponse` | 840x480 (WM:53-59) | llm-response.html | Hidden until loading or answer. Content-fit resize `expand-llm-window` (WM:1397-1442): width `clamp(avgLineLength*8, 500, 0.8*screen)`, height `clamp(lines*25+100, 300, 0.8*screen)`. |
| `settings` | 400x380 (WM:60-76) | settings.html | Frameless, not closable by OS, `type: 'panel'` on macOS (WM:299-319). |
| `onboarding` | 560x680 (WM:77-93) | onboarding.html | First run only. |

Exact flags (WM:273-294 base, then per type):
- Base: `show:false`, `skipTaskbar:true`, `alwaysOnTop:true`, `visibleOnAllWorkspaces:true`, `fullscreenable:false`,
  macOS `level:'floating'`, `backgroundThrottling:false`, `contextIsolation:true`, `nodeIntegration:false`, `devTools:true`.
- main/llmResponse/chat/settings: `frame:false`, `transparent:true`, `backgroundColor:'#00000000'`, `hasShadow:false`
  (chat `true`), `minimizable/maximizable:false`, `closable:false`, macOS `titleBarStyle:'hiddenInset'` with
  `trafficLightPosition:{-100,-100}` and `acceptFirstMouse:true` (WM:341-413). Only settings and onboarding use
  macOS `type:'panel'` (WM:314-318, WM:335-339). The main bar, chat and response are NOT panels.
- `kiosk:false`, `simpleFullscreen:false` (WM:444-445). `minimize` is vetoed (WM:914-917).
- Drag: the bar's `.command-tab` is `-webkit-app-region: drag`, items `no-drag` (IDX:35, IDX:54). No other window has a drag region in the files we have.

Stay-on-top (re-asserted aggressively, and inconsistently):
- Primary call `setAlwaysOnTop(true,'screen-saver',2)` with fallbacks pop-up-menu then floating then plain (WM:148-156, WM:837-846).
- `applyStealthMeasures` walks screen-saver, pop-up-menu, modal-panel, floating (WM:546-569), toggles off then on after 200 ms (WM:572-586).
- Re-asserted on `blur` (50/200/500 ms), `show` (50/200), `focus`, `restore` (WM:659-676), plus a 3 s `setInterval` per window (WM:679-685).
- `toggleInteraction` re-runs a pop-up-menu then floating then screen-saver ladder across 0/100/200 ms (WM:1137-1166).
- `setVisibleOnAllWorkspaces(true,{visibleOnFullScreen:true})` (WM:621). The WM source itself notes that removed enforcement
  methods "were causing flickering" (WM:1713-1719).

Show/hide/switch:
- `showOnCurrentDesktop` (WM:826-885) is the only show path: `hide()`, set all-workspaces, set level, after 50 ms `show()` + `focus()`,
  re-assert at +100 ms, and at +300 ms revert `visibleOnAllWorkspaces(false)` for every window except the response window.
  Consequence: the bar and chat stop following the user across Spaces; the response window does.
- `toggleVisibility` (Cmd/Ctrl+Shift+V) hides/shows all except `llmResponse` (WM:1056-1102). Chat toggles via `switchToWindow('chat')`:
  if chat is visible it hides instead (WM:1028-1032).
- Response flow: `showLLMLoading` (WM:1306-1327) then `showLLMResponse` (WM:1259-1304): send IPC `show-loading` or `display-llm-response`,
  `showOnCurrentDesktop`, then `positionBoundWindows`.

Positioning:
- Bound column layout (default `bindWindows=true`, `windowGap=10`, WM:34-37): bar at top-center, `topMargin=20`; response directly below at `y = barY + barH + gap`,
  both centered on the work area of the active display (WM:729-775). Chat is separate, top-right with 50 px margin (WM:712).
- `moveBoundWindows(dx,dy)` is only used by Cmd+Arrows (20 px) in click-through mode and clamps to the work area (WM:778-824).
- Positions are never persisted. Every answer re-snaps the column to top-center (WM:1294-1296, WM:1318-1321), erasing any manual placement.

Multi-display (WM:1549-1686): `currentDisplay` is the display nearest the cursor, polled every 2 s (WM:1570-1572). On change, or 500 ms after
`display-added/removed/metrics-changed` (WM:1583-1587), every window is repositioned to that display's top and re-shown. Screenshots
always use the primary display (section 4), so panel display and captured display can differ.

Interaction ("click-through") mode: `setInteractive` applies `setIgnoreMouseEvents(true,{forward:true})` to ALL windows when off,
`false` when on, and pushes IPC `interaction-mode-changed` (WM:1104-1125). Default on (WM:10, WM:126). Applied at creation too (WM:475-480).
Status dot: green pulsing = interactive, red = click-through (IDX:125-136). The bar renderer starts as non-interactive until it asks the
main process (MW:11, MW:92-113), so first paint shows red then flips.

## 2. Hotkeys

Registered once in `setupGlobalShortcuts` after windows exist (MAIN:391-417) with `globalShortcut.register`. Success is only logged
(MAIN:415). Unregistered only at quit (MAIN:897, MAIN:937, MAIN:1562). Never gated by session state. `CommandOrControl` = Cmd on macOS.

| Accelerator | Action | Gating |
|---|---|---|
| Cmd+Shift+S | `triggerScreenshotOCR`: capture and analyze (MAIN:393, MAIN:1068) | none; drops if app not ready |
| Cmd+Shift+V | toggle all windows except response (MAIN:394, WM:1090) | no-op while `isScreenBeingShared` |
| Cmd+Shift+I and Alt+A | toggle click-through (MAIN:395, MAIN:399) | none |
| Cmd+Shift+C | toggle chat window (MAIN:396, WM:1028) | none |
| Cmd+Shift+\ | clear session memory (MAIN:397, MAIN:976) | none |
| Cmd+, | open settings (MAIN:398) | none |
| Alt+R | start/stop listening (MAIN:400, MAIN:947) | refuses if speech unavailable, broadcasts "Speech recognition unavailable" (MAIN:948-956) |
| Cmd+Shift+T, Cmd+Shift+Alt+T | force or test always-on-top (MAIN:401-405) | debug |
| Cmd+Up / Cmd+Down | interactive: previous/next skill (no-op, one skill); click-through: move column up/down 20 px (MAIN:986-1008) | reads `getWindowStats().isInteractive` (MAIN:987) |
| Cmd+Left / Cmd+Right | interactive: nothing but the key is still swallowed; click-through: move left/right 20 px (MAIN:1010-1028) | same |

Duplicates in renderers (can double-fire when a window has focus): Alt+R (MW:470-480, CW:215-220), Cmd+Arrows (MW:558-575), Cmd+, (MW:1117-1124).
The chat greeting claims Cmd+R (CW:28) but the real key is Alt+R. Hint text for the user is the popover table (IDX:389-450).

How click-through gating works: arrow keys change meaning by mode (above); the mic button is `disabled` unless interactive (MW:210); screenshot, skill,
settings and info clicks check `isInteractive` first (MW:285-289, MW:292-311, MW:379). Global hotkeys keep working in click-through, which is the escape hatch.

## 3. Speech and listening

Provider: `azure` (Speech SDK) or `whisper` (local CLI or persistent Python worker); chosen from settings/env, Azure only if both key and region exist, else whisper (SPEECH:1229-1244).
Capture:
- macOS and Windows: the renderer opens `getUserMedia({audio:{echoCancellation,noiseSuppression,autoGainControl,sampleRate 16000}})`, a 16 kHz
  `AudioContext`, a `ScriptProcessorNode` of 4096 samples (about 256 ms), converts Float32 to Int16 LE and sends each chunk over IPC `audio-chunk`
  (MW:683-714, MAIN:490-494, PRE:12). The renderer starts only after the `recording-started` event (MW:644-663). This is mic only. There is no system-audio capture.
- Linux: `node-record-lpcm16` with arecord/sox, 16 kHz mono (SPEECH:1665-1741). The gate is SPEECH:715; it must match MW:655-658.
- Azure: PCM is written to a push stream (SPEECH:1795-1800).

Continuous recording, Whisper VAD (the default, SPEECH:824-928, thresholds SPEECH:1301-1319, CFG:67-91):
- Energy VAD on RMS of each chunk, adaptive noise floor (EMA 0.95/0.05), hysteresis: enter = max(0.008, floor*2.5), exit = max(0.0056, floor*1.6) (SPEECH:863-872).
- Pre-roll 300 ms kept before onset; trailing silence 700 ms ends an utterance; minimum speech 350 ms else discarded as noise; hard cap 15 000 ms.
- Watchdog every 500 ms flushes if the mic stalls mid-utterance (more than 1500 ms without a chunk) or the cap is hit (SPEECH:757-784).
- Flush writes a WAV and runs Whisper once per utterance (SPEECH:1883-2005). Only one transcription runs at a time. Requests during a run set `pendingFlush`/`pendingFinal`
  and run when the current one ends (SPEECH:1809-1851).
- Results: exact-match "hallucination" filter drops phrases like "thank you", "you", "okay", "so" (SPEECH:1859-1881). Survivors emit `transcription`. Whisper emits NO interim text.
- Manual mode (`WHISPER_CAPTURE_MODE=manual`): buffer until stop, hard cap 90 s, one transcript on stop (SPEECH:829-841, SPEECH:1345-1348, MAIN:1251-1254).
- Stop: `isRecording=false`, emit `recording-stopped`, set `isProcessingAudio`, flush a final segment. A new start is refused with a status line while that runs (SPEECH:556-559, SPEECH:947-1017).

Azure path: `recognizing` emits `interim-transcription`, `recognized` emits `transcription` (SPEECH:604-622). Silence timeouts: initial 5000, end 2000, segmentation 2000 ms (SPEECH:486-488).
`canceled` maps error text to friendly messages and then calls `stopRecording` (SPEECH:624-647). `sessionStopped` also stops (SPEECH:653). There is no auto-restart:
`retryCount`/`maxRetries` are declared and never used (SPEECH:413-414). A start timeout of 10 s stops the session (SPEECH:657-661).

Finals to model (MAIN:1230-1293): each final is stored in session memory and shown immediately in the chat target (MAIN:1237-1238); appended to `_utteranceBuffer`;
an 800 ms debounce (`_utteranceCoalesceMs`, MAIN:127) dispatches the concatenation as ONE question. Only one dispatch runs at a time; fragments arriving meanwhile wait
for the whole previous answer to finish and then go as the next question (MAIN:1267-1293). Text shorter than 2 characters is dropped (MAIN:1311).
End-of-speech to model start is about 700 ms hangover + Whisper time + 800 ms.

Mic off or unavailable: mic button is hidden when speech is unavailable (MW:127-137). Alt+R while unavailable broadcasts `speech-status` and `speech-availability:false` (MAIN:948-956).
`startRecording` on an unavailable provider emits `error` text (SPEECH:544-549). Availability is re-queried when the bar window is shown (WM:179, MW:462-467).
Errors become chat system lines "Speech Error: ..." and reset the recording UI (CW:107-112).

## 4. Screenshot and capture

Hotkey or the bar camera button calls `triggerScreenshotOCR` (MAIN:1068, MW:285-289). Order: show the loading panel FIRST (MAIN:1077), then capture (MAIN:1079).
- Source: `desktopCapturer.getSources({types:['screen'], thumbnailSize: display.size})` (CAP:71-74). `display.size` is in points, so Retina captures are returned at 1x. The
  source is picked by matching thumbnail size to the display size, else `sources[0]` (CAP:80-86). That heuristic is ambiguous with two same-size monitors.
- `captureAndProcess()` is called with no options, so it always captures the primary display, full screen, not the cursor display (MAIN:1079, CAP:107-113).
  Optional `displayId` and `area` crop exist (CAP:35-45) and are exposed as IPC `capture-area` (MAIN:461) but no UI calls them. No region selector exists.
- Format: PNG, no downscale or compression (CAP:47). Sent as base64 `inlineData` with mime `image/png` (LLM:142-150, LLM:243-254).
- What the model gets: a fixed instruction ("Analyze this image for a DSA question. Extract the problem... Use only C++ for any code.", LLM:300-303) plus the skill prompt as
  `systemInstruction`. The image path ignores session history entirely (the `sessionMemory` argument is unused, LLM:228-259). The screenshot itself is never added to session memory (only the
  answer is, MAIN:1115-1120), so a follow-up "what about the second example" has the answer but not the question.
- A capture lock throws "Capture already in progress" on a double press (CAP:31); this surfaces as an OCR error toast.
- No Screen Recording permission check; without permission the thumbnail is blank and the model analyzes an empty image.

## 5. LLM flow

Models (CFG:41-57): Gemini `gemini-3.1-flash-lite`, fallbacks `gemini-2.5-flash-lite`, `gemini-3.5-flash`; temperature 0.7, topK 32, topP 0.9, `maxOutputTokens` 4096, thinking budget 0; timeout 30 s, 3 retries.

Three request kinds, all streamed over REST SSE `streamGenerateContent?alt=sse` with a hand-rolled parser (LLM:1115-1189):

| Kind | Trigger | System prompt | History | User part |
|---|---|---|---|---|
| analyze (image) | hotkey/button (MAIN:1100) | `prompts/dsa.md` + language block (LLM:242, PL:80-106) | none | instruction text + PNG |
| chat (typed) | chat box (MAIN:620-642 then 1150-1222) | skill prompt (+ language) (LLM:610-622) | last 15 events (LLM:560-563) | `Context: DSA analysis request\n\nText to analyze:\n<text>` (LLM:837-839) |
| transcription (voice) | coalesced finals (MAIN:1340) | "Intelligent Transcription Response System" prompt only, NOT the skill prompt (LLM:722-724, LLM:781-835) | last 10 then last 8 (LLM:678, LLM:735) | raw text |

- The transcription prompt tells the model to answer casual talk with "Yeah, I'm listening. Ask your question relevant to dsa." and to answer relevant or follow-up questions in full (LLM:802-830).
  Relevance filtering is therefore an LLM round trip on every utterance.
- Language and skill injection: `activeSkill='dsa'`, `codingLanguage='cpp'` are in-memory defaults and are reset every launch (MAIN:115-117). For DSA only, the language is appended to the system prompt
  (PL:90-100) and added to the image instruction (LLM:301); the answer's code fences are then rewritten to the chosen tag (LLM:532-554). Rewriting mislabels any other language the model emits.
  Only `dsa.md` is loaded; other files are skipped (PL:31). `dsa.md:11` says "Your code must not contain any comments" and `programming.md:3` says "without revealing you're an AI helper". We use neither.
- History build: `getConversationHistory(n)` returns the last n non-initialization events with full content (SESS:194-207); roles map to user/model; system roles filtered (LLM:625-638).
  `getOptimizedHistory()` (SESS:490-501) returns lossy one-line summaries ("User spoke: first 50 chars...", SESS:338-367) and is passed around as `sessionHistory.recent`, but the builders ignore that
  argument and re-pull from `sessionManager` (LLM:556-565, LLM:674-681), so it is effectively dead.
- Caps: memory 1000 events, compress at 500 (CFG:94-98). "Maintenance" only drops system events older than 24 h and merges same-action events within 1 min while keeping the FIRST event's content
  (SESS:392-470), which loses data above the cap. Compression truncates `primaryContent`, which the LLM history does not use.
- Streaming to UI: main generates `messageId`, broadcasts `transcription-llm-response-start`, then `...-chunk {messageId, delta}` per SSE piece, then `transcription-llm-response` with the full text
  (MAIN:1093-1122, MAIN:1331-1362). Image and typed chat broadcast to ALL windows (`broadcastToAllWindows`); voice routes by `WHISPER_RESPONSE_TARGET` chat/overlay/both (MAIN:1501-1532).
- Errors/rate limits: no client rate limiter or queue. Per model, 3 attempts with backoff `(2500 if network else 1500)*attempt + jitter` (LLM:1105-1107). On quota/503/"high demand" it jumps to the next
  model immediately (LLM:1092-1099). Stream failure falls back to the non-stream path (LLM:292-297, LLM:431-437, LLM:1021-1029). If everything fails and `fallbackEnabled`, it RETURNS a canned
  "consider breaking it down..." answer as if it were a model answer (LLM:221-224, LLM:384-386, LLM:520-522, LLM:1326-1390). Voice failure shows "Yeah, I'm listening..." or "I'm having trouble..." (MAIN:1387-1417).
- Streaming retry bug: deltas from a failed attempt were already sent to the UI, and the retry sends them again, so bubbles can contain duplicated text (LLM:1065-1068, LLM:1161-1167).
- Duplicate-turn bug: a voice final is stored as a user event at receipt (MAIN:1237), then the history pull includes it and the request appends the same text again as the last turn (LLM:735-761).
  Typed chat is stored twice (MAIN:622, MAIN:1153). Same-role consecutive turns result.
- Likely SDK bug: `executeRequest` passes `systemInstruction` as a top-level argument to `generateContent` (LLM:874-879). We did not verify `@google/genai` semantics. The default path is REST (preferred
  when `enableFallbackMethod`, CFG:48), where the body is valid, so the bug is probably masked.

## 6. UI behaviours (exact states)

Command bar (IDX:355-388): camera + "⌘⇧S", mic, skill chip ("DSA"), language select (C++, C, Python, Java, JavaScript), info button, status dot.
- Mic `.recording`: icon pulses on `recording-started`, clears on `recording-stopped` (MW:644-672, IDX:73-76). The mic is hidden when unavailable and disabled when click-through.
- Skill change toast: centered dark pill "↑/↓ DSA" for 1 s (MW:872-924). A `hidden-indicator` pill for 3 s is wired to a renderer-only Cmd+\ and does not match the real hotkey (MW:549-556, MW:926-934).
- Shortcuts popover: opens on hover/click of info, hides 180 ms after leaving, Esc/outside click closes, bar window grows to fit (MW:376-417, MW:1242-1264).
- Language change saves immediately and re-broadcasts `coding-language-changed` (MW:360-373, MAIN:1619-1623).

Chat window (CW):
- On mic start: recording indicator, "listening" container with a 100 ms duration timer (seconds.tenths) (CW:237-250, CW:580-627).
- Interim line: italic 12 px dashed green box inside the listening container, updated per `interim-transcription`, shows "Waiting for speech..." if empty, cleared on final (CW:629-661, CW:86-92). Azure only.
- Final: listening animation hidden, transcript bubble after 200 ms, "thinking" three dots after another 300 ms (CW:267-286, CW:540-567).
- Streaming: on `...-start` create a bubble `data-stream-id`, `textContent` growth per chunk (plain text, no markdown), on final remove and re-render as markdown plus separate code-snippet bubbles with
  "Snippet: LANG" (CW:379-489). Chunks arriving without a start lazily create the bubble.
- Typed input: Enter or send adds a user bubble and calls `send-chat-message` (CW:327-344).
- Toasts/system lines are chat bubbles: speech status strings, "Speech Error: ...", "OCR Error: ...", "LLM Error: ...", "Session memory has been cleared", skill activation text (CW:94-146, CW:288-325).
  Interaction indicator "Interactive/Non-Interactive" shows for 2 s (CW:569-578).
- Defect: the speech-status handler substring-matches "started" or "Recording" to set recording state (CW:99-103). The final status is "Recording stopped" (SPEECH:1015), which contains "Recording", so the chat
  re-enters the recording state right after a stop. Use typed enum states, never status text.

Response panel: loading state on `show-loading`, content on `display-llm-response`, resized by content metrics (WM:1259-1327, WM:1397-1442). Renderer not in the download.
Hidden-by-error: on LLM error the response panel is hidden and the error goes to the chat as a line (MAIN:1209-1220, MAIN:1136-1137).

## 7. Settings and persistence

- Settings window fields: speech provider, Azure key/region, Whisper command/model/language/device/capture mode/response target/segment ms, Gemini key, window gap, language, skill, "app icon" (SW:9-23, SW:137-155).
  Saves on every `change` and `blur` as a full object (SW:188-214).
- Persistence is only `.env` in Electron userData (or a project `.env` in dev), atomic tmp+rename, upsert by key (MAIN:13-34, MAIN:1768-1832). Persisted: provider, Azure/Whisper values, response target, segment ms, Gemini key (MAIN:1647-1680).
  NOT persisted: active skill, coding language, window gap, app icon, window positions (MAIN:1753-1757 is a stub). The language resets to C++ each launch (MAIN:117).
- `get-settings` returns raw API keys to the renderer (MAIN:1598-1609). Do not copy.
- Speech re-init happens only when provider or the Whisper command changed; the previous value is captured before writing because `persistEnvUpdates` mutates `process.env` (MAIN:1682-1740).
- Dead IPC: preload exposes `hideSettings`, `getLLMSessionHistory`, `formatSessionHistory`, `switchToSkills` with no handlers (PRE:21, PRE:28, PRE:30, PRE:41). Single-instance lock focuses windows (MAIN:1983-1990).
- Global crash guard keeps the process alive on `uncaughtException` (MAIN:89-99). Do not swallow errors this way; surface typed failures.

## 8. Must NOT copy, and fragile spots

Refused (concealment, we do not build any of it):
- `setContentProtection(true)` on every window to exclude them from capture (WM:626-635); README markets "Windows stay out of Zoom, Meet, Teams... captures".
- Auto-hide while screen sharing: `handleScreenSharingStarted` hides all windows and moves them to (-10000,-10000) (WM:1008-1017). Note: nothing ever calls `enableScreenSharingMode` (WM:1722), and the 5 s
  "availability watcher" only probes (WM:926-991), so the README's auto-hide claim is not implemented.
- App disguise: `app.setName("Terminal ")`, `process.title` (MAIN:158-176, MAIN:229-230), switchable "Terminal / Activity Monitor / System Settings" names and icons (MAIN:1841-1858, MAIN:1916-1968),
  stealth config flags (CFG:100-104), `ELECTRON_NO_ATTACH_CONSOLE` (MAIN:169-174), `skipTaskbar`/dock hiding "to maintain stealth" (WM:623-624).
- User-agent spoofing for the Google API and a certificate-verify override that trusts the hostname unconditionally (`callback(0)`) (MAIN:313-330). Never bypass TLS verification.
- A prompt that says to hide being an AI helper (`prompts/programming.md:3`, unused).

Our line: honest name and icon, visible Dock/menu-bar presence, panels are visible to screen capture and sharing, no sharing detector that hides content. Excluding our own panel from our own analysis
screenshot (so the model sees the user's screen, not our overlay) is a capture-filter decision for the native engine, not concealment; make it explicit and keep the panel visible to everyone else.

Fragile or buggy (do not repeat):
1. Level thrash: four different re-assert ladders plus a 3 s timer per window (section 1). Set level and collection behavior once; re-assert only on display/Space/app-deactivate events.
2. Focus theft: every show calls `focus()` (WM:853, WM:1290-1291). The overlay steals key focus from the interview app on each loading/answer. Use a non-activating panel; take focus only on user click.
3. Global hotkeys that break the whole OS: Cmd+Arrows (swallowed everywhere), Cmd+, , Cmd+Shift+S/V/C/I, Alt+A and Alt+R (types å and ®) (MAIN:393-410). Registered always, unregistered never.
4. Cursor-driven repositioning every 2 s and on every answer discards user placement (WM:1570, WM:1606-1686, WM:1294-1296). Persist per-display offsets; follow display only on explicit command.
5. Dragging the bar does not move the response (no `move` handler; binding only reacts to `resize`, WM:517-521).
6. Click-through applies to all windows at once, so the answer cannot be scrolled or copied without toggling mode (WM:1104-1125).
7. Loading panel is shown before capture (MAIN:1077-1079). Capture first, or filter our windows out of the capture.
8. Screenshot defects: Retina at 1x, primary display only, size-match source pick, no permission check (section 4).
9. Dispatch is serial with no supersede: a stale answer finishes before the newest question is sent (MAIN:1267-1293).
10. History defects: duplicate turns, lossy summaries unused, image path without history, screenshot not remembered, maintenance keeps first content (section 5).
11. Canned fallback shown as an answer; streamed duplicates on retry (section 5).
12. Status-string parsing in the UI (CW:99-103). New `https.Agent` per request defeats keep-alive (LLM:1120, LLM:1576).
13. Speech: one process spawn per utterance without the worker, exact-match filter can drop legitimate one-word answers (SPEECH:1864-1878), Azure has no restart after cancel, no interim for Whisper.
14. Secrets echoed to renderer and persisted in plain `.env` (MAIN:1598-1609, MAIN:1816-1832).
15. `ScriptProcessorNode` is deprecated; the audio graph lives in a visible window renderer. Capture belongs in the native engine.

## 9. Mapping to our architecture

Layers: Studio server (S), web panel (W), host adapter (A, typed command/event channel), native engine (N, macOS app).

| OpenCluely behaviour | Belongs in | Most likely to go wrong |
|---|---|---|
| Transparent floating panels, level, join-all-Spaces + full-screen auxiliary | N (non-activating `NSPanel`), content from W | Focus theft or z-order fights; copy the flags in section 1, not the re-assert loops |
| Show/hide, switch panels | S emits intent, A delivers, N executes | Hiding or showing panels while a capture is in flight |
| Click-through mode | N (`ignoresMouseEvents` per panel), toggled by A command or hotkey | User trapped in click-through with no indicator; need always-visible state dot and a hotkey that works in both modes |
| Placement, drag, bound column, multi-display | N, positions persisted per display | Re-snapping on every answer; follow-cursor jumping |
| Hotkeys | N registers, S owns the action vocabulary | OS-wide conflicts; register only while a session is active, unregister on pause/end, report registration failure |
| Mic capture (16 kHz mono PCM, level meter) | N streams frames through A to S | TCC permission attribution and silent dead mic; surface state typed |
| VAD, utterance cut, ASR, hallucination guard | S (processor), N only gates and meters | Dropped frames on reconnect; use sequence numbers and idempotent utterance IDs |
| Interim vs final transcript | S emits typed events, W renders italic interim line | Double-delivered finals after reconnect |
| Coalescing and "is this a question" decision | S (`beginDispatch`, relevance classification before answer) | Answering stale fragments; supersede, never queue behind a long answer |
| Screenshot (display choice, scale-aware, region later) | N capture, upload to S owner-scoped; S freezes the reference | Retina downscale, wrong display, our own panel in the image, no Screen Recording permission |
| Prompts, language, skill, history | S only (existing stages) | Duplicated turns, summaries instead of content, image without context |
| Streamed answer, messageId, final replace | S streams, W renders, A relays | Duplicate chunks on retry; require `messageId` plus `seq` |
| States: analyzing, listening, thinking, error | S state machine -> W | String-matching status text; use enums |
| Error/fallback | S typed failure -> W | Showing fake canned answers |
| Settings, keys, skill/language | S per user/tenant; N keeps only local prefs (positions, hotkeys) | Sending secrets to the panel |

Auto mode is our default: listening starts with the session, utterances are cut and answered without a click; "manual" is the OpenCluely `manual` capture analog (start, stop, one transcript).

## Checklist an implementer must satisfy for hands-free parity

1. Panels are non-activating, transparent, floating, join all Spaces including full-screen; set once, re-asserted only on display/Space/app-deactivate events.
2. Showing a panel never steals focus from the user's current app.
3. Click-through toggles for all panels from a hotkey that works in both modes, with an always-visible mode indicator.
4. Panel positions persist per display and are never reset by a new answer or display poll.
5. Hotkeys are chosen to avoid OS-wide conflicts, registered only while a session is active, unregistered on pause/end; failures are shown.
6. Auto mode starts listening with the session; mic state (off, listening, hearing speech, processing, error, permission denied) is an enum shown in the panel.
7. Native engine streams 16 kHz mono PCM with sequence numbers; Studio cuts utterances (pre-roll about 300 ms, hangover about 700 ms, minimum about 350 ms, cap about 15 s).
8. Interim text shows as an italic line; finals append to the transcript with idempotent utterance IDs.
9. Finals are coalesced (about 800 ms) into one question, short noise is dropped, and a newer question supersedes an in-flight answer.
10. Studio decides whether speech warrants an answer; chit-chat gets a short acknowledgement, not a full solution.
11. Screenshot hotkey captures the intended display at native scale, excludes our own panels from the model's view, checks permission, and shows "analyzing" only after the capture is frozen.
12. Every model call carries real turns (no duplicates, no lossy summaries), including prior screenshots and answers; language and skill come from session config, not UI defaults.
13. Answers stream with `messageId` and `seq`, render plain while streaming, and replace with the formatted result on completion; retries never duplicate text.
14. Failures are typed and visible (no canned answers, no swallowed exceptions); secrets never reach the panel.
15. No concealment: honest app name and icon, visible in Dock/menu bar and screen sharing, no capture exclusion for sharing, no sharing detector that hides content.
