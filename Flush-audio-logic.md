# Pending Mute Flush Logic — Documentation

> How VoiceBridge ensures no spoken audio is lost when the user mutes mid-sentence.

---

## Table of Contents

1. [The Problem](#1-the-problem)
2. [Why It Happens](#2-why-it-happens)
3. [The Solution — Overview](#3-the-solution--overview)
4. [New Refs Introduced](#4-new-refs-introduced)
5. [Location 1 — toggleMute() — Flush Armed](#5-location-1--togglemute--flush-armed)
6. [Location 2 — onaudioprocess — Flush Executes](#6-location-2--onaudioprocess--flush-executes)
7. [Location 3 — onmessage — Flush Completes](#7-location-3--onmessage--flush-completes)
8. [Complete Timeline](#8-complete-timeline)
9. [All Three Paths in onaudioprocess](#9-all-three-paths-in-onaudioprocess)
10. [audioActiveRef — The Timing Gap Fix](#10-audioactiveref--the-timing-gap-fix)
11. [UI Feedback During Flush](#11-ui-feedback-during-flush)
12. [Summary Table](#12-summary-table)

---

## 1. The Problem

When a user speaks and then mutes the microphone mid-sentence, the last few
words of the sentence are lost.

**Example:**

```
User says: "could you able to hear me"
                              ↑
                        User clicks Mute HERE

Before fix:
  AssemblyAI receives: "could you able to"     ← INCOMPLETE ❌
  Lost forever:        "hear me"

After fix:
  AssemblyAI receives: "could you able to hear me"  ← COMPLETE ✅
```

This was visible in screenshots — the top bar showed
`"🎙 Hearing: could you able to"` as a partial, and after muting,
the word `"hear me"` never arrived at AssemblyAI.

---

## 2. Why It Happens

The audio pipeline works in chunks. Every ~256ms, `onaudioprocess`
fires with 4096 audio samples. The old code had this check at the top:

```javascript
processor.onaudioprocess = (e) => {
  if (micMutedRef.current) return;  // ← stops immediately on mute
  ...
  aaiWs.send(int16.buffer);
};
```

When the user clicked Mute, `micMutedRef.current` became `true` and the
very next `onaudioprocess` call returned immediately — dropping whatever
audio samples were in that chunk, including the tail end of the sentence.

```
Chunk N:   "could you able to"  → sent ✅
[User clicks Mute]
Chunk N+1: "hear me"            → DROPPED ❌ (return fired before send)
```

---

## 3. The Solution — Overview

The fix uses a **deferred mute** pattern with three coordinated steps:

```
Step 1 — toggleMute()
  User clicks Mute
  → Detect if audio is mid-sentence
  → If YES: arm pendingMuteRef instead of cutting immediately
  → Show muted UI but keep pipeline running

Step 2 — onaudioprocess (FLUSH)
  Pipeline still fires on next tick
  → Sees micMutedRef=true AND pendingMuteRef=true
  → Sends the last audio chunk to AssemblyAI
  → Then returns (stops pipeline)

Step 3 — onmessage (end_of_turn)
  AssemblyAI processes the flushed chunk
  → Fires end_of_turn with complete transcript
  → Now safe to cut hardware mic
  → pendingMuteRef reset, real mute applied
```

The key insight is: **do not cut the mic hardware until AssemblyAI
confirms it received everything via end_of_turn**.

---

## 4. New Refs Introduced

### `pendingMuteRef`

```javascript
const pendingMuteRef = useRef(false);
```

| Value | Meaning |
|---|---|
| `false` | Normal state — no pending mute |
| `true` | Mute was requested while audio was mid-sentence. Pipeline must flush last chunk before stopping. |

**Set to `true`:** inside `toggleMute()` when `hasPendingAudio` is detected.
**Reset to `false`:** inside `onmessage` after `end_of_turn` confirms receipt, or in `stopAssemblyAI()` on call end.

---

### `audioActiveRef`

```javascript
const audioActiveRef = useRef(false);
```

| Value | Meaning |
|---|---|
| `false` | No real audio was in the last chunk (silence / noise floor) |
| `true` | Real speech audio was sent to AssemblyAI in the last chunk |

**Set to `true`:** inside `onaudioprocess` normal path whenever a chunk
with real audio (`|sample| > 0.01`) is sent.

**Set to `false`:** in `onmessage` after `end_of_turn` (sentence complete),
in `toggleMute` on unmute, and in `stopAssemblyAI`.

**Why this ref is needed:**
The `status` string (`"🎙 Hearing:..."`) resets to `"🎙 Listening..."` as
soon as `end_of_turn` fires. There is a timing gap:

```
AAI fires end_of_turn → status resets → "🎙 Listening..."
~100ms gap
User clicks Mute HERE  ← status already reset ❌
  status.startsWith("🎙 Hearing:") = false
  hasPendingAudio = false  ← missed!
  Mutes immediately, drops audio
```

`audioActiveRef` is set directly in `onaudioprocess` every tick, so it
always reflects the most recent real audio activity regardless of what
the React `status` state says.

---

## 5. Location 1 — toggleMute() — Flush Armed

This is where the flush is **triggered**. It runs when the user clicks
the Mute button.

```javascript
const toggleMute = () => {
  if (!localStreamRef.current) return;
  const tracks = localStreamRef.current.getAudioTracks();
  if (!tracks.length) return;

  if (micMuted) {
    // ── UNMUTE: always instant, no checks needed ──
    tracks.forEach(t => (t.enabled = true));
    micMutedRef.current    = false;
    audioActiveRef.current = false;
    pendingMuteRef.current = false;
    setPendingMuteUI(false);
    setMicMuted(false);
    addLog("Microphone unmuted");

  } else {
    // ── MUTE requested ──────────────────────────────────────────────
    // Check TWO signals to detect mid-sentence audio:
    //
    //   Signal 1: status = "🎙 Hearing:..."
    //     → AssemblyAI returned a partial transcript
    //     → Reliable but has a ~100–500ms timing gap after end_of_turn
    //
    //   Signal 2: audioActiveRef.current = true
    //     → Real audio was sent in the last onaudioprocess chunk
    //     → Set directly in the audio pipeline, no timing gap
    //     → Catches the window where status already reset but audio active
    //
    const hasPendingAudio =
      status.startsWith("🎙 Hearing:") ||  // AAI partial in progress
      audioActiveRef.current;               // real audio just sent

    if (hasPendingAudio && callStarted) {
      // ── DEFERRED MUTE: arm the flush ──────────────────────────────
      pendingMuteRef.current = true;   // ← FLUSH ARMED
      setPendingMuteUI(true);          // show ⏳ yellow badge in UI
      setMicMuted(true);               // show muted icon immediately
      micMutedRef.current = true;      // stop new audio entering pipeline
      //                                  (flush path still runs for last chunk)
      addLog("⏳ Mute deferred — flushing sentence to AAI first...");

    } else {
      // ── IMMEDIATE MUTE: no pending audio ──────────────────────────
      tracks.forEach(t => (t.enabled = false));
      micMutedRef.current    = true;
      audioActiveRef.current = false;
      setMicMuted(true);
      addLog("🔇 Microphone muted immediately");
    }
  }
};
```

**Decision tree:**

```
User clicks Mute
    │
    ├── hasPendingAudio = true?
    │       │
    │       ├── YES → pendingMuteRef = true (arm flush)
    │       │         micMutedRef = true (stop new audio)
    │       │         UI: muted icon + ⏳ badge
    │       │         Pipeline: still running for last chunk
    │       │
    │       └── NO  → immediate mute
    │                 track.enabled = false
    │                 micMutedRef = true
    │                 Pipeline: stopped immediately
```

---

## 6. Location 2 — onaudioprocess — Flush Executes

This is where the flush **actually runs**. It fires every ~256ms
(4096 samples ÷ 16000 Hz = 256ms per chunk).

```javascript
processor.onaudioprocess = (e) => {

  // GATE 1: echo prevention — skip while TTS Hindi audio is playing
  if (ttsPlayingRef.current) return;

  // GATE 2: AssemblyAI WebSocket must be open
  if (aaiWs.readyState !== WebSocket.OPEN) return;

  // STEP 1: Decode audio chunk
  // Must be done FIRST — all paths below need float32 and int16.
  const float32 = e.inputBuffer.getChannelData(0);
  const int16   = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++)
    int16[i] = Math.max(-32768, Math.min(32767, float32[i] * 32768));

  // STEP 2: Check if chunk has real audio (threshold: 1% of max amplitude)
  // Filters out silence and electrical noise floor from the mic.
  // Used in both the flush path and the normal path.
  let hasAudio = false;
  for (let i = 0; i < float32.length; i++) {
    if (Math.abs(float32[i]) > 0.01) { hasAudio = true; break; }
  }

  // ── PATH A: fully muted, no flush pending ──────────────────────────
  // micMutedRef = true AND pendingMuteRef = false
  // Clean mute — no audio to preserve. Stop immediately.
  if (micMutedRef.current && !pendingMuteRef.current) {
    return;
  }

  // ── PATH B: FLUSH PATH ─────────────────────────────────────────────
  // micMutedRef = true AND pendingMuteRef = true
  //
  // The user clicked Mute while speaking.
  // toggleMute() armed the flush (pendingMuteRef=true).
  // This is the one final onaudioprocess call that sends the
  // remaining audio tail to AssemblyAI before the pipeline stops.
  //
  // After this return, onaudioprocess will keep firing but will
  // hit PATH A on every subsequent call (pendingMuteRef resets
  // in onmessage after end_of_turn).
  if (micMutedRef.current && pendingMuteRef.current) {
    if (hasAudio) {
      aaiWs.send(int16.buffer);  // ← FLUSH: last chunk sent to AAI ✅
      addLog("🔁 Flush: sent last audio chunk before mute");
    }
    // Whether audio existed or not — stop here.
    // The hardware mic track will be disabled in onmessage.
    return;
  }

  // ── PATH C: normal active path ─────────────────────────────────────
  // micMutedRef = false, pipeline is live.
  // Track real audio activity so toggleMute can detect mid-sentence.
  audioActiveRef.current = hasAudio;

  // Send the chunk to AssemblyAI
  aaiWs.send(int16.buffer);
};
```

**The three paths visualised:**

```
onaudioprocess fires
        │
        ├── micMuted=false → PATH C (normal)
        │     audioActiveRef = hasAudio
        │     aaiWs.send(int16.buffer)
        │
        ├── micMuted=true, pendingMute=false → PATH A (clean stop)
        │     return immediately
        │
        └── micMuted=true, pendingMute=true  → PATH B (FLUSH)
              if hasAudio → aaiWs.send(int16.buffer)
              return
```

---

## 7. Location 3 — onmessage — Flush Completes

This is where the flush **finishes**. After AssemblyAI processes the
flushed chunk, it fires `end_of_turn` with the complete transcript.
Only now is it safe to cut the hardware mic.

```javascript
aaiWs.onmessage = (msg) => {
  const data = JSON.parse(msg.data);

  if (data.type === "Begin")
    addLog("AssemblyAI session: " + data.id);

  // Partial transcript — show in top bar
  if (data.type === "Turn" && !data.end_of_turn && data.transcript?.trim())
    setStatus("🎙 Hearing: " + data.transcript);

  // Final transcript — AAI has processed all audio up to this point
  if (data.type === "Turn" && data.end_of_turn && data.transcript?.trim()) {
    const text = data.transcript.trim();
    addLog("Final: " + text);
    setStatus("🎙 Listening...");

    // Mark audio activity as done — sentence is complete
    audioActiveRef.current = false;

    // Show in transcript panel and send to backend for translation + TTS
    setTranscripts((prev) => [...prev, {
      from: "me", name: nameRef.current, text, ts: Date.now()
    }]);
    socketRef.current.emit("transcript", {
      roomId: roomIdRef.current, text
    });

    // ── FLUSH COMPLETION ──────────────────────────────────────────────
    // pendingMuteRef = true means the user clicked Mute while speaking
    // and the flush sent the remaining audio (Location 2 / PATH B).
    // AssemblyAI has now confirmed it received and processed everything
    // via this end_of_turn event.
    //
    // It is now safe to:
    //   1. Clear pendingMuteRef
    //   2. Disable the hardware mic track
    //   3. Remove the ⏳ UI badge
    //
    if (pendingMuteRef.current) {
      pendingMuteRef.current = false;            // ← clear flush flag
      setPendingMuteUI(false);                   // ← remove ⏳ badge
      micMutedRef.current = true;                // ← onaudioprocess → PATH A
      localStreamRef.current                     // ← cut hardware mic
        ?.getAudioTracks()
        .forEach(t => (t.enabled = false));
      addLog("✅ Mic muted — all pending audio confirmed sent to AAI");
    }
    // ── END FLUSH COMPLETION ──────────────────────────────────────────
  }

  if (data.type === "Termination")
    addLog("AssemblyAI terminated.");
};
```

---

## 8. Complete Timeline

A step-by-step trace of one full flush cycle:

```
t=0ms      You say: "could you able to hear me"

t=0–800ms  onaudioprocess fires repeatedly
           → PATH C (normal): chunks streaming to AAI
           → audioActiveRef = true (real audio detected)

t=800ms    AssemblyAI returns partial:
           { type:"Turn", end_of_turn:false,
             transcript:"could you able to" }
           → setStatus("🎙 Hearing: could you able to")

t=900ms    ── USER CLICKS MUTE ──
           toggleMute() runs:
             hasPendingAudio:
               status.startsWith("🎙 Hearing:") = true ✅
             pendingMuteRef = true    ← FLUSH ARMED
             micMutedRef = true       ← no new audio enters
             setMicMuted(true)        ← UI: muted icon
             setPendingMuteUI(true)   ← UI: ⏳ badge

t=1156ms   onaudioprocess fires (next tick after mute click)
           → PATH B (FLUSH):
               micMuted=true, pendingMute=true
               float32 has "hear me" samples
               hasAudio = true
               aaiWs.send(int16.buffer) ← "hear me" FLUSHED ✅
               return

t=1200ms   AssemblyAI receives the flushed "hear me" chunk
           Detects silence after → fires end_of_turn

t=1400ms   onmessage receives:
           { type:"Turn", end_of_turn:true,
             transcript:"could you able to hear me" }
                                    ← COMPLETE SENTENCE ✅

           socketRef.emit("transcript", { text })
           → server → MyMemory translate → ElevenLabs TTS

           pendingMuteRef = true →
             pendingMuteRef = false       ← flag cleared
             setPendingMuteUI(false)      ← ⏳ badge removed
             micMutedRef = true
             track.enabled = false        ← hardware mic OFF ✅
             log: "✅ Mic muted — all audio confirmed sent"

t=1400ms+  onaudioprocess keeps firing
           → PATH A: micMuted=true, pendingMute=false
           → return immediately (pipeline fully stopped)

RESULT: "could you able to hear me" sent complete ✅
        Nothing lost ✅
        Mic properly muted ✅
```

---

## 9. All Three Paths in onaudioprocess

| Path | Condition | What it does |
|---|---|---|
| **PATH A** | `micMuted=true` AND `pendingMute=false` | Clean stop — return immediately, nothing sent |
| **PATH B (FLUSH)** | `micMuted=true` AND `pendingMute=true` | Check `hasAudio` → send last chunk if real audio → return |
| **PATH C (Normal)** | `micMuted=false` | Set `audioActiveRef`, send chunk to AAI |

---

## 10. audioActiveRef — The Timing Gap Fix

Without `audioActiveRef`, there is a window where the flush fails:

```
Timeline without audioActiveRef:

t=0        Sentence starts
t=800ms    AAI partial → status = "🎙 Hearing: could you able to"
t=900ms    AAI end_of_turn fires
           status resets → "🎙 Listening..."
           audioActiveRef NOT updated
t=950ms    User clicks Mute ← 50ms after end_of_turn
           status.startsWith("🎙 Hearing:") = false ← timing gap!
           hasPendingAudio = false
           Mute applied immediately
           NEXT sentence's first word may be lost ❌
```

With `audioActiveRef`:

```
Timeline with audioActiveRef:

t=0        Sentence starts
t=each 256ms  onaudioprocess → PATH C
              if real audio: audioActiveRef = true ← always current
t=900ms    AAI end_of_turn fires
           onmessage: audioActiveRef = false ← reset here
t=950ms    User clicks Mute
           audioActiveRef = false (sentence was complete)
           hasPendingAudio = false → immediate mute ✅ (correct)

Next sentence:
t=1000ms   User speaks again
           onaudioprocess → audioActiveRef = true
t=1100ms   User clicks Mute
           audioActiveRef = true → deferred mute ✅ (correct)
```

`audioActiveRef` is set inside `onaudioprocess` synchronously,
so it always reflects the most recent actual audio activity.
It closes the timing gap that `status` string cannot cover.

---

## 11. UI Feedback During Flush

The user gets visual feedback that their sentence is being completed
before the mic fully mutes:

| State | Mute button | Top bar badge | Tile badge |
|---|---|---|---|
| Normal unmuted | 🎙 Mute | — | — |
| Flush in progress | ⏳ (disabled) | ⏳ Finishing sentence before muting... | ⏳ Finishing... |
| Fully muted | 🔇 Unmute | — | 🔇 red badge |

The button is **disabled** during flush (`disabled={pendingMuteUI}`)
so the user cannot click it again mid-flush.

---

## 12. Summary Table

| Step | Location | What happens | Ref involved |
|---|---|---|---|
| 1. Flush armed | `toggleMute()` | `pendingMuteRef=true`, UI shows ⏳ | `pendingMuteRef`, `audioActiveRef` |
| 2. Flush executes | `onaudioprocess` PATH B | Last chunk sent to AAI | `pendingMuteRef`, `micMutedRef` |
| 3. Flush completes | `onmessage` end_of_turn | Real mute applied, flag cleared | `pendingMuteRef`, `audioActiveRef` |
| Timing gap covered | `onaudioprocess` PATH C | `audioActiveRef` updated every tick | `audioActiveRef` |
| Echo prevention | `onaudioprocess` GATE 1 | Skip if TTS audio playing | `ttsPlayingRef` |

---

*VoiceBridge — Pending Mute Flush Logic Documentation*