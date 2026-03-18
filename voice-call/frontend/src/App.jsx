import React, { useRef, useState, useEffect } from "react";
import io from "socket.io-client";

const SIGNALING_SERVER_URL =
  window.location.hostname === "localhost"
    ? "http://localhost:3002"
    : "https://unvaccinated-tempie-depreciatively.ngrok-free.dev";

function App() {
  const [roomId, setRoomId] = useState("");
  const [name, setName] = useState("");
  const [remoteName, setRemoteName] = useState("");
  const [joined, setJoined] = useState(false);
  const [status, setStatus] = useState("");
  const [callStarted, setCallStarted] = useState(false);
  const [otherUserId, setOtherUserId] = useState(null);
  const [micMuted, setMicMuted] = useState(false);
  const [logs, setLogs] = useState([]);
  const [transcripts, setTranscripts] = useState([]);

  // ── existing refs ──────────────────────────────────────────────────────────
  const localAudioRef  = useRef(null);
  const socketRef      = useRef(null);
  const localStreamRef = useRef(null);
  const roomIdRef      = useRef("");
  const micMutedRef    = useRef(false);
  const callStartedRef = useRef(false);

  // ── AssemblyAI refs ────────────────────────────────────────────────────────
  const nameRef       = useRef("");
  const aaiSocketRef  = useRef(null);
  const audioCtxRef   = useRef(null);
  const processorRef  = useRef(null);

  // ── TTS queue — unchanged ──────────────────────────────────────────────────
  const ttsQueueRef          = useRef([]);
  const ttsPlayingRef        = useRef(false);
  const playNextFromQueueRef = useRef(null);

  playNextFromQueueRef.current = function playNextFromQueue() {
    if (ttsPlayingRef.current || ttsQueueRef.current.length === 0) return;
    const item = ttsQueueRef.current.shift();
    if (!item?.audioBase64) return;
    try {
      const binary = atob(item.audioBase64);
      const bytes  = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const blob  = new Blob([bytes], { type: item.mimeType || "audio/mpeg" });
      const url   = URL.createObjectURL(blob);
      const audio = new Audio();
      ttsPlayingRef.current = true;
      audio.onended = () => { URL.revokeObjectURL(url); ttsPlayingRef.current = false; playNextFromQueueRef.current(); };
      audio.onerror = () => { URL.revokeObjectURL(url); ttsPlayingRef.current = false; playNextFromQueueRef.current(); };
      audio.src = url;
      audio.play().catch(() => { URL.revokeObjectURL(url); ttsPlayingRef.current = false; playNextFromQueueRef.current(); });
    } catch (e) {
      ttsPlayingRef.current = false;
      playNextFromQueueRef.current();
    }
  };

  function enqueueAudio(audioBase64, mimeType = "audio/mpeg") {
    ttsQueueRef.current.push({ audioBase64, mimeType });
    playNextFromQueueRef.current();
  }

  useEffect(() => { micMutedRef.current    = micMuted;    }, [micMuted]);
  useEffect(() => { callStartedRef.current = callStarted; }, [callStarted]);
  useEffect(() => { nameRef.current        = name;        }, [name]);

  const addLog = (msg) =>
    setLogs((prev) => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]);

  // ── AssemblyAI Universal Streaming ────────────────────────────────────────
  async function startAssemblyAI(stream) {
    addLog("Fetching AssemblyAI token...");

    // Step 1: Get token from your backend
    let token;
    try {
      const res = await fetch(`${SIGNALING_SERVER_URL}/assemblyai-token`, {
        method: "POST",
      });
      if (!res.ok) throw new Error("HTTP " + res.status);
      ({ token } = await res.json());
      addLog("AssemblyAI token received.");
    } catch (err) {
      addLog("Failed to get AssemblyAI token: " + err.message);
      setStatus("Could not connect to AssemblyAI. Check server.");
      return;
    }

    // ✅ Step 2: New Universal Streaming WebSocket URL
    //
    // OLD (deprecated):
    //   wss://api.assemblyai.com/v2/realtime/ws?sample_rate=16000&token=...
    //
    // NEW (Universal Streaming):
    //   wss://streaming.assemblyai.com/v3/ws
    //   params: sample_rate, speech_model, token
    //   "universal-streaming-english"  → fastest, English only
    //   "universal-streaming-multilingual" → multilingual (EN/ES/FR/DE/IT/PT)
    //   "whisper-rt"                   → 99+ languages including Hindi auto-detect
    //
    // We use whisper-rt so AssemblyAI can handle Hindi speech if needed.
    // Since our user speaks English → we use universal-streaming-english for speed.
    const wsUrl =
      `wss://streaming.assemblyai.com/v3/ws` +
      `?sample_rate=16000` +
      `&speech_model=universal-streaming-english` +
      `&token=${token}`;

    const aaiWs = new WebSocket(wsUrl);
    aaiSocketRef.current = aaiWs;

    aaiWs.onopen = () => {
      addLog("AssemblyAI Universal Streaming open. Streaming mic at 16 kHz...");
      setStatus("Starting call. Speak and your words will appear as text for the other user.");

      // Step 3: Stream raw PCM to AssemblyAI (same as before)
      const audioCtx  = new AudioContext({ sampleRate: 16000 });
      audioCtxRef.current = audioCtx;
      const source    = audioCtx.createMediaStreamSource(stream);
      const processor = audioCtx.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;

      processor.onaudioprocess = (e) => {
        if (micMutedRef.current) return;
        if (aaiWs.readyState !== WebSocket.OPEN) return;
        const float32 = e.inputBuffer.getChannelData(0);
        const int16   = new Int16Array(float32.length);
        for (let i = 0; i < float32.length; i++) {
          int16[i] = Math.max(-32768, Math.min(32767, float32[i] * 32768));
        }
        aaiWs.send(int16.buffer);
      };

      source.connect(processor);
      processor.connect(audioCtx.destination);
    };

    // ✅ Step 4: New message format
    //
    // OLD format:
    //   { message_type: "PartialTranscript", text: "..." }
    //   { message_type: "FinalTranscript",   text: "..." }
    //
    // NEW format:
    //   { type: "Begin" }                          → session started
    //   { type: "Turn", transcript: "...", end_of_turn: false }  → partial
    //   { type: "Turn", transcript: "...", end_of_turn: true  }  → final ✅
    //   { type: "Termination" }                    → session ended
    aaiWs.onmessage = (msg) => {
      const data = JSON.parse(msg.data);

      if (data.type === "Begin") {
        addLog("AssemblyAI session started. ID: " + data.id);
      }

      // Partial — live "hearing" feedback (end_of_turn: false)
      if (data.type === "Turn" && !data.end_of_turn && data.transcript?.trim()) {
        setStatus("🎙 Hearing: " + data.transcript);
      }

      // Final — send to backend for translate + TTS (end_of_turn: true)
      if (data.type === "Turn" && data.end_of_turn && data.transcript?.trim()) {
        const text          = data.transcript.trim();
        const socket        = socketRef.current;
        const currentRoomId = roomIdRef.current;
        const currentName   = nameRef.current;

        addLog("Final transcript: " + text);
        setStatus("Starting call. Speak and your words will appear as text for the other user.");

        // Show locally
        setTranscripts((prev) => [...prev, { from: "me", name: currentName, text }]);

        // Send to backend → translate EN→HI → ElevenLabs TTS → tts-audio
        socket.emit("transcript", { roomId: currentRoomId, text });
        addLog("Sent transcript: " + text);
      }

      if (data.type === "Termination") {
        addLog("AssemblyAI session terminated.");
      }
    };

    aaiWs.onerror = (e) =>
      addLog("AssemblyAI WS error: " + (e.message || "unknown"));

    // Step 5: Auto-reconnect on unexpected close
    aaiWs.onclose = (e) => {
      addLog("AssemblyAI WS closed (code " + e.code + ")");
      if (callStartedRef.current) {
        addLog("Reconnecting AssemblyAI in 2 seconds...");
        setTimeout(() => startAssemblyAI(localStreamRef.current), 2000);
      }
    };
  }

  function stopAssemblyAI() {
    // Cleanly terminate session before closing (new API requirement)
    if (aaiSocketRef.current && aaiSocketRef.current.readyState === WebSocket.OPEN) {
      try {
        aaiSocketRef.current.send(JSON.stringify({ type: "Terminate" }));
      } catch (_) {}
      aaiSocketRef.current.close();
    }
    aaiSocketRef.current = null;

    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }
    if (audioCtxRef.current) {
      audioCtxRef.current.close();
      audioCtxRef.current = null;
    }
    addLog("AssemblyAI stream stopped.");
  }
  // ──────────────────────────────────────────────────────────────────────────

  // ── joinRoom — unchanged ───────────────────────────────────────────────────
  const joinRoom = async () => {
    if (!roomId) {
      setStatus("Please enter a Room ID.");
      return;
    }
    roomIdRef.current = roomId;
    setStatus("Requesting microphone...");
    addLog("Requesting microphone...");

    const localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    localAudioRef.current.srcObject = localStream;
    localStreamRef.current = localStream;
    addLog("Microphone stream acquired.");

    setStatus("Connecting to signaling server...");
    addLog("Connecting to signaling server...");

    const socket = io(SIGNALING_SERVER_URL, { transports: ["websocket"] });
    socketRef.current = socket;
    addLog("Socket.io client created.");

    socket.on("connect", () => {
      setStatus("Connected to signaling server. Joining room...");
      addLog("Connected to signaling server. Joining room " + roomIdRef.current);
      socket.emit("join-room", { roomId: roomIdRef.current, name });
    });

    socket.on("all-users", (users) => {
      addLog(`Received all-users: ${JSON.stringify(users)}`);
      if (users.length > 0) {
        const userObj = users[0];
        const id = typeof userObj === "string" ? userObj : userObj?.id;
        const remoteUserName =
          typeof userObj === "object" && userObj?.name ? userObj.name : "Remote User";
        if (id) {
          setOtherUserId(id);
          setRemoteName(remoteUserName);
          addLog(`Other user in room: ${id} (${remoteUserName})`);
        }
      }
    });

    socket.on("user-joined", ({ id, name: remoteUserName }) => {
      addLog(`User joined: ${id} (${remoteUserName || "Remote User"})`);
      setOtherUserId(id);
      setRemoteName(remoteUserName || "Remote User");
      setStatus("Peer in room. You can Start Call.");
    });

    socket.on("transcript", ({ from, name: fromName, text, translationMs }) => {
      if (!text) return;
      setTranscripts((prev) => [...prev, { from, name: fromName, text, translationMs }]);
      const timing = typeof translationMs === "number" ? ` (translated in ${translationMs} ms)` : "";
      addLog(`Transcript from ${fromName}: ${text}${timing}`);
    });

    socket.on("tts-audio", ({ from, name: fromName, audioBase64, mimeType, ttsMs }) => {
      if (!audioBase64) return;
      const timing = typeof ttsMs === "number" ? ` (audio in ${ttsMs} ms)` : "";
      addLog(`TTS audio from ${fromName}, queued${timing}`);
      enqueueAudio(audioBase64, mimeType || "audio/mpeg");
    });

    setJoined(true);
    setStatus("Joined room. Waiting for peer...");
    addLog("Joined room " + roomId);
  };

  // ── startCall — same shape, AssemblyAI inside ─────────────────────────────
  const startCall = async () => {
    if (!otherUserId) {
      setStatus("No peer to call. Wait for another user to join.");
      addLog("No peer to call. Wait for another user to join.");
      return;
    }

    const socket        = socketRef.current;
    const currentRoomId = roomIdRef.current;
    if (!socket || !currentRoomId) return;

    setStatus("Starting call. Speak and your words will appear as text for the other user.");
    addLog("Starting call – connecting AssemblyAI Universal Streaming.");
    setCallStarted(true);
    callStartedRef.current = true;

    await startAssemblyAI(localStreamRef.current);
  };

  // ── toggleMute — unchanged ─────────────────────────────────────────────────
  const toggleMute = () => {
    if (!localStreamRef.current) return;
    const audioTracks = localStreamRef.current.getAudioTracks();
    if (audioTracks.length === 0) return;
    if (micMuted) {
      audioTracks.forEach((track) => (track.enabled = true));
      setMicMuted(false);
      addLog("Microphone unmuted");
    } else {
      audioTracks.forEach((track) => (track.enabled = false));
      setMicMuted(true);
      addLog("Microphone muted");
    }
  };

  // ── endCall ────────────────────────────────────────────────────────────────
  const endCall = () => {
    callStartedRef.current = false;
    setCallStarted(false);
    stopAssemblyAI();
    setStatus("Call ended.");
    addLog("Call ended.");
  };

  // ── JSX — your exact existing UI ──────────────────────────────────────────
  return (
    <div style={{ padding: 24 }}>
      <h2>Minimal WebRTC Voice Call (P2P)</h2>
      <div style={{ marginBottom: 16 }}>
        <label>
          Name:
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={joined}
            style={{ marginLeft: 8, marginRight: 16 }}
          />
        </label>
        <label>
          Room ID:
          <input
            value={roomId}
            onChange={(e) => setRoomId(e.target.value)}
            disabled={joined}
            style={{ marginLeft: 8 }}
          />
        </label>
        <button onClick={joinRoom} disabled={joined || !roomId || !name} style={{ marginLeft: 12 }}>
          Join Room
        </button>
        <button onClick={startCall} disabled={!joined || callStarted || !otherUserId} style={{ marginLeft: 12 }}>
          Start Call
        </button>
        <button onClick={toggleMute} disabled={!joined} style={{ marginLeft: 12 }}>
          {micMuted ? "Unmute Mic" : "Mute Mic"}
        </button>
        <button
          onClick={endCall}
          disabled={!callStarted}
          style={{ marginLeft: 12, background: "#c62828", color: "#fff", border: "none", borderRadius: 4, padding: "4px 12px", cursor: "pointer" }}
        >
          End Call
        </button>
      </div>

      <div style={{ marginTop: 24 }}>
        <div>Status: {status}</div>
        {remoteName && (
          <div style={{ marginTop: 8 }}>
            <b>Remote User:</b> {remoteName}
          </div>
        )}
        <p style={{ marginTop: 8, fontSize: 12, color: "#666" }}>
          Same machine? Only one tab should click &quot;Start Call&quot; (that
          tab sends speech as text). The other tab only receives. Or use two devices.
        </p>

        <div style={{ marginTop: 16 }}>
          <b>Local Audio:</b>
          <span style={{ marginLeft: 8, fontSize: 12, color: "#666" }}>(muted to avoid echo)</span>
          <audio ref={localAudioRef} autoPlay muted playsInline controls style={{ width: 300 }} />
        </div>

        <div style={{ marginTop: 16 }}>
          <b>Live transcript:</b>
          <div
            style={{
              marginTop: 8, minHeight: 120, maxHeight: 220, overflowY: "auto",
              background: "#f5f5f5", padding: 12, borderRadius: 8, border: "1px solid #ddd",
            }}
          >
            {transcripts.length === 0 ? (
              <span style={{ color: "#888", fontSize: 14 }}>
                After you Start Call, your speech will appear here as text for the other user. Their words will appear here too.
              </span>
            ) : (
              transcripts.map((t, i) => (
                <div key={i} style={{ marginBottom: 8 }}>
                  <span style={{ fontWeight: 600, color: t.from === "me" ? "#1976d2" : "#2e7d32" }}>
                    {t.from === "me" ? "You" : t.name}:
                  </span>{" "}
                  {t.text}
                  {typeof t.translationMs === "number" && (
                    <span style={{ fontSize: 11, color: "#888", marginLeft: 6 }}>
                      (translated in {t.translationMs} ms)
                    </span>
                  )}
                </div>
              ))
            )}
          </div>
          <p style={{ marginTop: 6, fontSize: 12, color: "#666" }}>
            Remote voice is played in order (queue) so clips do not overlap.
          </p>
        </div>

        <div style={{ marginTop: 16, maxHeight: 200, overflowY: "auto", background: "#f7f7f7", padding: 8, borderRadius: 4 }}>
          <b>Logs:</b>
          <ul style={{ fontSize: 13, margin: 0, paddingLeft: 16 }}>
            {logs.map((log, idx) => (
              <li key={idx}>{log}</li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

export default App;