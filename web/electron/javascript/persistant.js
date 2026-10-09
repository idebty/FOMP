window.musicCommon = (() => {
    const DEFAULT_COVER = '../images/music.png';
    const SUPPORTED_EXTENSIONS = /\.(mp3|wav)$/i;

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
            webp: 'image/webp', bmp: 'image/bmp'
        };
        const mime = aliases[normalized] || normalized;
        if (['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp'].includes(mime)) return mime;
        if (bytes?.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
        if (bytes?.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
        if (bytes?.length >= 6 && String.fromCharCode(...bytes.slice(0, 6)).startsWith('GIF8')) return 'image/gif';
        if (bytes?.length >= 12 && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP') return 'image/webp';
        if (bytes?.length >= 2 && bytes[0] === 0x42 && bytes[1] === 0x4d) return 'image/bmp';
        return '';
    }

    function artworkSource(track) {
        if (track?.imageUrl) return track.imageUrl;
        if (track?.imagePath && window.electronAPI?.toArtworkUrl) return window.electronAPI.toArtworkUrl(track.imagePath);
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
        cover.src = coverSource || DEFAULT_COVER;
        cover.alt = '';
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
        list.replaceChildren();
        topSongs.forEach(track => {
            const title = track.data?.title || stripExtension(track.name) || 'Unknown Title';
            const artist = track.data?.artist || 'Unknown Artist';
            list.appendChild(createSidebarButton(title, artist, artworkSource(track), () => onSelect?.(track), `${title} by ${artist}`));
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
                    (playlist.coverImagePath && window.electronAPI?.toArtworkUrl ? window.electronAPI.toArtworkUrl(playlist.coverImagePath) : '') ||
                    artworkSource(playlistTracks.find(track => track.imagePath || track.imageUrl) || playlistTracks[0]);
                return { ...playlist, tracks: playlistTracks, listens, cover };
            })
            .sort((left, right) => right.listens - left.listens || (right.tracks?.length || 0) - (left.tracks?.length || 0) || String(left.name || '').localeCompare(String(right.name || '')))
            .slice(0, 3);
        list.replaceChildren();
        topPlaylists.forEach(playlist => {
            const count = playlist.tracks?.length || 0;
            list.appendChild(createSidebarButton(playlist.name || 'Untitled Playlist', `${count} song${count === 1 ? '' : 's'}`, playlist.cover,
                () => onSelect?.(playlist), playlist.name || 'Untitled Playlist'));
        });
    }

    return { DEFAULT_COVER, SUPPORTED_EXTENSIONS, escapeHtml, stripExtension, imageMimeType, artworkSource, albumKey, formatTime, renderMostPlayedSongs, renderMostPlayedPlaylists };
})();

const sidebarSearchInput = document.getElementById('sidebar-search');
if (sidebarSearchInput) {
    let navigationTimer = null;
    sidebarSearchInput.addEventListener('input', () => {
        clearTimeout(navigationTimer);
        if (typeof window.applyLibrarySearch === 'function') {
            window.applyLibrarySearch(sidebarSearchInput.value);
        } else if (sidebarSearchInput.value.trim()) {
            navigationTimer = setTimeout(() => {
                window.location.replace(`../html/home.html?search=${encodeURIComponent(sidebarSearchInput.value.trim())}`);
            }, 350);
        }
    });
    sidebarSearchInput.addEventListener('keydown', event => {
        if (event.key !== 'Enter' || typeof window.applyLibrarySearch === 'function') return;
        const query = sidebarSearchInput.value.trim();
        if (query) window.location.replace(`../html/home.html?search=${encodeURIComponent(query)}`);
    });
}

document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('[data-nav]').forEach(button => {
    button.addEventListener('click', () => {
      const targetPage = button.dataset.nav;
      window.location.replace(`../html/${targetPage}.html`);
    });
  });

  document.querySelectorAll('[data-open-lyrics]').forEach(button => {
    button.addEventListener('click', () => {
      window.location.replace('../html/home.html?view=lyrics');
    });
  });

  const currentFileName = window.location.pathname
    .split('/')
    .pop()
    .replace('.html', '');
  const activePage = currentFileName === 'credits' ? 'settings' : currentFileName;

  const sidebarButtons = document.querySelectorAll('.sidebar_main_btn, .sidebar_btn');

  if (document.getElementById('top-songs-list') && window.electronAPI?.getPlaylist) {
    Promise.all([window.electronAPI.getPlaylist(), window.electronAPI.getPlaylists()]).then(([tracks, playlists]) => {
      const songList = document.getElementById('top-songs-list');
      const playlistList = document.getElementById('top-playlists-list');
      if (songList) window.musicCommon.renderMostPlayedSongs(tracks || [], track => {
        window.location.replace(`../html/home.html?play=${encodeURIComponent(track.path)}`);
      });
      if (playlistList) window.musicCommon.renderMostPlayedPlaylists(tracks || [], playlists || [], playlist => {
        window.location.replace(`../html/home.html?playlist=${encodeURIComponent(playlist.id)}`);
      });
    }).catch(error => console.error('Could not load most played shortcuts:', error));
  }

  sidebarButtons.forEach(button => {

    button.classList.remove('active');


    if (button.id === activePage) {
      button.classList.add('active');
    }
  });
});

