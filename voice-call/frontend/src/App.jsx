import React, { useRef, useState, useEffect, useCallback } from "react"
import io from "socket.io-client"
import { Device } from "mediasoup-client"

const socket = io("https://gk7x1xxc-3002.inc1.devtunnels.ms")

export default function App() {
  const localAudioRef = useRef(null)
  const remoteAudioRef = useRef(null)

  const deviceRef = useRef(null)
  const sendTransportRef = useRef(null)
  const recvTransportRef = useRef(null)
  const hasJoinedRef = useRef(false)
  const consumersRef = useRef({})

  const [micOn, setMicOn] = useState(true)
  const [joined, setJoined] = useState(false)
  const [status, setStatus] = useState("idle")
  const [log, setLog] = useState([])

  const addLog = (msg) => {
    console.log(msg)
    setLog(prev => [...prev.slice(-30), msg])
  }

  /* ── CONSUME REMOTE AUDIO ── */
  const consumeRemoteAudio = useCallback(async (producerSocketId) => {
    const device = deviceRef.current
    const recvTransport = recvTransportRef.current

    if (!device || !recvTransport) {
      addLog("Cannot consume — device or recv transport not ready")
      return
    }

    // Avoid duplicate consumers for same producer
    if (consumersRef.current[producerSocketId]) {
      addLog(`Already consuming producer from ${producerSocketId}`)
      return
    }

    addLog(`Consuming audio from: ${producerSocketId}`)

    const consumerParams = await new Promise(res =>
      socket.emit(
        "consume",
        {
          rtpCapabilities: device.rtpCapabilities,
          producerSocketId
        },
        res
      )
    )

    if (!consumerParams) {
      addLog("No consumer params returned")
      return
    }

    addLog(`Consumer params received: ${consumerParams.id}`)

    const consumer = await recvTransport.consume(consumerParams)

    consumersRef.current[producerSocketId] = consumer

    const remoteStream = new MediaStream()
    remoteStream.addTrack(consumer.track)
    remoteAudioRef.current.srcObject = remoteStream

    addLog("Remote audio stream attached")
  }, [])

  /* ── LISTEN FOR NEW PRODUCERS ── */
  useEffect(() => {
    socket.on("new-producer", ({ producerSocketId }) => {
      addLog(`New producer detected: ${producerSocketId}`)
      consumeRemoteAudio(producerSocketId)
    })

    socket.on("peer-disconnected", ({ socketId }) => {
      addLog(`Peer disconnected: ${socketId}`)
      if (consumersRef.current[socketId]) {
        consumersRef.current[socketId].close()
        delete consumersRef.current[socketId]
      }
      if (remoteAudioRef.current) {
        remoteAudioRef.current.srcObject = null
      }
    })

    return () => {
      socket.off("new-producer")
      socket.off("peer-disconnected")
    }
  }, [consumeRemoteAudio])

  /* ── JOIN ROOM ── */
  async function joinRoom() {
    if (hasJoinedRef.current) return
    hasJoinedRef.current = true

    try {
      setStatus("Requesting microphone...")
      addLog("Requesting microphone")

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      localAudioRef.current.srcObject = stream
      addLog("Microphone ready")

      setStatus("Joining room...")
      socket.emit("join-room", { roomId: "room1", name: "User" })

      /* GET RTP CAPABILITIES */
      setStatus("Loading device...")
      const routerRtpCapabilities = await new Promise(res =>
        socket.emit("getRtpCapabilities", res)
      )
      addLog("RTP Capabilities received")

      const device = new Device()
      await device.load({ routerRtpCapabilities })
      deviceRef.current = device
      addLog("Device loaded")

      /* CREATE SEND TRANSPORT */
      setStatus("Creating send transport...")
      const sendParams = await new Promise(res =>
        socket.emit("createTransport", { direction: "send" }, res)
      )
      addLog(`Send transport params received: ${sendParams.id}`)

      const sendTransport = device.createSendTransport(sendParams)

      sendTransport.on("connect", ({ dtlsParameters }, cb) => {
        addLog("Connecting send transport")
        socket.emit("connectTransport", {
          transportId: sendTransport.id,
          dtlsParameters
        })
        cb()
      })

      sendTransport.on("produce", ({ kind, rtpParameters }, cb) => {
        addLog("Producing audio")
        socket.emit(
          "produce",
          { transportId: sendTransport.id, kind, rtpParameters },
          ({ id }) => {
            addLog(`Producer created: ${id}`)
            cb({ id })
          }
        )
      })

      sendTransportRef.current = sendTransport

      await sendTransport.produce({
        track: stream.getAudioTracks()[0]
      })
      addLog("Audio sending started")

      /* CREATE RECEIVE TRANSPORT */
      setStatus("Creating receive transport...")
      const recvParams = await new Promise(res =>
        socket.emit("createTransport", { direction: "recv" }, res)
      )
      addLog(`Recv transport params received: ${recvParams.id}`)

      const recvTransport = device.createRecvTransport(recvParams)

      recvTransport.on("connect", ({ dtlsParameters }, cb) => {
        addLog("Connecting recv transport")
        socket.emit("connectTransport", {
          transportId: recvTransport.id,
          dtlsParameters
        })
        cb()
      })

      recvTransportRef.current = recvTransport

      /* CONSUME ANY EXISTING PRODUCERS IN THE ROOM */
      setStatus("Checking for existing peers...")
      const existingProducers = await new Promise(res =>
        socket.emit("getExistingProducers", res)
      )

      if (existingProducers && existingProducers.length > 0) {
        addLog(`Found ${existingProducers.length} existing producer(s)`)
        for (const { producerSocketId } of existingProducers) {
          await consumeRemoteAudio(producerSocketId)
        }
      } else {
        addLog("No existing producers — waiting for peers to join")
      }

      setStatus("connected")
      setJoined(true)

    } catch (err) {
      addLog(`Error: ${err.message}`)
      setStatus("error")
      hasJoinedRef.current = false
    }
  }

  /* ── MIC TOGGLE ── */
  function toggleMic() {
    const stream = localAudioRef.current?.srcObject
    if (!stream) return
    const track = stream.getAudioTracks()[0]
    track.enabled = !track.enabled
    setMicOn(track.enabled)
    addLog(`Mic ${track.enabled ? "enabled" : "muted"}`)
  }

  const statusColor = {
    idle: "#666",
    connected: "#22c55e",
    error: "#ef4444"
  }[status] || "#f59e0b"

  return (
    <div style={{
      minHeight: "100vh",
      background: "#0a0a0f",
      color: "#e8e6df",
      fontFamily: "'DM Mono', 'Courier New', monospace",
      padding: "0"
    }}>
      {/* Header */}
      <div style={{
        borderBottom: "1px solid #1e1e2e",
        padding: "20px 32px",
        display: "flex",
        alignItems: "center",
        gap: "12px",
        background: "#0d0d14"
      }}>
        <div style={{
          width: 10, height: 10,
          borderRadius: "50%",
          background: statusColor,
          boxShadow: `0 0 8px ${statusColor}`,
          flexShrink: 0
        }}/>
        <span style={{ fontSize: 13, letterSpacing: "0.15em", color: "#888", textTransform: "uppercase" }}>
          VOICE CALL
        </span>
        <span style={{ marginLeft: "auto", fontSize: 12, color: "#555", letterSpacing: "0.1em" }}>
          {status === "connected" ? "● LIVE" : status.toUpperCase()}
        </span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 0, minHeight: "calc(100vh - 61px)" }}>

        {/* Left panel — controls */}
        <div style={{
          borderRight: "1px solid #1e1e2e",
          padding: "40px 32px",
          display: "flex",
          flexDirection: "column",
          gap: "32px"
        }}>

          {/* Join button */}
          {!joined && (
            <button
              onClick={joinRoom}
              style={{
                background: "transparent",
                border: "1px solid #4ade80",
                color: "#4ade80",
                padding: "14px 28px",
                fontSize: 13,
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                cursor: "pointer",
                borderRadius: 4,
                transition: "all 0.2s",
                fontFamily: "inherit"
              }}
              onMouseEnter={e => {
                e.target.style.background = "#4ade80"
                e.target.style.color = "#0a0a0f"
              }}
              onMouseLeave={e => {
                e.target.style.background = "transparent"
                e.target.style.color = "#4ade80"
              }}
            >
              Join Room
            </button>
          )}

          {/* Mic toggle */}
          {joined && (
            <button
              onClick={toggleMic}
              style={{
                background: "transparent",
                border: `1px solid ${micOn ? "#f59e0b" : "#ef4444"}`,
                color: micOn ? "#f59e0b" : "#ef4444",
                padding: "14px 28px",
                fontSize: 13,
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                cursor: "pointer",
                borderRadius: 4,
                transition: "all 0.2s",
                fontFamily: "inherit"
              }}
            >
              {micOn ? "⬤ MIC ON — CLICK TO MUTE" : "○ MIC OFF — CLICK TO UNMUTE"}
            </button>
          )}

          {/* Audio elements */}
          <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
            <div>
              <div style={{ fontSize: 11, letterSpacing: "0.15em", color: "#555", marginBottom: 8, textTransform: "uppercase" }}>
                Local Audio (your mic)
              </div>
              <audio
                ref={localAudioRef}
                autoPlay
                muted
                controls
                style={{ width: "100%", filter: "invert(1) hue-rotate(180deg)", opacity: 0.7 }}
              />
            </div>

            <div>
              <div style={{ fontSize: 11, letterSpacing: "0.15em", color: "#555", marginBottom: 8, textTransform: "uppercase" }}>
                Remote Audio (peer)
              </div>
              <audio
                ref={remoteAudioRef}
                autoPlay
                controls
                style={{ width: "100%", filter: "invert(1) hue-rotate(180deg)", opacity: 0.7 }}
              />
            </div>
          </div>
        </div>

        {/* Right panel — logs */}
        <div style={{ padding: "40px 32px", display: "flex", flexDirection: "column" }}>
          <div style={{
            fontSize: 11,
            letterSpacing: "0.15em",
            color: "#555",
            marginBottom: 16,
            textTransform: "uppercase"
          }}>
            Event Log
          </div>
          <div style={{
            flex: 1,
            background: "#0d0d14",
            border: "1px solid #1e1e2e",
            borderRadius: 4,
            padding: "16px",
            overflow: "auto",
            maxHeight: "calc(100vh - 180px)"
          }}>
            {log.length === 0 && (
              <div style={{ color: "#333", fontSize: 12 }}>Waiting for events...</div>
            )}
            {log.map((entry, i) => (
              <div key={i} style={{
                fontSize: 12,
                color: entry.startsWith("Error") ? "#ef4444" : "#6ee7b7",
                padding: "3px 0",
                borderBottom: "1px solid #111",
                fontFamily: "inherit"
              }}>
                <span style={{ color: "#444", marginRight: 8 }}>
                  {String(i + 1).padStart(2, "0")}
                </span>
                {entry}
              </div>
            ))}
          </div>
        </div>

      </div>
    </div>
  )
}