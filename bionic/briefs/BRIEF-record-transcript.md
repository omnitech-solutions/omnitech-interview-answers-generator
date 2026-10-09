---
title: "Record a transcript of a live session on request"
slug: record-transcript
type: brief
status: draft
created_at: 2026-10-09
updated_at: 2026-10-09
authors: ["desoleary", "claude"]
tags: [live-session, transcript, privacy]
related_adrs: []
---

# Record a transcript of a live session on request

## Problem

A transcript like the one from the screening call came from a separate recorder. The Studio
already hears both sides of a call; the owner wants to keep what it heard as a transcript file,
by choice, for replaying and for review afterwards.

## Constraints already decided

- A session's observations are deleted when it ends unless its retention says otherwise
  (ADR-0011). Recording is a second, explicit keep.
- No concealment: when recording is on, the window must say so plainly (the owner refused
  hide-from-capture features on 2026-10-04).
- Content is never logged (AGENTS.md rule 8).

## Proposed

- **Its own button** in the live window's footer beside the microphone, not an item in a menu:
  a record control with a clear on state (a red dot, "Recording transcript", elapsed time) and
  the same state on the native shell's bar.
- **Off by default, every time.** It turns off when the session ends, when the window closes,
  and when the session is opened again; it is never remembered as on.
- **What is kept:** the heard lines with their times and who they came from (microphone = me,
  call audio = interviewer), in the recorder's block format the replay lab reads, as a file in
  the data directory under the session's date. Nothing is kept from before the button was
  pressed.
- **What can be done with it:** open it in the replay lab; reveal it in Finder; delete it. It
  is listed with the session until deleted.

## Options

- **A. A menu item under the microphone.** Smaller; the owner's second thought was that it
  should be its own button so it is obvious when on. Rejected for that reason.
- **B. Its own button, file in the data directory.** Recommended.
- **C. Keep it in the database with the session.** Fits retention rules, but a recording should
  outlive a session set to delete at the end; a file the person owns is simpler and visible.

## Open questions for the owner

1. Consent: recording a call can need the other side's agreement where you or they are. Should
   the first use show a one-time reminder of that? (Recommended: yes, one line, once.)
2. Should a device-only session be recordable? (Recommended: yes, the file never leaves the
   machine.)
