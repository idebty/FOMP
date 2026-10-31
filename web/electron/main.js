

const { app, BrowserWindow, ipcMain, protocol, shell, Menu, dialog, globalShortcut, safeStorage, nativeImage, Notification } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const net = require('net');
const { Readable } = require('stream');
const jsmediatags = require('jsmediatags');
const { writeZipArchive, readZipDirectory, extractZipEntry } = require('./flib-archive');

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
  return;
}

let mainWindowRef = null;
let miniPlayerRestoreBounds = null;
let miniPlayerMode = false;
let miniPlayerAlwaysOnTop = true;
let autoMiniPlayerEnabled = true;
let backgroundHotkeysEnabled = false;
let backgroundToggleShortcutRegistered = false;
let lastBackgroundHotkeyToggleAt = 0;
const registeredBackgroundPlayerHotkeys = new Set();
const DEFAULT_BACKGROUND_HOTKEYS = {
  fullscreen: 'Control+Alt+F',
  playback: 'Control+Alt+Space',
  previous: 'Control+Alt+Left',
  next: 'Control+Alt+Right',
  seekBack: 'Control+Alt+Shift+Left',
  seekForward: 'Control+Alt+Shift+Right',
  volumeUp: 'Control+Alt+Up',
  volumeDown: 'Control+Alt+Down'
};
const BACKGROUND_HOTKEY_ACTIONS = {
  fullscreen: 'toggle-fullscreen',
  playback: 'toggle-playback',
  previous: 'previous-track',
  next: 'next-track',
  seekBack: 'seek-back',
  seekForward: 'seek-forward',
  volumeUp: 'volume-up',
  volumeDown: 'volume-down'
};
const MINI_PLAYER_TRIGGER_WIDTH = 720;
const MINI_PLAYER_TRIGGER_HEIGHT = 480;
const MAX_DISCORD_IPC_PIPE_INDEX = 255;

app.on('second-instance', () => {
  if (mainWindowRef) {
    if (mainWindowRef.isMinimized()) mainWindowRef.restore();
    mainWindowRef.focus();
  }
});

const userDataPath = app.getPath('userData');
if (!fs.existsSync(userDataPath)) {
  fs.mkdirSync(userDataPath, { recursive: true });
}

const dbPath = path.join(userDataPath, 'music.json');
const playlistsDbPath = path.join(userDataPath, 'playlists.json');
const settingsPath = path.join(userDataPath, 'settings.json');
const artworkDir = path.join(userDataPath, 'artwork');
const lyricsDir = path.join(userDataPath, 'lyrics');
const discordSecretPath = path.join(userDataPath, 'discord-github-token.bin');
fs.mkdirSync(artworkDir, { recursive: true });
fs.mkdirSync(lyricsDir, { recursive: true });

const IMAGE_TYPES = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/bmp': '.bmp'
};

function normalizeArtworkPath(imagePath) {
  if (typeof imagePath !== 'string' || !imagePath) return '';
  const absolutePath = path.resolve(userDataPath, imagePath);
  const relativePath = path.relative(artworkDir, absolutePath);
  if (!relativePath || relativePath.startsWith('..') || path.isAbsolute(relativePath)) return '';
  return fs.existsSync(absolutePath) ? path.join('artwork', relativePath).split(path.sep).join('/') : '';
}

function imageMimeType(format, bytes) {
  const normalized = typeof format === 'string' ? format.toLowerCase().replace(/^image\//, '') : '';
  const aliases = { jpg: 'image/jpeg', jpeg: 'image/jpeg', pjpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp' };
  const declaredType = aliases[normalized] || (format && format.toLowerCase());
  if (declaredType && IMAGE_TYPES[declaredType]) return declaredType;

  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (bytes.length >= 6 && ['GIF87a', 'GIF89a'].includes(bytes.subarray(0, 6).toString('ascii'))) return 'image/gif';
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  if (bytes.length >= 2 && bytes[0] === 0x42 && bytes[1] === 0x4d) return 'image/bmp';
  return '';
}

function saveArtworkBytes(format, data) {
  const bytes = Buffer.from(data || []);
  const mimeType = imageMimeType(format, bytes);
  if (!bytes.length || !mimeType) return '';
  const extension = IMAGE_TYPES[mimeType];
  const filename = `${crypto.randomUUID()}${extension}`;
  fs.writeFileSync(path.join(artworkDir, filename), bytes);
  return `artwork/${filename}`;
}

function saveArtwork(value) {
  if (typeof value !== 'string' || !value) return '';
  const existingPath = normalizeArtworkPath(value);
  if (existingPath) return existingPath;

  const match = value.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=\r\n]+)$/);
  if (!match) return '';
  return saveArtworkBytes(match[1], Buffer.from(match[2], 'base64'));
}

function normalizeTrackArtwork(track) {
  if (!track || typeof track !== 'object') return false;
  let changed = false;
  if (typeof track.imageUrl === 'string') {
    const imagePath = saveArtwork(track.imageUrl);
    if (imagePath) track.imagePath = imagePath;
    delete track.imageUrl;
    changed = true;
  }
  if (typeof track.imagePath === 'string') {
    const imagePath = normalizeArtworkPath(track.imagePath);
    if (imagePath !== track.imagePath) {
      track.imagePath = imagePath;
      changed = true;
    }
  }
  return changed;
}

function normalizePlaylistArtwork(playlist) {
  if (!playlist || typeof playlist !== 'object') return false;
  let changed = false;
  if (Object.prototype.hasOwnProperty.call(playlist, 'coverImage')) {
    const imagePath = saveArtwork(playlist.coverImage);
    if (imagePath) playlist.coverImagePath = imagePath;
    delete playlist.coverImage;
    changed = true;
  }
  if (typeof playlist.coverImagePath === 'string') {
    const imagePath = normalizeArtworkPath(playlist.coverImagePath);
    if (imagePath !== playlist.coverImagePath) {
      playlist.coverImagePath = imagePath || null;
      changed = true;
    }
  }
  (playlist.tracks || []).forEach(track => {
    if (normalizeTrackArtwork(track)) changed = true;
  });
  return changed;
}

function artworkDataUrl(imagePath) {
  const normalizedPath = normalizeArtworkPath(imagePath);
  if (!normalizedPath) return '';
  const extension = path.extname(normalizedPath).toLowerCase();
  const mimeType = Object.entries(IMAGE_TYPES).find(([, ext]) => ext === extension)?.[0];
  if (!mimeType) return '';
  return `data:${mimeType};base64,${fs.readFileSync(path.join(userDataPath, normalizedPath)).toString('base64')}`;
}

// settings. read synchronously some valuee like hardware acceleration must be applied before app.whenReady()


const DEFAULT_SETTINGS = {
  volume: 1,
  muted: false,
  watchFolder: null,
  resumeSession: true,
  startupPage: 'home',
  hardwareAcceleration: true,
  lastSession: { trackPath: null, position: 0 },
  eq: { bass: 0, mid: 0, treble: 0 },
  normalize: false,
  autoMiniPlayer: true,
  miniPlayerAlwaysOnTop: true,
  discordPresenceEnabled: false,
  discordClientId: '',
  discordArtEnabled: true,
  githubOwner: '',
  githubRepository: '',
  githubBranch: 'main',
  backgroundHotkeysEnabled: false,
  backgroundHotkeys: DEFAULT_BACKGROUND_HOTKEYS
};

const discordConnections = new Map();
let discordReconnectTimer = null;
let discordCurrentActivity = null;
let discordHandshakeComplete = false;
let discordUpdateVersion = 0;
let discordActivitySendTimer = null;
let discordArtworkUpdateTimer = null;
let discordStatus = { kind: 'disconnected', message: 'Discord is disconnected.' };
let discordLastPipeError = null;
const discordArtworkUrls = new Map();

function setDiscordStatus(kind, message) {
  discordStatus = { kind, message };
}

function getDiscordPresenceStatus() {
  const settings = readSettings();
  if (!settings.discordPresenceEnabled) return { kind: 'off', message: 'Rich Presence is off.' };
  if (process.platform !== 'win32') return { kind: 'error', message: 'Rich Presence is only supported by this Windows build.' };
  if (!/^\d{10,25}$/.test(settings.discordClientId || '')) return { kind: 'error', message: 'Add a valid Discord Application ID in Settings.' };
  if (discordStatus.kind === 'error' && !discordHandshakeComplete) return discordStatus;
  if (discordHandshakeComplete) {
    const count = [...discordConnections.values()].filter(connection => connection.handshakeComplete).length;
    return { kind: 'connected', message: discordCurrentActivity ? `Connected to ${count} Discord instance${count === 1 ? '' : 's'}; activity sent.` : `Connected to ${count} Discord instance${count === 1 ? '' : 's'}. Start playing a song to show it.` };
  }
  return discordStatus;
}

function getGithubToken() {
  try {
    if (!safeStorage.isEncryptionAvailable() || !fs.existsSync(discordSecretPath)) return '';
    return safeStorage.decryptString(fs.readFileSync(discordSecretPath));
  } catch (error) {
    console.error('Could not read the encrypted GitHub token:', error);
    return '';
  }
}

function discordWrite(opcode, value, pipe) {
  if (!pipe || pipe.destroyed) return;
  const payload = Buffer.from(JSON.stringify(value), 'utf8');
  const frame = Buffer.alloc(8 + payload.length);
  frame.writeUInt32LE(opcode, 0);
  frame.writeUInt32LE(payload.length, 4);
  payload.copy(frame, 8);
  pipe.write(frame);
}

function refreshDiscordHandshakeState() {
  discordHandshakeComplete = [...discordConnections.values()].some(connection => connection.handshakeComplete);
}

function disconnectDiscord() {
  clearTimeout(discordReconnectTimer);
  discordReconnectTimer = null;
  const connections = [...discordConnections.values()];
  discordConnections.clear();
  discordHandshakeComplete = false;
  connections.forEach(connection => connection.pipe.destroy());
}

function sendDiscordActivity() {
  if (!discordHandshakeComplete || !discordCurrentActivity) return;
  // Trailing debounce: replace the pending packet and wait until activity
  // updates have been quiet for four seconds before sending the latest state.
  clearTimeout(discordActivitySendTimer);
  discordActivitySendTimer = setTimeout(() => {
    discordActivitySendTimer = null;
    if (!discordHandshakeComplete || !discordCurrentActivity) return;
    for (const connection of discordConnections.values()) {
      if (!connection.handshakeComplete) continue;
      discordWrite(1, {
        cmd: 'SET_ACTIVITY',
        args: { pid: process.pid, activity: discordCurrentActivity },
        nonce: crypto.randomUUID()
      }, connection.pipe);
    }
  }, 4000);
  discordActivitySendTimer.unref?.();
}

function clearDiscordActivity() {
  clearTimeout(discordActivitySendTimer);
  clearTimeout(discordArtworkUpdateTimer);
  discordActivitySendTimer = null;
  discordArtworkUpdateTimer = null;
  discordCurrentActivity = null;
  if (discordHandshakeComplete) {
    for (const connection of discordConnections.values()) {
      if (connection.handshakeComplete) {
        discordWrite(1, { cmd: 'SET_ACTIVITY', args: { pid: process.pid, activity: null }, nonce: crypto.randomUUID() }, connection.pipe);
      }
    }
  }
}

function scheduleDiscordReconnect() {
  clearTimeout(discordReconnectTimer);
  const settings = readSettings();
  if (settings.discordPresenceEnabled && discordStatus.kind !== 'error') {
    setDiscordStatus('connecting', 'Discord is unavailable. Retrying the local connection…');
  }
  discordReconnectTimer = setTimeout(connectDiscord, 15000);
  discordReconnectTimer.unref?.();
}

function connectDiscord() {
  const settings = readSettings();
  if (!settings.discordPresenceEnabled) {
    setDiscordStatus('off', 'Rich Presence is off.');
    return;
  }
  if (process.platform !== 'win32') {
    setDiscordStatus('error', 'Rich Presence is only supported by this Windows build.');
    return;
  }
  if (!/^\d{10,25}$/.test(settings.discordClientId || '')) {
    setDiscordStatus('error', 'Add a valid Discord Application ID in Settings.');
    return;
  }
  if (!discordConnections.size) discordLastPipeError = null;
  setDiscordStatus('connecting', 'Connecting to the Discord desktop app…');
  let pipeIndex = 0;
  const connectNext = () => {
    while (discordConnections.has(pipeIndex)) pipeIndex += 1;
    if (!settings.discordPresenceEnabled || pipeIndex > MAX_DISCORD_IPC_PIPE_INDEX) {
      refreshDiscordHandshakeState();
      if (discordHandshakeComplete) {
        const count = [...discordConnections.values()].filter(connection => connection.handshakeComplete).length;
        setDiscordStatus('connected', `Connected to ${count} Discord instance${count === 1 ? '' : 's'}.`);
      } else if (settings.discordPresenceEnabled) {
        const detail = discordLastPipeError
          ? ` (${discordLastPipeError.code || 'pipe error'}: ${discordLastPipeError.message})`
          : '';
        setDiscordStatus('error', `Could not open Discord's local IPC pipe (checked 0–${MAX_DISCORD_IPC_PIPE_INDEX})${detail}.`);
      }
      return scheduleDiscordReconnect();
    }
    const candidateIndex = pipeIndex++;
    const candidate = net.createConnection(`\\\\?\\pipe\\discord-ipc-${candidateIndex}`);
    let connection = null;
    candidate.once('connect', () => {
      connection = { pipe: candidate, buffer: Buffer.alloc(0), handshakeComplete: false };
      discordConnections.set(candidateIndex, connection);
      setDiscordStatus('connecting', 'Connected to Discord; waiting for Rich Presence handshake…');
      const payload = Buffer.from(JSON.stringify({ v: 1, client_id: settings.discordClientId }), 'utf8');
      const frame = Buffer.alloc(8 + payload.length);
      frame.writeUInt32LE(0, 0);
      frame.writeUInt32LE(payload.length, 4);
      payload.copy(frame, 8);
      candidate.write(frame);
      connectNext();
    });
    candidate.on('data', chunk => {
      if (!connection) return;
      connection.buffer = Buffer.concat([connection.buffer, chunk]);
      while (connection.buffer.length >= 8) {
        const opcode = connection.buffer.readUInt32LE(0);
        const length = connection.buffer.readUInt32LE(4);
        if (connection.buffer.length < 8 + length) break;
        const body = connection.buffer.subarray(8, 8 + length).toString('utf8');
        connection.buffer = connection.buffer.subarray(8 + length);
        if (opcode === 1) {
          try {
            const message = JSON.parse(body);
            if (message.evt === 'READY') {
              connection.handshakeComplete = true;
              refreshDiscordHandshakeState();
              const count = [...discordConnections.values()].filter(item => item.handshakeComplete).length;
              setDiscordStatus('connected', `Connected to ${count} Discord instance${count === 1 ? '' : 's'}.`);
              sendDiscordActivity();
            } else if (message.evt === 'ERROR') {
              const detail = message.data?.message || message.data?.code || 'unknown RPC error';
              if (discordHandshakeComplete) console.warn('Discord instance rejected Rich Presence:', detail);
              else setDiscordStatus('error', `Discord rejected Rich Presence: ${detail}`);
            }
          } catch { /* Ignore malformed IPC events. */ }
        } else if (opcode === 3) {
          const pingFrame = Buffer.alloc(8 + length);
          pingFrame.writeUInt32LE(4, 0);
          pingFrame.writeUInt32LE(length, 4);
          Buffer.from(body).copy(pingFrame, 8);
          candidate.write(pingFrame);
        } else if (opcode === 2) {
          try {
            const message = JSON.parse(body);
            console.warn('Discord closed a Rich Presence connection:', message.message || 'no reason provided');
          } catch {
            console.warn('Discord closed a Rich Presence connection.');
          }
        }
      }
    });
    candidate.on('error', error => {
      if (!connection) {
        discordLastPipeError = error;
        connectNext();
      } else {
        console.warn(`Discord IPC pipe ${candidateIndex} failed:`, error);
      }
      candidate.destroy();
    });
    candidate.on('close', () => {
      if (!connection || discordConnections.get(candidateIndex) !== connection) return;
      discordConnections.delete(candidateIndex);
      refreshDiscordHandshakeState();
      if (settings.discordPresenceEnabled && !discordHandshakeComplete) setDiscordStatus('disconnected', 'Discord connection closed. Reconnecting…');
      scheduleDiscordReconnect();
    });
  };
  connectNext();
}

async function publishDiscordArtwork(imagePath, settings) {
  const token = getGithubToken();
  if (!token || !settings.githubOwner || !settings.githubRepository) return '';
  const normalizedPath = normalizeArtworkPath(imagePath);
  if (!normalizedPath) return '';
  const diskPath = path.join(userDataPath, normalizedPath);
  const image = nativeImage.createFromPath(diskPath);
  if (image.isEmpty()) return '';
  const { width, height } = image.getSize();
  const side = Math.min(width, height);
  const square = image.crop({ x: Math.floor((width - side) / 2), y: Math.floor((height - side) / 2), width: side, height: side }).resize({ width: 512, height: 512 });
  const pngBytes = square.toPNG();
  const digest = crypto.createHash('sha256').update(pngBytes).digest('hex');
  const cacheKey = `${settings.githubOwner}/${settings.githubRepository}/${settings.githubBranch || 'main'}/${digest}`;
  if (discordArtworkUrls.has(cacheKey)) return discordArtworkUrls.get(cacheKey);
  const owner = encodeURIComponent(settings.githubOwner.trim());
  const repository = encodeURIComponent(settings.githubRepository.trim());
  const filename = `covers/${digest}.png`;
  const publishedUrl = `https://raw.githubusercontent.com/${settings.githubOwner.trim()}/${settings.githubRepository.trim()}/${settings.githubBranch || 'main'}/${filename}`;
  const existingImage = await fetch(publishedUrl, { method: 'HEAD', signal: AbortSignal.timeout(12000) }).catch(() => null);
  if (existingImage?.ok) {
    discordArtworkUrls.set(cacheKey, publishedUrl);
    return publishedUrl;
  }
  const apiUrl = `https://api.github.com/repos/${owner}/${repository}/contents/${filename}`;
  const response = await fetch(apiUrl, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
      'User-Agent': `FancyOfflinePlayer/${app.getVersion()}`
    },
    body: JSON.stringify({ message: 'Add song cover for Discord presence', content: pngBytes.toString('base64'), branch: settings.githubBranch || 'main' })
  });
  if (!response.ok && response.status !== 422) {
    const detail = await response.text().catch(() => '');
    throw new Error(`GitHub upload failed (${response.status}): ${detail.slice(0, 180)}`);
  }
  const verifiedImage = await fetch(publishedUrl, { method: 'HEAD', signal: AbortSignal.timeout(12000) }).catch(() => null);
  if (!verifiedImage?.ok) throw new Error(`GitHub accepted the cover upload, but the public image URL is unavailable (${verifiedImage?.status || 'network error'}).`);
  discordArtworkUrls.set(cacheKey, publishedUrl);
  return publishedUrl;
}

let discordArtworkQueueRunning = false;
const discordArtworkQueue = new Set();

function enqueueDiscordArtworkSync(trackPaths) {
  const settings = readSettings();
  if (!settings.discordPresenceEnabled || settings.discordArtEnabled === false ||
      !settings.githubOwner || !settings.githubRepository || !getGithubToken()) return;
  const paths = Array.isArray(trackPaths) ? trackPaths : readLibrary().map(track => track.path);
  paths.filter(Boolean).forEach(trackPath => discordArtworkQueue.add(trackPath));
  if (discordArtworkQueueRunning || !discordArtworkQueue.size) return;
  discordArtworkQueueRunning = true;
  void (async () => {
    try {
      while (discordArtworkQueue.size) {
        const trackPath = discordArtworkQueue.values().next().value;
        discordArtworkQueue.delete(trackPath);
        const uploadSettings = readSettings();
        if (!uploadSettings.discordPresenceEnabled || uploadSettings.discordArtEnabled === false ||
            !uploadSettings.githubOwner || !uploadSettings.githubRepository || !getGithubToken()) break;
        const library = readLibrary();
        const track = library.find(item => item.path === trackPath);
        if (!track?.imagePath) continue;
        const imagePath = track.imagePath;
        const target = `${uploadSettings.githubOwner}/${uploadSettings.githubRepository}/${uploadSettings.githubBranch || 'main'}`;
        try {
          const imageUrl = await publishDiscordArtwork(imagePath, uploadSettings);
          if (!imageUrl) continue;
          const latestLibrary = readLibrary();
          const latestTrack = latestLibrary.find(item => item.path === trackPath);
          if (!latestTrack || latestTrack.imagePath !== imagePath) continue;
          latestTrack.discordArtworkUrl = imageUrl;
          latestTrack.discordArtworkTarget = target;
          writeLibrary(latestLibrary);
        } catch (error) {
          console.error(`Could not sync cover art for ${track.name || trackPath}:`, error);
        }
      }
    } finally {
      discordArtworkQueueRunning = false;
      if (discordArtworkQueue.size) enqueueDiscordArtworkSync([...discordArtworkQueue]);
    }
  })();
}

function readSettings() {
  if (fs.existsSync(settingsPath)) {
    try {
      const saved = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      return {
        ...DEFAULT_SETTINGS,
        ...saved,
        eq: { ...DEFAULT_SETTINGS.eq, ...(saved.eq || {}) },
        lastSession: { ...DEFAULT_SETTINGS.lastSession, ...(saved.lastSession || {}) },
        backgroundHotkeys: { ...DEFAULT_BACKGROUND_HOTKEYS, ...(saved.backgroundHotkeys || {}) }
      };
    } catch (err) {
      console.error('Failed to parse settings.json, falling back to defaults:', err);
      return {
        ...DEFAULT_SETTINGS,
        eq: { ...DEFAULT_SETTINGS.eq },
        lastSession: { ...DEFAULT_SETTINGS.lastSession },
        backgroundHotkeys: { ...DEFAULT_BACKGROUND_HOTKEYS }
      };
    }
  }
  return { ...DEFAULT_SETTINGS };
}

function validateBackgroundHotkeys(hotkeys) {
  const keyPattern = /^(?:[A-Z]|[0-9]|F(?:[1-9]|1[0-9]|2[0-4])|Space|Left|Right|Up|Down|Return|Escape|Tab|Backspace|Delete|Insert|Home|End|PageUp|PageDown)$/i;
  const modifierPattern = /^(?:CommandOrControl|Control|Alt|Shift|Super)$/i;
  const normalized = {};
  const used = new Set(['control+alt+f2']);

  for (const name of Object.keys(DEFAULT_BACKGROUND_HOTKEYS)) {
    const accelerator = hotkeys?.[name];
    if (typeof accelerator !== 'string') return { success: false, error: `Missing shortcut for ${name}.` };
    const parts = accelerator.split('+');
    const key = parts.pop();
    const modifiers = parts.map(part => part.trim());
    if (!keyPattern.test(key) || !modifiers.length || modifiers.length > 4 ||
        modifiers.some(modifier => !modifierPattern.test(modifier)) ||
        new Set(modifiers.map(modifier => modifier.toLowerCase())).size !== modifiers.length) {
      return { success: false, error: `Invalid shortcut for ${name}. Use a modifier and one supported key.` };
    }
    const normalizedKey = `${modifiers.map(value => value.toLowerCase()).sort().join('+')}+${key.toLowerCase()}`;
    if (used.has(normalizedKey)) return { success: false, error: 'Each background action needs a different shortcut. Ctrl+Alt+F2 is reserved for the toggle.' };
    used.add(normalizedKey);
    normalized[name] = `${modifiers.map(modifier => {
      const lower = modifier.toLowerCase();
      return lower === 'commandorcontrol' ? 'CommandOrControl' : lower[0].toUpperCase() + lower.slice(1);
    }).join('+')}+${key === 'Space' ? 'Space' : key.length === 1 ? key.toUpperCase() : key}`;
  }
  return { success: true, hotkeys: normalized };
}

function writeSettings(settings) {
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
}

const initialSettings = readSettings();
// Keep Chromium's normal throttling, media support, and security features.
app.commandLine.appendSwitch('disable-background-networking');
app.commandLine.appendSwitch('disable-component-update');
app.commandLine.appendSwitch('disable-default-apps');
app.commandLine.appendSwitch('disable-sync');

if (initialSettings.hardwareAcceleration === false) {
  // Only strip GPU/WebGL when the user has actually turned the Settings
  // toggle off - otherwise this permanently overrides their choice.
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch('disable-webgl');
  app.commandLine.appendSwitch('disable-webgl2');
  app.commandLine.appendSwitch('disable-gpu-compositing');
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'media',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true
    }
  },
  {
    scheme: 'artwork',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true
    }
  }
]);

ipcMain.handle('read-metadata', async (event, filePath) => {
  return new Promise((resolve, reject) => {
    jsmediatags.read(filePath, {
      onSuccess: (tag) => {
        const data = tag.tags;
        let imagePath = '';
        if (data.picture) {
          const { data: pictureData, format } = data.picture;
          imagePath = saveArtworkBytes(format, pictureData);
        }
        resolve({
          title: data.title,
          artist: data.artist,
          album: data.album,
          imagePath
        });
      },
      onError: (error) => reject(error)
    });
  });
});

function normalizeLyricsMatchText(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

ipcMain.handle('suggest-lyrics', async (_event, query = {}) => {
  const trackName = String(query.trackName || '').trim().slice(0, 200);
  if (trackName.length < 2) return [];

  const searchTerms = [trackName];
  const spacedTitle = trackName.replace(/([a-z])(\d)/gi, '$1 $2').replace(/(\d)([a-z])/gi, '$1 $2').trim();
  if (spacedTitle && spacedTitle.toLowerCase() !== trackName.toLowerCase()) searchTerms.push(spacedTitle);

  try {
    const collected = [];
    for (const term of searchTerms) {
      const url = new URL('https://lrclib.net/api/search');
      url.searchParams.set('track_name', term);
      const response = await fetch(url, {
        headers: { 'X-User-Agent': `Fancy Offline Music Player/${app.getVersion()}` },
        signal: AbortSignal.timeout(10000)
      });
      if (!response.ok) continue;
      const results = await response.json();
      if (Array.isArray(results)) collected.push(...results);
      const compactQuery = normalizeLyricsMatchText(trackName).replace(/\s/g, '');
      const hasCloseTitle = collected.some(result => {
        if (!result || typeof result !== 'object') return false;
        const compactTitle = normalizeLyricsMatchText(result.trackName || result.name).replace(/\s/g, '');
        return Boolean(compactTitle) && (compactTitle.includes(compactQuery) || compactQuery.includes(compactTitle));
      });
      if (hasCloseTitle) break;
    }

    const compactQuery = normalizeLyricsMatchText(trackName).replace(/\s/g, '');
    const suggestions = collected.filter(result => result && typeof result === 'object');
    const rankTitle = result => {
      const title = normalizeLyricsMatchText(result.trackName || result.name).replace(/\s/g, '');
      if (title === compactQuery) return 0;
      if (title.startsWith(compactQuery)) return 1;
      if (title.includes(compactQuery)) return 2;
      return 3;
    };
    suggestions.sort((left, right) => rankTitle(left) - rankTitle(right) ||
      Number(Boolean(right.syncedLyrics)) - Number(Boolean(left.syncedLyrics)));

    const seen = new Set();
    return suggestions
      .map(result => ({
        trackName: String(result.trackName || result.name || '').slice(0, 200),
        artistName: String(result.artistName || '').slice(0, 200),
        albumName: String(result.albumName || '').slice(0, 200),
        duration: Number.isFinite(Number(result.duration)) ? Number(result.duration) : 0,
        hasLyrics: Boolean(result.syncedLyrics || result.plainLyrics)
      }))
      .filter(result => {
        if (!result.trackName) return false;
        const key = [result.trackName, result.artistName, result.albumName].map(normalizeLyricsMatchText).join('|');
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 8);
  } catch (error) {
    console.error('Lyrics suggestions failed:', error);
    return { status: 'unavailable' };
  }
});

ipcMain.handle('find-lyrics', async (_event, query = {}) => {
  const trackName = String(query.trackName || '').trim().slice(0, 200);
  const artistName = String(query.artistName || '').trim().slice(0, 200);
  const albumName = String(query.albumName || '').trim().slice(0, 200);
  if (!trackName) return { status: 'not-found' };

  const url = new URL('https://lrclib.net/api/search');
  url.searchParams.set('track_name', trackName);
  if (artistName) url.searchParams.set('artist_name', artistName);
  if (albumName && albumName.toLowerCase() !== 'unknown album') {
    url.searchParams.set('album_name', albumName);
  }

  try {
    const response = await fetch(url, {
      headers: { 'X-User-Agent': `Fancy Offline Music Player/${app.getVersion()}` },
      signal: AbortSignal.timeout(10000)
    });
    if (!response.ok) return { status: 'unavailable' };

    const results = await response.json();
    if (!Array.isArray(results)) return { status: 'not-found' };

    const normalizedTrackName = normalizeLyricsMatchText(trackName);
    const normalizedArtistName = normalizeLyricsMatchText(artistName);
    const candidates = results.filter(result => {
      if (normalizeLyricsMatchText(result.trackName || result.name) !== normalizedTrackName) return false;
      if (!normalizedArtistName) return true;
      const candidateArtist = normalizeLyricsMatchText(result.artistName);
      return Boolean(candidateArtist) && (candidateArtist === normalizedArtistName ||
        candidateArtist.includes(normalizedArtistName) ||
        normalizedArtistName.includes(candidateArtist));
    });
    candidates.sort((left, right) => {
      const leftAlbumMatch = normalizeLyricsMatchText(left.albumName) === normalizeLyricsMatchText(albumName);
      const rightAlbumMatch = normalizeLyricsMatchText(right.albumName) === normalizeLyricsMatchText(albumName);
      return Number(Boolean(right.syncedLyrics)) - Number(Boolean(left.syncedLyrics)) ||
        Number(rightAlbumMatch) - Number(leftAlbumMatch);
    });

    const lyrics = candidates.find(result => result.syncedLyrics || result.plainLyrics);
    if (!lyrics) {
      return { status: results.some(result => result.instrumental) ? 'instrumental' : 'not-found' };
    }

    return {
      status: 'found',
      trackName: lyrics.trackName || lyrics.name || trackName,
      artistName: lyrics.artistName || artistName,
      plainLyrics: lyrics.plainLyrics || '',
      syncedLyrics: lyrics.syncedLyrics || ''
    };
  } catch (error) {
    console.error('Lyrics lookup failed:', error);
    return { status: 'unavailable' };
  }
});

const CONTENT_TYPES = {
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav'
};
const SUPPORTED_EXTENSIONS = /\.(mp3|wav)$/i;

function trackLyricsBaseName(trackPath) {
  return crypto.createHash('sha256').update(String(trackPath)).digest('hex');
}

function trackLyricsFilePath(trackPath, extension) {
  if (!trackPath || !['.lrc', '.txt'].includes(extension)) return '';
  return path.join(lyricsDir, `${trackLyricsBaseName(trackPath)}${extension}`);
}

function removeTrackLyricsFiles(track) {
  if (!track?.path) return;
  for (const extension of ['.lrc', '.txt']) {
    const filePath = trackLyricsFilePath(track.path, extension);
    try { if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch (error) {
      console.error('Could not remove old lyric file:', error);
    }
  }
}

function writeTrackLyricsFiles(track, source, plainLyrics, syncedLyrics) {
  if (!track?.path || (!plainLyrics && !syncedLyrics)) return null;
  const extension = syncedLyrics ? '.lrc' : '.txt';
  const filePath = trackLyricsFilePath(track.path, extension);
  const contents = syncedLyrics || plainLyrics;
  try {
    fs.writeFileSync(filePath, contents, 'utf8');
    const otherExtension = extension === '.lrc' ? '.txt' : '.lrc';
    const otherFile = trackLyricsFilePath(track.path, otherExtension);
    if (otherFile && fs.existsSync(otherFile)) fs.unlinkSync(otherFile);
    return { source, file: path.basename(filePath), extension };
  } catch (error) {
    console.error('Could not save lyrics file:', error);
    return null;
  }
}

function readTrackLyricsFiles(track) {
  if (!track?.path || !track.lyrics || !['local', 'cached'].includes(track.lyrics.source)) return null;
  const extension = track.lyrics.file?.endsWith('.lrc') ? '.lrc' : track.lyrics.file?.endsWith('.txt') ? '.txt' : '';
  if (!extension || track.lyrics.file !== `${trackLyricsBaseName(track.path)}${extension}`) return null;
  const filePath = trackLyricsFilePath(track.path, extension);
  try {
    const contents = fs.readFileSync(filePath, 'utf8');
    if (extension === '.lrc') {
      return {
        source: track.lyrics.source,
        syncedLyrics: contents,
        plainLyrics: contents.replace(/\[\d{1,2}:\d{2}(?:[.:]\d{1,3})?\]/g, '').trim(),
        searchTitle: track.lyricsSearchTitle || ''
      };
    }
    return { source: track.lyrics.source, syncedLyrics: '', plainLyrics: contents, searchTitle: track.lyricsSearchTitle || '' };
  } catch (error) {
    if (error.code !== 'ENOENT') console.error('Could not read lyrics file:', error);
    return null;
  }
}

function normalizeTrackLyricsStorage(track) {
  const lyrics = track?.lyrics;
  if (!track?.path || !lyrics || typeof lyrics !== 'object') return false;
  if (lyrics.file && !lyrics.syncedLyrics && !lyrics.plainLyrics) return false;
  const plainLyrics = typeof lyrics.plainLyrics === 'string' ? lyrics.plainLyrics.slice(0, 500000) : '';
  const syncedLyrics = typeof lyrics.syncedLyrics === 'string' ? lyrics.syncedLyrics.slice(0, 500000) : '';
  if (!plainLyrics && !syncedLyrics) return false;
  const source = lyrics.source === 'cached' ? 'cached' : 'local';
  const stored = writeTrackLyricsFiles(track, source, plainLyrics, syncedLyrics);
  if (!stored) return false;
  track.lyrics = { source: stored.source, file: stored.file };
  return true;
}

function readLibrary() {
  if (fs.existsSync(dbPath)) {
    const library = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
    let changed = false;
    library.forEach(track => {
      if (normalizeTrackArtwork(track)) changed = true;
      if (normalizeTrackLyricsStorage(track)) changed = true;
    });
    if (changed) writeLibrary(library);
    return library;
  }
  return [];
}

function writeLibrary(playlist) {
  playlist.forEach(track => {
    normalizeTrackArtwork(track);
    normalizeTrackLyricsStorage(track);
  });
  fs.writeFileSync(dbPath, JSON.stringify(playlist, null, 2));
}

function readPlaylists() {
  if (fs.existsSync(playlistsDbPath)) {
    const playlists = JSON.parse(fs.readFileSync(playlistsDbPath, 'utf8'));
    let changed = false;
    playlists.forEach(playlist => {
      if (normalizePlaylistArtwork(playlist)) changed = true;
    });
    if (changed) writePlaylists(playlists);
    return playlists;
  }
  return [];
}

function writePlaylists(playlists) {
  playlists.forEach(normalizePlaylistArtwork);
  fs.writeFileSync(playlistsDbPath, JSON.stringify(playlists, null, 2));
}

function makePlaylistId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function stripExt(name) {
  return name.replace(/\.[^/.]+$/, '');
}

function notifyLibraryUpdated() {
  if (mainWindowRef && !mainWindowRef.isDestroyed()) {
    mainWindowRef.webContents.send('library-updated');
  }
}

//Auto Import Watch Folder
let watcher = null;

function readWatchedMetadata(fullPath) {
  return new Promise((resolve) => {
    jsmediatags.read(fullPath, {
      onSuccess: ({ tags = {} }) => {
        const picture = tags.picture;
        const imagePath = picture ? saveArtworkBytes(picture.format, picture.data) : '';
        resolve({
          data: {
            title: tags.title || '',
            artist: tags.artist || '',
            album: tags.album || ''
          },
          imagePath
        });
      },
      onError: () => resolve(null)
    });
  });
}

async function addWatchedFile(fullPath, filename) {
  if (!SUPPORTED_EXTENSIONS.test(filename)) return;
  if (readLibrary().some(t => path.resolve(t.path || '') === path.resolve(fullPath))) return;
  const metadata = path.extname(filename).toLowerCase() === '.mp3'
    ? await readWatchedMetadata(fullPath)
    : null;
  const library = readLibrary();
  if (library.some(t => path.resolve(t.path || '') === path.resolve(fullPath))) return;
  const data = metadata && metadata.data;
  const trackData = {
    title: data && data.title || stripExt(filename),
    artist: data && data.artist || '',
    album: data && data.album || ''
  };
  const track = {
    path: fullPath,
    name: filename,
    source: 'local',
    data: trackData
  };
  if (metadata && metadata.imagePath) track.imagePath = metadata.imagePath;
  library.push({
    ...track
  });
  writeLibrary(library);
  enqueueDiscordArtworkSync([fullPath]);
  notifyLibraryUpdated();
}

function scanWatchFolder(folderPath) {
  fs.readdir(folderPath, (err, files) => {
    if (err) {
      console.error('Failed to scan watch folder:', err);
      return;
    }
    files.filter(f => SUPPORTED_EXTENSIONS.test(f)).forEach(f => addWatchedFile(path.join(folderPath, f), f));
  });
}

function startWatcher(folderPath) {
  if (watcher) {
    try { watcher.close(); } catch (err) {  }
    watcher = null;
  }
  if (!folderPath) return;

  scanWatchFolder(folderPath);

  try {
    watcher = fs.watch(folderPath, { persistent: true }, (eventType, filename) => {
      if (!filename || !SUPPORTED_EXTENSIONS.test(filename)) return;
      const fullPath = path.join(folderPath, filename);
      setTimeout(() => {
        fs.access(fullPath, fs.constants.R_OK, (err) => {
          if (err) return; 
          addWatchedFile(fullPath, filename);
        });
      }, 500);
    });
  } catch (err) {
    console.error('Failed to watch folder:', folderPath, err);
  }
}

function setMiniPlayerMode(win, enabled, restoreWindowSize = false) {
  if (!win || win.isDestroyed()) return false;
  const nextMode = Boolean(enabled);
  if (nextMode === miniPlayerMode) return miniPlayerMode;

  if (nextMode) {
    const bounds = win.getBounds();
    miniPlayerRestoreBounds = {
      ...bounds,
      width: Math.max(bounds.width, MINI_PLAYER_TRIGGER_WIDTH + 1),
      height: Math.max(bounds.height, MINI_PLAYER_TRIGGER_HEIGHT + 1)
    };
    miniPlayerMode = true;
    miniPlayerAlwaysOnTop = readSettings().miniPlayerAlwaysOnTop !== false;
    win.setMinimumSize(64, 64);
    win.setAspectRatio(1);
    const squareSize = Math.max(64, Math.min(bounds.width, bounds.height));
    if (bounds.width !== squareSize || bounds.height !== squareSize) {
      win.setSize(squareSize, squareSize, true);
    }
    win.setAlwaysOnTop(miniPlayerAlwaysOnTop, 'floating');
    win.webContents.executeJavaScript("document.body.classList.add('mini-player-mode')").catch(() => {});
  } else {
    miniPlayerMode = false;
    win.setAlwaysOnTop(false);
    win.setAspectRatio(0);
    win.setMinimumSize(0, 0);
    win.webContents.executeJavaScript("document.body.classList.remove('mini-player-mode')").catch(() => {});
    const previousBounds = restoreWindowSize ? miniPlayerRestoreBounds : null;
    miniPlayerRestoreBounds = null;
    if (previousBounds) win.setBounds(previousBounds, true);
  }
  return miniPlayerMode;
}

function createWindow() {
  const settings = readSettings();
  const win = new BrowserWindow({
    width: 1280,
    height: 720,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
      spellcheck: false,
      devTools: !app.isPackaged, 
      textAreasAreResizable: false,
      enableWebSQL: false,
      offscreen: false,
      autoplayPolicy: 'no-user-gesture-required',
      disableHtmlFullscreenWindowResize: true,
    },
    titleBarStyle: process.platform === 'darwin' ? 'default' : 'hidden',
    ...(process.platform !== 'darwin' ? {
      titleBarOverlay: {
        color: '#00000000',
        symbolColor: '#ffffff',
        height: 32,
      },
    } : {}),
    autoHideMenuBar: true,
    fullscreenable: true,
  });

  mainWindowRef = win;
  miniPlayerMode = false;
  miniPlayerRestoreBounds = null;
  miniPlayerAlwaysOnTop = settings.miniPlayerAlwaysOnTop !== false;
  autoMiniPlayerEnabled = settings.autoMiniPlayer !== false;
  win.on('minimize', () => {
    if (miniPlayerMode) win.setAlwaysOnTop(false);
  });
  win.on('restore', () => {
    if (miniPlayerMode) win.setAlwaysOnTop(miniPlayerAlwaysOnTop, 'floating');
  });
  win.on('enter-full-screen', () => {
    win.webContents.send('fullscreen-player-state', true);
  });
  win.on('leave-full-screen', () => {
    win.webContents.send('fullscreen-player-state', false);
  });
  win.on('resize', () => {
    if (win.isDestroyed()) return;
    const { width, height } = win.getBounds();
    if (!miniPlayerMode && autoMiniPlayerEnabled &&
        (width <= MINI_PLAYER_TRIGGER_WIDTH || height <= MINI_PLAYER_TRIGGER_HEIGHT)) {
      setMiniPlayerMode(win, true);
    } else if (miniPlayerMode && width > MINI_PLAYER_TRIGGER_WIDTH && height > MINI_PLAYER_TRIGGER_HEIGHT) {
      setMiniPlayerMode(win, false);
    }
  });
  if (process.platform !== 'darwin') {
    win.webContents.on('dom-ready', () => {
      const classes = ['window-controls-overlay'];
      if (miniPlayerMode) classes.push('mini-player-mode');
      win.webContents.executeJavaScript(`document.body.classList.add(${classes.map(value => JSON.stringify(value)).join(',')})`);
    });
  } else {
    win.webContents.on('dom-ready', () => {
      if (miniPlayerMode) win.webContents.executeJavaScript("document.body.classList.add('mini-player-mode')");
    });
  }
  win.on('closed', () => {
    if (mainWindowRef === win) mainWindowRef = null;
  });

  Menu.setApplicationMenu(null);

  const startPage = settings.startupPage === 'playlists' ? 'playlists' : 'home';
  win.loadFile(path.join(__dirname, 'html', `${startPage}.html`));

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http:') || url.startsWith('https:')) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  win.webContents.on('will-navigate', (event, url) => {
    if (url !== win.webContents.getURL() && (url.startsWith('http:') || url.startsWith('https:'))) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  return win;
}

function getBackgroundHotkeyStatus() {
  const settings = readSettings();
  const shortcuts = {};
  for (const [name, action] of Object.entries(BACKGROUND_HOTKEY_ACTIONS)) {
    const accelerator = settings.backgroundHotkeys[name];
    shortcuts[name] = {
      accelerator,
      registered: registeredBackgroundPlayerHotkeys.has(accelerator)
    };
  }
  return {
    enabled: backgroundHotkeysEnabled,
    toggleShortcut: 'Control+Alt+F2',
    toggleRegistered: backgroundToggleShortcutRegistered,
    shortcuts
  };
}

function sendBackgroundHotkeyStatus() {
  if (mainWindowRef && !mainWindowRef.isDestroyed()) {
    mainWindowRef.webContents.send('background-hotkey-status', getBackgroundHotkeyStatus());
  }
}

function ensureBackgroundHotkeyToggleRegistered() {
  const accelerator = 'Control+Alt+F2';
  if (globalShortcut.isRegistered(accelerator)) {
    backgroundToggleShortcutRegistered = true;
    return true;
  }
  try {
    backgroundToggleShortcutRegistered = globalShortcut.register(accelerator, () => {
      const now = Date.now();
      if (now - lastBackgroundHotkeyToggleAt < 400) return;
      lastBackgroundHotkeyToggleAt = now;
      setBackgroundHotkeysEnabled(!backgroundHotkeysEnabled);
    });
  } catch (error) {
    backgroundToggleShortcutRegistered = false;
    console.error(`Could not register the background hotkey toggle (${accelerator}):`, error);
  }
  if (!backgroundToggleShortcutRegistered) {
    console.error(`Could not register the background hotkey toggle (${accelerator}); another application may be using it.`);
  }
  return backgroundToggleShortcutRegistered;
}

function unregisterBackgroundPlayerHotkeys() {
  for (const accelerator of registeredBackgroundPlayerHotkeys) {
    globalShortcut.unregister(accelerator);
  }
  registeredBackgroundPlayerHotkeys.clear();
}

function registerBackgroundPlayerHotkeys() {
  const settings = readSettings();
  const seen = new Set();
  const reserved = new Set(['Control+Alt+F2']);
  const unavailable = [];

  for (const [name, action] of Object.entries(BACKGROUND_HOTKEY_ACTIONS)) {
    const accelerator = settings.backgroundHotkeys[name];
    if (!accelerator || reserved.has(accelerator) || seen.has(accelerator)) {
      unavailable.push(name);
      continue;
    }
    seen.add(accelerator);
    try {
      const registered = globalShortcut.register(accelerator, () => {
        if (!mainWindowRef || mainWindowRef.isDestroyed()) return;
        mainWindowRef.webContents.send('global-player-hotkey', action);
        if (action === 'toggle-fullscreen') {
          if (mainWindowRef.isMinimized()) mainWindowRef.restore();
          mainWindowRef.show();
          mainWindowRef.focus();
        }
      });
      if (registered) registeredBackgroundPlayerHotkeys.add(accelerator);
      else unavailable.push(name);
    } catch (error) {
      console.error(`Could not register background hotkey for ${name}:`, error);
      unavailable.push(name);
    }
  }
  return unavailable;
}

function setBackgroundHotkeysEnabled(enabled, persist = true) {
  backgroundHotkeysEnabled = Boolean(enabled);
  if (persist) {
    writeSettings({ ...readSettings(), backgroundHotkeysEnabled });
  }

  ensureBackgroundHotkeyToggleRegistered();
  unregisterBackgroundPlayerHotkeys();
  let unavailable = [];
  if (backgroundHotkeysEnabled) unavailable = registerBackgroundPlayerHotkeys();
  sendBackgroundHotkeyStatus();
  return { ...getBackgroundHotkeyStatus(), unavailable };
}

ipcMain.handle('set-mini-player-mode', (event, enabled) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || win.isDestroyed()) return false;
  return setMiniPlayerMode(win, Boolean(enabled), !enabled);
});

ipcMain.handle('set-fullscreen-player', (event, enabled) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || win.isDestroyed()) return false;
  win.setFullScreen(Boolean(enabled));
  return true;
});

app.whenReady().then(() => {
  connectDiscord();
  setBackgroundHotkeysEnabled(initialSettings.backgroundHotkeysEnabled === true, false);
  app.setLoginItemSettings({ openAtLogin: false });
  app.setUserTasks([]);

  protocol.handle('artwork', async (request) => {
    const imagePath = new URL(request.url).searchParams.get('path');
    const normalizedPath = normalizeArtworkPath(imagePath);
    if (!normalizedPath) return new Response('Not found', { status: 404 });

    try {
      const filePath = path.join(userDataPath, normalizedPath);
      const mimeType = Object.entries(IMAGE_TYPES).find(([, ext]) => ext === path.extname(filePath).toLowerCase())?.[0];
      if (!mimeType) return new Response('Unsupported image type', { status: 415 });
      const imageBytes = await fs.promises.readFile(filePath);
      return new Response(imageBytes, {
        headers: {
          'Content-Type': mimeType,
          'Cache-Control': 'private, max-age=31536000, immutable'
        }
      });
    } catch (err) {
      return new Response('Not found', { status: 404 });
    }
  });

  ipcMain.handle('get-app-page', async (_event, page) => {
    if (!['settings', 'credits'].includes(page)) return '';
    return fs.promises.readFile(path.join(__dirname, 'html', `${page}.html`), 'utf8');
  });

  // ── TRUE STREAMING PROTOCOL (no memory buffering) ──
  protocol.handle('media', async (request) => {
    let filePath;
    try {
      filePath = new URL(request.url).searchParams.get('path');
    } catch {
      return new Response('Bad URL', { status: 400 });
    }
    if (!filePath) return new Response('Missing path', { status: 400 });

    try {
      await fs.promises.access(filePath, fs.constants.R_OK);
      const stat = await fs.promises.stat(filePath);
      const range = request.headers.get('Range');

      let start = 0, end = stat.size - 1, status = 200;
      if (range) {
        const [s, e] = range.replace(/bytes=/, '').split('-');
        start = parseInt(s, 10);
        end = e ? parseInt(e, 10) : stat.size - 1;
        status = 206;
      }

      const nodeStream = fs.createReadStream(filePath, { start, end });

      nodeStream.on('error', (err) => {
        console.error('Media stream read error:', err);
      });
      const webStream = Readable.toWeb(nodeStream);

const headers = {
  'Content-Type': CONTENT_TYPES[path.extname(filePath).toLowerCase()] || 'audio/mpeg',
  'Accept-Ranges': 'bytes',
  'Content-Length': String((end - start) + 1),
  'Access-Control-Allow-Origin': '*', // required so createMediaElementSource() doesn't taint/mute the output
};
      if (status === 206) {
        headers['Content-Range'] = `bytes ${start}-${end}/${stat.size}`;
      }

      return new Response(webStream, { status, headers });
    } catch (err) {
      console.error('Media error:', err);
      return new Response('Not found', { status: 404 });
    }
  });

  // lib ipc 
  ipcMain.handle('get-playlist', () => readLibrary());

  ipcMain.handle('reorder-tracks', (_event, paths) => {
    if (!Array.isArray(paths)) return { success: false, error: 'Invalid track order.' };
    const library = readLibrary();
    const byPath = new Map(library.map(track => [track.path, track]));
    if (paths.length !== library.length || new Set(paths).size !== paths.length || paths.some(trackPath => !byPath.has(trackPath))) {
      return { success: false, error: 'Track order no longer matches the library.' };
    }
    writeLibrary(paths.map(trackPath => byPath.get(trackPath)));
    return { success: true };
  });

  ipcMain.handle('reorder-playlist-tracks', (_event, { playlistId, paths } = {}) => {
    if (!playlistId || !Array.isArray(paths)) return { success: false, error: 'Invalid playlist order.' };
    const savedPlaylists = readPlaylists();
    const playlist = savedPlaylists.find(item => item.id === playlistId);
    if (!playlist) return { success: false, error: 'Playlist not found.' };
    const byPath = new Map(playlist.tracks.map(track => [track.path, track]));
    if (paths.length !== playlist.tracks.length || new Set(paths).size !== paths.length || paths.some(trackPath => !byPath.has(trackPath))) {
      return { success: false, error: 'Playlist order no longer matches its songs.' };
    }
    playlist.tracks = paths.map(trackPath => byPath.get(trackPath));
    writePlaylists(savedPlaylists);
    return { success: true };
  });

  ipcMain.handle('get-track-lyrics', (_event, trackPath) => {
    if (!trackPath) return null;
    const track = readLibrary().find(item => item.path === trackPath);
    if (!track?.lyrics || !['local', 'cached'].includes(track.lyrics.source)) return null;
    if (track.lyrics.syncedLyrics || track.lyrics.plainLyrics) {
      return { ...track.lyrics, searchTitle: track.lyricsSearchTitle || '' };
    }
    return readTrackLyricsFiles(track);
  });

  ipcMain.handle('save-track-lyrics', (_event, trackPath, lyrics = {}) => {
    if (!trackPath || !lyrics || typeof lyrics !== 'object') {
      return { success: false, error: 'missing track or lyrics' };
    }
    const library = readLibrary();
    const track = library.find(item => item.path === trackPath);
    if (!track) return { success: false, error: 'track not found in library' };
    const plainLyrics = typeof lyrics.plainLyrics === 'string' ? lyrics.plainLyrics.slice(0, 500000) : '';
    const syncedLyrics = typeof lyrics.syncedLyrics === 'string' ? lyrics.syncedLyrics.slice(0, 500000) : '';
    const searchTitle = typeof lyrics.searchTitle === 'string' ? lyrics.searchTitle.trim().slice(0, 200) : '';
    const source = lyrics.source === 'cached' ? 'cached' : 'local';
    if (!plainLyrics && !syncedLyrics && !searchTitle) return { success: false, error: 'lyrics file is empty' };
    const previousSearchTitle = track.lyricsSearchTitle || track.data?.title || path.basename(track.path, path.extname(track.path));
    const searchTitleChanged = searchTitle && normalizeLyricsMatchText(searchTitle) !== normalizeLyricsMatchText(previousSearchTitle);
    if (searchTitle) track.lyricsSearchTitle = searchTitle;
    let lyricsCleared = false;
    if (source === 'cached' && searchTitleChanged && !plainLyrics && !syncedLyrics && track.lyrics?.source === 'cached') {
      track.lyrics = null;
      lyricsCleared = true;
    }
    if (plainLyrics || syncedLyrics) {
      if (source === 'local' || track.lyrics?.source !== 'local') {
        const storedLyrics = writeTrackLyricsFiles(track, source, plainLyrics, syncedLyrics);
        if (!storedLyrics) return { success: false, error: 'Could not save lyrics to the lyrics folder' };
        track.lyrics = { source: storedLyrics.source, file: storedLyrics.file };
      }
    } else if (lyricsCleared) {
      removeTrackLyricsFiles(track);
    }
    writeLibrary(library);
    return { success: true, lyricsCleared };
  });

  ipcMain.handle('record-track-play', (_event, trackPath) => {
    if (!trackPath) return { success: false, playCount: 0 };
    const library = readLibrary();
    const track = library.find(item => item.path === trackPath);
    if (!track) return { success: false, playCount: 0 };
    track.playCount = Math.max(0, Number(track.playCount) || 0) + 1;
    writeLibrary(library);
    return { success: true, playCount: track.playCount };
  });

  ipcMain.handle('save-track', (event, trackData) => {
    if (!trackData || !trackData.path) {
      return { success: false, error: 'missing file path' };
    }
    const playlist = readLibrary();
    let track = playlist.find(t => t.path === trackData.path);
    if (!track) {
      track = {
        path: trackData.path,
        name: trackData.name || '',
        source: trackData.source || 'local',
        data: trackData.data || {},
        imagePath: saveArtwork(trackData.imagePath || trackData.imageUrl)
      };
      playlist.push(track);
    } else if (trackData.imageUrl || trackData.imagePath) {
      track.imagePath = saveArtwork(trackData.imagePath || trackData.imageUrl);
    }
    delete track.discordArtworkUrl;
    delete track.discordArtworkTarget;
    writeLibrary(playlist);
    enqueueDiscordArtworkSync([track.path]);
    return { success: true, imagePath: track.imagePath || '' };
  });

  ipcMain.handle('remove-track', (event, trackPath) => {
    if (!trackPath) return { success: false, error: 'missing file path' };
    const playlist = readLibrary();
    const filtered = playlist.filter(t => t.path !== trackPath);
    if (filtered.length !== playlist.length) writeLibrary(filtered);
    return { success: true };
  });

  ipcMain.handle('update-track', (event, { path: trackPath, changes } = {}) => {
    if (!trackPath || !changes) {
      return { success: false, error: 'missing path or changes' };
    }
    const playlist = readLibrary();
    const track = playlist.find(t => t.path === trackPath);
    if (!track) return { success: false, error: 'track not found' };
    let coverChanged = false;
    if (typeof changes.imageUrl === 'string' || typeof changes.imagePath === 'string') {
      track.imagePath = saveArtwork(changes.imagePath || changes.imageUrl);
      delete track.discordArtworkUrl;
      delete track.discordArtworkTarget;
      coverChanged = true;
    }
    if (typeof changes.source !== 'undefined') track.source = changes.source;
    if (typeof changes.album === 'string') {
      track.data = track.data || {};
      track.data.album = changes.album;
    }
    if (typeof changes.artist === 'string') {
      track.data = track.data || {};
      track.data.artist = changes.artist;
    }
    writeLibrary(playlist);
    if (typeof changes.artist === 'string') {
      const savedPlaylists = readPlaylists();
      let playlistsChanged = false;
      savedPlaylists.forEach(savedPlaylist => (savedPlaylist.tracks || []).forEach(savedTrack => {
        if (savedTrack.path !== trackPath) return;
        savedTrack.data = savedTrack.data || {};
        savedTrack.data.artist = changes.artist;
        playlistsChanged = true;
      }));
      if (playlistsChanged) writePlaylists(savedPlaylists);
    }
    if (coverChanged) enqueueDiscordArtworkSync([track.path]);
    return { success: true, imagePath: track.imagePath || '' };
  });

  // playlist ipc
  ipcMain.handle('get-playlists', () => readPlaylists());

  ipcMain.handle('create-playlist', (event, name) => {
    const playlists = readPlaylists();
    const newPlaylist = {
      id: makePlaylistId(),
      name: (name || '').trim() || 'Untitled Playlist',
      coverImagePath: null,
      tracks: [],
      createdAt: Date.now()
    };
    playlists.push(newPlaylist);
    writePlaylists(playlists);
    return newPlaylist;
  });

  ipcMain.handle('delete-playlist', (event, playlistId) => {
    if (!playlistId) return { success: false, error: 'missing playlist id' };
    const playlists = readPlaylists();
    const filtered = playlists.filter(p => p.id !== playlistId);
    if (filtered.length !== playlists.length) writePlaylists(filtered);
    return { success: true };
  });

  ipcMain.handle('rename-playlist', (event, { playlistId, name } = {}) => {
    if (!playlistId || !name) {
      return { success: false, error: 'missing playlist id or name' };
    }
    const playlists = readPlaylists();
    const playlist = playlists.find(p => p.id === playlistId);
    if (!playlist) return { success: false, error: 'playlist not found' };
    playlist.name = name.trim() || playlist.name;
    writePlaylists(playlists);
    return { success: true };
  });

  ipcMain.handle('set-playlist-cover', (event, { playlistId, coverImage } = {}) => {
    if (!playlistId) return { success: false, error: 'missing playlist id' };
    const playlists = readPlaylists();
    const playlist = playlists.find(p => p.id === playlistId);
    if (!playlist) return { success: false, error: 'playlist not found' };
    playlist.coverImagePath = saveArtwork(coverImage) || null;
    delete playlist.coverImage;
    writePlaylists(playlists);
    return { success: true, imagePath: playlist.coverImagePath };
  });

  ipcMain.handle('add-track-to-playlist', (event, { playlistId, track } = {}) => {
    if (!playlistId || !track || !track.path) {
      return { success: false, error: 'missing playlist id or track' };
    }
    const playlists = readPlaylists();
    const playlist = playlists.find(p => p.id === playlistId);
    if (!playlist) return { success: false, error: 'playlist not found' };
    if (playlist.tracks.find(t => t.path === track.path)) {
      return { success: true, alreadyExists: true };
    }
    playlist.tracks.push({
      path: track.path,
      name: track.name,
      data: track.data || {},
      imagePath: saveArtwork(track.imagePath || track.imageUrl)
    });
    writePlaylists(playlists);
    return { success: true, imagePath: playlist.tracks[playlist.tracks.length - 1].imagePath };
  });

  ipcMain.handle('remove-track-from-playlist', (event, { playlistId, trackPath } = {}) => {
    if (!playlistId || !trackPath) {
      return { success: false, error: 'missing playlist id or track path' };
    }
    const playlists = readPlaylists();
    const playlist = playlists.find(p => p.id === playlistId);
    if (!playlist) return { success: false, error: 'playlist not found' };
    const before = playlist.tracks.length;
    playlist.tracks = playlist.tracks.filter(t => t.path !== trackPath);
    if (playlist.tracks.length !== before) writePlaylists(playlists);
    return { success: true };
  });

  // settings ipc
  ipcMain.handle('get-settings', () => ({ ...readSettings(), backgroundHotkeyStatus: getBackgroundHotkeyStatus() }));

  ipcMain.handle('save-discord-github-token', (_event, value) => {
    const token = String(value || '').trim();
    if (!token) {
      try { if (fs.existsSync(discordSecretPath)) fs.unlinkSync(discordSecretPath); } catch (error) { return { success: false, error: error.message }; }
      return { success: true, configured: false };
    }
    if (!safeStorage.isEncryptionAvailable()) return { success: false, error: 'Windows secure storage is unavailable.' };
    try {
      fs.writeFileSync(discordSecretPath, safeStorage.encryptString(token), { mode: 0o600 });
      return { success: true, configured: true };
    } catch (error) { return { success: false, error: 'Could not save the encrypted GitHub token.' }; }
  });

  ipcMain.handle('update-discord-presence', (_event, input = {}) => {
    const updateVersion = ++discordUpdateVersion;
    const settings = readSettings();
    if (!settings.discordPresenceEnabled || !/^\d{10,25}$/.test(settings.discordClientId || '')) {
      clearDiscordActivity();
      return { success: false, error: 'Add a Discord application ID and enable Rich Presence in Settings.' };
    }
    const title = String(input.title || '').trim().slice(0, 120);
    const artist = String(input.artist || '').trim().slice(0, 120);
    if (!title) { clearDiscordActivity(); return { success: true }; }
    let imageUrl = '';
    const target = `${settings.githubOwner}/${settings.githubRepository}/${settings.githubBranch || 'main'}`;
    if (settings.discordArtEnabled && input.trackPath) {
      const storedTrack = readLibrary().find(track => track.path === input.trackPath);
      if (storedTrack?.discordArtworkTarget === target) imageUrl = storedTrack.discordArtworkUrl || '';
    }
    const activity = {
      details: 'Currently Playing',
      state: (artist ? `${title} • ${artist}` : title).slice(0, 128),
      assets: { large_text: title, ...(imageUrl ? { large_image: imageUrl } : {}) }
    };
    const duration = Number(input.duration);
    const currentTime = Number(input.currentTime);
    if (input.playing && Number.isFinite(duration) && duration > 0 && Number.isFinite(currentTime)) {
      const now = Date.now();
      activity.timestamps = {
        start: Math.floor((now - Math.max(0, currentTime) * 1000) / 1000),
        end: Math.floor((now + Math.max(0, duration - currentTime) * 1000) / 1000)
      };
    }
    discordCurrentActivity = activity;
    connectDiscord();
    sendDiscordActivity();

    // Rapid track skips should only upload the cover for the final selection.
    // Publish the title immediately; attach the cover when its upload finishes.
    clearTimeout(discordArtworkUpdateTimer);
    discordArtworkUpdateTimer = null;
    if (!imageUrl && settings.discordArtEnabled && input.imagePath && getGithubToken()) {
      discordArtworkUpdateTimer = setTimeout(async () => {
        discordArtworkUpdateTimer = null;
        try {
          const uploadedUrl = await publishDiscordArtwork(input.imagePath, settings);
          if (!uploadedUrl || updateVersion !== discordUpdateVersion || !discordCurrentActivity) return;
          discordCurrentActivity.assets.large_image = uploadedUrl;
          sendDiscordActivity();
        } catch (error) {
          console.error('Could not publish Discord cover art:', error);
        }
      }, 650);
      discordArtworkUpdateTimer.unref?.();
    }
    return { success: true, artworkPublished: Boolean(imageUrl) };
  });

  ipcMain.handle('get-discord-presence-status', () => getDiscordPresenceStatus());

  ipcMain.handle('notify-next-track', (_event, input = {}) => {
    const title = String(input.title || '').trim().slice(0, 120);
    const artist = String(input.artist || '').trim().slice(0, 120);
    if (!title || !Notification.isSupported()) return false;
    new Notification({
      title: 'Up next',
      body: artist ? `${title} — ${artist}` : title,
      silent: true
    }).show();
    return true;
  });

  ipcMain.handle('set-hotkey-capture-mode', (_event, capturing) => {
    if (typeof globalShortcut.setSuspended !== 'function') return false;
    globalShortcut.setSuspended(Boolean(capturing));
    return true;
  });

ipcMain.handle('save-settings', (event, partial) => {
  const current = readSettings();
  const discordClientId = Object.prototype.hasOwnProperty.call(partial || {}, 'discordClientId')
    ? String(partial.discordClientId || '').trim() : current.discordClientId;
  if (Object.prototype.hasOwnProperty.call(partial || {}, 'discordClientId') && discordClientId && !/^\d{10,25}$/.test(discordClientId)) {
    return { success: false, error: 'Discord Application ID must contain 10–25 digits.' };
  }
  for (const key of ['githubOwner', 'githubRepository', 'githubBranch']) {
    if (Object.prototype.hasOwnProperty.call(partial || {}, key) && String(partial[key] || '').length > 120) {
      return { success: false, error: `${key} is too long.` };
    }
  }
  let backgroundHotkeys = current.backgroundHotkeys;
  if (Object.prototype.hasOwnProperty.call(partial || {}, 'backgroundHotkeys')) {
    const validation = validateBackgroundHotkeys(partial.backgroundHotkeys);
    if (!validation.success) return validation;
    backgroundHotkeys = validation.hotkeys;
  }
  const merged = {
    ...current,
    ...partial,
    backgroundHotkeys,
    eq: { ...current.eq, ...((partial && partial.eq) || {}) },
    lastSession: { ...current.lastSession, ...((partial && partial.lastSession) || {}) }
  };
  writeSettings(merged);
  if (['discordPresenceEnabled', 'discordArtEnabled', 'githubOwner', 'githubRepository', 'githubBranch'].some(key =>
    Object.prototype.hasOwnProperty.call(partial || {}, key))) {
    enqueueDiscordArtworkSync();
  }
  if (Object.prototype.hasOwnProperty.call(partial || {}, 'discordPresenceEnabled') ||
      Object.prototype.hasOwnProperty.call(partial || {}, 'discordClientId')) {
    discordUpdateVersion += 1;
    disconnectDiscord();
    clearTimeout(discordReconnectTimer);
    if (merged.discordPresenceEnabled) connectDiscord();
    else clearDiscordActivity();
  }
  if (partial?.discordArtEnabled === false && discordCurrentActivity?.assets?.large_image) {
    delete discordCurrentActivity.assets.large_image;
    sendDiscordActivity();
  }
  if (Object.prototype.hasOwnProperty.call(partial || {}, 'backgroundHotkeysEnabled') ||
      Object.prototype.hasOwnProperty.call(partial || {}, 'backgroundHotkeys')) {
    const status = setBackgroundHotkeysEnabled(merged.backgroundHotkeysEnabled === true, false);
    merged.backgroundHotkeyStatus = status;
  }
  if (Object.prototype.hasOwnProperty.call(partial || {}, 'autoMiniPlayer')) {
    autoMiniPlayerEnabled = merged.autoMiniPlayer !== false;
  }
  if (Object.prototype.hasOwnProperty.call(partial || {}, 'miniPlayerAlwaysOnTop')) {
    miniPlayerAlwaysOnTop = merged.miniPlayerAlwaysOnTop !== false;
    if (mainWindowRef && !mainWindowRef.isDestroyed() && miniPlayerMode && !mainWindowRef.isMinimized()) {
      mainWindowRef.setAlwaysOnTop(miniPlayerAlwaysOnTop, 'floating');
    }
  }
  return { success: true, settings: merged, backgroundHotkeyStatus: getBackgroundHotkeyStatus() };
});

  ipcMain.handle('choose-watch-folder', async () => {
    const result = await dialog.showOpenDialog(mainWindowRef, { properties: ['openDirectory'] });
    if (result.canceled || !result.filePaths[0]) return { success: false };
    const folder = result.filePaths[0];
    writeSettings({ ...readSettings(), watchFolder: folder });
    startWatcher(folder);
    return { success: true, folder };
  });

  ipcMain.handle('clear-watch-folder', () => {
    writeSettings({ ...readSettings(), watchFolder: null });
    startWatcher(null);
    return { success: true };
  });

  ipcMain.handle('export-data', async () => {
    const result = await dialog.showSaveDialog(mainWindowRef, {
      title: 'Export Fancy Library',
      defaultPath: `music-library-${Date.now()}.flib`,
      filters: [{ name: 'Fancy Library Archive', extensions: ['flib'] }]
    });
    if (result.canceled || !result.filePath) return { success: false };
    const staging = fs.mkdtempSync(path.join(app.getPath('temp'), 'fancyoffline-flib-export-'));
    try {
      const library = readLibrary();
      const playlists = readPlaylists();
      const allTracks = new Map();
      library.forEach(track => { if (track.path) allTracks.set(track.path, track); });
      playlists.forEach(playlist => (playlist.tracks || []).forEach(track => {
        if (track.path && !allTracks.has(track.path)) allTracks.set(track.path, track);
      }));

      const items = [];
      const audioPaths = new Map();
      const artworkPaths = new Map();
      let audioIndex = 0;
      const stageFile = (archivePath, contents) => {
        const diskPath = path.join(staging, ...archivePath.split('/'));
        fs.mkdirSync(path.dirname(diskPath), { recursive: true });
        fs.writeFileSync(diskPath, contents);
        items.push({ archivePath, diskPath });
      };

      for (const [sourcePath, track] of allTracks) {
        if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile()) {
          throw new Error(`The song file is missing: ${track.name || sourcePath}`);
        }
        if (!SUPPORTED_EXTENSIONS.test(sourcePath)) throw new Error(`Unsupported song file: ${track.name || sourcePath}`);
        const basename = path.basename(sourcePath).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_') || 'song.audio';
        const portablePath = `audio/${String(++audioIndex).padStart(6, '0')}-${basename}`;
        const diskPath = path.join(staging, ...portablePath.split('/'));
        fs.mkdirSync(path.dirname(diskPath), { recursive: true });
        fs.copyFileSync(sourcePath, diskPath);
        audioPaths.set(sourcePath, portablePath);
        items.push({ archivePath: portablePath, diskPath });
      }

      const addArtwork = sourcePath => {
        const normalizedPath = normalizeArtworkPath(sourcePath);
        if (!normalizedPath) return '';
        if (artworkPaths.has(normalizedPath)) return artworkPaths.get(normalizedPath);
        const extension = path.extname(normalizedPath).toLowerCase();
        if (!Object.values(IMAGE_TYPES).includes(extension)) return '';
        const portablePath = `artwork/${crypto.createHash('sha256').update(normalizedPath).digest('hex')}${extension}`;
        const diskPath = path.join(userDataPath, normalizedPath);
        const stagePath = path.join(staging, ...portablePath.split('/'));
        fs.mkdirSync(path.dirname(stagePath), { recursive: true });
        fs.copyFileSync(diskPath, stagePath);
        artworkPaths.set(normalizedPath, portablePath);
        items.push({ archivePath: portablePath, diskPath: stagePath });
        return portablePath;
      };

      const backupLibrary = [];
      for (const track of allTracks.values()) {
        const backupTrack = JSON.parse(JSON.stringify(track));
        backupTrack.path = audioPaths.get(track.path);
        backupTrack.imagePath = addArtwork(track.imagePath);
        delete backupTrack.imageUrl;
        delete backupTrack.discordArtworkUrl;
        delete backupTrack.discordArtworkTarget;
        const lyrics = readTrackLyricsFiles(track) || track.lyrics;
        const syncedLyrics = String(lyrics?.syncedLyrics || '');
        const plainLyrics = String(lyrics?.plainLyrics || '');
        if (syncedLyrics || plainLyrics) {
          const extension = syncedLyrics ? '.lrc' : '.txt';
          const lyricPath = `lyrics/${crypto.createHash('sha256').update(track.path).digest('hex')}${extension}`;
          stageFile(lyricPath, syncedLyrics || plainLyrics);
          backupTrack.lyrics = { source: lyrics.source === 'cached' ? 'cached' : 'local', file: lyricPath };
        } else {
          backupTrack.lyrics = null;
        }
        backupLibrary.push(backupTrack);
      }

      const backupPlaylists = playlists.map(playlist => {
        const backupPlaylist = JSON.parse(JSON.stringify(playlist));
        backupPlaylist.coverImagePath = addArtwork(playlist.coverImagePath);
        delete backupPlaylist.coverImage;
        backupPlaylist.tracks = (playlist.tracks || []).map(track => {
          const backupTrack = JSON.parse(JSON.stringify(track));
          backupTrack.path = audioPaths.get(track.path);
          backupTrack.imagePath = addArtwork(track.imagePath);
          delete backupTrack.imageUrl;
          delete backupTrack.discordArtworkUrl;
          delete backupTrack.discordArtworkTarget;
          return backupTrack;
        });
        return backupPlaylist;
      });

      const exportedSettings = { ...readSettings(), watchFolder: null };
      exportedSettings.lastSession = {
        ...DEFAULT_SETTINGS.lastSession,
        ...(exportedSettings.lastSession || {}),
        trackPath: audioPaths.get(exportedSettings.lastSession?.trackPath) || null
      };
      const manifest = {
        format: 'flib', version: 1, app: 'Fancy Offline Player', appVersion: app.getVersion(),
        exportedAt: new Date().toISOString(),
        counts: { music: backupLibrary.length, playlists: backupPlaylists.length, audio: audioPaths.size, artwork: artworkPaths.size }
      };
      stageFile('import.json', JSON.stringify(manifest, null, 2));
      stageFile('music.json', JSON.stringify(backupLibrary, null, 2));
      stageFile('playlists.json', JSON.stringify(backupPlaylists, null, 2));
      stageFile('settings.json', JSON.stringify(exportedSettings, null, 2));
      const rootOrder = ['import.json', 'music.json', 'playlists.json', 'settings.json'];
      const folderOrder = ['artwork', 'audio', 'lyrics'];
      items.sort((left, right) => {
        const leftRoot = rootOrder.indexOf(left.archivePath);
        const rightRoot = rootOrder.indexOf(right.archivePath);
        if (leftRoot >= 0 || rightRoot >= 0) return (leftRoot < 0 ? rootOrder.length : leftRoot) - (rightRoot < 0 ? rootOrder.length : rightRoot);
        return folderOrder.indexOf(left.archivePath.split('/')[0]) - folderOrder.indexOf(right.archivePath.split('/')[0]) || left.archivePath.localeCompare(right.archivePath);
      });
      await writeZipArchive(result.filePath, items);
      return { success: true, filePath: result.filePath };
    } catch (err) {
      console.error('Export failed:', err);
      return { success: false, error: err.message || 'Could not write the .flib archive.' };
    } finally {
      try { fs.rmSync(staging, { recursive: true, force: true }); } catch (_) {}
    }
  });

  ipcMain.handle('import-data', async () => {
    const result = await dialog.showOpenDialog(mainWindowRef, {
      title: 'Import Fancy Library',
      properties: ['openFile'],
      filters: [{ name: 'Fancy Library Archive', extensions: ['flib', 'zip'] }]
    });
    if (result.canceled || !result.filePaths[0]) return { success: false };
    const archivePath = result.filePaths[0];
    const staging = fs.mkdtempSync(path.join(app.getPath('temp'), 'fancyoffline-flib-import-'));
    let musicDestination = '';
    let importCommitted = false;
    try {
      const entries = await readZipDirectory(archivePath);
      const allowedRootFiles = new Set(['import.json', 'music.json', 'playlists.json', 'settings.json']);
      const entryMap = new Map();
      for (const entry of entries) {
        if (entry.directory) continue;
        const allowed = allowedRootFiles.has(entry.name) || /^(artwork|audio|lyrics)\/.+/.test(entry.name);
        if (!allowed) throw new Error(`Unexpected archive file: ${entry.name}`);
        if (entryMap.has(entry.name)) throw new Error(`Duplicate archive file: ${entry.name}`);
        entryMap.set(entry.name, entry);
      }
      for (const name of allowedRootFiles) if (!entryMap.has(name)) throw new Error(`Archive is missing ${name}.`);
      const totalSize = entries.reduce((sum, entry) => sum + (entry.directory ? 0 : entry.uncompressedSize), 0);
      if (totalSize > 0x7fffffff * 4) throw new Error('The archive is too large to import.');
      for (const entry of entryMap.values()) {
        const target = path.join(staging, ...entry.name.split('/'));
        await extractZipEntry(archivePath, entry, target);
      }

      const manifest = JSON.parse(fs.readFileSync(path.join(staging, 'import.json'), 'utf8'));
      if (manifest.format !== 'flib' || manifest.version !== 1) throw new Error('That file is not a supported Fancy Library archive.');
      const backupLibrary = JSON.parse(fs.readFileSync(path.join(staging, 'music.json'), 'utf8'));
      const backupPlaylists = JSON.parse(fs.readFileSync(path.join(staging, 'playlists.json'), 'utf8'));
      const backupSettings = JSON.parse(fs.readFileSync(path.join(staging, 'settings.json'), 'utf8'));
      if (!Array.isArray(backupLibrary) || !Array.isArray(backupPlaylists) || !backupSettings || typeof backupSettings !== 'object' || Array.isArray(backupSettings)) {
        throw new Error('The archive is missing valid music, playlists, or settings data.');
      }
      if (backupLibrary.some(track => !track || typeof track !== 'object' || typeof track.path !== 'string') ||
          backupPlaylists.some(playlist => !playlist || typeof playlist !== 'object' || !Array.isArray(playlist.tracks) ||
            playlist.tracks.some(track => !track || typeof track !== 'object' || typeof track.path !== 'string'))) {
        throw new Error('The archive contains invalid song or playlist data.');
      }
      const audioEntries = [...entryMap.keys()].filter(name => name.startsWith('audio/'));
      const audioPathsInData = [...backupLibrary.map(track => track?.path), ...backupPlaylists.flatMap(playlist => (playlist?.tracks || []).map(track => track?.path))].filter(Boolean);
      if (audioPathsInData.some(name => typeof name !== 'string' || !name.startsWith('audio/') || !entryMap.has(name))) {
        throw new Error('The archive is missing one or more song files.');
      }
      if (audioEntries.length) {
        const chosen = await dialog.showOpenDialog(mainWindowRef, {
          title: 'Choose where to store imported music',
          properties: ['openDirectory', 'createDirectory']
        });
        if (chosen.canceled || !chosen.filePaths[0]) return { success: false };
        const selectedFolder = chosen.filePaths[0];
        const archiveName = path.basename(archivePath, path.extname(archivePath)).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim() || 'Music Library';
        const folderBase = `Fancy Offline Player - ${archiveName}`;
        musicDestination = path.join(selectedFolder, folderBase);
        let suffix = 2;
        while (fs.existsSync(musicDestination)) musicDestination = path.join(selectedFolder, `${folderBase} (${suffix++})`);
        fs.mkdirSync(musicDestination, { recursive: false });
      }

      const importedAudioPaths = new Map();
      for (const archiveName of audioEntries) {
        const source = path.join(staging, ...archiveName.split('/'));
        const target = musicDestination ? path.join(musicDestination, ...archiveName.split('/')) : source;
        if (musicDestination) {
          fs.mkdirSync(path.dirname(target), { recursive: true });
          await fs.promises.copyFile(source, target);
        }
        importedAudioPaths.set(archiveName, target);
      }

      const importedArtworkPaths = new Map();
      for (const archiveName of entryMap.keys()) {
        if (!archiveName.startsWith('artwork/')) continue;
        const source = path.join(staging, ...archiveName.split('/'));
        const extension = path.extname(archiveName).toLowerCase();
        const mimeType = Object.entries(IMAGE_TYPES).find(([, value]) => value === extension)?.[0];
        const internalPath = saveArtworkBytes(mimeType, fs.readFileSync(source));
        if (!internalPath) throw new Error(`Could not restore artwork file ${archiveName}.`);
        importedArtworkPaths.set(archiveName, internalPath);
      }

      const restoreArtworkPath = archiveName => {
        if (!archiveName) return '';
        if (typeof archiveName !== 'string' || !archiveName.startsWith('artwork/')) throw new Error('The archive contains an invalid artwork path.');
        const restored = importedArtworkPaths.get(archiveName);
        if (!restored) throw new Error(`The archive is missing artwork file ${archiveName}.`);
        return restored;
      };
      const restoreTrack = track => {
        if (!track || typeof track !== 'object' || typeof track.path !== 'string') throw new Error('The archive contains an invalid song record.');
        const restoredPath = importedAudioPaths.get(track.path);
        if (!restoredPath) throw new Error(`The archive is missing song file ${track.path}.`);
        const restored = { ...track, path: restoredPath, data: { ...(track.data || {}) } };
        restored.imagePath = restoreArtworkPath(track.imagePath);
        delete restored.imageUrl;
        delete restored.discordArtworkUrl;
        delete restored.discordArtworkTarget;
        const lyricFile = track.lyrics?.file;
        if (lyricFile) {
          if (typeof lyricFile !== 'string' || !lyricFile.startsWith('lyrics/') || !entryMap.has(lyricFile)) throw new Error('The archive contains an invalid lyrics path.');
          const lyricsText = fs.readFileSync(path.join(staging, ...lyricFile.split('/')), 'utf8').slice(0, 500000);
          const syncedLyrics = path.extname(lyricFile).toLowerCase() === '.lrc' ? lyricsText : '';
          const plainLyrics = syncedLyrics ? lyricsText.replace(/\[\d{1,2}:\d{2}(?:[.:]\d{1,3})?\]/g, '').trim() : lyricsText;
          const storedLyrics = writeTrackLyricsFiles(restored, track.lyrics.source === 'cached' ? 'cached' : 'local', plainLyrics, syncedLyrics);
          restored.lyrics = storedLyrics ? { source: storedLyrics.source, file: storedLyrics.file } : null;
        } else {
          restored.lyrics = null;
        }
        return restored;
      };

      const restoredLibrary = backupLibrary.map(restoreTrack);
      const restoredPlaylists = backupPlaylists.map(playlist => {
        if (!playlist || typeof playlist !== 'object' || !Array.isArray(playlist.tracks)) throw new Error('The archive contains an invalid playlist.');
        return {
          ...playlist,
          coverImagePath: restoreArtworkPath(playlist.coverImagePath),
          tracks: playlist.tracks.map(restoreTrack)
        };
      });
      const restoredLastTrack = importedAudioPaths.get(backupSettings.lastSession?.trackPath) || null;
      const importedSettings = {
        ...DEFAULT_SETTINGS,
        ...backupSettings,
        watchFolder: null,
        lastSession: {
          ...DEFAULT_SETTINGS.lastSession,
          ...(backupSettings.lastSession || {}),
          trackPath: restoredLastTrack,
          position: Math.max(0, Number(backupSettings.lastSession?.position) || 0)
        },
        eq: { ...DEFAULT_SETTINGS.eq, ...(backupSettings.eq || {}) }
      };
      const validatedHotkeys = validateBackgroundHotkeys(importedSettings.backgroundHotkeys);
      importedSettings.backgroundHotkeys = validatedHotkeys.success ? validatedHotkeys.hotkeys : { ...DEFAULT_BACKGROUND_HOTKEYS };
      if (!['home', 'playlists'].includes(importedSettings.startupPage)) importedSettings.startupPage = DEFAULT_SETTINGS.startupPage;

      const oldDataFiles = [dbPath, playlistsDbPath, settingsPath].map(filePath => ({ filePath, data: fs.existsSync(filePath) ? fs.readFileSync(filePath) : null }));
      try {
        writeLibrary(restoredLibrary);
        writePlaylists(restoredPlaylists);
        writeSettings(importedSettings);
      } catch (error) {
        oldDataFiles.forEach(({ filePath, data }) => {
          if (data) fs.writeFileSync(filePath, data);
          else if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        });
        throw error;
      }
      importCommitted = true;
      try {
        startWatcher(null);
        autoMiniPlayerEnabled = importedSettings.autoMiniPlayer !== false;
        miniPlayerAlwaysOnTop = importedSettings.miniPlayerAlwaysOnTop !== false;
        if (mainWindowRef && !mainWindowRef.isDestroyed() && !mainWindowRef.isMinimized()) mainWindowRef.setAlwaysOnTop(miniPlayerMode && miniPlayerAlwaysOnTop, 'floating');
        setBackgroundHotkeysEnabled(importedSettings.backgroundHotkeysEnabled === true, false);
        discordUpdateVersion += 1;
        clearTimeout(discordReconnectTimer);
        disconnectDiscord();
        if (importedSettings.discordPresenceEnabled) connectDiscord();
        else clearDiscordActivity();
        enqueueDiscordArtworkSync();
        notifyLibraryUpdated();
      } catch (error) {
        console.error('The library imported, but a setting could not be applied immediately:', error);
      }
      return { success: true, musicFolder: musicDestination || null };
    } catch (err) {
      console.error('Import failed:', err);
      if (!importCommitted && musicDestination && fs.existsSync(musicDestination)) fs.rmSync(musicDestination, { recursive: true, force: true });
      return { success: false, error: err.message || 'Could not import that .flib archive.' };
    } finally {
      try { fs.rmSync(staging, { recursive: true, force: true }); } catch (_) {}
    }
  });

  ipcMain.handle('clear-library', (event, options = {}) => {
    const { clearTracks = true, clearPlaylists = true } = options || {};
    if (clearTracks) writeLibrary([]);
    if (clearPlaylists) writePlaylists([]);
    notifyLibraryUpdated();
    return { success: true };
  });

  ipcMain.handle('relaunch-app', () => {
    app.relaunch();
    app.quit();
  });

  createWindow();
  startWatcher(initialSettings.watchFolder);
  enqueueDiscordArtworkSync();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('web-contents-created', (_, contents) => {
  contents.on('new-window', (e) => e.preventDefault());
  contents.on('will-navigate', (e, url) => {
    if (!url.startsWith('media://') && !url.startsWith('file://')) {
      e.preventDefault();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('before-quit', () => {
  clearTimeout(discordReconnectTimer);
  clearDiscordActivity();
  for (const connection of discordConnections.values()) {
    if (!connection.pipe.destroyed) connection.pipe.end();
  }
});

