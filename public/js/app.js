// ============================================================
//  TikTok Live Bot v2 — app.js (Dashboard)
// ============================================================

const socket = io();
const BASE = window.location.origin;

// ── State ────────────────────────────────────────────────────
let ttsEnabled = true;
let ttsQueue = [];
let ttsSpeaking = false;
let ttsSafeTimer = null;  // safety reset if onend never fires
let voicesLoaded = false; // prevent double load
let settings = { tts: { chat: true, gift: true, join: true, follow: true }, ttsRate: 1, ttsPitch: 1, ttsVolume: 1, overlayTheme: 'dark', chatMax: 30 };
let currentTab = 'chat';
let autoscroll = true;
let chatFilter = '';
let chatLimit = 30;  // max messages shown in dashboard

// ── Overlay URLs ─────────────────────────────────────────────
function setOverlayUrls() {
  const urls = {
    chat: `${BASE}/overlay/chat`,
    gift: `${BASE}/overlay/gift`,
    leaderboard: `${BASE}/overlay/leaderboard`,
    song: `${BASE}/overlays/song.html`,
    queue: `${BASE}/overlays/queue.html`,
    qr: `${BASE}/overlays/qr.html`,
    goal: `${BASE}/overlays/goal.html`,
    goalSpeedo: `${BASE}/overlays/goal_speedometer.html`,
    goalCircle: `${BASE}/overlays/goal_circular.html`,
    goalVertical: `${BASE}/overlays/goal_vertical.html`
  };
  document.getElementById('olChatUrl').textContent = urls.chat;
  document.getElementById('olGiftUrl').textContent = urls.gift;
  document.getElementById('olLeaderboardUrl').textContent = urls.leaderboard;
  document.getElementById('olSongUrl').textContent = urls.song;
  document.getElementById('olQueueUrl').textContent = urls.queue;
  document.getElementById('olQrUrl').textContent = urls.qr;
  document.getElementById('olGoalUrl').textContent = urls.goal;
  const elUrlSpeedo = document.getElementById('olGoalSpeedoUrl');
  if (elUrlSpeedo) elUrlSpeedo.textContent = urls.goalSpeedo;
  const elUrlCircle = document.getElementById('olGoalCircleUrl');
  if (elUrlCircle) elUrlCircle.textContent = urls.goalCircle;
  const elUrlVertical = document.getElementById('olGoalVerticalUrl');
  if (elUrlVertical) elUrlVertical.textContent = urls.goalVertical;

  document.getElementById('olChatOpen').href = urls.chat;
  document.getElementById('olGiftOpen').href = urls.gift;
  document.getElementById('olLeaderboardOpen').href = urls.leaderboard;
  document.getElementById('olSongOpen').href = urls.song;
  document.getElementById('olQueueOpen').href = urls.queue;
  document.getElementById('olQrOpen').href = urls.qr;
  const elOpenGoal = document.getElementById('olGoalOpen');
  if (elOpenGoal) elOpenGoal.href = urls.goal;
  const elOpenSpeedo = document.getElementById('olGoalSpeedoOpen');
  if (elOpenSpeedo) elOpenSpeedo.href = urls.goalSpeedo;
  const elOpenCircle = document.getElementById('olGoalCircleOpen');
  if (elOpenCircle) elOpenCircle.href = urls.goalCircle;
  const elOpenVertical = document.getElementById('olGoalVerticalOpen');
  if (elOpenVertical) elOpenVertical.href = urls.goalVertical;

  document.getElementById('urlChat').textContent = urls.chat;
  document.getElementById('urlGift').textContent = urls.gift;
  document.getElementById('urlLeaderboard').textContent = urls.leaderboard;
  document.getElementById('urlSong').textContent = urls.song;
  // Also need an entry in the lower settings tab URL section
  const urlQrEl = document.getElementById('urlQr');
  if (urlQrEl) urlQrEl.textContent = urls.qr;
  const urlGoalEl = document.getElementById('urlGoal');
  if (urlGoalEl) urlGoalEl.textContent = urls.goal;
  const urlGoalSpeedoEl = document.getElementById('urlGoalSpeedo');
  if (urlGoalSpeedoEl) urlGoalSpeedoEl.textContent = urls.goalSpeedo;
}
setOverlayUrls();

window.copyOverlay = function (type, isDirectFile) {
  const url = isDirectFile ? `${BASE}/overlays/${type}` : `${BASE}/overlay/${type}`;
  navigator.clipboard.writeText(url).then(() => toast('URL disalin!', 'success'));
};

window.previewOverlay = function (type, title, isDirectFile) {
  const url = isDirectFile ? `${BASE}/overlays/${type}` : `${BASE}/overlay/${type}`;
  document.getElementById('previewModalTitle').textContent = '👁 Preview — ' + title;
  document.getElementById('psOverlayName').textContent = title;
  document.getElementById('previewFrame').src = url;
  document.getElementById('previewOpenBtn').href = url;
  document.getElementById('previewCopyBtn').onclick = () =>
    navigator.clipboard.writeText(url).then(() => toast('URL disalin!', 'success'));

  // Always show sidebar
  document.getElementById('previewSettings').style.display = 'flex';

  // Show/hide settings groups
  const isChat = type === 'chat';
  const isGift = type === 'gift' || type === 'gift.html';

  const isGoal = type.includes('goal');

  document.getElementById('psChatSettings').style.display = isChat ? 'block' : 'none';
  document.getElementById('psGiftSettings').style.display = isGift ? 'block' : 'none';
  document.getElementById('psGoalSettings').style.display = isGoal ? 'block' : 'none';

  if (isGoal) {
    document.getElementById('psGoalModel').value = type;
    document.getElementById('psGoalModel').onchange = (e) => {
      const newType = e.target.value;
      const newUrl = `${BASE}/overlays/${newType}`;
      document.getElementById('previewFrame').src = newUrl;
      document.getElementById('previewOpenBtn').href = newUrl;
      document.getElementById('previewCopyBtn').onclick = () =>
        navigator.clipboard.writeText(newUrl).then(() => toast('URL disalin!', 'success'));
    };
  }

  // Show test buttons for gift overlay
  const giftBtn = document.getElementById('testGiftBtn');
  const joinBtn = document.getElementById('testJoinBtn');
  const followBtn = document.getElementById('testFollowBtn');
  const songBtn = document.getElementById('testSongBtn');
  const queueBtn = document.getElementById('testQueueBtn');
  
  giftBtn.style.display = 'none';
  joinBtn.style.display = 'none';
  followBtn.style.display = 'none';
  songBtn.style.display = 'none';
  queueBtn.style.display = 'none';

  if (isGift) {
    giftBtn.style.display = 'inline-flex';
    joinBtn.style.display = 'inline-flex';
    followBtn.style.display = 'inline-flex';
    
    giftBtn.onclick   = () => fetch('/api/test-alert?type=gift', { method: 'POST' });
    joinBtn.onclick   = () => fetch('/api/test-alert?type=join', { method: 'POST' });
    followBtn.onclick = () => fetch('/api/test-alert?type=follow', { method: 'POST' });

    // Sync gift settings
    document.getElementById('psSoundJoin').value = settings.sounds?.join || '';
    document.getElementById('psSoundFollow').value = settings.sounds?.follow || '';
    document.getElementById('psSoundGift').value = settings.sounds?.gift || '';
    document.getElementById('psVolume').value = settings.ttsVolume || 0.5;
    document.getElementById('psShowJoinAlert').checked = settings.alertShow?.join !== false;
    document.getElementById('psShowFollowAlert').checked = settings.alertShow?.follow !== false;
    document.getElementById('psTtsGift').checked = settings.tts?.gift !== false;
    document.getElementById('psTtsJoin').checked = settings.tts?.join !== false;
  } else if (type === 'song.html') {
    songBtn.style.display = 'inline-flex';
    songBtn.onclick = () => fetch('/api/test-alert?type=song', { method: 'POST' });
  } else if (type === 'queue.html') {
    queueBtn.style.display = 'inline-flex';
    queueBtn.onclick = () => fetch('/api/test-alert?type=queue', { method: 'POST' });
  }

  // Sync sidebar values from current settings
  document.getElementById('psTheme').value = settings.overlayTheme || 'dark';
  if (type === 'chat') {
    document.getElementById('psChatMax').value = settings.chatMax || 30;
    document.getElementById('psFontSize').value = settings.chatFontSize || 14;
    document.getElementById('psAnimation').value = settings.chatAnimation || 'slideUp';
    document.getElementById('psPosition').value = settings.chatPosition || 'bottom';
    document.getElementById('psShowChat').checked = settings.chatShow?.chat !== false;
    document.getElementById('psShowJoin').checked = settings.chatShow?.join !== false;
    document.getElementById('psShowFollow').checked = settings.chatShow?.follow !== false;
    document.getElementById('psShowAvatar').checked = settings.chatShowAvatar !== false;
    document.getElementById('psShowBadge').checked = settings.chatShowBadge !== false;
  }

  document.getElementById('previewModal').classList.add('open');
};

// Apply overlay settings
document.getElementById('psApplyBtn').onclick = async () => {
  const s = { overlayTheme: document.getElementById('psTheme').value };

  if (document.getElementById('psChatSettings').style.display !== 'none') {
    s.chatMax = parseInt(document.getElementById('psChatMax').value);
    s.chatFontSize = parseInt(document.getElementById('psFontSize').value);
    s.chatAnimation = document.getElementById('psAnimation').value;
    s.chatPosition = document.getElementById('psPosition').value;
    s.chatShow = {
      chat: document.getElementById('psShowChat').checked,
      join: document.getElementById('psShowJoin').checked,
      follow: document.getElementById('psShowFollow').checked,
    };
    s.chatShowAvatar = document.getElementById('psShowAvatar').checked;
    s.chatShowBadge = document.getElementById('psShowBadge').checked;
  }

  const psGiftSettings = document.getElementById('psGiftSettings');
  if (psGiftSettings && psGiftSettings.style.display !== 'none') {
    s.sounds = settings.sounds || {};
    s.sounds.join = document.getElementById('psSoundJoin').value;
    s.sounds.follow = document.getElementById('psSoundFollow').value;
    s.sounds.gift = document.getElementById('psSoundGift').value;

    s.ttsVolume = parseFloat(document.getElementById('psVolume').value);
    s.alertShow = {
      join: document.getElementById('psShowJoinAlert').checked,
      follow: document.getElementById('psShowFollowAlert').checked
    };
    s.tts = settings.tts || {};
    s.tts.gift = document.getElementById('psTtsGift').checked;
    s.tts.join = document.getElementById('psTtsJoin').checked;
  }

  const sJoin = document.getElementById('soundJoinInput');
  const sFollow = document.getElementById('soundFollowInput');
  const sGift = document.getElementById('soundGiftInput');
  const sShare = document.getElementById('soundShareInput');

  if (sJoin) {
    s.sounds = s.sounds || {};
    s.sounds.join = sJoin.value;
    s.sounds.follow = sFollow.value;
    s.sounds.gift = sGift.value;
    s.sounds.share = sShare.value;
  }

  const sociaBuzzInput = document.getElementById('sociaBuzzInput');
  if (sociaBuzzInput) sociaBuzzInput.value = s.sociaBuzz || '';

  await fetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(s) });
  Object.assign(settings, s);

  // Refresh iframe to apply changes
  const frame = document.getElementById('previewFrame');
  frame.src = frame.src;
  toast('Tema/Pengaturan overlay diterapkan!', 'success');
};

// Close modal
document.getElementById('previewCloseBtn').onclick = closePreview;
document.getElementById('previewModal').onclick = (e) => {
  if (e.target.id === 'previewModal') closePreview();
};
document.addEventListener('keydown', e => { if (e.key === 'Escape') closePreview(); });
function closePreview() {
  document.getElementById('previewModal').classList.remove('open');
  document.getElementById('previewFrame').src = '';
}


// ── Socket Events ─────────────────────────────────────────────
socket.on('init', data => {
  applyStats(data);
  applySettings(data.settings || {});
  renderLeaderboard(data.leaderboard || []);
  renderGiftGoal(data.giftGoal);
  renderSongQueue(data.songQueue, data.nowPlaying);
  renderBotCommands(data.botCommands || []);
  if (data.chatLog) data.chatLog.forEach(e => appendChatItem(e, false));
  if (data.giftLog) data.giftLog.forEach(e => appendGiftItem(e, false));
  updateConnectionUI(data.connected, data.username);
});

socket.on('botStatus', data => {
  updateConnectionUI(data.connected, data.username);
  if (data.reason) toast(data.reason, data.connected ? 'success' : 'error');
});

socket.on('stats', data => applyStats(data));

socket.on('chatEvent', data => {
  appendChatItem(data, true);
  if (data.type === 'chat' && settings.tts?.chat) speakTTS(`${data.nickname || data.user} berkata: ${data.msg}`);
  if (data.type === 'join' && settings.tts?.join) speakTTS(`${data.nickname || data.user} bergabung`);
  if (data.type === 'follow' && settings.tts?.follow) speakTTS(`${data.nickname || data.user} mengikuti`);
});

socket.on('giftEvent', data => {
  appendGiftItem(data, true);
  if (settings.tts?.gift) speakTTS(`${data.nickname || data.user} mengirim ${data.gift} sebanyak ${data.count} kali`);
});

socket.on('giftGoal', data => renderGiftGoal(data));
socket.on('leaderboard', data => renderLeaderboard(data));
socket.on('songQueue', data => renderSongQueue(data.queue, data.nowPlaying));
socket.on('botCommands', data => renderBotCommands(data));
socket.on('settings', data => applySettings(data));
socket.on('botReply', data => appendBotReply(data));
socket.on('botError', data => toast('❌ ' + data.message, 'error'));

// ── Connect / Disconnect ──────────────────────────────────────
document.getElementById('connectBtn').onclick = async () => {
  const uname = document.getElementById('usernameInput').value.trim();
  if (!uname) return toast('Masukkan username TikTok!', 'error');
  document.getElementById('connectBtn').disabled = true;
  document.getElementById('statusText').textContent = 'Connecting...';
  document.getElementById('statusDot').className = 'status-dot pulsing';
  const r = await fetch('/api/connect', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: uname }) });
  const d = await r.json();
  document.getElementById('connectBtn').disabled = false;
  if (!d.ok) toast('Gagal connect: ' + d.error, 'error');
};

document.getElementById('disconnectBtn').onclick = async () => {
  await fetch('/api/disconnect', { method: 'POST' });
};

// ── Connection UI ─────────────────────────────────────────────
function updateConnectionUI(connected, username) {
  const dot = document.getElementById('statusDot');
  const txt = document.getElementById('statusText');
  const conn = document.getElementById('connectBtn');
  const disc = document.getElementById('disconnectBtn');
  if (connected) {
    dot.className = 'status-dot online';
    txt.textContent = `Live: @${username}`;
    conn.classList.add('hidden');
    disc.classList.remove('hidden');
  } else {
    dot.className = 'status-dot offline';
    txt.textContent = 'Offline';
    conn.classList.remove('hidden');
    disc.classList.add('hidden');
  }
}

// ── Stats ─────────────────────────────────────────────────────
function applyStats(d) {
  animCount('statViewers', d.viewers);
  animCount('statLikes', d.likes);
  animCount('statFollows', d.follows);
  animCount('statShares', d.shares);
  if (d.giftGoal) renderGiftGoal(d.giftGoal);
}

function animCount(id, val) {
  const el = document.getElementById(id);
  if (!el) return;
  const target = parseInt(val) || 0;
  const current = parseInt(el.textContent.replace(/,/g, '')) || 0;
  if (current === target) return;
  const diff = target - current;
  const steps = 20;
  let i = 0;
  const t = setInterval(() => {
    i++;
    el.textContent = fmtNum(Math.round(current + diff * (i / steps)));
    if (i >= steps) { el.textContent = fmtNum(target); clearInterval(t); }
  }, 20);
}

function fmtNum(n) { return n >= 1000 ? (n / 1000).toFixed(1) + 'K' : n; }

// ── Gift Goal ─────────────────────────────────────────────────
function renderGiftGoal(g) {
  if (!g) return;
  document.getElementById('statGoalCurrent').textContent = fmtNum(g.current || 0);
  document.getElementById('statGoalTarget').textContent = fmtNum(g.target || 1000);
  document.getElementById('statGoalLabel').textContent = g.label || 'Gift Goal';
  const pct = Math.min(100, Math.round((g.current || 0) / (g.target || 1) * 100));
  document.getElementById('goalBar').style.width = pct + '%';
  document.getElementById('goalLabel').value = g.label || 'Gift Goal';
  document.getElementById('goalTarget').value = g.target || 1000;
}

document.getElementById('saveGoalBtn').onclick = async () => {
  await fetch('/api/gift-goal', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ target: document.getElementById('goalTarget').value, label: document.getElementById('goalLabel').value })
  });
  toast('Gift goal disimpan!', 'success');
};

// ── Chat Log ──────────────────────────────────────────────────
function appendChatItem(ev, scroll = true) {
  const log = document.getElementById('chatLog');

  // Filter
  if (chatFilter && !JSON.stringify(ev).toLowerCase().includes(chatFilter)) return;

  const el = document.createElement('div');
  el.className = `chat-item type-${ev.type}${ev.isBot ? ' bot-reply' : ''}`;

  const time = new Date(ev.ts || Date.now()).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
  const user = ev.nickname || ev.user || 'Unknown';
  const verified = ev.verified ? '<i class="fas fa-check-circle chat-verified" title="Verified/Mod"></i>' : '';
  const badges = (ev.badges || []).map(b => `<span class="chat-badge badge-${b}">${b}</span>`).join('');
  const avatar = ev.avatar
    ? `<img class="chat-avatar" src="${ev.avatar}" alt="${user}" onerror="this.style.display='none'">`
    : `<div class="chat-avatar">${user[0]?.toUpperCase() || '?'}</div>`;

  let body = '';
  if (ev.type === 'chat') {
    body = `<div class="chat-header"><span class="chat-username">${user}</span>${verified}${badges}<span class="chat-time">${time}</span></div>
            <div class="chat-msg">${escHtml(ev.msg || '')}</div>`;
  } else if (ev.type === 'join') {
    body = `<div class="chat-header"><span class="chat-username">${user}</span>${verified}<span class="chat-time">${time}</span></div>
            <div class="chat-event-text"><i class="fas fa-door-open" style="color:var(--green)"></i> Bergabung ke live!</div>`;
  } else if (ev.type === 'follow') {
    body = `<div class="chat-header"><span class="chat-username">${user}</span><span class="chat-time">${time}</span></div>
            <div class="chat-event-text"><i class="fas fa-heart" style="color:var(--accent)"></i> Baru saja follow!</div>`;
  }

  el.innerHTML = avatar + `<div class="chat-body">${body}</div>`;
  log.appendChild(el);

  // Enforce chat limit
  const lim = chatLimit || 200;
  while (log.children.length > lim) log.removeChild(log.firstChild);
  if (scroll && autoscroll) log.scrollTop = log.scrollHeight;
}

function appendBotReply(data) {
  appendChatItem({ type: 'chat', user: '🤖 Bot', nickname: '🤖 Bot', msg: data.msg, verified: false, badges: [], isBot: true, ts: Date.now() }, true);
  const log = document.getElementById('botRepliesLog');
  const el = document.createElement('div');
  el.className = 'bot-reply-item';
  el.textContent = data.msg;
  log.insertBefore(el, log.firstChild);
  while (log.children.length > 30) log.removeChild(log.lastChild);
}

// ── Gift Log ──────────────────────────────────────────────────
function appendGiftItem(ev, scroll = true) {
  const log = document.getElementById('giftLog');
  const el = document.createElement('div');
  el.className = 'gift-item';
  const time = new Date(ev.ts || Date.now()).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
  const img = ev.giftImg ? `<img src="${ev.giftImg}" width="28" height="28" style="border-radius:4px" onerror="this.style.display='none'">` : '🎁';
  el.innerHTML = `<div class="gift-icon">${img}</div>
    <div class="gift-info">
      <div class="gift-name">${escHtml(ev.gift || 'Gift')}</div>
      <div class="gift-meta">dari @${ev.nickname || ev.user} × ${ev.count} &nbsp;•&nbsp; ${time}</div>
    </div>
    <div class="gift-diamonds"><i class="fas fa-gem"></i> ${ev.diamonds || 0}</div>`;
  log.insertBefore(el, log.firstChild);
  while (log.children.length > 100) log.removeChild(log.lastChild);
  if (scroll && currentTab === 'gifts') log.scrollTop = 0;
}

// ── Leaderboard ───────────────────────────────────────────────
function renderLeaderboard(list) {
  const el = document.getElementById('leaderboardList');
  if (!list || !list.length) { el.innerHTML = '<div class="empty-state"><i class="fas fa-gem"></i><span>Belum ada gift</span></div>'; return; }
  el.innerHTML = list.map(u => `
    <div class="lb-item">
      <div class="lb-rank${u.rank <= 3 ? ' r' + u.rank : ''}">${u.rank}</div>
      <div class="lb-name">@${u.username}</div>
      <div class="lb-diamonds"><i class="fas fa-gem"></i> ${u.diamonds.toLocaleString()}</div>
    </div>`).join('');
}

// ── Song Queue ────────────────────────────────────────────────
function renderSongQueue(queue, nowPlaying) {
  const qCount = document.getElementById('queueCount');
  qCount.textContent = queue?.length || 0;

  const npCard = document.getElementById('nowPlayingCard');
  if (nowPlaying) {
    const qYoutube = `https://www.youtube.com/results?search_query=${encodeURIComponent(nowPlaying.song)}`;
    const qSpotify = `https://open.spotify.com/search/${encodeURIComponent(nowPlaying.song)}`;
    npCard.innerHTML = `<div class="np-info">
      <div class="song-title"><i class="fas fa-music" style="color:var(--accent2)"></i> ${escHtml(nowPlaying.song)}</div>
      <div class="song-req">Req by @${escHtml(nowPlaying.requesterNick || nowPlaying.requester)}</div>
      <div style="display:flex;gap:8px;margin-top:10px">
        <a href="${qYoutube}" target="_blank" class="oc-btn" style="background:#cc0000;color:#fff"><i class="fab fa-youtube"></i> Cari YouTube</a>
        <a href="${qSpotify}" target="_blank" class="oc-btn" style="background:#1db954;color:#fff"><i class="fab fa-spotify"></i> Cari Spotify</a>
      </div>
    </div>`;
  } else {
    npCard.innerHTML = '<div class="np-idle"><i class="fas fa-music"></i><span>Tidak ada lagu</span></div>';
  }

  const qList = document.getElementById('songQueueList');
  if (!queue || !queue.length) { qList.innerHTML = '<div class="empty-state"><i class="fas fa-music"></i><span>Antrian kosong<br><small>Penonton bisa request dengan !sr [lagu]</small></span></div>'; return; }
  qList.innerHTML = queue.map((s, i) => `
    <div class="queue-item">
      <div class="queue-num">${i + 1}</div>
      <div class="queue-info">
        <div class="queue-song">${escHtml(s.song)}</div>
        <div class="queue-req">@${escHtml(s.requesterNick || s.requester)}</div>
      </div>
      <a href="https://www.youtube.com/results?search_query=${encodeURIComponent(s.song)}" target="_blank" class="queue-del" style="color:#ff4444;text-decoration:none;margin-right:4px" title="Cari di YouTube"><i class="fab fa-youtube"></i></a>
      <button class="queue-del" onclick="removeSong('${s.id}')" title="Hapus"><i class="fas fa-times"></i></button>
    </div>`).join('');
}

document.getElementById('skipSongBtn').onclick = () => fetch('/api/song/play-next', { method: 'POST' });
document.getElementById('clearQueueBtn').onclick = () => { if (confirm('Hapus semua antrian?')) fetch('/api/song/clear', { method: 'POST' }); };
window.removeSong = id => fetch('/api/song/remove', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });

// ── Bot Commands ──────────────────────────────────────────────
document.getElementById('addCommandBtn').onclick = async () => {
  const trigger = document.getElementById('cmdTrigger').value.trim();
  const response = document.getElementById('cmdResponse').value.trim();
  if (!trigger || !response) return toast('Isi trigger dan respons!', 'error');
  const r = await fetch('/api/commands', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trigger, response }) });
  const d = await r.json();
  if (d.ok) { document.getElementById('cmdTrigger').value = ''; document.getElementById('cmdResponse').value = ''; toast('Command ditambah!', 'success'); }
  else toast(d.error, 'error');
};

window.deleteCommand = async id => {
  await fetch(`/api/commands/${id}`, { method: 'DELETE' });
  toast('Command dihapus', 'info');
};

function renderBotCommands(cmds) {
  const el = document.getElementById('customCommandsList');
  if (!cmds || !cmds.length) { el.innerHTML = '<div class="empty-state"><i class="fas fa-terminal"></i><span>Belum ada custom command</span></div>'; return; }
  el.innerHTML = cmds.map(c => `
    <div class="custom-cmd-item">
      <div class="custom-cmd-trigger">${escHtml(c.trigger)}</div>
      <div class="custom-cmd-response">${escHtml(c.response)}</div>
      <button class="custom-cmd-del" onclick="deleteCommand(${c.id})" title="Hapus"><i class="fas fa-trash"></i></button>
    </div>`).join('');
}

// ── Settings ──────────────────────────────────────────────────
function applySettings(s) {
  if (!s) return;
  Object.assign(settings, s);
  if (s.tts) {
    document.getElementById('ttsChatToggle').checked = !!s.tts.chat;
    document.getElementById('ttsGiftToggle').checked = !!s.tts.gift;
    document.getElementById('ttsJoinToggle').checked = !!s.tts.join;
    document.getElementById('ttsFollowToggle').checked = !!s.tts.follow;
  }
  if (s.ttsRate) { document.getElementById('ttsRate').value = s.ttsRate; document.getElementById('ttsRateVal').textContent = s.ttsRate; }
  if (s.ttsPitch) { document.getElementById('ttsPitch').value = s.ttsPitch; document.getElementById('ttsPitchVal').textContent = s.ttsPitch; }
  if (s.ttsVolume != null) { document.getElementById('ttsVolume').value = s.ttsVolume; document.getElementById('ttsVolVal').textContent = Math.round(s.ttsVolume * 100); }
  if (s.overlayTheme) setActiveTheme(s.overlayTheme);
  if (s.chatMax) document.getElementById('chatMaxOverlay').value = s.chatMax;
  if (s.sociaBuzzUrl !== undefined) document.getElementById('sociaBuzzInput').value = s.sociaBuzzUrl;
  if (s.sessionId !== undefined) document.getElementById('sessionIdInput').value = s.sessionId;
  if (s.proxy !== undefined) document.getElementById('proxyInput').value = s.proxy;
  if (s.welcomeEnabled !== undefined) document.getElementById('welcomeToggle').checked = s.welcomeEnabled;

  if (s.sounds) {
    if (document.getElementById('soundJoinInput')) document.getElementById('soundJoinInput').value = s.sounds.join || '';
    if (document.getElementById('soundFollowInput')) document.getElementById('soundFollowInput').value = s.sounds.follow || '';
    if (document.getElementById('soundGiftInput')) document.getElementById('soundGiftInput').value = s.sounds.gift || '';
    if (document.getElementById('soundShareInput')) document.getElementById('soundShareInput').value = s.sounds.share || '';
  }
}

document.getElementById('saveSettingsBtn').onclick = async () => {
  const s = {
    tts: {
      chat: document.getElementById('ttsChatToggle').checked,
      gift: document.getElementById('ttsGiftToggle').checked,
      join: document.getElementById('ttsJoinToggle').checked,
      follow: document.getElementById('ttsFollowToggle').checked,
    },
    ttsRate: parseFloat(document.getElementById('ttsRate').value),
    ttsPitch: parseFloat(document.getElementById('ttsPitch').value),
    ttsVolume: parseFloat(document.getElementById('ttsVolume').value),
    overlayTheme: document.querySelector('.theme-item.active')?.dataset.theme || 'dark',
    chatMax: parseInt(document.getElementById('chatMaxOverlay').value) || 30,
    sociaBuzzUrl: document.getElementById('sociaBuzzInput').value.trim(),
    sessionId: document.getElementById('sessionIdInput').value.trim(),
    proxy: document.getElementById('proxyInput').value.trim(),
    signApiKey: document.getElementById('signApiKeyInput').value.trim(),
    welcomeEnabled: document.getElementById('welcomeToggle').checked,
    sounds: {
      join: document.getElementById('soundJoinInput').value.trim(),
      follow: document.getElementById('soundFollowInput').value.trim(),
      gift: document.getElementById('soundGiftInput').value.trim(),
      share: document.getElementById('soundShareInput').value.trim()
    }
  };
  await fetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(s) });
  Object.assign(settings, s);
  toast('Settings disimpan!', 'success');
};

// Range labels
['ttsRate', 'ttsPitch', 'ttsVolume'].forEach(id => {
  const el = document.getElementById(id);
  const lbl = document.getElementById(id === 'ttsVolume' ? 'ttsVolVal' : id + 'Val');
  el.oninput = () => { lbl.textContent = id === 'ttsVolume' ? Math.round(el.value * 100) : parseFloat(el.value).toFixed(1); };
});

// Theme picker
document.getElementById('themeGrid').onclick = e => {
  const item = e.target.closest('.theme-item');
  if (!item) return;
  setActiveTheme(item.dataset.theme);
};

function setActiveTheme(theme) {
  document.querySelectorAll('.theme-item').forEach(i => i.classList.toggle('active', i.dataset.theme === theme));
}

// ── TTS Voices ────────────────────────────────────────────────
function loadVoices() {
  const voices = speechSynthesis.getVoices();
  if (!voices.length) return; // not ready yet
  if (voicesLoaded) return;   // already loaded, skip duplicate call
  voicesLoaded = true;

  const sel = document.getElementById('ttsVoiceSelect');
  sel.innerHTML = '';
  let idIdx = -1;
  voices.forEach((v, i) => {
    const o = document.createElement('option');
    o.value = i;
    o.textContent = `${v.name} (${v.lang})`;
    sel.appendChild(o);
    if (idIdx === -1 && v.lang.toLowerCase().startsWith('id')) idIdx = i;
  });
  if (idIdx !== -1) sel.value = idIdx; // auto-select Indonesian
}
// onvoiceschanged fires once voices are ready (Chrome async)
speechSynthesis.onvoiceschanged = loadVoices;
loadVoices(); // also try immediately (Firefox/Edge)

document.getElementById('testTtsBtn').onclick = () => speakTTS('Halo! TTS sudah berfungsi dengan baik.');

document.getElementById('ttsToggleBtn').onclick = () => {
  ttsEnabled = !ttsEnabled;
  document.getElementById('ttsToggleBtn').classList.toggle('active', ttsEnabled);
  toast(ttsEnabled ? 'TTS aktif' : 'TTS dimatikan', 'info');
};

// ── TTS Engine ────────────────────────────────────────────────
function speakTTS(text) {
  if (!ttsEnabled) return;
  // Dedupe: skip if same text already queued last
  if (ttsQueue.length && ttsQueue[ttsQueue.length - 1] === text) return;
  ttsQueue.push(text);
  processTTSQueue();
}

function processTTSQueue() {
  if (ttsSpeaking || !ttsQueue.length) return;
  ttsSpeaking = true;

  const text = ttsQueue.shift();

  // Cancel any stuck/running speech first (fixes Chrome double-speak bug)
  speechSynthesis.cancel();

  // Small delay after cancel so Chrome clears its buffer
  setTimeout(() => {
    const utt = new SpeechSynthesisUtterance(text);
    utt.lang = 'id-ID';
    const voices = speechSynthesis.getVoices();
    const vidx = parseInt(document.getElementById('ttsVoiceSelect').value);
    if (voices[vidx]) utt.voice = voices[vidx];
    utt.rate = parseFloat(document.getElementById('ttsRate').value) || 1;
    utt.pitch = parseFloat(document.getElementById('ttsPitch').value) || 1;
    utt.volume = parseFloat(document.getElementById('ttsVolume').value) || 1;

    function done() { clearTimeout(ttsSafeTimer); ttsSpeaking = false; processTTSQueue(); }
    utt.onend = done;
    utt.onerror = done;

    // Safety: if onend never fires (Chrome bug), force-reset after 15s
    ttsSafeTimer = setTimeout(done, 15000);

    speechSynthesis.speak(utt);
  }, 80);
}

// ── Tabs ──────────────────────────────────────────────────────
document.getElementById('mainTabs').onclick = e => {
  const btn = e.target.closest('.tab-btn');
  if (!btn) return;
  const tab = btn.dataset.tab;
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b === btn));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id === 'tab-' + tab));
  currentTab = tab;
};

// ── Chat toolbar ──────────────────────────────────────────────
document.getElementById('clearChatBtn').onclick = () => { document.getElementById('chatLog').innerHTML = ''; toast('Chat dibersihkan', 'info'); };
document.getElementById('clearGiftBtn').onclick = () => { document.getElementById('giftLog').innerHTML = ''; toast('Gift log dibersihkan', 'info'); };

document.getElementById('resetLeaderboardBtn').onclick = async () => {
  if (!confirm('Yakin ingin reset semua koin/diamond di leaderboard? Data tidak bisa dikembalikan.')) return;
  const res = await fetch('/api/leaderboard/reset', { method: 'POST' });
  if (res.ok) {
    toast('Leaderboard berhasil di-reset!', 'success');
  }
};
document.getElementById('autoscrollChat').onchange = e => autoscroll = e.target.checked;
document.getElementById('chatFilter').oninput = e => chatFilter = e.target.value.toLowerCase();

// Chat limit dropdown
document.getElementById('chatLimitSelect').onchange = function () {
  chatLimit = parseInt(this.value) || 0;
  trimChatLog();
};

function trimChatLog() {
  if (!chatLimit) return; // 0 = semua
  const log = document.getElementById('chatLog');
  while (log.children.length > chatLimit) log.removeChild(log.firstChild);
}

// ── Fullscreen ────────────────────────────────────────────────
document.getElementById('fullscreenBtn').onclick = () => {
  if (!document.fullscreenElement) document.documentElement.requestFullscreen();
  else document.exitFullscreen();
};

// ── Toast ─────────────────────────────────────────────────────
function toast(msg, type = 'info') {
  const c = document.getElementById('toastContainer');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  const icons = { success: 'fa-check-circle', error: 'fa-exclamation-circle', info: 'fa-info-circle' };
  el.innerHTML = `<i class="fas ${icons[type] || icons.info}"></i> ${msg}`;
  c.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

// ── Utils ─────────────────────────────────────────────────────
function escHtml(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

// ══════════════════════════════════════════════════════════════
//  SPOTIFY INTEGRATION (DUAL MODE)
// ══════════════════════════════════════════════════════════════

let spState = {
  isAuthenticated: false,
  isConfigured   : false,
  mode           : 'free',
  isPlaying      : false,
  currentTrack   : null,
  volume         : 50,
  progress       : 0,
  duration       : 0,
};

// For Free Mode Local Playback
const spAudio = new Audio();
spAudio.volume = 0.5;
let spProgressTimer = null;

// ── Load spotify status on init ───────────────────────────────
async function initSpotify() {
  try {
    const r = await fetch('/api/spotify/status');
    const d = await r.json();
    spState.mode = d.settings?.mode || 'free';
    updateSpotifyUI(d);
    
    // Initial fetch of queue status
    fetch('/api/spotify/status').then(res => res.json()).then(data => {
      // Though /status may not have queue, we can rely on socket init
    });
    
    if (d.settings) {
      document.getElementById('spMode').value            = d.settings.mode || 'free';
      if (typeof updateSpNote === 'function') updateSpNote();
      document.getElementById('spClientId').value        = d.settings.clientId || '';
      document.getElementById('spClientSecret').value    = d.settings.clientSecret || '';
      document.getElementById('spAutoPlay').checked      = d.settings.autoPlay !== false;
      document.getElementById('spAutoPlayToggle').checked = d.settings.autoPlay !== false;
    }
    
    // Resume UI state but don't auto-play audio on reload
    if (d.nowPlaying) {
      updateNowPlayingCard(d.nowPlaying);
    }
  } catch (e) {
    console.warn('Spotify init error:', e);
  }
}
initSpotify();

// ── Socket events ─────────────────────────────────────────────
socket.on('spotifyStatus', d => updateSpotifyUI(d));
socket.on('spotifyPlayPreview', track => spPlayLocal(track));
socket.on('spotifyStopPreview', () => spStopLocal());
socket.on('spotifyNowPlaying', d => {
  if (spState.mode === 'premium') updateNowPlayingCard(d);
});

// ── Update UI based on auth/config state ──────────────────────
function updateSpotifyUI(d) {
  spState.isAuthenticated = !!d?.isAuthenticated;
  spState.isConfigured    = !!d?.isConfigured;
  spState.mode            = d?.mode || spState.mode;

  const setup  = document.getElementById('spotifySetupPanel');
  const player = document.getElementById('spotifyPlayerPanel');
  const devs   = document.getElementById('spDevicesSection');
  if (!setup || !player) return;

  if (spState.isAuthenticated) {
    setup.style.display  = 'none';
    player.style.display = 'flex';
    if (spState.mode === 'premium') {
      if (devs) devs.style.display = 'block';
    } else {
      if (devs) devs.style.display = 'none';
    }
  } else {
    setup.style.display  = 'flex';
    player.style.display = 'none';
  }
}

// ── Setup form: Save credentials ─────────────────────────────
document.getElementById('spSaveBtn').onclick = async () => {
  const mode         = document.getElementById('spMode').value;
  const clientId     = document.getElementById('spClientId').value.trim();
  const clientSecret = document.getElementById('spClientSecret').value.trim();
  const autoPlay     = document.getElementById('spAutoPlay').checked;
  const redirectUri  = window.location.origin + '/spotify/callback';
  
  if (!clientId || !clientSecret) return toast('Isi Client ID dan Client Secret!', 'error');

  const btn = document.getElementById('spSaveBtn');
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Menghubungkan...';

  const r = await fetch('/api/spotify/credentials', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode, clientId, clientSecret, autoPlay, redirectUri }),
  });
  const d = await r.json();
  btn.disabled = false;
  btn.innerHTML = '<i class="fas fa-save"></i> Simpan & Hubungkan';

  if (!d.ok) return toast('Gagal setup: ' + d.error, 'error');
  
  if (mode === 'premium') {
    toast('Membuka halaman login Spotify...', 'info');
    spOpenLoginWindow();
  } else {
    toast('✅ Spotify terhubung (Free Mode)!', 'success');
    initSpotify();
  }
};

function spOpenLoginWindow() {
  const w = window.open('/spotify/login', 'SpotifyLogin', 'width=500,height=700,resizable=yes');
  const listener = (e) => {
    if (e.data?.spotifyAuth === 'success') {
      toast('✅ Spotify Premium terhubung!', 'success');
      initSpotify();
      window.removeEventListener('message', listener);
    } else if (e.data?.spotifyAuth === 'error') {
      toast('❌ Gagal connect Spotify: ' + (e.data.error || 'unknown'), 'error');
      window.removeEventListener('message', listener);
    }
  };
  window.addEventListener('message', listener);
}

// ── Local Audio Playback (Free Mode) ──────────────────────────
function spPlayLocal(track) {
  if (spState.mode !== 'free') return;
  if (!track || !track.preview) return toast('Tidak ada URL preview.', 'error');
  
  spState.currentTrack = track;
  spState.isPlaying = true;
  spAudio.src = track.preview;
  spAudio.play().catch(e => console.warn('Audio play error:', e));

  updateNowPlayingCard({ track, isPlaying: true });
}

function spStopLocal() {
  spState.isPlaying = false;
  spAudio.pause();
  updateNowPlayingCard(null);
}

spAudio.addEventListener('ended', () => {
  if (spState.mode !== 'free') return;
  spState.isPlaying = false;
  document.getElementById('spPlayIcon').className = 'fas fa-play';
  document.getElementById('spStatusText').textContent = 'Paused';
  const pulse = document.querySelector('.sp-pulse');
  if (pulse) pulse.classList.add('paused');
  fetch('/api/spotify/stop-preview', { method: 'POST' });
});

spAudio.addEventListener('timeupdate', () => {
  if (spState.mode !== 'free') return;
  const progMs = (spAudio.currentTime || 0) * 1000;
  const durMs  = (spAudio.duration || 30) * 1000;
  updateProgress(progMs, durMs);
});

// ── Now playing card update (Dual Mode) ───────────────────────
function updateNowPlayingCard(data) {
  if (!data || !data.track) {
    document.getElementById('spTrackName').textContent   = 'Tidak ada lagu';
    document.getElementById('spTrackArtist').textContent = '—';
    document.getElementById('spTrackAlbum').textContent  = '';
    document.getElementById('spAlbumArt').innerHTML = '<div class="sp-album-placeholder"><i class="fas fa-music"></i></div>';
    document.getElementById('spOpenLink').style.display  = 'none';
    document.getElementById('spStatusText').textContent  = '—';
    document.getElementById('spPlayIcon').className      = 'fas fa-play';
    document.getElementById('spProgressFill').style.width = '0%';
    document.getElementById('spTimeProgress').textContent = '0:00';
    document.getElementById('spTimeDuration').textContent  = '0:00';
    const pulse = document.querySelector('.sp-pulse');
    if (pulse) pulse.classList.add('paused');
    stopProgressTimer();
    spState.isPlaying = false;
    return;
  }

  const t = data.track;
  document.getElementById('spTrackName').textContent   = t.name || '—';
  document.getElementById('spTrackArtist').textContent = t.artists || '—';
  document.getElementById('spTrackAlbum').textContent  = t.album  || '';

  const artEl = document.getElementById('spAlbumArt');
  if (t.albumArt) {
    artEl.innerHTML = `<img src="${t.albumArt}" alt="${escHtml(t.name)}">`;
  } else {
    artEl.innerHTML = '<div class="sp-album-placeholder"><i class="fas fa-music"></i></div>';
  }

  const link = document.getElementById('spOpenLink');
  if (t.externalUrl) {
    link.href = t.externalUrl;
    link.style.display = 'inline-flex';
  } else {
    link.style.display = 'none';
  }

  spState.isPlaying = !!data.isPlaying;
  document.getElementById('spPlayIcon').className = spState.isPlaying ? 'fas fa-pause' : 'fas fa-play';
  document.getElementById('spStatusText').textContent = spState.isPlaying ? (spState.mode === 'free' ? 'Playing Preview' : 'Playing') : 'Paused';
  const pulse = document.querySelector('.sp-pulse');
  if (pulse) pulse.classList.toggle('paused', !spState.isPlaying);

  if (spState.mode === 'premium') {
    spState.progress = data.track.progress || 0;
    spState.duration = data.track.duration || 0;
    if (data.volume != null) {
      document.getElementById('spVolumeSlider').value = data.volume;
      document.getElementById('spVolumeVal').textContent = data.volume + '%';
    }
    updateProgress(spState.progress, spState.duration);
    stopProgressTimer();
    if (spState.isPlaying) startProgressTimer();
  }
}

function fmtMs(ms) {
  if (isNaN(ms) || ms < 0) return '0:00';
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function updateProgress(progress, duration) {
  document.getElementById('spTimeProgress').textContent = fmtMs(progress);
  document.getElementById('spTimeDuration').textContent  = fmtMs(duration);
  const pct = duration > 0 ? Math.min(100, (progress / duration) * 100) : 0;
  document.getElementById('spProgressFill').style.width = pct + '%';
}

function startProgressTimer() {
  stopProgressTimer();
  spProgressTimer = setInterval(() => {
    if (!spState.isPlaying) return;
    spState.progress = Math.min(spState.progress + 1000, spState.duration);
    updateProgress(spState.progress, spState.duration);
  }, 1000);
}

function stopProgressTimer() {
  if (spProgressTimer) { clearInterval(spProgressTimer); spProgressTimer = null; }
}

// ── Player Controls ───────────────────────────────────────────
document.getElementById('spPlayBtn').onclick = async () => {
  if (spState.mode === 'free') {
    if (!spState.currentTrack) return;
    if (spState.isPlaying) {
      spAudio.pause();
      spState.isPlaying = false;
    } else {
      spAudio.play().catch(e => console.warn(e));
      spState.isPlaying = true;
    }
    updateNowPlayingCard({ track: spState.currentTrack, isPlaying: spState.isPlaying });
  } else {
    // Premium Mode
    if (spState.isPlaying) await fetch('/api/spotify/pause', { method: 'POST' });
    else await fetch('/api/spotify/resume', { method: 'POST' });
  }
};

document.getElementById('spPrevBtn').onclick = () => {
  if (spState.mode === 'free') toast('Hanya preview, tidak ada previous.', 'info');
  else fetch('/api/spotify/prev', { method: 'POST' });
};

document.getElementById('spNextBtn').onclick = () => {
  if (spState.mode === 'free') fetch('/api/spotify/stop-preview', { method: 'POST' });
  else fetch('/api/spotify/next', { method: 'POST' });
};

// Volume control
let volTimer = null;
document.getElementById('spVolumeSlider').oninput = function () {
  const v = parseInt(this.value);
  document.getElementById('spVolumeVal').textContent = v + '%';
  if (spState.mode === 'free') {
    spAudio.volume = v / 100;
  } else {
    clearTimeout(volTimer);
    volTimer = setTimeout(() => {
      fetch('/api/spotify/volume', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ volume: v }),
      });
    }, 400);
  }
};

// Auto-play toggle in player panel
document.getElementById('spAutoPlayToggle').onchange = async function () {
  const autoPlay = this.checked;
  const mode         = document.getElementById('spMode').value;
  const clientId     = document.getElementById('spClientId').value.trim();
  const clientSecret = document.getElementById('spClientSecret').value.trim();
  await fetch('/api/spotify/credentials', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode, clientId, clientSecret, autoPlay }),
  });
  toast(autoPlay ? 'Auto-play aktif' : 'Auto-play dimatikan', 'info');
};

// ── Search ────────────────────────────────────────────────────
document.getElementById('spSearchBtn').onclick = spSearch;
document.getElementById('spSearchInput').addEventListener('keydown', e => {
  if (e.key === 'Enter') spSearch();
});

async function spSearch() {
  const q = document.getElementById('spSearchInput').value.trim();
  if (!q) return;
  const btn = document.getElementById('spSearchBtn');
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
  btn.disabled = true;

  try {
    const r = await fetch('/api/spotify/search?' + new URLSearchParams({ q, limit: 6 }));
    const d = await r.json();
    btn.innerHTML = '<i class="fas fa-search"></i> Cari';
    btn.disabled = false;

    if (!d.ok) return toast('Search gagal: ' + d.error, 'error');
    renderSpotifySearchResults(d.tracks || []);
  } catch (e) {
    btn.innerHTML = '<i class="fas fa-search"></i> Cari';
    btn.disabled = false;
    toast('Search error: ' + e.message, 'error');
  }
}

function renderSpotifySearchResults(tracks) {
  const el = document.getElementById('spSearchResults');
  if (!tracks.length) {
    el.innerHTML = '<div class="empty-state"><i class="fas fa-search"></i><span>Tidak ada hasil</span></div>';
    return;
  }
  
  window._spCurrentSearch = tracks;

  el.innerHTML = tracks.map((t, idx) => `
    <div class="sp-track-item">
      ${t.albumArt
        ? `<img class="sp-track-thumb" src="${escHtml(t.albumArt)}" alt="">`
        : `<div class="sp-track-thumb-ph"><i class="fas fa-music"></i></div>`
      }
      <div class="sp-ti-info">
        <div class="sp-ti-name">${escHtml(t.name)}</div>
        <div class="sp-ti-meta">${escHtml(t.artists)} · ${escHtml(t.album)}</div>
      </div>
      ${t.externalUrl
        ? `<a class="sp-preview-btn" href="${escHtml(t.externalUrl)}" target="_blank" title="Buka di Spotify"><i class="fab fa-spotify"></i></a>`
        : ''
      }
      <button class="sp-ti-play-btn" onclick="spPlaySearchTrack(${idx})" title="Putar">
        <i class="fas fa-play"></i>
      </button>
    </div>`
  ).join('');
}

window.spPlaySearchTrack = async (idx) => {
  const track = window._spCurrentSearch[idx];
  if (spState.mode === 'free') {
    if (!track.preview) return toast('Tidak ada preview audio gratis untuk lagu ini.', 'error');
    const r = await fetch('/api/spotify/play-preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ track }),
    });
    const d = await r.json();
    if (d.ok) toast('▶️ Memutar preview lagu!', 'success');
    else toast('Gagal putar: ' + d.error, 'error');
  } else {
    // Premium Mode
    const r = await fetch('/api/spotify/play', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uri: track.uri }),
    });
    const d = await r.json();
    if (d.ok) toast('▶️ Memutar lagu (Premium)!', 'success');
    else toast('Gagal putar: ' + d.error, 'error');
  }
};

// ── Devices (Premium Only) ────────────────────────────────────
document.getElementById('spRefreshDevices').onclick = spLoadDevices;

async function spLoadDevices() {
  if (spState.mode !== 'premium') return;
  const el = document.getElementById('spDevicesList');
  el.innerHTML = '<div class="empty-state"><i class="fas fa-spinner fa-spin"></i><span>Memuat...</span></div>';
  try {
    const r = await fetch('/api/spotify/devices');
    const d = await r.json();
    if (!d.ok || !d.devices.length) {
      el.innerHTML = '<div class="empty-state"><i class="fas fa-laptop"></i><span>Buka Spotify di browser/desktop terlebih dahulu</span></div>';
      return;
    }
    el.innerHTML = d.devices.map(dev => {
      const icons = { Computer: 'fa-desktop', Smartphone: 'fa-mobile-alt', Speaker: 'fa-volume-up', TV: 'fa-tv', CastAudio: 'fa-cast' };
      const icon = icons[dev.type] || 'fa-laptop';
      return `
        <div class="sp-device-item ${dev.is_active ? 'active-device' : ''}" onclick="spTransferTo('${dev.id}')">
          <div class="sp-device-icon"><i class="fas ${icon}"></i></div>
          <div class="sp-device-info">
            <div class="sp-device-name">${escHtml(dev.name)}</div>
            <div class="sp-device-type">${escHtml(dev.type || '')}</div>
          </div>
          ${dev.is_active ? '<span class="sp-device-badge">Active</span>' : ''}
        </div>`;
    }).join('');
  } catch (e) {
    el.innerHTML = '<div class="empty-state"><i class="fas fa-exclamation-circle"></i><span>' + e.message + '</span></div>';
  }
}

window.spTransferTo = async (deviceId) => {
  if (spState.mode !== 'premium') return;
  const r = await fetch('/api/spotify/transfer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceId }),
  });
  const d = await r.json();
  if (d.ok) { toast('Playback dipindah ke perangkat!', 'success'); spLoadDevices(); }
  else toast('Gagal pindah: ' + d.error, 'error');
};

// ── Logout ────────────────────────────────────────────────────
document.getElementById('spLogoutBtn').onclick = async () => {
  if (!confirm('Disconnect Spotify?')) return;
  if (spState.mode === 'free') spStopLocal();
  await fetch('/api/spotify/logout', { method: 'POST' });
  toast('Spotify disconnected', 'info');
  updateSpotifyUI({ isAuthenticated: false });
};

// ── Queue Management ──────────────────────────────────────────
socket.on('songQueue', data => {
  renderQueue(data.queue || []);
});

function renderQueue(queue) {
  const el = document.getElementById('spQueueList');
  const clearBtn = document.getElementById('spClearQueueBtn');
  
  if (!queue || queue.length === 0) {
    el.innerHTML = '<div class="empty-state"><i class="fas fa-music"></i><span>Antrean kosong</span></div>';
    if (clearBtn) clearBtn.style.display = 'none';
    return;
  }
  
  if (clearBtn) clearBtn.style.display = 'inline-block';
  
  el.innerHTML = queue.map(item => {
    const art = item.albumArt ? `<img class="sp-track-thumb" src="${escHtml(item.albumArt)}">` : `<div class="sp-track-thumb-ph"><i class="fas fa-music"></i></div>`;
    const title = item.spotifyName || item.song;
    const artist = item.spotifyArtist || 'Unknown Artist';
    const req = item.requesterNick || item.requester || 'User';
    
    return `
      <div class="sp-track-item">
        ${art}
        <div class="sp-ti-info">
          <div class="sp-ti-name">${escHtml(title)}</div>
          <div class="sp-ti-meta">${escHtml(artist)} · Req: @${escHtml(req)}</div>
        </div>
        <button class="sp-ti-play-btn" style="background:rgba(255,100,100,0.2); color:#ff6b6b;" onclick="removeFromQueue(${item.id})" title="Hapus">
          <i class="fas fa-trash"></i>
        </button>
      </div>`;
  }).join('');
}

window.removeFromQueue = async (id) => {
  const r = await fetch(`/api/spotify/queue/${id}`, { method: 'DELETE' });
  const d = await r.json();
  if (d.ok) toast('Lagu dihapus dari antrean', 'success');
};

document.getElementById('spClearQueueBtn').onclick = async () => {
  if (!confirm('Bersihkan seluruh antrean?')) return;
  const r = await fetch('/api/spotify/queue', { method: 'DELETE' });
  const d = await r.json();
  if (d.ok) toast('Antrean dibersihkan', 'success');
};
