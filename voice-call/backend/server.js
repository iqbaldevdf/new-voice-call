require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors'); // ✅ make sure: npm install cors
const { Server } = require('socket.io');
const app = express();
const server = http.createServer(app);

// ✅ CORS FIX — must be BEFORE all route definitions
// Previously CORS was only on Socket.IO, not on Express HTTP routes.
// The /assemblyai-token route is a plain HTTP POST, so it needs this.
const corsOptions = {
  origin: [
    'http://localhost:5175',
    'http://localhost:5174',
    'https://unvaccinated-tempie-depreciatively.ngrok-free.dev'
  ],
  methods: ['GET', 'POST', 'OPTIONS'],
  credentials: true,
};
app.use(cors(corsOptions));          // ← applies to ALL express routes
app.use(express.json());

// ── ENV ───────────────────────────────────────────────────────────────────────
const ELEVENLABS_API_KEY  = process.env.ELEVENLABS_API_KEY;
const ELEVENLABS_VOICE_ID = process.env.ELEVENLABS_VOICE_ID || 'pNInz6obpgDQGcFmaJgB';
const ASSEMBLYAI_API_KEY  = process.env.ASSEMBLYAI_API_KEY || '';

// ── textToSpeech — unchanged ──────────────────────────────────────────────────
async function textToSpeech(text) {
  try {
    if (!text || typeof text !== 'string') {
      console.log('[TTS] Skip: no text');
      return null;
    }
    const trimmed = text.trim();
    if (!trimmed) {
      console.log('[TTS] Skip: empty text');
      return null;
    }
    if (!ELEVENLABS_API_KEY) {
      console.log('[TTS] Skip: ELEVENLABS_API_KEY not set');
      return null;
    }
    if (!ELEVENLABS_VOICE_ID) {
      console.log('[TTS] Skip: ELEVENLABS_VOICE_ID not set');
      return null;
    }
    if (trimmed.length > 2500) {
      console.log('[TTS] Trimming text to 2500 chars, was', trimmed.length);
    }

    const bodyText = trimmed.slice(0, 2500);
    const url = `https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}?output_format=mp3_44100_128`;

    console.log('[TTS] Requesting:', {
      url,
      textLength: bodyText.length,
      preview: bodyText.slice(0, 50) + (bodyText.length > 50 ? '...' : '')
    });

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'xi-api-key': ELEVENLABS_API_KEY,
        'Content-Type': 'application/json',
        'Accept': 'audio/mpeg',
      },
      body: JSON.stringify({
        text: bodyText,
        model_id: 'eleven_multilingual_v2',
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
          style: 0.3,
          use_speaker_boost: true
        }
      }),
      signal: AbortSignal.timeout(15000),
    });

    console.log('[TTS] Response status:', res.status, res.statusText);

    if (!res.ok) {
      const errBody = await res.text();
      console.error('[TTS] Error body:', errBody.slice(0, 300));
      throw new Error(`ElevenLabs ${res.status}: ${errBody.slice(0, 100)}`);
    }

    const buf = await res.arrayBuffer();
    const byteLength = buf.byteLength;
    console.log('[TTS] Audio received, bytes:', byteLength);

    if (byteLength === 0) {
      console.error('[TTS] Empty audio buffer');
      return null;
    }

    const base64 = Buffer.from(buf).toString('base64');
    console.log('[TTS] Base64 length:', base64.length);
    return base64;

  } catch (err) {
    console.error('[TTS] Error:', err.message || err);
    throw err;
  }
}

// ── GET /api/translate — unchanged ────────────────────────────────────────────
app.get('/api/translate', async (req, res) => {
  const text = (req.query.text || req.query.q || 'Hello').trim();
  if (!text) {
    return res.status(400).json({ ok: false, error: 'Missing query: text or q' });
  }
  try {
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=en|hi`;
    const fetchRes = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!fetchRes.ok) throw new Error(`MyMemory API returned ${fetchRes.status}`);
    const data = await fetchRes.json();
    const translated = data?.responseData?.translatedText;
    const result = (typeof translated === 'string' && translated.trim()) ? translated.trim() : null;
    return res.json({ ok: true, original: text, translated: result, from: 'en', to: 'hi' });
  } catch (err) {
    return res.status(502).json({ ok: false, error: err.message || 'Translation failed', original: text });
  }
});

// ── POST /assemblyai-token ────────────────────────────────────────────────────
app.post('/assemblyai-token', async (req, res) => {
  if (!ASSEMBLYAI_API_KEY) {
    console.error('[AAI Token] ASSEMBLYAI_API_KEY not set');
    return res.status(500).json({ error: 'ASSEMBLYAI_API_KEY not configured on server' });
  }
  try {
    const response = await fetch(
      'https://streaming.assemblyai.com/v3/token?expires_in_seconds=300',
      {
        method: 'GET',
        headers: { Authorization: ASSEMBLYAI_API_KEY },
      }
    );

    if (!response.ok) {
      const err = await response.text();
      console.error('[AAI Token] AssemblyAI error:', err);
      return res.status(500).json({ error: 'AssemblyAI token request failed' });
    }

    const data = await response.json();
    console.log('[AAI Token] Token issued successfully');
    return res.json({ token: data.token });
  } catch (err) {
    console.error('[AAI Token] Exception:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ── Socket.IO — same CORS origins ─────────────────────────────────────────────
const io = new Server(server, {
  cors: corsOptions, // ✅ reuse same options object — stays in sync
});

const rooms = {};
const userNames = {};

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
    socket.to(roomId).emit('user-joined', { id: socket.id, name });
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

  socket.on('transcript', async ({ roomId, text }) => {
    if (!roomId || !text || typeof text !== 'string') return;
    const trimmed = text.trim();
    if (!trimmed) return;

    const senderName = userNames[socket.id] || 'Unknown';
    let toSend = trimmed;
    let translationMs = 0;

    const tTranslateStart = Date.now();
    try {
      const translateUrl = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(trimmed)}&langpair=en|hi`;
      const res = await fetch(translateUrl, { signal: AbortSignal.timeout(5000) });
      if (res.ok) {
        const data = await res.json();
        const translated = data?.responseData?.translatedText;
        if (typeof translated === 'string' && translated.trim()) toSend = translated.trim();
      }
    } catch (e) {
      console.error('[transcript] Translation failed:', e.message);
    }
    translationMs = Date.now() - tTranslateStart;
    console.log('[transcript] Translation took', translationMs, 'ms');

    socket.to(roomId).emit('transcript', {
      from: socket.id,
      name: senderName,
      text: toSend,
      translationMs,
    });

    console.log('[transcript] TTS starting for text length:', toSend.length, 'room:', roomId);
    const tTtsStart = Date.now();
    let ttsMs = 0;
    try {
      const audioBase64 = await textToSpeech(toSend);
      ttsMs = Date.now() - tTtsStart;
      console.log('[transcript] TTS took', ttsMs, 'ms');
      if (audioBase64) {
        console.log('[transcript] TTS success, emitting tts-audio to room', roomId, 'base64 length:', audioBase64.length);
        socket.to(roomId).emit('tts-audio', {
          from: socket.id,
          name: senderName,
          audioBase64,
          mimeType: 'audio/mpeg',
          ttsMs,
        });
      } else {
        console.log('[transcript] TTS returned null, not emitting audio');
      }
    } catch (e) {
      ttsMs = Date.now() - tTtsStart;
      console.error('[transcript] TTS failed after', ttsMs, 'ms:', e.message, e.stack);
    }
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
  console.log(`  ElevenLabs key  : ${ELEVENLABS_API_KEY  ? '✅ set' : '❌ NOT SET'}`);
  console.log(`  AssemblyAI key  : ${ASSEMBLYAI_API_KEY  ? '✅ set' : '❌ NOT SET'}`);
  console.log(`  Voice ID        : ${ELEVENLABS_VOICE_ID}`);
});