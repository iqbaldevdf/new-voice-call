const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: [
      'http://localhost:5175',
      'https://unvaccinated-tempie-depreciatively.ngrok-free.dev'
    ],
    methods: ['GET', 'POST'],
    credentials: true,
  },
});

// In-memory room management for multi-user
const rooms = {};
const userNames = {}; // { socketId: name }

io.on('connection', (socket) => {
  console.log('[Socket.io] Connected:', socket.id);

  socket.on('join-room', ({ roomId, name }) => {
    console.log(`[Signaling] ${socket.id} joining room: ${roomId} as ${name}`);
    socket.join(roomId);
    if (!rooms[roomId]) rooms[roomId] = [];
    rooms[roomId].push(socket.id);
    userNames[socket.id] = name;
    socket.roomId = roomId;
    socket.userName = name;
    // Notify all users in the room (except the joining one) about the new user
    socket.to(roomId).emit('user-joined', { id: socket.id, name });
    // Send back list of all other users (with names) to the joining user
    socket.emit('all-users', rooms[roomId]
      .filter(id => id !== socket.id)
      .map(id => ({ id, name: userNames[id] }))
    );
    console.log(`[Signaling] Room ${roomId} users:`, rooms[roomId].map(id => ({ id, name: userNames[id] })));
  });

  socket.on('offer', ({ offer, to, name }) => {
    console.log(`[Signaling] Offer from ${socket.id} (${userNames[socket.id]}) to ${to}`);
    io.to(to).emit('offer', { offer, from: socket.id, name: name || userNames[socket.id] });
  });

  socket.on('answer', ({ answer, to }) => {
    console.log(`[Signaling] Answer from ${socket.id} to ${to}`);
    io.to(to).emit('answer', { answer, from: socket.id });
  });

  socket.on('ice-candidate', ({ candidate, to }) => {
    console.log(`[Signaling] ICE candidate from ${socket.id} to ${to}`);
    io.to(to).emit('ice-candidate', { candidate, from: socket.id });
  });

  socket.on('disconnect', () => {
    const { roomId } = socket;
    if (roomId && rooms[roomId]) {
      rooms[roomId] = rooms[roomId].filter(id => id !== socket.id);
      socket.to(roomId).emit('user-left', socket.id);
      if (rooms[roomId].length === 0) delete rooms[roomId];
      console.log(`[Signaling] ${socket.id} (${userNames[socket.id]}) left room: ${roomId}`);
    }
    delete userNames[socket.id];
    console.log('[Socket.io] Disconnected:', socket.id);
  });
});

const PORT = process.env.PORT || 3002;
server.listen(PORT, () => {
  console.log(`Signaling server listening on port ${PORT}`);
});
