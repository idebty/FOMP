// settings.js
const hwAccelToggle = document.getElementById('hw-accel-toggle');
const startupPageSelect = document.getElementById('startup-page-select');
const resumeSessionToggle = document.getElementById('resume-session-toggle');
const defaultVolumeSlider = document.getElementById('default-volume-slider');
const defaultVolumeValue = document.getElementById('default-volume-value');
const mutedToggle = document.getElementById('muted-toggle');

const eqBassSlider = document.getElementById('eq-bass-slider');
const eqBassValue = document.getElementById('eq-bass-value');
const eqMidSlider = document.getElementById('eq-mid-slider');
const eqMidValue = document.getElementById('eq-mid-value');
const eqTrebleSlider = document.getElementById('eq-treble-slider');
const eqTrebleValue = document.getElementById('eq-treble-value');
const normalizeToggle = document.getElementById('normalize-toggle');

const watchFolderPath = document.getElementById('watch-folder-path');
const chooseWatchFolderBtn = document.getElementById('choose-watch-folder-btn');
const clearWatchFolderBtn = document.getElementById('clear-watch-folder-btn');
const exportDataBtn = document.getElementById('export-data-btn');
const importDataBtn = document.getElementById('import-data-btn');

const clearTracksBtn = document.getElementById('clear-tracks-btn');
const clearPlaylistsBtn = document.getElementById('clear-playlists-btn');
const clearAllBtn = document.getElementById('clear-all-btn');
const relaunchBtn = document.getElementById('relaunch-btn');

if (!window.electronAPI) {
    console.error('electronAPI is not available on the settings page.');
}

async function loadSettings() {
    if (!window.electronAPI) return;
    const settings = await window.electronAPI.getSettings();

    hwAccelToggle.checked = settings.hardwareAcceleration !== false;
    startupPageSelect.value = settings.startupPage || 'home';
    resumeSessionToggle.checked = settings.resumeSession !== false;

    const volumePercent = Math.round((typeof settings.volume === 'number' ? settings.volume : 1) * 100);
    defaultVolumeSlider.value = volumePercent;
    defaultVolumeValue.textContent = `${volumePercent}%`;

    mutedToggle.checked = !!settings.muted;

    const eq = settings.eq || { bass: 0, mid: 0, treble: 0 };
    eqBassSlider.value = eq.bass ?? 0;
    eqBassValue.textContent = `${eq.bass ?? 0}dB`;
    eqMidSlider.value = eq.mid ?? 0;
    eqMidValue.textContent = `${eq.mid ?? 0}dB`;
    eqTrebleSlider.value = eq.treble ?? 0;
    eqTrebleValue.textContent = `${eq.treble ?? 0}dB`;
    normalizeToggle.checked = !!settings.normalize;

    watchFolderPath.textContent = settings.watchFolder
        ? settings.watchFolder
        : 'No folder selected. New audio files dropped here are auto-imported.';
}

function saveSettings(partial) {
    if (!window.electronAPI) return;
    window.electronAPI.saveSettings(partial).catch(err => console.error('Failed to save settings:', err));
}

hwAccelToggle.addEventListener('change', () => {
    saveSettings({ hardwareAcceleration: hwAccelToggle.checked });
});

startupPageSelect.addEventListener('change', () => {
    saveSettings({ startupPage: startupPageSelect.value });
});

resumeSessionToggle.addEventListener('change', () => {
    saveSettings({ resumeSession: resumeSessionToggle.checked });
});

defaultVolumeSlider.addEventListener('input', () => {
    defaultVolumeValue.textContent = `${defaultVolumeSlider.value}%`;
});
defaultVolumeSlider.addEventListener('change', () => {
    saveSettings({ volume: Number(defaultVolumeSlider.value) / 100 });
});

mutedToggle.addEventListener('change', () => {
    saveSettings({ muted: mutedToggle.checked });
});

eqBassSlider.addEventListener('input', () => { eqBassValue.textContent = `${eqBassSlider.value}dB`; });
eqMidSlider.addEventListener('input', () => { eqMidValue.textContent = `${eqMidSlider.value}dB`; });
eqTrebleSlider.addEventListener('input', () => { eqTrebleValue.textContent = `${eqTrebleSlider.value}dB`; });

function saveEq() {
    saveSettings({
        eq: {
            bass: Number(eqBassSlider.value),
            mid: Number(eqMidSlider.value),
            treble: Number(eqTrebleSlider.value)
        }
    });
}
eqBassSlider.addEventListener('change', saveEq);
eqMidSlider.addEventListener('change', saveEq);
eqTrebleSlider.addEventListener('change', saveEq);

normalizeToggle.addEventListener('change', () => {
    saveSettings({ normalize: normalizeToggle.checked });
});

chooseWatchFolderBtn.addEventListener('click', async () => {
    if (!window.electronAPI) return;
    const result = await window.electronAPI.chooseWatchFolder();
    if (result && result.success) {
        watchFolderPath.textContent = result.folder;
    }
});

clearWatchFolderBtn.addEventListener('click', async () => {
    if (!window.electronAPI) return;
    await window.electronAPI.clearWatchFolder();
    watchFolderPath.textContent = 'No folder selected. New audio files dropped here are auto-imported.';
});

exportDataBtn.addEventListener('click', async () => {
    if (!window.electronAPI) return;
    const originalText = exportDataBtn.textContent;
    exportDataBtn.disabled = true;
    exportDataBtn.textContent = 'Exporting...';
    try {
        const result = await window.electronAPI.exportData();
        if (result && result.success) {
            exportDataBtn.textContent = 'Exported!';
        } else {
            exportDataBtn.textContent = originalText;
        }
    } catch (err) {
        console.error('Export failed:', err);
        exportDataBtn.textContent = originalText;
    }
    setTimeout(() => { exportDataBtn.disabled = false; exportDataBtn.textContent = originalText; }, 1500);
});

importDataBtn.addEventListener('click', async () => {
    if (!window.electronAPI) return;
    const confirmed = confirm('Importing a backup will overwrite your current library and playlists. Continue?');
    if (!confirmed) return;

    const originalText = importDataBtn.textContent;
    importDataBtn.disabled = true;
    importDataBtn.textContent = 'Importing...';
    try {
        const result = await window.electronAPI.importData();
        if (result && result.success) {
            importDataBtn.textContent = 'Imported!';
        } else {
            if (result && result.error) alert(result.error);
            importDataBtn.textContent = originalText;
        }
    } catch (err) {
        console.error('Import failed:', err);
        importDataBtn.textContent = originalText;
    }
    setTimeout(() => { importDataBtn.disabled = false; importDataBtn.textContent = originalText; }, 1500);
});

// ---------- Danger Zone ----------
clearTracksBtn.addEventListener('click', async () => {
    if (!window.electronAPI) return;
    const confirmed = confirm('This will permanently delete every track in your library. Continue?');
    if (!confirmed) return;
    await window.electronAPI.clearLibraryData({ clearTracks: true, clearPlaylists: false });
});

clearPlaylistsBtn.addEventListener('click', async () => {
    if (!window.electronAPI) return;
    const confirmed = confirm('This will permanently delete every playlist. Continue?');
    if (!confirmed) return;
    await window.electronAPI.clearLibraryData({ clearTracks: false, clearPlaylists: true });
});

clearAllBtn.addEventListener('click', async () => {
    if (!window.electronAPI) return;
    const confirmed = confirm('This will permanently delete your ENTIRE library and all playlists. This cannot be undone. Continue?');
    if (!confirmed) return;
    await window.electronAPI.clearLibraryData({ clearTracks: true, clearPlaylists: true });
});

relaunchBtn.addEventListener('click', () => {
    if (!window.electronAPI) return;
    window.electronAPI.relaunchApp();
});

// Refresh the page's view of settings if something changed it elsewhere
// (e.g. a danger-zone action taken from another open window).
if (window.electronAPI && window.electronAPI.onLibraryUpdated) {
    window.electronAPI.onLibraryUpdated(() => loadSettings());
}

loadSettings();
