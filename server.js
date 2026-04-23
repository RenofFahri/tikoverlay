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
const spotify = require('./spotify');

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
  spotifyNowPlaying: null, // live spotify track info
  spotifySettings: savedState.spotifySettings || {
    clientId    : '',
    clientSecret: '',
    autoPlay    : true,   // auto-play on !sr request
    deviceId    : '',
    redirectUri : '',
  },
  settings     : {
    tts: { chat: true, gift: true, join: true, follow: true, welcome: true },
    ttsVoice: '', ttsRate: 1, ttsPitch: 1, ttsVolume: 1,
    overlayTheme: 'dark',
    chatMax: 30,
    welcomeEnabled: true,
    ...savedState.settings
  }
};

// Init Spotify with saved credentials
(function initSpotify() {
  const sp = state.spotifySettings;
  if (sp.clientId && sp.clientSecret) {
    const PORT2 = process.env.PORT || 3000;
    spotify.init({
      mode        : sp.mode || 'free',
      clientId    : sp.clientId,
      clientSecret: sp.clientSecret,
      redirectUri : sp.redirectUri || `http://localhost:${PORT2}/spotify/callback`,
    });
    if (savedState.spotifyTokens) {
      spotify.setTokens(
        savedState.spotifyTokens.access,
        savedState.spotifyTokens.refresh,
        savedState.spotifyTokens.expiresIn || 3600
      );
    }
  }
})();

function saveData() {
  try {
    const authState = spotify.getAuthState();
    const dataToSave = {
      settings        : state.settings,
      botCommands     : state.botCommands,
      giftGoal        : state.giftGoal,
      spotifySettings : state.spotifySettings,
      // Save tokens only if authenticated
      spotifyTokens   : authState.isAuthenticated ? {
        access   : null, // don't save access token (ephemeral)
        refresh  : global._spotifyRefreshToken || null,
        expiresIn: 3600,
      } : null,
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

// ── Spotify API Routes (Dual Mode) ──────────────────────────

// Save Spotify credentials & set mode
app.post('/api/spotify/credentials', (req, res) => {
  const { mode, clientId, clientSecret, autoPlay, deviceId, redirectUri } = req.body;
  state.spotifySettings.mode         = mode || 'free';
  state.spotifySettings.clientId     = clientId     || '';
  state.spotifySettings.clientSecret = clientSecret || '';
  state.spotifySettings.autoPlay     = autoPlay !== false;
  state.spotifySettings.deviceId     = deviceId || '';
  
  const PORT2 = process.env.PORT || 3000;
  state.spotifySettings.redirectUri  = redirectUri || `http://localhost:${PORT2}/spotify/callback`;

  spotify.init({
    mode: state.spotifySettings.mode,
    clientId,
    clientSecret,
    redirectUri: state.spotifySettings.redirectUri,
  });
  saveData();
  
  if (state.spotifySettings.mode === 'free') {
    spotify.ensureToken().then(() => {
      io.emit('spotifyStatus', { ...spotify.getAuthState(), isConfigured: true, settings: state.spotifySettings });
      res.json({ ok: true });
    }).catch(e => {
      res.json({ ok: false, error: e.message });
    });
  } else {
    res.json({ ok: true }); // Need OAuth login next
  }
});

// Get Spotify state
app.get('/api/spotify/status', (req, res) => {
  res.json({
    ...spotify.getAuthState(),
    isConfigured   : spotify.isConfigured(),
    settings       : state.spotifySettings,
    nowPlaying     : state.spotifyNowPlaying,
  });
});

// Start OAuth (Premium)
app.get('/spotify/login', (req, res) => {
  if (!spotify.isConfigured()) return res.status(400).send('Spotify credentials not set');
  res.redirect(spotify.getAuthUrl());
});

// OAuth callback (Premium)
app.get('/spotify/callback', async (req, res) => {
  const { code, error } = req.query;
  if (error || !code) {
    return res.send(`<script>window.opener?.postMessage({spotifyAuth:'error',error:'${error||'cancelled'}'},'*');window.close();</script>`);
  }
  try {
    await spotify.exchangeCode(code);
    saveData(); // if tokens were persisted, we would save here
    io.emit('spotifyStatus', { ...spotify.getAuthState(), isConfigured: true, settings: state.spotifySettings });
    res.send(`<html><body style="background:#111;color:#1db954;font-family:Inter,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;flex-direction:column;gap:16px">
      <div style="font-size:48px">✅</div>
      <h2 style="margin:0">Spotify Premium Terhubung!</h2>
      <p style="color:#aaa">Jendela ini akan menutup otomatis...</p>
      <script>setTimeout(()=>{window.close()},2000);window.opener?.postMessage({spotifyAuth:'success'},'*');</script>
    </body></html>`);
  } catch (e) {
    res.send(`<script>window.opener?.postMessage({spotifyAuth:'error',error:'${e.message}'},'*');window.close();</script>`);
  }
});

// Logout / Disconnect
app.post('/api/spotify/logout', (req, res) => {
  spotify.clearTokens();
  state.spotifySettings.clientId = '';
  state.spotifySettings.clientSecret = '';
  state.spotifyNowPlaying = null;
  saveData();
  io.emit('spotifyStatus', { isAuthenticated: false, isConfigured: false });
  io.emit('spotifyStopPreview');
  res.json({ ok: true });
});

// Clear queue
app.delete('/api/spotify/queue', (req, res) => {
  state.songQueue = [];
  io.emit('songQueue', { queue: state.songQueue, nowPlaying: state.nowPlaying });
  res.json({ ok: true });
});

// Remove song from queue
app.delete('/api/spotify/queue/:id', (req, res) => {
  const id = parseInt(req.params.id);
  state.songQueue = state.songQueue.filter(s => s.id !== id);
  io.emit('songQueue', { queue: state.songQueue, nowPlaying: state.nowPlaying });
  res.json({ ok: true });
});

// Search tracks
app.get('/api/spotify/search', async (req, res) => {
  const { q, limit } = req.query;
  if (!q) return res.json({ ok: false, error: 'Query required' });
  try {
    const tracks = await spotify.searchTrack(q, parseInt(limit) || 6);
    res.json({ ok: true, tracks });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

// Play preview (Free Mode - local audio)
app.post('/api/spotify/play-preview', (req, res) => {
  const { track } = req.body;
  if (!track) return res.json({ ok: false, error: 'Track required' });
  state.spotifyNowPlaying = { track, isPlaying: true };
  io.emit('spotifyPlayPreview', track);
  res.json({ ok: true });
});

// Stop preview (Free Mode)
app.post('/api/spotify/stop-preview', (req, res) => {
  state.spotifyNowPlaying = null;
  io.emit('spotifyStopPreview');
  res.json({ ok: true });
});

// Play (Premium)
app.post('/api/spotify/play', async (req, res) => {
  const { uri, deviceId } = req.body;
  if (!uri) return res.json({ ok: false, error: 'URI required' });
  try {
    await spotify.playTrack(uri, deviceId || state.spotifySettings.deviceId || undefined);
    setTimeout(broadcastSpotifyState, 1000);
    res.json({ ok: true });
  } catch (e) { res.json({ ok: false, error: e.message }); }
});

// Pause (Premium)
app.post('/api/spotify/pause', async (req, res) => {
  try {
    await spotify.pause(state.spotifySettings.deviceId || undefined);
    setTimeout(broadcastSpotifyState, 500);
    res.json({ ok: true });
  } catch (e) { res.json({ ok: false, error: e.message }); }
});

// Resume (Premium)
app.post('/api/spotify/resume', async (req, res) => {
  try {
    await spotify.resume(state.spotifySettings.deviceId || undefined);
    setTimeout(broadcastSpotifyState, 500);
    res.json({ ok: true });
  } catch (e) { res.json({ ok: false, error: e.message }); }
});

// Next (Premium)
app.post('/api/spotify/next', async (req, res) => {
  try {
    await spotify.nextTrack(state.spotifySettings.deviceId || undefined);
    setTimeout(broadcastSpotifyState, 1200);
    res.json({ ok: true });
  } catch (e) { res.json({ ok: false, error: e.message }); }
});

// Prev (Premium)
app.post('/api/spotify/prev', async (req, res) => {
  try {
    await spotify.prevTrack(state.spotifySettings.deviceId || undefined);
    setTimeout(broadcastSpotifyState, 1200);
    res.json({ ok: true });
  } catch (e) { res.json({ ok: false, error: e.message }); }
});

// Volume (Premium)
app.post('/api/spotify/volume', async (req, res) => {
  const { volume } = req.body;
  try {
    await spotify.setVolume(parseInt(volume), state.spotifySettings.deviceId || undefined);
    res.json({ ok: true });
  } catch (e) { res.json({ ok: false, error: e.message }); }
});

// Devices (Premium)
app.get('/api/spotify/devices', async (req, res) => {
  try {
    const devices = await spotify.getDevices();
    res.json({ ok: true, devices });
  } catch (e) { res.json({ ok: false, error: e.message }); }
});

// Transfer (Premium)
app.post('/api/spotify/transfer', async (req, res) => {
  const { deviceId } = req.body;
  try {
    await spotify.transferPlayback(deviceId);
    state.spotifySettings.deviceId = deviceId;
    saveData();
    res.json({ ok: true });
  } catch (e) { res.json({ ok: false, error: e.message }); }
});

// Broadcast spotify state to all sockets (Premium polling)
async function broadcastSpotifyState() {
  if (state.spotifySettings.mode !== 'premium') return;
  try {
    const data = await spotify.getPlaybackState();
    if (data) {
      state.spotifyNowPlaying = data;
      io.emit('spotifyNowPlaying', data);
    }
  } catch (_) {}
}

// Expose for bot.js
global._spotify             = spotify;
global._spotifySettings     = () => state.spotifySettings;
global._io                  = io;
global._state               = state;
global._broadcastSpotify    = broadcastSpotifyState;

// Poll Spotify every 2s when authenticated in Premium mode
setInterval(async () => {
  const auth = spotify.getAuthState();
  if (auth.mode === 'premium' && auth.isAuthenticated) {
    await broadcastSpotifyState();
  }
}, 2000);

// Test Alert
app.post('/api/test-alert', (req, res) => {
  const { type } = req.query;
  const dummy = { 
    nickname: 'User_Testing', 
    uniqueId: 'usertesting', 
    profilePictureUrl: 'https://p16-sign-va.tiktokcdn.com/tos-maliva-avt-0068/7331575836486008837~c5_100x100.jpeg' 
  };
  
  let mockEvent = {
    type: type || 'gift',
    ...dummy,
    ts: Date.now()
  };

  if (type === 'gift') {
    io.emit('gift', { ...dummy, giftName: 'Rose', giftPictureUrl: 'https://p16-webcast.tiktokcdn.com/img/maliva/webcast-va/ebaad51ce9cc503f56ceb24cba4ba8ea~tplv-obj.png', diamondCount: 1, repeatCount: 10 });
  } else if (type === 'join') {
    io.emit('join', dummy);
  } else if (type === 'follow') {
    io.emit('follow', dummy);
  } else if (type === 'song') {
    io.emit('spotifyNowPlaying', {
      track: {
        name: "Dummy Song Preview",
        artists: "Virtual Band",
        albumArt: "https://i.scdn.co/image/ab67616d0000b27341e31d6ea1d493dd77933ee5"
      },
      isPlaying: true
    });
  } else if (type === 'queue') {
    io.emit('songQueue', {
      queue: [
        { id: 1, spotifyName: "First Dummy Track", spotifyArtist: "Artist One", requesterNick: "viewer1", albumArt: "https://i.scdn.co/image/ab67616d0000b27341e31d6ea1d493dd77933ee5" },
        { id: 2, spotifyName: "Second Awesome Song", spotifyArtist: "Artist Two", requesterNick: "viewer2", albumArt: "https://i.scdn.co/image/ab67616d0000b27341e31d6ea1d493dd77933ee5" },
        { id: 3, spotifyName: "Third Cool Beat", spotifyArtist: "Artist Three", requesterNick: "viewer3", albumArt: "https://i.scdn.co/image/ab67616d0000b27341e31d6ea1d493dd77933ee5" }
      ],
      nowPlaying: null
    });
  }
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
    spotifyStatus: { 
      ...spotify.getAuthState(), 
      isConfigured: spotify.isConfigured(), 
      settings: state.spotifySettings 
    }
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
  console.log(`║   Queue OVL : http://localhost:${PORT}/overlays/queue.html║`);
  console.log(`║   QR OVL    : http://localhost:${PORT}/overlays/qr.html ║`);
  console.log(`║   Goal OVL  : http://localhost:${PORT}/overlays/goal.html ║`);
  console.log('╚══════════════════════════════════════════════╝');
  console.log('');
});
