const fileUpload = document.getElementById('file-upload');
const tracklist = document.getElementById('tracklist');
const headerCover = document.getElementById('header-cover');
const mainPlayer = document.getElementById('main-player');

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

const DEFAULT_COVER = '../images/music.png';
const SUPPORTED_EXTENSIONS = /\.(mp3|wav)$/i;

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str ?? '';
    return div.innerHTML;
}

function stripExtension(fileName) {
    return fileName.replace(/\.[^/.]+$/, '');
}
//update the cover img at the top of home
function updateHeaderCover() {
    if (currentTrackIndex !== -1 && playlist[currentTrackIndex]?.imageUrl) {
        headerCover.src = playlist[currentTrackIndex].imageUrl;
    } else if (playlist.length > 0 && playlist[0]?.imageUrl) {
        headerCover.src = playlist[0].imageUrl;
    } else {
        headerCover.src = DEFAULT_COVER;
    }
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
        if (trackMatchesQuery(track, query)) {
            tracklist.appendChild(createTrackElement(track, index));
        }
    });
    updateHeaderCover();
}

window.applyLibrarySearch = (query) => renderTracklist(query);

function createTrackElement(track, index) {
    const trackItem = document.createElement('div');
    trackItem.className = 'track-item';

    trackItem.innerHTML = `
        <div class="track-index">${index + 1}</div>
        <div class="track-info-col">
            <div class="track-cover-wrapper" title="Click to change cover">
                <img class="track-cover-img" src="${track.imageUrl || DEFAULT_COVER}">
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
    trackItem.addEventListener('click', () => loadTrack(index));

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

        if (window.electronAPI) {
            window.electronAPI.updateTrack(track.path, { imageUrl: dataUrl })
                .catch(err => console.error('Failed to save cover:', err));
        }
    };
    reader.onerror = () => console.error('Failed to read cover image file');
    reader.readAsDataURL(file);
}

function handleAlbumEdit(index, newAlbumText) {
    const track = playlist[index];
    if (!track) return;

    const newAlbum = newAlbumText.trim() || 'Unknown Album';
    track.data.album = newAlbum;

    const albumEl = tracklist.children[index]?.querySelector('.track-album');
    if (albumEl) albumEl.textContent = newAlbum;

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


function formatTime(seconds) {
    if (!isFinite(seconds) || seconds < 0) seconds = 0;
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
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
});


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

function saveSession() {
    if (!window.electronAPI || appSettings.resumeSession === false) return;
    const track = playlist[currentTrackIndex];
    window.electronAPI.saveSettings({
        lastSession: {
            trackPath: track ? track.path : null,
            position: mainPlayer.currentTime || 0
        }
    }).catch(() => {});
}

mainPlayer.addEventListener('timeupdate', () => {
    if (sessionSaveTimer) return;
    sessionSaveTimer = setTimeout(() => {
        sessionSaveTimer = null;
        saveSession();
    }, 3000);
});
mainPlayer.addEventListener('pause', saveSession);
window.addEventListener('beforeunload', saveSession);


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
                    imageUrl: track.imageUrl || ''
                });
            });
        renderTracklist();
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
    ]).then(([, settings]) => {
        appSettings = settings || {};
        applyVolumeSettings();
        applyEqSettings();

        const lastSession = appSettings.lastSession;
        if (appSettings.resumeSession !== false && lastSession && lastSession.trackPath) {
            const idx = playlist.findIndex(t => t.path === lastSession.trackPath);
            if (idx !== -1) {
                currentTrackIndex = idx;
                mainPlayer.src = window.electronAPI.toMediaUrl(playlist[idx].path);
                updateHeaderCover();
                const resumePosition = lastSession.position || 0;
                mainPlayer.addEventListener('loadedmetadata', function restorePosition() {
                    mainPlayer.currentTime = Math.min(resumePosition, mainPlayer.duration || resumePosition);
                    mainPlayer.removeEventListener('loadedmetadata', restorePosition);
                });
            }
        }
    });

    window.electronAPI.onLibraryUpdated(() => {
        loadLibraryFromDisk();
    });
}

function loadTrack(index) {
    if (index < 0 || index >= playlist.length) return;
    const track = playlist[index];
    if (!track.path) {
        console.error('Track has no file path, skipping:', track.name);
        return;
    }

    currentTrackIndex = index;
    mainPlayer.src = window.electronAPI.toMediaUrl(track.path);
    updateHeaderCover();
    
    mainPlayer.play().catch(err => console.error("Playback error:", err));
}

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
});

mainPlayer.addEventListener('pause', () => {
    playIcon.src = '../images/play.png';
});

function playNext() {
    if (playlist.length === 0) return;
    let nextIndex = currentTrackIndex + 1;
    
    if (isShuffle) {
        nextIndex = Math.floor(Math.random() * playlist.length);
    } else if (nextIndex >= playlist.length) {
        if (isRepeatAll) {
            nextIndex = 0;
        } else {
            return;
        }
    }
    loadTrack(nextIndex);
}

function playPrev() {
    if (playlist.length === 0) return;
    let prevIndex = currentTrackIndex - 1;
    if (prevIndex < 0) prevIndex = playlist.length - 1;
    loadTrack(prevIndex);
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

function addTrack(filePath, fileName, data, imageUrl, saveToDb = true) {
    if (playlist.find(t => t.path === filePath)) return;

    const trackObj = { path: filePath, name: fileName, data, imageUrl: imageUrl || '' };
    playlist.push(trackObj);
    renderTracklist();

    if (saveToDb && window.electronAPI) {
        window.electronAPI.saveTrack(trackObj).catch(err => console.error('Failed to save track:', err));
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

        jsmediatags.read(file, {
            onSuccess: function(tag) {
                const data = tag.tags;
                let imageUrl = '';
                
                if (data.picture) {
                    const { data: pictureData, format } = data.picture;
                    let base64String = "";
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

                addTrack(filePath, file.name, cleanData, imageUrl, true);
            },
            onError: function() {
                addTrack(filePath, file.name, {}, '', true);
            }
        });
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