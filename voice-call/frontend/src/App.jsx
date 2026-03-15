
import React, { useRef, useState } from "react";
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
  const localAudioRef = useRef(null);
  const remoteAudioRef = useRef(null);
  const pcRef = useRef(null);
  const socketRef = useRef(null);
  const localStreamRef = useRef(null);

  const addLog = (msg) => {
    setLogs((prev) => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]);
  };

  const joinRoom = async () => {
    if (!roomId) {
      setStatus("Please enter a Room ID.");
      return;
    }
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
      addLog("Connected to signaling server. Joining room " + roomId);
      socket.emit("join-room", { roomId, name });
    });

    socket.on("all-users", (users) => {
      addLog(`Received all-users: ${JSON.stringify(users)}`);
      if (users.length > 0) {
        // Support both array of IDs and array of {id, name}
        let userObj = users[0];
        let id, remoteUserName;
        if (typeof userObj === "string") {
          id = userObj;
          remoteUserName = "Remote User";
          addLog(`Other user in room (legacy): ${id} (Remote User)`);
        } else if (userObj && typeof userObj === "object") {
          id = userObj.id;
          remoteUserName = userObj.name || "Remote User";
          addLog(`Other user in room: ${id} (${remoteUserName})`);
        }
        setOtherUserId(id);
        setRemoteName(remoteUserName);
      }
    });

    socket.on("offer", async ({ offer, from, name: remoteUserName }) => {
      setOtherUserId(from);
      setRemoteName(remoteUserName || "Remote User");
      setStatus("Received offer. Creating answer...");
      addLog(`Received offer from ${from} (${remoteUserName})`);
      const pc = createPeerConnection(socket, localStream);
      try {
        await pc.setRemoteDescription(new RTCSessionDescription(offer));
        addLog("Remote description set (offer)");
      } catch (err) {
        addLog("Error setting remote description (offer): " + err.message);
      }
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      addLog("Created and set local answer");
      socket.emit("answer", { answer, to: from });
      addLog("Sent answer to " + from);
      setStatus("Sent answer. Waiting for audio...");
    });

    socket.on("answer", async ({ answer, from }) => {
      setStatus("Received answer. Waiting for audio...");
      addLog(`Received answer from ${from}`);
      if (pcRef.current.signalingState === "have-local-offer") {
        try {
          await pcRef.current.setRemoteDescription(new RTCSessionDescription(answer));
          addLog("Remote description set (answer)");
        } catch (err) {
          addLog("Error setting remote description (answer): " + err.message);
        }
      } else {
        addLog("Skipped setRemoteDescription: signalingState=" + pcRef.current.signalingState);
      }
    });

    socket.on("ice-candidate", async ({ candidate, from }) => {
      addLog(`Received ICE candidate from ${from}`);
      try {
        await pcRef.current.addIceCandidate(new RTCIceCandidate(candidate));
        addLog("ICE candidate added");
      } catch (err) {
        addLog("Error adding received ICE candidate: " + err.message);
      }
    });

    setJoined(true);
    setStatus("Joined room. Waiting for peer...");
    addLog("Joined room " + roomId);
  };

  function createPeerConnection(socket, localStream) {
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });
    pcRef.current = pc;

    localStream.getTracks().forEach((track) => pc.addTrack(track, localStream));
    addLog("Added local audio tracks to peer connection");

    pc.onicecandidate = (event) => {
      if (event.candidate && otherUserId) {
        socket.emit("ice-candidate", { candidate: event.candidate, to: otherUserId });
        addLog("Sent ICE candidate to " + otherUserId);
      }
    };

    pc.ontrack = (event) => {
      remoteAudioRef.current.srcObject = event.streams[0];
      setStatus("Receiving audio from peer!");
      addLog("Received remote audio track");
    };

    return pc;
  }

  const startCall = async () => {
    if (!otherUserId) {
      setStatus("No peer to call. Wait for another user to join.");
      addLog("No peer to call. Wait for another user to join.");
      return;
    }
    setStatus("Starting call...");
    addLog("Starting call to " + otherUserId);
    const socket = socketRef.current;
    const localStream = localStreamRef.current;
    const pc = createPeerConnection(socket, localStream);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    addLog("Created and set local offer");
    socket.emit("offer", { offer, to: otherUserId, name });
    addLog("Sent offer to " + otherUserId);
    setCallStarted(true);
    setStatus("Offer sent. Waiting for answer...");
  };

  const toggleMute = () => {
    if (!localStreamRef.current) return;
    const audioTracks = localStreamRef.current.getAudioTracks();
    if (audioTracks.length === 0) return;
    if (micMuted) {
      audioTracks.forEach(track => (track.enabled = true));
      setMicMuted(false);
      addLog("Microphone unmuted");
    } else {
      audioTracks.forEach(track => (track.enabled = false));
      setMicMuted(true);
      addLog("Microphone muted");
    }
  };

  return (
    <div style={{ padding: 24 }}>
      <h2>Minimal WebRTC Voice Call (P2P)</h2>
      <div style={{ marginBottom: 16 }}>
        <label>
          Name:
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            disabled={joined}
            style={{ marginLeft: 8, marginRight: 16 }}
          />
        </label>
        <label>
          Room ID:
          <input
            value={roomId}
            onChange={e => setRoomId(e.target.value)}
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
      </div>
      <div style={{ marginTop: 24 }}>
        <div>Status: {status}</div>
        {remoteName && (
          <div style={{ marginTop: 8 }}>
            <b>Remote User:</b> {remoteName}
          </div>
        )}
        <div style={{ marginTop: 16 }}>
          <b>Local Audio:</b>
          <audio ref={localAudioRef} autoPlay muted controls style={{ width: 300 }} />
        </div>
        <div style={{ marginTop: 16 }}>
          <b>Remote Audio:</b>
          <audio ref={remoteAudioRef} autoPlay controls style={{ width: 300 }} />
        </div>
        <div style={{ marginTop: 16, maxHeight: 200, overflowY: 'auto', background: '#f7f7f7', padding: 8, borderRadius: 4 }}>
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
