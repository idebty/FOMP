
const { contextBridge, ipcRenderer, webUtils } = require('electron');
contextBridge.exposeInMainWorld('electronAPI', {
  // ---- Library ----
  getPlaylist: () => ipcRenderer.invoke('get-playlist'),
  saveTrack: (track) => ipcRenderer.invoke('save-track', track),
  removeTrack: (path) => ipcRenderer.invoke('remove-track', path),
  updateTrack: (path, changes) => ipcRenderer.invoke('update-track', { path, changes }),
  readMetadata: (path) => ipcRenderer.invoke('read-metadata', path),

  toMediaUrl: (filePath) => 'media://stream/?path=' + encodeURIComponent(filePath),

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
  chooseWatchFolder: () => ipcRenderer.invoke('choose-watch-folder'),
  clearWatchFolder: () => ipcRenderer.invoke('clear-watch-folder'),
  exportData: () => ipcRenderer.invoke('export-data'),
  importData: () => ipcRenderer.invoke('import-data'),
  clearLibraryData: (options) => ipcRenderer.invoke('clear-library', options),
  relaunchApp: () => ipcRenderer.invoke('relaunch-app'),
  onLibraryUpdated: (callback) => ipcRenderer.on('library-updated', callback)
});
