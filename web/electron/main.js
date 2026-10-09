

const { app, BrowserWindow, ipcMain, protocol, shell, Menu, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { Readable } = require('stream');
const jsmediatags = require('jsmediatags');

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
const MINI_PLAYER_TRIGGER_WIDTH = 720;
const MINI_PLAYER_TRIGGER_HEIGHT = 480;

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
  miniPlayerAlwaysOnTop: true
};

function readSettings() {
  if (fs.existsSync(settingsPath)) {
    try {
      const saved = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      return {
        ...DEFAULT_SETTINGS,
        ...saved,
        eq: { ...DEFAULT_SETTINGS.eq, ...(saved.eq || {}) },
        lastSession: { ...DEFAULT_SETTINGS.lastSession, ...(saved.lastSession || {}) }
      };
    } catch (err) {
      console.error('Failed to parse settings.json, falling back to defaults:', err);
      return { ...DEFAULT_SETTINGS };
    }
  }
  return { ...DEFAULT_SETTINGS };
}

function writeSettings(settings) {
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
}

const initialSettings = readSettings();
//strip unncesseray electron/chromeium features
app.commandLine.appendSwitch('disable-features',
  'IsolateOrigins,site-per-process,Translate,InterestFeedContentSuggestions,' +
  'MediaRouter,OptimizationHints,NetworkPrediction,OfflinePagesPrefetching,' +
  'WebRtcHideLocalIpsWithMdns,WebUIDarkMode,InfiniteSessionRestore,' +
  'TabHoverCards,PasswordManager,AutofillServerCommunication,' +
  'CalculateNativeWinOcclusion,LazyInitializeMediaControls,' +
  'HighResTimerUsage,PlatformHEVCDecoderSupport,MediaFoundationH264,' +
  'WebBluetooth,WebUSB,Serial'
);

app.commandLine.appendSwitch('disable-background-networking');
app.commandLine.appendSwitch('disable-component-update');
app.commandLine.appendSwitch('disable-default-apps');
app.commandLine.appendSwitch('disable-sync');
app.commandLine.appendSwitch('disable-hang-monitor');
app.commandLine.appendSwitch('disable-popup-blocking');
app.commandLine.appendSwitch('disable-prompt-on-repost');
app.commandLine.appendSwitch('disable-speech-api');
app.commandLine.appendSwitch('disable-bluetooth');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('log-level', '3');
app.commandLine.appendSwitch('silent-debugger-extension-api');
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=512');

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
        let imageUrl = '';
        if (data.picture) {
          const { data: pictureData, format } = data.picture;
          const base64 = Buffer.from(pictureData).toString('base64');
          imageUrl = `data:${format};base64,${base64}`;
        }
        resolve({
          title: data.title,
          artist: data.artist,
          album: data.album,
          imageUrl
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
      backgroundThrottling: false,
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
      return new Response(fs.readFileSync(filePath), {
        headers: { 'Content-Type': mimeType, 'Cache-Control': 'no-store' }
      });
    } catch (err) {
      return new Response('Not found', { status: 404 });
    }
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
    writeLibrary(playlist);
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
    if (typeof changes.imageUrl === 'string' || typeof changes.imagePath === 'string') {
      track.imagePath = saveArtwork(changes.imagePath || changes.imageUrl);
    }
    if (typeof changes.source !== 'undefined') track.source = changes.source;
    if (typeof changes.album === 'string') {
      track.data = track.data || {};
      track.data.album = changes.album;
    }
    writeLibrary(playlist);
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
  ipcMain.handle('get-settings', () => readSettings());

ipcMain.handle('save-settings', (event, partial) => {
  const current = readSettings();
  const merged = {
    ...current,
    ...partial,
    eq: { ...current.eq, ...((partial && partial.eq) || {}) },
    lastSession: { ...current.lastSession, ...((partial && partial.lastSession) || {}) }
  };
  writeSettings(merged);
  if (Object.prototype.hasOwnProperty.call(partial || {}, 'autoMiniPlayer')) {
    autoMiniPlayerEnabled = merged.autoMiniPlayer !== false;
  }
  if (Object.prototype.hasOwnProperty.call(partial || {}, 'miniPlayerAlwaysOnTop')) {
    miniPlayerAlwaysOnTop = merged.miniPlayerAlwaysOnTop !== false;
    if (mainWindowRef && !mainWindowRef.isDestroyed() && miniPlayerMode && !mainWindowRef.isMinimized()) {
      mainWindowRef.setAlwaysOnTop(miniPlayerAlwaysOnTop, 'floating');
    }
  }
  return { success: true, settings: merged };
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
      title: 'Export Library Backup',
      defaultPath: `music-player-backup-${Date.now()}.json`,
      filters: [{ name: 'JSON Backup', extensions: ['json'] }]
    });
    if (result.canceled || !result.filePath) return { success: false };
    try {
      const backupLibrary = readLibrary().map(track => {
        const backupTrack = { ...track };
        const savedLyrics = readTrackLyricsFiles(track);
        if (savedLyrics) {
          backupTrack.lyrics = {
            source: savedLyrics.source,
            plainLyrics: savedLyrics.plainLyrics,
            syncedLyrics: savedLyrics.syncedLyrics
          };
        }
        const imageUrl = artworkDataUrl(track.imagePath);
        if (imageUrl) backupTrack.imageUrl = imageUrl;
        delete backupTrack.imagePath;
        return backupTrack;
      });
      const backupPlaylists = readPlaylists().map(playlist => {
        const backupPlaylist = { ...playlist };
        const coverImage = artworkDataUrl(playlist.coverImagePath);
        if (coverImage) backupPlaylist.coverImage = coverImage;
        delete backupPlaylist.coverImagePath;
        backupPlaylist.tracks = (playlist.tracks || []).map(track => {
          const backupTrack = { ...track };
          const imageUrl = artworkDataUrl(track.imagePath);
          if (imageUrl) backupTrack.imageUrl = imageUrl;
          delete backupTrack.imagePath;
          return backupTrack;
        });
        return backupPlaylist;
      });
      const backup = { exportedAt: Date.now(), library: backupLibrary, playlists: backupPlaylists };
      fs.writeFileSync(result.filePath, JSON.stringify(backup, null, 2));
      return { success: true, filePath: result.filePath };
    } catch (err) {
      console.error('Export failed:', err);
      return { success: false, error: 'Could not write backup file' };
    }
  });

  ipcMain.handle('import-data', async () => {
    const result = await dialog.showOpenDialog(mainWindowRef, {
      title: 'Import Library Backup',
      properties: ['openFile'],
      filters: [{ name: 'JSON Backup', extensions: ['json'] }]
    });
    if (result.canceled || !result.filePaths[0]) return { success: false };
    try {
      const raw = fs.readFileSync(result.filePaths[0], 'utf8');
      const backup = JSON.parse(raw);
      if (!Array.isArray(backup.library) || !Array.isArray(backup.playlists)) {
        return { success: false, error: 'That file is not a valid backup' };
      }
      writeLibrary(backup.library);
      writePlaylists(backup.playlists);
      notifyLibraryUpdated();
      return { success: true };
    } catch (err) {
      console.error('Import failed:', err);
      return { success: false, error: 'Could not read that backup file' };
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

  setInterval(() => {
    if (mainWindowRef && !mainWindowRef.isDestroyed()) {
      mainWindowRef.webContents.session.clearCache().catch(() => {});
      mainWindowRef.webContents.navigationHistory.clear();
    }
  }, 30 * 60 * 1000);

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

