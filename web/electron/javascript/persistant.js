
const currentDocument = window.location.pathname.split('/').pop().toLowerCase();
if (currentDocument !== 'persistent.html' && ['home.html', 'playlists.html', 'settings.html', 'credits.html'].includes(currentDocument)) {
    const legacyPage = currentDocument.replace(/\.html$/i, '');
    const destination = new URL('persistent.html', window.location.href);
    const legacyQuery = new URLSearchParams(window.location.search);
    if (!legacyQuery.has('view')) legacyQuery.set('view', legacyPage === 'credits' ? 'credits' : legacyPage);
    destination.search = legacyQuery.toString();
    window.location.replace(destination.href);
}

// Custom CSS is shared by every app page and stays after the built-in styles.
window.applyCustomStylesheet = css => {
    let style = document.getElementById('user-custom-stylesheet');
    if (!style) { style = document.createElement('style'); style.id = 'user-custom-stylesheet'; document.head.appendChild(style); }
    style.textContent = typeof css === 'string' ? css : '';
};

const sidebarCompactStorageKey = 'music-app-sidebar-compact';
function applySidebarCompactMode(enabled) {
    const isCompact = Boolean(enabled);
    document.body.classList.toggle('sidebar-compact', isCompact);
    document.querySelectorAll('.sidebar').forEach(sidebar => {
        sidebar.classList.toggle('is-compact', isCompact);
        const toggle = sidebar.querySelector('.sidebar-compact-toggle');
        if (toggle) {
            toggle.dataset.compact = String(isCompact);
            toggle.setAttribute('aria-expanded', String(!isCompact));
            toggle.setAttribute('aria-label', isCompact ? 'Expand sidebar' : 'Show icons and artwork only');
            toggle.title = isCompact ? 'Expand sidebar' : 'Show icons and artwork only';
        }
    });
}
function initializeSidebarCompactMode(root = document) {
    const sidebars = root.matches?.('.sidebar') ? [root] : [...(root.querySelectorAll?.('.sidebar') || [])];
    sidebars.forEach(sidebar => {
        if (sidebar.querySelector('.sidebar-compact-toggle')) return;
        if (!sidebar.querySelector('[data-nav]')) return;
        const toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.className = 'sidebar-compact-toggle';
        toggle.innerHTML = '<svg class="sidebar-compact-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3.5" width="18" height="17" rx="3"></rect><path d="M9 4v16"></path></svg>';
        toggle.setAttribute('aria-expanded', 'true');
        toggle.setAttribute('aria-label', 'Show icons and artwork only');
        toggle.title = 'Show icons and artwork only';
        toggle.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();
            const enabled = !document.body.classList.contains('sidebar-compact');
            try { localStorage.setItem(sidebarCompactStorageKey, enabled ? '1' : '0'); } catch (_) {}
            applySidebarCompactMode(enabled);
        });
        sidebar.append(toggle);
    });
    applySidebarCompactMode(localStorage.getItem(sidebarCompactStorageKey) === '1');
}
initializeSidebarCompactMode();
window.electronAPI?.getSettings?.().then(settings => window.applyCustomStylesheet(settings?.customStylesheet || '')).catch(() => {});

function enhanceSelect(select) {
    if (!(select instanceof HTMLSelectElement) || select.dataset.customized === 'true') return;
    select.dataset.customized = 'true';
    const wrap = document.createElement('div');
    wrap.className = 'app-select-wrap';
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = `app-select-trigger ${select.className}`.trim();
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');
    trigger.setAttribute('aria-label', select.getAttribute('aria-label') || select.name || 'Choose an option');
    let leadingIcon = null;
    if (select.dataset.triggerIcon === 'sort') {
        leadingIcon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        leadingIcon.classList.add('app-select-icon');
        leadingIcon.setAttribute('viewBox', '0 0 24 24');
        leadingIcon.setAttribute('aria-hidden', 'true');
        leadingIcon.innerHTML = '<path d="M4 6h16M7 12h10m-7 6h4"></path><path d="m17 8 3-2-3-2M7 16l-3 2 3 2"></path>';
    }
    const current = document.createElement('span');
    current.className = 'app-select-current';
    const chevron = document.createElement('svg');
    chevron.classList.add('app-select-chevron');
    chevron.setAttribute('viewBox', '0 0 24 24');
    chevron.setAttribute('aria-hidden', 'true');
    chevron.innerHTML = '<path d="m7 10 5 5 5-5"></path>';
    trigger.append(...[leadingIcon, current, chevron].filter(Boolean));
    const menu = document.createElement('div');
    menu.className = 'app-select-menu';
    menu.setAttribute('role', 'listbox');
    menu.hidden = true;
    const sync = () => {
        const option = select.selectedOptions[0];
        current.textContent = option?.textContent?.trim() || 'Choose an option';
        trigger.title = select.dataset.triggerIcon === 'sort'
            ? `${select.getAttribute('aria-label') || 'Sort'}: ${current.textContent}`
            : select.title || current.textContent;
        trigger.disabled = select.disabled;
        menu.replaceChildren();
        [...select.options].forEach(item => {
            const choice = document.createElement('button');
            choice.type = 'button';
            choice.className = 'app-select-option';
            choice.setAttribute('role', 'option');
            choice.setAttribute('aria-selected', String(item.value === select.value));
            choice.disabled = item.disabled;
            choice.textContent = item.textContent.trim();
            choice.addEventListener('click', () => {
                if (select.value !== item.value) {
                    select.value = item.value;
                    select.dispatchEvent(new Event('change', { bubbles: true }));
                }
                close();
                trigger.focus();
            });
            menu.appendChild(choice);
        });
    };
    const close = () => {
        wrap.classList.remove('is-open');
        menu.hidden = true;
        trigger.setAttribute('aria-expanded', 'false');
    };
    const open = () => {
        document.querySelectorAll('.app-select-wrap.is-open').forEach(other => {
            if (other !== wrap) {
                other.classList.remove('is-open');
                other.querySelector('.app-select-menu').hidden = true;
                other.querySelector('.app-select-trigger').setAttribute('aria-expanded', 'false');
            }
        });
        sync();
        wrap.classList.add('is-open');
        menu.hidden = false;
        trigger.setAttribute('aria-expanded', 'true');
        menu.querySelector('[aria-selected="true"]')?.focus();
    };
    const observer = new MutationObserver(sync);
    observer.observe(select, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled', 'selected', 'label'] });
    select.addEventListener('change', sync);
    select.addEventListener('app-select-sync', sync);
    trigger.addEventListener('click', () => menu.hidden ? open() : close());
    trigger.addEventListener('keydown', event => {
        if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            open();
        }
    });
    menu.addEventListener('keydown', event => {
        const items = [...menu.querySelectorAll('.app-select-option:not(:disabled)')];
        const currentIndex = items.indexOf(document.activeElement);
        if (event.key === 'Escape') { event.preventDefault(); close(); trigger.focus(); }
        else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            const next = event.key === 'ArrowDown' ? currentIndex + 1 : currentIndex - 1;
            items[Math.max(0, Math.min(items.length - 1, next))]?.focus();
        } else if (event.key === 'Home') { event.preventDefault(); items[0]?.focus(); }
        else if (event.key === 'End') { event.preventDefault(); items.at(-1)?.focus(); }
    });
    select.before(wrap);
    wrap.append(select, trigger, menu);
    select.classList.add('app-select-native');
    sync();
}

function enhanceSelects(root = document) {
    root.querySelectorAll?.('select:not([data-customized="true"])').forEach(enhanceSelect);
}
enhanceSelects();
const selectDiscoveryObserver = new MutationObserver(records => {
    records.forEach(record => record.addedNodes.forEach(node => {
        if (node.nodeType !== Node.ELEMENT_NODE) return;
        if (node.matches?.('select')) enhanceSelect(node);
        enhanceSelects(node);
    }));
});
selectDiscoveryObserver.observe(document.body, { childList: true, subtree: true });
document.addEventListener('click', event => {
    document.querySelectorAll('.app-select-wrap.is-open').forEach(wrap => {
        if (wrap.contains(event.target)) return;
        wrap.classList.remove('is-open');
        wrap.querySelector('.app-select-menu').hidden = true;
        wrap.querySelector('.app-select-trigger').setAttribute('aria-expanded', 'false');
    });
});

const appPages = new Set(['home', 'playlists', 'settings', 'credits', 'privacy']);

function routeFromUrl(url) {
    const page = new URL(url).pathname.split('/').pop().replace(/\.html$/i, '').toLowerCase();
    if (appPages.has(page)) return page;
    if (page === 'persistent') {
        const requestedView = new URL(url).searchParams.get('view');
        if (appPages.has(requestedView)) return requestedView;
    }
    return 'home';
}

function persistentUrlFor(url, page) {
    const source = new URL(url);
    const persistentUrl = new URL('persistent.html', window.location.href);
    persistentUrl.search = source.search;
    persistentUrl.searchParams.set('view', page);
    persistentUrl.hash = source.hash;
    return persistentUrl;
}

function renderAppPage(page) {
    if (!appPages.has(page)) page = 'home';
    if (document.getElementById('lyrics-view')?.classList.contains('is-visible')) window.closeLyricsView?.();
    const main = document.getElementById('app-main');
    main?.classList.toggle('settings-page', page === 'settings');
    main?.classList.toggle('credits-page', page === 'credits' || page === 'privacy');
    document.querySelectorAll('[data-app-view]').forEach(view => {
        const isActive = view.dataset.appView === page;
        view.hidden = !isActive;
        view.classList.toggle('is-active', isActive);
        view.setAttribute('aria-hidden', String(!isActive));
    });
    document.querySelectorAll('[data-nav]').forEach(button => {
        const isActive = button.dataset.nav === (['credits', 'privacy'].includes(page) ? 'settings' : page);
        button.classList.toggle('active', isActive);
        if (isActive) button.setAttribute('aria-current', 'page');
        else button.removeAttribute('aria-current');
    });
    window.applyLibrarySearch = page === 'playlists'
        ? window.applyPlaylistSearch
        : window.applyHomeLibrarySearch;
    window.onAppViewChanged?.(page);
    window.onHomeAppViewChanged?.(page);
}

window.navigateApp = path => {
    const destination = new URL(path, window.location.href);
    const page = routeFromUrl(destination.href);
    const persistentUrl = persistentUrlFor(destination.href, page);
    if (persistentUrl.href !== window.location.href) {
        window.history.pushState({ appPage: page }, '', persistentUrl.href);
    }
    renderAppPage(page);
    window.handleAppRouteQuery?.(persistentUrl.searchParams);
};

document.getElementById('open-privacy-policy')?.addEventListener('click', () => window.navigateApp('persistent.html?view=privacy'));
document.getElementById('open-licenses')?.addEventListener('click', () => window.navigateApp('persistent.html?view=credits'));
window.addEventListener('popstate', () => {
    const page = routeFromUrl(window.location.href);
    renderAppPage(page);
    window.handleAppRouteQuery?.(new URL(window.location.href).searchParams, { historyTraversal: true });
});

document.addEventListener('click', event => {
    const nav = event.target.closest('[data-nav]');
    if (nav) {
        event.preventDefault();
        window.navigateApp(`persistent.html?view=${encodeURIComponent(nav.dataset.nav)}`);
        return;
    }

    const link = event.target.closest('a[href]');
    if (!link || link.target === '_blank' || event.defaultPrevented) return;
    const destination = new URL(link.href, window.location.href);
    if (destination.origin === window.location.origin && /\/(home|playlists|settings|credits|privacy)\.html$/i.test(destination.pathname)) {
        event.preventDefault();
        window.navigateApp(destination.href);
    }
});

document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && document.getElementById('lyrics-view')?.classList.contains('is-visible')) {
        window.closeLyricsView?.();
    }
});

window.musicCommon = (() => {
    const DEFAULT_COVER = '../images/music.png';
    const SUPPORTED_EXTENSIONS = /\.(mp3|wav|flac|ogg|oga|opus|m4a|aac|weba|webm)$/i;
    let artworkObserver = null;

    function getArtworkObserver() {
        if (!artworkObserver && 'IntersectionObserver' in window) {
            artworkObserver = new IntersectionObserver(entries => {
                entries.forEach(entry => {
                    const image = entry.target;
                    if (!image.isConnected) {
                        artworkObserver.unobserve(image);
                        return;
                    }
                    const source = image.dataset.artworkSource;
                    if (!source || source === DEFAULT_COVER) return;
                    if (entry.isIntersecting && image.dataset.loadedArtworkSource !== source) {
                        image.dataset.loadedArtworkSource = source;
                        image.src = source;
                    } else if (!entry.isIntersecting && image.dataset.loadedArtworkSource === source) {
                        image.dataset.loadedArtworkSource = DEFAULT_COVER;
                        image.src = DEFAULT_COVER;
                    }
                });
            }, { rootMargin: '160px 0px' });
        }
        return artworkObserver;
    }

    function setLazyArtwork(image, source) {
        if (!image) return;
        const nextSource = source || DEFAULT_COVER;
        image.loading = 'lazy';
        image.decoding = 'async';
        if (image.dataset.artworkSource === nextSource) return;

        getArtworkObserver()?.unobserve(image);
        image.dataset.artworkSource = nextSource;
        image.dataset.loadedArtworkSource = DEFAULT_COVER;
        image.src = DEFAULT_COVER;
        if (nextSource === DEFAULT_COVER) {
            return;
        }

        const observer = getArtworkObserver();
        if (!observer) {
            image.dataset.loadedArtworkSource = nextSource;
            image.src = nextSource;
            return;
        }
        observer.observe(image);
    }

    function clearLazyArtwork(root) {
        if (!root || !artworkObserver) return;
        const artworkImages = root.matches?.('img[data-artwork-source]')
            ? [root]
            : [...(root.querySelectorAll?.('img[data-artwork-source]') || [])];
        artworkImages.forEach(image => {
            artworkObserver.unobserve(image);
            delete image.dataset.artworkSource;
            delete image.dataset.loadedArtworkSource;
        });
    }

    function createVirtualList({ scrollElement, contentElement, rowHeight, renderItem, overscan = 8 }) {
        if (!scrollElement || !contentElement || typeof renderItem !== 'function') return null;
        const itemHeight = Math.max(1, Number(rowHeight) || 64);
        const topSpacer = document.createElement('div');
        const bottomSpacer = document.createElement('div');
        [topSpacer, bottomSpacer].forEach(spacer => {
            spacer.className = 'virtual-list-spacer';
            spacer.setAttribute('aria-hidden', 'true');
            spacer.style.flex = '0 0 auto';
            spacer.style.pointerEvents = 'none';
        });

        let items = [];
        let renderedStart = -1;
        let renderedEnd = -1;
        let scheduledFrame = 0;
        const rows = new Map();

        function contentOffsetTop() {
            if (scrollElement === contentElement) return 0;
            const scrollRect = scrollElement.getBoundingClientRect();
            const contentRect = contentElement.getBoundingClientRect();
            return contentRect.top - scrollRect.top + scrollElement.scrollTop;
        }

        function renderWindow() {
            scheduledFrame = 0;
            const listOffset = contentOffsetTop();
            const position = Math.max(0, scrollElement.scrollTop - listOffset);
            const firstVisible = Math.min(items.length, Math.floor(position / itemHeight));
            const visibleCount = Math.max(1, Math.ceil((scrollElement.clientHeight || itemHeight) / itemHeight));
            const start = Math.max(0, firstVisible - overscan);
            const end = Math.min(items.length, firstVisible + visibleCount + overscan);
            if (start === renderedStart && end === renderedEnd) return;

            rows.forEach((row, index) => {
                if (index < start || index >= end) {
                    clearLazyArtwork(row);
                    rows.delete(index);
                }
            });

            const visibleRows = [];
            for (let index = start; index < end; index += 1) {
                let row = rows.get(index);
                if (!row) {
                    row = renderItem(items[index], index);
                    if (!row) continue;
                    rows.set(index, row);
                }
                visibleRows.push(row);
            }

            topSpacer.style.height = `${start * itemHeight}px`;
            bottomSpacer.style.height = `${Math.max(0, items.length - end) * itemHeight}px`;
            contentElement.replaceChildren(topSpacer, ...visibleRows, bottomSpacer);
            renderedStart = start;
            renderedEnd = end;
        }

        function scheduleRender() {
            if (!scheduledFrame) scheduledFrame = requestAnimationFrame(renderWindow);
        }

        function setItems(nextItems) {
            rows.forEach(row => clearLazyArtwork(row));
            rows.clear();
            items = Array.isArray(nextItems) ? nextItems : [];
            renderedStart = -1;
            renderedEnd = -1;

            if (scrollElement.clientHeight > 0) {
                const maxScrollTop = Math.max(0, contentOffsetTop() + items.length * itemHeight - scrollElement.clientHeight);
                if (scrollElement.scrollTop > maxScrollTop) scrollElement.scrollTop = maxScrollTop;
            }
            renderWindow();
        }

        scrollElement.addEventListener('scroll', scheduleRender, { passive: true });
        const resizeObserver = 'ResizeObserver' in window ? new ResizeObserver(scheduleRender) : null;
        if (resizeObserver) resizeObserver.observe(scrollElement);
        else window.addEventListener('resize', scheduleRender);

        return {
            setItems,
            refresh: scheduleRender,
            destroy() {
                scrollElement.removeEventListener('scroll', scheduleRender);
                resizeObserver?.disconnect();
                if (!resizeObserver) window.removeEventListener('resize', scheduleRender);
                if (scheduledFrame) cancelAnimationFrame(scheduledFrame);
                rows.forEach(row => clearLazyArtwork(row));
                rows.clear();
            }
        };
    }

    function escapeHtml(value) {
        const element = document.createElement('div');
        element.textContent = value ?? '';
        return element.innerHTML;
    }

    function stripExtension(fileName = '') {
        return String(fileName).replace(/\.[^/.]+$/, '');
    }

    function imageMimeType(format, bytes) {
        const normalized = String(format || '').trim().toLowerCase();
        const aliases = {
            jpg: 'image/jpeg', jpeg: 'image/jpeg', 'image/jpg': 'image/jpeg',
            'image/pjpeg': 'image/jpeg', png: 'image/png', gif: 'image/gif',
            webp: 'image/webp', bmp: 'image/bmp', jxl: 'image/jxl', 'image/jxl': 'image/jxl'
        };
        const mime = aliases[normalized] || normalized;
        if (['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp', 'image/jxl'].includes(mime)) return mime;
        if (bytes?.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
        if (bytes?.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
        if (bytes?.length >= 6 && String.fromCharCode(...bytes.slice(0, 6)).startsWith('GIF8')) return 'image/gif';
        if (bytes?.length >= 12 && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP') return 'image/webp';
        if (bytes?.length >= 2 && bytes[0] === 0x42 && bytes[1] === 0x4d) return 'image/bmp';
        if ((bytes?.length >= 2 && bytes[0] === 0xff && bytes[1] === 0x0a) ||
            (bytes?.length >= 12 && String.fromCharCode(...bytes.slice(4, 8)) === 'JXL ')) return 'image/jxl';
        return '';
    }

    function artworkSource(track, size = 'large') {
        if (track?.imageUrl) return track.imageUrl;
        if (track?.imagePath && window.electronAPI?.toArtworkUrl) return window.electronAPI.toArtworkUrl(track.imagePath, size);
        return DEFAULT_COVER;
    }

    function albumKey(track) {
        const album = String(track?.data?.album || '').trim();
        if (!album || album.toLocaleLowerCase() === 'unknown album') return '';
        const normalize = value => String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').trim().toLocaleLowerCase();
        return `${normalize(track.data?.artist || 'Unknown Artist')}::${normalize(album)}`;
    }

    function formatTime(seconds) {
        const safeSeconds = Number.isFinite(Number(seconds)) && Number(seconds) >= 0 ? Number(seconds) : 0;
        return `${Math.floor(safeSeconds / 60)}:${Math.floor(safeSeconds % 60).toString().padStart(2, '0')}`;
    }

    function createSidebarButton(titleText, subtitleText, coverSource, onClick, label) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'sidebar_album_btn';
        button.setAttribute('aria-label', label || titleText);
        const cover = document.createElement('img');
        cover.className = 'sidebar_album_cover';
        cover.alt = '';
        setLazyArtwork(cover, coverSource || DEFAULT_COVER);
        cover.addEventListener('error', () => { cover.src = DEFAULT_COVER; }, { once: true });
        const text = document.createElement('span');
        text.className = 'sidebar_album_text';
        const name = document.createElement('span');
        name.className = 'sidebar_album_name';
        name.textContent = titleText;
        const detail = document.createElement('span');
        detail.className = 'sidebar_album_artist';
        detail.textContent = subtitleText || '';
        text.append(name, detail);
        button.append(cover, text);
        button.addEventListener('click', onClick);
        return button;
    }

    function renderMostPlayedSongs(tracks, onSelect) {
        const list = document.getElementById('top-songs-list');
        if (!list) return;
        const topSongs = [...tracks]
            .filter(track => track?.path)
            .sort((left, right) => Math.max(0, Number(right.playCount) || 0) - Math.max(0, Number(left.playCount) || 0) ||
                String(left.data?.title || left.name || '').localeCompare(String(right.data?.title || right.name || '')))
            .slice(0, 3);
        clearLazyArtwork(list);
        list.replaceChildren();
        topSongs.forEach(track => {
            const title = track.data?.title || stripExtension(track.name) || 'Unknown Title';
            const artist = track.data?.artist || 'Unknown Artist';
            list.appendChild(createSidebarButton(title, artist, artworkSource(track, 'thumb'), () => onSelect?.(track), `${title} by ${artist}`));
        });
    }

    function renderMostPlayedPlaylists(tracks, playlists, onSelect) {
        const list = document.getElementById('top-playlists-list');
        if (!list) return;
        const libraryByPath = new Map((tracks || []).map(track => [track.path, track]));
        const topPlaylists = [...(playlists || [])]
            .map(playlist => {
                const playlistTracks = (playlist.tracks || []).map(track => libraryByPath.get(track.path) || track);
                const listens = playlistTracks.reduce((total, track) => total + Math.max(0, Number(track.playCount) || 0), 0);
                const cover = playlist.coverImage ||
                    (playlist.coverImagePath && window.electronAPI?.toArtworkUrl ? window.electronAPI.toArtworkUrl(playlist.coverImagePath, 'thumb') : '') ||
                    artworkSource(playlistTracks.find(track => track.imagePath || track.imageUrl) || playlistTracks[0], 'thumb');
                return { ...playlist, tracks: playlistTracks, listens, cover };
            })
            .sort((left, right) => right.listens - left.listens || (right.tracks?.length || 0) - (left.tracks?.length || 0) || String(left.name || '').localeCompare(String(right.name || '')))
            .slice(0, 3);
        clearLazyArtwork(list);
        list.replaceChildren();
        topPlaylists.forEach(playlist => {
            const count = playlist.tracks?.length || 0;
            list.appendChild(createSidebarButton(playlist.name || 'Untitled Playlist', `${count} song${count === 1 ? '' : 's'}`, playlist.cover,
                () => onSelect?.(playlist), playlist.name || 'Untitled Playlist'));
        });
    }

    return { DEFAULT_COVER, SUPPORTED_EXTENSIONS, escapeHtml, stripExtension, imageMimeType, artworkSource, setLazyArtwork, clearLazyArtwork, createVirtualList, albumKey, formatTime, renderMostPlayedSongs, renderMostPlayedPlaylists };
})();

const sidebarSearchInput = document.getElementById('sidebar-search');
if (sidebarSearchInput) {
    const searchBox = document.getElementById('app-search-box');
    const searchToggle = document.getElementById('app-search-toggle');
    let searchApplyTimer = 0;
    const setSearchOpen = (open, focus = false) => {
        searchBox?.classList.toggle('is-open', open);
        searchToggle?.setAttribute('aria-expanded', String(open));
        sidebarSearchInput.tabIndex = open ? 0 : -1;
        if (focus && open) {
            sidebarSearchInput.focus();
            sidebarSearchInput.select();
        }
    };
    searchToggle?.addEventListener('click', () => setSearchOpen(!searchBox?.classList.contains('is-open'), true));
    sidebarSearchInput.addEventListener('input', () => {
        clearTimeout(searchApplyTimer);
        searchApplyTimer = setTimeout(() => window.applyLibrarySearch?.(sidebarSearchInput.value), 110);
    });
    sidebarSearchInput.addEventListener('keydown', event => {
        if (event.key === 'Enter') {
            event.preventDefault();
            clearTimeout(searchApplyTimer);
            window.applyLibrarySearch?.(sidebarSearchInput.value);
        }
    });

    document.addEventListener('keydown', event => {
        const target = event.target;
        const isTyping = target instanceof Element && target.closest('input, textarea, select, [contenteditable="true"]');
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
            event.preventDefault();
            setSearchOpen(true, true);
            return;
        }
        if (event.key === '/' && !isTyping && !event.ctrlKey && !event.metaKey && !event.altKey) {
            event.preventDefault();
            setSearchOpen(true, true);
        } else if (event.key === 'Escape' && target === sidebarSearchInput) {
            if (sidebarSearchInput.value) {
                sidebarSearchInput.value = '';
                sidebarSearchInput.dispatchEvent(new Event('input', { bubbles: true }));
            } else {
                setSearchOpen(false);
                searchToggle?.focus();
            }
        }
    });
    document.addEventListener('click', event => {
        if (!searchBox?.contains(event.target) && !sidebarSearchInput.value) setSearchOpen(false);
    });
}

window.populateSidebarShortcuts = async (root = document) => {
    if (!root.querySelector('#top-songs-list') || !window.electronAPI?.getPlaylist || !window.musicCommon) return;
    try {
        const [tracks, playlists] = await Promise.all([window.electronAPI.getPlaylist(), window.electronAPI.getPlaylists()]);
        const songList = root.querySelector('#top-songs-list');
        const playlistList = root.querySelector('#top-playlists-list');
        if (songList) window.musicCommon.renderMostPlayedSongs(tracks || [], track => {
            window.navigateApp(`persistent.html?view=home&play=${encodeURIComponent(track.path)}`);
        });
        if (playlistList) window.musicCommon.renderMostPlayedPlaylists(tracks || [], playlists || [], playlist => {
            window.navigateApp(`persistent.html?view=home&playlist=${encodeURIComponent(playlist.id)}`);
        });
    } catch (error) { console.error('Could not load most played shortcuts:', error); }
};

document.addEventListener('DOMContentLoaded', () => {
    initializeSidebarCompactMode();
    const initialPage = routeFromUrl(window.location.href);
    renderAppPage(initialPage);
    window.populateSidebarShortcuts();
    window.handleAppRouteQuery?.(new URL(window.location.href).searchParams);
});


