# CBC Audio Cues — Version 0.5 (development prototype)

A free, local-first manual music playback application for Calvary Baptist Church. Plain HTML, CSS and JavaScript: no paid libraries, analytics, advertisements, cloud uploads, or user accounts.

## How to update without losing existing music and playlists

**First:** In your current app, choose **Audio Library → Export Backup** and save the resulting `.cbcbackup` file somewhere safe. This is a backup of music and playlists; copying code files alone is *not* a backup of browser-managed audio storage.

1. Close the tab running the app, then extract the new ZIP file.
2. Inside the ZIP is a folder named **`CBC-Cue-Player`**. Copy **the contents of that folder** into the **existing `CBC-Cue-Player` folder** you already use with VS Code, replacing the old files. **Do not rename, move, or delete the existing folder.**
3. In VS Code, start Live Server as you did previously. Use **the same address and port** in Edge as before (e.g. `http://127.0.0.1:5500/CBC-Cue-Player/index.html`).
4. Press **Ctrl+Shift+R** to reload and check that your original playlists and imported songs are still present.
5. Your audio database remains named **`CBC-Cue-Player`** internally for compatibility with v0.1–v0.4. The app displayed to users is named CBC Audio Cues.

Browser music storage belongs to the exact site origin. Changing the hostname, port, or site location may make an existing audio library appear empty. **Do not clear Edge site data.** If your library doesn't appear, check the address before importing anything again.

## What's new in v0.5

- **Playback List View** (initial default): one wide row per song, easy top-to-bottom reading order; prominent note text when present.
- **Playback Cards View:** exactly **three columns** on sufficiently wide screens, reading left-to-right and then top-to-bottom. On narrower screens, cards switch directly to **one column** (never an ambiguous two-column layout).
- **Anytime layout switching:** tap **List / Cards** during performance without pausing or changing the active track. The app remembers the preferred playback layout on this device when browser storage is available.
- **Edit Mode always uses List View:** dragging, arrows, cue-note editing, playlist duplication, and library controls stay simple. Exiting Edit Mode restores the previously chosen playback layout.
- **Refreshed interface:** more readable song titles, cleaner cue notes with no CUE NOTE heading or icon, compact track cards, updated sidebar, dark permanent playback dock, simpler single playback-control group, and no internet/online indicator.
- **No custom cue color coding.** The outline indicates the active/selected track, not a user-selected category.
- **Audio format, backups, and database unchanged** from Version 0.4. Offline capability continues to require real-iPad testing.

## Expected behavior / test checklist

1. Open a playlist in List View. Cues are ordered top-to-bottom. Select Cards View to show three columns at landscape iPad/desktop sizes. In Cards View, cue order is **left-to-right across each row, then the next row**.
2. Start a track and switch layouts while it plays; the song should continue without restarting. Tap a different track: the **Continue / Cancel** confirmation should appear; Cancel should leave the original song playing.
3. Switch into **Edit Mode** while Cards View is active; List View should appear automatically. Use touch drag handles (or desktop drag-and-drop/arrows) to reorder. Select Done Editing: Cards View should return.
4. Reload and confirm your last playback view is remembered. Reopen the existing playlists and check cue titles/notes and audio-library file counts.
5. Test the draggable progress slider, Pause, Stop, and the end of a song: **no track should ever start automatically**.
6. Check that the bottom player remains visible while scrolling a long playlist. Test both portrait and landscape iPad emulation.
7. Check that all imported audio still exists through **Check Files**, and complete an audible sound check through the actual output before relying on it during a service.

## iPad and offline limitations

Imported audio files are copied into the browser's **IndexedDB** on that specific device and playlists reference those copies. They are never uploaded automatically. The PWA app shell can cache for offline reopening once installed from an HTTPS host, but browser storage can be cleared by the OS. Keep `.cbcbackup` files and the original recordings outside the app. The iPad's actual audio output, offline behavior, playback stability, and touch gestures still need live-device verification.

**Not yet production certified:** browser-rendered layout interactions were smoke-tested in Chromium with sample playlist data, not on the Music Director's actual iPad. Test before use at any service or event.
