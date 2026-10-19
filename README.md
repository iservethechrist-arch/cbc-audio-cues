# CBC Audio Cues — Version 0.7

CBC Audio Cues is a local-first, manual audio player for Calvary Baptist Church. Playlists reference copies of user-imported audio in IndexedDB. Tracks **never advance automatically**. The app shell is hosted publicly via GitHub Pages, but imported music, playlists, and `.cbcbackup` files are **not uploaded** to GitHub.

## Changes in v0.7

- **Light and Dark themes:** The existing light theme remains the default. The new dark theme uses a charcoal-gray canvas and slightly lighter cards inspired by the approved GIMP mockup. Ready, Selected, Playing, Paused, Played, and Missing are visually differentiated. Choose a theme from the top-right **Settings** button. Themes are device-specific and remembered locally.
- **Two track-selection behaviors:** **Tap to Play** (existing default) or **Select, then Play**. In Select, then Play mode, touching a card arms that track without starting it or interrupting currently playing audio. The bottom **Play** button starts it; if another track is playing or paused, a **Continue / Cancel** confirmation appears first. Cancel does not interrupt audio. The player clearly identifies a selected next track while showing the currently playing track beneath it.
- **Android bottom system bar:** The app now applies theme-aware root backgrounds, color-scheme, and the PWA's theme-color meta setting. The final system navigation bar and button colors are controlled partly by Android/Chrome; confirm on the actual Galaxy Tab A9+.
- **Improved Played contrast:** Completed tracks are easier to distinguish in both themes.
- The IndexedDB database name (`CBC-Cue-Player`), schema, backup format, and manual playback / offline architecture **have not changed**. Layout choice (List/Cards) and Edit Mode behavior are unchanged.

## Install/update on Windows VS Code

1. **Export a backup first** from the working installation: Audio Library → Export Backup. Save the `.cbcbackup` file somewhere outside the app folder.
2. Extract the ZIP and open `CBC-Cue-Player`.
3. Copy **its contents** into the **existing folder** in VS Code, replacing only the application files (not deleting the folder).
4. Open exactly the same localhost address and port as before, then use Ctrl+Shift+R.
5. Verify imported playlists/music are still present. They live in browser-managed IndexedDB keyed to the site's **origin** (including its port).

## Publish updated files to GitHub Pages

In the public `cbc-audio-cues` repository: Code → Add file → Upload files. Upload **only the contents** of the app folder (including `index.html`, `app.js`, `style.css`, `manifest.webmanifest`, `sw.js`, icons, and `.nojekyll`), then commit to `main`. **Never upload MP3/WAV/M4A files, `.cbcbackup` files, passwords, or private data.** The `.nojekyll` file is hidden on some operating systems; it is already on your repo if previously uploaded.

GitHub Pages will deploy from `main` / `(root)` as before. Once deployed, open `https://iservethechrist-arch.github.io/cbc-audio-cues/` online. On Android, close/reopen the Home Screen app, and reload if it still shows an old version. Use **Audio Library → Offline Setup** to verify the **v7** offline shell cache. Then put the device in Airplane Mode, close/reopen, and test tracks and controls.

## Pre-service safety tests

1. Test **Tap to Play**, including Cancel and Continue before switching active tracks.
2. Test **Select, then Play**: tapping a track must not play it; pressing Play should start it. While a different track is playing, selecting the next track must **not** stop the playing track; Play must ask for confirmation. Cancel must leave it uninterrupted.
3. Verify switching themes and List/Cards layouts never affects playback.
4. Verify Played visual contrast and readable buttons/settings on the actual tablet.
5. Verify the Android navigation buttons are visible in light and dark themes. Android controls part of this appearance.
6. Check each file and actual audio output; test offline playback, restart recovery, and backup export/restore.

Browser-managed storage can be cleared by the OS. Keep the original audio files and regular exported backups outside the PWA. Do not depend on a new version for live events until it has been tested on the actual devices.
