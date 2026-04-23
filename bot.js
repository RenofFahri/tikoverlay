/**
 * ============================================================
 *  TikTok Live Bot v2 — bot.js
 *  TikTok Live Connector + event handling + bot commands
 * ============================================================
 */

const { WebcastPushConnection } = require('tiktok-live-connector');

let connection = null;
let reconnectTimer = null;
let currentUsername = '';

// ── Built-in bot commands ────────────────────────────────────
const BUILT_IN_COMMANDS = {
  '!sr': handleSongRequest,
  '!lagu': handleSongRequest,
  '!req': handleSongRequest,
  '!q': handleQueueCmd,
  '!queue': handleQueueCmd,
  '!np': handleNowPlayingCmd,
  '!skip': handleSkipCmd,
  '!help': handleHelpCmd,
  '!bot': handleHelpCmd,
};

// ── Start bot ────────────────────────────────────────────────
async function startBot(username) {
  if (connection) {
    try { connection.disconnect(); } catch (_) { }
    connection = null;
  }

  currentUsername = username;
  const state = global._state;
  const io = global._io;

  // Reset per-session stats
  state.viewers = 0;
  state.likes = 0;
  state.follows = 0;
  state.shares = 0;
  state.leaderboard = {};
  state.giftGoal.current = 0;

  const connectionOptions = {
    processInitialData: false,
    enableExtendedGiftInfo: true,
    enableWebsocketUpgrade: true,
    requestPollingIntervalMs: 1000,
    clientParams: {
      app_language: 'id-ID',
      device_platform: 'web',
    }
  };

  if (state.settings && state.settings.sessionId) {
    connectionOptions.sessionId = state.settings.sessionId;
  }

  if (state.settings && state.settings.proxy) {
    connectionOptions.requestOptions = {
      proxy: state.settings.proxy
    };
  }

  connection = new WebcastPushConnection(username, connectionOptions);

  // ── CONNECTED ──────────────────────────────────────────────
  const liveState = await connection.connect();
  state.connected = true;
  state.username = username;
  state.viewers = liveState.viewerCount || 0;

  io.emit('botStatus', { connected: true, username, viewers: state.viewers });
  io.emit('stats', { viewers: state.viewers, likes: state.likes, follows: state.follows, shares: state.shares });

  log(`✅ Connected to @${username} | Viewers: ${state.viewers}`);

  // ── CHAT ──────────────────────────────────────────────────
  connection.on('chat', (data) => {
    const user = data.uniqueId || 'Unknown';
    const nickname = data.nickname || user;
    const msg = data.comment || '';
    const verified = data.isModerator || data.isSubscriber || false;
    const avatar = data.profilePictureUrl || '';
    const badges = [];
    if (data.isModerator) badges.push('mod');
    if (data.isSubscriber) badges.push('sub');
    if (data.isNewGifter) badges.push('gifter');

    const event = { type: 'chat', user, nickname, msg, verified, avatar, badges, ts: Date.now() };

    try {
      // Check bot commands
      handleCommand(event);
      pushChat(event);
    } catch (e) {
      console.error('Error handling chat event:', e);
    }

    log(`💬 @${user}: ${msg}`);
  });

  // ── GIFT ──────────────────────────────────────────────────
  connection.on('gift', (data) => {
    const user = data.uniqueId || 'Unknown';
    const nickname = data.nickname || user;
    const gift = data.giftName || `Gift#${data.giftId}`;
    const count = data.repeatCount || 1;
    const diamonds = (data.diamondCount || 0) * count;
    const giftImg = data.giftPictureUrl || '';
    const verified = data.isModerator || false;

    if (data.repeatEnd || !data.repeatCount) {
      // Update leaderboard
      if (!state.leaderboard[user]) {
        state.leaderboard[user] = { username: user, nickname, diamonds: 0 };
      }
      state.leaderboard[user].diamonds += diamonds;

      // Gift goal
      state.giftGoal.current += diamonds;

      const event = { type: 'gift', user, nickname, gift, count, diamonds, giftImg, verified, ts: Date.now() };
      pushGift(event);
      io.emit('giftGoal', state.giftGoal);
      io.emit('leaderboard', global._buildLeaderboard());
      log(`🎁 @${user} → ${gift} x${count} (💎${diamonds})`);
    }
  });

  // ── MEMBER / JOIN ─────────────────────────────────────────
  connection.on('member', (data) => {
    const user = data.uniqueId || 'Unknown';
    const nickname = data.nickname || user;
    const avatar = data.profilePictureUrl || '';
    const event = { type: 'join', user, nickname, avatar, ts: Date.now() };

    pushChat(event);
    io.emit('alertEvent', event); // Kirim ke overlay Alert
    log(`👋 @${user} joined`);
  });

  // ── FOLLOW / SHARE ──────────────────────────────────────────
  connection.on('social', (data) => {
    const user = data.uniqueId || 'Unknown';
    const nickname = data.nickname || user;
    const avatar = data.profilePictureUrl || '';
    
    if (data.displayType === 'pm_mt_msg_viewer_follow' || data.displayType?.includes('follow')) {
      state.follows++;
      const event = { type: 'follow', user, nickname, avatar, ts: Date.now() };
      pushChat(event);
      io.emit('alertEvent', event); // Kirim ke overlay Alert
      io.emit('stats', { viewers: state.viewers, likes: state.likes, follows: state.follows, shares: state.shares });
      log(`❤️  @${user} followed`);
    }
    
    if (data.displayType?.includes('share')) {
      state.shares++;
      const event = { type: 'share', user, nickname, avatar, ts: Date.now() };
      pushChat(event);
      io.emit('alertEvent', event); // Kirim ke overlay Alert
      io.emit('stats', { viewers: state.viewers, likes: state.likes, follows: state.follows, shares: state.shares });
      log(`🔗 @${user} shared`);
    }
  });

  // ── LIKE ─────────────────────────────────────────────────
  connection.on('like', (data) => {
    state.likes = data.totalLikeCount || state.likes;
    io.emit('stats', { viewers: state.viewers, likes: state.likes, follows: state.follows, shares: state.shares });
  });

  // ── VIEWER COUNT ──────────────────────────────────────────
  connection.on('roomUser', (data) => {
    state.viewers = data.viewerCount || state.viewers;
    io.emit('stats', { viewers: state.viewers, likes: state.likes, follows: state.follows, shares: state.shares });
  });

  // ── STREAM END ────────────────────────────────────────────
  connection.on('streamEnd', () => {
    log('📴 Stream ended.');
    state.connected = false;
    io.emit('botStatus', { connected: false, username, reason: 'Stream ended' });
  });

  // ── DISCONNECT ────────────────────────────────────────────
  connection.on('disconnected', () => {
    log('⚠️  Disconnected. Reconnecting in 5s...');
    state.connected = false;
    io.emit('botStatus', { connected: false, username, reason: 'Disconnected — reconnecting...' });

    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(() => {
      if (!connection) return; // JANGAN lanjut jika bot sudah di-stop manual
      connection.connect().then(() => {
        state.connected = true;
        io.emit('botStatus', { connected: true, username });
        log('♻️  Reconnected!');
      }).catch(err => {
        log('❌ Reconnect failed: ' + err.message);
        io.emit('botStatus', { connected: false, username, reason: err.message });
      });
    }, 5000);
  });

  // ── ERROR ─────────────────────────────────────────────────
  connection.on('error', (err) => {
    log('❌ Error: ' + err.message);
    io.emit('botError', { message: err.message });
  });
}

// ── Stop bot ─────────────────────────────────────────────────
function stopBot() {
  clearTimeout(reconnectTimer);
  if (connection) {
    try { connection.disconnect(); } catch (_) { }
    connection = null;
  }
  const state = global._state;
  state.connected = false;
  global._io.emit('botStatus', { connected: false, username: currentUsername, reason: 'Stopped manually' });
  log('🛑 Bot stopped.');
}

function getBotState() {
  return { connected: !!connection, username: currentUsername };
}

// ── Push helpers ─────────────────────────────────────────────
function pushChat(event) {
  const state = global._state;
  const io = global._io;
  state.chatLog.push(event);
  if (state.chatLog.length > 200) state.chatLog.shift();
  io.emit('chatEvent', event);
}

function pushGift(event) {
  const state = global._state;
  const io = global._io;
  state.giftLog.push(event);
  if (state.giftLog.length > 100) state.giftLog.shift();
  io.emit('giftEvent', event);
  io.emit('alertEvent', event);
}

// ── Bot command handlers ──────────────────────────────────────
function handleCommand(event) {
  const msg = event.msg.trim();
  const state = global._state;
  const io = global._io;

  // Check built-in commands
  for (const [trigger, fn] of Object.entries(BUILT_IN_COMMANDS)) {
    if (msg.toLowerCase().startsWith(trigger + ' ') || msg.toLowerCase() === trigger) {
      fn(event, msg.slice(trigger.length).trim());
      return;
    }
  }

  // Check custom commands
  for (const cmd of state.botCommands) {
    if (msg.toLowerCase() === cmd.trigger || msg.toLowerCase().startsWith(cmd.trigger + ' ')) {
      const response = cmd.response
        .replace('{user}', event.nickname || event.user)
        .replace('{username}', event.user);
      io.emit('botReply', { user: event.user, msg: response });
      log(`🤖 Bot Reply → ${response}`);
      return;
    }
  }
}

async function handleSongRequest(event, args) {
  const io = global._io;
  const state = global._state;
  const song = args.trim();
  if (!song) {
    io.emit('botReply', { user: event.user, msg: `@${event.nickname} → Tulis nama lagu setelah !sr, contoh: !sr Shape of You` });
    return;
  }

  log(`🎵 Song request: "${song}" by @${event.user}`);

  // ── Spotify Integration ─────────────────────────────────────
  const sp = global._spotify;
  const spSettings = global._spotifySettings ? global._spotifySettings() : null;
  let entry = { id: Date.now(), requester: event.user, requesterNick: event.nickname, song };

  if (sp && spSettings && sp.isConfigured() && sp.getAuthState().isAuthenticated) {
    try {
      const tracks = await sp.searchTrack(song, 1);
      if (tracks.length > 0) {
        const track = tracks[0];
        
        // Populate entry with Spotify metadata
        entry.spotifyUri    = track.uri;
        entry.spotifyName   = track.name;
        entry.spotifyArtist = track.artists;
        entry.albumArt      = track.albumArt;
        entry.externalUrl   = track.externalUrl;
        
        // Add to queue (Dashboard and Overlay will update)
        state.songQueue.push(entry);
        io.emit('songQueue', { queue: state.songQueue, nowPlaying: state.nowPlaying });

        io.emit('botReply', { user: event.user, msg: `✅ @${event.nickname} Antrean ditambahkan: "${track.name}" (${track.artists}).` });
        return; 
      } else {
        io.emit('botReply', { user: event.user, msg: `❌ Lagu "${song}" tidak ditemukan di Spotify.` });
        return;
      }
    } catch (e) {
      log(`⚠️ Spotify search error: ${e.message}`);
    }
  }

  // Fallback: Add as raw text if Spotify search fails or is not connected
  state.songQueue.push(entry);
  io.emit('songQueue', { queue: state.songQueue, nowPlaying: state.nowPlaying });
  io.emit('botReply', { user: event.user, msg: `🎵 @${event.nickname} request: "${song}" (ditambahkan ke antrean)` });
}

function handleQueueCmd(event) {
  const io = global._io;
  const state = global._state;
  const len = state.songQueue.length;
  const msg = len === 0
    ? '🎵 Antrian lagu kosong!'
    : `🎵 ${len} lagu dalam antrian. Gunakan !np untuk lagu sekarang.`;
  io.emit('botReply', { user: event.user, msg });
}

function handleNowPlayingCmd(event) {
  const io = global._io;
  const state = global._state;
  const msg = state.nowPlaying
    ? `🎵 Sedang putar: "${state.nowPlaying.song}" (req by @${state.nowPlaying.requesterNick})`
    : '🎵 Tidak ada lagu yang sedang diputar.';
  io.emit('botReply', { user: event.user, msg });
}

function handleSkipCmd(event) {
  const io = global._io;
  const state = global._state;
  if (!event.verified) {
    io.emit('botReply', { user: event.user, msg: `@${event.nickname} Hanya moderator yang bisa skip lagu!` });
    return;
  }
  global._playNextSong();
  io.emit('botReply', {
    user: event.user,
    msg: state.nowPlaying
      ? `⏭️ Lagu diskip! Sekarang: "${state.nowPlaying.song}"`
      : '⏭️ Lagu diskip! Antrian kosong.'
  });
}

function handleHelpCmd(event) {
  const io = global._io;
  io.emit('botReply', {
    user: event.user,
    msg: `🤖 Commands: !sr [lagu] = request lagu | !q = lihat antrian | !np = lagu sekarang | !skip (mod) = skip`
  });
}

function log(msg) {
  console.log(`[${new Date().toLocaleTimeString('id-ID')}] ${msg}`);
}

module.exports = { startBot, stopBot, getBotState };
