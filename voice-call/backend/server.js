const express = require("express")
const http = require("http")
const { Server } = require("socket.io")
const mediasoup = require("mediasoup")

const app = express()
const server = http.createServer(app)

const io = new Server(server, {
  cors: { origin: "*" }
})

/* ── STATE ── */
// transports keyed as "socketId-send" and "socketId-recv"
const transports = {}

// producers keyed by socketId
const producers = {}

// consumers keyed by socketId (the consumer, not the producer owner)
const consumers = {}

// rooms: { roomId: [socketId, ...] }
const rooms = {}

let worker
let router

/* ── MEDIASOUP INIT ── */
async function startMediasoup() {
  console.log("Starting mediasoup worker...")

  worker = await mediasoup.createWorker({
    logLevel: "warn"
  })

  worker.on("died", () => {
    console.error("Mediasoup worker died — exiting")
    process.exit(1)
  })

  console.log("Worker created")

  router = await worker.createRouter({
    mediaCodecs: [
      {
        kind: "audio",
        mimeType: "audio/opus",
        clockRate: 48000,
        channels: 2
      }
    ]
  })

  console.log("Router created")
}

startMediasoup()

/* ── HELPERS ── */
function getTransport(socketId, direction) {
  return transports[`${socketId}-${direction}`]
}

function cleanupSocket(socketId) {
  // Close and delete both transports
  const sendTransport = transports[`${socketId}-send`]
  const recvTransport = transports[`${socketId}-recv`]

  if (sendTransport && !sendTransport.closed) sendTransport.close()
  if (recvTransport && !recvTransport.closed) recvTransport.close()

  delete transports[`${socketId}-send`]
  delete transports[`${socketId}-recv`]

  // Close and delete producer
  if (producers[socketId] && !producers[socketId].closed) {
    producers[socketId].close()
  }
  delete producers[socketId]

  // Close and delete consumer
  if (consumers[socketId] && !consumers[socketId].closed) {
    consumers[socketId].close()
  }
  delete consumers[socketId]
}

/* ── SOCKET ── */
io.on("connection", socket => {
  console.log("Client connected:", socket.id)

  /* JOIN ROOM */
  socket.on("join-room", ({ roomId, name }) => {
    console.log(`${name} (${socket.id}) joining ${roomId}`)

    socket.join(roomId)
    socket.roomId = roomId

    if (!rooms[roomId]) rooms[roomId] = []

    // Prevent duplicate entries (e.g. React StrictMode double-calls)
    if (!rooms[roomId].includes(socket.id)) {
      rooms[roomId].push(socket.id)
    }

    console.log("Users in room:", rooms[roomId])
  })

  /* GET RTP CAPABILITIES */
  socket.on("getRtpCapabilities", callback => {
    console.log("Sending RTP capabilities to", socket.id)
    callback(router.rtpCapabilities)
  })

  /* CREATE TRANSPORT */
  // direction = "send" | "recv"
  socket.on("createTransport", async ({ direction }, callback) => {
    console.log(`Creating ${direction} transport for ${socket.id}`)

    try {
      const transport = await router.createWebRtcTransport({
        listenIps: [
          {
            ip: "0.0.0.0",
            // Set this to your server's public IP for non-localhost deployments
            // e.g. announcedIp: "1.2.3.4"
            announcedIp: "127.0.0.1"
          }
        ],
        enableUdp: true,
        enableTcp: true,
        preferUdp: true
      })

      // Key by socketId + direction so send and recv don't collide
      transports[`${socket.id}-${direction}`] = transport

      transport.on("dtlsstatechange", dtlsState => {
        if (dtlsState === "closed") {
          transport.close()
        }
      })

      callback({
        id: transport.id,
        iceParameters: transport.iceParameters,
        iceCandidates: transport.iceCandidates,
        dtlsParameters: transport.dtlsParameters
      })
    } catch (err) {
      console.error("createTransport error:", err)
      callback({ error: err.message })
    }
  })

  /* CONNECT TRANSPORT */
  // Client sends transportId so we know exactly which one to connect
  socket.on("connectTransport", async ({ transportId, dtlsParameters }) => {
    console.log(`Connecting transport ${transportId} for ${socket.id}`)

    // Find the transport by its ID across both send and recv slots
    const sendKey = `${socket.id}-send`
    const recvKey = `${socket.id}-recv`

    let transport = null
    if (transports[sendKey] && transports[sendKey].id === transportId) {
      transport = transports[sendKey]
    } else if (transports[recvKey] && transports[recvKey].id === transportId) {
      transport = transports[recvKey]
    }

    if (!transport) {
      console.error(`Transport ${transportId} not found for ${socket.id}`)
      return
    }

    try {
      await transport.connect({ dtlsParameters })
      console.log(`Transport ${transportId} connected`)
    } catch (err) {
      console.error("connectTransport error:", err)
    }
  })

  /* PRODUCE AUDIO */
  socket.on("produce", async ({ transportId, kind, rtpParameters }, callback) => {
    console.log(`Produce request from ${socket.id} on transport ${transportId}`)

    // Always use the send transport — extra safety check via transportId
    const sendTransport = getTransport(socket.id, "send")

    if (!sendTransport || sendTransport.id !== transportId) {
      console.error("Send transport mismatch or not found")
      callback({ error: "Transport not found" })
      return
    }

    try {
      const producer = await sendTransport.produce({
        kind,
        rtpParameters,
        appData: { socketId: socket.id }
      })

      producers[socket.id] = producer

      producer.on("transportclose", () => {
        console.log(`Producer transport closed for ${socket.id}`)
        producer.close()
      })

      console.log(`Producer created: ${producer.id} for ${socket.id}`)

      callback({ id: producer.id })

      // Notify all OTHER users in the room that a new producer is available
      const roomId = socket.roomId
      if (roomId) {
        socket.to(roomId).emit("new-producer", {
          producerSocketId: socket.id
        })
        console.log(`Notified room ${roomId} of new producer from ${socket.id}`)
      }
    } catch (err) {
      console.error("produce error:", err)
      callback({ error: err.message })
    }
  })

  /* GET EXISTING PRODUCERS */
  // Called by a newly joined client to consume anyone already in the room
  socket.on("getExistingProducers", callback => {
    const roomId = socket.roomId
    if (!roomId || !rooms[roomId]) {
      callback([])
      return
    }

    const existingProducers = rooms[roomId]
      .filter(id => id !== socket.id && producers[id])
      .map(id => ({ producerSocketId: id }))

    console.log(
      `Existing producers for ${socket.id} in room ${roomId}:`,
      existingProducers.map(p => p.producerSocketId)
    )

    callback(existingProducers)
  })

  /* CONSUME AUDIO */
  socket.on("consume", async ({ rtpCapabilities, producerSocketId }, callback) => {
    console.log(`Consume request from ${socket.id} for producer of ${producerSocketId}`)

    const producer = producers[producerSocketId]

    if (!producer) {
      console.log(`No producer found for ${producerSocketId}`)
      callback(null)
      return
    }

    if (!router.canConsume({ producerId: producer.id, rtpCapabilities })) {
      console.log("Cannot consume — incompatible RTP capabilities")
      callback(null)
      return
    }

    const recvTransport = getTransport(socket.id, "recv")

    if (!recvTransport) {
      console.log(`No recv transport found for ${socket.id}`)
      callback(null)
      return
    }

    try {
      const consumer = await recvTransport.consume({
        producerId: producer.id,
        rtpCapabilities,
        paused: true
      })

      // Key consumers by "consumerId-producerSocketId" to support multi-user
      consumers[`${socket.id}-${producerSocketId}`] = consumer

      consumer.on("transportclose", () => {
        console.log(`Consumer transport closed for ${socket.id}`)
      })

      consumer.on("producerclose", () => {
        console.log(`Producer closed — consumer ${consumer.id} closed`)
        consumer.close()
        socket.emit("peer-disconnected", { socketId: producerSocketId })
      })

      await consumer.resume()
      console.log(`Consumer created and resumed: ${consumer.id}`)

      callback({
        id: consumer.id,
        producerId: producer.id,
        kind: consumer.kind,
        rtpParameters: consumer.rtpParameters
      })
    } catch (err) {
      console.error("consume error:", err)
      callback(null)
    }
  })

  /* DISCONNECT */
  socket.on("disconnect", () => {
    console.log(`Client disconnected: ${socket.id}`)

    const roomId = socket.roomId

    // Remove from room
    if (roomId && rooms[roomId]) {
      rooms[roomId] = rooms[roomId].filter(id => id !== socket.id)
      console.log(`Room ${roomId} now has:`, rooms[roomId])

      // Notify remaining peers
      socket.to(roomId).emit("peer-disconnected", { socketId: socket.id })
    }

    // Close all mediasoup resources for this socket
    cleanupSocket(socket.id)

    // Also close any consumers that were consuming this socket's producer
    Object.keys(consumers).forEach(key => {
      if (key.endsWith(`-${socket.id}`)) {
        if (consumers[key] && !consumers[key].closed) {
          consumers[key].close()
        }
        delete consumers[key]
      }
    })
  })
})

server.listen(3002, () => {
  console.log("Server running on port 3002")
})