

const { app, BrowserWindow, ipcMain, protocol, shell, Menu, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { Readable } = require('stream');
const jsmediatags = require('jsmediatags');

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
  return;
}

let mainWindowRef = null;

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
  normalize: false
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

const CONTENT_TYPES = {
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav'
};
const SUPPORTED_EXTENSIONS = /\.(mp3|wav)$/i;

function readLibrary() {
  if (fs.existsSync(dbPath)) {
    return JSON.parse(fs.readFileSync(dbPath, 'utf8'));
  }
  return [];
}

function writeLibrary(playlist) {
  fs.writeFileSync(dbPath, JSON.stringify(playlist, null, 2));
}

function readPlaylists() {
  if (fs.existsSync(playlistsDbPath)) {
    return JSON.parse(fs.readFileSync(playlistsDbPath, 'utf8'));
  }
  return [];
}

function writePlaylists(playlists) {
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

function addWatchedFile(fullPath, filename) {
  if (!SUPPORTED_EXTENSIONS.test(filename)) return;
  const library = readLibrary();
  if (library.find(t => t.path === fullPath)) return;
  library.push({
    path: fullPath,
    name: filename,
    source: 'local',
    data: { title: stripExt(filename), artist: '', album: '' },
    imageUrl: ''
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
  if (process.platform !== 'darwin') {
    win.webContents.on('dom-ready', () => {
      win.webContents.executeJavaScript("document.body.classList.add('window-controls-overlay')");
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

app.whenReady().then(() => {
  app.setLoginItemSettings({ openAtLogin: false });
  app.setUserTasks([]);

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

  ipcMain.handle('save-track', (event, trackData) => {
    if (!trackData || !trackData.path) {
      return { success: false, error: 'missing file path' };
    }
    const playlist = readLibrary();
    if (!playlist.find(t => t.path === trackData.path)) {
      playlist.push({
        path: trackData.path,
        name: trackData.name || '',
        source: trackData.source || 'local',
        data: trackData.data || {},
        imageUrl: trackData.imageUrl || ''
      });
      writeLibrary(playlist);
    }
    return { success: true };
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
    if (typeof changes.imageUrl === 'string') track.imageUrl = changes.imageUrl;
    if (typeof changes.source !== 'undefined') track.source = changes.source;
    if (typeof changes.album === 'string') {
      track.data = track.data || {};
      track.data.album = changes.album;
    }
    writeLibrary(playlist);
    return { success: true };
  });

  // playlist ipc
  ipcMain.handle('get-playlists', () => readPlaylists());

  ipcMain.handle('create-playlist', (event, name) => {
    const playlists = readPlaylists();
    const newPlaylist = {
      id: makePlaylistId(),
      name: (name || '').trim() || 'Untitled Playlist',
      coverImage: null,
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
    playlist.coverImage = coverImage || null;
    writePlaylists(playlists);
    return { success: true };
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
      imageUrl: track.imageUrl || ''
    });
    writePlaylists(playlists);
    return { success: true };
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
      const backup = { exportedAt: Date.now(), library: readLibrary(), playlists: readPlaylists() };
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

