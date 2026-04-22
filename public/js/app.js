// ============================================================
//  TikTok Live Bot v2 — app.js (Dashboard)
// ============================================================

const socket = io();
const BASE   = window.location.origin;

// ── State ────────────────────────────────────────────────────
let ttsEnabled    = true;
let ttsQueue      = [];
let ttsSpeaking   = false;
let ttsSafeTimer  = null;  // safety reset if onend never fires
let voicesLoaded  = false; // prevent double load
let settings     = { tts:{ chat:true, gift:true, join:true, follow:true }, ttsRate:1, ttsPitch:1, ttsVolume:1, overlayTheme:'dark', chatMax:30 };
let currentTab   = 'chat';
let autoscroll   = true;
let chatFilter   = '';
let chatLimit    = 30;  // max messages shown in dashboard

// ── Overlay URLs ─────────────────────────────────────────────
function setOverlayUrls(){
  const urls = { 
    chat: `${BASE}/overlay/chat`, 
    gift: `${BASE}/overlay/gift`, 
    leaderboard: `${BASE}/overlay/leaderboard`,
    song: `${BASE}/overlays/song.html`,
    qr: `${BASE}/overlays/qr.html`,
    goal: `${BASE}/overlays/goal.html`
  };
  document.getElementById('olChatUrl').textContent       = urls.chat;
  document.getElementById('olGiftUrl').textContent       = urls.gift;
  document.getElementById('olLeaderboardUrl').textContent= urls.leaderboard;
  document.getElementById('olSongUrl').textContent       = urls.song;
  document.getElementById('olQrUrl').textContent         = urls.qr;
  document.getElementById('olGoalUrl').textContent       = urls.goal;
  
  document.getElementById('olChatOpen').href             = urls.chat;
  document.getElementById('olGiftOpen').href             = urls.gift;
  document.getElementById('olLeaderboardOpen').href      = urls.leaderboard;
  document.getElementById('olSongOpen').href             = urls.song;
  document.getElementById('olQrOpen').href               = urls.qr;
  document.getElementById('olGoalOpen').href             = urls.goal;
  
  document.getElementById('urlChat').textContent         = urls.chat;
  document.getElementById('urlGift').textContent         = urls.gift;
  document.getElementById('urlLeaderboard').textContent  = urls.leaderboard;
  document.getElementById('urlSong').textContent         = urls.song;
  // Also need an entry in the lower settings tab URL section
  const urlQrEl = document.getElementById('urlQr');
  if(urlQrEl) urlQrEl.textContent = urls.qr;
  const urlGoalEl = document.getElementById('urlGoal');
  if(urlGoalEl) urlGoalEl.textContent = urls.goal;
}
setOverlayUrls();

window.copyOverlay = function(type, isDirectFile){
  const url = isDirectFile ? `${BASE}/overlays/${type}` : `${BASE}/overlay/${type}`;
  navigator.clipboard.writeText(url).then(()=>toast('URL disalin!','success'));
};

window.previewOverlay = function(type, title, isDirectFile){
  const url = isDirectFile ? `${BASE}/overlays/${type}` : `${BASE}/overlay/${type}`;
  document.getElementById('previewModalTitle').textContent = '👁 Preview — ' + title;
  document.getElementById('psOverlayName').textContent = title;
  document.getElementById('previewFrame').src = url;
  document.getElementById('previewOpenBtn').href = url;
  document.getElementById('previewCopyBtn').onclick = () =>
    navigator.clipboard.writeText(url).then(()=>toast('URL disalin!','success'));

  // Always show sidebar
  document.getElementById('previewSettings').style.display = 'flex';
  
  // Show/hide chat-specific settings
  document.getElementById('psChatSettings').style.display = type === 'chat' ? 'block' : 'none';

  // Show test button for gift overlay
  const testBtn = document.getElementById('previewTestBtn');
  testBtn.style.display = type === 'gift' ? 'inline-flex' : 'none';
  testBtn.onclick = () => fetch('/api/test-alert', { method: 'POST' });

  // Sync sidebar values from current settings
  document.getElementById('psTheme').value = settings.overlayTheme || 'dark';
  if(type === 'chat'){
    document.getElementById('psChatMax').value  = settings.chatMax      || 30;
    document.getElementById('psFontSize').value = settings.chatFontSize || 14;
    document.getElementById('psAnimation').value= settings.chatAnimation|| 'slideUp';
    document.getElementById('psPosition').value = settings.chatPosition || 'bottom';
    document.getElementById('psShowChat').checked  = settings.chatShow?.chat   !== false;
    document.getElementById('psShowJoin').checked  = settings.chatShow?.join   !== false;
    document.getElementById('psShowFollow').checked= settings.chatShow?.follow !== false;
    document.getElementById('psShowAvatar').checked= settings.chatShowAvatar !== false;
    document.getElementById('psShowBadge').checked = settings.chatShowBadge  !== false;
  }

  document.getElementById('previewModal').classList.add('open');
};

// Apply overlay settings
document.getElementById('psApplyBtn').onclick = async () => {
  const s = { overlayTheme: document.getElementById('psTheme').value };
  
  if (document.getElementById('psChatSettings').style.display !== 'none') {
    s.chatMax        = parseInt(document.getElementById('psChatMax').value);
    s.chatFontSize   = parseInt(document.getElementById('psFontSize').value);
    s.chatAnimation  = document.getElementById('psAnimation').value;
    s.chatPosition   = document.getElementById('psPosition').value;
    s.chatShow       = {
      chat  : document.getElementById('psShowChat').checked,
      join  : document.getElementById('psShowJoin').checked,
      follow: document.getElementById('psShowFollow').checked,
    };
    s.chatShowAvatar = document.getElementById('psShowAvatar').checked;
    s.chatShowBadge  = document.getElementById('psShowBadge').checked;
  }
  
  await fetch('/api/settings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(s)});
  Object.assign(settings, s);
  
  // Refresh iframe to apply changes
  const frame = document.getElementById('previewFrame');
  frame.src = frame.src;
  toast('Tema/Pengaturan overlay diterapkan!','success');
};

// Close modal
document.getElementById('previewCloseBtn').onclick = closePreview;
document.getElementById('previewModal').onclick = (e) => {
  if(e.target.id === 'previewModal') closePreview();
};
document.addEventListener('keydown', e => { if(e.key==='Escape') closePreview(); });
function closePreview(){
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
  if(data.chatLog) data.chatLog.forEach(e => appendChatItem(e, false));
  if(data.giftLog) data.giftLog.forEach(e => appendGiftItem(e, false));
  updateConnectionUI(data.connected, data.username);
});

socket.on('botStatus', data => {
  updateConnectionUI(data.connected, data.username);
  if(data.reason) toast(data.reason, data.connected ? 'success' : 'error');
});

socket.on('stats', data => applyStats(data));

socket.on('chatEvent', data => {
  appendChatItem(data, true);
  if(data.type === 'chat'   && settings.tts?.chat)   speakTTS(`${data.nickname || data.user} berkata: ${data.msg}`);
  if(data.type === 'join'   && settings.tts?.join)   speakTTS(`${data.nickname || data.user} bergabung`);
  if(data.type === 'follow' && settings.tts?.follow) speakTTS(`${data.nickname || data.user} mengikuti`);
});

socket.on('giftEvent', data => {
  appendGiftItem(data, true);
  if(settings.tts?.gift) speakTTS(`${data.nickname || data.user} mengirim ${data.gift} sebanyak ${data.count} kali`);
});

socket.on('giftGoal',    data => renderGiftGoal(data));
socket.on('leaderboard', data => renderLeaderboard(data));
socket.on('songQueue',   data => renderSongQueue(data.queue, data.nowPlaying));
socket.on('botCommands', data => renderBotCommands(data));
socket.on('settings',    data => applySettings(data));
socket.on('botReply',    data => appendBotReply(data));
socket.on('botError',    data => toast('❌ ' + data.message, 'error'));

// ── Connect / Disconnect ──────────────────────────────────────
document.getElementById('connectBtn').onclick = async () => {
  const uname = document.getElementById('usernameInput').value.trim();
  if(!uname) return toast('Masukkan username TikTok!','error');
  document.getElementById('connectBtn').disabled = true;
  document.getElementById('statusText').textContent = 'Connecting...';
  document.getElementById('statusDot').className = 'status-dot pulsing';
  const r = await fetch('/api/connect',{ method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ username: uname }) });
  const d = await r.json();
  document.getElementById('connectBtn').disabled = false;
  if(!d.ok) toast('Gagal connect: ' + d.error,'error');
};

document.getElementById('disconnectBtn').onclick = async () => {
  await fetch('/api/disconnect',{ method:'POST' });
};

// ── Connection UI ─────────────────────────────────────────────
function updateConnectionUI(connected, username){
  const dot  = document.getElementById('statusDot');
  const txt  = document.getElementById('statusText');
  const conn = document.getElementById('connectBtn');
  const disc = document.getElementById('disconnectBtn');
  if(connected){
    dot.className  = 'status-dot online';
    txt.textContent= `Live: @${username}`;
    conn.classList.add('hidden');
    disc.classList.remove('hidden');
  } else {
    dot.className  = 'status-dot offline';
    txt.textContent= 'Offline';
    conn.classList.remove('hidden');
    disc.classList.add('hidden');
  }
}

// ── Stats ─────────────────────────────────────────────────────
function applyStats(d){
  animCount('statViewers', d.viewers);
  animCount('statLikes',   d.likes);
  animCount('statFollows', d.follows);
  animCount('statShares',  d.shares);
  if(d.giftGoal) renderGiftGoal(d.giftGoal);
}

function animCount(id, val){
  const el = document.getElementById(id);
  if(!el) return;
  const target = parseInt(val) || 0;
  const current = parseInt(el.textContent.replace(/,/g,'')) || 0;
  if(current === target) return;
  const diff = target - current;
  const steps = 20;
  let i = 0;
  const t = setInterval(()=>{
    i++;
    el.textContent = fmtNum(Math.round(current + diff*(i/steps)));
    if(i>=steps){ el.textContent = fmtNum(target); clearInterval(t); }
  }, 20);
}

function fmtNum(n){ return n >= 1000 ? (n/1000).toFixed(1)+'K' : n; }

// ── Gift Goal ─────────────────────────────────────────────────
function renderGiftGoal(g){
  if(!g) return;
  document.getElementById('statGoalCurrent').textContent = fmtNum(g.current||0);
  document.getElementById('statGoalTarget').textContent  = fmtNum(g.target||1000);
  document.getElementById('statGoalLabel').textContent   = g.label||'Gift Goal';
  const pct = Math.min(100, Math.round((g.current||0)/(g.target||1)*100));
  document.getElementById('goalBar').style.width = pct+'%';
  document.getElementById('goalLabel').value  = g.label||'Gift Goal';
  document.getElementById('goalTarget').value = g.target||1000;
}

document.getElementById('saveGoalBtn').onclick = async () => {
  await fetch('/api/gift-goal',{ method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ target: document.getElementById('goalTarget').value, label: document.getElementById('goalLabel').value }) });
  toast('Gift goal disimpan!','success');
};

// ── Chat Log ──────────────────────────────────────────────────
function appendChatItem(ev, scroll=true){
  const log = document.getElementById('chatLog');

  // Filter
  if(chatFilter && !JSON.stringify(ev).toLowerCase().includes(chatFilter)) return;

  const el = document.createElement('div');
  el.className = `chat-item type-${ev.type}${ev.isBot?' bot-reply':''}`;

  const time = new Date(ev.ts||Date.now()).toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit'});
  const user = ev.nickname || ev.user || 'Unknown';
  const verified = ev.verified ? '<i class="fas fa-check-circle chat-verified" title="Verified/Mod"></i>' : '';
  const badges = (ev.badges||[]).map(b=>`<span class="chat-badge badge-${b}">${b}</span>`).join('');
  const avatar = ev.avatar
    ? `<img class="chat-avatar" src="${ev.avatar}" alt="${user}" onerror="this.style.display='none'">`
    : `<div class="chat-avatar">${user[0]?.toUpperCase()||'?'}</div>`;

  let body = '';
  if(ev.type === 'chat'){
    body = `<div class="chat-header"><span class="chat-username">${user}</span>${verified}${badges}<span class="chat-time">${time}</span></div>
            <div class="chat-msg">${escHtml(ev.msg||'')}</div>`;
  } else if(ev.type === 'join'){
    body = `<div class="chat-header"><span class="chat-username">${user}</span>${verified}<span class="chat-time">${time}</span></div>
            <div class="chat-event-text"><i class="fas fa-door-open" style="color:var(--green)"></i> Bergabung ke live!</div>`;
  } else if(ev.type === 'follow'){
    body = `<div class="chat-header"><span class="chat-username">${user}</span><span class="chat-time">${time}</span></div>
            <div class="chat-event-text"><i class="fas fa-heart" style="color:var(--accent)"></i> Baru saja follow!</div>`;
  }

  el.innerHTML = avatar + `<div class="chat-body">${body}</div>`;
  log.appendChild(el);

  // Enforce chat limit
  const lim = chatLimit || 200;
  while(log.children.length > lim) log.removeChild(log.firstChild);
  if(scroll && autoscroll) log.scrollTop = log.scrollHeight;
}

function appendBotReply(data){
  appendChatItem({ type:'chat', user:'🤖 Bot', nickname:'🤖 Bot', msg: data.msg, verified:false, badges:[], isBot:true, ts:Date.now() }, true);
  const log = document.getElementById('botRepliesLog');
  const el  = document.createElement('div');
  el.className = 'bot-reply-item';
  el.textContent = data.msg;
  log.insertBefore(el, log.firstChild);
  while(log.children.length > 30) log.removeChild(log.lastChild);
}

// ── Gift Log ──────────────────────────────────────────────────
function appendGiftItem(ev, scroll=true){
  const log = document.getElementById('giftLog');
  const el  = document.createElement('div');
  el.className = 'gift-item';
  const time = new Date(ev.ts||Date.now()).toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit'});
  const img  = ev.giftImg ? `<img src="${ev.giftImg}" width="28" height="28" style="border-radius:4px" onerror="this.style.display='none'">` : '🎁';
  el.innerHTML = `<div class="gift-icon">${img}</div>
    <div class="gift-info">
      <div class="gift-name">${escHtml(ev.gift||'Gift')}</div>
      <div class="gift-meta">dari @${ev.nickname||ev.user} × ${ev.count} &nbsp;•&nbsp; ${time}</div>
    </div>
    <div class="gift-diamonds"><i class="fas fa-gem"></i> ${ev.diamonds||0}</div>`;
  log.insertBefore(el, log.firstChild);
  while(log.children.length > 100) log.removeChild(log.lastChild);
  if(scroll && currentTab==='gifts') log.scrollTop = 0;
}

// ── Leaderboard ───────────────────────────────────────────────
function renderLeaderboard(list){
  const el = document.getElementById('leaderboardList');
  if(!list||!list.length){ el.innerHTML='<div class="empty-state"><i class="fas fa-gem"></i><span>Belum ada gift</span></div>'; return; }
  el.innerHTML = list.map(u=>`
    <div class="lb-item">
      <div class="lb-rank${u.rank<=3?' r'+u.rank:''}">${u.rank}</div>
      <div class="lb-name">@${u.username}</div>
      <div class="lb-diamonds"><i class="fas fa-gem"></i> ${u.diamonds.toLocaleString()}</div>
    </div>`).join('');
}

// ── Song Queue ────────────────────────────────────────────────
function renderSongQueue(queue, nowPlaying){
  const qCount = document.getElementById('queueCount');
  qCount.textContent = queue?.length || 0;

  const npCard = document.getElementById('nowPlayingCard');
  if(nowPlaying){
    const qYoutube = `https://www.youtube.com/results?search_query=${encodeURIComponent(nowPlaying.song)}`;
    const qSpotify = `https://open.spotify.com/search/${encodeURIComponent(nowPlaying.song)}`;
    npCard.innerHTML = `<div class="np-info">
      <div class="song-title"><i class="fas fa-music" style="color:var(--accent2)"></i> ${escHtml(nowPlaying.song)}</div>
      <div class="song-req">Req by @${escHtml(nowPlaying.requesterNick||nowPlaying.requester)}</div>
      <div style="display:flex;gap:8px;margin-top:10px">
        <a href="${qYoutube}" target="_blank" class="oc-btn" style="background:#cc0000;color:#fff"><i class="fab fa-youtube"></i> Cari YouTube</a>
        <a href="${qSpotify}" target="_blank" class="oc-btn" style="background:#1db954;color:#fff"><i class="fab fa-spotify"></i> Cari Spotify</a>
      </div>
    </div>`;
  } else {
    npCard.innerHTML = '<div class="np-idle"><i class="fas fa-music"></i><span>Tidak ada lagu</span></div>';
  }

  const qList = document.getElementById('songQueueList');
  if(!queue||!queue.length){ qList.innerHTML='<div class="empty-state"><i class="fas fa-music"></i><span>Antrian kosong<br><small>Penonton bisa request dengan !sr [lagu]</small></span></div>'; return; }
  qList.innerHTML = queue.map((s,i)=>`
    <div class="queue-item">
      <div class="queue-num">${i+1}</div>
      <div class="queue-info">
        <div class="queue-song">${escHtml(s.song)}</div>
        <div class="queue-req">@${escHtml(s.requesterNick||s.requester)}</div>
      </div>
      <a href="https://www.youtube.com/results?search_query=${encodeURIComponent(s.song)}" target="_blank" class="queue-del" style="color:#ff4444;text-decoration:none;margin-right:4px" title="Cari di YouTube"><i class="fab fa-youtube"></i></a>
      <button class="queue-del" onclick="removeSong('${s.id}')" title="Hapus"><i class="fas fa-times"></i></button>
    </div>`).join('');
}

document.getElementById('skipSongBtn').onclick  = () => fetch('/api/song/play-next',{method:'POST'});
document.getElementById('clearQueueBtn').onclick = () => { if(confirm('Hapus semua antrian?')) fetch('/api/song/clear',{method:'POST'}); };
window.removeSong = id => fetch('/api/song/remove',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id})});

// ── Bot Commands ──────────────────────────────────────────────
document.getElementById('addCommandBtn').onclick = async () => {
  const trigger  = document.getElementById('cmdTrigger').value.trim();
  const response = document.getElementById('cmdResponse').value.trim();
  if(!trigger||!response) return toast('Isi trigger dan respons!','error');
  const r = await fetch('/api/commands',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({trigger,response})});
  const d = await r.json();
  if(d.ok){ document.getElementById('cmdTrigger').value=''; document.getElementById('cmdResponse').value=''; toast('Command ditambah!','success'); }
  else toast(d.error,'error');
};

window.deleteCommand = async id => {
  await fetch(`/api/commands/${id}`,{method:'DELETE'});
  toast('Command dihapus','info');
};

function renderBotCommands(cmds){
  const el = document.getElementById('customCommandsList');
  if(!cmds||!cmds.length){ el.innerHTML='<div class="empty-state"><i class="fas fa-terminal"></i><span>Belum ada custom command</span></div>'; return; }
  el.innerHTML = cmds.map(c=>`
    <div class="custom-cmd-item">
      <div class="custom-cmd-trigger">${escHtml(c.trigger)}</div>
      <div class="custom-cmd-response">${escHtml(c.response)}</div>
      <button class="custom-cmd-del" onclick="deleteCommand(${c.id})" title="Hapus"><i class="fas fa-trash"></i></button>
    </div>`).join('');
}

// ── Settings ──────────────────────────────────────────────────
function applySettings(s){
  if(!s) return;
  Object.assign(settings, s);
  if(s.tts){
    document.getElementById('ttsChatToggle').checked   = !!s.tts.chat;
    document.getElementById('ttsGiftToggle').checked   = !!s.tts.gift;
    document.getElementById('ttsJoinToggle').checked   = !!s.tts.join;
    document.getElementById('ttsFollowToggle').checked = !!s.tts.follow;
  }
  if(s.ttsRate)   { document.getElementById('ttsRate').value   = s.ttsRate;   document.getElementById('ttsRateVal').textContent  = s.ttsRate; }
  if(s.ttsPitch)  { document.getElementById('ttsPitch').value  = s.ttsPitch;  document.getElementById('ttsPitchVal').textContent = s.ttsPitch; }
  if(s.ttsVolume!=null){ document.getElementById('ttsVolume').value = s.ttsVolume; document.getElementById('ttsVolVal').textContent = Math.round(s.ttsVolume*100); }
  if(s.overlayTheme) setActiveTheme(s.overlayTheme);
  if(s.chatMax)   document.getElementById('chatMaxOverlay').value = s.chatMax;
  if(s.sociaBuzzUrl !== undefined) document.getElementById('sociaBuzzInput').value = s.sociaBuzzUrl;
  if(s.sessionId !== undefined) document.getElementById('sessionIdInput').value = s.sessionId;
  if(s.proxy !== undefined) document.getElementById('proxyInput').value = s.proxy;
  if(s.welcomeEnabled !== undefined) document.getElementById('welcomeToggle').checked = s.welcomeEnabled;
}

document.getElementById('saveSettingsBtn').onclick = async () => {
  const s = {
    tts: {
      chat   : document.getElementById('ttsChatToggle').checked,
      gift   : document.getElementById('ttsGiftToggle').checked,
      join   : document.getElementById('ttsJoinToggle').checked,
      follow : document.getElementById('ttsFollowToggle').checked,
    },
    ttsRate   : parseFloat(document.getElementById('ttsRate').value),
    ttsPitch  : parseFloat(document.getElementById('ttsPitch').value),
    ttsVolume : parseFloat(document.getElementById('ttsVolume').value),
    overlayTheme : document.querySelector('.theme-item.active')?.dataset.theme || 'dark',
    chatMax   : parseInt(document.getElementById('chatMaxOverlay').value) || 30,
    sociaBuzzUrl : document.getElementById('sociaBuzzInput').value.trim(),
    sessionId : document.getElementById('sessionIdInput').value.trim(),
    proxy : document.getElementById('proxyInput').value.trim(),
    welcomeEnabled : document.getElementById('welcomeToggle').checked,
  };
  await fetch('/api/settings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(s)});
  Object.assign(settings, s);
  toast('Settings disimpan!','success');
};

// Range labels
['ttsRate','ttsPitch','ttsVolume'].forEach(id=>{
  const el = document.getElementById(id);
  const lbl= document.getElementById(id==='ttsVolume'?'ttsVolVal':id+'Val');
  el.oninput = ()=>{ lbl.textContent = id==='ttsVolume'? Math.round(el.value*100) : parseFloat(el.value).toFixed(1); };
});

// Theme picker
document.getElementById('themeGrid').onclick = e => {
  const item = e.target.closest('.theme-item');
  if(!item) return;
  setActiveTheme(item.dataset.theme);
};

function setActiveTheme(theme){
  document.querySelectorAll('.theme-item').forEach(i=>i.classList.toggle('active', i.dataset.theme===theme));
}

// ── TTS Voices ────────────────────────────────────────────────
function loadVoices(){
  const voices = speechSynthesis.getVoices();
  if(!voices.length) return; // not ready yet
  if(voicesLoaded) return;   // already loaded, skip duplicate call
  voicesLoaded = true;

  const sel = document.getElementById('ttsVoiceSelect');
  sel.innerHTML = '';
  let idIdx = -1;
  voices.forEach((v,i)=>{
    const o = document.createElement('option');
    o.value = i;
    o.textContent = `${v.name} (${v.lang})`;
    sel.appendChild(o);
    if(idIdx === -1 && v.lang.toLowerCase().startsWith('id')) idIdx = i;
  });
  if(idIdx !== -1) sel.value = idIdx; // auto-select Indonesian
}
// onvoiceschanged fires once voices are ready (Chrome async)
speechSynthesis.onvoiceschanged = loadVoices;
loadVoices(); // also try immediately (Firefox/Edge)

document.getElementById('testTtsBtn').onclick = ()=>speakTTS('Halo! TTS sudah berfungsi dengan baik.');

document.getElementById('ttsToggleBtn').onclick = ()=>{
  ttsEnabled = !ttsEnabled;
  document.getElementById('ttsToggleBtn').classList.toggle('active', ttsEnabled);
  toast(ttsEnabled ? 'TTS aktif' : 'TTS dimatikan', 'info');
};

// ── TTS Engine ────────────────────────────────────────────────
function speakTTS(text){
  if(!ttsEnabled) return;
  // Dedupe: skip if same text already queued last
  if(ttsQueue.length && ttsQueue[ttsQueue.length-1] === text) return;
  ttsQueue.push(text);
  processTTSQueue();
}

function processTTSQueue(){
  if(ttsSpeaking || !ttsQueue.length) return;
  ttsSpeaking = true;

  const text = ttsQueue.shift();

  // Cancel any stuck/running speech first (fixes Chrome double-speak bug)
  speechSynthesis.cancel();

  // Small delay after cancel so Chrome clears its buffer
  setTimeout(()=>{
    const utt  = new SpeechSynthesisUtterance(text);
    utt.lang   = 'id-ID';
    const voices = speechSynthesis.getVoices();
    const vidx   = parseInt(document.getElementById('ttsVoiceSelect').value);
    if(voices[vidx]) utt.voice = voices[vidx];
    utt.rate   = parseFloat(document.getElementById('ttsRate').value)   || 1;
    utt.pitch  = parseFloat(document.getElementById('ttsPitch').value)  || 1;
    utt.volume = parseFloat(document.getElementById('ttsVolume').value) || 1;

    function done(){ clearTimeout(ttsSafeTimer); ttsSpeaking=false; processTTSQueue(); }
    utt.onend  = done;
    utt.onerror= done;

    // Safety: if onend never fires (Chrome bug), force-reset after 15s
    ttsSafeTimer = setTimeout(done, 15000);

    speechSynthesis.speak(utt);
  }, 80);
}

// ── Tabs ──────────────────────────────────────────────────────
document.getElementById('mainTabs').onclick = e => {
  const btn = e.target.closest('.tab-btn');
  if(!btn) return;
  const tab = btn.dataset.tab;
  document.querySelectorAll('.tab-btn').forEach(b=>b.classList.toggle('active', b===btn));
  document.querySelectorAll('.tab-panel').forEach(p=>p.classList.toggle('active', p.id==='tab-'+tab));
  currentTab = tab;
};

// ── Chat toolbar ──────────────────────────────────────────────
document.getElementById('clearChatBtn').onclick = ()=>{ document.getElementById('chatLog').innerHTML=''; toast('Chat dibersihkan','info'); };
document.getElementById('clearGiftBtn').onclick = ()=>{ document.getElementById('giftLog').innerHTML=''; toast('Gift log dibersihkan','info'); };
document.getElementById('autoscrollChat').onchange = e => autoscroll = e.target.checked;
document.getElementById('chatFilter').oninput = e => chatFilter = e.target.value.toLowerCase();

// Chat limit dropdown
document.getElementById('chatLimitSelect').onchange = function(){
  chatLimit = parseInt(this.value) || 0;
  trimChatLog();
};

function trimChatLog(){
  if(!chatLimit) return; // 0 = semua
  const log = document.getElementById('chatLog');
  while(log.children.length > chatLimit) log.removeChild(log.firstChild);
}

// ── Fullscreen ────────────────────────────────────────────────
document.getElementById('fullscreenBtn').onclick = ()=>{
  if(!document.fullscreenElement) document.documentElement.requestFullscreen();
  else document.exitFullscreen();
};

// ── Toast ─────────────────────────────────────────────────────
function toast(msg, type='info'){
  const c   = document.getElementById('toastContainer');
  const el  = document.createElement('div');
  el.className = `toast ${type}`;
  const icons = { success:'fa-check-circle', error:'fa-exclamation-circle', info:'fa-info-circle' };
  el.innerHTML = `<i class="fas ${icons[type]||icons.info}"></i> ${msg}`;
  c.appendChild(el);
  setTimeout(()=>el.remove(), 3500);
}

// ── Utils ─────────────────────────────────────────────────────
function escHtml(s){ return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
