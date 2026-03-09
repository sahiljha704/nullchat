/**
 * NullChat Signaling Server v2
 * ─────────────────────────────
 * Supports up to 100 people per room.
 * Uses mesh WebRTC — every peer connects directly to every other peer.
 * Server NEVER stores any messages. Only handles introductions.
 */

const http = require('http');
const { Server } = require('socket.io');

const PORT = process.env.PORT || 3000;
const MAX_ROOM_SIZE = 100;

const httpServer = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('NullChat Signaling Server v2 — running.');
});

const io = new Server(httpServer, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  maxHttpBufferSize: 1e7, // 10MB for signaling data
});

// rooms: { roomCode: { members: Map<socketId, {name, avatar}> } }
const rooms = {};

io.on('connection', (socket) => {
  console.log(`[+] Connected: ${socket.id}`);

  // ── JOIN ROOM ──
  socket.on('join-room', ({ roomCode, userName, userAvatar }) => {
    const code = roomCode.toUpperCase().trim();
    if (socket.currentRoom) leaveRoom(socket);

    if (!rooms[code]) rooms[code] = { members: new Map() };
    const room = rooms[code];

    if (room.members.size >= MAX_ROOM_SIZE) {
      socket.emit('room-full', { message: `Room is full (max ${MAX_ROOM_SIZE} people).` });
      return;
    }

    // Add to room
    socket.currentRoom = code;
    socket.userName = userName;
    socket.userAvatar = userAvatar;
    room.members.set(socket.id, { name: userName, avatar: userAvatar, id: socket.id });
    socket.join(code);

    // Tell the new person who is already in the room
    const existingPeers = [];
    room.members.forEach((peer, id) => {
      if (id !== socket.id) existingPeers.push(peer);
    });

    socket.emit('joined-room', {
      roomCode: code,
      memberCount: room.members.size,
      existingPeers, // list of everyone already here
    });

    // Tell everyone else someone new joined
    socket.to(code).emit('peer-joined', {
      peerId: socket.id,
      peerName: userName,
      peerAvatar: userAvatar,
    });

    console.log(`[ROOM] ${userName} joined ${code} (${room.members.size}/${MAX_ROOM_SIZE})`);
  });

  // ── WebRTC SIGNALING (relay only, server never reads content) ──
  socket.on('webrtc-offer', ({ offer, targetId }) => {
    io.to(targetId).emit('webrtc-offer', {
      offer,
      fromId: socket.id,
      fromName: socket.userName,
      fromAvatar: socket.userAvatar,
    });
  });

  socket.on('webrtc-answer', ({ answer, targetId }) => {
    io.to(targetId).emit('webrtc-answer', { answer, fromId: socket.id });
  });

  socket.on('ice-candidate', ({ candidate, targetId }) => {
    io.to(targetId).emit('ice-candidate', { candidate, fromId: socket.id });
  });

  // ── DISCONNECT ──
  socket.on('disconnect', () => {
    console.log(`[-] Disconnected: ${socket.id}`);
    leaveRoom(socket);
  });

  socket.on('leave-room', () => leaveRoom(socket));
});

function leaveRoom(socket) {
  const code = socket.currentRoom;
  if (!code || !rooms[code]) return;

  rooms[code].members.delete(socket.id);
  socket.to(code).emit('peer-left', {
    peerId: socket.id,
    peerName: socket.userName,
  });

  if (rooms[code].members.size === 0) {
    delete rooms[code];
    console.log(`[ROOM] ${code} deleted (empty)`);
  }

  socket.currentRoom = null;
  console.log(`[ROOM] ${socket.userName} left ${code}`);
}

httpServer.listen(PORT, () => {
  console.log(`\n✅ NullChat Server v2 on port ${PORT}`);
  console.log(`   Max room size: ${MAX_ROOM_SIZE} people`);
  console.log(`   Messages: NEVER stored\n`);
});