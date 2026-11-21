 (function initializePlaylistsView() {
const { DEFAULT_COVER, escapeHtml, stripExtension, artworkSource, setLazyArtwork, clearLazyArtwork, formatTime } = window.musicCommon;

let playlists = [];
let libraryTracks = [];
let currentPlaylist = null;
let playlistDragTrackPath = null;
let suppressPlaylistClickUntil = 0;
let playlistSortMode = (() => {
    try { return localStorage.getItem('music-playlist-sort') || 'custom'; }
    catch (_) { return 'custom'; }
})();

const gridView = document.getElementById('grid-view');
const detailView = document.getElementById('detail-view');
const playlistScroll = document.getElementById('playlist-scroll');
const playlistTotalLabel = document.getElementById('playlist-total-label');
const playlistSortSelect = document.getElementById('playlist-sort');
const openCreateBtn = document.getElementById('open-create-playlist');
const createModalBackdrop = document.getElementById('create-modal-backdrop');
const newPlaylistNameInput = document.getElementById('new-playlist-name');
const cancelCreateBtn = document.getElementById('cancel-create-playlist');
const confirmCreateBtn = document.getElementById('confirm-create-playlist');
const backToGridBtn = document.getElementById('back-to-grid');
const detailCoverWrapper = document.getElementById('detail-cover-wrapper');
const detailCoverImg = document.getElementById('detail-cover');
const detailCoverInput = document.getElementById('detail-cover-input');
const detailNameEl = document.getElementById('detail-name');
const detailSummary = document.getElementById('detail-summary');
const playPlaylistBtn = document.getElementById('play-playlist-btn');
const deletePlaylistBtn = document.getElementById('delete-playlist-btn');
const plTracklist = document.getElementById('pl-tracklist');
const playlistEmptyState = document.getElementById('playlist-empty-state');
const addExistingBtn = document.getElementById('add-existing-btn');
const detailUploadInput = document.getElementById('detail-upload');
const addSongModalBackdrop = document.getElementById('add-song-modal-backdrop');
const addSongSearch = document.getElementById('add-song-search');
const addSongList = document.getElementById('add-song-list');
const closeAddSongModalBtn = document.getElementById('close-add-song-modal');
const playlistTrackVirtualList = window.musicCommon.createVirtualList({
    scrollElement: plTracklist?.closest('.tracklist-container'),
    contentElement: plTracklist,
    rowHeight: 64,
    renderItem: index => createPlaylistTrackElement(currentPlaylist?.tracks[index], index)
});
const addSongVirtualList = window.musicCommon.createVirtualList({
    scrollElement: addSongList,
    contentElement: addSongList,
    rowHeight: 66,
    renderItem: index => createAddSongRow(libraryTracks[index])
});

function getPlayingTrack() { return window.musicPlayer?.getCurrentTrack?.() || null; }
function isTrackPlaying(track) { return Boolean(track?.path && getPlayingTrack()?.path === track.path); }
function isCurrentPlaylistQueue() {
    const activeQueue = window.musicPlayer?.getQueuePaths?.();
    return Boolean(currentPlaylist && activeQueue && activeQueue.length === currentPlaylist.tracks.length &&
        activeQueue.every((trackPath, index) => trackPath === currentPlaylist.tracks[index]?.path));
}

const removeTrackChangeListener = window.musicPlayer?.onTrackChange(updateNowPlayingHighlight);

function renderSidebarShortcuts() {
    window.musicCommon.renderMostPlayedSongs(libraryTracks, track => {
        window.navigateApp(`persistent.html?view=home&play=${encodeURIComponent(track.path)}`);
    });
    if (window.electronAPI?.getPlaylists) {
        window.electronAPI.getPlaylists().then(saved => {
            window.musicCommon.renderMostPlayedPlaylists(libraryTracks, saved || [], playlist => {
                window.navigateApp(`persistent.html?view=home&playlist=${encodeURIComponent(playlist.id)}`);
            });
        }).catch(error => console.error('Could not load most played playlists:', error));
    }
}

function playlistCover(playlist) {
    if (playlist.coverImage) return playlist.coverImage;
    if (playlist.coverImagePath && window.electronAPI?.toArtworkUrl) {
        return window.electronAPI.toArtworkUrl(playlist.coverImagePath, 'cover');
    }
    if (playlist.tracks.length > 0) return artworkSource(playlist.tracks[0], 'cover');
    return DEFAULT_COVER;
}

function playlistDuration(tracks = []) {
    const known = tracks.reduce((summary, track) => {
        const seconds = Number(track.data?.duration);
        if (Number.isFinite(seconds) && seconds > 0) {
            summary.seconds += seconds;
            summary.count += 1;
        }
        return summary;
    }, { seconds: 0, count: 0 });
    if (!known.count) return 'time unavailable';
    const minutes = Math.round(known.seconds / 60);
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    const label = hours ? `${hours} hr${hours === 1 ? '' : 's'}${remainingMinutes ? ` ${remainingMinutes} min` : ''}` : `${minutes} min`;
    return `${known.count < tracks.length ? '~' : ''}${label}`;
}

function playlistDurationSeconds(tracks = []) {
    return tracks.reduce((total, track) => {
        const seconds = Number(track.data?.duration);
        return total + (Number.isFinite(seconds) && seconds > 0 ? seconds : 0);
    }, 0);
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
        renderSidebarShortcuts();
        return libraryTracks;
    }).catch(err => {
        console.error('Failed to load library:', err);
        return [];
    });
}

loadPlaylists();
loadLibrary();

window.addEventListener('music-playlist-track-added', event => {
    const playlistId = event.detail?.playlistId;
    const activePlaylistId = currentPlaylist?.id;
    loadPlaylists().then(saved => {
        if (activePlaylistId !== playlistId || currentPlaylist?.id !== activePlaylistId) return;
        currentPlaylist = saved.find(item => item.id === playlistId) || currentPlaylist;
        renderDetail();
    });
});

window.addEventListener('music-track-duration-updated', event => {
    const { path, duration } = event.detail || {};
    if (!path || !(Number(duration) > 0)) return;
    [libraryTracks, ...playlists.map(playlist => playlist.tracks || [])].forEach(tracks => {
        const track = tracks.find(item => item.path === path);
        if (!track) return;
        track.data = track.data || {};
        track.data.duration = Number(duration);
    });
    if (currentPlaylist) {
        const track = currentPlaylist.tracks.find(item => item.path === path);
        if (track) {
            track.data = track.data || {};
            track.data.duration = Number(duration);
            if (detailView.style.display !== 'none') {
                const row = [...plTracklist.querySelectorAll('.track-item')].find(item => item.dataset.trackPath === path);
                const durationCell = row?.querySelector('.track-duration');
                if (durationCell) durationCell.textContent = formatTime(Number(duration));
                const total = currentPlaylist.tracks?.length || 0;
                if (detailSummary) detailSummary.textContent = `${total} song${total === 1 ? '' : 's'} · ${playlistDuration(currentPlaylist.tracks || [])}`;
            }
        }
    }
    if (gridView.style.display !== 'none') {
        if (playlistSortMode === 'duration') renderPlaylistGrid();
        else updatePlaylistGridDurations();
    }
});

function updatePlaylistGridDurations() {
    const allTracks = playlists.flatMap(playlist => playlist.tracks || []);
    const songTotal = allTracks.length;
    if (playlistTotalLabel) playlistTotalLabel.textContent = `${playlists.length} playlist${playlists.length === 1 ? '' : 's'} · ${songTotal} song${songTotal === 1 ? '' : 's'} · ${playlistDuration(allTracks)}`;
    playlistScroll?.querySelectorAll('.pl-card[data-playlist-id]').forEach(card => {
        const playlist = playlists.find(item => String(item.id) === card.dataset.playlistId);
        if (!playlist) return;
        const count = playlist.tracks?.length || 0;
        const label = card.querySelector('.pl-card-count');
        if (label) label.textContent = `${count} song${count === 1 ? '' : 's'} · ${playlistDuration(playlist.tracks || [])}`;
    });
}

playlistSortSelect?.addEventListener('change', () => {
    playlistSortMode = playlistSortSelect.value;
    try { localStorage.setItem('music-playlist-sort', playlistSortMode); } catch (_) {}
    renderPlaylistGrid();
});
if (playlistSortSelect) {
    playlistSortSelect.value = playlistSortMode;
    playlistSortSelect.dispatchEvent(new Event('app-select-sync'));
}

function renderPlaylistGrid() {
    clearLazyArtwork(playlistScroll);
    playlistScroll.innerHTML = '';
    const allTracks = playlists.flatMap(playlist => playlist.tracks || []);
    const songTotal = allTracks.length;
    if (playlistTotalLabel) {
        playlistTotalLabel.textContent = `${playlists.length} playlist${playlists.length === 1 ? '' : 's'} · ${songTotal} song${songTotal === 1 ? '' : 's'} · ${playlistDuration(allTracks)}`;
    }

    const newCard = document.createElement('div');
    newCard.className = 'pl-card pl-card-new';
    newCard.innerHTML = `
        <div class="pl-card-cover-wrapper">+</div>
        <div class="pl-card-name">New Playlist</div>
    `;
    makeCardKeyboardAccessible(newCard);
    newCard.addEventListener('click', openCreateModal);
    playlistScroll.appendChild(newCard);

    const sortedPlaylists = [...playlists].sort((left, right) => {
        if (playlistSortMode === 'name') return String(left.name || '').localeCompare(String(right.name || ''), undefined, { sensitivity: 'base' });
        if (playlistSortMode === 'tracks') return (right.tracks?.length || 0) - (left.tracks?.length || 0);
        if (playlistSortMode === 'duration') return playlistDurationSeconds(right.tracks || []) - playlistDurationSeconds(left.tracks || []);
        if (playlistSortMode === 'newest') return (Number(right.createdAt) || 0) - (Number(left.createdAt) || 0);
        return 0;
    });
    sortedPlaylists.forEach(playlist => {
        const card = document.createElement('div');
        card.className = 'pl-card';
        card.dataset.playlistId = String(playlist.id);
        const trackCount = playlist.tracks?.length || 0;
        card.innerHTML = `
            <div class="pl-card-cover-wrapper">
                <img alt="${escapeHtml(playlist.name)}" loading="lazy" decoding="async">
                <button class="pl-card-play" type="button" aria-label="Play ${escapeHtml(playlist.name)}" title="Play playlist"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 5 12 7-12 7z"></path></svg></button>
            </div>
            <div class="pl-card-name">${escapeHtml(playlist.name)}</div>
            <div class="pl-card-count">${trackCount} song${trackCount === 1 ? '' : 's'} <span aria-hidden="true">·</span> ${escapeHtml(playlistDuration(playlist.tracks || []))}</div>
        `;
        makeCardKeyboardAccessible(card);
        card.addEventListener('click', () => openPlaylistDetail(playlist.id));
        const playButton = card.querySelector('.pl-card-play');
        playButton.disabled = trackCount === 0;
        playButton.addEventListener('click', event => {
            event.stopPropagation();
            if (trackCount) window.musicPlayer?.playQueue(playlist.tracks, 0, { selectedPlaylist: playlist });
        });
        setLazyArtwork(card.querySelector('img'), playlistCover(playlist));
        playlistScroll.appendChild(card);
    });
}

function makeCardKeyboardAccessible(card) {
    card.setAttribute('role', 'button');
    card.tabIndex = 0;
    card.addEventListener('keydown', event => {
        if (event.target.closest('button')) return;
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        card.click();
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
    gridView.style.display = 'none';
    detailView.style.display = 'flex';

    renderDetail();
    updateNowPlayingHighlight();
}

function backToGrid() {
    detailView.style.display = 'none';
    gridView.style.display = 'flex';
    playlistTrackVirtualList?.setItems([]);
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
    const total = currentPlaylist.tracks?.length || 0;
    if (detailSummary) detailSummary.textContent = `${total} song${total === 1 ? '' : 's'} · ${playlistDuration(currentPlaylist.tracks || [])}`;
    if (playPlaylistBtn) {
        playPlaylistBtn.disabled = total === 0;
        playPlaylistBtn.title = total ? 'Play playlist' : 'Add songs before playing';
    }
    setLazyArtwork(detailCoverImg, playlistCover(currentPlaylist));
    const visibleIndices = [];
    currentPlaylist.tracks.forEach((track, index) => {
        if (trackMatchesQuery(track, query)) visibleIndices.push(index);
    });
    playlistTrackVirtualList?.setItems(visibleIndices);
    if (playlistEmptyState) {
        playlistEmptyState.hidden = visibleIndices.length > 0;
        playlistEmptyState.replaceChildren();
        if (!visibleIndices.length) {
            const title = document.createElement('strong');
            const message = document.createElement('span');
            title.textContent = currentPlaylist.tracks.length ? 'No songs found' : 'This playlist is empty';
            message.textContent = currentPlaylist.tracks.length
                ? 'Try a different title, artist, or album.'
                : 'Add songs from your library or upload music to get started.';
            playlistEmptyState.append(title, message);
            if (!currentPlaylist.tracks.length) {
                const addButton = document.createElement('button');
                addButton.type = 'button';
                addButton.className = 'upload-btn';
                addButton.textContent = 'Add existing songs';
                addButton.addEventListener('click', () => addExistingBtn?.click());
                playlistEmptyState.append(addButton);
            }
        }
    }
}

playPlaylistBtn?.addEventListener('click', () => {
    if (currentPlaylist?.tracks?.length) {
        window.musicPlayer?.playQueue(currentPlaylist.tracks, 0, { selectedPlaylist: currentPlaylist });
    }
});

function reorderPlaylistTrack(sourcePath, targetPath) {
    if (!currentPlaylist || !sourcePath || !targetPath || sourcePath === targetPath) return;
    const wasCurrentQueue = isCurrentPlaylistQueue();
    const sourceIndex = currentPlaylist.tracks.findIndex(track => track.path === sourcePath);
    const targetIndex = currentPlaylist.tracks.findIndex(track => track.path === targetPath);
    if (sourceIndex < 0 || targetIndex < 0) return;
    const playingPath = getPlayingTrack()?.path;
    const [track] = currentPlaylist.tracks.splice(sourceIndex, 1);
    currentPlaylist.tracks.splice(sourceIndex < targetIndex ? targetIndex - 1 : targetIndex, 0, track);
    if (wasCurrentQueue) window.musicPlayer?.setQueue(currentPlaylist.tracks);
    renderDetail(document.getElementById('sidebar-search')?.value || '');
    updateNowPlayingHighlight();
    window.electronAPI?.reorderPlaylistTracks(currentPlaylist.id, currentPlaylist.tracks.map(item => item.path))
        .then(result => { if (!result?.success) console.error('Could not save playlist order:', result?.error); })
        .catch(error => console.error('Could not save playlist order:', error));
}

window.applyPlaylistSearch = query => renderDetail(query);

function createPlaylistTrackElement(track, index) {
    const trackItem = document.createElement('div');
    trackItem.className = 'track-item' + (isTrackPlaying(track) ? ' now-playing' : '');
    trackItem.draggable = true;
    trackItem.dataset.trackPath = track.path;

    trackItem.innerHTML = `
        <div class="track-index">${index + 1}</div>
        <div class="track-info-col">
            <div class="track-cover-wrapper">
                <img class="track-cover-img" loading="lazy" decoding="async">
            </div>
            <div class="track-text">
                <span class="track-title">${escapeHtml(track.data?.title || stripExtension(track.name))}</span>
                <span class="track-artist">${escapeHtml(track.data?.artist || 'Unknown Artist')}</span>
            </div>
        </div>
        <div class="track-album">${escapeHtml(track.data?.album || 'Unknown Album')}</div>
        <div class="track-duration" title="Track length">${Number(track.data?.duration) > 0 ? formatTime(Number(track.data.duration)) : '—'}</div>
        <button class="remove-track-btn" title="Remove from playlist">&#10005;</button>
    `;

    setLazyArtwork(trackItem.querySelector('.track-cover-img'), artworkSource(track, 'thumb'));

    trackItem.addEventListener('click', event => {
        if (Date.now() < suppressPlaylistClickUntil) { event.preventDefault(); return; }
        if (event.detail > 1) return;
        playPlaylistTrack(index);
    });
    trackItem.addEventListener('dblclick', event => {
        if (event.target.closest('button, input, [contenteditable="true"]')) return;
        if (!isTrackPlaying(currentPlaylist?.tracks[index])) playPlaylistTrack(index);
        window.musicPlayer?.enterFullscreen?.();
    });
    trackItem.addEventListener('dragstart', event => {
        if (event.target.closest('button, input, [contenteditable="true"], .track-cover-wrapper')) {
            event.preventDefault();
            return;
        }
        playlistDragTrackPath = track.path;
        suppressPlaylistClickUntil = Date.now() + 600;
        trackItem.classList.add('is-dragging');
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', track.path);
    });
    trackItem.addEventListener('dragover', event => {
        if (!playlistDragTrackPath) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        trackItem.classList.add('is-drop-target');
    });
    trackItem.addEventListener('dragleave', () => trackItem.classList.remove('is-drop-target'));
    trackItem.addEventListener('drop', event => {
        event.preventDefault();
        trackItem.classList.remove('is-drop-target');
        const sourcePath = event.dataTransfer.getData('text/plain') || playlistDragTrackPath;
        reorderPlaylistTrack(sourcePath, track.path);
    });
    trackItem.addEventListener('dragend', () => {
        playlistDragTrackPath = null;
        trackItem.classList.remove('is-dragging');
        document.querySelectorAll('.track-item.is-drop-target').forEach(element => element.classList.remove('is-drop-target'));
    });

    const removeBtn = trackItem.querySelector('.remove-track-btn');
    removeBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        removeTrackFromCurrentPlaylist(index);
    });

    return trackItem;
}

function removeTrackFromCurrentPlaylist(index) {
    if (!currentPlaylist) return;
    const wasCurrentQueue = isCurrentPlaylistQueue();
    const track = currentPlaylist.tracks[index];
    if (!track) return;

    currentPlaylist.tracks.splice(index, 1);
    if (wasCurrentQueue) window.musicPlayer?.setQueue(currentPlaylist.tracks);
    renderDetail();
    updateNowPlayingHighlight();

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
                    setLazyArtwork(detailCoverImg, playlistCover(currentPlaylist));
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
    if (isCurrentPlaylistQueue()) window.musicPlayer?.setQueue(null);
    if (window.electronAPI) {
        window.electronAPI.deletePlaylist(playlistId)
            .catch(err => console.error('Failed to delete playlist:', err));
    }
    playlists = playlists.filter(p => p.id !== playlistId);
    backToGrid();
});


function updateNowPlayingHighlight() {
    const playingPath = getPlayingTrack()?.path;
    plTracklist.querySelectorAll('.track-item').forEach(element => {
        element.classList.toggle('now-playing', Boolean(playingPath && element.dataset.trackPath === playingPath));
    });
}

function playPlaylistTrack(index) {
    if (!currentPlaylist || index < 0 || index >= currentPlaylist.tracks.length) return;
    window.musicPlayer?.playQueue(currentPlaylist.tracks, index);
}

window.applyPlaylistSearch = query => renderDetail(query);
window.onAppViewChanged = page => {
    if (page !== 'playlists' || currentPlaylist) return;
    detailView.style.display = 'none';
    gridView.style.display = 'flex';
    renderPlaylistGrid();
};

addExistingBtn.addEventListener('click', () => {
    if (!currentPlaylist) return;
    addSongSearch.value = '';
    addSongModalBackdrop.style.display = 'flex';
    loadLibrary().then(renderAddSongList);
});

function closeAddSongModal() {
    addSongModalBackdrop.style.display = 'none';
    addSongVirtualList?.setItems([]);
}

closeAddSongModalBtn.addEventListener('click', closeAddSongModal);

addSongModalBackdrop.addEventListener('click', (event) => {
    if (event.target === addSongModalBackdrop) closeAddSongModal();
});

addSongSearch.addEventListener('input', () => renderAddSongList());

function renderAddSongList() {
    if (!currentPlaylist) return;
    const query = addSongSearch.value.trim().toLowerCase();

    const filtered = libraryTracks.reduce((indexes, track, index) => {
        if (!query) {
            indexes.push(index);
            return indexes;
        }
        const title = (track.data?.title || stripExtension(track.name)).toLowerCase();
        const artist = (track.data?.artist || '').toLowerCase();
        const album = (track.data?.album || '').toLowerCase();
        const fileName = (track.name || '').toLowerCase();
        if (title.includes(query) || artist.includes(query) || album.includes(query) || fileName.includes(query)) indexes.push(index);
        return indexes;
    }, []);

    if (filtered.length === 0) {
        addSongVirtualList?.setItems([]);
        addSongList.insertAdjacentHTML('beforeend', '<div class="pl-empty-hint">No songs found. Upload some from the Home tab first.</div>');
        return;
    }

    addSongVirtualList?.setItems(filtered);
}

function createAddSongRow(track) {
    if (!track) return null;
    const alreadyAdded = currentPlaylist?.tracks.some(item => item.path === track.path) || false;
    const row = document.createElement('div');
    row.className = 'pl-library-row';
    row.innerHTML = `
        <img loading="lazy" decoding="async">
        <div class="pl-library-row-text">
            <span class="title">${escapeHtml(track.data?.title || stripExtension(track.name))}</span>
            <span class="artist">${escapeHtml(track.data?.artist || 'Unknown Artist')}</span>
        </div>
        <button class="pl-library-add-btn ${alreadyAdded ? 'added' : ''}">${alreadyAdded ? 'Added' : 'Add'}</button>
    `;

    setLazyArtwork(row.querySelector('img'), artworkSource(track, 'thumb'));
    const addBtn = row.querySelector('.pl-library-add-btn');
    if (!alreadyAdded) addBtn.addEventListener('click', () => addExistingTrackToPlaylist(track, addBtn));
    return row;
}

function addExistingTrackToPlaylist(track, buttonEl) {
    if (!currentPlaylist || !window.electronAPI) return;

    const wasCurrentQueue = isCurrentPlaylistQueue();
    currentPlaylist.tracks.push({
        path: track.path,
        name: track.name,
        data: track.data || {},
        imagePath: track.imagePath || '',
        imageUrl: track.imageUrl || ''
    });
    if (wasCurrentQueue) window.musicPlayer?.setQueue(currentPlaylist.tracks);
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

        window.electronAPI.readMetadata(filePath)
            .then(metadata => saveAndAttachTrack(filePath, file.name, {
                title: metadata.title,
                artist: metadata.artist,
                album: metadata.album
            }, metadata.imagePath || ''))
            .catch(() => saveAndAttachTrack(filePath, file.name, {}, ''));
    });
});

function saveAndAttachTrack(filePath, fileName, data, imageSource) {
    if (!currentPlaylist || !window.electronAPI) return;
    if (libraryTracks.find(t => t.path === filePath)) {
        const existing = libraryTracks.find(t => t.path === filePath);
        addExistingTrackToPlaylist(existing, null);
        return;
    }

    const trackObj = { path: filePath, name: fileName, data };
    if (imageSource) {
        if (imageSource.startsWith('artwork/')) trackObj.imagePath = imageSource;
        else trackObj.imageUrl = imageSource;
    }

    const wasCurrentQueue = isCurrentPlaylistQueue();
    window.electronAPI.saveTrack(trackObj)
        .then(result => {
            if (result.imagePath) {
                trackObj.imagePath = result.imagePath;
                delete trackObj.imageUrl;
            }
            libraryTracks.push(trackObj);
            renderSidebarShortcuts();
            currentPlaylist.tracks.push({ ...trackObj });
            if (wasCurrentQueue) window.musicPlayer?.setQueue(currentPlaylist.tracks);
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

})();
