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

// ── MyMemory langpair map ─────────────────────────────────────────────────────
// Maps ISO targetLang code → MyMemory langpair string (always from English).
// Add more entries here to support additional languages.
const LANGPAIR_MAP = {
  hi: 'en|hi',  // Hindi
  ta: 'en|ta',  // Tamil
  te: 'en|te',  // Telugu
  fr: 'en|fr',  // French
  de: 'en|de',  // German
  es: 'en|es',  // Spanish
  ar: 'en|ar',  // Arabic
  zh: 'en|zh',  // Chinese
  ja: 'en|ja',  // Japanese
  ko: 'en|ko',  // Korean
};

// ── In-memory stores ──────────────────────────────────────────────────────────
const rooms     = {};  // { roomId: [socketId, ...] }
const userNames = {};  // { socketId: name }
const userLangs = {};  // { socketId: "en"|"hi"|"ta"|... }
//                       ↑ Each user's RECEIVER language preference.
//                         Set at join-room. Used to route translate+TTS
//                         individually per receiver when a transcript arrives.

// ── textToSpeech ──────────────────────────────────────────────────────────────
async function textToSpeech(text) {
  if (!text?.trim())        { console.log('[TTS] Skip: empty');    return null; }
  if (!ELEVENLABS_API_KEY)  { console.log('[TTS] Skip: no key');   return null; }
  if (!ELEVENLABS_VOICE_ID) { console.log('[TTS] Skip: no voice'); return null; }

  const bodyText = text.trim().slice(0, 2500);
  const url      = `https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}?output_format=mp3_44100_128`;

  console.log('[TTS] Requesting:', bodyText.slice(0, 60) + (bodyText.length > 60 ? '...' : ''));

  const res = await fetch(url, {
    method:  'POST',
    headers: {
      'xi-api-key':   ELEVENLABS_API_KEY,
      'Content-Type': 'application/json',
      'Accept':       'audio/mpeg',
    },
    body: JSON.stringify({
      text:     bodyText,
      model_id: 'eleven_multilingual_v2',
      voice_settings: {
        stability: 0.5, similarity_boost: 0.75,
        style: 0.3, use_speaker_boost: true,
      },
    }),
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error('[TTS] Error:', res.status, err.slice(0, 200));
    throw new Error(`ElevenLabs ${res.status}: ${err.slice(0, 100)}`);
  }

  const buf = await res.arrayBuffer();
  if (buf.byteLength === 0) { console.error('[TTS] Empty buffer'); return null; }
  console.log('[TTS] Done, bytes:', buf.byteLength);
  return Buffer.from(buf).toString('base64');
}

// ── translate ─────────────────────────────────────────────────────────────────
// Translates English text into the target language using MyMemory API.
// Returns translated string, or original text if translation fails.
async function translate(text, langpair) {
  try {
    const url = `https://api.mymemory.translated.net/get` +
                `?q=${encodeURIComponent(text)}&langpair=${langpair}`;
    const res  = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`MyMemory ${res.status}`);
    const data       = await res.json();
    const translated = data?.responseData?.translatedText;
    return (typeof translated === 'string' && translated.trim())
      ? translated.trim()
      : text; // fallback to original if translation empty
  } catch (e) {
    console.error('[translate] Failed:', e.message, '— using original');
    return text; // fallback to original on error
  }
}

// ── GET /api/translate ────────────────────────────────────────────────────────
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

// ── POST /assemblyai-token ────────────────────────────────────────────────────
app.post('/assemblyai-token', async (req, res) => {
  if (!ASSEMBLYAI_API_KEY) {
    console.error('[AAI Token] ASSEMBLYAI_API_KEY not set');
    return res.status(500).json({ error: 'ASSEMBLYAI_API_KEY not configured' });
  }
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
    console.log('[AAI Token] Issued successfully');
    return res.json({ token: data.token });
  } catch (err) {
    console.error('[AAI Token] Exception:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ── Socket.IO ─────────────────────────────────────────────────────────────────
const io = new Server(server, {
  cors: {
    origin:         corsOriginFn,
    methods:        ['GET', 'POST', 'OPTIONS'],
    credentials:    true,
    allowedHeaders: ['Content-Type', 'ngrok-skip-browser-warning'],
  },
});

io.on('connection', (socket) => {
  console.log('[Socket.io] Connected:', socket.id);

  // ── join-room ─────────────────────────────────────────────────────────────
  // Stores each user's targetLang preference so the transcript handler
  // knows what language to translate+TTS into for each receiver.
  socket.on('join-room', ({ roomId, name, targetLang }) => {
    const lang = targetLang || 'en';
    console.log(`[Room] "${name}" (${socket.id}) joined "${roomId}" | hearing in: ${lang}`);

    socket.join(roomId);
    if (!rooms[roomId]) rooms[roomId] = [];
    rooms[roomId].push(socket.id);

    userNames[socket.id] = name;
    userLangs[socket.id] = lang;  // ← stored receiver preference
    socket.roomId   = roomId;
    socket.userName = name;

    // Tell existing users someone joined
    socket.to(roomId).emit('user-joined', { id: socket.id, name });

    // Tell the joiner who else is already here
    socket.emit('all-users',
      rooms[roomId]
        .filter(id => id !== socket.id)
        .map(id => ({ id, name: userNames[id] }))
    );

    console.log(`[Room] "${roomId}" members:`,
      rooms[roomId].map(id => `${userNames[id]}(${userLangs[id]})`).join(', ')
    );
  });

  socket.on('offer',         ({ offer, to, name }) =>
    io.to(to).emit('offer',         { offer, from: socket.id, name: name || userNames[socket.id] }));
  socket.on('answer',        ({ answer, to }) =>
    io.to(to).emit('answer',        { answer, from: socket.id }));
  socket.on('ice-candidate', ({ candidate, to }) =>
    io.to(to).emit('ice-candidate', { candidate, from: socket.id }));

  // ── transcript ────────────────────────────────────────────────────────────
  // Called when a user's speech is transcribed (English text).
  //
  // RECEIVER-BASED ROUTING:
  //   For each OTHER user in the room, look up their stored targetLang.
  //   - targetLang = "en"  → send transcript only (no translate, no TTS)
  //   - targetLang = other → translate English → their language, then TTS,
  //                          emit transcript + tts-audio directly to their
  //                          socket ID (not a broadcast to everyone)
  //
  // Each receiver gets their own personalised translation + audio.
  socket.on('transcript', async ({ roomId, text }) => {
    if (!roomId || !text?.trim()) return;

    const trimmed    = text.trim();
    const senderName = userNames[socket.id] || 'Unknown';

    console.log(`[transcript] "${senderName}" spoke: "${trimmed.slice(0, 80)}"`);

    // Get all OTHER users in the room (not the speaker)
    const receivers = (rooms[roomId] || []).filter(id => id !== socket.id);

    if (receivers.length === 0) {
      console.log('[transcript] No receivers in room — nothing to send');
      return;
    }

    // Process each receiver independently and in parallel
    await Promise.all(receivers.map(async (receiverId) => {
      const receiverLang = userLangs[receiverId] || 'en';
      const langpair     = LANGPAIR_MAP[receiverLang];

      console.log(`[transcript] → receiver "${userNames[receiverId]}" wants: ${receiverLang}`);

      // ── BRANCH A: English — transcript only ───────────────────────────────
      // Receiver wants English. No translation needed — just send the
      // original transcript directly. Skip TTS entirely.
      if (receiverLang === 'en' || !langpair) {
        console.log(`[transcript] → ${userNames[receiverId]}: sending EN transcript only`);
        io.to(receiverId).emit('transcript', {
          from:          socket.id,
          name:          senderName,
          text:          trimmed,       // original English
          translationMs: null,
        });
        return; // no TTS for English receivers
      }

      // ── BRANCH B: Other language — translate + TTS per receiver ───────────
      // Step 1: Translate English → receiver's language
      const tTranslate  = Date.now();
      const translated  = await translate(trimmed, langpair);
      const translationMs = Date.now() - tTranslate;

      console.log(`[transcript] → ${userNames[receiverId]} (${receiverLang}): ` +
                  `"${translated.slice(0, 60)}" (${translationMs}ms)`);

      // Step 2: Send translated transcript to this receiver
      io.to(receiverId).emit('transcript', {
        from: socket.id,
        name: senderName,
        text: translated,    // already in receiver's language
        translationMs,
      });

      // Step 3: Generate TTS audio in receiver's language and send it
      const tTts = Date.now();
      try {
        const audioBase64 = await textToSpeech(translated);
        const ttsMs       = Date.now() - tTts;
        console.log(`[transcript] → ${userNames[receiverId]} TTS: ${ttsMs}ms`);

        if (audioBase64) {
          io.to(receiverId).emit('tts-audio', {
            from:        socket.id,
            name:        senderName,
            audioBase64,
            mimeType:    'audio/mpeg',
            ttsMs,
          });
        }
      } catch (e) {
        console.error(`[transcript] → ${userNames[receiverId]} TTS failed:`, e.message);
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
      console.log(`[Room] "${roomId}" — ${userNames[socket.id]} left`);
    }
    delete userNames[socket.id];
    delete userLangs[socket.id]; // clean up receiver preference
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
  console.log(`  Languages      : en (no-op), ${Object.keys(LANGPAIR_MAP).join(', ')}\n`);
});