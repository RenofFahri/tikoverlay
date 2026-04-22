/**
 * ============================================================
 *  TikTok Live Bot v2 — server.js
 *  Express + Socket.IO — Real-time hub for dashboard & overlays
 * ============================================================
 */

const express   = require('express');
const http      = require('http');
const { Server } = require('socket.io');
const path      = require('path');
const fs        = require('fs');
const { startBot, stopBot, getBotState } = require('./bot');

const DATA_FILE = path.join(__dirname, 'data.json');
let savedState = {};
if (fs.existsSync(DATA_FILE)) {
  try {
    savedState = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch(e) {
    console.error('Failed to load data.json');
  }
}

const app  = express();
const srv  = http.createServer(app);
const io   = new Server(srv, { cors: { origin: '*' } });

// Middleware untuk melewati peringatan Ngrok (Browser Warning)
app.use((req, res, next) => {
  res.setHeader('ngrok-skip-browser-warning', 'true');
  next();
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── Overlay routes ──────────────────────────────────────────
app.get('/overlay/chat',        (_, res) => res.sendFile(path.join(__dirname, 'public/overlays/chat.html')));
app.get('/overlay/gift',        (_, res) => res.sendFile(path.join(__dirname, 'public/overlays/gift.html')));
app.get('/overlay/leaderboard', (_, res) => res.sendFile(path.join(__dirname, 'public/overlays/leaderboard.html')));

// ── In-memory state ─────────────────────────────────────────
const state = {
  connected    : false,
  username     : '',
  viewers      : 0,
  likes        : 0,
  follows      : 0,
  shares       : 0,
  chatLog      : [],      // last 200 messages
  giftLog      : [],      // last 100 gifts
  leaderboard  : {},      // { uniqueId: { username, diamonds } }
  giftGoal     : savedState.giftGoal || { target: 1000, current: 0, label: 'Goal Diamond' },
  songQueue    : [],      // [{ requester, song, id }]
  nowPlaying   : null,
  botCommands  : savedState.botCommands || [],      // custom commands [{trigger, response}]
  settings     : {
    tts: { chat: true, gift: true, join: true, follow: true, welcome: true },
    ttsVoice: '', ttsRate: 1, ttsPitch: 1, ttsVolume: 1,
    overlayTheme: 'dark',
    chatMax: 30,
    welcomeEnabled: true,
    ...savedState.settings
  }
};

function saveData() {
  try {
    const dataToSave = {
      settings: state.settings,
      botCommands: state.botCommands,
      giftGoal: state.giftGoal
    };
    fs.writeFileSync(DATA_FILE, JSON.stringify(dataToSave, null, 2));
  } catch(e) {
    console.error('Failed to save data.json', e);
  }
}

// expose io + state to bot.js
global._io    = io;
global._state = state;

// ── REST API ─────────────────────────────────────────────────

// Get full state snapshot
app.get('/api/state', (_, res) => {
  res.json({
    connected   : state.connected,
    username    : state.username,
    viewers     : state.viewers,
    likes       : state.likes,
    follows     : state.follows,
    shares      : state.shares,
    leaderboard : buildLeaderboard(),
    giftGoal    : state.giftGoal,
    songQueue   : state.songQueue,
    nowPlaying  : state.nowPlaying,
    botCommands : state.botCommands,
    settings    : state.settings,
    chatLog     : state.chatLog.slice(-50),
    giftLog     : state.giftLog.slice(-20),
  });
});

// Connect / Disconnect bot
app.post('/api/connect', async (req, res) => {
  const { username } = req.body;
  if (!username) return res.json({ ok: false, error: 'Username required' });
  try {
    await startBot(username);
    res.json({ ok: true });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

app.post('/api/disconnect', (_, res) => {
  stopBot();
  res.json({ ok: true });
});

// Gift goal
app.post('/api/gift-goal', (req, res) => {
  const { target, label } = req.body;
  state.giftGoal.target = parseInt(target) || 1000;
  state.giftGoal.label  = label || 'Goal Diamond';
  saveData();
  io.emit('giftGoal', state.giftGoal);
  res.json({ ok: true });
});

// Song queue controls
app.post('/api/song/play-next', (_, res) => {
  playNextSong();
  res.json({ ok: true, nowPlaying: state.nowPlaying });
});

app.post('/api/song/remove', (req, res) => {
  const { id } = req.body;
  state.songQueue = state.songQueue.filter(s => s.id !== id);
  io.emit('songQueue', { queue: state.songQueue, nowPlaying: state.nowPlaying });
  res.json({ ok: true });
});

app.post('/api/song/clear', (_, res) => {
  state.songQueue = [];
  state.nowPlaying = null;
  io.emit('songQueue', { queue: state.songQueue, nowPlaying: state.nowPlaying });
  res.json({ ok: true });
});

// Bot commands CRUD
app.post('/api/commands', (req, res) => {
  const { trigger, response } = req.body;
  if (!trigger || !response) return res.json({ ok: false, error: 'trigger & response required' });
  const existing = state.botCommands.find(c => c.trigger === trigger);
  if (existing) { existing.response = response; }
  else { state.botCommands.push({ trigger: trigger.toLowerCase(), response, id: Date.now() }); }
  saveData();
  io.emit('botCommands', state.botCommands);
  res.json({ ok: true });
});

app.delete('/api/commands/:id', (req, res) => {
  state.botCommands = state.botCommands.filter(c => c.id != req.params.id);
  saveData();
  io.emit('botCommands', state.botCommands);
  res.json({ ok: true });
});

// Settings
app.post('/api/settings', (req, res) => {
  Object.assign(state.settings, req.body);
  saveData();
  io.emit('settings', state.settings);
  res.json({ ok: true });
});

// Test Alert
app.post('/api/test-alert', (req, res) => {
  const { type } = req.query; // Ambil tipe dari URL: ?type=join atau ?type=follow
  
  let mockEvent = {
    type: type || 'gift',
    nickname: 'User_Testing',
    user: 'usertesting',
    ts: Date.now()
  };

  if (mockEvent.type === 'gift') {
    mockEvent.gift = 'Mawar';
    mockEvent.count = Math.floor(Math.random() * 10) + 1;
    mockEvent.diamonds = 1;
    mockEvent.giftImg = 'https://p16-sign-va.tiktokcdn.com/obj/tiktokaudio/68d6015a13c9bb2836~c5_100x100.jpeg'; 
  }

  io.emit('alertEvent', mockEvent);
  res.json({ ok: true });
});

// ── Socket.IO connections ─────────────────────────────────────
app.post('/api/leaderboard/reset', (req, res) => {
  state.leaderboard = {}; // Kosongkan data diamond
  state.likes = 0;
  state.follows = 0;
  state.shares = 0;
  
  // Reset progress di setiap user data (jika ada)
  saveData();
  
  // Beritahu semua overlay untuk update (Goal, Leaderboard, dll)
  io.emit('leaderboard', buildLeaderboard());
  io.emit('stats', { likes: 0, follows: 0, viewers: state.viewers, shares: 0 });
  
  res.json({ ok: true, message: 'Leaderboard & Goal reset successfully' });
});

io.on('connection', (socket) => {
  // Send current state to new client
  socket.emit('init', {
    connected   : state.connected,
    username    : state.username,
    viewers     : state.viewers,
    likes       : state.likes,
    follows     : state.follows,
    shares      : state.shares,
    leaderboard : buildLeaderboard(),
    giftGoal    : state.giftGoal,
    songQueue   : state.songQueue,
    nowPlaying  : state.nowPlaying,
    botCommands : state.botCommands,
    settings    : state.settings,
    chatLog     : state.chatLog.slice(-50),
    giftLog     : state.giftLog.slice(-20),
  });
});

// ── Helpers ──────────────────────────────────────────────────
function buildLeaderboard() {
  return Object.values(state.leaderboard)
    .sort((a, b) => b.diamonds - a.diamonds)
    .slice(0, 10)
    .map((u, i) => ({ rank: i + 1, ...u }));
}

function playNextSong() {
  if (state.songQueue.length === 0) {
    state.nowPlaying = null;
  } else {
    state.nowPlaying = state.songQueue.shift();
  }
  io.emit('songQueue', { queue: state.songQueue, nowPlaying: state.nowPlaying });
}

// Expose helpers for bot.js
global._buildLeaderboard = buildLeaderboard;
global._playNextSong     = playNextSong;

// ── Start server ─────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
srv.listen(PORT, () => {
  console.log('');
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║   🤖  TikTok Live Bot v2  — RUNNING          ║');
  console.log(`║   Dashboard : http://localhost:${PORT}           ║`);
  console.log(`║   Chat OVL  : http://localhost:${PORT}/overlay/chat  ║`);
  console.log(`║   Gift OVL  : http://localhost:${PORT}/overlay/gift  ║`);
  console.log(`║   LBoard OVL: http://localhost:${PORT}/overlay/leaderboard ║`);
  console.log(`║   Song OVL  : http://localhost:${PORT}/overlays/song.html ║`);
  console.log(`║   QR OVL    : http://localhost:${PORT}/overlays/qr.html ║`);
  console.log(`║   Goal OVL  : http://localhost:${PORT}/overlays/goal.html ║`);
  console.log('╚══════════════════════════════════════════════╝');
  console.log('');
});
