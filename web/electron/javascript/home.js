const fileUpload = document.getElementById('file-upload');
const tracklist = document.getElementById('tracklist');
const headerCover = document.getElementById('header-cover');
const headerLabel = document.getElementById('header-label');
const headerTitle = document.getElementById('header-title');
const mainPlayer = document.getElementById('main-player');
const miniPlayerToggle = document.getElementById('mini-player-toggle');

function syncMiniTrackInfo(track) {
    const title = document.getElementById('mini-track-title');
    const artist = document.getElementById('mini-track-artist');
    const cover = document.getElementById('mini-track-cover');
    const fullscreenCover = document.getElementById('fullscreen-cover-bg');
    if (title) title.textContent = track ? (track.data?.title || stripExtension(track.name) || 'Unknown Title') : 'Nothing playing';
    if (artist) artist.textContent = track?.data?.artist || '';
    if (cover) cover.src = artworkSource(track);
    if (fullscreenCover) fullscreenCover.src = artworkSource(track);
}

miniPlayerToggle?.addEventListener('click', async () => {
    const result = await window.electronAPI?.setMiniPlayerMode(false);
    if (result === false) {
        document.body.classList.remove('mini-player-mode');
    }
});

const playBtn = document.getElementById('play-btn');
const prevBtn = document.getElementById('prev-btn');
const nextBtn = document.getElementById('next-btn');
const shuffleBtn = document.getElementById('shuffle-btn');
const repeatAllBtn = document.getElementById('repeat-all-btn');
const repeatOneBtn = document.getElementById('repeat-one-btn');
const playIcon = document.getElementById('play-icon');
const volumeSlider = document.getElementById('volume-slider');
const muteBtn = document.getElementById('mute-btn');
const seekSlider = document.getElementById('seek-slider');
const timeCurrentEl = document.getElementById('time-current');
const timeDurationEl = document.getElementById('time-duration');
let playlist = [];
let currentTrackIndex = -1;
let isShuffle = false;
let isRepeatAll = false;
let isRepeatOne = false;
let appSettings = {};
let isSeeking = false;
let selectedAlbum = null;
let selectedPlaylist = null;
let playbackQueue = null;
let playbackSequence = 0;
let countedPlaybackSequence = -1;
let libraryDragTrackPath = null;
let suppressLibraryClickUntil = 0;
let notifiedNextSequence = -1;
let scheduledNextTrackIndex = -1;
let lastDiscordPresenceUpdateAt = 0;

const { DEFAULT_COVER, SUPPORTED_EXTENSIONS, escapeHtml, stripExtension, imageMimeType, artworkSource, albumKey: getAlbumKey, formatTime } = window.musicCommon;

const lyricsController = window.createLyricsController({
    getCurrentTrack: () => playlist[currentTrackIndex] || null
});
let lyricsWereOpenBeforeFullscreen = false;
const fullscreenExitBtn = document.getElementById('fullscreen-exit-btn');

function enterFullscreenPlayer() {
    lyricsWereOpenBeforeFullscreen = lyricsController.isOpen();
    window.electronAPI?.setFullscreenPlayer(true).catch(error => console.error('Could not open fullscreen player:', error));
}

fullscreenExitBtn?.addEventListener('click', () => window.electronAPI?.setFullscreenPlayer(false));
window.electronAPI?.onFullscreenPlayerState(enabled => {
    document.body.classList.toggle('fullscreen-player-mode', enabled);
    if (enabled) lyricsController.open();
    else if (!lyricsWereOpenBeforeFullscreen) lyricsController.close();
});

document.addEventListener('keydown', async event => {
    if (event.key.toLowerCase() !== 'f' || event.repeat || event.ctrlKey || event.altKey || event.metaKey) return;
    if (event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable="true"]')) return;
    if (!playlist[currentTrackIndex]) return;

    event.preventDefault();
    await toggleFullscreenHotkey();
});

async function toggleFullscreenHotkey() {
    if (!playlist[currentTrackIndex]) return;
    if (document.body.classList.contains('fullscreen-player-mode')) {
        await window.electronAPI?.setFullscreenPlayer(false);
        return;
    }

    lyricsWereOpenBeforeFullscreen = lyricsController.isOpen();
    if (document.body.classList.contains('mini-player-mode')) {
        const restored = await window.electronAPI?.setMiniPlayerMode(false);
        if (restored === false) document.body.classList.remove('mini-player-mode');
    }
    await window.electronAPI?.setFullscreenPlayer(true);
}

function getAlbumTracks(key) {
    return playlist.filter(track => getAlbumKey(track) === key);
}

function renderTopSongs() {
    window.musicCommon.renderMostPlayedSongs(playlist, track => {
        const index = playlist.findIndex(item => item.path === track.path);
        if (index < 0) return;
        selectedAlbum = null;
        selectedPlaylist = null;
        playbackQueue = null;
        showLibraryView();
        renderTracklist(document.getElementById('sidebar-search')?.value || '');
        loadTrack(index);
    });
}

function renderTopPlaylists() {
    if (!window.electronAPI?.getPlaylists) return;
    window.electronAPI.getPlaylists().then(saved => {
        window.musicCommon.renderMostPlayedPlaylists(playlist, saved || [], item => {
            window.navigateApp(`../html/home.html?playlist=${encodeURIComponent(item.id)}`);
        });
    }).catch(error => console.error('Could not load most played playlists:', error));
}

//update the cover img at the top of home
function updateHeaderCover() {
    let track;
    if (selectedPlaylist) {
        const coverTrack = selectedPlaylist.tracks.find(item => item.imagePath || item.imageUrl) || selectedPlaylist.tracks[0];
        track = coverTrack;
        if (headerLabel) headerLabel.textContent = 'Playlist';
        if (headerTitle) headerTitle.textContent = selectedPlaylist.name;
    } else if (selectedAlbum) {
        const albumTracks = getAlbumTracks(selectedAlbum.key);
        track = albumTracks.find(item => item.imagePath || item.imageUrl) || albumTracks[0];
        if (headerLabel) headerLabel.textContent = 'Album';
        if (headerTitle) headerTitle.textContent = selectedAlbum.name;
    } else {
        track = currentTrackIndex !== -1 ? playlist[currentTrackIndex] : playlist[0];
        if (headerLabel) headerLabel.textContent = 'Local Library';
        if (headerTitle) headerTitle.textContent = 'Your Music';
    }
    headerCover.src = artworkSource(track);
    headerCover.alt = selectedPlaylist ? `${selectedPlaylist.name} cover` : selectedAlbum ? `${selectedAlbum.name} cover` : 'Cover';
}

function trackMatchesQuery(track, query) {
    if (!query) return true;
    const q = query.trim().toLowerCase();
    if (!q) return true;
    const title = (track.data?.title || stripExtension(track.name) || '').toLowerCase();
    const artist = (track.data?.artist || '').toLowerCase();
    const album = (track.data?.album || '').toLowerCase();
    const year = (track.data?.year ?? '').toString().toLowerCase();
    const fileName = (track.name || '').toLowerCase();
    return title.includes(q) || artist.includes(q) || album.includes(q) ||
           year.includes(q) || fileName.includes(q);
}

function renderTracklist(query = '') {
    tracklist.innerHTML = '';
    playlist.forEach((track, index) => {
        const matchesPlaylist = !playbackQueue || playbackQueue.includes(index);
        if (matchesPlaylist && (!selectedAlbum || getAlbumKey(track) === selectedAlbum.key) && trackMatchesQuery(track, query)) {
            tracklist.appendChild(createTrackElement(track, index));
        }
    });
    updateHeaderCover();
    renderTopSongs();
    renderTopPlaylists();
}

function reorderLibraryTrack(sourcePath, targetPath) {
    if (!sourcePath || !targetPath || sourcePath === targetPath) return;
    const sourceIndex = playlist.findIndex(track => track.path === sourcePath);
    const targetIndex = playlist.findIndex(track => track.path === targetPath);
    if (sourceIndex < 0 || targetIndex < 0) return;
    const currentPath = playlist[currentTrackIndex]?.path;
    const queuePaths = playbackQueue?.map(index => playlist[index]?.path).filter(Boolean) || null;
    const [track] = playlist.splice(sourceIndex, 1);
    playlist.splice(sourceIndex < targetIndex ? targetIndex - 1 : targetIndex, 0, track);
    currentTrackIndex = currentPath ? playlist.findIndex(item => item.path === currentPath) : -1;
    if (queuePaths) playbackQueue = queuePaths.map(trackPath => playlist.findIndex(item => item.path === trackPath)).filter(index => index >= 0);
    renderTracklist(document.getElementById('sidebar-search')?.value || '');
    window.electronAPI?.reorderTracks(playlist.map(item => item.path))
        .then(result => { if (!result?.success) console.error('Could not save the new library order:', result?.error); })
        .catch(error => console.error('Could not save the new library order:', error));
}

function showLibraryView() {
    lyricsController.close();
}

window.applyLibrarySearch = (query) => renderTracklist(query);

function createTrackElement(track, index) {
    const trackItem = document.createElement('div');
    trackItem.className = 'track-item';
    trackItem.draggable = true;
    trackItem.dataset.trackPath = track.path;

    trackItem.innerHTML = `
        <div class="track-index">${index + 1}</div>
        <div class="track-info-col">
            <div class="track-cover-wrapper" title="Click to change cover">
                <img class="track-cover-img" src="${artworkSource(track)}" loading="lazy" decoding="async">
                <input type="file" class="cover-upload-input" accept="image/*">
            </div>
            <div class="track-text">
                <span class="track-title">${escapeHtml(track.data.title || stripExtension(track.name))}</span>
                <span class="track-artist">${escapeHtml(track.data.artist || ' ')}</span>
            </div>
        </div>
        <div class="track-album" contenteditable="true" spellcheck="false" title="Click to edit album">${escapeHtml(track.data.album || 'Unknown Album')}</div>
        <button class="remove-track-btn" title="Remove song">&#10005;</button>
    `;
    trackItem.addEventListener('click', event => {
        if (Date.now() < suppressLibraryClickUntil) { event.preventDefault(); return; }
        if (event.detail > 1) return;
        loadTrack(index);
    });
    trackItem.addEventListener('dblclick', event => {
        if (event.target.closest('button, input, [contenteditable="true"], .track-cover-wrapper')) return;
        if (currentTrackIndex !== index) loadTrack(index);
        enterFullscreenPlayer();
    });
    trackItem.addEventListener('dragstart', event => {
        if (event.target.closest('button, input, [contenteditable="true"], .track-cover-wrapper')) {
            event.preventDefault();
            return;
        }
        libraryDragTrackPath = track.path;
        suppressLibraryClickUntil = Date.now() + 600;
        trackItem.classList.add('is-dragging');
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', track.path);
    });
    trackItem.addEventListener('dragover', event => {
        if (!libraryDragTrackPath) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        trackItem.classList.add('is-drop-target');
    });
    trackItem.addEventListener('dragleave', () => trackItem.classList.remove('is-drop-target'));
    trackItem.addEventListener('drop', event => {
        event.preventDefault();
        trackItem.classList.remove('is-drop-target');
        const sourcePath = event.dataTransfer.getData('text/plain') || libraryDragTrackPath;
        reorderLibraryTrack(sourcePath, track.path);
    });
    trackItem.addEventListener('dragend', () => {
        libraryDragTrackPath = null;
        trackItem.classList.remove('is-dragging');
        document.querySelectorAll('.track-item.is-drop-target').forEach(element => element.classList.remove('is-drop-target'));
    });

    const coverWrapper = trackItem.querySelector('.track-cover-wrapper');
    const coverInput = trackItem.querySelector('.cover-upload-input');
    coverWrapper.addEventListener('click', (event) => {
        event.stopPropagation();
        coverInput.click();
    });
    coverInput.addEventListener('click', (event) => event.stopPropagation());
    coverInput.addEventListener('change', (event) => {
        const file = event.target.files[0];
        if (file) handleCoverChange(index, file);
        coverInput.value = '';
    });

    const albumEl = trackItem.querySelector('.track-album');
    albumEl.addEventListener('click', (event) => event.stopPropagation());
    albumEl.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            albumEl.blur();
        }
    });
    albumEl.addEventListener('blur', () => handleAlbumEdit(index, albumEl.textContent));

    const removeBtn = trackItem.querySelector('.remove-track-btn');
    removeBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        removeTrackAt(index);
    });

    return trackItem;
}

function handleCoverChange(index, file) {
    const track = playlist[index];
    if (!track) return;

    const reader = new FileReader();
    reader.onload = () => {
        const dataUrl = reader.result;
        track.imageUrl = dataUrl;

        const img = tracklist.children[index]?.querySelector('.track-cover-img');
        if (img) img.src = dataUrl;
        updateHeaderCover();
        renderTopSongs();

        if (window.electronAPI) {
            window.electronAPI.updateTrack(track.path, { imageUrl: dataUrl })
                .then(result => {
                    track.imagePath = result.imagePath || '';
                    delete track.imageUrl;
                    const savedImg = tracklist.children[index]?.querySelector('.track-cover-img');
                    if (savedImg) savedImg.src = artworkSource(track);
                    updateHeaderCover();
        renderTopSongs();
                })
                .catch(err => console.error('Failed to save cover:', err));
        }
    };
    reader.onerror = () => console.error('Failed to read cover image file');
    reader.readAsDataURL(file);
}

function handleAlbumEdit(index, newAlbumText) {
    const track = playlist[index];
    if (!track) return;

    const previousAlbumKey = getAlbumKey(track);
    const newAlbum = newAlbumText.trim() || 'Unknown Album';
    track.data.album = newAlbum;
    if (selectedAlbum?.key === previousAlbumKey && getAlbumKey(track) !== previousAlbumKey) {
        selectedAlbum = null;
    }

    const albumEl = tracklist.children[index]?.querySelector('.track-album');
    if (albumEl) albumEl.textContent = newAlbum;
    updateHeaderCover();
    renderTopSongs();

    if (window.electronAPI) {
        window.electronAPI.updateTrack(track.path, { album: newAlbum })
            .catch(err => console.error('Failed to save album:', err));
    }
}

function removeTrackAt(index) {
    const track = playlist[index];
    if (!track) return;

    playlist.splice(index, 1);

    if (currentTrackIndex === index) {
        mainPlayer.pause();
        mainPlayer.removeAttribute('src');
        mainPlayer.load();
        currentTrackIndex = -1;
    } else if (currentTrackIndex > index) {
        currentTrackIndex -= 1;
    }

    renderTracklist();

    if (window.electronAPI) {
        window.electronAPI.removeTrack(track.path)
            .catch(err => console.error('Failed to remove track:', err));
    }
}


function updateMuteIcon() {
    if (!muteBtn) return;
    const silent = mainPlayer.muted || mainPlayer.volume === 0;
    muteBtn.innerHTML = silent ? '&#128263;' : (mainPlayer.volume < 0.5 ? '&#128264;' : '&#128266;');
}

function applyVolumeSettings() {
    mainPlayer.volume = typeof appSettings.volume === 'number' ? appSettings.volume : 1;
    mainPlayer.muted = !!appSettings.muted;
    if (volumeSlider) volumeSlider.value = mainPlayer.volume;
    updateMuteIcon();
}

if (volumeSlider) {
    volumeSlider.addEventListener('input', () => {
        const value = parseFloat(volumeSlider.value);
        mainPlayer.volume = value;
        mainPlayer.muted = false;
        updateMuteIcon();
        if (window.electronAPI) {
            window.electronAPI.saveSettings({ volume: value, muted: false }).catch(() => {});
        }
    });
}

if (muteBtn) {
    muteBtn.addEventListener('click', () => {
        mainPlayer.muted = !mainPlayer.muted;
        updateMuteIcon();
        if (window.electronAPI) {
            window.electronAPI.saveSettings({ muted: mainPlayer.muted }).catch(() => {});
        }
    });
}


function updateSeekBar() {
    if (!seekSlider || !mainPlayer.duration) {
        if (seekSlider) {
            seekSlider.style.setProperty('--progress', '0%');
        }
        return;
    }

    const percentage =
        (mainPlayer.currentTime / mainPlayer.duration) * 100;

    seekSlider.style.setProperty(
        '--progress',
        `${percentage}%`
    );
}

mainPlayer.addEventListener('loadedmetadata', () => {
    // A source change from Next, Previous, or a shortcut can leave the old
    // Discord activity visible until the next periodic timeupdate. Refresh as
    // soon as the new track's duration and artwork metadata are available.
    if (!mainPlayer.paused) updateDiscordPresence();
    if (seekSlider) {
        seekSlider.max = mainPlayer.duration || 0;
        seekSlider.value = 0;
        seekSlider.style.setProperty('--progress', '0%');
    }

    if (timeDurationEl) {
        timeDurationEl.textContent =
            formatTime(mainPlayer.duration);
    }
});


mainPlayer.addEventListener('timeupdate', () => {
    if (!isSeeking) {
        if (seekSlider) {
            seekSlider.value = mainPlayer.currentTime;
        }

        if (timeCurrentEl) {
            timeCurrentEl.textContent =
                formatTime(mainPlayer.currentTime);
        }
    }

    updateSeekBar();
    maybeNotifyNextTrack();
    if (!mainPlayer.paused && Date.now() - lastDiscordPresenceUpdateAt >= 20000) updateDiscordPresence();
});

// A committed five-second hotkey seek or seek-bar drag should refresh the
// Discord playback timer. The main process coalesces rapid seeks and rate
// limits the actual Discord RPC writes.
mainPlayer.addEventListener('seeked', () => {
    if (!mainPlayer.paused) updateDiscordPresence();
});

function getNextTrackIndex() {
    if (isRepeatOne && currentTrackIndex >= 0) return currentTrackIndex;
    const queue = playbackQueue || playlist.map((_, index) => index);
    if (!queue.length) return -1;
    if (scheduledNextTrackIndex >= 0 && queue.includes(scheduledNextTrackIndex)) return scheduledNextTrackIndex;
    const queuePosition = queue.indexOf(currentTrackIndex);
    let nextPosition = queuePosition + 1;
    if (isShuffle) {
        const choices = queue.filter(index => index !== currentTrackIndex);
        if (!choices.length) return isRepeatAll ? currentTrackIndex : -1;
        scheduledNextTrackIndex = choices[Math.floor(Math.random() * choices.length)];
        return scheduledNextTrackIndex;
    }
    if (nextPosition >= queue.length) {
        if (!isRepeatAll) return -1;
        nextPosition = 0;
    }
    scheduledNextTrackIndex = queue[nextPosition];
    return scheduledNextTrackIndex;
}

function maybeNotifyNextTrack() {
    if (notifiedNextSequence === playbackSequence || !Number.isFinite(mainPlayer.duration) || mainPlayer.duration <= 0 || mainPlayer.paused) return;
    const remaining = mainPlayer.duration - mainPlayer.currentTime;
    if (remaining <= 0 || remaining > 5) return;
    const nextIndex = getNextTrackIndex();
    const nextTrack = playlist[nextIndex];
    if (!nextTrack) return;
    notifiedNextSequence = playbackSequence;
    window.electronAPI?.notifyNextTrack({
        title: nextTrack.data?.title || stripExtension(nextTrack.name) || 'Unknown Title',
        artist: nextTrack.data?.artist || ''
    });
}

function updateDiscordPresence() {
    const track = playlist[currentTrackIndex];
    if (!track || !window.electronAPI?.updateDiscordPresence) return;
    lastDiscordPresenceUpdateAt = Date.now();
    window.electronAPI.updateDiscordPresence({
        trackPath: track.path,
        title: track.data?.title || stripExtension(track.name) || 'Unknown Title',
        artist: track.data?.artist || '',
        imagePath: track.imagePath || '',
        playing: !mainPlayer.paused,
        currentTime: mainPlayer.currentTime || 0,
        duration: Number.isFinite(mainPlayer.duration) ? mainPlayer.duration : 0
    }).catch(error => console.error('Could not update Discord Rich Presence:', error));
}


mainPlayer.addEventListener('ended', () => {
    if (seekSlider) {
        seekSlider.value = 0;
        seekSlider.style.setProperty('--progress', '0%');
    }

    if (timeCurrentEl) {
        timeCurrentEl.textContent = '0:00';
    }
});


if (seekSlider) {
    const startSeeking = () => {
        isSeeking = true;
    };

    const updatePreview = () => {
        const value = parseFloat(seekSlider.value);

        if (timeCurrentEl) {
            timeCurrentEl.textContent = formatTime(value);
        }

        if (mainPlayer.duration) {
            const percentage =
                (value / mainPlayer.duration) * 100;

            seekSlider.style.setProperty(
                '--progress',
                `${percentage}%`
            );
        }
    };

    const commitSeek = () => {
        mainPlayer.currentTime = parseFloat(seekSlider.value);
        isSeeking = false;

        updateSeekBar();
    };

    seekSlider.addEventListener('mousedown', startSeeking);
    seekSlider.addEventListener('touchstart', startSeeking);

    seekSlider.addEventListener('input', updatePreview);

    seekSlider.addEventListener('change', commitSeek);
    seekSlider.addEventListener('mouseup', commitSeek);
    seekSlider.addEventListener('touchend', commitSeek);
}



let sessionSaveTimer = null;
let isLeavingPage = false;
let wasPlayingBeforeLeave = false;
let lastSnapshotSecond = -1;

function savePlaybackSnapshot(isPlaying = !mainPlayer.paused) {
    const track = playlist[currentTrackIndex];
    if (!track?.path) return;
    try {
        sessionStorage.setItem('wuom-playback-snapshot', JSON.stringify({
            trackPath: track.path,
            position: Number(mainPlayer.currentTime) || 0,
            isPlaying: Boolean(isPlaying),
            savedAt: Date.now()
        }));
    } catch (_) {}
}

function saveSession() {
    if (!window.electronAPI || (appSettings.resumeSession === false && !isLeavingPage)) return;
    const track = playlist[currentTrackIndex];
    const lastSession = { trackPath: track ? track.path : null, position: mainPlayer.currentTime || 0 };
    if (isLeavingPage) {
        lastSession.wasPlaying = wasPlayingBeforeLeave;
        lastSession.savedAt = Date.now();
    }
    window.electronAPI.saveSettings({ lastSession }).catch(() => {});
}

mainPlayer.addEventListener('timeupdate', () => {
    const currentSecond = Math.floor(mainPlayer.currentTime);
    if (currentSecond !== lastSnapshotSecond) {
        lastSnapshotSecond = currentSecond;
        savePlaybackSnapshot(!mainPlayer.paused);
    }
    if (sessionSaveTimer) return;
    sessionSaveTimer = setTimeout(() => {
        sessionSaveTimer = null;
        saveSession();
    }, 3000);
});
mainPlayer.addEventListener('play', () => savePlaybackSnapshot(true));
mainPlayer.addEventListener('pause', () => {
    if (!isLeavingPage) savePlaybackSnapshot(false);
    saveSession();
});
window.addEventListener('pagehide', () => {
    isLeavingPage = true;
    wasPlayingBeforeLeave = !mainPlayer.paused;
    savePlaybackSnapshot(wasPlayingBeforeLeave);
    saveSession();
});
window.addEventListener('pageshow', event => {
    if (!event.persisted) return;
    isLeavingPage = false;
    try { sessionStorage.removeItem('wuom-playback-snapshot'); } catch (_) {}
});


function loadLibraryFromDisk() {
    if (!window.electronAPI) return Promise.resolve([]);
    return window.electronAPI.getPlaylist().then(savedTracks => {
        playlist = [];
        savedTracks
            .filter(track => track.path) 
            .forEach(track => {
                playlist.push({
                    path: track.path,
                    name: track.name,
                    data: track.data || {},
                    imagePath: track.imagePath || '',
                    playCount: Math.max(0, Number(track.playCount) || 0),
                    lyrics: track.lyrics || null
                });
            });
        const pageQuery = new URLSearchParams(window.location.search);
        const requestedAlbum = pageQuery.get('album');
        const matchingTrack = requestedAlbum && playlist.find(track => getAlbumKey(track) === requestedAlbum);
        if (matchingTrack) selectedAlbum = { key: requestedAlbum, name: matchingTrack.data.album, artist: matchingTrack.data.artist || 'Unknown Artist' };
        renderTracklist(pageQuery.get('search') || '');
        renderTopPlaylists();
        const searchInput = document.getElementById('sidebar-search');
        if (searchInput && pageQuery.has('search')) searchInput.value = pageQuery.get('search') || '';
        return playlist;
    }).catch(err => {
        console.error('Failed to load saved playlist:', err);
        return [];
    });
}

if (window.electronAPI) {
    Promise.all([
        loadLibraryFromDisk(),
        window.electronAPI.getSettings().catch(() => ({}))
    ]).then(async ([, settings]) => {
        appSettings = settings || {};
        applyVolumeSettings();
        applyEqSettings();

        const pageQuery = new URLSearchParams(window.location.search);
        const requestedTrackPath = pageQuery.get('play');
        const requestedPlaylistId = pageQuery.get('playlist');
        if (requestedPlaylistId) {
            try { sessionStorage.removeItem('wuom-playback-snapshot'); } catch (_) {}
            const savedPlaylists = await window.electronAPI.getPlaylists().catch(() => []);
            const requestedPlaylist = (savedPlaylists || []).find(item => String(item.id) === requestedPlaylistId);
            if (requestedPlaylist) {
                const queue = (requestedPlaylist.tracks || [])
                    .map(item => playlist.findIndex(track => track.path === item.path))
                    .filter(index => index >= 0);
                if (queue.length) {
                    playbackQueue = queue;
                    selectedPlaylist = { ...requestedPlaylist, tracks: queue.map(index => playlist[index]) };
                    selectedAlbum = null;
                    renderTracklist(document.getElementById('sidebar-search')?.value || '');
                    loadTrack(queue[0]);
                }
            }
        } else if (requestedTrackPath) {
            try { sessionStorage.removeItem('wuom-playback-snapshot'); } catch (_) {}
            const requestedIndex = playlist.findIndex(track => track.path === requestedTrackPath);
            if (requestedIndex >= 0) {
                playbackQueue = null;
                selectedPlaylist = null;
                loadTrack(requestedIndex);
            }
        } else {
            let navigationSnapshot = null;
            try {
                navigationSnapshot = JSON.parse(sessionStorage.getItem('wuom-playback-snapshot') || 'null');
                sessionStorage.removeItem('wuom-playback-snapshot');
            } catch (_) {}
            const lastSession = appSettings.lastSession;
            const isRecentSnapshot = navigationSnapshot && Date.now() - Number(navigationSnapshot.savedAt || 0) < 15000;
            const isRecentSettingsNavigation = lastSession?.savedAt && Date.now() - Number(lastSession.savedAt) < 15000;
            const restoreState = isRecentSnapshot ? navigationSnapshot : isRecentSettingsNavigation ? lastSession :
                appSettings.resumeSession !== false ? lastSession : null;
            const shouldResumePlayback = Boolean((isRecentSnapshot && navigationSnapshot.isPlaying) ||
                (isRecentSettingsNavigation && lastSession.wasPlaying));
            if (restoreState?.trackPath) {
                const idx = playlist.findIndex(t => t.path === restoreState.trackPath);
                if (idx !== -1) {
                    currentTrackIndex = idx;
                    syncMiniTrackInfo(playlist[idx]);
                    mainPlayer.src = window.electronAPI.toMediaUrl(playlist[idx].path);
                    updateHeaderCover();
                    lyricsController.setTrack(playlist[idx]);
                    const resumePosition = Number(restoreState.position) || 0;
                    mainPlayer.addEventListener('loadedmetadata', function restorePosition() {
                        mainPlayer.currentTime = Math.min(resumePosition, mainPlayer.duration || resumePosition);
                        mainPlayer.removeEventListener('loadedmetadata', restorePosition);
                        if (shouldResumePlayback) {
                            mainPlayer.play().catch(error => console.error('Could not resume playback:', error));
                        }
                    });
                }
            }
        }
        if (new URLSearchParams(window.location.search).get('view') === 'lyrics') lyricsController.open();
    });

    window.electronAPI.onLibraryUpdated(() => {
        loadLibraryFromDisk();
    });
}

function loadTrack(index) {
    if (index < 0 || index >= playlist.length) return;
    const track = playlist[index];
    syncMiniTrackInfo(track);
    if (!track.path) {
        console.error('Track has no file path, skipping:', track.name);
        return;
    }

    currentTrackIndex = index;
    playbackSequence += 1;
    countedPlaybackSequence = -1;
    notifiedNextSequence = -1;
    scheduledNextTrackIndex = -1;
    mainPlayer.src = window.electronAPI.toMediaUrl(track.path);
    // Send the selected track immediately; the play/metadata events refresh
    // playback timestamps once the media element has resumed and loaded.
    updateDiscordPresence();
    updateHeaderCover();
    lyricsController.setTrack(track);
    
    mainPlayer.play().catch(err => console.error("Playback error:", err));
}

mainPlayer.addEventListener('playing', () => {
    if (currentTrackIndex < 0 || countedPlaybackSequence === playbackSequence) return;
    const track = playlist[currentTrackIndex];
    if (!track) return;
    countedPlaybackSequence = playbackSequence;
    track.playCount = Math.max(0, Number(track.playCount) || 0) + 1;
    renderTopSongs();
    renderTopPlaylists();
    if (window.electronAPI?.recordTrackPlay) {
        window.electronAPI.recordTrackPlay(track.path).then(result => {
            if (result?.success) track.playCount = result.playCount;
            renderTopSongs();
            renderTopPlaylists();
        }).catch(error => console.error('Failed to save track play count:', error));
    }
});

playBtn.addEventListener('click', () => {
    if (playlist.length === 0) return; 

    if (mainPlayer.paused) {
        if (currentTrackIndex === -1) {
            loadTrack(0);
        } else {
            mainPlayer.play();
        }
    } else {
        mainPlayer.pause();
    }
});

mainPlayer.addEventListener('play', () => {
    playIcon.src = '../images/pause.png';
    updateDiscordPresence();
});

mainPlayer.addEventListener('pause', () => {
    playIcon.src = '../images/play.png';
    updateDiscordPresence();
});

function playNext() {
    const queue = playbackQueue || playlist.map((_, index) => index);
    if (queue.length === 0) return;
    const nextIndex = scheduledNextTrackIndex >= 0 && queue.includes(scheduledNextTrackIndex) ? scheduledNextTrackIndex : (() => {
        const queuePosition = queue.indexOf(currentTrackIndex);
        let nextPosition = queuePosition + 1;
        if (isShuffle) return queue[Math.floor(Math.random() * queue.length)];
        if (nextPosition >= queue.length) {
            if (!isRepeatAll) return -1;
            nextPosition = 0;
        }
        return queue[nextPosition];
    })();
    scheduledNextTrackIndex = -1;
    if (nextIndex >= 0) loadTrack(nextIndex);
}

function playPrev() {
    const queue = playbackQueue || playlist.map((_, index) => index);
    if (queue.length === 0) return;
    let previousPosition = queue.indexOf(currentTrackIndex) - 1;
    if (previousPosition < 0) previousPosition = queue.length - 1;
    loadTrack(queue[previousPosition]);
}

function handleTrackEnd() {
    if (isRepeatOne) {
        loadTrack(currentTrackIndex);
    } else {
        playNext();
    }
}

nextBtn.addEventListener('click', playNext);
prevBtn.addEventListener('click', playPrev);

shuffleBtn.addEventListener('click', () => {
    isShuffle = !isShuffle;
    shuffleBtn.classList.toggle('active', isShuffle);
});

repeatAllBtn.addEventListener('click', () => {
    isRepeatAll = !isRepeatAll;
    if (isRepeatAll) {
        isRepeatOne = false;
        repeatOneBtn.classList.remove('active');
    }
    repeatAllBtn.classList.toggle('active', isRepeatAll);
});

repeatOneBtn.addEventListener('click', () => {
    isRepeatOne = !isRepeatOne;
    if (isRepeatOne) {
        isRepeatAll = false;
        repeatAllBtn.classList.remove('active');
    }
    repeatOneBtn.classList.toggle('active', isRepeatOne);
});

mainPlayer.addEventListener('ended', handleTrackEnd);

const hotkeyRepeatTimers = new Map();

function isEditableHotkeyTarget(target) {
    return target instanceof HTMLInputElement ||
           target instanceof HTMLTextAreaElement ||
           target.isContentEditable;
}

function stopHotkeyRepeat(key) {
    const timers = hotkeyRepeatTimers.get(key);
    if (!timers) return;
    clearTimeout(timers.timeout);
    clearInterval(timers.interval);
    hotkeyRepeatTimers.delete(key);
}

function startHotkeyRepeat(key, action) {
    if (hotkeyRepeatTimers.has(key)) return;
    action();
    const timers = { timeout: null, interval: null };
    timers.timeout = setTimeout(() => {
        timers.interval = setInterval(action, 100);
    }, 100);
    hotkeyRepeatTimers.set(key, timers);
}

function togglePlaybackHotkey() {
    if (playlist.length === 0) return;

    if (mainPlayer.paused) {
        if (currentTrackIndex === -1) {
            loadTrack(0);
        } else {
            mainPlayer.play().catch(err => console.error('Playback error:', err));
        }
    } else {
        mainPlayer.pause();
    }
}

function seekHotkey(seconds) {
    if (!mainPlayer.src) return;

    const duration = Number.isFinite(mainPlayer.duration)
        ? mainPlayer.duration
        : Infinity;

    mainPlayer.currentTime = Math.max(
        0,
        Math.min(mainPlayer.currentTime + seconds, duration)
    );
}

function changeVolumeHotkey(delta) {
    const step = parseFloat(volumeSlider?.step) || 0.05;
    const current = mainPlayer.muted ? 0 : mainPlayer.volume;
    const value = Math.max(0, Math.min(1, current + delta * step));

    mainPlayer.volume = value;
    mainPlayer.muted = false;

    if (volumeSlider) {
        volumeSlider.value = value;
    }

    updateMuteIcon();

    if (window.electronAPI && window.electronAPI.saveSettings) {
        window.electronAPI.saveSettings({
            volume: value,
            muted: false
        }).catch(() => {});
    }
}

function isConfiguredBackgroundHotkey(event) {
    if (!appSettings.backgroundHotkeysEnabled) return false;
    let key = event.code === 'Space' ? 'Space' : event.key;
    if (/^Key[A-Z]$/.test(event.code)) key = event.code.slice(3);
    else if (/^Digit[0-9]$/.test(event.code)) key = event.code.slice(5);
    else if (key.startsWith('Arrow')) key = key.slice(5);
    else if (key === ' ') key = 'Space';
    else if (key === 'Enter') key = 'Return';
    const actualKey = String(key).toLowerCase();
    const actualModifiers = [];
    if (event.ctrlKey) actualModifiers.push('control');
    if (event.altKey) actualModifiers.push('alt');
    if (event.shiftKey) actualModifiers.push('shift');
    if (event.metaKey) actualModifiers.push('super');

    return Object.values(appSettings.backgroundHotkeys || {}).some(accelerator => {
        const parts = accelerator.split('+');
        const configuredKey = parts.pop().toLowerCase();
        const configuredModifiers = parts.map(modifier => {
            const normalized = modifier.toLowerCase();
            if (normalized === 'commandorcontrol') {
                return navigator.platform.toLowerCase().includes('mac') ? 'super' : 'control';
            }
            return normalized === 'meta' ? 'super' : normalized;
        }).sort();
        return configuredKey === actualKey &&
            configuredModifiers.join('+') === actualModifiers.sort().join('+');
    });
}

document.addEventListener('keydown', (event) => {
    if (isEditableHotkeyTarget(event.target)) return;
    if (isConfiguredBackgroundHotkey(event)) return;
    if (event.ctrlKey && event.altKey) return;

    if (event.ctrlKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
        event.preventDefault();

        if (!event.repeat) {
            if (event.key === 'ArrowLeft') {
                playPrev();
            } else {
                playNext();
            }
        }

        return;
    }

    if (event.key === ' ') {
        event.preventDefault();

        if (!event.repeat) {
            togglePlaybackHotkey();
        }

        return;
    }

    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();

        startHotkeyRepeat(event.key, () => {
            seekHotkey(event.key === 'ArrowLeft' ? -5 : 5);
        });

        return;
    }

    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        event.preventDefault();

        startHotkeyRepeat(event.key, () => {
            changeVolumeHotkey(event.key === 'ArrowUp' ? 1 : -1);
        });
    }
});

window.electronAPI?.onGlobalPlayerHotkey(action => {
    switch (action) {
        case 'toggle-fullscreen': toggleFullscreenHotkey(); break;
        case 'toggle-playback': togglePlaybackHotkey(); break;
        case 'previous-track': playPrev(); break;
        case 'next-track': playNext(); break;
        case 'seek-back': seekHotkey(-5); break;
        case 'seek-forward': seekHotkey(5); break;
        case 'volume-up': changeVolumeHotkey(1); break;
        case 'volume-down': changeVolumeHotkey(-1); break;
    }
});
window.electronAPI?.onBackgroundHotkeyStatus(status => {
    appSettings.backgroundHotkeysEnabled = status.enabled === true;
});

document.addEventListener('keyup', (event) => {
    if (
        event.key === 'ArrowLeft' ||
        event.key === 'ArrowRight' ||
        event.key === 'ArrowUp' ||
        event.key === 'ArrowDown'
    ) {
        stopHotkeyRepeat(event.key);
    }
});

window.addEventListener('blur', () => {
    hotkeyRepeatTimers.forEach((timers) => {
        clearTimeout(timers.timeout);
        clearInterval(timers.interval);
    });

    hotkeyRepeatTimers.clear();
});

function addTrack(filePath, fileName, data, imageSource, saveToDb = true) {
    if (playlist.find(t => t.path === filePath)) return;

    const trackObj = { path: filePath, name: fileName, data };
    if (imageSource) {
        if (imageSource.startsWith('artwork/')) trackObj.imagePath = imageSource;
        else trackObj.imageUrl = imageSource;
    }
    playlist.push(trackObj);
    renderTracklist();

    if (saveToDb && window.electronAPI) {
        window.electronAPI.saveTrack(trackObj).then(result => {
            if (result.imagePath) {
                trackObj.imagePath = result.imagePath;
                delete trackObj.imageUrl;
                renderTracklist();
            }
        }).catch(err => console.error('Failed to save track:', err));
    }
}

fileUpload.addEventListener('change', (event) => {
    const files = Array.from(event.target.files).filter(file => SUPPORTED_EXTENSIONS.test(file.name));
    if (files.length === 0) return;
    
    files.forEach(file => {
        const filePath = window.electronAPI.getPathForFile(file);
        if (!filePath) {
            console.error('Could not resolve a file path for', file.name);
            return;
        }

        if (/\.wav$/i.test(file.name)) {
            addTrack(filePath, file.name, { title: stripExtension(file.name), artist: '', album: '' }, '', true);
            return;
        }

        window.electronAPI.readMetadata(filePath)
            .then(metadata => addTrack(filePath, file.name, {
                title: metadata.title,
                artist: metadata.artist,
                album: metadata.album
            }, metadata.imagePath || '', true))
            .catch(() => addTrack(filePath, file.name, {}, '', true));
    });
    
    fileUpload.value = '';
});

const eqToggleBtn = document.getElementById('eq-toggle-btn');
const eqPanel = document.getElementById('eq-panel');
const eqBass = document.getElementById('eq-bass');
const eqMid = document.getElementById('eq-mid');
const eqTreble = document.getElementById('eq-treble');
const normalizeToggle = document.getElementById('normalize-toggle');

function applyEqSettings() {
    if (appSettings.eq) {
        if (eqBass) eqBass.value = appSettings.eq.bass ?? 0;
        if (eqMid) eqMid.value = appSettings.eq.mid ?? 0;
        if (eqTreble) eqTreble.value = appSettings.eq.treble ?? 0;
        if (bassFilter) bassFilter.gain.value = appSettings.eq.bass ?? 0;
        if (midFilter) midFilter.gain.value = appSettings.eq.mid ?? 0;
        if (trebleFilter) trebleFilter.gain.value = appSettings.eq.treble ?? 0;
    }
    if (normalizeToggle) normalizeToggle.checked = !!appSettings.normalize;
}

let audioCtx = null;
let bassFilter, midFilter, trebleFilter, compressor, gainNode, sourceNode;

function hasActiveAudioProcessing() {
    return Boolean(normalizeToggle?.checked) ||
        [eqBass, eqMid, eqTreble].some(slider => Math.abs(Number(slider?.value) || 0) > 0.001);
}

function setupAudioGraph() {
    if (audioCtx) return;
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    sourceNode = audioCtx.createMediaElementSource(mainPlayer);

    bassFilter = audioCtx.createBiquadFilter();
    bassFilter.type = 'lowshelf';
    bassFilter.frequency.value = 200;

    bassFilter.gain.value = eqBass ? parseFloat(eqBass.value) : 0;

    midFilter = audioCtx.createBiquadFilter();
    midFilter.type = 'peaking';
    midFilter.frequency.value = 1000;
    midFilter.Q.value = 1;

    midFilter.gain.value = eqMid ? parseFloat(eqMid.value) : 0;

    trebleFilter = audioCtx.createBiquadFilter();
    trebleFilter.type = 'highshelf';
    trebleFilter.frequency.value = 3000;

    trebleFilter.gain.value = eqTreble ? parseFloat(eqTreble.value) : 0;

    compressor = audioCtx.createDynamicsCompressor();
    compressor.threshold.value = -24;
    compressor.knee.value = 30;
    compressor.ratio.value = 12;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.25;

    gainNode = audioCtx.createGain();
    gainNode.gain.value = 1;

    sourceNode.connect(bassFilter);
    bassFilter.connect(midFilter);
    midFilter.connect(trebleFilter);
    trebleFilter.connect(gainNode);
    gainNode.connect(audioCtx.destination);
}

function setNormalization(enabled) {
    if (!audioCtx) return;
    trebleFilter.disconnect();
    if (enabled) {
        trebleFilter.connect(compressor);
        compressor.connect(gainNode);
        gainNode.gain.value = 1.6; // makeup gain
    } else {
        trebleFilter.connect(gainNode);
        gainNode.gain.value = 1;
    }
}
mainPlayer.crossOrigin = 'anonymous';

mainPlayer.addEventListener('play', () => {
    if (!audioCtx && hasActiveAudioProcessing()) {
        setupAudioGraph();
        setNormalization(normalizeToggle ? normalizeToggle.checked : false);
    }
    if (audioCtx?.state === 'suspended') audioCtx.resume();
});

if (eqToggleBtn && eqPanel) {
    eqToggleBtn.addEventListener('click', () => {
        eqPanel.style.display = eqPanel.style.display === 'none' ? 'flex' : 'none';
    });
    document.addEventListener('click', (event) => {
        if (eqPanel.style.display !== 'none' && !eqPanel.contains(event.target) && event.target !== eqToggleBtn) {
            eqPanel.style.display = 'none';
        }
    });
}

function saveEqSettings() {
    if (!window.electronAPI) return;
    window.electronAPI.saveSettings({
        eq: {
            bass: eqBass ? parseFloat(eqBass.value) : 0,
            mid: eqMid ? parseFloat(eqMid.value) : 0,
            treble: eqTreble ? parseFloat(eqTreble.value) : 0
        }
    }).catch(() => {});
}

const updateEqGraph = () => {
    if (!audioCtx && !mainPlayer.paused && hasActiveAudioProcessing()) setupAudioGraph();
    if (bassFilter) bassFilter.gain.value = parseFloat(eqBass?.value) || 0;
    if (midFilter) midFilter.gain.value = parseFloat(eqMid?.value) || 0;
    if (trebleFilter) trebleFilter.gain.value = parseFloat(eqTreble?.value) || 0;
};

if (eqBass) eqBass.addEventListener('input', updateEqGraph);
if (eqMid) eqMid.addEventListener('input', updateEqGraph);
if (eqTreble) eqTreble.addEventListener('input', updateEqGraph);
if (eqBass) eqBass.addEventListener('change', saveEqSettings);
if (eqMid) eqMid.addEventListener('change', saveEqSettings);
if (eqTreble) eqTreble.addEventListener('change', saveEqSettings);
if (normalizeToggle) normalizeToggle.addEventListener('change', () => {
    if (!audioCtx && !mainPlayer.paused && normalizeToggle.checked) setupAudioGraph();
    setNormalization(normalizeToggle.checked);
    if (window.electronAPI) {
        window.electronAPI.saveSettings({ normalize: normalizeToggle.checked }).catch(() => {});
    }
});
