const DEFAULT_COVER = '../images/music.png';
const SUPPORTED_EXTENSIONS = /\.(mp3|wav)$/i;

let playlists = [];
let libraryTracks = [];
let currentPlaylist = null;
let plCurrentTrackIndex = -1;
let lastVolume = 1;
let isShuffle = false;
let isRepeatAll = false;
let isRepeatOne = false;

const gridView = document.getElementById('grid-view');
const detailView = document.getElementById('detail-view');
const playlistScroll = document.getElementById('playlist-scroll');
const openCreateBtn = document.getElementById('open-create-playlist');

const volumeSlider = document.getElementById('volume-slider');
const muteBtn = document.getElementById('mute-btn');
const seekSlider = document.getElementById('seek-slider');
const timeCurrentEl = document.getElementById('time-current');
const timeDurationEl = document.getElementById('time-duration');
let isSeeking = false;
let appSettings = {};
const shuffleBtn = document.getElementById('shuffle-btn');
const repeatAllBtn = document.getElementById('repeat-all-btn');
const repeatOneBtn = document.getElementById('repeat-one-btn');
const createModalBackdrop = document.getElementById('create-modal-backdrop');
const newPlaylistNameInput = document.getElementById('new-playlist-name');
const cancelCreateBtn = document.getElementById('cancel-create-playlist');
const confirmCreateBtn = document.getElementById('confirm-create-playlist');

const backToGridBtn = document.getElementById('back-to-grid');
const detailCoverWrapper = document.getElementById('detail-cover-wrapper');
const detailCoverImg = document.getElementById('detail-cover');
const detailCoverInput = document.getElementById('detail-cover-input');
const detailNameEl = document.getElementById('detail-name');
const deletePlaylistBtn = document.getElementById('delete-playlist-btn');
const plTracklist = document.getElementById('pl-tracklist');

const addExistingBtn = document.getElementById('add-existing-btn');
const detailUploadInput = document.getElementById('detail-upload');

const addSongModalBackdrop = document.getElementById('add-song-modal-backdrop');
const addSongSearch = document.getElementById('add-song-search');
const addSongList = document.getElementById('add-song-list');
const closeAddSongModalBtn = document.getElementById('close-add-song-modal');

const mainPlayer = document.getElementById('main-player');
const playBtn = document.getElementById('play-btn');
const playIcon = document.getElementById('play-icon');
const prevBtn = document.getElementById('prev-btn');
const nextBtn = document.getElementById('next-btn');

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str ?? '';
    return div.innerHTML;
}

function stripExtension(fileName) {
    return fileName.replace(/\.[^/.]+$/, '');
}

function artworkSource(item) {
    if (item?.imageUrl) return item.imageUrl;
    if (item?.imagePath && window.electronAPI?.toArtworkUrl) {
        return window.electronAPI.toArtworkUrl(item.imagePath);
    }
    return DEFAULT_COVER;
}

function playlistCover(playlist) {
    if (playlist.coverImage) return playlist.coverImage;
    if (playlist.coverImagePath && window.electronAPI?.toArtworkUrl) {
        return window.electronAPI.toArtworkUrl(playlist.coverImagePath);
    }
    if (playlist.tracks.length > 0) return artworkSource(playlist.tracks[0]);
    return DEFAULT_COVER;
}


function loadPlaylists() {
    if (!window.electronAPI) return Promise.resolve([]);
    return window.electronAPI.getPlaylists().then(saved => {
        playlists = saved || [];
        renderPlaylistGrid();
        return playlists;
    }).catch(err => {
        console.error('Failed to load playlists:', err);
        return [];
    });
}

function loadLibrary() {
    if (!window.electronAPI) return Promise.resolve([]);
    return window.electronAPI.getPlaylist().then(saved => {
        libraryTracks = (saved || []).filter(t => t.path);
        return libraryTracks;
    }).catch(err => {
        console.error('Failed to load library:', err);
        return [];
    });
}

loadPlaylists();
loadLibrary();

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

if (window.electronAPI && window.electronAPI.getSettings) {
    window.electronAPI.getSettings().then(settings => {
        appSettings = settings || {};
        applyVolumeSettings();
        applyEqSettings();
    }).catch(() => {});
}

if (volumeSlider) {
    volumeSlider.addEventListener('input', () => {
        const value = parseFloat(volumeSlider.value);
        mainPlayer.volume = value;
        mainPlayer.muted = false;
        updateMuteIcon();
        if (window.electronAPI && window.electronAPI.saveSettings) {
            window.electronAPI.saveSettings({ volume: value, muted: false }).catch(() => {});
        }
    });
}

if (muteBtn) {
    muteBtn.addEventListener('click', () => {
        mainPlayer.muted = !mainPlayer.muted;
        updateMuteIcon();
        if (window.electronAPI && window.electronAPI.saveSettings) {
            window.electronAPI.saveSettings({ muted: mainPlayer.muted }).catch(() => {});
        }
    });
}

function renderPlaylistGrid() {
    playlistScroll.innerHTML = '';

    const newCard = document.createElement('div');
    newCard.className = 'pl-card pl-card-new';
    newCard.innerHTML = `
        <div class="pl-card-cover-wrapper">+</div>
        <div class="pl-card-name">New Playlist</div>
    `;
    newCard.addEventListener('click', openCreateModal);
    playlistScroll.appendChild(newCard);

    playlists.forEach(playlist => {
        const card = document.createElement('div');
        card.className = 'pl-card';
        card.innerHTML = `
            <div class="pl-card-cover-wrapper">
                <img src="${playlistCover(playlist)}" alt="${escapeHtml(playlist.name)}">
            </div>
            <div class="pl-card-name">${escapeHtml(playlist.name)}</div>
            <div class="pl-card-count">${playlist.tracks.length} song${playlist.tracks.length === 1 ? '' : 's'}</div>
        `;
        card.addEventListener('click', () => openPlaylistDetail(playlist.id));
        playlistScroll.appendChild(card);
    });
}

function openCreateModal() {
    newPlaylistNameInput.value = '';
    createModalBackdrop.style.display = 'flex';
    newPlaylistNameInput.focus();
}

function closeCreateModal() {
    createModalBackdrop.style.display = 'none';
}

openCreateBtn.addEventListener('click', openCreateModal);
cancelCreateBtn.addEventListener('click', closeCreateModal);
createModalBackdrop.addEventListener('click', (event) => {
    if (event.target === createModalBackdrop) closeCreateModal();
});

confirmCreateBtn.addEventListener('click', createPlaylistFromModal);
newPlaylistNameInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') createPlaylistFromModal();
});

function createPlaylistFromModal() {
    const name = newPlaylistNameInput.value.trim();
    if (!name || !window.electronAPI) return;

    window.electronAPI.createPlaylist(name).then(newPlaylist => {
        playlists.push(newPlaylist);
        closeCreateModal();
        renderPlaylistGrid();
        openPlaylistDetail(newPlaylist.id);
    }).catch(err => console.error('Failed to create playlist:', err));
}


function openPlaylistDetail(playlistId) {
    const playlist = playlists.find(p => p.id === playlistId);
    if (!playlist) return;

    currentPlaylist = playlist;
    plCurrentTrackIndex = -1;
    mainPlayer.pause();
    mainPlayer.removeAttribute('src');
    if (seekSlider) {
        seekSlider.value = 0;
        seekSlider.max = 0;
        seekSlider.style.setProperty('--progress', '0%');
    }
    if (timeCurrentEl) timeCurrentEl.textContent = '0:00';
    if (timeDurationEl) timeDurationEl.textContent = '0:00';

    gridView.style.display = 'none';
    detailView.style.display = 'flex';

    renderDetail();
}

function backToGrid() {
    detailView.style.display = 'none';
    gridView.style.display = 'flex';
    currentPlaylist = null;
    renderPlaylistGrid();
}

backToGridBtn.addEventListener('click', backToGrid);

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

function renderDetail(query = '') {
    if (!currentPlaylist) return;
    detailNameEl.textContent = currentPlaylist.name;
    detailCoverImg.src = playlistCover(currentPlaylist);
    plTracklist.innerHTML = '';
    currentPlaylist.tracks.forEach((track, index) => {
        if (trackMatchesQuery(track, query)) {
            plTracklist.appendChild(createPlaylistTrackElement(track, index));
        }
    });
}

window.applyLibrarySearch = (query) => renderDetail(query);

function createPlaylistTrackElement(track, index) {
    const trackItem = document.createElement('div');
    trackItem.className = 'track-item' + (index === plCurrentTrackIndex ? ' now-playing' : '');

    trackItem.innerHTML = `
        <div class="track-index">${index + 1}</div>
        <div class="track-info-col">
            <div class="track-cover-wrapper">
                <img class="track-cover-img" src="${artworkSource(track)}">
            </div>
            <div class="track-text">
                <span class="track-title">${escapeHtml(track.data?.title || stripExtension(track.name))}</span>
                <span class="track-artist">${escapeHtml(track.data?.artist || 'Unknown Artist')}</span>
            </div>
        </div>
        <div class="track-album">${escapeHtml(track.data?.album || 'Unknown Album')}</div>
        <button class="remove-track-btn" title="Remove from playlist">&#10005;</button>
    `;

    trackItem.addEventListener('click', () => loadPlTrack(index));

    const removeBtn = trackItem.querySelector('.remove-track-btn');
    removeBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        removeTrackFromCurrentPlaylist(index);
    });

    return trackItem;
}

function removeTrackFromCurrentPlaylist(index) {
    if (!currentPlaylist) return;
    const track = currentPlaylist.tracks[index];
    if (!track) return;

    currentPlaylist.tracks.splice(index, 1);

    if (plCurrentTrackIndex === index) {
        mainPlayer.pause();
        mainPlayer.removeAttribute('src');
        mainPlayer.load();
        plCurrentTrackIndex = -1;
        if (seekSlider) {
            seekSlider.value = 0;
            seekSlider.max = 0;
            seekSlider.style.setProperty('--progress', '0%');
        }
        if (timeCurrentEl) timeCurrentEl.textContent = '0:00';
        if (timeDurationEl) timeDurationEl.textContent = '0:00';
    } else if (plCurrentTrackIndex > index) {
        plCurrentTrackIndex -= 1;
    }

    renderDetail();

    if (window.electronAPI) {
        window.electronAPI.removeTrackFromPlaylist(currentPlaylist.id, track.path)
            .catch(err => console.error('Failed to remove track from playlist:', err));
    }
}

detailNameEl.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
        event.preventDefault();
        detailNameEl.blur();
    }
});

detailNameEl.addEventListener('blur', () => {
    if (!currentPlaylist) return;
    const newName = detailNameEl.textContent.trim() || currentPlaylist.name;
    detailNameEl.textContent = newName;
    if (newName === currentPlaylist.name) return;

    currentPlaylist.name = newName;
    if (window.electronAPI) {
        window.electronAPI.renamePlaylist(currentPlaylist.id, newName)
            .catch(err => console.error('Failed to rename playlist:', err));
    }
});

detailCoverWrapper.addEventListener('click', () => detailCoverInput.click());
detailCoverInput.addEventListener('change', (event) => {
    const file = event.target.files[0];
    detailCoverInput.value = '';
    if (!file || !currentPlaylist) return;

    const reader = new FileReader();
    reader.onload = () => {
        const dataUrl = reader.result;
        currentPlaylist.coverImage = dataUrl;
        detailCoverImg.src = dataUrl;

        if (window.electronAPI) {
            window.electronAPI.setPlaylistCover(currentPlaylist.id, dataUrl)
                .then(result => {
                    currentPlaylist.coverImagePath = result.imagePath || null;
                    delete currentPlaylist.coverImage;
                    detailCoverImg.src = playlistCover(currentPlaylist);
                    renderPlaylistGrid();
                })
                .catch(err => console.error('Failed to save playlist cover:', err));
        }
    };
    reader.onerror = () => console.error('Failed to read cover image file');
    reader.readAsDataURL(file);
});

deletePlaylistBtn.addEventListener('click', () => {
    if (!currentPlaylist) return;
    if (!confirm(`Delete "${currentPlaylist.name}"? This can't be undone.`)) return;

    const playlistId = currentPlaylist.id;
    if (window.electronAPI) {
        window.electronAPI.deletePlaylist(playlistId)
            .catch(err => console.error('Failed to delete playlist:', err));
    }
    playlists = playlists.filter(p => p.id !== playlistId);
    backToGrid();
});


function updateNowPlayingHighlight() {
    Array.from(plTracklist.children).forEach((el, i) => {
        el.classList.toggle('now-playing', i === plCurrentTrackIndex);
    });
}

function loadPlTrack(index) {
    if (!currentPlaylist || index < 0 || index >= currentPlaylist.tracks.length) return;
    const track = currentPlaylist.tracks[index];
    if (!track.path || !window.electronAPI) return;

    plCurrentTrackIndex = index;
    mainPlayer.src = window.electronAPI.toMediaUrl(track.path);
    mainPlayer.play().catch(err => console.error('Playback error:', err));
    updateNowPlayingHighlight();
}

playBtn.addEventListener('click', () => {
    if (!currentPlaylist || currentPlaylist.tracks.length === 0) return;

    if (mainPlayer.paused) {
        if (plCurrentTrackIndex === -1) {
            loadPlTrack(0);
        } else {
            mainPlayer.play();
        }
    } else {
        mainPlayer.pause();
    }
});

mainPlayer.addEventListener('play', () => { playIcon.src = '../images/pause.png'; });
mainPlayer.addEventListener('pause', () => { playIcon.src = '../images/play.png'; });


function formatTime(seconds) {
    if (!isFinite(seconds) || seconds < 0) seconds = 0;
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

mainPlayer.addEventListener('loadedmetadata', () => {
    if (seekSlider) {
        seekSlider.max = mainPlayer.duration || 0;
        seekSlider.value = 0;
        seekSlider.style.setProperty('--progress', '0%');
    }
    if (timeDurationEl) timeDurationEl.textContent = formatTime(mainPlayer.duration);
});

mainPlayer.addEventListener('timeupdate', () => {
    if (!isSeeking) {
        if (seekSlider) seekSlider.value = mainPlayer.currentTime;
        if (timeCurrentEl) timeCurrentEl.textContent = formatTime(mainPlayer.currentTime);
    }
    const percentage = mainPlayer.duration
        ? (mainPlayer.currentTime / mainPlayer.duration) * 100
        : 0;
    if (seekSlider) seekSlider.style.setProperty('--progress', `${percentage}%`);
});

mainPlayer.addEventListener('ended', () => {
    if (seekSlider) {
        seekSlider.value = 0;
        seekSlider.style.setProperty('--progress', '0%');
    }
    if (timeCurrentEl) timeCurrentEl.textContent = '0:00';
});

if (seekSlider) {
    // Live-preview the time label while dragging without fighting
    // 'timeupdate', then actually seek once the user releases the handle
    // (or clicks a new spot, which also fires 'change').
    const startSeeking = () => { isSeeking = true; };
    const commitSeek = () => {
        mainPlayer.currentTime = parseFloat(seekSlider.value);
        isSeeking = false;
        const percentage = mainPlayer.duration
            ? (mainPlayer.currentTime / mainPlayer.duration) * 100
            : 0;
        seekSlider.style.setProperty('--progress', `${percentage}%`);
    };
    seekSlider.addEventListener('mousedown', startSeeking);
    seekSlider.addEventListener('touchstart', startSeeking);
    seekSlider.addEventListener('input', () => {
        const value = parseFloat(seekSlider.value);
        if (timeCurrentEl) timeCurrentEl.textContent = formatTime(value);
        const percentage = mainPlayer.duration ? (value / mainPlayer.duration) * 100 : 0;
        seekSlider.style.setProperty('--progress', `${percentage}%`);
    });
    seekSlider.addEventListener('change', commitSeek);
    seekSlider.addEventListener('mouseup', commitSeek);
    seekSlider.addEventListener('touchend', commitSeek);
}

function plPlayNext() {
    if (!currentPlaylist || currentPlaylist.tracks.length === 0) return;
    let nextIndex;
    if (isShuffle) {
        nextIndex = Math.floor(Math.random() * currentPlaylist.tracks.length);
    } else {
        nextIndex = plCurrentTrackIndex + 1;
        if (nextIndex >= currentPlaylist.tracks.length) {
            if (isRepeatAll) {
                nextIndex = 0;
            } else {
                return;
            }
        }
    }
    loadPlTrack(nextIndex);
}

function plPlayPrev() {
    if (!currentPlaylist || currentPlaylist.tracks.length === 0) return;
    let prevIndex = plCurrentTrackIndex - 1;
    if (prevIndex < 0) prevIndex = currentPlaylist.tracks.length - 1;
    loadPlTrack(prevIndex);
}

function handlePlTrackEnd() {
    if (isRepeatOne) {
        loadPlTrack(plCurrentTrackIndex);
    } else {
        plPlayNext();
    }
}

nextBtn.addEventListener('click', plPlayNext);
prevBtn.addEventListener('click', plPlayPrev);
mainPlayer.addEventListener('ended', handlePlTrackEnd);

shuffleBtn.addEventListener('click', () => {
    isShuffle = !isShuffle;
    shuffleBtn.classList.toggle('active', isShuffle);
});

// Repeat All mode toggle
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

const hotkeyRepeatTimers = new Map();

function isEditableHotkeyTarget(target) {
    return target instanceof HTMLInputElement ||
           target instanceof HTMLTextAreaElement ||
           target instanceof HTMLSelectElement ||
           target.isContentEditable ||
           target.closest?.('[contenteditable="true"]');
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
    if (!currentPlaylist || currentPlaylist.tracks.length === 0) return;

    if (mainPlayer.paused) {
        if (plCurrentTrackIndex === -1) {
            loadPlTrack(0);
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

document.addEventListener('keydown', (event) => {
    if (isEditableHotkeyTarget(event.target)) return;

    if (event.ctrlKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
        event.preventDefault();

        if (!event.repeat) {
            if (event.key === 'ArrowLeft') {
                plPlayPrev();
            } else {
                plPlayNext();
            }
        }

        return;
    }

    if (event.key === ' ' || event.code === 'Space') {
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
}, true);

document.addEventListener('keyup', (event) => {
    if (
        event.key === 'ArrowLeft' ||
        event.key === 'ArrowRight' ||
        event.key === 'ArrowUp' ||
        event.key === 'ArrowDown'
    ) {
        stopHotkeyRepeat(event.key);
    }
}, true);

window.addEventListener('blur', () => {
    hotkeyRepeatTimers.forEach((timers) => {
        clearTimeout(timers.timeout);
        clearInterval(timers.interval);
    });

    hotkeyRepeatTimers.clear();
});

addExistingBtn.addEventListener('click', () => {
    if (!currentPlaylist) return;
    addSongSearch.value = '';
    addSongModalBackdrop.style.display = 'flex';
    loadLibrary().then(renderAddSongList);
});

closeAddSongModalBtn.addEventListener('click', () => {
    addSongModalBackdrop.style.display = 'none';
});

addSongModalBackdrop.addEventListener('click', (event) => {
    if (event.target === addSongModalBackdrop) addSongModalBackdrop.style.display = 'none';
});

addSongSearch.addEventListener('input', () => renderAddSongList());

function renderAddSongList() {
    if (!currentPlaylist) return;
    const query = addSongSearch.value.trim().toLowerCase();

    addSongList.innerHTML = '';

    const filtered = libraryTracks.filter(track => {
        if (!query) return true;
        const title = (track.data?.title || stripExtension(track.name)).toLowerCase();
        const artist = (track.data?.artist || '').toLowerCase();
        return title.includes(query) || artist.includes(query);
    });

    if (filtered.length === 0) {
        addSongList.innerHTML = '<div class="pl-empty-hint">No songs found. Upload some from the Home tab first.</div>';
        return;
    }

    filtered.forEach(track => {
        const alreadyAdded = currentPlaylist.tracks.some(t => t.path === track.path);

        const row = document.createElement('div');
        row.className = 'pl-library-row';
        row.innerHTML = `
            <img src="${artworkSource(track)}">
            <div class="pl-library-row-text">
                <span class="title">${escapeHtml(track.data?.title || stripExtension(track.name))}</span>
                <span class="artist">${escapeHtml(track.data?.artist || 'Unknown Artist')}</span>
            </div>
            <button class="pl-library-add-btn ${alreadyAdded ? 'added' : ''}">${alreadyAdded ? 'Added' : 'Add'}</button>
        `;

        const addBtn = row.querySelector('.pl-library-add-btn');
        if (!alreadyAdded) {
            addBtn.addEventListener('click', () => addExistingTrackToPlaylist(track, addBtn));
        }

        addSongList.appendChild(row);
    });
}

function addExistingTrackToPlaylist(track, buttonEl) {
    if (!currentPlaylist || !window.electronAPI) return;

    currentPlaylist.tracks.push({
        path: track.path,
        name: track.name,
        data: track.data || {},
        imagePath: track.imagePath || '',
        imageUrl: track.imageUrl || ''
    });
    renderDetail();

    if (buttonEl) {
        buttonEl.textContent = 'Added';
        buttonEl.classList.add('added');
        buttonEl.replaceWith(buttonEl.cloneNode(true)); // strip the click handler
    }

    window.electronAPI.addTrackToPlaylist(currentPlaylist.id, track)
        .then(result => {
            const addedTrack = currentPlaylist?.tracks.find(item => item.path === track.path);
            if (addedTrack && result.imagePath) {
                addedTrack.imagePath = result.imagePath;
                delete addedTrack.imageUrl;
                renderDetail();
            }
        })
        .catch(err => console.error('Failed to add track to playlist:', err));
}


detailUploadInput.addEventListener('change', (event) => {
    if (!currentPlaylist) return;
    const files = Array.from(event.target.files).filter(file => SUPPORTED_EXTENSIONS.test(file.name));
    detailUploadInput.value = '';
    if (files.length === 0) return;

    files.forEach(file => {
        const filePath = window.electronAPI.getPathForFile(file);
        if (!filePath) {
            console.error('Could not resolve a file path for', file.name);
            return;
        }

        if (/\.wav$/i.test(file.name)) {
            saveAndAttachTrack(filePath, file.name, { title: stripExtension(file.name), artist: '', album: '' }, '');
            return;
        }

        jsmediatags.read(file, {
            onSuccess: function (tag) {
                const data = tag.tags;
                let imageUrl = '';

                if (data.picture) {
                    const { data: pictureData, format } = data.picture;
                    let base64String = '';
                    for (let i = 0; i < pictureData.length; i++) {
                        base64String += String.fromCharCode(pictureData[i]);
                    }
                    imageUrl = `data:${format};base64,${window.btoa(base64String)}`;
                }

                const cleanData = {
                    title: data.title,
                    artist: data.artist,
                    album: data.album
                };

                saveAndAttachTrack(filePath, file.name, cleanData, imageUrl);
            },
            onError: function () {
                saveAndAttachTrack(filePath, file.name, {}, '');
            }
        });
    });
});

function saveAndAttachTrack(filePath, fileName, data, imageUrl) {
    if (!currentPlaylist || !window.electronAPI) return;
    if (libraryTracks.find(t => t.path === filePath)) {
        const existing = libraryTracks.find(t => t.path === filePath);
        addExistingTrackToPlaylist(existing, null);
        return;
    }

    const trackObj = { path: filePath, name: fileName, data, imageUrl: imageUrl || '' };

    window.electronAPI.saveTrack(trackObj)
        .then(result => {
            if (result.imagePath) {
                trackObj.imagePath = result.imagePath;
                delete trackObj.imageUrl;
            }
            libraryTracks.push(trackObj);
            currentPlaylist.tracks.push({ ...trackObj });
            renderDetail();
            return window.electronAPI.addTrackToPlaylist(currentPlaylist.id, trackObj);
        })
        .then(result => {
            const addedTrack = currentPlaylist?.tracks.find(item => item.path === filePath);
            if (addedTrack && result.imagePath) {
                addedTrack.imagePath = result.imagePath;
                delete addedTrack.imageUrl;
                renderDetail();
            }
        })
        .catch(err => console.error('Failed to add uploaded track:', err));
}

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
        gainNode.gain.value = 1.6; 
    } else {
        trebleFilter.connect(gainNode);
        gainNode.gain.value = 1;
    }
}
mainPlayer.crossOrigin = 'anonymous';

mainPlayer.addEventListener('play', () => {
    if (!audioCtx) {
        setupAudioGraph();
        setNormalization(normalizeToggle ? normalizeToggle.checked : false);
    }
    if (audioCtx.state === 'suspended') audioCtx.resume();
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

if (eqBass) eqBass.addEventListener('input', () => { if (bassFilter) bassFilter.gain.value = parseFloat(eqBass.value); });
if (eqMid) eqMid.addEventListener('input', () => { if (midFilter) midFilter.gain.value = parseFloat(eqMid.value); });
if (eqTreble) eqTreble.addEventListener('input', () => { if (trebleFilter) trebleFilter.gain.value = parseFloat(eqTreble.value); });
if (eqBass) eqBass.addEventListener('change', saveEqSettings);
if (eqMid) eqMid.addEventListener('change', saveEqSettings);
if (eqTreble) eqTreble.addEventListener('change', saveEqSettings);
if (normalizeToggle) normalizeToggle.addEventListener('change', () => {
    setNormalization(normalizeToggle.checked);
    if (window.electronAPI) {
        window.electronAPI.saveSettings({ normalize: normalizeToggle.checked }).catch(() => {});
    }
});
