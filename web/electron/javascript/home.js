(function initializePersistentPlayer() {
const fileUpload = document.getElementById('file-upload');
const tracklist = document.getElementById('tracklist');
const libraryEmptyState = document.getElementById('library-empty-state');
const librarySortSelect = document.getElementById('library-sort');
const headerCover = document.getElementById('header-cover');
const headerLabel = document.getElementById('header-label');
const headerTitle = document.getElementById('header-title');
const mainPlayer = document.getElementById('main-player');
const miniPlayerToggle = document.getElementById('mini-player-toggle');
const playerBar = document.querySelector('.player-bar');
const homeView = document.querySelector('[data-app-view="home"]');
const miniTrackCover = document.getElementById('mini-track-cover');
const fullscreenCover = document.getElementById('fullscreen-cover-bg');
const playerBarMinimizeBtn = document.getElementById('player-bar-minimize');
const playerBarCompactStorageKey = 'music-app-playerbar-compact';
let currentArtworkTrack = null;

function setPlayerBarCompact(compact, persist = false) {
    const minimized = Boolean(compact);
    playerBar?.classList.toggle('is-compact', minimized);
    document.body.classList.toggle('player-bar-compact', minimized);
    playerBarMinimizeBtn?.setAttribute('aria-expanded', String(!minimized));
    playerBarMinimizeBtn?.setAttribute('aria-label', minimized ? 'Expand player bar' : 'Minimize player bar');
    if (playerBarMinimizeBtn) {
        playerBarMinimizeBtn.title = minimized ? 'Expand player bar' : 'Minimize player bar';
        playerBarMinimizeBtn.innerHTML = minimized
            ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 15 6-6 6 6"/></svg>'
            : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
    }
    window.refreshOverlayArtwork?.();
    if (persist) {
        try { localStorage.setItem(playerBarCompactStorageKey, minimized ? '1' : '0'); } catch (_) {}
    }
}

setPlayerBarCompact(localStorage.getItem(playerBarCompactStorageKey) === '1');
playerBarMinimizeBtn?.addEventListener('click', () => {
    setPlayerBarCompact(!playerBar?.classList.contains('is-compact'), true);
});

function syncMiniTrackInfo(track) {
    const title = document.getElementById('mini-track-title');
    const artist = document.getElementById('mini-track-artist');
    currentArtworkTrack = track || null;
    if (title) title.textContent = track ? (track.data?.title || stripExtension(track.name) || 'Unknown Title') : 'Nothing playing';
    if (artist) artist.textContent = track?.data?.artist || '';
    updateOverlayArtworkSources(track);
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
const repeatBtn = document.getElementById('repeat-btn');
const playIcon = document.getElementById('play-icon');
const volumeSlider = document.getElementById('volume-slider');
const playbackSpeedSlider = document.getElementById('playback-speed-slider');
const playbackSpeedReadout = document.getElementById('playback-speed-readout');
const muteBtn = document.getElementById('mute-btn');
const seekSlider = document.getElementById('seek-slider');
const timeCurrentEl = document.getElementById('time-current');
const timeDurationEl = document.getElementById('time-duration');
const queueToggleBtn = document.getElementById('queue-toggle-btn');
const queuePanel = document.getElementById('queue-panel');
const queueList = document.getElementById('queue-list');
const queueCount = document.getElementById('queue-count');
let queueRenderLimit = 60;
const nextTrackToast = document.getElementById('next-track-toast');
let nextTrackToastTimer = 0;
let playlist = [];
let currentTrackIndex = -1;
let isShuffle = false;
let isRepeatAll = false;
let isRepeatOne = false;
let appSettings = {};
let homeSortMode = (() => {
    try { return localStorage.getItem('music-home-sort') || 'custom'; }
    catch (_) { return 'custom'; }
})();
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
const trackChangeListeners = new Set();

const { DEFAULT_COVER, SUPPORTED_EXTENSIONS, escapeHtml, stripExtension, imageMimeType, artworkSource, setLazyArtwork, albumKey: getAlbumKey, formatTime } = window.musicCommon;
const homeTrackScroll = tracklist?.closest('.tracklist-container');
const homeTrackVirtualList = window.musicCommon.createVirtualList({
    scrollElement: homeTrackScroll,
    contentElement: tracklist,
    rowHeight: 64,
    renderItem: index => createTrackElement(playlist[index], index)
});

if (librarySortSelect) {
    librarySortSelect.value = homeSortMode;
    librarySortSelect.dispatchEvent(new Event('app-select-sync'));
    librarySortSelect.addEventListener('change', () => {
        homeSortMode = librarySortSelect.value;
        try { localStorage.setItem('music-home-sort', homeSortMode); } catch (_) {}
        renderTracklist(document.getElementById('sidebar-search')?.value || '');
    });
}

function updateOverlayArtworkSources(track = currentArtworkTrack) {
    const isMiniPlayer = document.body.classList.contains('mini-player-mode');
    const isLyricsVisible = document.getElementById('lyrics-view')?.classList.contains('is-visible');
    if (miniTrackCover) {
        setLazyArtwork(miniTrackCover, isMiniPlayer
            ? artworkSource(track, 'large')
            : artworkSource(track, 'thumb'));
    }
    if (fullscreenCover) {
        setLazyArtwork(fullscreenCover, (document.body.classList.contains('fullscreen-player-mode') || isLyricsVisible)
            ? artworkSource(track, 'large')
            : DEFAULT_COVER);
    }
}

window.refreshOverlayArtwork = () => updateOverlayArtworkSources();
const overlayArtworkObserver = new MutationObserver(() => updateOverlayArtworkSources());
overlayArtworkObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] });
const lyricsArtworkObserver = new MutationObserver(() => updateOverlayArtworkSources());
lyricsArtworkObserver.observe(document.getElementById('lyrics-view'), { attributes: true, attributeFilter: ['class'] });

const lyricsController = window.createLyricsController({
    getCurrentTrack: () => playlist[currentTrackIndex] || null
});
window.openLyricsView = () => lyricsController.open();
window.closeLyricsView = () => lyricsController.close();
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

window.musicPlayer = {
    playTrack(path) {
        const index = playlist.findIndex(track => track.path === path);
        if (index < 0) return false;
        playLibraryTrack(index);
        return true;
    },
    playQueue(tracks, startIndex = 0, options = {}) {
        const queue = (tracks || []).map(track => {
            if (!track?.path) return -1;
            let index = playlist.findIndex(item => item.path === track.path);
            if (index < 0) {
                playlist.push({ ...track, data: track.data || {}, playCount: Math.max(0, Number(track.playCount) || 0) });
                index = playlist.length - 1;
            }
            return index;
        }).filter(index => index >= 0);
        if (!queue.length) return false;
        playbackQueue = queue;
        selectedPlaylist = options.selectedPlaylist || null;
        const queueIndex = Math.min(Math.max(0, Number(startIndex) || 0), queue.length - 1);
        loadTrack(queue[queueIndex]);
        return true;
    },
    getQueuePaths: () => playbackQueue?.map(index => playlist[index]?.path).filter(Boolean) || null,
    setQueue(tracks) {
        if (!Array.isArray(tracks)) {
            playbackQueue = null;
        } else {
            playbackQueue = tracks.map(track => playlist.findIndex(item => item.path === track?.path)).filter(index => index >= 0);
        }
        scheduledNextTrackIndex = -1;
    },
    getCurrentTrack: () => playlist[currentTrackIndex] || null,
    get audio() { return mainPlayer; },
    enterFullscreen: enterFullscreenPlayer,
    onTrackChange(listener) {
        if (typeof listener !== 'function') return () => {};
        trackChangeListeners.add(listener);
        listener(playlist[currentTrackIndex] || null);
        return () => trackChangeListeners.delete(listener);
    }
};

function renderPlaybackQueue() {
    if (!queueList || !queueCount || queuePanel?.hidden) return;
    const paths = window.musicPlayer?.getQueuePaths?.();
    const tracks = (paths || playlist.map(track => track.path))
        .map(path => playlist.find(track => track.path === path))
        .filter(Boolean);
    queueCount.textContent = `${tracks.length} song${tracks.length === 1 ? '' : 's'}`;
    queueList.replaceChildren();
    if (!tracks.length) {
        const empty = document.createElement('div');
        empty.className = 'queue-empty';
        empty.textContent = 'Add music to your library to build a queue.';
        queueList.appendChild(empty);
        return;
    }
    const currentPosition = Math.max(0, tracks.findIndex(track => track.path === playlist[currentTrackIndex]?.path));
    const visibleTracks = tracks.slice(currentPosition, currentPosition + queueRenderLimit);
    visibleTracks.forEach((track, offset) => {
        const index = currentPosition + offset;
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'queue-track';
        const isCurrent = track.path === playlist[currentTrackIndex]?.path;
        if (isCurrent) row.setAttribute('aria-current', 'true');
        row.innerHTML = `<img alt="" loading="lazy" decoding="async"><span class="queue-track-copy"><strong>${escapeHtml(track.data?.title || stripExtension(track.name))}</strong><span>${escapeHtml(track.data?.artist || 'Unknown Artist')}</span></span>`;
        setLazyArtwork(row.querySelector('img'), artworkSource(track, 'thumb'));
        row.addEventListener('click', () => {
            window.musicPlayer?.playQueue(tracks, index);
            if (queuePanel) queuePanel.hidden = true;
            queueToggleBtn?.setAttribute('aria-expanded', 'false');
        });
        queueList.appendChild(row);
    });
    if (currentPosition + visibleTracks.length < tracks.length) {
        const more = document.createElement('button');
        more.type = 'button';
        more.className = 'queue-more-btn';
        more.textContent = `Show next ${Math.min(60, tracks.length - currentPosition - visibleTracks.length)} songs`;
        more.addEventListener('click', () => {
            queueRenderLimit += 60;
            renderPlaybackQueue();
        });
        queueList.appendChild(more);
    }
}

queueToggleBtn?.addEventListener('click', () => {
    if (!queuePanel) return;
    queuePanel.hidden = !queuePanel.hidden;
    queueToggleBtn.setAttribute('aria-expanded', String(!queuePanel.hidden));
    if (!queuePanel.hidden) {
        queueRenderLimit = 60;
        renderPlaybackQueue();
    }
});
document.addEventListener('click', event => {
    if (!queuePanel || queuePanel.hidden || queuePanel.contains(event.target) || queueToggleBtn?.contains(event.target)) return;
    queuePanel.hidden = true;
    queueToggleBtn?.setAttribute('aria-expanded', 'false');
});
document.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || !queuePanel || queuePanel.hidden) return;
    queuePanel.hidden = true;
    queueToggleBtn?.setAttribute('aria-expanded', 'false');
    queueToggleBtn?.focus();
});
document.getElementById('player-lyrics-btn')?.addEventListener('click', () => {
    const lyricsView = document.getElementById('lyrics-view');
    if (lyricsView?.classList.contains('is-visible')) window.closeLyricsView?.();
    else window.openLyricsView?.();
});
window.musicPlayer.onTrackChange(renderPlaybackQueue);

function notifyTrackChange(track) {
    trackChangeListeners.forEach(listener => {
        try { listener(track || null); } catch (error) { console.error('A player view could not update:', error); }
    });
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
    setLazyArtwork(headerCover, homeView?.hidden ? DEFAULT_COVER : artworkSource(track, 'cover'));
    headerCover.alt = selectedPlaylist ? `${selectedPlaylist.name} cover` : selectedAlbum ? `${selectedAlbum.name} cover` : 'Cover';
}

window.onHomeAppViewChanged = page => {
    if (page === 'home') {
        selectedPlaylist = null;
        selectedAlbum = null;
        renderTracklist(document.getElementById('sidebar-search')?.value || '');
        updateHeaderCover();
    } else if (headerCover) {
        setLazyArtwork(headerCover, DEFAULT_COVER);
    }
    syncHomeHeaderCollapse();
};

const playlistsView = document.querySelector('.playlists-view');
const playlistGridScroll = document.querySelector('.pl-scroll-container');
const playlistDetailScroll = document.querySelector('#detail-view .tracklist-container');

function syncHomeHeaderCollapse() {
    const enabled = appSettings.homeHeaderCollapse !== false;
    const homeIsActive = !homeView?.hidden;
    const playlistsAreActive = !playlistsView?.hidden;
    const playlistScrollTop = document.getElementById('detail-view')?.style.display !== 'none'
        ? playlistDetailScroll?.scrollTop || 0
        : playlistGridScroll?.scrollTop || 0;
    const hasScrolled = homeIsActive
        ? (homeTrackScroll?.scrollTop || 0) > 48
        : playlistsAreActive && playlistScrollTop > 48;
    document.body.classList.toggle('home-header-compact', enabled && hasScrolled);
}

homeTrackScroll?.addEventListener('scroll', syncHomeHeaderCollapse, { passive: true });
playlistGridScroll?.addEventListener('scroll', syncHomeHeaderCollapse, { passive: true });
playlistDetailScroll?.addEventListener('scroll', syncHomeHeaderCollapse, { passive: true });
new MutationObserver(syncHomeHeaderCollapse).observe(document.getElementById('detail-view'), { attributes: true, attributeFilter: ['style'] });

function closeLibraryTrackMenus() {
    document.querySelectorAll('.track-more-menu:not([hidden])').forEach(menu => {
        menu.hidden = true;
        menu.closest('.track-actions-wrap')?.querySelector('.track-more-btn')?.setAttribute('aria-expanded', 'false');
    });
}
document.addEventListener('click', event => {
    if (!event.target.closest('.track-actions-wrap')) closeLibraryTrackMenus();
});
homeTrackScroll?.addEventListener('scroll', closeLibraryTrackMenus, { passive: true });
window.addEventListener('resize', closeLibraryTrackMenus);

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
    const visibleIndices = [];
    playlist.forEach((track, index) => {
        const matchesPlaylist = !selectedPlaylist || !playbackQueue || playbackQueue.includes(index);
        if (matchesPlaylist && (!selectedAlbum || getAlbumKey(track) === selectedAlbum.key) && trackMatchesQuery(track, query)) {
            visibleIndices.push(index);
        }
    });
    if (homeSortMode !== 'custom') {
        visibleIndices.sort((leftIndex, rightIndex) => {
            const left = playlist[leftIndex];
            const right = playlist[rightIndex];
            const titleOrder = (left.data?.title || stripExtension(left.name) || '').localeCompare(
                right.data?.title || stripExtension(right.name) || '', undefined, { sensitivity: 'base' }
            );
            if (homeSortMode === 'az') return titleOrder;
            if (homeSortMode === 'za') return -titleOrder;
            if (homeSortMode === 'duration') {
                const leftDuration = Number(left.data?.duration) > 0 ? Number(left.data.duration) : Number.POSITIVE_INFINITY;
                const rightDuration = Number(right.data?.duration) > 0 ? Number(right.data.duration) : Number.POSITIVE_INFINITY;
                return leftDuration - rightDuration || titleOrder;
            }
            if (homeSortMode === 'played') {
                const playDifference = (Number(right.playCount) || 0) - (Number(left.playCount) || 0);
                return playDifference || titleOrder;
            }
            return 0;
        });
    }
    homeTrackVirtualList?.setItems(visibleIndices);
    if (libraryEmptyState) {
        libraryEmptyState.hidden = visibleIndices.length > 0;
        libraryEmptyState.replaceChildren();
        if (!visibleIndices.length) {
            const title = document.createElement('strong');
            const message = document.createElement('span');
            const action = document.createElement('button');
            const hasTracks = playlist.length > 0;
            title.textContent = hasTracks ? 'No songs found' : 'Your library is empty';
            message.textContent = hasTracks ? 'Try a different title, artist, or album.' : 'Add your music to see it here.';
            action.type = 'button';
            action.className = 'upload-btn';
            action.textContent = hasTracks ? 'Clear search' : 'Upload music';
            action.addEventListener('click', () => {
                if (hasTracks) {
                    const search = document.getElementById('sidebar-search');
                    if (search) search.value = '';
                    window.applyLibrarySearch?.('');
                } else fileUpload?.click();
            });
            libraryEmptyState.append(title, message, action);
        }
    }
    updateHeaderCover();
    updateLibraryTimeSummary();
}

function homeTimeTracks() {
    if (selectedPlaylist?.tracks) return selectedPlaylist.tracks;
    if (selectedAlbum) return getAlbumTracks(selectedAlbum.key);
    return playlist;
}

function updateLibraryTimeSummary() {
    const label = document.getElementById('library-time-summary');
    if (!label) return;
    const tracks = homeTimeTracks();
    const known = tracks.reduce((total, track) => {
        const seconds = Number(track.data?.duration);
        return total + (Number.isFinite(seconds) && seconds > 0 ? seconds : 0);
    }, 0);
    const knownCount = tracks.filter(track => Number(track.data?.duration) > 0).length;
    if (!knownCount) {
        label.textContent = tracks.length ? `Calculating playlist time… (${tracks.length} tracks)` : '0 tracks';
        return;
    }
    const minutes = Math.round(known / 60);
    const hours = Math.floor(minutes / 60);
    const remainder = minutes % 60;
    const length = hours ? `${hours} hr${hours === 1 ? '' : 's'}${remainder ? ` ${remainder} min` : ''}` : `${minutes} min`;
    label.textContent = `${tracks.length} track${tracks.length === 1 ? '' : 's'} · ${knownCount < tracks.length ? '~' : ''}${length}`;
}

const durationScanPaths = new Set();
function probeLibraryTrackDuration(track) {
    return new Promise(resolve => {
        if (!track?.path || !window.electronAPI?.toMediaUrl) return resolve(0);
        const audio = new Audio();
        audio.preload = 'metadata';
        let settled = false;
        const finish = seconds => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            audio.removeEventListener('loadedmetadata', onLoaded);
            audio.removeEventListener('error', onError);
            audio.removeAttribute('src');
            audio.load();
            const duration = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
            if (duration) {
                track.data = track.data || {};
                track.data.duration = duration;
                window.electronAPI.updateTrack?.(track.path, { duration })?.catch?.(() => {});
                window.dispatchEvent(new CustomEvent('music-track-duration-updated', { detail: { path: track.path, duration } }));
            }
            resolve(duration);
        };
        const onLoaded = () => finish(audio.duration);
        const onError = () => finish(0);
        const timeout = setTimeout(() => finish(0), 7000);
        audio.addEventListener('loadedmetadata', onLoaded, { once: true });
        audio.addEventListener('error', onError, { once: true });
        try { audio.src = window.electronAPI.toMediaUrl(track.path); audio.load(); }
        catch (_) { finish(0); }
    });
}

async function scanMissingTrackDurations(tracks) {
    const pending = tracks.filter(track => track?.path && !(Number(track.data?.duration) > 0) && !durationScanPaths.has(track.path));
    for (const track of pending) durationScanPaths.add(track.path);
    for (let index = 0; index < pending.length; index += 2) {
        await Promise.all(pending.slice(index, index + 2).map(probeLibraryTrackDuration));
        if (index + 2 < pending.length) await new Promise(resolve => setTimeout(resolve, 120));
    }
    updateLibraryTimeSummary();
}

window.addEventListener('music-track-duration-updated', event => {
    const { path, duration } = event.detail || {};
    if (!path || !(Number(duration) > 0)) return;
    playlist.forEach(track => {
        if (track.path === path) {
            track.data = track.data || {};
            track.data.duration = Number(duration);
        }
    });
    selectedPlaylist?.tracks?.forEach(track => {
        if (track.path === path) {
            track.data = track.data || {};
            track.data.duration = Number(duration);
        }
    });
    if (selectedPlaylist?.tracks?.some(track => track.path === path)) updateHeaderCover();
    tracklist?.querySelectorAll('.track-item').forEach(row => {
        if (row.dataset.trackPath !== path) return;
        const durationCell = row.querySelector('.track-duration');
        if (durationCell) durationCell.textContent = formatTime(Number(duration));
    });
    updateLibraryTimeSummary();
});

function updateLibraryPlaybackHighlight() {
    const playingPath = playlist[currentTrackIndex]?.path;
    tracklist?.querySelectorAll('.track-item').forEach(row => {
        const isCurrent = Boolean(playingPath && row.dataset.trackPath === playingPath);
        row.classList.toggle('now-playing', isCurrent);
        row.classList.toggle('is-audio-playing', isCurrent && !mainPlayer.paused);
        if (isCurrent) row.setAttribute('aria-current', 'true');
        else row.removeAttribute('aria-current');
    });
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

window.applyHomeLibrarySearch = query => renderTracklist(query);

function createTrackElement(track, index) {
    const trackItem = document.createElement('div');
    const isCurrentTrack = playlist[index]?.path === playlist[currentTrackIndex]?.path;
    trackItem.className = 'track-item' + (isCurrentTrack ? ` now-playing${mainPlayer.paused ? '' : ' is-audio-playing'}` : '');
    trackItem.draggable = homeSortMode === 'custom';
    trackItem.dataset.trackPath = track.path;

    trackItem.innerHTML = `
        <div class="track-index">${index + 1}</div>
        <div class="track-info-col">
            <div class="track-cover-wrapper" title="Click to change cover">
                <img class="track-cover-img" loading="lazy" decoding="async">
                <input type="file" class="cover-upload-input" accept="image/*">
            </div>
            <div class="track-text">
                <span class="track-title">${escapeHtml(track.data.title || stripExtension(track.name))}</span>
                <span class="track-artist">${escapeHtml(track.data.artist || ' ')}</span>
            </div>
        </div>
        <div class="track-album" contenteditable="true" spellcheck="false" title="Click to edit album">${escapeHtml(track.data.album || 'Unknown Album')}</div>
        <div class="track-duration" title="Track length">${Number(track.data?.duration) > 0 ? formatTime(Number(track.data.duration)) : '—'}</div>
        <div class="track-actions-wrap">
            <button class="track-more-btn" type="button" title="Song options" aria-label="Song options" aria-haspopup="menu" aria-expanded="false">
                <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.5"></circle><circle cx="12" cy="12" r="1.5"></circle><circle cx="19" cy="12" r="1.5"></circle></svg>
            </button>
            <div class="track-more-menu" role="menu" hidden>
                <button class="track-more-menu-item track-add-to-playlist-btn upload-btn" type="button" role="menuitem" aria-expanded="false">
                    <span>Add to playlist</span>
                </button>
                <button class="track-more-menu-item track-remove-action" type="button" role="menuitem">Remove from library</button>
            </div>
        </div>
    `;
    setLazyArtwork(trackItem.querySelector('.track-cover-img'), artworkSource(track, 'thumb'));
    trackItem.addEventListener('click', event => {
        if (Date.now() < suppressLibraryClickUntil) { event.preventDefault(); return; }
        if (event.detail > 1) return;
        playLibraryTrack(index);
    });
    trackItem.addEventListener('dblclick', event => {
        if (event.target.closest('button, input, [contenteditable="true"], .track-cover-wrapper')) return;
        if (currentTrackIndex !== index) playLibraryTrack(index);
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
        if (file) handleCoverChange(index, file, trackItem);
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
    albumEl.addEventListener('blur', () => handleAlbumEdit(index, albumEl.textContent, albumEl));

    const actionsWrap = trackItem.querySelector('.track-actions-wrap');
    const moreBtn = trackItem.querySelector('.track-more-btn');
    const moreMenu = trackItem.querySelector('.track-more-menu');
    const addToPlaylistBtn = trackItem.querySelector('.track-add-to-playlist-btn');
    const playlistOptions = trackItem.querySelector('.track-playlist-options');
    const removeBtn = trackItem.querySelector('.track-remove-action');
    actionsWrap.addEventListener('click', event => event.stopPropagation());
    moreBtn.addEventListener('click', event => {
        event.stopPropagation();
        const willOpen = moreMenu.hidden;
        closeLibraryTrackMenus();
        if (!willOpen) return;
        moreMenu.hidden = false;
        moreBtn.setAttribute('aria-expanded', 'true');
        const rect = moreBtn.getBoundingClientRect();
        const left = Math.max(8, Math.min(rect.right - moreMenu.offsetWidth, window.innerWidth - moreMenu.offsetWidth - 8));
        const below = rect.bottom + 6;
        const top = below + moreMenu.offsetHeight <= window.innerHeight - 8 ? below : Math.max(8, rect.top - moreMenu.offsetHeight - 6);
        moreMenu.style.left = `${left}px`;
        moreMenu.style.top = `${top}px`;
    });
    moreMenu.addEventListener('keydown', event => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        moreMenu.hidden = true;
        moreBtn.setAttribute('aria-expanded', 'false');
        moreBtn.focus();
    });
    addToPlaylistBtn.addEventListener('click', async event => {
        event.stopPropagation();
        moreMenu.hidden = true;
        moreBtn.setAttribute('aria-expanded', 'false');

        const backdrop = document.createElement('div');
        backdrop.className = 'track-playlist-modal-backdrop';
        backdrop.innerHTML = `
            <section class="track-playlist-modal" role="dialog" aria-modal="true" aria-labelledby="track-playlist-modal-title">
                <header class="track-playlist-modal-header">
                    <div><h2 id="track-playlist-modal-title">Add to playlist</h2><p>${escapeHtml(track.data?.title || stripExtension(track.name))}</p></div>
                    <button class="track-playlist-modal-close" type="button" aria-label="Close">×</button>
                </header>
                <input class="track-playlist-search" type="search" placeholder="Search your playlists..." aria-label="Search playlists">
                <div class="track-playlist-options" role="list"></div>
            </section>`;
        document.body.appendChild(backdrop);
        const modal = backdrop.querySelector('.track-playlist-modal');
        const search = backdrop.querySelector('.track-playlist-search');
        const options = backdrop.querySelector('.track-playlist-options');
        const closeModal = () => backdrop.remove();
        backdrop.querySelector('.track-playlist-modal-close').addEventListener('click', closeModal);
        backdrop.addEventListener('click', closeEvent => { if (closeEvent.target === backdrop) closeModal(); });
        modal.addEventListener('keydown', keyEvent => {
            if (keyEvent.key === 'Escape') closeModal();
        });
        search.focus();

        const loading = document.createElement('div');
        loading.className = 'track-playlist-empty';
        loading.textContent = 'Loading playlists…';
        options.appendChild(loading);
        try {
            const playlists = await window.electronAPI?.getPlaylists?.() || [];
            if (!backdrop.isConnected) return;
            const renderPlaylists = () => {
                const query = search.value.trim().toLowerCase();
                const filtered = playlists.filter(saved => (saved.name || 'Untitled playlist').toLowerCase().includes(query));
                options.replaceChildren();
                if (!filtered.length) {
                    const empty = document.createElement('div');
                    empty.className = 'track-playlist-empty';
                    empty.textContent = playlists.length ? 'No playlists found' : 'No playlists yet';
                    options.appendChild(empty);
                    return;
                }
                filtered.forEach(savedPlaylist => {
                    const row = document.createElement('div');
                    row.className = 'track-playlist-row';
                    row.setAttribute('role', 'listitem');
                    const cover = document.createElement('img');
                    cover.alt = '';
                    cover.loading = 'lazy';
                    cover.decoding = 'async';
                    const firstTrack = savedPlaylist.tracks?.[0];
                    if (savedPlaylist.coverImage) cover.src = savedPlaylist.coverImage;
                    else if (savedPlaylist.coverImagePath && window.electronAPI?.toArtworkUrl) cover.src = window.electronAPI.toArtworkUrl(savedPlaylist.coverImagePath, 'thumb');
                    else if (firstTrack) setLazyArtwork(cover, artworkSource(firstTrack, 'thumb'));
                    else cover.src = '../images/playlist.png';

                    const details = document.createElement('div');
                    details.className = 'track-playlist-row-text';
                    const title = document.createElement('span');
                    title.className = 'track-playlist-row-title';
                    title.textContent = savedPlaylist.name || 'Untitled playlist';
                    const count = document.createElement('span');
                    count.className = 'track-playlist-row-count';
                    const trackCount = savedPlaylist.tracks?.length || 0;
                    count.textContent = `${trackCount} song${trackCount === 1 ? '' : 's'}`;
                    details.append(title, count);

                    const addButton = document.createElement('button');
                    addButton.type = 'button';
                    addButton.className = 'track-playlist-option';
                    addButton.textContent = 'Add';
                    addButton.addEventListener('click', async addEvent => {
                        addEvent.stopPropagation();
                        addButton.disabled = true;
                        addButton.textContent = 'Adding…';
                        try {
                            const result = await window.electronAPI.addTrackToPlaylist(savedPlaylist.id, track);
                            if (!result?.success) throw new Error(result?.error || 'Could not add song');
                            addButton.textContent = result.alreadyExists ? 'In playlist' : 'Added';
                            addButton.classList.add('added');
                            if (!result.alreadyExists) {
                                window.dispatchEvent(new CustomEvent('music-playlist-track-added', { detail: { playlistId: savedPlaylist.id, trackPath: track.path } }));
                            }
                        } catch (error) {
                            console.error('Failed to add song to playlist:', error);
                            addButton.disabled = false;
                            addButton.textContent = 'Try again';
                        }
                    });
                    row.append(cover, details, addButton);
                    options.appendChild(row);
                });
            };
            renderPlaylists();
            search.addEventListener('input', renderPlaylists);
        } catch (error) {
            console.error('Failed to load playlists:', error);
            loading.textContent = 'Could not load playlists';
        }
    });
    removeBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        moreMenu.hidden = true;
        removeTrackAt(index);
    });

    return trackItem;
}

function handleCoverChange(index, file, trackItem) {
    const track = playlist[index];
    if (!track) return;

    const reader = new FileReader();
    reader.onload = () => {
        const dataUrl = reader.result;
        track.imageUrl = dataUrl;
        if (currentTrackIndex === index) syncMiniTrackInfo(track);

        const img = trackItem?.querySelector('.track-cover-img');
        if (img?.isConnected) setLazyArtwork(img, dataUrl);
        updateHeaderCover();
        renderTopSongs();

        if (window.electronAPI) {
            window.electronAPI.updateTrack(track.path, { imageUrl: dataUrl })
                .then(result => {
                    track.imagePath = result.imagePath || '';
                    delete track.imageUrl;
                    if (currentTrackIndex === index) syncMiniTrackInfo(track);
                    const savedImg = trackItem?.querySelector('.track-cover-img');
                    if (savedImg?.isConnected) setLazyArtwork(savedImg, artworkSource(track, 'thumb'));
                    updateHeaderCover();
        renderTopSongs();
                })
                .catch(err => console.error('Failed to save cover:', err));
        }
    };
    reader.onerror = () => console.error('Failed to read cover image file');
    reader.readAsDataURL(file);
}

function handleAlbumEdit(index, newAlbumText, albumEl) {
    const track = playlist[index];
    if (!track) return;

    const previousAlbumKey = getAlbumKey(track);
    const newAlbum = newAlbumText.trim() || 'Unknown Album';
    track.data.album = newAlbum;
    if (selectedAlbum?.key === previousAlbumKey && getAlbumKey(track) !== previousAlbumKey) {
        selectedAlbum = null;
    }

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

function publishSettingsChange(changes) {
    window.dispatchEvent(new CustomEvent('music-settings-change', { detail: changes }));
}

if (volumeSlider) {
    volumeSlider.addEventListener('input', () => {
        const value = parseFloat(volumeSlider.value);
        mainPlayer.volume = value;
        mainPlayer.muted = false;
        updateMuteIcon();
        publishSettingsChange({ volume: value, muted: false });
        if (window.electronAPI) {
            window.electronAPI.saveSettings({ volume: value, muted: false }).catch(() => {});
        }
    });
}

function applySelectedPlaybackSpeed() {
    if (!playbackSpeedSlider || !mainPlayer) return;
    const speed = Number(playbackSpeedSlider.value);
    if (!Number.isFinite(speed)) return;
    mainPlayer.playbackRate = speed;
    if ('preservesPitch' in mainPlayer) mainPlayer.preservesPitch = true;
    if ('mozPreservesPitch' in mainPlayer) mainPlayer.mozPreservesPitch = true;
    if ('webkitPreservesPitch' in mainPlayer) mainPlayer.webkitPreservesPitch = true;
    if (playbackSpeedReadout) playbackSpeedReadout.textContent = `${parseFloat(speed.toFixed(2))}×`;
    updateSlowReverb();
}
if (playbackSpeedSlider && mainPlayer) {
    const speedStorageKey = 'music-app-playback-speed';
    let savedSpeed = 1;
    try {
        const parsedSpeed = Number(localStorage.getItem(speedStorageKey));
        if (Number.isFinite(parsedSpeed) && parsedSpeed >= 0.5 && parsedSpeed <= 2) savedSpeed = parsedSpeed;
    } catch (_) {}
    mainPlayer.playbackRate = savedSpeed;
    playbackSpeedSlider.value = String(savedSpeed);
    if ('preservesPitch' in mainPlayer) mainPlayer.preservesPitch = true;
    if ('mozPreservesPitch' in mainPlayer) mainPlayer.mozPreservesPitch = true;
    if ('webkitPreservesPitch' in mainPlayer) mainPlayer.webkitPreservesPitch = true;
    if (playbackSpeedReadout) playbackSpeedReadout.textContent = `${parseFloat(savedSpeed.toFixed(2))}×`;
    playbackSpeedSlider.addEventListener('input', () => {
        const speed = Number(playbackSpeedSlider.value);
        if (!Number.isFinite(speed)) return;
        mainPlayer.playbackRate = speed;
        if (playbackSpeedReadout) playbackSpeedReadout.textContent = `${parseFloat(speed.toFixed(2))}×`;
        try { localStorage.setItem(speedStorageKey, String(speed)); } catch (_) {}
        updateSlowReverb();
    });
}

if (muteBtn) {
    muteBtn.addEventListener('click', () => {
        mainPlayer.muted = !mainPlayer.muted;
        updateMuteIcon();
        publishSettingsChange({ muted: mainPlayer.muted });
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
    const track = playlist[currentTrackIndex];
    if (track && Number.isFinite(mainPlayer.duration) && mainPlayer.duration > 0 && !Number(track.data?.duration)) {
        track.data.duration = mainPlayer.duration;
        window.electronAPI?.updateTrack?.(track.path, { duration: mainPlayer.duration })?.catch?.(() => {});
        window.dispatchEvent(new CustomEvent('music-track-duration-updated', { detail: { path: track.path, duration: mainPlayer.duration } }));
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
    const currentSecond = Math.floor(mainPlayer.currentTime);
    if (currentSecond !== lastSnapshotSecond) {
        lastSnapshotSecond = currentSecond;
        savePlaybackSnapshot(!mainPlayer.paused);
    }
    if (!sessionSaveTimer) {
        sessionSaveTimer = setTimeout(() => {
            sessionSaveTimer = null;
            saveSession();
        }, 3000);
    }
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
    const sequence = playbackSequence;
    getTrackDuration(nextTrack).then(duration => {
        if (sequence !== playbackSequence || mainPlayer.paused) return;
        const title = nextTrack.data?.title || stripExtension(nextTrack.name) || 'Unknown Title';
        const artist = nextTrack.data?.artist || '';
        const length = duration > 0 ? formatTime(duration) : 'Length unavailable';

        window.electronAPI?.notifyNextTrack({
            title,
            artist,
            duration: length,
            imagePath: nextTrack.imagePath || ''
        }).catch(error => console.warn('Could not show next-track notification:', error));
    });
}

function getTrackDuration(track) {
    const known = Number(track?.data?.duration);
    if (Number.isFinite(known) && known > 0) return Promise.resolve(known);
    if (!track?.path || !window.electronAPI?.toMediaUrl) return Promise.resolve(0);
    return new Promise(resolve => {
        const probe = new Audio();
        probe.preload = 'metadata';
        let finished = false;
        const timer = setTimeout(() => finish(0), 2200);
        const finish = seconds => {
            if (finished) return;
            finished = true;
            clearTimeout(timer);
            probe.removeEventListener('loadedmetadata', onMetadata);
            probe.removeEventListener('error', onError);
            probe.removeAttribute('src');
            probe.load();
            const duration = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
            if (duration) {
                track.data = track.data || {};
                track.data.duration = duration;
                window.electronAPI?.updateTrack?.(track.path, { duration })?.catch?.(() => {});
                window.dispatchEvent(new CustomEvent('music-track-duration-updated', { detail: { path: track.path, duration } }));
            }
            resolve(duration);
        };
        const onMetadata = () => finish(probe.duration);
        const onError = () => finish(0);
        probe.addEventListener('loadedmetadata', onMetadata, { once: true });
        probe.addEventListener('error', onError, { once: true });
        try {
            probe.src = window.electronAPI.toMediaUrl(track.path);
            probe.load();
        } catch (_) { finish(0); }
    });
}

function showNextTrackToast(track, title, artist, length) {
    if (!nextTrackToast || document.visibilityState !== 'visible' || document.body.classList.contains('mini-player-mode')) return;
    document.getElementById('next-track-toast-title').textContent = title;
    document.getElementById('next-track-toast-artist').textContent = artist || 'Unknown artist';
    document.getElementById('next-track-toast-duration').textContent = length;
    setLazyArtwork(document.getElementById('next-track-toast-cover'), artworkSource(track, 'thumb'));
    nextTrackToast.hidden = false;
    nextTrackToast.classList.remove('is-visible');
    requestAnimationFrame(() => nextTrackToast.classList.add('is-visible'));
    clearTimeout(nextTrackToastTimer);
    nextTrackToastTimer = setTimeout(() => {
        nextTrackToast.classList.remove('is-visible');
        nextTrackToastTimer = setTimeout(() => { nextTrackToast.hidden = true; }, 220);
    }, 8000);
}

function dismissNextTrackToast() {
    clearTimeout(nextTrackToastTimer);
    nextTrackToast?.classList.remove('is-visible');
    if (nextTrackToast) nextTrackToastTimer = setTimeout(() => { nextTrackToast.hidden = true; }, 220);
}

document.getElementById('next-track-toast-close')?.addEventListener('click', dismissNextTrackToast);

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

mainPlayer.addEventListener('loadedmetadata', applySelectedPlaybackSpeed);
mainPlayer.addEventListener('play', () => {
    applySelectedPlaybackSpeed();
    savePlaybackSnapshot(true);
    playIcon.src = '../images/pause.png';
    playIcon.alt = 'Pause';
    playBtn.setAttribute('aria-label', 'Pause');
    updateLibraryPlaybackHighlight();
    updateDiscordPresence();
    if (!audioCtx && hasActiveAudioProcessing()) {
        setupAudioGraph();
        setNormalization(normalizeToggle ? normalizeToggle.checked : false);
    }
    if (audioCtx?.state === 'suspended') audioCtx.resume();
});
mainPlayer.addEventListener('pause', () => {
    updateSlowReverb();
    if (!isLeavingPage) savePlaybackSnapshot(false);
    saveSession();
    playIcon.src = '../images/play.png';
    playIcon.alt = 'Play';
    playBtn.setAttribute('aria-label', 'Play');
    updateLibraryPlaybackHighlight();
    updateDiscordPresence();
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
        renderTopSongs();
        scanMissingTrackDurations(playlist);
        renderTopPlaylists();
        const searchInput = document.getElementById('sidebar-search');
        if (searchInput && pageQuery.has('search')) searchInput.value = pageQuery.get('search') || '';
        return playlist;
    }).catch(err => {
        console.error('Failed to load saved playlist:', err);
        return [];
    });
}

let libraryPromise = Promise.resolve([]);
if (window.electronAPI) {
    libraryPromise = loadLibraryFromDisk();
window.handleAppRouteQuery = async (query, options = {}) => {
        await libraryPromise;
        const requestedTrackPath = query.get('play');
        const requestedPlaylistId = query.get('playlist');
        const searchInput = document.getElementById('sidebar-search');
        if (query.has('search')) {
            if (searchInput) searchInput.value = query.get('search') || '';
            const searchBox = document.getElementById('app-search-box');
            const searchToggle = document.getElementById('app-search-toggle');
            searchBox?.classList.toggle('is-open', Boolean(searchInput?.value));
            searchToggle?.setAttribute('aria-expanded', String(Boolean(searchInput?.value)));
            if (searchInput) searchInput.tabIndex = searchInput.value ? 0 : -1;
            window.applyLibrarySearch?.(query.get('search') || '');
        }
        if (query.has('album')) {
            const key = query.get('album');
            const track = playlist.find(item => getAlbumKey(item) === key);
            selectedAlbum = track ? { key, name: track.data.album, artist: track.data.artist || 'Unknown Artist' } : null;
            renderTracklist(searchInput?.value || '');
        }
        if (!options.historyTraversal && requestedPlaylistId) {
            try { sessionStorage.removeItem('wuom-playback-snapshot'); } catch (_) {}
            const savedPlaylists = await window.electronAPI.getPlaylists().catch(() => []);
            const requestedPlaylist = (savedPlaylists || []).find(item => String(item.id) === requestedPlaylistId);
            if (requestedPlaylist?.tracks?.length) {
                selectedAlbum = null;
                const tracks = requestedPlaylist.tracks.filter(track => track?.path);
                window.musicPlayer.playQueue(tracks, 0, { selectedPlaylist: { ...requestedPlaylist, tracks } });
                renderTracklist(searchInput?.value || '');
            }
        } else if (!options.historyTraversal && requestedTrackPath) {
            try { sessionStorage.removeItem('wuom-playback-snapshot'); } catch (_) {}
            window.musicPlayer.playTrack(requestedTrackPath);
        }
        if (query.get('view') === 'lyrics') window.openLyricsView?.();
    };

    Promise.all([
        libraryPromise,
        window.electronAPI.getSettings().catch(() => ({}))
    ]).then(([, settings]) => {
        appSettings = settings || {};
        syncHomeHeaderCollapse();
        applyVolumeSettings();
        applyEqSettings();

        const pageQuery = new URLSearchParams(window.location.search);
        if (!pageQuery.has('play') && !pageQuery.has('playlist')) {
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
                    notifyTrackChange(playlist[idx]);
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
    });

    window.electronAPI.onLibraryUpdated(() => {
        libraryPromise = loadLibraryFromDisk();
    });
}

function playLibraryTrack(index) {
    if (index < 0 || index >= playlist.length) return;
    if (selectedAlbum && !playbackQueue) {
        playbackQueue = getAlbumTracks(selectedAlbum.key)
            .map(track => playlist.findIndex(item => item.path === track.path))
            .filter(trackIndex => trackIndex >= 0);
    }
    // Keep the current rows, scroll position, and collection context in place
    // while switching tracks; playback should not rebuild the library view.
    loadTrack(index);
}

function loadTrack(index) {
    if (index < 0 || index >= playlist.length) return;
    dismissNextTrackToast();
    const track = playlist[index];
    syncMiniTrackInfo(track);
    if (!track.path) {
        console.error('Track has no file path, skipping:', track.name);
        return;
    }

    currentTrackIndex = index;
    updateLibraryPlaybackHighlight();
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
    notifyTrackChange(track);
    
    mainPlayer.play().catch(err => console.error("Playback error:", err));
}

mainPlayer.addEventListener('playing', () => {
    applySelectedPlaybackSpeed();
    if (currentTrackIndex < 0 || countedPlaybackSequence === playbackSequence) return;
    const track = playlist[currentTrackIndex];
    if (!track) return;
    countedPlaybackSequence = playbackSequence;
    track.playCount = Math.max(0, Number(track.playCount) || 0) + 1;
    if (window.electronAPI?.recordTrackPlay) {
        window.electronAPI.recordTrackPlay(track.path).then(result => {
            if (result?.success) track.playCount = result.playCount;
        }).catch(error => console.error('Failed to save track play count:', error));
    }
});

playBtn.addEventListener('click', () => {
    if (playlist.length === 0) return; 

    if (mainPlayer.paused) {
        if (currentTrackIndex === -1) {
            loadTrack(playbackQueue?.[0] ?? 0);
        } else {
            mainPlayer.play();
        }
    } else {
        mainPlayer.pause();
    }
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
    if (seekSlider) {
        seekSlider.value = 0;
        seekSlider.style.setProperty('--progress', '0%');
    }
    if (timeCurrentEl) timeCurrentEl.textContent = '0:00';
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
    shuffleBtn.setAttribute('aria-pressed', String(isShuffle));
});

function setRepeatMode(mode) {
    isRepeatAll = mode === 'all';
    isRepeatOne = mode === 'one';
    if (!repeatBtn) return;
    const label = mode === 'all' ? 'Repeat all' : mode === 'one' ? 'Repeat one' : 'Repeat off';
    repeatBtn.dataset.repeatMode = mode;
    repeatBtn.classList.toggle('active', mode !== 'off');
    repeatBtn.classList.toggle('is-repeat-one', mode === 'one');
    repeatBtn.title = label;
    repeatBtn.setAttribute('aria-label', label);
    repeatBtn.setAttribute('aria-pressed', String(mode !== 'off'));
}

setRepeatMode('off');
repeatBtn?.addEventListener('click', () => {
    const mode = repeatBtn.dataset.repeatMode || 'off';
    setRepeatMode(mode === 'off' ? 'all' : mode === 'all' ? 'one' : 'off');
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
            loadTrack(playbackQueue?.[0] ?? 0);
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
const eqBassReadout = document.getElementById('eq-bass-readout');
const eqMidReadout = document.getElementById('eq-mid-readout');
const eqTrebleReadout = document.getElementById('eq-treble-readout');
const normalizeToggle = document.getElementById('player-normalize-toggle');
const reverbSlider = document.getElementById('player-reverb-slider');
const reverbReadout = document.getElementById('player-reverb-readout');

function updateEqReadouts() {
    [[eqBass, eqBassReadout], [eqMid, eqMidReadout], [eqTreble, eqTrebleReadout]].forEach(([slider, readout]) => {
        if (!slider || !readout) return;
        const value = Number(slider.value) || 0;
        readout.value = `${value > 0 ? '+' : ''}${value} dB`;
        readout.textContent = readout.value;
    });
}

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
    if (reverbSlider) {
        const storedReverb = appSettings.slowPlaybackReverb;
        reverbSlider.value = String(typeof storedReverb === 'number' ? Math.max(0, Math.min(0.6, storedReverb)) : (storedReverb === false ? 0 : 0.25));
    }
    updateEqReadouts();
    updateReverbReadout();
    updateSlowReverb();
}

let audioCtx = null;
let bassFilter, midFilter, trebleFilter, compressor, gainNode, sourceNode, reverbConvolver, reverbGainNode, dryGainNode;

function updateReverbReadout() {
    if (reverbReadout) reverbReadout.textContent = `${Math.round((Number(reverbSlider?.value) || 0) * 100)}%`;
}

function updateSlowReverb() {
    const reverbAmount = Number(reverbSlider?.value) || 0;
    const shouldUseReverb = reverbAmount > 0 && Number(mainPlayer?.playbackRate || 1) < 0.99;
    if (shouldUseReverb && !audioCtx && mainPlayer && !mainPlayer.paused && hasActiveAudioProcessing()) {
        setupAudioGraph();
        setNormalization(!!normalizeToggle?.checked);
    }
    if (!audioCtx || !reverbGainNode) return;
    const now = audioCtx.currentTime;
    reverbGainNode.gain.setTargetAtTime(shouldUseReverb ? reverbAmount : 0, now, 0.12);
    if (shouldUseReverb && audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
}

function hasActiveAudioProcessing() {
    return Boolean(normalizeToggle?.checked) ||
        ((Number(reverbSlider?.value) || 0) > 0 && Number(mainPlayer?.playbackRate || 1) < 0.99) ||
        [eqBass, eqMid, eqTreble].some(slider => Math.abs(Number(slider?.value) || 0) > 0.001);
}

function setupAudioGraph() {
    if (audioCtx) return;
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const savedOutput = document.getElementById('audio-output-select')?.value;
    if (typeof audioCtx.setSinkId === 'function') {
        if (savedOutput && savedOutput !== 'default') {
            audioCtx.setSinkId(savedOutput).catch(error => console.warn('Could not restore audio output:', error));
        }
    } else if (audioOutputSelect) {
        audioOutputSelect.disabled = true;
        audioOutputSelect.title = 'Audio output selection is unavailable while audio processing is active.';
    }
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

    dryGainNode = audioCtx.createGain();
    reverbGainNode = audioCtx.createGain();
    reverbGainNode.gain.value = 0;
    reverbConvolver = audioCtx.createConvolver();
    const impulseLength = Math.floor(audioCtx.sampleRate * 1.8);
    const impulse = audioCtx.createBuffer(2, impulseLength, audioCtx.sampleRate);
    const earlyReflections = [
        [0.014, 0.42], [0.027, 0.28], [0.043, 0.19], [0.071, 0.12]
    ];
    const damping = Math.exp(-2 * Math.PI * 7200 / audioCtx.sampleRate);
    for (let channel = 0; channel < impulse.numberOfChannels; channel += 1) {
        const samples = impulse.getChannelData(channel);
        let filteredNoise = 0;
        for (let i = 0; i < impulseLength; i += 1) {
            const time = i / audioCtx.sampleRate;
            const fade = Math.pow(1 - time / 1.8, 2.1);
            filteredNoise = (Math.random() * 2 - 1) * (1 - damping) + filteredNoise * damping;
            let reflection = 0;
            for (const [delay, level] of earlyReflections) {
                const reflectionIndex = Math.round(delay * audioCtx.sampleRate);
                if (i === reflectionIndex + channel * Math.round(0.003 * audioCtx.sampleRate)) reflection += level;
            }
            samples[i] = filteredNoise * fade * 0.42 + reflection;
        }
        samples[0] += 0.55;
    }
    reverbConvolver.buffer = impulse;

    sourceNode.connect(bassFilter);
    bassFilter.connect(midFilter);
    midFilter.connect(trebleFilter);
    trebleFilter.connect(gainNode);
    gainNode.connect(dryGainNode);
    dryGainNode.connect(audioCtx.destination);
    gainNode.connect(reverbConvolver);
    reverbConvolver.connect(reverbGainNode);
    reverbGainNode.connect(audioCtx.destination);
    updateSlowReverb();
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

const audioOutputSelect = document.getElementById('audio-output-select');
async function applyAudioOutput(deviceId) {
    if (!audioOutputSelect) return;
    if (audioCtx && typeof audioCtx.setSinkId !== 'function') {
        audioOutputSelect.disabled = true;
        audioOutputSelect.title = 'Audio output selection is not supported while audio processing is active.';
        audioOutputSelect.dispatchEvent(new Event('app-select-sync'));
        return;
    }
    const target = audioCtx || mainPlayer;
    if (typeof target.setSinkId !== 'function') {
        audioOutputSelect.disabled = true;
        audioOutputSelect.title = 'Audio output selection is not supported by this system.';
        audioOutputSelect.dispatchEvent(new Event('app-select-sync'));
        return;
    }
    try {
        await target.setSinkId(deviceId || 'default');
        localStorage.setItem('music-app-audio-output', deviceId || 'default');
        audioOutputSelect.title = `Audio output: ${audioOutputSelect.selectedOptions[0]?.textContent || 'Default output'}`;
        audioOutputSelect.dispatchEvent(new Event('app-select-sync'));
    } catch (error) {
        console.warn('Could not switch audio output:', error);
        audioOutputSelect.title = 'Could not switch to this output device.';
        audioOutputSelect.value = localStorage.getItem('music-app-audio-output') || 'default';
        audioOutputSelect.dispatchEvent(new Event('app-select-sync'));
    }
}

async function refreshAudioOutputDevices() {
    if (!audioOutputSelect || !navigator.mediaDevices?.enumerateDevices) return;
    try {
        const devices = (await navigator.mediaDevices.enumerateDevices()).filter(device => device.kind === 'audiooutput' && device.deviceId !== 'default');
        const saved = localStorage.getItem('music-app-audio-output') || 'default';
        audioOutputSelect.replaceChildren(new Option('Default output', 'default'));
        devices.forEach((device, index) => {
            audioOutputSelect.add(new Option(device.label || `Audio output ${index + 1}`, device.deviceId));
        });
        audioOutputSelect.value = [...audioOutputSelect.options].some(option => option.value === saved) ? saved : 'default';
        audioOutputSelect.title = `Audio output: ${audioOutputSelect.selectedOptions[0]?.textContent || 'Default output'}`;
        audioOutputSelect.dispatchEvent(new Event('app-select-sync'));
        if (typeof mainPlayer.setSinkId !== 'function' && typeof audioCtx?.setSinkId !== 'function') {
            audioOutputSelect.disabled = true;
            audioOutputSelect.title = 'Audio output selection is not supported by this system.';
        } else {
            await applyAudioOutput(audioOutputSelect.value);
        }
    } catch (error) {
        console.warn('Could not list audio output devices:', error);
        audioOutputSelect.title = 'Audio output devices are unavailable.';
        audioOutputSelect.dispatchEvent(new Event('app-select-sync'));
    }
}

audioOutputSelect?.addEventListener('change', () => applyAudioOutput(audioOutputSelect.value));
navigator.mediaDevices?.addEventListener?.('devicechange', refreshAudioOutputDevices);
refreshAudioOutputDevices();

if (eqToggleBtn && eqPanel) {
    eqToggleBtn.addEventListener('click', () => {
        const isOpen = eqPanel.style.display === 'none';
        eqPanel.style.display = isOpen ? 'flex' : 'none';
        eqToggleBtn.setAttribute('aria-expanded', String(isOpen));
    });
    document.addEventListener('click', (event) => {
        if (eqPanel.style.display !== 'none' && !eqPanel.contains(event.target) && !eqToggleBtn.contains(event.target)) {
            eqPanel.style.display = 'none';
            eqToggleBtn.setAttribute('aria-expanded', 'false');
        }
    });
}

function saveEqSettings() {
    if (!window.electronAPI) return;
    const changes = {
        eq: {
            bass: eqBass ? parseFloat(eqBass.value) : 0,
            mid: eqMid ? parseFloat(eqMid.value) : 0,
            treble: eqTreble ? parseFloat(eqTreble.value) : 0
        },
        slowPlaybackReverb: Number(reverbSlider?.value) || 0
    };
    publishSettingsChange(changes);
    window.electronAPI.saveSettings(changes).catch(() => {});
}

const updateEqGraph = () => {
    updateEqReadouts();
    if (!audioCtx && !mainPlayer.paused && hasActiveAudioProcessing()) setupAudioGraph();
    if (bassFilter) bassFilter.gain.value = parseFloat(eqBass?.value) || 0;
    if (midFilter) midFilter.gain.value = parseFloat(eqMid?.value) || 0;
    if (trebleFilter) trebleFilter.gain.value = parseFloat(eqTreble?.value) || 0;
};

window.addEventListener('music-settings-change', event => {
    const changes = event.detail || {};
    Object.assign(appSettings, changes);
    if (Object.hasOwn(changes, 'homeHeaderCollapse')) syncHomeHeaderCollapse();
    if (Object.hasOwn(changes, 'volume') || Object.hasOwn(changes, 'muted')) applyVolumeSettings();
    if (changes.eq || Object.hasOwn(changes, 'normalize') || Object.hasOwn(changes, 'slowPlaybackReverb')) {
        applyEqSettings();
        if (!audioCtx && !mainPlayer.paused && hasActiveAudioProcessing()) setupAudioGraph();
        updateEqGraph();
        setNormalization(!!normalizeToggle?.checked);
        updateSlowReverb();
    }
});

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
        const changes = { normalize: normalizeToggle.checked };
        publishSettingsChange(changes);
        window.electronAPI.saveSettings(changes).catch(() => {});
    }
});
if (playbackSpeedSlider) playbackSpeedSlider.addEventListener('change', saveEqSettings);
if (reverbSlider) {
    reverbSlider.addEventListener('input', () => {
        appSettings.slowPlaybackReverb = Number(reverbSlider.value) || 0;
        updateReverbReadout();
        if (!audioCtx && !mainPlayer.paused && hasActiveAudioProcessing()) {
            setupAudioGraph();
            setNormalization(!!normalizeToggle?.checked);
        }
        updateSlowReverb();
    });
    reverbSlider.addEventListener('change', saveEqSettings);
}

})();
