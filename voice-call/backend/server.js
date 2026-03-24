require('dotenv').config();
const express = require('express');
const http    = require('http');
const cors    = require('cors');
const { Server } = require('socket.io');

const app    = express();
const server = http.createServer(app);

// ── CORS ──────────────────────────────────────────────────────────────────────
const corsOriginFn = (origin, cb) => {
  if (!origin) return cb(null, true);
  const ok =
    /^https?:\/\/localhost(:\d+)?$/.test(origin) ||
    /\.devtunnels\.ms$/.test(origin)             ||
    /\.ngrok-free\.dev$/.test(origin)            ||
    /\.ngrok\.io$/.test(origin);
  cb(null, ok);
};
const corsOptions = {
  origin:         corsOriginFn,
  methods:        ['GET', 'POST', 'OPTIONS'],
  credentials:    true,
  allowedHeaders: ['Content-Type', 'ngrok-skip-browser-warning'],
};
app.use(cors(corsOptions));
app.use(express.json());

// ── ENV ───────────────────────────────────────────────────────────────────────
const ELEVENLABS_API_KEY  = process.env.ELEVENLABS_API_KEY;
const ELEVENLABS_VOICE_ID = process.env.ELEVENLABS_VOICE_ID || 'pNInz6obpgDQGcFmaJgB';
const ASSEMBLYAI_API_KEY  = process.env.ASSEMBLYAI_API_KEY  || '';

// ── Langpair map ──────────────────────────────────────────────────────────────
const LANGPAIR_MAP = {
  hi: 'en|hi', ta: 'en|ta', te: 'en|te',
  fr: 'en|fr', de: 'en|de', es: 'en|es',
  ar: 'en|ar', zh: 'en|zh', ja: 'en|ja', ko: 'en|ko',
};

// ── In-memory stores ──────────────────────────────────────────────────────────
const rooms     = {};  // { roomId: [socketId, ...] }
const userNames = {};  // { socketId: name }
const userLangs = {};  // { socketId: targetLang }

// ── helpers ───────────────────────────────────────────────────────────────────
async function translate(text, langpair) {
  try {
    const url = `https://api.mymemory.translated.net/get` +
                `?q=${encodeURIComponent(text)}&langpair=${langpair}`;
    const res  = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`MyMemory ${res.status}`);
    const data       = await res.json();
    const translated = data?.responseData?.translatedText;
    return (typeof translated === 'string' && translated.trim())
      ? translated.trim() : text;
  } catch (e) {
    console.error('[translate] Failed:', e.message, '— using original');
    return text;
  }
}

async function textToSpeech(text) {
  if (!text?.trim() || !ELEVENLABS_API_KEY || !ELEVENLABS_VOICE_ID) return null;
  const bodyText = text.trim().slice(0, 2500);
  const url      = `https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}?output_format=mp3_44100_128`;
  const res = await fetch(url, {
    method:  'POST',
    headers: { 'xi-api-key': ELEVENLABS_API_KEY, 'Content-Type': 'application/json', 'Accept': 'audio/mpeg' },
    body:    JSON.stringify({
      text: bodyText, model_id: 'eleven_multilingual_v2',
      voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0.3, use_speaker_boost: true },
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`ElevenLabs ${res.status}: ${err.slice(0, 100)}`);
  }
  const buf = await res.arrayBuffer();
  if (buf.byteLength === 0) return null;
  return Buffer.from(buf).toString('base64');
}

// ── REST routes ───────────────────────────────────────────────────────────────
app.get('/api/translate', async (req, res) => {
  const text     = (req.query.text || req.query.q || '').trim();
  const lang     = (req.query.lang || 'hi').trim();
  const langpair = LANGPAIR_MAP[lang] || 'en|hi';
  if (!text) return res.status(400).json({ ok: false, error: 'Missing text' });
  try {
    const translated = await translate(text, langpair);
    return res.json({ ok: true, original: text, translated, from: 'en', to: lang });
  } catch (e) {
    return res.status(502).json({ ok: false, error: e.message, original: text });
  }
});

app.post('/assemblyai-token', async (req, res) => {
  if (!ASSEMBLYAI_API_KEY)
    return res.status(500).json({ error: 'ASSEMBLYAI_API_KEY not configured' });
  try {
    const response = await fetch(
      'https://streaming.assemblyai.com/v3/token?expires_in_seconds=300',
      { method: 'GET', headers: { Authorization: ASSEMBLYAI_API_KEY } }
    );
    if (!response.ok) {
      const err = await response.text();
      console.error('[AAI Token] Error:', err);
      return res.status(500).json({ error: 'AssemblyAI token request failed' });
    }
    const data = await response.json();
    return res.json({ token: data.token });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ── Socket.IO ─────────────────────────────────────────────────────────────────
const io = new Server(server, {
  cors: { origin: corsOriginFn, methods: ['GET','POST','OPTIONS'],
          credentials: true, allowedHeaders: ['Content-Type','ngrok-skip-browser-warning'] },
});

io.on('connection', (socket) => {
  console.log('[Socket.io] Connected:', socket.id);

  // ── join-room ─────────────────────────────────────────────────────────────
  socket.on('join-room', ({ roomId, name, targetLang }) => {
    const lang = targetLang || 'en';
    console.log(`[Room] "${name}" joined "${roomId}" | hearing in: ${lang}`);
    socket.join(roomId);
    if (!rooms[roomId]) rooms[roomId] = [];
    rooms[roomId].push(socket.id);
    userNames[socket.id] = name;
    userLangs[socket.id] = lang;
    socket.roomId   = roomId;
    socket.userName = name;
    socket.to(roomId).emit('user-joined', { id: socket.id, name });
    socket.emit('all-users',
      rooms[roomId].filter(id => id !== socket.id).map(id => ({ id, name: userNames[id] }))
    );
  });

  // ── update-lang — mid-call language change ────────────────────────────────
  socket.on('update-lang', ({ targetLang }) => {
    const newLang = targetLang || 'en';
    const oldLang = userLangs[socket.id] || 'en';
    userLangs[socket.id] = newLang;
    console.log(`[update-lang] "${userNames[socket.id]}" changed: ${oldLang} → ${newLang}`);
    socket.emit('lang-updated', { targetLang: newLang });
  });

  socket.on('offer',         ({ offer, to, name }) =>
    io.to(to).emit('offer',         { offer, from: socket.id, name: name || userNames[socket.id] }));
  socket.on('answer',        ({ answer, to }) =>
    io.to(to).emit('answer',        { answer, from: socket.id }));
  socket.on('ice-candidate', ({ candidate, to }) =>
    io.to(to).emit('ice-candidate', { candidate, from: socket.id }));

  // ── transcript — per-receiver translate + TTS ─────────────────────────────
  socket.on('transcript', async ({ roomId, text }) => {
    if (!roomId || !text?.trim()) return;
    const trimmed    = text.trim();
    const senderName = userNames[socket.id] || 'Unknown';
    const receivers  = (rooms[roomId] || []).filter(id => id !== socket.id);

    if (!receivers.length) return;

    console.log(`[transcript] "${senderName}": "${trimmed.slice(0, 80)}"`);
    console.log(`[transcript] receivers: ${receivers.map(id => `${userNames[id]}(${userLangs[id]})`).join(', ')}`);

    await Promise.all(receivers.map(async (receiverId) => {
      const receiverLang = userLangs[receiverId] || 'en';
      const langpair     = LANGPAIR_MAP[receiverLang];
      const tStart       = Date.now();

      // ── Step 1: Translate if needed, otherwise use original text ──────────
      // English receiver → no translation, deliver original text as-is.
      // Other languages → translate first.
      let deliveredText = trimmed;
      let translationMs = null;

      if (receiverLang !== 'en' && langpair) {
        deliveredText = await translate(trimmed, langpair);
        translationMs = Date.now() - tStart;
        console.log(`[transcript] → "${userNames[receiverId]}" (${receiverLang}): ` +
                    `"${deliveredText.slice(0, 60)}" (${translationMs}ms)`);
      } else {
        console.log(`[transcript] → "${userNames[receiverId]}" (en): no translation needed`);
      }

      // ── Step 2: Always send transcript text ───────────────────────────────
      io.to(receiverId).emit('transcript', {
        from: socket.id, name: senderName,
        text: deliveredText, translationMs,
      });

      // ── Step 3: Always send TTS audio ─────────────────────────────────────
      // FIX: Previously English receivers were skipped here with an early
      // `return` — so they got transcript text but no voice audio.
      // Now TTS runs for ALL receivers regardless of language. English
      // receivers hear TTS of the original text; others hear TTS of the
      // translated text. Both paths go through the same TTS call below.
      try {
        const audioBase64 = await textToSpeech(deliveredText);
        const ttsMs       = Date.now() - tStart - (translationMs || 0);
        if (audioBase64) {
          io.to(receiverId).emit('tts-audio', {
            from: socket.id, name: senderName,
            audioBase64, mimeType: 'audio/mpeg', ttsMs,
          });
          console.log(`[tts] → "${userNames[receiverId]}" (${receiverLang}) sent in ${ttsMs}ms`);
        }
      } catch (e) {
        console.error(`[tts] failed for "${userNames[receiverId]}":`, e.message);
      }
    }));
  });

  // ── disconnect ────────────────────────────────────────────────────────────
  socket.on('disconnect', () => {
    const { roomId } = socket;
    if (roomId && rooms[roomId]) {
      rooms[roomId] = rooms[roomId].filter(id => id !== socket.id);
      socket.to(roomId).emit('user-left', socket.id);
      if (rooms[roomId].length === 0) delete rooms[roomId];
    }
    console.log(`[Room] "${userNames[socket.id]}" left (lang was: ${userLangs[socket.id]})`);
    delete userNames[socket.id];
    delete userLangs[socket.id];
    console.log('[Socket.io] Disconnected:', socket.id);
  });
});

// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3002;
server.listen(PORT, () => {
  console.log(`\nSignaling server on port ${PORT}`);
  console.log(`  ElevenLabs key : ${ELEVENLABS_API_KEY  ? '✅ set' : '❌ NOT SET'}`);
  console.log(`  AssemblyAI key : ${ASSEMBLYAI_API_KEY  ? '✅ set' : '❌ NOT SET'}`);
  console.log(`  Voice ID       : ${ELEVENLABS_VOICE_ID}`);
  console.log(`  Languages      : en (TTS, no translation), ${Object.keys(LANGPAIR_MAP).join(', ')}\n`);
});