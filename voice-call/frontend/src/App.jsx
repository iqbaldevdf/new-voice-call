import React, { useRef, useState, useEffect } from "react";
import io from "socket.io-client";

const DEFAULT_NGROK_BACKEND =
  "https://unvaccinated-tempie-depreciatively.ngrok-free.dev";

function getSignalingServerUrl() {
  const envUrl = (import.meta.env.VITE_SIGNALING_URL || "").trim().replace(/\/+$/, "");
  if (envUrl) return envUrl;
  const host = typeof window !== "undefined" ? window.location.hostname : "";
  if (host === "localhost" || host === "127.0.0.1") return "http://localhost:3002";
  if (host.includes("devtunnels.ms")) return DEFAULT_NGROK_BACKEND;
  return DEFAULT_NGROK_BACKEND;
}

const SIGNALING_SERVER_URL = getSignalingServerUrl();

/* ─────────────────────────────────────────────────────────────────────────────
   GLOBAL STYLES  — injected once into <head>
───────────────────────────────────────────────────────────────────────────── */
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Google+Sans:wght@400;500;600&display=swap');
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
html,body,#root{height:100%;overflow:hidden}
body{font-family:'Google Sans','Segoe UI',sans-serif;background:#202124;color:#e8eaed}

.vb-root{display:flex;flex-direction:column;height:100vh;background:#202124}
.vb-topbar{display:flex;align-items:center;justify-content:space-between;
  padding:0 20px;height:56px;flex-shrink:0;border-bottom:1px solid #3c4043}
.vb-stage{flex:1;display:flex;gap:8px;padding:8px;overflow:hidden;min-height:0}
.vb-bottombar{height:76px;display:flex;align-items:center;justify-content:space-between;
  padding:0 24px;flex-shrink:0;border-top:1px solid #3c4043}

.vb-logo{font-size:18px;font-weight:600;letter-spacing:-.3px;color:#e8eaed}
.vb-logo b{color:#8ab4f8}
.vb-badge{font-size:11px;background:#3c4043;color:#9aa0a6;
  padding:2px 9px;border-radius:4px;margin-left:10px;letter-spacing:.3px}
.vb-chip{display:inline-flex;align-items:center;gap:6px;font-size:12px;
  background:#2a3a52;color:#8ab4f8;border:1px solid rgba(138,180,248,.3);
  border-radius:20px;padding:3px 11px}
.vb-time{font-size:13px;color:#9aa0a6;font-variant-numeric:tabular-nums}

.vb-tiles{flex:1;display:grid;gap:8px;min-width:0}
.vb-tiles.solo{grid-template-columns:1fr}
.vb-tiles.duo {grid-template-columns:1fr 1fr}
.vb-tile{position:relative;background:#2d2f33;border-radius:14px;overflow:hidden;
  display:flex;align-items:center;justify-content:center;transition:box-shadow .2s}
.vb-tile.lit{box-shadow:0 0 0 3px #8ab4f8;animation:glow 1.2s ease-out infinite}
@keyframes glow{0%{box-shadow:0 0 0 0 rgba(138,180,248,.5)}
                100%{box-shadow:0 0 0 14px rgba(138,180,248,0)}}
.vb-avatar{width:80px;height:80px;border-radius:50%;display:flex;align-items:center;
  justify-content:center;font-size:30px;font-weight:600;color:#fff;user-select:none}
.vb-tile-name{position:absolute;bottom:12px;left:12px;background:rgba(0,0,0,.6);
  color:#e8eaed;font-size:13px;padding:3px 10px;border-radius:4px}
.vb-tile-muted{position:absolute;bottom:12px;right:12px;background:#ea4335;
  color:#fff;width:30px;height:30px;border-radius:50%;
  display:flex;align-items:center;justify-content:center;font-size:13px}
.vb-tile-tag{position:absolute;top:10px;left:10px;background:rgba(0,0,0,.55);
  color:#8ab4f8;font-size:11px;padding:2px 8px;border-radius:4px;
  display:flex;align-items:center;gap:4px}
.vb-waiting{display:flex;flex-direction:column;align-items:center;
  gap:10px;color:#5f6368;font-size:13px}
.vb-waiting-icon{font-size:40px;opacity:.35}

.vb-side{width:316px;display:flex;flex-direction:column;gap:8px;flex-shrink:0}
.vb-panel{background:#292b2f;border-radius:12px;overflow:hidden;
  display:flex;flex-direction:column}
.vb-panel-hdr{padding:12px 14px;font-size:13px;font-weight:500;color:#e8eaed;
  border-bottom:1px solid #3c4043;display:flex;align-items:center;
  gap:8px;flex-shrink:0;user-select:none}
.vb-panel-hdr .cnt{margin-left:auto;font-size:11px;color:#5f6368;font-weight:400}

.vb-transcripts{flex:1;overflow-y:auto;padding:10px;display:flex;
  flex-direction:column;gap:8px;min-height:0;max-height:340px;
  scrollbar-width:thin;scrollbar-color:#5f6368 transparent}
.vb-transcripts::-webkit-scrollbar{width:4px}
.vb-transcripts::-webkit-scrollbar-thumb{background:#5f6368;border-radius:2px}
.vb-bubble{display:flex;flex-direction:column;gap:2px}
.vb-bubble.me{align-items:flex-end}
.vb-bubble.them{align-items:flex-start}
.vb-bsender{font-size:10px;color:#9aa0a6;padding:0 4px}
.vb-btext{font-size:13px;line-height:1.45;padding:8px 12px;border-radius:16px;
  max-width:230px;word-break:break-word}
.vb-bubble.me   .vb-btext{background:#174ea6;color:#e8eaed;border-bottom-right-radius:4px}
.vb-bubble.them .vb-btext{background:#3c4043;color:#e8eaed;border-bottom-left-radius:4px}
.vb-bmeta{font-size:10px;color:#5f6368;padding:0 4px}
.vb-empty{text-align:center;color:#5f6368;font-size:12px;margin:auto;padding:20px;line-height:1.7}

.vb-logs{max-height:120px;overflow-y:auto;padding:6px 12px;
  scrollbar-width:thin;scrollbar-color:#5f6368 transparent}
.vb-logs::-webkit-scrollbar{width:4px}
.vb-logs::-webkit-scrollbar-thumb{background:#5f6368;border-radius:2px}
.vb-log{font-size:11px;color:#9aa0a6;font-family:monospace;
  line-height:1.6;border-bottom:1px solid #3c4043;padding:1px 0}
.vb-log:last-child{border-bottom:none}

.vb-bl{min-width:160px}
.vb-bc{position:absolute;left:50%;transform:translateX(-50%);
  display:flex;align-items:center;gap:10px}
.vb-br{min-width:160px;display:flex;flex-direction:column;
  align-items:flex-end;gap:2px;font-size:11px}
.vb-bottombar{position:relative}

.cbtn{width:48px;height:48px;border-radius:50%;border:none;cursor:pointer;
  display:flex;align-items:center;justify-content:center;font-size:20px;
  transition:background .15s,transform .1s;outline:none}
.cbtn:active{transform:scale(.92)}
.cbtn:disabled{opacity:.35;cursor:not-allowed;transform:none!important}
.cbtn.grey{background:#3c4043;color:#e8eaed}
.cbtn.grey:hover:not(:disabled){background:#5f6368}
.cbtn.red{background:#ea4335;color:#fff}
.cbtn.red:hover:not(:disabled){background:#c5221f}
.cbtn.green{background:#34a853;color:#fff;width:56px;height:56px;font-size:24px}
.cbtn.green:hover:not(:disabled){background:#188038}
.cbtn.blue{background:#8ab4f8;color:#202124}
.cbtn.blue:hover:not(:disabled){background:#aecbfa}
.cbtn-wrap{display:flex;flex-direction:column;align-items:center;gap:3px}
.cbtn-wrap span{font-size:10px;color:#9aa0a6;white-space:nowrap}

.vb-lobby{flex:1;display:flex;align-items:center;justify-content:center}
.vb-card{background:#292b2f;border-radius:16px;padding:40px 44px;width:400px;
  display:flex;flex-direction:column;gap:20px;box-shadow:0 8px 40px rgba(0,0,0,.5)}
.vb-card-title{font-size:24px;font-weight:600;color:#e8eaed}
.vb-card-sub{font-size:13px;color:#9aa0a6;margin-top:-12px}
.vb-field{display:flex;flex-direction:column;gap:5px}
.vb-flabel{font-size:11px;color:#9aa0a6;letter-spacing:.4px;text-transform:uppercase}
.vb-finput{background:#3c4043;border:1.5px solid #5f6368;border-radius:8px;
  color:#e8eaed;font-family:inherit;font-size:15px;padding:11px 13px;
  outline:none;transition:border-color .15s;width:100%}
.vb-finput:focus{border-color:#8ab4f8}
.vb-finput::placeholder{color:#5f6368}
.vb-finput:disabled{opacity:.5}
.vb-join-btn{background:#8ab4f8;color:#202124;border:none;border-radius:8px;
  font-family:inherit;font-size:15px;font-weight:600;padding:13px;
  cursor:pointer;transition:background .15s,transform .1s;width:100%}
.vb-join-btn:hover:not(:disabled){background:#aecbfa}
.vb-join-btn:active{transform:scale(.98)}
.vb-join-btn:disabled{opacity:.4;cursor:not-allowed}
.vb-hint{font-size:11px;color:#5f6368;text-align:center}

.dot{width:7px;height:7px;background:#34a853;border-radius:50%;
  animation:pulse 1.4s ease infinite;flex-shrink:0}
@keyframes pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.5;transform:scale(.7)}}
.dot.blue{background:#8ab4f8}

/* ── pending mute indicator ── */
.vb-pending-mute{
  display:inline-flex;align-items:center;gap:6px;font-size:11px;
  background:rgba(251,188,4,.15);color:#fbbc04;
  border:1px solid rgba(251,188,4,.3);
  border-radius:20px;padding:3px 10px;
}
`;

function injectCSS() {
  if (document.getElementById("vb-css")) return;
  const s = document.createElement("style");
  s.id = "vb-css";
  s.textContent = CSS;
  document.head.appendChild(s);
}

/* ── helpers ── */
const PALETTE = ["#1a73e8","#34a853","#ea4335","#fbbc04","#9334e6","#0097a7","#e91e63","#ff5722"];
function avatarColor(n=""){let h=0;for(const c of n)h=(h*31+c.charCodeAt(0))&0xffffffff;return PALETTE[Math.abs(h)%PALETTE.length]}
function initials(n=""){return n.split(" ").map(w=>w[0]).join("").toUpperCase().slice(0,2)||"?"}
function useClock(){
  const [t,setT]=useState(()=>new Date().toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"}));
  useEffect(()=>{const id=setInterval(()=>setT(new Date().toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})),10000);return()=>clearInterval(id)},[]);
  return t;
}

/* ═══════════════════════════════════════════════════════════════════════════
   APP
═══════════════════════════════════════════════════════════════════════════ */
function App() {
  injectCSS();
  const clock = useClock();

  // ── state ─────────────────────────────────────────────────────────────────
  const [roomId, setRoomId]           = useState("");
  const [name, setName]               = useState("");
  const [remoteName, setRemoteName]   = useState("");
  const [joined, setJoined]           = useState(false);
  const [status, setStatus]           = useState("");
  const [callStarted, setCallStarted] = useState(false);
  const [otherUserId, setOtherUserId] = useState(null);
  const [micMuted, setMicMuted]       = useState(false);
  const [logs, setLogs]               = useState([]);
  const [transcripts, setTranscripts] = useState([]);
  const [showLogs, setShowLogs]       = useState(false);

  // ── NEW: pending mute UI state ─────────────────────────────────────────────
  // Shows a visual indicator "Finishing speech before muting..."
  const [pendingMuteUI, setPendingMuteUI] = useState(false);

  // ── refs ──────────────────────────────────────────────────────────────────
  const localAudioRef  = useRef(null);
  const socketRef      = useRef(null);
  const localStreamRef = useRef(null);
  const roomIdRef      = useRef("");
  const micMutedRef    = useRef(false);
  const callStartedRef = useRef(false);
  const nameRef        = useRef("");
  const aaiSocketRef   = useRef(null);
  const audioCtxRef    = useRef(null);
  const processorRef   = useRef(null);

  // ── NEW: pending mute ref ──────────────────────────────────────────────────
  // true = mute was requested but we are waiting for AAI end_of_turn
  // before cutting the pipeline so no audio is lost
  const pendingMuteRef = useRef(false);

  // ── TTS queue refs ────────────────────────────────────────────────────────
  const ttsQueueRef          = useRef([]);
  const ttsPlayingRef        = useRef(false);
  const playNextFromQueueRef = useRef(null);

  // auto-scroll transcripts
  const transcriptEndRef = useRef(null);
  useEffect(()=>{ transcriptEndRef.current?.scrollIntoView({behavior:"smooth"}); },[transcripts]);

  // keep refs in sync
  useEffect(() => { micMutedRef.current    = micMuted;    }, [micMuted]);
  useEffect(() => { callStartedRef.current = callStarted; }, [callStarted]);
  useEffect(() => { nameRef.current        = name;        }, [name]);

  // ── TTS queue (unchanged) ─────────────────────────────────────────────────
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
      audio.onended = () => {
        URL.revokeObjectURL(url);
        setTimeout(() => { ttsPlayingRef.current = false; playNextFromQueueRef.current(); }, 300);
      };
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

  const addLog = (msg) =>
    setLogs((prev) => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]);

  // ── AssemblyAI Universal Streaming ────────────────────────────────────────
  async function startAssemblyAI(stream) {
    addLog("Fetching AssemblyAI token...");
    let token;
    try {
      const res = await fetch(`${SIGNALING_SERVER_URL}/assemblyai-token`, { method: "POST" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      ({ token } = await res.json());
      addLog("AssemblyAI token received.");
    } catch (err) {
      addLog("Failed to get AssemblyAI token: " + err.message);
      setStatus("Could not connect to AssemblyAI. Check server.");
      return;
    }

    const wsUrl =
      `wss://streaming.assemblyai.com/v3/ws` +
      `?sample_rate=16000&speech_model=universal-streaming-english&token=${token}`;

    const aaiWs = new WebSocket(wsUrl);
    aaiSocketRef.current = aaiWs;

    aaiWs.onopen = () => {
      addLog("AssemblyAI WS open.");
      setStatus("🎙 Listening...");

      const audioCtx  = new AudioContext({ sampleRate: 16000 });
      audioCtxRef.current = audioCtx;
      const source    = audioCtx.createMediaStreamSource(stream);
      const processor = audioCtx.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;

      processor.onaudioprocess = (e) => {
        // ── echo gate: never send while TTS is playing ──
        if (ttsPlayingRef.current) return;
        if (aaiWs.readyState !== WebSocket.OPEN) return;

        // ── decode audio chunk first (needed for both paths) ──
        const float32 = e.inputBuffer.getChannelData(0);
        const int16   = new Int16Array(float32.length);
        for (let i = 0; i < float32.length; i++)
          int16[i] = Math.max(-32768, Math.min(32767, float32[i] * 32768));

        // ── MUTE CHECK ────────────────────────────────────────────────────────
        // micMutedRef = true means user clicked mute.
        // BUT if pendingMuteRef = true it means we still need to flush
        // remaining audio to AAI before fully stopping.
        if (micMutedRef.current && !pendingMuteRef.current) {
          // Fully muted, no pending flush needed — stop immediately
          return;
        }

        if (micMutedRef.current && pendingMuteRef.current) {
          // Mute was requested but we have pending audio to flush.
          // Check if this chunk actually has real audio (not silence).
          let hasAudio = false;
          for (let i = 0; i < float32.length; i++) {
            if (Math.abs(float32[i]) > 0.01) { hasAudio = true; break; }
          }

          if (hasAudio) {
            // Real audio in chunk — send it to AAI before stopping
            aaiWs.send(int16.buffer);
            addLog("Flushed last audio chunk before mute ✅");
          }
          // Whether we sent or not — stop after this chunk.
          // The actual mic mute will be applied in onmessage
          // when AAI sends back end_of_turn for this flushed audio.
          return;
        }
        // ── END MUTE CHECK ────────────────────────────────────────────────────

        // Normal path — mic is active, send chunk
        aaiWs.send(int16.buffer);
      };

      source.connect(processor);
      processor.connect(audioCtx.destination);
    };

    aaiWs.onmessage = (msg) => {
      const data = JSON.parse(msg.data);

      if (data.type === "Begin") addLog("AssemblyAI session: " + data.id);

      // Partial transcript — show in status bar
      if (data.type === "Turn" && !data.end_of_turn && data.transcript?.trim())
        setStatus("🎙 Hearing: " + data.transcript);

      // Final transcript — send to backend for translate + TTS
      if (data.type === "Turn" && data.end_of_turn && data.transcript?.trim()) {
        const text = data.transcript.trim();
        addLog("Final: " + text);
        setStatus("🎙 Listening...");
        setTranscripts((prev) => [...prev, { from: "me", name: nameRef.current, text, ts: Date.now() }]);
        socketRef.current.emit("transcript", { roomId: roomIdRef.current, text });

        // ── ✅ APPLY PENDING MUTE after full transcript is sent ───────────────
        // This is the key fix: we waited until AAI confirmed end_of_turn
        // (meaning all audio was received and processed) BEFORE cutting the mic.
        // Now it is safe to actually mute — no audio will be lost.
        if (pendingMuteRef.current) {
          pendingMuteRef.current = false;
          setPendingMuteUI(false);
          micMutedRef.current = true;
          // Disable the hardware mic track
          localStreamRef.current?.getAudioTracks()
            .forEach(t => (t.enabled = false));
          addLog("Mic muted — all pending audio sent to AAI ✅");
        }
        // ── END PENDING MUTE ──────────────────────────────────────────────────
      }

      if (data.type === "Termination") addLog("AssemblyAI terminated.");
    };

    aaiWs.onerror = (e) => addLog("AAI WS error: " + (e.message || "unknown"));
    aaiWs.onclose = (e) => {
      addLog("AAI WS closed (" + e.code + ")");
      if (callStartedRef.current) {
        addLog("Reconnecting in 2s...");
        setTimeout(() => startAssemblyAI(localStreamRef.current), 2000);
      }
    };
  }

  function stopAssemblyAI() {
    if (aaiSocketRef.current && aaiSocketRef.current.readyState === WebSocket.OPEN) {
      try { aaiSocketRef.current.send(JSON.stringify({ type: "Terminate" })); } catch (_) {}
      aaiSocketRef.current.close();
    }
    aaiSocketRef.current = null;
    if (processorRef.current) { processorRef.current.disconnect(); processorRef.current = null; }
    if (audioCtxRef.current)  { audioCtxRef.current.close();       audioCtxRef.current  = null; }
    // Clean up pending mute state on call end
    pendingMuteRef.current = false;
    setPendingMuteUI(false);
    addLog("AssemblyAI stopped.");
  }

  // ── joinRoom (unchanged) ──────────────────────────────────────────────────
  const joinRoom = async () => {
    if (!roomId) { setStatus("Please enter a Room ID."); return; }
    roomIdRef.current = roomId;
    setStatus("Requesting microphone...");
    addLog("Requesting microphone...");
    const localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    localAudioRef.current.srcObject = localStream;
    localStreamRef.current = localStream;
    addLog("Microphone stream acquired.");
    setStatus("Connecting to signaling server...");
    addLog("Connecting to signaling server...");
    const socketUrl = SIGNALING_SERVER_URL.trim().replace(/\/+$/, "");
    const isNgrok = socketUrl.includes("ngrok");
    const socketOpts = isNgrok
      ? { transports: ["polling"], extraHeaders: { "ngrok-skip-browser-warning": "true" },
          transportOptions: { polling: { extraHeaders: { "ngrok-skip-browser-warning": "true" } } } }
      : { transports: ["websocket"] };
    const socket = io(socketUrl, socketOpts);
    socketRef.current = socket;
    addLog("Socket.io → " + socketUrl);
    socket.on("connect", () => {
      setStatus("Connected. Joining room...");
      addLog("Connected. Joining " + roomIdRef.current);
      socket.emit("join-room", { roomId: roomIdRef.current, name });
    });
    socket.on("connect_error", (err) => addLog("Socket error: " + (err.message || String(err))));
    socket.on("all-users", (users) => {
      addLog(`all-users: ${JSON.stringify(users)}`);
      if (users.length > 0) {
        const u = users[0];
        const id = typeof u === "string" ? u : u?.id;
        const n  = typeof u === "object" && u?.name ? u.name : "Remote User";
        if (id) { setOtherUserId(id); setRemoteName(n); addLog(`Peer: ${id} (${n})`); }
      }
    });
    socket.on("user-joined", ({ id, name: rn }) => {
      addLog(`Joined: ${id} (${rn || "Remote User"})`);
      setOtherUserId(id); setRemoteName(rn || "Remote User");
      setStatus("Peer in room. You can Start Call.");
    });
    socket.on("transcript", ({ from, name: fn, text, translationMs }) => {
      if (!text) return;
      setTranscripts((prev) => [...prev, { from, name: fn, text, translationMs, ts: Date.now() }]);
      addLog(`${fn}: ${text}${typeof translationMs === "number" ? ` (${translationMs}ms)` : ""}`);
    });
    socket.on("tts-audio", ({ from, name: fn, audioBase64, mimeType, ttsMs }) => {
      if (!audioBase64) return;
      addLog(`Audio from ${fn} (${ttsMs || 0}ms)`);
      enqueueAudio(audioBase64, mimeType || "audio/mpeg");
    });
    setJoined(true);
    setStatus("Joined room. Waiting for peer...");
    addLog("Joined room " + roomId);
  };

  // ── startCall (unchanged) ─────────────────────────────────────────────────
  const startCall = async () => {
    if (!otherUserId) { setStatus("No peer to call."); addLog("No peer."); return; }
    const socket = socketRef.current;
    const rid    = roomIdRef.current;
    if (!socket || !rid) return;
    setStatus("Starting call...");
    addLog("Starting call – AssemblyAI Universal Streaming.");
    setCallStarted(true);
    callStartedRef.current = true;
    await startAssemblyAI(localStreamRef.current);
  };

  // ── toggleMute — UPDATED with pending mute logic ──────────────────────────
  const toggleMute = () => {
    if (!localStreamRef.current) return;
    const tracks = localStreamRef.current.getAudioTracks();
    if (!tracks.length) return;

    if (micMuted) {
      // ── UNMUTE: instant, no checks needed ──
      tracks.forEach(t => (t.enabled = true));
      micMutedRef.current = false;
      setMicMuted(false);
      // clear any pending mute state too
      pendingMuteRef.current = false;
      setPendingMuteUI(false);
      addLog("Microphone unmuted");
    } else {
      // ── MUTE requested ────────────────────────────────────────────────────
      // Check if AAI currently has a partial transcript in flight.
      // status = "🎙 Hearing: ..." means AAI received audio but
      // end_of_turn hasn't fired yet — there is pending audio.
      const hasPendingAudio = status.startsWith("🎙 Hearing:");

      if (hasPendingAudio && callStarted) {
        // ✅ Pending audio detected — don't cut pipeline yet.
        // Set pendingMuteRef so onaudioprocess keeps flushing chunks.
        // Actual mute will be applied in onmessage after end_of_turn.
        pendingMuteRef.current = true;
        setPendingMuteUI(true);     // show yellow "Finishing..." badge in UI
        setMicMuted(true);          // show muted icon immediately (good UX)
        micMutedRef.current = true; // stop NEW audio from going in
        addLog("Mute pending — waiting for AAI to finish current sentence...");
      } else {
        // No pending audio — safe to mute immediately
        tracks.forEach(t => (t.enabled = false));
        micMutedRef.current = true;
        setMicMuted(true);
        addLog("Microphone muted");
      }
      // ── END MUTE ──────────────────────────────────────────────────────────
    }
  };

  // ── endCall (unchanged) ───────────────────────────────────────────────────
  const endCall = () => {
    callStartedRef.current = false;
    setCallStarted(false);
    stopAssemblyAI();
    setStatus("Call ended.");
    addLog("Call ended.");
  };

  /* ═══════════════════════════════════════════════════════════════════════════
     JSX
  ═══════════════════════════════════════════════════════════════════════════ */
  const isHearing = status.startsWith("🎙 Hearing:");
  const hearingSnippet = isHearing
    ? status.replace("🎙 Hearing: ", "").slice(0, 32) + (status.length > 40 ? "…" : "")
    : "";

  /* ── LOBBY ── */
  if (!joined) {
    return (
      <div className="vb-root">
        <div className="vb-topbar">
          <div style={{ display:"flex", alignItems:"center" }}>
            <span className="vb-logo">Voice<b>Bridge</b></span>
            <span className="vb-badge">EN → HI Translator</span>
          </div>
          <span className="vb-time">{clock}</span>
        </div>
        <div className="vb-lobby">
          <div className="vb-card">
            <div>
              <div className="vb-card-title">Join a call</div>
              <div className="vb-card-sub" style={{ marginTop:6 }}>
                Real-time English → Hindi translation
              </div>
            </div>
            <div className="vb-field">
              <div className="vb-flabel">Your name</div>
              <input className="vb-finput" placeholder="Enter your name"
                value={name} onChange={e => setName(e.target.value)}
                onKeyDown={e => e.key==="Enter" && roomId && name && joinRoom()} />
            </div>
            <div className="vb-field">
              <div className="vb-flabel">Room code</div>
              <input className="vb-finput" placeholder="Enter room ID"
                value={roomId} onChange={e => setRoomId(e.target.value)}
                onKeyDown={e => e.key==="Enter" && roomId && name && joinRoom()} />
            </div>
            <button className="vb-join-btn" onClick={joinRoom} disabled={!roomId || !name}>
              Join Now
            </button>
            {status && (
              <div style={{ fontSize:12, color:"#9aa0a6", textAlign:"center" }}>{status}</div>
            )}
            <div className="vb-hint">Both users must use the same Room Code</div>
          </div>
        </div>
        <audio ref={localAudioRef} autoPlay muted playsInline style={{ display:"none" }} />
      </div>
    );
  }

  /* ── IN-CALL ── */
  return (
    <div className="vb-root">

      {/* top bar */}
      <div className="vb-topbar">
        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          <span className="vb-logo">Voice<b>Bridge</b></span>
          <span className="vb-badge">EN → HI</span>
          {callStarted && (
            <span className="vb-chip">
              <span className="dot blue" /> Live Translation
            </span>
          )}
          {/* ✅ NEW: pending mute badge — shows while waiting for sentence to finish */}
          {pendingMuteUI && (
            <span className="vb-pending-mute">
              ⏳ Finishing sentence before muting...
            </span>
          )}
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:12 }}>
          {isHearing && (
            <span className="vb-chip">
              <span className="dot blue" /> {hearingSnippet}
            </span>
          )}
          {!isHearing && status && (
            <span style={{ fontSize:12, color:"#9aa0a6" }}>{status}</span>
          )}
          <span className="vb-time">{clock}</span>
        </div>
      </div>

      {/* main stage */}
      <div className="vb-stage">

        {/* tiles */}
        <div className={`vb-tiles ${otherUserId ? "duo" : "solo"}`}>

          {/* local tile */}
          <div className={`vb-tile${isHearing && !micMuted ? " lit" : ""}`}>
            <div className="vb-avatar" style={{ background: avatarColor(name) }}>
              {initials(name)}
            </div>
            {isHearing && !micMuted && (
              <div className="vb-tile-tag"><span className="dot" /> Speaking</div>
            )}
            {/* ✅ NEW: show pending badge on tile too */}
            {pendingMuteUI && (
              <div className="vb-tile-tag" style={{ top:"auto", bottom:48, color:"#fbbc04" }}>
                ⏳ Finishing...
              </div>
            )}
            <div className="vb-tile-name">
              {name || "You"}
              <span style={{ fontSize:10, color:"#9aa0a6", marginLeft:5 }}>(You)</span>
            </div>
            {micMuted && <div className="vb-tile-muted">🎙</div>}
          </div>

          {/* remote tile */}
          {otherUserId ? (
            <div className="vb-tile">
              <div className="vb-avatar" style={{ background: avatarColor(remoteName) }}>
                {initials(remoteName)}
              </div>
              <div className="vb-tile-name">{remoteName}</div>
            </div>
          ) : (
            <div className="vb-tile">
              <div className="vb-waiting">
                <div className="vb-waiting-icon">👤</div>
                <div>Waiting for someone to join…</div>
              </div>
            </div>
          )}
        </div>

        {/* side panel */}
        <div className="vb-side">
          <div className="vb-panel" style={{ flex:1 }}>
            <div className="vb-panel-hdr">
              💬 Live Transcript
              <span className="cnt">{transcripts.length} messages</span>
            </div>
            <div className="vb-transcripts">
              {transcripts.length === 0 ? (
                <div className="vb-empty">
                  Start the call and speak —<br />
                  transcripts appear here in real time.
                </div>
              ) : (
                transcripts.map((t, i) => (
                  <div key={i} className={`vb-bubble ${t.from === "me" ? "me" : "them"}`}>
                    <div className="vb-bsender">
                      {t.from === "me" ? `You (${t.name})` : t.name}
                    </div>
                    <div className="vb-btext">{t.text}</div>
                    <div className="vb-bmeta">
                      {t.ts ? new Date(t.ts).toLocaleTimeString([], { hour:"2-digit", minute:"2-digit" }) : ""}
                      {typeof t.translationMs === "number" ? ` · ${t.translationMs}ms` : ""}
                    </div>
                  </div>
                ))
              )}
              <div ref={transcriptEndRef} />
            </div>
          </div>

          <div className="vb-panel">
            <div className="vb-panel-hdr" style={{ cursor:"pointer" }}
              onClick={() => setShowLogs(v => !v)}>
              🪵 Debug Logs
              <span className="cnt">{showLogs ? "▾" : "▸"}</span>
            </div>
            {showLogs && (
              <div className="vb-logs">
                {[...logs].reverse().map((l, i) => (
                  <div key={i} className="vb-log">{l}</div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* bottom bar */}
      <div className="vb-bottombar">
        <div className="vb-bl">
          <div style={{ fontSize:13, color:"#e8eaed", fontWeight:500 }}>{roomId}</div>
          <div style={{ fontSize:11, color:"#5f6368", marginTop:2 }}>
            {otherUserId ? `${remoteName} in call` : "Waiting for peer"}
          </div>
        </div>

        <div className="vb-bc">
          {/* mute — disabled while pending mute is in progress */}
          <div className="cbtn-wrap">
            <button
              className={`cbtn ${micMuted ? "red" : "grey"}`}
              onClick={toggleMute}
              disabled={pendingMuteUI} // ← can't toggle again while finishing sentence
              title={pendingMuteUI ? "Finishing sentence..." : micMuted ? "Unmute" : "Mute"}
            >
              {pendingMuteUI ? "⏳" : micMuted ? "🔇" : "🎙"}
            </button>
            <span>{pendingMuteUI ? "Finishing..." : micMuted ? "Unmute" : "Mute"}</span>
          </div>

          {/* start / end */}
          {!callStarted ? (
            <div className="cbtn-wrap">
              <button className="cbtn green" onClick={startCall}
                disabled={!otherUserId} title="Start Call">
                📞
              </button>
              <span>Start Call</span>
            </div>
          ) : (
            <div className="cbtn-wrap">
              <button className="cbtn red" onClick={endCall}
                style={{ width:56, height:56, fontSize:24 }} title="End Call">
                📵
              </button>
              <span>End Call</span>
            </div>
          )}

          {/* logs toggle */}
          <div className="cbtn-wrap">
            <button className="cbtn grey" onClick={() => setShowLogs(v => !v)}
              title="Toggle logs">
              ℹ️
            </button>
            <span>Info</span>
          </div>
        </div>

        <div className="vb-br">
          {callStarted ? (
            <>
              <div style={{ display:"flex", alignItems:"center", gap:5, color:"#34a853", fontSize:12 }}>
                <span className="dot" /> Translating EN → HI
              </div>
              <div style={{ color:"#5f6368" }}>Powered by ElevenLabs</div>
            </>
          ) : (
            <div style={{ color:"#5f6368", fontSize:12 }}>
              {otherUserId ? "Ready to call" : "Waiting for peer"}
            </div>
          )}
        </div>
      </div>

      <audio ref={localAudioRef} autoPlay muted playsInline style={{ display:"none" }} />
    </div>
  );
}

export default App;