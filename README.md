# CBC Audio Cues — Version 0.6 (PWA / Android tablet test build)

This is the **same offline-first manual audio player** as v0.5. It uses one imported local copy of each audio file in IndexedDB, and playlists refer to those files. No audio is uploaded to the web host, and playback never auto-advances.

## Update Windows development version safely

1. **First export a backup** from Audio Library > Export Backup. Save the `.cbcbackup` file somewhere outside the app.
2. Extract this ZIP. Open its `CBC-Cue-Player` folder.
3. Copy **the files inside that folder** into the **existing `CBC-Cue-Player` folder** used by VS Code. Replace application files. Do not delete or rename the original folder.
4. Continue using the **same Edge address and port**, e.g. `http://127.0.0.1:5500/CBC-Cue-Player/index.html`.
5. Press Ctrl+Shift+R and verify music and playlists. Imported music is browser-managed data, NOT stored alongside the project files.

The application's existing IndexedDB name (`CBC-Cue-Player`) and backup format are unchanged.

## PWA and offline improvements in v0.6

- Updated service worker caches the app interface, stylesheet, JavaScript, icon and manifest for offline reopening once first loaded from HTTPS.
- **Audio Library > Offline Setup** checks whether the app shell was cached on the hosted installation. Local VS Code Live Server shows a development-mode explanation instead. This check cannot guarantee that user audio persists.
- Better caching update behavior when publishing future versions. No music files are uploaded by the app, and no playback or layout behavior has changed.
- Manifest/icon support carried forward from v0.5; `.nojekyll` included for simple GitHub Pages publishing.

## Android tablet installation (Galaxy Tab A9+ SM-X210)

A PWA must be served from HTTPS (or `localhost` on the same device for development). The Windows laptop's local `127.0.0.1:5500` address cannot be used from the tablet. **Publish the app shell only** to a free HTTPS host such as GitHub Pages. Never publish audio recordings, `.cbcbackup` files, passwords, or user data to a public repository.

For GitHub Pages, copy **the contents of `CBC-Cue-Player`** (including `index.html`, `.nojekyll`, `sw.js`, icons/, etc.) to the root of a dedicated public repository, enable Pages with branch `main`, folder `/(root)`, and use the HTTPS Pages address it provides. Do not upload the enclosing folder as the only file in the root.

On the tablet: open that HTTPS address in **Google Chrome**, open **⋮**, select **Install app** (or **Add to Home screen**, depending on Chrome), and follow the prompts. Launch CBC Audio Cues from the tablet Home Screen. Import a small audio file first to test.

### Offline and reliability checklist

1. With Wi-Fi on, open the installed application once and open **Audio Library > Offline Setup**. Verify **App files cached: YES**.
2. Import two MP3 files in Edit Mode and make a playlist. Run **Check Files** on that playlist.
3. Play, pause, stop, scrub, and switch List/Cards while playing. Confirm manually that the next song **never** starts by itself.
4. While playing, tap the other card and select **Cancel**; the first track must continue. Select **Continue** and verify the switch.
5. In Edit Mode, reorder a track via the touchscreen drag handle.
6. Export a `.cbcbackup` to the tablet's Downloads or another safe location.
7. Stop playback, **turn on Airplane Mode**, close and reopen the Home Screen app, play a song, and test all the above again. Also restart the tablet and repeat.
8. **Do not use during a service** until storage and external audio-output reliability have been tested on the actual device (and later on the Music Director's iPad).

Android and iPad browser-managed storage may be removed. **Keep the original audio files and exported backups outside CBC Audio Cues.** The storage persistence setting is best-effort, not a guarantee.
