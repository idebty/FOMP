(function initializeSettingsPage() {
// settings.js
const hwAccelToggle = document.getElementById('hw-accel-toggle');
const startupPageSelect = document.getElementById('startup-page-select');
const homeHeaderCollapseToggle = document.getElementById('home-header-collapse-toggle');
const autoMiniPlayerToggle = document.getElementById('auto-mini-player-toggle');
const miniPlayerTopToggle = document.getElementById('mini-player-top-toggle');
const discordPresenceToggle = document.getElementById('discord-presence-toggle');
const discordArtToggle = document.getElementById('discord-art-toggle');
const discordClientIdInput = document.getElementById('discord-client-id');
const githubOwnerInput = document.getElementById('github-owner');
const githubRepositoryInput = document.getElementById('github-repository');
const githubBranchInput = document.getElementById('github-branch');
const githubTokenInput = document.getElementById('github-token');
const artProvider = document.getElementById('discord-art-provider');
const imgurClientId = document.getElementById('imgur-client-id');
const saveDiscordSettingsBtn = document.getElementById('save-discord-settings-btn');
const discordSettingsStatus = document.getElementById('discord-settings-status');
const resumeSessionToggle = document.getElementById('resume-session-toggle');
const backgroundHotkeysToggle = document.getElementById('background-hotkeys-toggle');
const backgroundHotkeyStatus = document.getElementById('background-hotkey-status');
const hotkeyCaptureButtons = [...document.querySelectorAll('.hotkey-capture')];
const defaultBackgroundHotkeys = {
    fullscreen: 'Control+Alt+F', playback: 'Control+Alt+Space',
    previous: 'Control+Alt+Left', next: 'Control+Alt+Right',
    seekBack: 'Control+Alt+Shift+Left', seekForward: 'Control+Alt+Shift+Right',
    volumeUp: 'Control+Alt+Up', volumeDown: 'Control+Alt+Down'
};
let backgroundHotkeys = { ...defaultBackgroundHotkeys };
let activeHotkeyCapture = null;
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
    startupPageSelect.dispatchEvent(new Event('app-select-sync'));
    homeHeaderCollapseToggle.checked = settings.homeHeaderCollapse !== false;
    autoMiniPlayerToggle.checked = settings.autoMiniPlayer !== false;
    miniPlayerTopToggle.checked = settings.miniPlayerAlwaysOnTop !== false;
    discordPresenceToggle.checked = settings.discordPresenceEnabled === true;
    discordArtToggle.checked = settings.discordArtEnabled !== false;
    discordClientIdInput.value = settings.discordClientId || '';
    githubOwnerInput.value = settings.githubOwner || '';
    githubRepositoryInput.value = settings.githubRepository || '';
    githubBranchInput.value = settings.githubBranch || 'main';
    if (artProvider) { artProvider.value = settings.discordArtProvider || 'github'; setArtworkProvider(artProvider.value); }
    if (imgurClientId) imgurClientId.value = settings.imgurClientId || '';
    resumeSessionToggle.checked = settings.resumeSession !== false;
    backgroundHotkeysToggle.checked = settings.backgroundHotkeysEnabled === true;
    backgroundHotkeys = { ...defaultBackgroundHotkeys, ...(settings.backgroundHotkeys || {}) };
    renderBackgroundHotkeyButtons();
    renderBackgroundHotkeyStatus(settings.backgroundHotkeyStatus);

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
    refreshDiscordPresenceStatus();
}

window.addEventListener('music-settings-change', event => {
    const changes = event.detail || {};
    if (typeof changes.volume === 'number') {
        defaultVolumeSlider.value = Math.round(changes.volume * 100);
        defaultVolumeValue.textContent = `${defaultVolumeSlider.value}%`;
    }
    if (Object.hasOwn(changes, 'muted')) mutedToggle.checked = !!changes.muted;
    if (changes.eq) {
        eqBassSlider.value = changes.eq.bass ?? eqBassSlider.value;
        eqBassValue.textContent = `${eqBassSlider.value}dB`;
        eqMidSlider.value = changes.eq.mid ?? eqMidSlider.value;
        eqMidValue.textContent = `${eqMidSlider.value}dB`;
        eqTrebleSlider.value = changes.eq.treble ?? eqTrebleSlider.value;
        eqTrebleValue.textContent = `${eqTrebleSlider.value}dB`;
    }
    if (Object.hasOwn(changes, 'normalize')) normalizeToggle.checked = !!changes.normalize;
});

async function refreshDiscordPresenceStatus() {
    if (!window.electronAPI?.getDiscordPresenceStatus || !discordSettingsStatus) return;
    try {
        const status = await window.electronAPI.getDiscordPresenceStatus();
        if (status?.message) discordSettingsStatus.textContent = status.message;
        discordSettingsStatus.dataset.status = status?.kind || 'disconnected';
    } catch (error) {
        console.error('Could not read Discord Rich Presence status:', error);
        discordSettingsStatus.textContent = 'Could not check Discord connection status.';
        discordSettingsStatus.dataset.status = 'error';
    }
}

setInterval(refreshDiscordPresenceStatus, 2500);

function saveSettings(partial) {
    if (!window.electronAPI) return;
    return window.electronAPI.saveSettings(partial).then(result => {
        if (result?.success !== false) {
            window.dispatchEvent(new CustomEvent('music-settings-change', { detail: partial }));
        }
        return result;
    }).catch(err => {
        console.error('Failed to save settings:', err);
        return { success: false, error: 'Could not save settings.' };
    });
}

saveDiscordSettingsBtn?.addEventListener('click', async () => {
    const clientId = discordClientIdInput.value.trim();
    if (discordPresenceToggle.checked && !/^\d{10,25}$/.test(clientId)) {
        discordSettingsStatus.textContent = 'Enter the numeric Application ID from your Discord Developer Portal.';
        discordClientIdInput.focus();
        return;
    }
    const token = githubTokenInput.value.trim();
    if (token) {
        const secretResult = await window.electronAPI.saveDiscordGithubToken(token);
        if (!secretResult?.success) {
            discordSettingsStatus.textContent = secretResult?.error || 'Could not save the GitHub token.';
            return;
        }
        githubTokenInput.value = '';
    }
    const result = await saveSettings({
        discordPresenceEnabled: discordPresenceToggle.checked,
        discordClientId: clientId,
        discordArtEnabled: discordArtToggle.checked,
        discordArtProvider: artProvider?.value || 'github',
        imgurClientId: imgurClientId?.value.trim() || '',
        githubOwner: githubOwnerInput.value.trim(),
        githubRepository: githubRepositoryInput.value.trim(),
        githubBranch: githubBranchInput.value.trim() || 'main'
    });
    if (!result?.success) {
        discordSettingsStatus.textContent = result?.error || 'Could not save Discord settings.';
        discordSettingsStatus.dataset.status = 'error';
        return;
    }
    discordSettingsStatus.textContent = 'Saved. Checking Discord connection…';
    refreshDiscordPresenceStatus();
});

function setArtworkProvider(provider) {
    if (artProvider) artProvider.value = provider;
    document.querySelectorAll('.art-provider-tab').forEach(tab => { const active = tab.dataset.provider === provider; tab.classList.toggle('active', active); tab.setAttribute('aria-selected', String(active)); });
    document.querySelectorAll('[data-provider-fields]').forEach(section => { section.hidden = section.dataset.providerFields !== provider; });
}
document.querySelectorAll('.art-provider-tab').forEach(tab => tab.addEventListener('click', () => setArtworkProvider(tab.dataset.provider)));

const defaultStyleGuide = `/* CUSTOM STYLESHEET — standard CSS, applied after built-in styles on every app page.
   Save and Apply to preview. This guide is comments only until you add rules.

   Shared color variables (available everywhere):
   --bg-primary (main black), --bg-secondary (dark panels), --bg-card (translucent cards)
   --bg-input / --bg-input-hover (fields), --text-primary / --text-secondary / --text-muted
   --border-color / --border-light, --accent / --accent-hover
   --danger / --danger-bg / --danger-border
   Shared shape and motion: --radius-sm / --radius-md / --radius-lg, --transition

   Use any normal CSS selector. Examples:
   body { background: var(--bg-primary); }
   .settings-section { border-color: var(--accent); }
   .sidebar { background: var(--bg-secondary); }
*/
`;
const editor = document.getElementById('style-editor');
const settingsContainer = document.querySelector('.settings-container');
const styleInput = document.getElementById('custom-stylesheet');
function showStyleEditor(show) { if (!editor || !settingsContainer) return; editor.hidden = !show; settingsContainer.hidden = show; }
document.getElementById('open-style-editor')?.addEventListener('click', async () => { const settings = await window.electronAPI.getSettings(); styleInput.value = settings.customStylesheet || defaultStyleGuide; showStyleEditor(true); styleInput.focus(); });
document.getElementById('back-from-style')?.addEventListener('click', () => showStyleEditor(false));
document.getElementById('save-style')?.addEventListener('click', async () => { const result = await saveSettings({ customStylesheet: styleInput.value }); if (result?.success) { window.applyCustomStylesheet?.(styleInput.value); document.getElementById('style-status').textContent = 'Saved and applied.'; } else document.getElementById('style-status').textContent = result?.error || 'Could not save styles.'; });
document.getElementById('reset-style')?.addEventListener('click', () => { styleInput.value = defaultStyleGuide; });

function formatHotkey(accelerator) {
    return accelerator.split('+').map(part => ({
        CommandOrControl: 'Ctrl / Cmd', Control: 'Ctrl', Super: 'Win / Cmd',
        Space: 'Space', Return: 'Enter', PageUp: 'Page Up', PageDown: 'Page Down'
    }[part] || part)).join(' + ');
}

function renderBackgroundHotkeyButtons() {
    for (const button of hotkeyCaptureButtons) {
        button.textContent = formatHotkey(backgroundHotkeys[button.dataset.hotkeyName] || '');
    }
}

function renderBackgroundHotkeyStatus(status) {
    if (!backgroundHotkeyStatus || !status) return;
    backgroundHotkeysToggle.checked = status.enabled === true;
    if (!status.toggleRegistered) {
        backgroundHotkeyStatus.textContent = 'The toggle Ctrl+Alt+F2 could not be registered. Another app may be using it.';
        return;
    }
    if (!status.enabled) {
        backgroundHotkeyStatus.textContent = 'Off. Press Ctrl+Alt+F2 to enable background hotkeys.';
        return;
    }
    const failed = Object.entries(status.shortcuts || {})
        .filter(([, shortcut]) => !shortcut.registered)
        .map(([name]) => name);
    backgroundHotkeyStatus.textContent = failed.length
        ? `On, but some shortcuts could not register: ${failed.join(', ')}. Another app may be using them.`
        : 'On and registered. These shortcuts work while the player is minimized or another app is focused.';
}

function keyNameFromEvent(event) {
    if (event.code === 'Space') return 'Space';
    if (/^Key[A-Z]$/.test(event.code)) return event.code.slice(3);
    if (/^Digit[0-9]$/.test(event.code)) return event.code.slice(5);
    if (/^F([1-9]|1[0-9]|2[0-4])$/.test(event.key)) return event.key;
    const keys = {
        Space: 'Space', ArrowLeft: 'Left', ArrowRight: 'Right', ArrowUp: 'Up', ArrowDown: 'Down',
        Enter: 'Return', Escape: 'Escape', Tab: 'Tab', Backspace: 'Backspace', Delete: 'Delete',
        Insert: 'Insert', Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown'
    };
    return keys[event.key] || null;
}

async function stopHotkeyCapture() {
    if (!activeHotkeyCapture) return;
    const { button } = activeHotkeyCapture;
    activeHotkeyCapture = null;
    button.classList.remove('is-recording');
    button.textContent = formatHotkey(backgroundHotkeys[button.dataset.hotkeyName]);
    await window.electronAPI?.setHotkeyCaptureMode(false);
}

async function recordBackgroundHotkey(button, event) {
    if (!activeHotkeyCapture) return;
    event.preventDefault();
    event.stopImmediatePropagation();

    if (event.key === 'Escape') {
        await stopHotkeyCapture();
        return;
    }
    if (['Control', 'Alt', 'Shift', 'Meta'].includes(event.key)) {
        button.textContent = 'Press a key with the modifier';
        return;
    }

    const key = keyNameFromEvent(event);
    const modifiers = [];
    if (event.ctrlKey) modifiers.push('Control');
    if (event.altKey) modifiers.push('Alt');
    if (event.shiftKey) modifiers.push('Shift');
    if (event.metaKey) modifiers.push('Super');
    if (!key || modifiers.length === 0) {
        button.textContent = 'Use a modifier + key';
        return;
    }

    const name = button.dataset.hotkeyName;
    const nextHotkeys = { ...backgroundHotkeys, [name]: [...modifiers, key].join('+') };
    await stopHotkeyCapture();
    const result = await saveSettings({ backgroundHotkeys: nextHotkeys });
    if (!result?.success) {
        backgroundHotkeyStatus.textContent = result?.error || 'That shortcut could not be saved.';
        return;
    }
    backgroundHotkeys = { ...nextHotkeys, ...(result.settings?.backgroundHotkeys || {}) };
    renderBackgroundHotkeyButtons();
    renderBackgroundHotkeyStatus(result.backgroundHotkeyStatus);
}

for (const button of hotkeyCaptureButtons) {
    button.addEventListener('click', async () => {
        await stopHotkeyCapture();
        activeHotkeyCapture = { button };
        const suspended = await window.electronAPI?.setHotkeyCaptureMode(true);
        if (!suspended) {
            activeHotkeyCapture = null;
            backgroundHotkeyStatus.textContent = 'Shortcut recording is unavailable in this Electron version.';
            return;
        }
        button.classList.add('is-recording');
        button.textContent = 'Press shortcut…';
    });
}

document.addEventListener('keydown', event => {
    if (activeHotkeyCapture) recordBackgroundHotkey(activeHotkeyCapture.button, event);
}, true);

window.addEventListener('blur', () => stopHotkeyCapture());

backgroundHotkeysToggle.addEventListener('change', async () => {
    const result = await saveSettings({ backgroundHotkeysEnabled: backgroundHotkeysToggle.checked });
    if (result?.backgroundHotkeyStatus) renderBackgroundHotkeyStatus(result.backgroundHotkeyStatus);
});

window.electronAPI?.onBackgroundHotkeyStatus(status => renderBackgroundHotkeyStatus(status));

hwAccelToggle.addEventListener('change', () => {
    saveSettings({ hardwareAcceleration: hwAccelToggle.checked });
});

startupPageSelect.addEventListener('change', () => {
    saveSettings({ startupPage: startupPageSelect.value });
});

homeHeaderCollapseToggle.addEventListener('change', () => {
    saveSettings({ homeHeaderCollapse: homeHeaderCollapseToggle.checked });
});

autoMiniPlayerToggle.addEventListener('change', () => {
    saveSettings({ autoMiniPlayer: autoMiniPlayerToggle.checked });
});

miniPlayerTopToggle.addEventListener('change', () => {
    saveSettings({ miniPlayerAlwaysOnTop: miniPlayerTopToggle.checked });
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
            if (result && result.error) alert(result.error);
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
let unsubscribeLibraryUpdates = null;
if (window.electronAPI && window.electronAPI.onLibraryUpdated) {
    unsubscribeLibraryUpdates = window.electronAPI.onLibraryUpdated(() => loadSettings());
}

window.cleanupSettingsPage = () => {
    unsubscribeLibraryUpdates?.();
    delete window.cleanupSettingsPage;
};

loadSettings();
})();
