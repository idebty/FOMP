
const { contextBridge, ipcRenderer, webUtils } = require('electron');
contextBridge.exposeInMainWorld('electronAPI', {
  // ---- Library ----
  getPlaylist: () => ipcRenderer.invoke('get-playlist'),
  saveTrack: (track) => ipcRenderer.invoke('save-track', track),
  removeTrack: (path) => ipcRenderer.invoke('remove-track', path),
  updateTrack: (path, changes) => ipcRenderer.invoke('update-track', { path, changes }),
  recordTrackPlay: (path) => ipcRenderer.invoke('record-track-play', path),
  getTrackLyrics: (path) => ipcRenderer.invoke('get-track-lyrics', path),
  saveTrackLyrics: (path, lyrics) => ipcRenderer.invoke('save-track-lyrics', path, lyrics),
  findLyrics: (query) => ipcRenderer.invoke('find-lyrics', query),
  suggestLyrics: (query) => ipcRenderer.invoke('suggest-lyrics', query),
  readMetadata: (path) => ipcRenderer.invoke('read-metadata', path),

  toMediaUrl: (filePath) => 'media://stream/?path=' + encodeURIComponent(filePath),
  toArtworkUrl: (imagePath) => 'artwork://image/?path=' + encodeURIComponent(imagePath),

  getPathForFile: (file) => {
    if (webUtils && typeof webUtils.getPathForFile === 'function') {
      return webUtils.getPathForFile(file);
    }
    return file.path; 
  },

  getPlaylists: () => ipcRenderer.invoke('get-playlists'),
  createPlaylist: (name) => ipcRenderer.invoke('create-playlist', name),
  deletePlaylist: (id) => ipcRenderer.invoke('delete-playlist', id),
  renamePlaylist: (playlistId, name) => ipcRenderer.invoke('rename-playlist', { playlistId, name }),
  setPlaylistCover: (playlistId, coverImage) => ipcRenderer.invoke('set-playlist-cover', { playlistId, coverImage }),
  addTrackToPlaylist: (playlistId, track) => ipcRenderer.invoke('add-track-to-playlist', { playlistId, track }),
  removeTrackFromPlaylist: (playlistId, trackPath) => ipcRenderer.invoke('remove-track-from-playlist', { playlistId, trackPath }),

  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (partial) => ipcRenderer.invoke('save-settings', partial),
  saveDiscordGithubToken: (token) => ipcRenderer.invoke('save-discord-github-token', token),
  updateDiscordPresence: (activity) => ipcRenderer.invoke('update-discord-presence', activity),
  getDiscordPresenceStatus: () => ipcRenderer.invoke('get-discord-presence-status'),
  notifyNextTrack: (track) => ipcRenderer.invoke('notify-next-track', track),
  getAppPage: (page) => ipcRenderer.invoke('get-app-page', page),
  reorderTracks: (paths) => ipcRenderer.invoke('reorder-tracks', paths),
  reorderPlaylistTracks: (playlistId, paths) => ipcRenderer.invoke('reorder-playlist-tracks', { playlistId, paths }),
  setHotkeyCaptureMode: (capturing) => ipcRenderer.invoke('set-hotkey-capture-mode', Boolean(capturing)),
  onBackgroundHotkeyStatus: (callback) => ipcRenderer.on('background-hotkey-status', (_event, status) => callback(status)),
  chooseWatchFolder: () => ipcRenderer.invoke('choose-watch-folder'),
  clearWatchFolder: () => ipcRenderer.invoke('clear-watch-folder'),
  exportData: () => ipcRenderer.invoke('export-data'),
  importData: () => ipcRenderer.invoke('import-data'),
  clearLibraryData: (options) => ipcRenderer.invoke('clear-library', options),
  relaunchApp: () => ipcRenderer.invoke('relaunch-app'),
  setMiniPlayerMode: (enabled) => ipcRenderer.invoke('set-mini-player-mode', Boolean(enabled)),
  setFullscreenPlayer: (enabled) => ipcRenderer.invoke('set-fullscreen-player', Boolean(enabled)),
  onFullscreenPlayerState: (callback) => ipcRenderer.on('fullscreen-player-state', (_event, enabled) => callback(enabled)),
  onGlobalPlayerHotkey: (callback) => ipcRenderer.on('global-player-hotkey', (_event, action) => callback(action)),
  onLibraryUpdated: (callback) => {
    const listener = (_event, ...args) => callback(...args);
    ipcRenderer.on('library-updated', listener);
    return () => ipcRenderer.removeListener('library-updated', listener);
  }
});
