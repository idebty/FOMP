(function () {
    const lyricsView = document.getElementById('lyrics-view');
    const lyricsNavButton = document.getElementById('lyrics-nav-btn');
    const lyricsCover = document.getElementById('lyrics-cover');
    const lyricsTitle = document.getElementById('lyrics-title');
    const lyricsArtist = document.getElementById('lyrics-artist');
    const lyricsStatus = document.getElementById('lyrics-status');
    const lyricsLines = document.getElementById('lyrics-lines');
    const lyricsImportInput = document.getElementById('lyrics-import-input');
    const lyricsSearchForm = document.getElementById('lyrics-search-form');
    const lyricsSearchTitle = document.getElementById('lyrics-search-title');
    const lyricsSuggestions = document.getElementById('lyrics-search-suggestions');
    const lyricsSearchWrap = document.querySelector('.lyrics-search-wrap');
    const mainPlayer = document.getElementById('main-player');
    const defaultCover = '../images/music.png';

    if (!lyricsView || !lyricsNavButton || !mainPlayer) return;

    const resultCache = new Map();
    let getCurrentTrack = () => null;
    let activeTrack = null;
    let requestId = 0;
    let activeLineIndex = -1;
    let activeLines = null;
    let suggestionRequestId = 0;
    let suggestionTimer = null;

    function trackTitle(track) {
        return track?.data?.title || String(track?.name || '').replace(/\.[^/.]+$/, '') || 'Unknown Title';
    }

    function artworkSource(track) {
        if (track?.imageUrl) return track.imageUrl;
        if (track?.imagePath && window.electronAPI?.toArtworkUrl) {
            return window.electronAPI.toArtworkUrl(track.imagePath);
        }
        return defaultCover;
    }

    function parseSyncedLyrics(value) {
        const lines = [];
        String(value || '').split(/\r?\n/).forEach(rawLine => {
            const timestamps = Array.from(rawLine.matchAll(/\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]/g));
            if (!timestamps.length) return;
            const text = rawLine.replace(/\[\d{1,2}:\d{2}(?:[.:]\d{1,3})?\]/g, '').trim();
            if (!text) return;
            timestamps.forEach(match => {
                lines.push({
                    time: Number(match[1]) * 60 + Number(match[2]) + (match[3] ? Number(`0.${match[3]}`) : 0),
                    text
                });
            });
        });
        return lines.sort((left, right) => left.time - right.time);
    }

    function updateActiveLine(forceScroll = false) {
        if (!activeLines?.synced) return;
        let nextIndex = -1;
        for (let index = 0; index < activeLines.lines.length; index += 1) {
            if (activeLines.lines[index].time > mainPlayer.currentTime) break;
            nextIndex = index;
        }
        if (nextIndex === activeLineIndex && !forceScroll) return;
        activeLineIndex = nextIndex;
        activeLines.elements.forEach((element, index) => {
            element.classList.toggle('active', index === activeLineIndex);
        });
        const activeElement = activeLines.elements[activeLineIndex];
        if (activeElement && lyricsView.classList.contains('is-visible')) {
            activeElement.scrollIntoView({ behavior: forceScroll ? 'auto' : 'smooth', block: 'center' });
        }
    }

    function showMessage(status, message) {
        lyricsStatus.textContent = status;
        lyricsLines.replaceChildren();
        activeLines = null;
        activeLineIndex = -1;
        if (message) {
            const hint = document.createElement('p');
            hint.className = 'lyrics-empty';
            hint.textContent = message;
            lyricsLines.appendChild(hint);
        }
    }

    function renderLyrics(track, result) {
        const displayTitle = track?.lyricsSearchTitle || trackTitle(track);
        lyricsTitle.textContent = displayTitle;
        lyricsArtist.textContent = track?.data?.artist || 'Unknown Artist';
        lyricsCover.src = artworkSource(track);
        lyricsCover.alt = `${displayTitle} cover`;
        lyricsCover.onerror = () => { lyricsCover.src = defaultCover; };
        lyricsLines.replaceChildren();
        activeLines = null;
        activeLineIndex = -1;

        if (!result || result.status === 'unavailable') {
            showMessage('Lyrics are unavailable.', 'Connect to the internet and select this song again to retry online lyrics.');
            return;
        }
        if (result.status === 'instrumental') {
            showMessage('No lyrics found for this instrumental track.');
            return;
        }
        if (result.status !== 'found') {
            showMessage('No matching lyrics found.', 'You can import an .lrc or .txt file for this song.');
            return;
        }

        const synced = parseSyncedLyrics(result.syncedLyrics);
        const isSynced = synced.length > 0;
        const lines = isSynced
            ? synced
            : String(result.plainLyrics || '').split(/\r?\n/).filter(line => line.trim()).map(text => ({ text }));
        if (!lines.length) {
            showMessage('No matching lyrics found.', 'You can import an .lrc or .txt file for this song.');
            return;
        }

        const isLocal = result.source === 'local';
        const isCached = result.source === 'cached';
        lyricsStatus.textContent = isLocal
            ? (isSynced ? 'Imported synced lyrics' : 'Imported local lyrics')
            : isCached
                ? (isSynced ? 'Synced lyrics saved locally' : 'Lyrics saved locally · timing unavailable')
                : (isSynced ? 'Synced lyrics from LRCLIB' : 'Lyrics from LRCLIB · timing unavailable');

        const elements = lines.map(line => {
            const element = document.createElement(isSynced ? 'button' : 'div');
            if (isSynced) {
                element.type = 'button';
                element.dataset.time = line.time;
                element.addEventListener('click', () => {
                    mainPlayer.currentTime = Math.min(line.time, Number.isFinite(mainPlayer.duration) ? mainPlayer.duration : line.time);
                    updateActiveLine(true);
                });
            }
            element.className = 'lyric-line';
            element.textContent = line.text;
            lyricsLines.appendChild(element);
            return element;
        });
        activeLines = { synced: isSynced, lines, elements };
        updateActiveLine(true);
    }

    function isCurrentRequest(id, track) {
        return id === requestId && getCurrentTrack()?.path === track.path;
    }

    async function loadLyrics(track) {
        const id = ++requestId;
        activeTrack = track;
        if (!track) {
            lyricsTitle.textContent = 'Nothing playing';
            lyricsArtist.textContent = '';
            if (lyricsSearchTitle) lyricsSearchTitle.value = '';
            lyricsCover.src = defaultCover;
            lyricsStatus.textContent = 'Play a song to find its lyrics.';
            lyricsLines.replaceChildren();
            activeLines = null;
            return;
        }

        const displayTitle = track.lyricsSearchTitle || trackTitle(track);
        lyricsTitle.textContent = displayTitle;
        lyricsArtist.textContent = track.data?.artist || 'Unknown Artist';
        lyricsCover.src = artworkSource(track);
        lyricsCover.alt = `${displayTitle} cover`;
        if (lyricsSearchTitle) lyricsSearchTitle.value = displayTitle;
        lyricsStatus.textContent = 'Searching for lyrics…';
        lyricsLines.replaceChildren();
        activeLines = null;

        try {
            const hasInlineLyrics = ['local', 'cached'].includes(track.lyrics?.source) &&
                (track.lyrics.syncedLyrics || track.lyrics.plainLyrics);
            const local = hasInlineLyrics
                ? { ...track.lyrics, searchTitle: track.lyricsSearchTitle || '' }
                : await window.electronAPI?.getTrackLyrics?.(track.path);
            if (!isCurrentRequest(id, track)) return;
            if (local && (local.source === 'local' || local.source === 'cached') && (local.syncedLyrics || local.plainLyrics)) {
                track.lyrics = local;
                track.lyricsSearchTitle = local.searchTitle || track.lyricsSearchTitle || '';
                if (lyricsSearchTitle) lyricsSearchTitle.value = track.lyricsSearchTitle || trackTitle(track);
                renderLyrics(track, { status: 'found', ...local });
                return;
            }

            if (resultCache.has(track.path)) {
                renderLyrics(track, resultCache.get(track.path));
                return;
            }
            if (!window.electronAPI?.findLyrics) {
                renderLyrics(track, { status: 'unavailable' });
                return;
            }

            const searchTitle = track.lyricsSearchTitle || trackTitle(track);
            let result = await window.electronAPI.findLyrics({
                trackName: searchTitle,
                artistName: track.data?.artist || '',
                albumName: track.data?.album || ''
            });
            if (!isCurrentRequest(id, track)) return;
            if (result?.status === 'found') {
                const cachedLyrics = {
                    source: 'cached',
                    plainLyrics: result.plainLyrics || '',
                    syncedLyrics: result.syncedLyrics || '',
                    searchTitle
                };
                const saved = await window.electronAPI?.saveTrackLyrics?.(track.path, cachedLyrics);
                if (saved?.success) {
                    track.lyrics = { source: 'cached', plainLyrics: cachedLyrics.plainLyrics, syncedLyrics: cachedLyrics.syncedLyrics };
                    track.lyricsSearchTitle = searchTitle;
                    result = { ...result, source: 'cached' };
                }
            }
            if (!isCurrentRequest(id, track)) return;
            if (result?.status !== 'unavailable') resultCache.set(track.path, result);
            renderLyrics(track, result);
        } catch (error) {
            console.error('Lyrics lookup failed:', error);
            if (isCurrentRequest(id, track)) renderLyrics(track, { status: 'unavailable' });
        }
    }

    function setSuggestionsVisible(visible) {
        if (!visible) suggestionRequestId += 1;
        if (!lyricsSuggestions) return;
        lyricsSuggestions.hidden = !visible;
        lyricsSearchTitle?.setAttribute('aria-expanded', String(visible));
    }

    function renderSuggestions(suggestions, emptyMessage = 'No song suggestions found.') {
        if (!lyricsSuggestions) return;
        lyricsSuggestions.replaceChildren();
        if (!suggestions.length) {
            const empty = document.createElement('p');
            empty.className = 'lyrics-suggestion-empty';
            empty.textContent = emptyMessage;
            lyricsSuggestions.appendChild(empty);
            setSuggestionsVisible(true);
            return;
        }

        suggestions.forEach(suggestion => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'lyrics-suggestion';
            button.setAttribute('role', 'option');
            button.setAttribute('aria-selected', 'false');
            const title = document.createElement('span');
            title.className = 'lyrics-suggestion-title';
            title.textContent = suggestion.trackName;
            const details = document.createElement('span');
            details.className = 'lyrics-suggestion-details';
            details.textContent = [suggestion.artistName, suggestion.albumName].filter(Boolean).join(' · ') || 'Unknown artist';
            button.append(title, details);
            button.addEventListener('click', () => {
                lyricsSearchTitle.value = suggestion.trackName;
                setSuggestionsVisible(false);
                searchLyricsByTitle(suggestion);
            });
            lyricsSuggestions.appendChild(button);
        });
        setSuggestionsVisible(true);
    }

    async function loadLyricsSuggestions() {
        const query = lyricsSearchTitle?.value.trim() || '';
        if (query.length < 2 || !window.electronAPI?.suggestLyrics) {
            setSuggestionsVisible(false);
            return;
        }
        const id = ++suggestionRequestId;
        if (lyricsSuggestions) {
            const loading = document.createElement('p');
            loading.className = 'lyrics-suggestion-empty';
            loading.textContent = 'Finding songs…';
            lyricsSuggestions.replaceChildren(loading);
            setSuggestionsVisible(true);
        }
        try {
            const suggestions = await window.electronAPI.suggestLyrics({ trackName: query });
            if (id !== suggestionRequestId || lyricsSearchTitle?.value.trim() !== query) return;
            if (Array.isArray(suggestions)) renderSuggestions(suggestions);
            else renderSuggestions([], 'Song suggestions are unavailable.');
        } catch (error) {
            console.error('Lyrics suggestions failed:', error);
            if (id === suggestionRequestId) renderSuggestions([], 'Song suggestions are unavailable.');
        }
    }

    async function searchLyricsByTitle(selectedSuggestion = null) {
        const track = getCurrentTrack();
        const searchTitle = selectedSuggestion?.trackName || lyricsSearchTitle?.value.trim() || '';
        if (!track) {
            lyricsStatus.textContent = 'Play a song before searching for lyrics.';
            return;
        }
        if (!searchTitle) {
            lyricsStatus.textContent = 'Enter the correct song title to search.';
            lyricsSearchTitle?.focus();
            return;
        }
        if (!window.electronAPI?.findLyrics) {
            lyricsStatus.textContent = 'Lyrics search is unavailable.';
            return;
        }

        const id = ++requestId;
        activeTrack = track;
        lyricsTitle.textContent = searchTitle;
        lyricsStatus.textContent = 'Searching for lyrics…';
        lyricsLines.replaceChildren();
        activeLines = null;
        try {
            let result = await window.electronAPI.findLyrics({
                trackName: searchTitle,
                artistName: selectedSuggestion?.artistName || track.data?.artist || '',
                albumName: selectedSuggestion?.albumName || track.data?.album || ''
            });
            if (!isCurrentRequest(id, track)) return;
            const cachedLyrics = {
                source: 'cached',
                plainLyrics: result?.plainLyrics || '',
                syncedLyrics: result?.syncedLyrics || '',
                searchTitle
            };
            const saved = result?.status === 'unavailable'
                ? null
                : await window.electronAPI.saveTrackLyrics?.(track.path, cachedLyrics);
            if (saved?.success) {
                track.lyricsSearchTitle = searchTitle;
                if (saved.lyricsCleared) track.lyrics = null;
            }
            if (result?.status === 'found' && saved?.success) {
                track.lyrics = { source: 'cached', plainLyrics: cachedLyrics.plainLyrics, syncedLyrics: cachedLyrics.syncedLyrics };
                result = { ...result, source: 'cached' };
            }
            if (!isCurrentRequest(id, track)) return;
            if (result?.status !== 'unavailable') resultCache.set(track.path, result);
            renderLyrics(track, result);
        } catch (error) {
            console.error('Manual lyrics search failed:', error);
            if (isCurrentRequest(id, track)) renderLyrics(track, { status: 'unavailable' });
        }
    }

    async function importLyrics(file) {
        const track = getCurrentTrack();
        if (!file || !track) {
            lyricsStatus.textContent = 'Play a song before importing its lyrics.';
            return;
        }
        if (!/\.(lrc|txt)$/i.test(file.name)) {
            lyricsStatus.textContent = 'Choose an .lrc or .txt lyrics file.';
            return;
        }

        try {
            const text = (await file.text()).replace(/^\uFEFF/, '').trim();
            if (!text) {
                lyricsStatus.textContent = 'That lyrics file is empty.';
                return;
            }
            const hasTimestamps = /\[\d{1,2}:\d{2}(?:[.:]\d{1,3})?\]/.test(text);
            const id = ++requestId;
            const lyrics = {
                source: 'local',
                syncedLyrics: hasTimestamps ? text : '',
                plainLyrics: text.replace(/\[\d{1,2}:\d{2}(?:[.:]\d{1,3})?\]/g, '').trim()
            };
            const saved = await window.electronAPI?.saveTrackLyrics?.(track.path, lyrics);
            if (!saved?.success) throw new Error(saved?.error || 'Could not save lyrics for this song.');
            track.lyrics = lyrics;
            resultCache.delete(track.path);
            if (isCurrentRequest(id, track)) renderLyrics(track, { status: 'found', ...lyrics });
        } catch (error) {
            console.error('Lyrics import failed:', error);
            lyricsStatus.textContent = error.message || 'Could not import that lyrics file.';
        }
    }

    function open() {
        lyricsView.classList.add('is-visible');
        lyricsNavButton.classList.add('active');
        lyricsNavButton.setAttribute('aria-pressed', 'true');
        const track = getCurrentTrack();
        if (track?.path !== activeTrack?.path) loadLyrics(track);
        else if (activeLines?.synced) updateActiveLine(true);
    }

    function close() {
        lyricsView.classList.remove('is-visible');
        lyricsNavButton.classList.remove('active');
        lyricsNavButton.setAttribute('aria-pressed', 'false');
    }

    lyricsNavButton.addEventListener('click', () => {
        if (lyricsView.classList.contains('is-visible')) close();
        else open();
    });
    lyricsSearchForm?.addEventListener('submit', async event => {
        event.preventDefault();
        setSuggestionsVisible(false);
        await searchLyricsByTitle();
    });
    lyricsSearchTitle?.addEventListener('input', () => {
        clearTimeout(suggestionTimer);
        suggestionTimer = setTimeout(loadLyricsSuggestions, 280);
    });
    lyricsSearchTitle?.addEventListener('keydown', event => {
        if (event.key === 'ArrowDown' && !lyricsSuggestions?.hidden) {
            event.preventDefault();
            lyricsSuggestions.querySelector('.lyrics-suggestion')?.focus();
        } else if (event.key === 'Escape') {
            setSuggestionsVisible(false);
        }
    });
    lyricsSuggestions?.addEventListener('keydown', event => {
        if (event.key === 'Escape') {
            setSuggestionsVisible(false);
            lyricsSearchTitle?.focus();
            return;
        }
        if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return;
        const buttons = Array.from(lyricsSuggestions.querySelectorAll('.lyrics-suggestion'));
        const index = buttons.indexOf(document.activeElement);
        const nextIndex = event.key === 'ArrowDown'
            ? Math.min(index + 1, buttons.length - 1)
            : Math.max(index - 1, -1);
        event.preventDefault();
        if (nextIndex < 0) lyricsSearchTitle?.focus();
        else buttons[nextIndex]?.focus();
    });
    document.addEventListener('click', event => {
        if (!lyricsSearchWrap?.contains(event.target)) setSuggestionsVisible(false);
    });
    lyricsImportInput?.addEventListener('change', async event => {
        await importLyrics(event.target.files?.[0]);
        event.target.value = '';
    });
    mainPlayer.addEventListener('timeupdate', () => updateActiveLine());

    window.createLyricsController = options => {
        getCurrentTrack = options?.getCurrentTrack || (() => null);
        return {
            open,
            close,
            setTrack: loadLyrics,
            isOpen: () => lyricsView.classList.contains('is-visible')
        };
    };
})();
