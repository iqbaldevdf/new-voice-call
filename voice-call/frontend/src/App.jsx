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

// ── Language options (receiver side) ─────────────────────────────────────────
// "I want to HEAR speech translated into this language"
// value "en" = no translation, transcript only
const LANGUAGES = [
  { value: "en", label: "English (no translation)" },
  { value: "hi", label: "Hindi"   },
  { value: "ta", label: "Tamil"   },
  { value: "te", label: "Telugu"  },
  { value: "fr", label: "French"  },
  { value: "de", label: "German"  },
  { value: "es", label: "Spanish" },
  { value: "ar", label: "Arabic"  },
];

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
.vb-tiles.duo{grid-template-columns:1fr 1fr}
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
.vb-panel{background:#292b2f;border-radius:12px;overflow:hidden;display:flex;flex-direction:column}
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
.vb-br{min-width:160px;display:flex;flex-direction:column;align-items:flex-end;gap:2px;font-size:11px}
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
.cbtn.danger{background:#c62828;color:#fff;width:56px;height:56px;font-size:24px}
.cbtn.danger:hover:not(:disabled){background:#b71c1c}
.cbtn-wrap{display:flex;flex-direction:column;align-items:center;gap:3px}
.cbtn-wrap span{font-size:10px;color:#9aa0a6;white-space:nowrap}
.vb-lobby{flex:1;display:flex;align-items:center;justify-content:center}
.vb-card{background:#292b2f;border-radius:16px;padding:40px 44px;width:420px;
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
.vb-fselect{background:#3c4043;border:1.5px solid #5f6368;border-radius:8px;
  color:#e8eaed;font-family:inherit;font-size:15px;padding:11px 13px;
  outline:none;transition:border-color .15s;width:100%;cursor:pointer;
  appearance:none;
  background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath d='M1 1l5 5 5-5' stroke='%239aa0a6' stroke-width='1.5' fill='none' stroke-linecap='round'/%3E%3C/svg%3E");
  background-repeat:no-repeat;background-position:right 13px center}
.vb-fselect:focus{border-color:#8ab4f8}
.vb-fselect option{background:#3c4043;color:#e8eaed}
.vb-lang-badge{font-size:11px;background:#1a3a1a;color:#81c784;
  border:1px solid rgba(129,199,132,.3);
  padding:2px 9px;border-radius:4px;margin-left:4px;letter-spacing:.3px}
.vb-notrans-badge{font-size:11px;background:#2a2a3a;color:#9aa0a6;
  border:1px solid rgba(154,160,166,.2);
  padding:2px 9px;border-radius:4px;margin-left:4px;letter-spacing:.3px}
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
.vb-pending-mute{display:inline-flex;align-items:center;gap:6px;font-size:11px;
  background:rgba(251,188,4,.15);color:#fbbc04;
  border:1px solid rgba(251,188,4,.3);border-radius:20px;padding:3px 10px}
.vb-error{background:rgba(234,67,53,.15);color:#f28b82;
  border:1px solid rgba(234,67,53,.3);border-radius:8px;
  padding:10px 14px;font-size:13px;line-height:1.5;text-align:center}
`;

(function injectCSS() {
  if (document.getElementById("vb-css")) return;
  const s = document.createElement("style");
  s.id = "vb-css";
  s.textContent = CSS;
  document.head.appendChild(s);
})();

const PALETTE = ["#1a73e8","#34a853","#ea4335","#fbbc04","#9334e6","#0097a7","#e91e63","#ff5722"];
function avatarColor(n=""){let h=0;for(const c of n)h=(h*31+c.charCodeAt(0))&0xffffffff;return PALETTE[Math.abs(h)%PALETTE.length]}
function initials(n=""){return n.split(" ").map(w=>w[0]).join("").toUpperCase().slice(0,2)||"?"}
function useClock(){
  const [t,setT]=useState(()=>new Date().toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"}));
  useEffect(()=>{const id=setInterval(()=>setT(new Date().toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})),10000);return()=>clearInterval(id)},[]);
  return t;
}

function App() {
  const clock = useClock();

  const [roomId, setRoomId]               = useState("");
  const [name, setName]                   = useState("");
  const [remoteName, setRemoteName]       = useState("");
  const [joined, setJoined]               = useState(false);
  const [status, setStatus]               = useState("");
  const [otherUserId, setOtherUserId]     = useState(null);
  const [micMuted, setMicMuted]           = useState(false);
  const [logs, setLogs]                   = useState([]);
  const [transcripts, setTranscripts]     = useState([]);
  const [showLogs, setShowLogs]           = useState(false);
  const [pendingMuteUI, setPendingMuteUI] = useState(false);
  const [micError, setMicError]           = useState("");

  // ── Receiver language preference ──────────────────────────────────────────
  // "I want to HEAR other people's speech translated into this language."
  // Sent once with join-room. Server stores it and uses it when routing
  // translated audio back to this specific user.
  const [targetLang, setTargetLang] = useState("en");

  const translationActive = targetLang !== "en";
  const targetLangLabel   = LANGUAGES.find(l => l.value === targetLang)?.label || targetLang;

  // ── refs ──────────────────────────────────────────────────────────────────
  const localAudioRef    = useRef(null);
  const socketRef        = useRef(null);
  const localStreamRef   = useRef(null);
  const roomIdRef        = useRef("");
  const micMutedRef      = useRef(false);
  const callStartedRef   = useRef(false);
  const nameRef          = useRef("");
  const aaiSocketRef     = useRef(null);
  const audioCtxRef      = useRef(null);
  const workletNodeRef   = useRef(null);
  const audioActiveRef   = useRef(false);
  const pendingMuteRef   = useRef(false);

  const ttsQueueRef          = useRef([]);
  const ttsPlayingRef        = useRef(false);
  const playNextFromQueueRef = useRef(null);
  const transcriptEndRef     = useRef(null);

  useEffect(()=>{ transcriptEndRef.current?.scrollIntoView({behavior:"smooth"}); },[transcripts]);
  useEffect(()=>{ micMutedRef.current = micMuted; },[micMuted]);
  useEffect(()=>{ nameRef.current     = name;     },[name]);

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
    } catch {
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

  // ── AssemblyAI (unchanged) ────────────────────────────────────────────────
  async function startAssemblyAI(stream) {
    addLog("Fetching AssemblyAI token...");
    let token;
    try {
      const res = await fetch(`${SIGNALING_SERVER_URL}/assemblyai-token`, { method: "POST" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      ({ token } = await res.json());
      addLog("AssemblyAI token received.");
    } catch (err) {
      addLog("Failed to get AAI token: " + err.message);
      setStatus("Could not connect to AssemblyAI. Check server.");
      return;
    }

    const wsUrl =
      `wss://streaming.assemblyai.com/v3/ws` +
      `?sample_rate=16000&speech_model=universal-streaming-english&token=${token}`;

    const aaiWs = new WebSocket(wsUrl);
    aaiSocketRef.current  = aaiWs;
    callStartedRef.current = true;

    aaiWs.onopen = async () => {
      addLog("AssemblyAI WS open.");
      setStatus("🎙 Listening...");

      const audioCtx = new AudioContext({ sampleRate: 16000 });
      audioCtxRef.current = audioCtx;
      if (audioCtx.state === "suspended") { await audioCtx.resume(); }

      try {
        await audioCtx.audioWorklet.addModule("/audio-processor.js");
      } catch (err) {
        addLog("AudioWorklet load failed: " + err.message);
        return;
      }

      const source      = audioCtx.createMediaStreamSource(stream);
      const workletNode = new AudioWorkletNode(audioCtx, "pcm-processor");
      workletNodeRef.current = workletNode;
      source.connect(workletNode);
      workletNode.connect(audioCtx.destination);

      workletNode.port.onmessage = (event) => {
        const int16Buffer = event.data;
        if (ttsPlayingRef.current) return;
        if (aaiWs.readyState !== WebSocket.OPEN) return;

        const int16View = new Int16Array(int16Buffer);
        let hasAudio = false;
        for (let i = 0; i < int16View.length; i++) {
          if (Math.abs(int16View[i]) > 327) { hasAudio = true; break; }
        }

        if (micMutedRef.current && !pendingMuteRef.current) return;
        if (micMutedRef.current && pendingMuteRef.current) {
          if (hasAudio) { aaiWs.send(int16Buffer); addLog("🔁 Flushed last chunk before mute"); }
          return;
        }

        audioActiveRef.current = hasAudio;
        aaiWs.send(int16Buffer);
      };

      addLog("AudioWorklet pipeline active.");
    };

    aaiWs.onmessage = (msg) => {
      const data = JSON.parse(msg.data);
      if (data.type === "Begin") addLog("AAI session: " + data.id);

      if (data.type === "Turn" && !data.end_of_turn && data.transcript?.trim())
        setStatus("🎙 Hearing: " + data.transcript);

      if (data.type === "Turn" && data.end_of_turn && data.transcript?.trim()) {
        const text = data.transcript.trim();
        addLog("Final: " + text);
        setStatus("🎙 Listening...");
        audioActiveRef.current = false;

        // Show own speech locally (always English — we are the speaker)
        setTranscripts((prev) => [...prev, {
          from: "me", name: nameRef.current, text, ts: Date.now()
        }]);

        // ── Send transcript to server ─────────────────────────────────────
        // NO targetLang here — server knows each receiver's preference
        // from when they called join-room. Server will translate+TTS
        // individually for each receiver based on their stored preference.
        socketRef.current.emit("transcript", {
          roomId: roomIdRef.current,
          text,
        });
        addLog("Sent transcript to server: " + text);

        if (pendingMuteRef.current) {
          pendingMuteRef.current = false;
          setPendingMuteUI(false);
          micMutedRef.current = true;
          localStreamRef.current?.getAudioTracks().forEach(t => (t.enabled = false));
          addLog("✅ Mic muted after flush");
        }
      }

      if (data.type === "Termination") addLog("AAI terminated.");
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
    callStartedRef.current = false;
    if (aaiSocketRef.current && aaiSocketRef.current.readyState === WebSocket.OPEN) {
      try { aaiSocketRef.current.send(JSON.stringify({ type: "Terminate" })); } catch (_) {}
      aaiSocketRef.current.close();
    }
    aaiSocketRef.current = null;
    if (workletNodeRef.current) {
      workletNodeRef.current.port.onmessage = null;
      workletNodeRef.current.disconnect();
      workletNodeRef.current = null;
    }
    if (audioCtxRef.current) { audioCtxRef.current.close(); audioCtxRef.current = null; }
    audioActiveRef.current = false;
    pendingMuteRef.current = false;
    setPendingMuteUI(false);
  }

  // ── joinRoom ──────────────────────────────────────────────────────────────
  const joinRoom = async () => {
    if (!roomId || !name) { setStatus("Please enter name and room."); return; }
    roomIdRef.current = roomId;
    nameRef.current   = name;

    setMicError("");
    setStatus("Requesting microphone...");
    addLog("Requesting microphone...");

    let localStream;
    try {
      localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      let msg = "Could not access microphone.";
      if (err.name === "NotAllowedError"    || err.name === "PermissionDeniedError")
        msg = "Microphone access denied. Allow mic permission in your browser settings and try again.";
      else if (err.name === "NotFoundError" || err.name === "DevicesNotFoundError")
        msg = "No microphone found. Connect a microphone and try again.";
      else if (err.name === "NotReadableError" || err.name === "TrackStartError")
        msg = "Microphone is in use by another app. Close it and try again.";
      else if (err.name === "OverconstrainedError")
        msg = "Microphone does not meet requirements. Try a different mic.";
      else
        msg = `Microphone error: ${err.message || err.name}`;
      setMicError(msg);
      setStatus("");
      addLog("getUserMedia failed: " + err.name);
      return;
    }

    localAudioRef.current.srcObject = localStream;
    localStreamRef.current = localStream;
    addLog("Microphone acquired.");

    setStatus("Connecting...");
    const socketUrl  = SIGNALING_SERVER_URL.trim().replace(/\/+$/, "");
    const isNgrok    = socketUrl.includes("ngrok");
    const socketOpts = isNgrok
      ? { transports: ["polling"], extraHeaders: { "ngrok-skip-browser-warning": "true" },
          transportOptions: { polling: { extraHeaders: { "ngrok-skip-browser-warning": "true" } } } }
      : { transports: ["websocket"] };

    const socket = io(socketUrl, socketOpts);
    socketRef.current = socket;

    socket.on("connect", () => {
      addLog("Connected. Joining room " + roomIdRef.current);
      setStatus("Joined. Speak now — listening in real time.");

      // ── Send targetLang ONCE with join-room ───────────────────────────────
      // Server stores this as the receiver's language preference.
      // When ANYONE in the room speaks, server will translate+TTS
      // specifically for this user based on this preference.
      socket.emit("join-room", {
        roomId:     roomIdRef.current,
        name,
        targetLang,   // ← "I want to HEAR translations in this language"
      });
    });

    socket.on("connect_error", (err) => addLog("Socket error: " + (err.message || String(err))));

    socket.on("all-users", (users) => {
      if (users.length > 0) {
        const u  = users[0];
        const id = typeof u === "string" ? u : u?.id;
        const n  = typeof u === "object" && u?.name ? u.name : "Remote User";
        if (id) { setOtherUserId(id); setRemoteName(n); addLog(`Peer: ${id} (${n})`); }
      }
    });

    socket.on("user-joined", ({ id, name: rn }) => {
      addLog(`${rn || "Remote User"} joined.`);
      setOtherUserId(id);
      setRemoteName(rn || "Remote User");
    });

    // Receive transcript — text is already in OUR preferred language
    // (server translated it for us based on our targetLang)
    socket.on("transcript", ({ from, name: fn, text, translationMs }) => {
      if (!text) return;
      setTranscripts((prev) => [...prev, { from, name: fn, text, translationMs, ts: Date.now() }]);
      addLog(`${fn}: ${text}${typeof translationMs === "number" ? ` (${translationMs}ms)` : ""}`);
    });

    // Receive TTS audio — audio is already in OUR preferred language
    socket.on("tts-audio", ({ from, name: fn, audioBase64, mimeType, ttsMs }) => {
      if (!audioBase64) return;
      addLog(`Audio from ${fn} (${ttsMs || 0}ms)`);
      enqueueAudio(audioBase64, mimeType || "audio/mpeg");
    });

    setJoined(true);
    addLog("Auto-starting AssemblyAI STT...");
    await startAssemblyAI(localStream);
  };

  // ── toggleMute ────────────────────────────────────────────────────────────
  const toggleMute = () => {
    if (!localStreamRef.current) return;
    const tracks = localStreamRef.current.getAudioTracks();
    if (!tracks.length) return;

    if (micMuted) {
      tracks.forEach(t => (t.enabled = true));
      micMutedRef.current    = false;
      audioActiveRef.current = false;
      pendingMuteRef.current = false;
      setPendingMuteUI(false);
      setMicMuted(false);
      addLog("Microphone unmuted");
    } else {
      const hasPendingAudio =
        status.startsWith("🎙 Hearing:") || audioActiveRef.current;
      if (hasPendingAudio) {
        pendingMuteRef.current = true;
        setPendingMuteUI(true);
        setMicMuted(true);
        micMutedRef.current = true;
        addLog("⏳ Mute deferred — flushing sentence...");
      } else {
        tracks.forEach(t => (t.enabled = false));
        micMutedRef.current    = true;
        audioActiveRef.current = false;
        setMicMuted(true);
        addLog("🔇 Microphone muted");
      }
    }
  };

  // ── endCall / leave ───────────────────────────────────────────────────────
  const endCall = () => {
    stopAssemblyAI();
    if (socketRef.current) { socketRef.current.disconnect(); socketRef.current = null; }
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(t => t.stop());
      localStreamRef.current = null;
    }
    setJoined(false);
    setOtherUserId(null);
    setRemoteName("");
    setTranscripts([]);
    setMicMuted(false);
    micMutedRef.current = false;
    setStatus("");
    addLog("Left call.");
  };

  const isHearing      = status.startsWith("🎙 Hearing:");
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
            <span className="vb-badge">Real-time Translator</span>
          </div>
          <span className="vb-time">{clock}</span>
        </div>

        <div className="vb-lobby">
          <div className="vb-card">
            <div>
              <div className="vb-card-title">Join a call</div>
              <div className="vb-card-sub" style={{ marginTop:6 }}>
                Choose the language you want to hear others translated into
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

            {/* ── Receiver language selector ── */}
            <div className="vb-field">
              <div className="vb-flabel">I want to hear others in</div>
              <select
                className="vb-fselect"
                value={targetLang}
                onChange={e => setTargetLang(e.target.value)}
              >
                {LANGUAGES.map(l => (
                  <option key={l.value} value={l.value}>{l.label}</option>
                ))}
              </select>
              <div style={{ fontSize:11, color:"#5f6368", marginTop:4 }}>
                {targetLang === "en"
                  ? "Others' speech will appear as transcript only — no audio translation"
                  : `Others' English speech will be translated to ${targetLangLabel} and played to you`}
              </div>
            </div>

            <button className="vb-join-btn" onClick={joinRoom} disabled={!roomId || !name}>
              Join &amp; Start Speaking
            </button>

            {micError && <div className="vb-error">🎙 {micError}</div>}
            {status && !micError && (
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
      <div className="vb-topbar">
        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          <span className="vb-logo">Voice<b>Bridge</b></span>
          {translationActive
            ? <span className="vb-lang-badge">Hearing EN → {targetLang.toUpperCase()}</span>
            : <span className="vb-notrans-badge">Transcript only</span>
          }
          {pendingMuteUI && (
            <span className="vb-pending-mute">⏳ Finishing sentence...</span>
          )}
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:12 }}>
          {isHearing && (
            <span className="vb-chip"><span className="dot blue" /> {hearingSnippet}</span>
          )}
          {!isHearing && status && (
            <span style={{ fontSize:12, color:"#9aa0a6" }}>{status}</span>
          )}
          <span className="vb-time">{clock}</span>
        </div>
      </div>

      <div className="vb-stage">
        <div className={`vb-tiles ${otherUserId ? "duo" : "solo"}`}>
          <div className={`vb-tile${isHearing && !micMuted ? " lit" : ""}`}>
            <div className="vb-avatar" style={{ background: avatarColor(name) }}>{initials(name)}</div>
            {isHearing && !micMuted && (
              <div className="vb-tile-tag"><span className="dot" /> Speaking</div>
            )}
            {pendingMuteUI && (
              <div className="vb-tile-tag" style={{ color:"#fbbc04" }}>⏳ Finishing...</div>
            )}
            <div className="vb-tile-name">
              {name || "You"}
              <span style={{ fontSize:10, color:"#9aa0a6", marginLeft:5 }}>(You)</span>
            </div>
            {micMuted && <div className="vb-tile-muted">🎙</div>}
          </div>

          {otherUserId ? (
            <div className="vb-tile">
              <div className="vb-avatar" style={{ background: avatarColor(remoteName) }}>{initials(remoteName)}</div>
              <div className="vb-tile-name">{remoteName}</div>
            </div>
          ) : (
            <div className="vb-tile">
              <div className="vb-waiting">
                <div className="vb-waiting-icon">👤</div>
                <div>Waiting for peer to join…</div>
              </div>
            </div>
          )}
        </div>

        <div className="vb-side">
          <div className="vb-panel" style={{ flex:1 }}>
            <div className="vb-panel-hdr">
              💬 Live Transcript
              <span className="cnt">{transcripts.length} messages</span>
            </div>
            <div className="vb-transcripts">
              {transcripts.length === 0 ? (
                <div className="vb-empty">
                  Speak now —<br />
                  {translationActive
                    ? `others' speech will be translated to ${targetLangLabel} for you`
                    : "speech appears here as transcript"}
                </div>
              ) : (
                transcripts.map((t, i) => (
                  <div key={i} className={`vb-bubble ${t.from === "me" ? "me" : "them"}`}>
                    <div className="vb-bsender">{t.from === "me" ? `You (${t.name})` : t.name}</div>
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
            <div className="vb-panel-hdr" style={{ cursor:"pointer" }} onClick={() => setShowLogs(v => !v)}>
              🪵 Debug Logs <span className="cnt">{showLogs ? "▾" : "▸"}</span>
            </div>
            {showLogs && (
              <div className="vb-logs">
                {[...logs].reverse().map((l, i) => <div key={i} className="vb-log">{l}</div>)}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="vb-bottombar">
        <div className="vb-bl">
          <div style={{ fontSize:13, color:"#e8eaed", fontWeight:500 }}>{roomId}</div>
          <div style={{ fontSize:11, color:"#5f6368", marginTop:2 }}>
            {otherUserId ? `${remoteName} in call` : "Waiting for peer"}
          </div>
        </div>

        <div className="vb-bc">
          <div className="cbtn-wrap">
            <button
              className={`cbtn ${micMuted ? "red" : "grey"}`}
              onClick={toggleMute}
              disabled={pendingMuteUI}
              title={pendingMuteUI ? "Finishing sentence..." : micMuted ? "Unmute" : "Mute"}
            >
              {pendingMuteUI ? "⏳" : micMuted ? "🔇" : "🎙"}
            </button>
            <span>{pendingMuteUI ? "Finishing..." : micMuted ? "Unmute" : "Mute"}</span>
          </div>

          <div className="cbtn-wrap">
            <button className="cbtn danger" onClick={endCall} title="Leave call">📵</button>
            <span>Leave</span>
          </div>

          <div className="cbtn-wrap">
            <button className="cbtn grey" onClick={() => setShowLogs(v => !v)} title="Toggle logs">ℹ️</button>
            <span>Info</span>
          </div>
        </div>

        <div className="vb-br">
          {translationActive ? (
            <>
              <div style={{ display:"flex", alignItems:"center", gap:5, color:"#34a853", fontSize:12 }}>
                <span className="dot" /> Hearing in {targetLangLabel}
              </div>
              <div style={{ color:"#5f6368" }}>Powered by ElevenLabs</div>
            </>
          ) : (
            <div style={{ color:"#5f6368", fontSize:12 }}>Transcript only</div>
          )}
        </div>
      </div>

      <audio ref={localAudioRef} autoPlay muted playsInline style={{ display:"none" }} />
    </div>
  );
}

export default App;