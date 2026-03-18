# Voice Translation App – Project Summary & Evolution

This document describes what the app does, what was tried, what failed, what was switched, and how everything works today.

---

## 1. What the app does (current behavior)

- **Two users** join the same **room** (same Room ID) and connect to a **signaling server** (Socket.IO).
- **One user** clicks **Start Call** and speaks; their speech is converted to **text** in the browser (Web Speech API).
- Text is sent to the **backend** over Socket.IO (**transcript** event).
- Backend **translates** the text (e.g. English → Hindi) using **MyMemory API**, then converts the translated text to **speech** using **ElevenLabs TTS**.
- Backend sends:
  - **transcript** event → other user sees the text in the **Live transcript** UI.
  - **tts-audio** event → other user receives **base64 MP3** and plays it through an **audio queue** (no overlapping).
- So the other user **sees** the translated text and **hears** the synthesized voice, in order, without overlap.

---

## 2. Tech stack

| Layer        | Technology |
|-------------|------------|
| Frontend    | React, Vite, Socket.IO client |
| Backend     | Node.js, Express, Socket.IO, dotenv |
| Speech→Text | Browser Web Speech API (client) |
| Translation | MyMemory API (backend) |
| Text→Speech | ElevenLabs API (backend) |
| Tunnels     | ngrok (frontend), Dev Tunnels (backend) – optional |

---

## 3. Step-by-step evolution (what we tried, what failed, what we switched)

### 3.1 Initial setup: WebRTC voice call

- **Did:** Minimal P2P voice call: join room, see peer, Start Call → WebRTC offer/answer/ICE, send **audio** to the other peer and play it.
- **Result:** Worked on **localhost**. Remote audio played.

---

### 3.2 Tunnel / ngrok: connection and CORS

- **Did:** Frontend and/or backend put behind **ngrok** (or Dev Tunnels) for remote access.
- **Failed:**  
  - Socket **never fired `connect`** – logs showed “Joined room” but not “Connected to signaling server.”  
  - Error: **Connection error: server error** (ngrok often returns an HTML “Visit Site” page instead of the Socket.IO handshake).  
  - Later: **Blocked request. This host ("...ngrok-free.dev") is not allowed** (Vite `allowedHosts`).
- **Switched / fixed:**  
  - **CORS:** Backend CORS relaxed to allow localhost (any port) and `*.ngrok-free.dev`, `*.ngrok.io`, `*.devtunnels.ms`; added `allowedHeaders` for `ngrok-skip-browser-warning`.  
  - **Ngrok header:** Frontend uses `transports: ["polling"]` and `extraHeaders` / `transportOptions.polling.extraHeaders` with `ngrok-skip-browser-warning: true` when URL contains `ngrok`.  
  - **Vite:** Added the frontend ngrok host to `server.allowedHosts` in `vite.config.js`.  
  - **Proxy option:** When frontend runs on localhost, use **Vite proxy** for `/socket.io` to the backend tunnel URL (with the skip header) and set `VITE_USE_TUNNEL=true` so the app connects to same-origin and proxy forwards to tunnel – avoids browser hitting ngrok directly.

---

### 3.3 “Start Call” and remote user not showing over tunnel

- **Failed:** On tunnel, **Start Call** stayed disabled and **remote audio** didn’t appear. Only “Joined room” in logs; no “Connected” or “User joined”.
- **Cause:** Backend sends **all-users** only to the **joining** user; the **existing** user gets **user-joined**. The frontend only handled **all-users**, so the **first** joiner never got the second user’s id.
- **Switched:** Frontend now listens for **user-joined** and sets `otherUserId` and `remoteName`, so the first user can Start Call when the second joins.

---

### 3.4 Remote / local audio not audible

- **Failed:** After connection, “Received remote audio track” in logs but **no sound** from remote (and local was muted by design).
- **Causes:**  
  - Browser **autoplay policy** blocking playback.  
  - **Duplicate peer connections** when both sides clicked Start Call (second offer overwrote the first, confusing streams).
- **Switched:**  
  - Explicit **remoteAudioRef.current.play()** when setting the remote stream; added **“Play remote”** button for user gesture if autoplay blocked.  
  - **Ignore duplicate offer:** If we already have an active peer connection, ignore a second incoming **offer**.  
  - Local audio left **muted** with a note “(muted to avoid echo)”.

---

### 3.5 From “send audio” to “send transcript only”

- **Did:** Stopped sending **peer audio** over WebRTC. Instead: **speech → text** in browser (Web Speech API), send **text** over Socket.IO.
- **Switched:**  
  - **Removed** WebRTC offer/answer/ICE and remote audio playback for the “translation” flow.  
  - **Transcript** event: client emits `{ roomId, text }`, server forwards to others in room as `{ from, name, text }`.  
  - **Start Call** only starts **SpeechRecognition** and sends transcript; no WebRTC.

---

### 3.6 Transcript sent on every word (flood of lines)

- **Failed:** Log showed many lines: “You: I”, “You: I am”, “You: I am now”, etc. – one per phrase chunk.
- **Cause:** Web Speech API in continuous mode fires **final** results often; we sent on every result.
- **Switched:** **Debounce** transcript send: keep the latest text and a **1.4 s** timer; **send only after a pause** (no new result for 1.4 s). Single line per phrase/sentence.

---

### 3.7 Speech recognition “aborted” on same machine

- **Failed:** When testing with **two tabs on the same machine**, one tab got **Speech recognition error: aborted**.
- **Cause:** Both tabs use the **same microphone**; the browser allows only one SpeechRecognition session to use the mic.
- **Switched:**  
  - Handle **aborted** explicitly: set a ref, don’t restart recognition in **onend** when aborted, show a friendly log.  
  - UI note: **“Same machine? Only one tab should click Start Call (that tab sends speech as text). The other tab only receives.”**

---

### 3.8 Translation on the server

- **Did:** Backend receives **transcript**, calls **MyMemory API** (e.g. en→hi), then forwards **translated text** to the other user(s) in the room.
- **Failed (earlier):** “Translation is not working properly” – needed robust response handling and fallback to original text on failure.
- **Switched:** Validate API response; use `data?.responseData?.translatedText`; if missing or invalid, send **original text**. Try/catch with fallback.

---

### 3.9 Translation API: fetch vs axios

- **Failed:** First used **node-fetch** with a **CORS-style callback** (`doFetch`); got **“doFetch is not a function”** (wrong usage / context).
- **Switched to axios:** Replaced with **axios.get** for MyMemory.  
- **Failed again:** **Cannot find module '...axios/dist/node/axios.cjs'** (axios install / version resolution issue).
- **Switched to native fetch:** Removed axios; backend uses Node’s built-in **fetch** (Node 18+) for both **translation** and **ElevenLabs TTS**. No extra HTTP dependency.

---

### 3.10 Text-to-speech (ElevenLabs) and audio over socket

- **Did:** After translating, backend calls **ElevenLabs TTS** with the translated text, gets **MP3** bytes, **base64**-encodes them, and emits **tts-audio** to the other user(s) in the room.
- **Config:** **ELEVENLABS_API_KEY** and **ELEVENLABS_VOICE_ID** from **.env** (dotenv); voice ID default `pNInz6obpgDQGcFmaJgB`.
- **Frontend:** On **tts-audio**, push `{ audioBase64, mimeType }` into a **queue**. A single **playback loop** plays the next item when the current one **ends**, so **no overlapping** clips.
- **Failed (earlier):** “Audio is not playing properly” – needed visibility into TTS.
- **Switched:** Added **try/catch and detailed logs** in **textToSpeech** (validation, request, response status, error body, byte length, base64 length) and in the **transcript** handler (TTS start, success/emit, null return, catch with stack).

---

### 3.11 Nodemon

- **Did:** Added **nodemon** as dev dependency and **npm run dev** script so the backend restarts on file changes.

---

### 3.12 Backend tunnel URL (Dev Tunnels)

- **Did:** Switched from ngrok backend URL to **Dev Tunnels** (e.g. `https://gk7x1xxc-3002.inc1.devtunnels.ms`).  
- Frontend **SIGNALING_SERVER_URL** and Vite proxy target (when used) updated; backend CORS allows `*.devtunnels.ms`.

---

### 3.13 Translation health-check API

- **Did:** Added **GET /api/translate?text=...** (or **?q=...**) to test translation without the app. Returns `{ ok, original, translated, from, to }`. Uses same MyMemory call as the transcript flow.

---

## 4. Current architecture (high level)

```
[User A browser]                    [Backend]                        [User B browser]
     |                                   |                                   |
     |  Socket.IO (join-room, transcript)|                                   |
     |--------------------------------->|                                   |
     |  getUserMedia + SpeechRecognition|                                   |
     |  (speech → text)                  |                                   |
     |  emit('transcript', { roomId, text })                               |
     |--------------------------------->|  translate (MyMemory)              |
     |                                   |  textToSpeech (ElevenLabs)        |
     |                                   |  emit('transcript', { from, name, text })
     |                                   |--------------------------------->|
     |                                   |  emit('tts-audio', { audioBase64 })
     |                                   |--------------------------------->|
     |                                   |                                   |  queue + play (no overlap)
```

- **Frontend:** Room ID, name → Join Room → connect Socket.IO, join room, request mic. When peer in room → Start Call → start SpeechRecognition; on result (debounced by pause) → emit transcript. Listen for **transcript** (show in UI) and **tts-audio** (enqueue and play in order).
- **Backend:** join-room, all-users, user-joined, offer/answer/ice (kept for possible future use). On **transcript**: translate → emit transcript to room → TTS → emit tts-audio to room.

---

## 5. Configuration

### 5.1 Backend (`voice-call/backend/`)

- **.env** (create from `.env.example`, do not commit):
  - `PORT=3002`
  - `ELEVENLABS_API_KEY=<your key>`
  - `ELEVENLABS_VOICE_ID=pNInz6obpgDQGcFmaJgB` (or another voice ID)
- **Run:** `npm start` or `npm run dev` (nodemon).

### 5.2 Frontend (`voice-call/frontend/`)

- **Signaling URL:** In code, `SIGNALING_SERVER_URL` is **localhost:3002** when `hostname === "localhost"`, else the **tunnel URL** (e.g. ngrok or Dev Tunnels). Update the constant if you use a different backend URL.
- **Tunnel from localhost:** Set **VITE_USE_TUNNEL=true** in `.env` and use Vite proxy (configure proxy target in `vite.config.js` to your backend tunnel) so the app connects to same-origin and proxy forwards to the tunnel.
- **Vite:** `allowedHosts` includes localhost and your frontend tunnel host (e.g. ngrok) so the dev server accepts that Host.

### 5.3 Tunnels (optional)

- **Frontend:** e.g. ngrok to Vite dev server (port 5174).  
- **Backend:** e.g. Dev Tunnels or ngrok to Node (port 3002).  
- Backend CORS must allow the **frontend origin** (e.g. ngrok or devtunnels host). Current server allows localhost, `*.ngrok-free.dev`, `*.ngrok.io`, `*.devtunnels.ms`.

---

## 6. How to run and test

1. **Backend:**  
   - Copy `backend/.env.example` to `backend/.env`, set `ELEVENLABS_API_KEY` (and optionally `ELEVENLABS_VOICE_ID`).  
   - `cd backend && npm install && npm start` (or `npm run dev`).

2. **Frontend:**  
   - `cd frontend && npm install && npm run dev`.  
   - Open the URL (e.g. http://localhost:5174).

3. **Two clients:**  
   - Same Room ID and different names; both Join Room.  
   - **Same machine:** Only one tab should click Start Call (the other only receives transcript + TTS).  
   - **Two devices:** Both can Start Call; each sends transcript and receives the other’s text + voice.

4. **Translation API:**  
   - `curl "http://localhost:3002/api/translate?text=Hello"` to verify MyMemory.

5. **Logs:**  
   - Backend: `[TTS]`, `[transcript]` and Socket.IO logs.  
   - Frontend: in-app log list (transcript, TTS queued, etc.).

---

## 7. File summary

| File / area | Purpose |
|-------------|--------|
| `frontend/src/App.jsx` | Room join, Start Call, SpeechRecognition, transcript debounce, socket listeners (transcript, tts-audio), TTS queue playback, UI (transcript, logs, mute). |
| `backend/server.js` | Express + Socket.IO, join-room/all-users/user-joined, transcript (translate + TTS), tts-audio emit, textToSpeech (ElevenLabs), /api/translate. |
| `backend/.env` | PORT, ELEVENLABS_API_KEY, ELEVENLABS_VOICE_ID (not committed). |
| `frontend/vite.config.js` | Port, allowedHosts, optional proxy for /socket.io to backend tunnel. |

---

This doc reflects the evolution and current state of the voice translation app as of the last changes described above.
