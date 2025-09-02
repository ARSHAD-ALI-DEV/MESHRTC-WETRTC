import 'dotenv/config';
import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';

const app = express();
const PORT = process.env.PORT || 3001;
const ORIGIN = process.env.ORIGIN || 'http://localhost:5173';
const MAX_PARTICIPANTS = parseInt(process.env.MAX_PARTICIPANTS || '4', 10);

app.use(cors({ origin: ORIGIN, credentials: true }));
app.get('/', (_req, res) => res.send('Signaling server is running'));

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: ORIGIN, methods: ['GET','POST'] }
});

/**
 * Room state helpers
 */
function getRoomSize(roomId) {
  const room = io.sockets.adapter.rooms.get(roomId);
  return room ? room.size : 0;
}

io.on('connection', (socket) => {
  // For debuggability
  console.log('connected', socket.id);

  socket.on('join', ({ roomId, name }) => {
    if (!roomId) {
      socket.emit('error-message', 'Room ID is required');
      return;
    }
    const size = getRoomSize(roomId);
    if (size >= MAX_PARTICIPANTS) {
      socket.emit('room-full', { roomId, max: MAX_PARTICIPANTS });
      return;
    }

    socket.join(roomId);
    socket.data.name = name || 'Anonymous';

    // Send existing peers to the new joiner (excluding self)
    const peers = Array.from(io.sockets.adapter.rooms.get(roomId) || [])
      .filter(id => id !== socket.id);
    socket.emit('peers', peers.map(id => ({ id, name: io.sockets.sockets.get(id)?.data?.name || 'Peer' })));

    // Notify others in the room that a new peer joined
    socket.to(roomId).emit('peer-joined', { id: socket.id, name: socket.data.name });
  });

  socket.on('signal', ({ to, type, data }) => {
    if (!to || !type) return;
    io.to(to).emit('signal', { from: socket.id, type, data });
  });

  socket.on('disconnecting', () => {
    for (const roomId of socket.rooms) {
      if (roomId === socket.id) continue;
      socket.to(roomId).emit('peer-left', { id: socket.id });
    }
  });
});

server.listen(PORT, () => {
  console.log(`Signaling server listening on http://localhost:${PORT}`);
  console.log(`CORS origin: ${ORIGIN}`);
  console.log(`Max participants per room: ${MAX_PARTICIPANTS}`);
});
