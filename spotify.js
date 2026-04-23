const https = require('https');
const querystring = require('querystring');

let _mode          = 'free'; // 'free' or 'premium'
let _clientId      = '';
let _clientSecret  = '';
let _redirectUri   = '';

// Token state
let _accessToken   = null;
let _refreshToken  = null;
let _tokenExpires  = 0;

function init({ mode, clientId, clientSecret, redirectUri }) {
  _mode         = mode         || 'free';
  _clientId     = clientId     || '';
  _clientSecret = clientSecret || '';
  _redirectUri  = redirectUri  || '';
}

function isConfigured() {
  return !!(_clientId && _clientSecret);
}

// ── OAUTH (Premium Mode) ──────────────────────────────────────
function getAuthUrl() {
  const scopes = [
    'user-read-playback-state',
    'user-modify-playback-state',
    'user-read-currently-playing',
    'streaming',
    'user-read-email',
    'user-read-private',
  ].join(' ');

  const params = querystring.stringify({
    response_type : 'code',
    client_id     : _clientId,
    scope         : scopes,
    redirect_uri  : _redirectUri,
    show_dialog   : true,
  });

  return `https://accounts.spotify.com/authorize?${params}`;
}

async function exchangeCode(code) {
  const body = querystring.stringify({
    grant_type   : 'authorization_code',
    code,
    redirect_uri : _redirectUri,
  });
  const data = await spotifyPostAuth('https://accounts.spotify.com/api/token', body);
  if (data.access_token) {
    _accessToken  = data.access_token;
    _refreshToken = data.refresh_token;
    _tokenExpires = Date.now() + (data.expires_in - 30) * 1000;
    return true;
  }
  throw new Error(data.error_description || 'Token exchange failed');
}

async function refreshAccessToken() {
  if (!_refreshToken) throw new Error('No refresh token. Please re-authenticate.');
  const body = querystring.stringify({
    grant_type    : 'refresh_token',
    refresh_token : _refreshToken,
  });
  const data = await spotifyPostAuth('https://accounts.spotify.com/api/token', body);
  if (data.access_token) {
    _accessToken  = data.access_token;
    _tokenExpires = Date.now() + (data.expires_in - 30) * 1000;
    if (data.refresh_token) _refreshToken = data.refresh_token;
    return true;
  }
  throw new Error(data.error_description || 'Refresh failed');
}

// ── CLIENT CREDENTIALS (Free Mode) ───────────────────────────
async function fetchClientCredentialsToken() {
  const body = querystring.stringify({ grant_type: 'client_credentials' });
  const data = await spotifyPostAuth('https://accounts.spotify.com/api/token', body);
  if (data.access_token) {
    _accessToken  = data.access_token;
    _tokenExpires = Date.now() + (data.expires_in - 30) * 1000;
    return true;
  }
  throw new Error(data.error_description || 'Failed to get free mode token');
}

// ── ENSURE TOKEN ─────────────────────────────────────────────
async function ensureToken() {
  if (_accessToken && Date.now() < _tokenExpires) return;
  
  if (_mode === 'premium') {
    if (!_refreshToken) throw new Error('Not authenticated in Premium Mode. Please login.');
    await refreshAccessToken();
  } else {
    // Free mode
    await fetchClientCredentialsToken();
  }
}

// ── API Helpers ──────────────────────────────────────────────
async function searchTrack(query, limit = 5) {
  await ensureToken();
  const params = querystring.stringify({ q: query, type: 'track', limit });
  const data = await spotifyGet(`https://api.spotify.com/v1/search?${params}`);
  return (data.tracks?.items || []).map(t => ({
    id        : t.id,
    uri       : t.uri,
    name      : t.name,
    artists   : t.artists.map(a => a.name).join(', '),
    album     : t.album?.name || '',
    albumArt  : t.album?.images?.[0]?.url || '',
    duration  : t.duration_ms,
    preview   : t.preview_url || null,
    externalUrl: t.external_urls?.spotify || '',
  }));
}

async function getPlaybackState() {
  if (_mode !== 'premium') return null; // Only premium has playback state
  await ensureToken();
  const data = await spotifyGet('https://api.spotify.com/v1/me/player');
  if (!data || Object.keys(data).length === 0) return null;
  return {
    isPlaying   : data.is_playing,
    track       : data.item ? {
      id       : data.item.id,
      uri      : data.item.uri,
      name     : data.item.name,
      artists  : data.item.artists?.map(a => a.name).join(', '),
      album    : data.item.album?.name,
      albumArt : data.item.album?.images?.[0]?.url || '',
      duration : data.item.duration_ms,
      progress : data.progress_ms,
      externalUrl: data.item.external_urls?.spotify || '',
    } : null,
    deviceId    : data.device?.id,
    deviceName  : data.device?.name,
    volume      : data.device?.volume_percent,
  };
}

// Control functions (Premium Only)
async function playTrack(uri, deviceId) {
  if (_mode !== 'premium') throw new Error('Premium mode required');
  await ensureToken();
  const url = deviceId ? `https://api.spotify.com/v1/me/player/play?device_id=${deviceId}` : `https://api.spotify.com/v1/me/player/play`;
  await spotifyPut(url, JSON.stringify({ uris: [uri] }));
}

async function pause(deviceId) {
  if (_mode !== 'premium') throw new Error('Premium mode required');
  await ensureToken();
  const url = deviceId ? `https://api.spotify.com/v1/me/player/pause?device_id=${deviceId}` : `https://api.spotify.com/v1/me/player/pause`;
  await spotifyPut(url, '');
}

async function resume(deviceId) {
  if (_mode !== 'premium') throw new Error('Premium mode required');
  await ensureToken();
  const url = deviceId ? `https://api.spotify.com/v1/me/player/play?device_id=${deviceId}` : `https://api.spotify.com/v1/me/player/play`;
  await spotifyPut(url, '{}');
}

async function nextTrack(deviceId) {
  if (_mode !== 'premium') throw new Error('Premium mode required');
  await ensureToken();
  const url = deviceId ? `https://api.spotify.com/v1/me/player/next?device_id=${deviceId}` : `https://api.spotify.com/v1/me/player/next`;
  await spotifyPost(url, '');
}

async function prevTrack(deviceId) {
  if (_mode !== 'premium') throw new Error('Premium mode required');
  await ensureToken();
  const url = deviceId ? `https://api.spotify.com/v1/me/player/previous?device_id=${deviceId}` : `https://api.spotify.com/v1/me/player/previous`;
  await spotifyPost(url, '');
}

async function setVolume(pct, deviceId) {
  if (_mode !== 'premium') return;
  await ensureToken();
  let url = `https://api.spotify.com/v1/me/player/volume?volume_percent=${pct}`;
  if (deviceId) url += `&device_id=${deviceId}`;
  await spotifyPut(url, '');
}

async function getDevices() {
  if (_mode !== 'premium') return [];
  await ensureToken();
  const data = await spotifyGet('https://api.spotify.com/v1/me/player/devices');
  return data.devices || [];
}

async function transferPlayback(deviceId) {
  if (_mode !== 'premium') throw new Error('Premium mode required');
  await ensureToken();
  await spotifyPut('https://api.spotify.com/v1/me/player', JSON.stringify({ device_ids: [deviceId], play: true }));
}

// ── State ────────────────────────────────────────────────────
function getAuthState() {
  return {
    isConfigured   : isConfigured(),
    isAuthenticated: _mode === 'free' ? !!_accessToken : !!_refreshToken,
    mode           : _mode,
  };
}

function setTokens(access, refresh, expires) {
  _accessToken = access;
  _refreshToken = refresh;
  _tokenExpires = expires;
}

function clearTokens() {
  _accessToken = null;
  _refreshToken = null;
  _tokenExpires = 0;
}

// ── HTTP Core ────────────────────────────────────────────────
function spotifyPostAuth(url, body) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const creds = Buffer.from(`${_clientId}:${_clientSecret}`).toString('base64');
    const req = https.request({
      hostname: parsed.hostname, path: parsed.pathname, method: 'POST',
      headers: {
        'Authorization': `Basic ${creds}`,
        'Content-Type' : 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
      }
    }, (res) => {
      let raw = ''; res.on('data', c => raw += c);
      res.on('end', () => { try { resolve(JSON.parse(raw)); } catch { resolve({}); } });
    });
    req.on('error', reject); req.write(body); req.end();
  });
}

function spotifyGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'Authorization': `Bearer ${_accessToken}`, 'User-Agent': 'TikTokBot/2.0' } }, (res) => {
      let raw = ''; res.on('data', c => raw += c);
      res.on('end', () => {
        if (res.statusCode >= 400) {
          try { 
            const j = JSON.parse(raw);
            return reject(new Error(j.error?.message || j.error_description || (typeof j.error === 'string' ? j.error : false) || `HTTP ${res.statusCode}: ${raw}`)); 
          }
          catch { return reject(new Error(`HTTP ${res.statusCode}: ${raw.substring(0, 50)}`)); }
        }
        if (res.statusCode === 204 || !raw) return resolve({});
        try { resolve(JSON.parse(raw)); } catch { resolve({}); }
      });
    }).on('error', reject);
  });
}

function spotifyPost(url, body) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = https.request({
      hostname: parsed.hostname, path: parsed.pathname + parsed.search, method: 'POST',
      headers: {
        'Authorization': `Bearer ${_accessToken}`,
        'Content-Type': 'application/json',
        'User-Agent': 'TikTokBot/2.0',
        'Content-Length': Buffer.byteLength(body || '')
      }
    }, (res) => {
      let raw = ''; res.on('data', c => raw += c);
      res.on('end', () => {
        if (res.statusCode >= 400) {
          try { 
            const j = JSON.parse(raw);
            return reject(new Error(j.error?.message || j.error_description || (typeof j.error === 'string' ? j.error : false) || `HTTP ${res.statusCode}: ${raw}`)); 
          }
          catch { return reject(new Error(`HTTP ${res.statusCode}: ${raw.substring(0, 50)}`)); }
        }
        try { resolve(raw ? JSON.parse(raw) : {}); } catch { resolve({}); }
      });
    });
    req.on('error', reject); if (body) req.write(body); req.end();
  });
}

function spotifyPut(url, body) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = https.request({
      hostname: parsed.hostname, path: parsed.pathname + parsed.search, method: 'PUT',
      headers: {
        'Authorization': `Bearer ${_accessToken}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body || '')
      }
    }, (res) => {
      let raw = ''; res.on('data', c => raw += c);
      res.on('end', () => {
        if (res.statusCode >= 400) {
          try { reject(new Error(JSON.parse(raw).error?.message || `HTTP ${res.statusCode}`)); }
          catch { reject(new Error(`HTTP ${res.statusCode}`)); }
        } else {
          try { resolve(raw ? JSON.parse(raw) : {}); } catch { resolve({}); }
        }
      });
    });
    req.on('error', reject); if (body) req.write(body); req.end();
  });
}

module.exports = {
  init, isConfigured, getAuthUrl, exchangeCode, refreshAccessToken, ensureToken,
  searchTrack, getPlaybackState, playTrack, pause, resume, nextTrack, prevTrack,
  setVolume, getDevices, transferPlayback, getAuthState, setTokens, clearTokens
};
