/* CBC Audio Cues — Android/iPad PWA test build v0.7.
 * All audio is stored locally in IndexedDB. Playlists store only references.
 * No automatic next-track code exists: the 'ended' event simply stops playback.
 */
'use strict';

const $ = id => document.getElementById(id);
const audio = $('audio-element');
const state = {
  db: null, playlists: [], files: [], urls: new Map(), durations: new Map(),
  view: 'playlist', selectedPlaylistId: null, editMode: false, playbackLayout: 'list',
  selectedCue: null, armedCue: null, playback: 'idle', played: new Set(), pending: null,
  theme: 'light', playbackBehavior: 'instant',
  nameHandler: null, busy: false
};
let toastTimeout;
let draggedCueId = null;
let isScrubbing = false;
let seekPreviewTime = 0;
let wakeLock = null;
let pointerDrag = null;
const BACKUP_MAGIC = 'CBC-AUDIO-03'; // 12 ASCII bytes; next four bytes = metadata length.
function tidyName(filename) {
  return String(filename).replace(/\.[^.]+$/, '').replace(/[ _-]+(?:normalized|normalised|mixdown|final(?:[ _-]*v\d+)?)(?=$)/i, '')
    .replace(/_/g, ' ').replace(/\s+/g, ' ').trim() || String(filename);
}
function ensureCues(p) { if (!Array.isArray(p.cues)) p.cues = Array.isArray(p.tracks) ? p.tracks : []; return p; }
function currentAudioFileId() { return state.selectedCue?.fileId; }
function isAudioActive() { return state.playback === 'playing' || state.playback === 'paused'; }
async function requestWakeLock() {
  if (state.playback !== 'playing' || document.hidden || wakeLock || !navigator.wakeLock?.request) return;
  try { const lock = await navigator.wakeLock.request('screen');
    if(state.playback !== 'playing' || document.hidden) {lock.release().catch(()=>{});return;}
    wakeLock=lock;
    wakeLock.addEventListener('release', () => {if(wakeLock===lock)wakeLock = null;});
  } catch (_) { /* Wake lock may not be supported on the iPad or permission may be denied. */ }
}
function releaseWakeLock() {
  if (wakeLock) { const lock = wakeLock; wakeLock = null; lock.release().catch(()=>{}); }
}

const supportedAudio = /\.(mp3|wav|m4a|aac)$/i;

function makeId() { return crypto.randomUUID(); }
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function prettySize(bytes) {
  if (!Number.isFinite(bytes)) return 'Unknown size';
  return bytes < 1048576 ? `${(bytes / 1024).toFixed(0)} KB` : `${(bytes / 1048576).toFixed(1)} MB`;
}
function seconds(value) {
  if (!Number.isFinite(value) || value < 0) return '0:00';
  const sec = Math.floor(value);
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2,'0')}`;
}
function toast(message) {
  const node = $('toast'); node.textContent = message; node.classList.add('visible');
  clearTimeout(toastTimeout); toastTimeout = setTimeout(() => node.classList.remove('visible'), 4300);
}
function openDatabase() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) return reject(new Error('This browser does not support local database storage.'));
    const request = indexedDB.open('CBC-Cue-Player', 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('files')) db.createObjectStore('files', {keyPath:'id'});
      if (!db.objectStoreNames.contains('playlists')) db.createObjectStore('playlists', {keyPath:'id'});
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Could not open audio database.'));
  });
}
function dbOperation(store, action, item) {
  return new Promise((resolve,reject) => {
    const tx = state.db.transaction(store, action === 'getAll' ? 'readonly' : 'readwrite');
    const objectStore = tx.objectStore(store);
    let request;
    if (action === 'getAll') request = objectStore.getAll();
    if (action === 'put') request = objectStore.put(item);
    if (action === 'delete') request = objectStore.delete(item);
    if (!request) return reject(new Error('Invalid database operation.'));
    let value;
    request.onsuccess = () => { value = request.result; };
    tx.oncomplete = () => resolve(value);
    tx.onerror = () => reject(tx.error || new Error('Local database transaction failed.'));
    tx.onabort = () => reject(tx.error || new Error('Local database transaction was cancelled.'));
  });
}
function selectedPlaylist() { return state.playlists.find(p => p.id === state.selectedPlaylistId); }
function fileById(id) { return state.files.find(f => f.id === id); }
function allCues(playlist) { return playlist?.cues || []; }
function countReferences(fileId) { return state.playlists.reduce((n,p) => n + allCues(p).filter(c => c.fileId === fileId).length,0); }
// Layout preference is intentionally outside the audio library database.
// Edit Mode is always a one-column list regardless of the saved playback layout.
// Simple local-only preferences; separate from IndexedDB and exported audio backups.
const THEME_STORAGE_KEY = 'cbc-audio-cues-theme';
const PLAYBACK_BEHAVIOR_STORAGE_KEY = 'cbc-audio-cues-track-behavior';
function loadPreference(key, allowed, fallback) {
  try { const value=localStorage.getItem(key); return allowed.includes(value) ? value : fallback; }
  catch (_) {return fallback;}
}
function applyTheme(theme) {
  state.theme = theme==='dark' ? 'dark' : 'light';
  document.documentElement.dataset.theme=state.theme;
  document.documentElement.style.colorScheme=state.theme;
  // This helps Chrome and standalone PWAs color the system bars. Android
  // owns its navigation icons, so the final colors depend on the device.
  const themeColor=state.theme==='dark' ? '#10151c' : '#142d4a';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content',themeColor);
  document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]')?.setAttribute('content',
    state.theme==='dark' ? 'black-translucent' : 'default');
  try {localStorage.setItem(THEME_STORAGE_KEY,state.theme);}catch(_){}
}
function setPlaybackBehavior(behavior) {
  state.playbackBehavior = behavior==='select' ? 'select' : 'instant';
  // Changing the preference never starts, pauses, or stops active audio.
  state.armedCue=state.selectedCue ? {...state.selectedCue} : null;
  try {localStorage.setItem(PLAYBACK_BEHAVIOR_STORAGE_KEY,state.playbackBehavior);}catch(_){}
  render();
}
function sameCue(a,b) {return !!a && !!b && a.id===b.id && a.playlistId===b.playlistId;}
function trackToPlay() {return state.playbackBehavior==='select' ? state.armedCue : state.selectedCue;}
function selectCueOnly(cue,playlistId) {
  const file=fileById(cue.fileId);
  if(!file?.blob || !state.urls.has(cue.fileId)) {
    alert(`Audio file unavailable: "${cue.label}".\n\nReimport the missing file before playing it.`);return;
  }
  state.armedCue={...cue,playlistId};
  render();
}
function playFromControls() {
  const target=trackToPlay();
  if(!target)return;
  const playlist=state.playlists.find(p=>p.id===target.playlistId);
  const cue=playlist?.cues.find(c=>c.id===target.id);
  if(!cue){toast('Selected track is no longer available. Select another song.');state.armedCue=null;render();return;}
  if(sameCue(target,state.selectedCue)) {
    if(state.playback==='playing')return;
    return resume();
  }
  if(isAudioActive()) {
    modal('Change Audio Track?',`"${state.selectedCue.label}" is currently ${state.playback}.\n\nStop it and start "${cue.label}"?\n\nCancel keeps the current track playing without interruption.`, 'Continue',()=>startCue(cue,playlist.id));
  } else startCue(cue,playlist.id);
}
function openSettings() {
  document.querySelector(`input[name="app-theme"][value="${state.theme}"]`).checked=true;
  document.querySelector(`input[name="playback-behavior"][value="${state.playbackBehavior}"]`).checked=true;
  $('settings-dialog').showModal();
}

const LAYOUT_STORAGE_KEY = 'cbc-audio-cues-playback-layout';
function readPlaybackLayout() {
  try { return localStorage.getItem(LAYOUT_STORAGE_KEY) === 'grid' ? 'grid' : 'list'; }
  catch (_) { return 'list'; }
}
function setPlaybackLayout(layout) {
  if (state.editMode || state.view !== 'playlist') return;
  state.playbackLayout = layout === 'grid' ? 'grid' : 'list';
  try { localStorage.setItem(LAYOUT_STORAGE_KEY, state.playbackLayout); } catch (_) {}
  renderMain(); // Do not touch the audio element, its time or transport state.
}
function effectiveLayout() { return state.editMode ? 'list' : state.playbackLayout; }
function renderNav() {
  $('playlist-nav').innerHTML = state.playlists.map(p => `<button type="button" class="nav-entry ${state.view === 'playlist' && p.id === state.selectedPlaylistId ? 'active' : ''}" data-action="open-playlist" data-playlist-id="${escapeHtml(p.id)}" title="${escapeHtml(p.name)}"><span class="nav-icon" aria-hidden="true">▥</span><span class="nav-label">${escapeHtml(p.name)}</span><span class="nav-count" aria-label="${allCues(p).length} tracks">${allCues(p).length}</span></button>`).join('');
  $('library-nav').classList.toggle('active',state.view === 'library');
  $('library-count').textContent = state.files.length;
  $('mode-toggle').classList.toggle('active',state.editMode);
  $('mode-toggle').setAttribute('aria-pressed',String(state.editMode));
  $('mode-toggle').textContent = state.editMode ? 'Done Editing' : 'Edit Mode';
}
function emptyPanel(icon,title,description,buttonHtml='') {
  return `<div class="empty-state"><div class="empty-icon" aria-hidden="true">${icon}</div><h2>${escapeHtml(title)}</h2><p>${escapeHtml(description)}</p>${buttonHtml}</div>`;
}
function renderMain() {
  const main = $('main-content');
  if (state.view === 'library') {
    const files = state.files.slice().sort((a,b)=>a.name.localeCompare(b.name));
    const total = files.reduce((n,f)=>n+f.size,0);
    main.innerHTML = `<div class="main-head"><div><h1>Audio Library</h1><p class="description">${files.length} stored audio ${files.length===1?'file':'files'} · ${prettySize(total)}. Playlists reference these files; removing a playlist never deletes audio.</p></div><div class="main-actions"><button class="secondary-button" type="button" data-action="backup">Export Backup</button><button class="secondary-button" type="button" data-action="restore">Restore Backup</button><button class="secondary-button" type="button" data-action="offline-check">Offline Setup</button>${state.editMode ? '<button class="primary-button" type="button" data-action="import">+ Import Audio</button>' : ''}</div></div>${state.editMode ? '<div class="edit-banner">Library management: permanently deleting an imported copy requires confirmation and does not affect its original file in the iPad Files app or on your computer.</div>' : ''}${files.length ? `<div class="library-list">${files.map(f=>`<div class="library-item"><div><div class="file-title">${escapeHtml(f.name)}</div><div class="file-meta">${prettySize(f.size)} · Referenced ${countReferences(f.id)} ${countReferences(f.id)===1?'time':'times'}${f.duration ? ` · ${seconds(f.duration)}` : ''}</div></div><div class="library-item-actions">${state.editMode ? `<button class="danger-button" type="button" data-action="delete-file" data-file-id="${escapeHtml(f.id)}">Delete Stored Copy</button>` : ''}</div></div>`).join('')}</div>` : emptyPanel('♫','Your audio library is empty','Import audio files to make them available to your playlists.',state.editMode?'<button class="primary-button" type="button" data-action="import">+ Import Audio</button>':'<button class="secondary-button" type="button" data-action="enable-edit">Switch to Edit Mode</button>')}`;
    return;
  }
  const playlist = selectedPlaylist();
  if (!playlist) {
    main.innerHTML = `<div class="main-head"><div><h1>Welcome to CBC Audio Cues</h1><p class="description">Create a playlist to start adding music.</p></div></div>${emptyPanel('♫','No playlists yet','Create your first playlist. Then import audio and tap any track to play it.','<button class="primary-button" type="button" data-action="new-playlist">+ Create Playlist</button>')}`;
    return;
  }
  const options = state.editMode ? `<button type="button" class="secondary-button" data-action="rename-playlist">Rename</button><button type="button" class="secondary-button" data-action="duplicate-playlist">Duplicate</button><button type="button" class="danger-button" data-action="delete-playlist">Delete Playlist</button><button type="button" class="secondary-button" data-action="reset-played">Reset Played</button><button type="button" class="secondary-button" data-action="add-from-library">Add from Library</button><button type="button" class="primary-button" data-action="import">+ Import Audio</button>` : `<button class="secondary-button" type="button" data-action="check-files">Check Files</button>`;
  const layout=effectiveLayout();
  const layoutButtons=!state.editMode ? `<div class="layout-switch" role="group" aria-label="Playlist display"><button class="layout-button ${layout==='list'?'active':''}" type="button" data-action="switch-layout" data-layout="list" aria-pressed="${layout==='list'}" title="Show tracks in playback order">☷ <span>List</span></button><button class="layout-button ${layout==='grid'?'active':''}" type="button" data-action="switch-layout" data-layout="grid" aria-pressed="${layout==='grid'}" title="Show three-column cards">▦ <span>Cards</span></button></div>` : '';
  main.innerHTML = `<div class="main-head"><div class="main-title"><h1>${escapeHtml(playlist.name)}</h1><p class="description">${playlist.cues.length} ${playlist.cues.length===1?'track':'tracks'} <span aria-hidden="true">·</span> ${state.editMode?'Drag handles or arrows change track order.':state.playbackBehavior==='select'?'Tap to select a track, then press Play. Next track: always manual.':'Tap a song to play. Next track: always manual.'}</p></div><div class="main-actions">${layoutButtons}${options}</div></div>${state.editMode ? '<div class="edit-banner">Editing playlist · Reorder with the drag handle or ↑ and ↓. Rename, add, and remove tracks without deleting stored audio.</div>' : ''}${playlist.cues.length ? `<div class="cue-collection ${layout==='grid'?'cue-grid':'cue-list'}${state.editMode?' edit-list':''}" id="card-grid" data-playback-layout="${layout}">${playlist.cues.map((cue,i)=>cueCard(cue,i)).join('')}</div>` : emptyPanel('♫','No audio tracks yet','Switch to Edit Mode to import audio, or add an existing track from the Audio Library.',state.editMode?'<button class="primary-button" type="button" data-action="import">+ Import Audio</button>':'<button class="secondary-button" type="button" data-action="enable-edit">Switch to Edit Mode</button>')}`;
}
function cueCard(cue,index) {
  const file=fileById(cue.fileId);
  const isCurrent=state.selectedCue?.id===cue.id && state.selectedCue.playlistId===state.selectedPlaylistId;
  const isPlaying=isCurrent && state.playback==='playing';
  const isPaused=isCurrent && state.playback==='paused';
  const isArmed=state.playbackBehavior==='select' && sameCue(state.armedCue,{...cue,playlistId:state.selectedPlaylistId});
  const isSelected=isArmed && !isPlaying && !isPaused || (state.playbackBehavior==='instant' && isCurrent && !isPlaying && !isPaused);
  const completed=state.played.has(cue.id);
  const missing=!file?.blob;
  const className=['cue-card',state.editMode?'editing':'',isPlaying?'playing':'',isPaused?'paused':'',isSelected?'selected':'',completed?'completed':'',missing?'missing':''].filter(Boolean).join(' ');
  const label=missing?'FILE MISSING':isPlaying?'PLAYING':isPaused?'PAUSED':isSelected?'SELECTED':completed?'PLAYED':'READY';
  const statusIcon=missing?'!':state.editMode?'♫':isPlaying?'♫':isPaused?'Ⅱ':isSelected?'●':completed?'✓':'▶';
  const number=String(index+1).padStart(2,'0');
  const duration=file?.duration?seconds(file.duration):missing?'Missing':'--:--';
  const filename=state.editMode?`<div class="cue-filename" title="${escapeHtml(file?.name||'Audio file unavailable')}">Source: ${escapeHtml(file?.name||'Audio file unavailable')}</div>`:'';
  const note=cue.note?.trim()?`<div class="cue-note">${escapeHtml(cue.note.trim())}</div>`:'';
  const edits=state.editMode?`<div class="edit-controls"><button type="button" class="drag-handle" data-drag-handle data-cue-id="${escapeHtml(cue.id)}" aria-label="Press and hold to drag ${escapeHtml(cue.label)} to another position" title="Hold and drag to reorder">⠿ <span>Drag</span></button><button type="button" class="mini-button" data-action="move-up" data-cue-id="${escapeHtml(cue.id)}" aria-label="Move ${escapeHtml(cue.label)} up" ${index===0?'disabled':''}>↑</button><button type="button" class="mini-button" data-action="move-down" data-cue-id="${escapeHtml(cue.id)}" aria-label="Move ${escapeHtml(cue.label)} down" ${index===allCues(selectedPlaylist()).length-1?'disabled':''}>↓</button><button type="button" class="mini-button" data-action="rename-cue" data-cue-id="${escapeHtml(cue.id)}">Edit</button><button type="button" class="mini-button remove" data-action="remove-cue" data-cue-id="${escapeHtml(cue.id)}">Remove</button></div>`:'';
  const attrs=state.editMode?'draggable="true"':`role="button" tabindex="0" aria-label="${state.playbackBehavior==='select'?'Select':'Play'} ${escapeHtml(cue.label)}" aria-pressed="${isSelected || isPlaying || isPaused}"`;
  const content=`<div class="cue-copy"><div class="cue-title">${escapeHtml(cue.label)}</div>${filename}${note}</div>`;
  if(effectiveLayout()==='list') {
    return `<article class="${className}" data-cue-id="${escapeHtml(cue.id)}" ${attrs}><span class="cue-order-list" aria-label="Track ${index+1}">${number}</span><span class="cue-icon" aria-hidden="true">${statusIcon}</span>${content}<div class="cue-trailing"><span class="cue-duration">${duration}</span><span class="cue-state">${label}</span></div>${edits}</article>`;
  }
  return `<article class="${className}" data-cue-id="${escapeHtml(cue.id)}" ${attrs}><div class="cue-top"><span class="cue-icon" aria-hidden="true">${statusIcon}</span><span class="cue-duration">${duration}</span></div>${content}<div class="cue-footer"><span class="cue-state">${label}</span><span class="cue-order">${number}</span></div></article>`;
}
function render() { renderNav(); renderMain(); updatePlayerUI(); }
function updatePlayerUI() {
  const selected=state.selectedCue;
  const target=trackToPlay();
  const status=state.playback;
  const queued=state.playbackBehavior==='select' && target && !sameCue(target,selected);
  const secondary=$('player-secondary');
  $('player-title').textContent=queued ? target.label : (selected?.label || 'Nothing selected');
  if(queued){
    $('player-status').textContent='SELECTED · READY TO PLAY';
    secondary.textContent=isAudioActive() ? `Currently ${status}: ${selected.label} — audio continues until you press Play and confirm.` : 'Press Play to start the selected track.';
    secondary.hidden=false;
  } else {
    $('player-status').textContent=({playing:'PLAYING',paused:'PAUSED',stopped:'STOPPED',ended:'FINISHED',error:'ERROR',idle:'READY'})[status] || 'READY';
    secondary.hidden=true;secondary.textContent='';
  }
  $('play-button').disabled=!target || (status==='playing' && !queued);
  $('pause-button').disabled=!selected || status!=='playing';
  $('stop-button').disabled=!selected || (status!=='playing' && status!=='paused' && status!=='ended');
  const slider = $('seek-slider');
  const duration = audio.duration;
  const canSeek = Boolean(selected) && Number.isFinite(duration) && duration > 0;
  slider.disabled = !canSeek;
  // While the user drags, keep the thumb and elapsed-time label at their chosen
  // position; ordinary timeupdate events must not snap the thumb backwards.
  const displayTime = isScrubbing && canSeek ? seekPreviewTime : (audio.currentTime || 0);
  $('elapsed').textContent = seconds(displayTime);
  $('duration').textContent = seconds(duration || 0);
  const percentage = canSeek ? Math.max(0, Math.min(100, 100 * displayTime / duration)) : 0;
  if (!isScrubbing) slider.value = String(Math.round(percentage * 10));
  slider.style.setProperty('--seek-percent', `${percentage}%`);
  slider.setAttribute('aria-valuetext', `${seconds(displayTime)} of ${seconds(duration || 0)}`);
}
function modal(title,message,confirmLabel,onConfirm) {
  state.pending = onConfirm;
  $('dialog-title').textContent=title;
  $('dialog-message').textContent=message;
  $('dialog-confirm').textContent=confirmLabel;
  $('confirm-dialog').showModal();
  $('dialog-cancel').focus();
}
function nameDialog(title,initialValue,label,handler,note=null) {
  state.nameHandler = handler;
  $('name-dialog-title').textContent = title;
  $('name-label').textContent = label;
  $('name-input').value = initialValue || '';
  $('note-field').hidden = note === null;
  $('note-input').value = note === null ? '' : note;
  $('name-dialog').showModal();
  $('name-input').focus(); $('name-input').select();
}
// An explicit diagnostic for pre-service setup. A cached shell is necessary but
// not proof that audio survives device storage cleanup; Check Files and Airplane
// Mode tests remain essential before any live service.
async function checkOfflineSetup() {
  const localHost = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  if (location.protocol !== 'https:' || localHost) {
    alert('Offline Setup — Development Mode\n\nThe app works for development here, but automatic offline reopening needs an HTTPS installation.\n\nAfter hosting this version with HTTPS, open it on your tablet in Chrome, install it from Chrome’s menu, and return here to check the offline cache.');
    return;
  }
  if (!('serviceWorker' in navigator) || !('caches' in window)) {
    alert('Offline Setup\n\nThis browser does not support the offline-app cache required by CBC Audio Cues. Use current Google Chrome on Android or Safari on iPad.');
    return;
  }
  try {
    const registration = await navigator.serviceWorker.getRegistration('./');
    const cache = await caches.open('cbc-audio-cues-shell-v7');
    const files = ['./index.html','./style.css','./app.js','./manifest.webmanifest',
      './icons/icon-192.png','./icons/icon-512.png'];
    const missing = [];
    for (const path of files) {
      if (!(await cache.match(new URL(path, location.href)))) missing.push(path);
    }
    const workerActive = Boolean(registration?.active);
    let persistence = 'Unknown';
    if (navigator.storage?.persisted) {
      persistence = (await navigator.storage.persisted()) ? 'Granted' : 'Not guaranteed';
    }
    const shellReady = workerActive && !missing.length;
    alert(`Offline Setup\n\nApp files cached: ${shellReady ? 'YES' : 'NOT YET'}\nStorage persistence: ${persistence}\n\n${shellReady ? 'The application interface is cached on this device.' : 'Connect to the internet, reload the app once, and try Offline Setup again.'}\n\nThis does not verify your music files. Run Check Files for every service playlist, keep external backups, and test by turning on Airplane Mode, closing and reopening the app, and playing music.`);
  } catch (error) {
    console.error(error);
    alert('Could not check the offline app cache.\n\n'+error.message);
  }
}

async function savePlaylist(playlist) { await dbOperation('playlists','put',playlist); }
function currentCueFromPlaylist(cueId) { return selectedPlaylist()?.cues.find(c=>c.id === cueId); }
async function createPlaylist() {
  nameDialog('Create Playlist','','Playlist name',async name => {
    const playlist = {id:makeId(),name,cues:[]};
    await savePlaylist(playlist); state.playlists.push(playlist);
    state.selectedPlaylistId = playlist.id; state.view = 'playlist'; state.editMode = true; render();
    toast('Playlist created. Import audio to add tracks.');
  });
}
async function addReference(fileId,playlistId) {
  const file = fileById(fileId); const playlist = state.playlists.find(p=>p.id===playlistId);
  if (!file || !playlist) return;
  playlist.cues.push({id:makeId(),fileId,label:tidyName(file.name),note:''});
  await savePlaylist(playlist); render();
}
async function importAudio(files,playlistId) {
  if (!state.editMode) { toast('Switch to Edit Mode to import audio.'); return; }
  if (isAudioActive()) {toast('Stop the current track before importing audio.');return;}
  const candidates = files.filter(file=>file instanceof File && (supportedAudio.test(file.name) || /^audio\//.test(file.type)));
  if (candidates.length === 0) { toast('Choose MP3, WAV, M4A, or AAC audio files.'); return; }
  let imported = 0, reused = 0, added = 0;
  try {
    for (const file of candidates) {
      // Reuse an identical import for common cases. The source original is not modified.
      let existing = state.files.find(f=>f.name === file.name && f.size === file.size && f.lastModified === file.lastModified);
      if (!existing) {
        existing = {id:makeId(),name:file.name,size:file.size,type:file.type,blob:file,lastModified:file.lastModified,addedAt:Date.now()};
        await dbOperation('files','put',existing);
        state.files.push(existing);
        state.urls.set(existing.id,URL.createObjectURL(existing.blob));
        imported++;
        getFileDuration(existing).catch(console.warn);
      } else {reused++;if(!existing.duration) getFileDuration(existing).catch(console.warn);}
      if (playlistId && state.playlists.some(p=>p.id===playlistId)) {
        const playlist = state.playlists.find(p=>p.id === playlistId);
        playlist.cues.push({id:makeId(),fileId:existing.id,label:tidyName(existing.name),note:''});
        await savePlaylist(playlist); added++;
      }
    }
    render();
    toast(`${imported} new ${imported===1?'file':'files'} saved locally${reused?`, ${reused} reused`:''}${added?`; ${added} tracks added to playlist`:''}.`);
    if (navigator.storage?.persist) navigator.storage.persist().catch(()=>{});
  } catch(error) {
    console.error(error); render();
    alert('Could not save all audio files to local storage. The iPad may be low on available space.\n\n'+error.message);
  }
}
function stopAudio(clearSelection=false) {
  isScrubbing = false;
  audio.pause();
  releaseWakeLock();
  try { audio.currentTime = 0; } catch (_) { /* No loaded audio yet. */ }
  state.playback = 'stopped';
  if (clearSelection) { state.selectedCue = null; state.armedCue=null; audio.removeAttribute('src'); audio.load(); state.playback='idle'; }
  updatePlayerUI();
}
function startCue(cue,playlistId) {
  const file = fileById(cue.fileId);
  const url = state.urls.get(cue.fileId);
  if (!file || !url) {
    alert(`Audio file unavailable: "${cue.label}".\n\nReimport this file through Edit Mode to restore it.`);
    return;
  }
  audio.pause();
  releaseWakeLock();
  isScrubbing = false;
  state.selectedCue = {...cue,playlistId};
  state.armedCue = {...cue,playlistId};
  audio.src = url;
  audio.load();
  state.playback = 'playing';
  render();
  // play() is intentionally invoked in the actual tap/confirm event handler.
  const attempt = audio.play();
  if (attempt?.then) attempt.then(requestWakeLock);
  if (attempt?.catch) attempt.catch(error => {
    releaseWakeLock(); state.playback='error'; render();
    alert(`Could not play "${cue.label}".\n\n${error.message}\n\nCheck that the audio format is supported and the device's audio output is connected.`);
  });
}
function tapCue(cueId) {
  if (state.editMode) return;
  const playlist = selectedPlaylist(), cue = currentCueFromPlaylist(cueId);
  if (!playlist || !cue) return;
  if (state.playbackBehavior==='select') {selectCueOnly(cue,playlist.id);return;}
  if (state.selectedCue?.id === cue.id && state.selectedCue?.playlistId === playlist.id) {
    if (state.playback === 'playing') return;
    if (state.playback === 'paused') { resume(); return; }
    startCue(cue,playlist.id); return;
  }
  if (state.playback === 'playing' || state.playback === 'paused') {
    modal('Change Audio Track?',`"${state.selectedCue.label}" is currently ${state.playback}.\n\nStop it and begin playing "${cue.label}"?\n\nCancel keeps the current track unchanged.`,'Continue',() => startCue(cue,playlist.id));
  } else startCue(cue,playlist.id);
}
function resume() {
  if (!state.selectedCue || state.playback === 'playing') return;
  // Do not reset an intentionally scrubbed position when resuming a stopped
  // or completed track. If the playhead is still at the very end, restart.
  if (state.playback === 'ended' && Number.isFinite(audio.duration) &&
      audio.currentTime >= audio.duration - 0.05) {
    try { audio.currentTime = 0; } catch (_) {}
  }
  state.playback='playing'; render();
  const attempt = audio.play();
  if (attempt?.then) attempt.then(requestWakeLock);
  if (attempt?.catch) attempt.catch(error => {releaseWakeLock();state.playback='error';render();alert(`Could not start audio: ${error.message}`);});
}
function pause() { if (state.playback === 'playing') { audio.pause(); releaseWakeLock(); state.playback = 'paused'; render(); } }
async function moveCue(cueId,direction) {
  const p=selectedPlaylist(); if (!p) return;
  const index=p.cues.findIndex(c=>c.id===cueId),next=index+direction;
  if (index<0 || next<0 || next>=p.cues.length) return;
  [p.cues[index],p.cues[next]]=[p.cues[next],p.cues[index]];
  await savePlaylist(p); render();
}
function picker() {
  if (!selectedPlaylist()) return;
  refreshPicker(); $('picker-dialog').showModal();
}
function refreshPicker() {
  $('picker-list').innerHTML = state.files.length ? state.files.slice().sort((a,b)=>a.name.localeCompare(b.name)).map(f=>`<div class="picker-item"><span class="picker-filename">${escapeHtml(f.name)}</span><button type="button" class="secondary-button" data-action="pick-file" data-file-id="${escapeHtml(f.id)}">+ Add</button></div>`).join('') : '<p>There are no audio files in your library yet. Use Import Audio to add some.</p>';
}
async function inspectAudioFile(file, timeoutMs=8500) {
  if (!file?.blob || !(file.blob instanceof Blob)) return {status:'missing'};
  const url=state.urls.get(file.id);
  if (!url) return {status:'missing'};
  return new Promise(resolve=>{
    const tester=new Audio();let settled=false;
    let timer;
    const finish=(status,duration=0)=>{
      if(settled)return;settled=true;clearTimeout(timer);
      tester.removeAttribute('src');tester.load();
      resolve({status,duration});
    };
    tester.preload='metadata';
    tester.addEventListener('loadedmetadata',()=>{
      if(Number.isFinite(tester.duration)&&tester.duration>0)finish('ready',tester.duration);
    },{once:true});
    tester.addEventListener('canplay',()=>finish('ready',Number.isFinite(tester.duration)?tester.duration:0),{once:true});
    tester.addEventListener('error',()=>finish('unplayable'),{once:true});
    timer=setTimeout(()=>finish('unverified'),timeoutMs);
    tester.src=url;tester.load();
  });
}
async function getFileDuration(file) {
  if(file.duration || !state.urls.get(file.id))return;
  const result=await inspectAudioFile(file,5500);
  if(result.status==='ready' && result.duration>0 && !file.duration){
    file.duration=result.duration;
    await dbOperation('files','put',file);
    if(state.view==='playlist') renderMain();
    else if(state.view==='library') renderMain();
  }
}
async function checkFiles() {
  if(isAudioActive()){toast('Stop the current track before running the pre-service check.');return;}
  const p=selectedPlaylist();if(!p)return;
  const panel=$('check-dialog'), content=$('check-results');
  panel.showModal();
  if(!p.cues.length){content.textContent='There are no tracks in this playlist.';return;}
  content.textContent=`Checking ${p.cues.length} audio ${p.cues.length===1?'track':'tracks'}…`;
  const results=new Map();
  for (let i=0;i<p.cues.length;i++) {
    const cue=p.cues[i];
    if(!results.has(cue.fileId)){
      const file=fileById(cue.fileId);
      const result=await inspectAudioFile(file);
      results.set(cue.fileId,result);
      if(file && result.duration && !file.duration) {
        file.duration=result.duration;
        await dbOperation('files','put',file);
      }
    }
    content.textContent=`Checking ${i+1} of ${p.cues.length} tracks…`;
  }
  let ready=0,missing=0,unplayable=0,unverified=0;
  const rows=p.cues.map(c=>{
    const result=results.get(c.fileId);
    if(result.status==='ready')ready++;
    else if(result.status==='missing')missing++;
    else if(result.status==='unplayable')unplayable++;
    else unverified++;
    const label={ready:'Loaded metadata',missing:'Audio missing',unplayable:'Cannot load format',unverified:'Could not verify'}[result.status];
    return `<div class="check-result"><span>${escapeHtml(c.label)}</span><span class="check-${result.status}">${label}</span></div>`;
  }).join('');
  content.innerHTML=`<p><strong>${ready} verified · ${missing} missing · ${unplayable} failed · ${unverified} unverified</strong></p>${rows}<p class="check-disclaimer">This is a file/metadata test, not an audible sound check. Some iPad browsers may restrict metadata loading until a track plays. Test every cue and the audio output before the service.</p>`;
  renderMain();
}
/* Backups contain a compact JSON index followed by original binary audio blobs.
   They never send music to a server. A backup is a single .cbcbackup file. */
async function exportBackup() {
  if(isAudioActive()){toast('Stop playback before exporting a large backup.');return;}
  if(state.busy) {toast('Another data operation is in progress.');return;}
  state.busy=true;
  try {
    const manifest={format:'CBC Audio Cues',version:1,createdAt:new Date().toISOString(),files:[],playlists:[]};
    let offset=0;
    const blobs=[];
    for(const file of state.files) {
      if(!(file.blob instanceof Blob))throw new Error(`Audio is missing for "${file.name}". Backup cancelled; run Check Files first.`);
      manifest.files.push({id:file.id,name:file.name,type:file.type||'',size:file.blob.size,
        addedAt:file.addedAt||Date.now(),lastModified:file.lastModified||0,duration:file.duration||0,offset});
      offset+=file.blob.size;blobs.push(file.blob);
    }
    manifest.playlists=state.playlists.map(p=>({id:p.id,name:p.name,cues:allCues(p).map(c=>({...c}))}));
    const metadata=new TextEncoder().encode(JSON.stringify(manifest));
    if(metadata.byteLength>32*1024*1024)throw new Error('Backup index is too large.');
    const header=new Uint8Array(16);header.set(new TextEncoder().encode(BACKUP_MAGIC));
    new DataView(header.buffer).setUint32(12,metadata.length,true);
    const backup=new Blob([header,metadata,...blobs],{type:'application/octet-stream'});
    const url=URL.createObjectURL(backup);
    const link=document.createElement('a');link.href=url;
    link.download=`CBC-Audio-Cues-Backup-${new Date().toISOString().slice(0,10)}.cbcbackup`;
    document.body.appendChild(link);link.click();link.remove();
    setTimeout(()=>URL.revokeObjectURL(url),60000);
    toast(`Backup prepared: ${manifest.playlists.length} playlists and ${manifest.files.length} audio files. Save the download somewhere safe.`);
  } catch(error){console.error(error);alert(`Backup failed: ${error.message}`);}
  finally{state.busy=false;}
}
async function readBackup(file) {
  if(!file || file.size<18) throw new Error('This file is too small to be a backup.');
  const header=new Uint8Array(await file.slice(0,16).arrayBuffer());
  const magic=new TextDecoder().decode(header.slice(0,12));
  if(magic!==BACKUP_MAGIC) throw new Error('Not a CBC Audio Cues backup file.');
  const length=new DataView(header.buffer).getUint32(12,true);
  if(length<2 || length>32*1024*1024 || 16+length>file.size) throw new Error('Backup index is missing or damaged.');
  let manifest;
  try {manifest=JSON.parse(await file.slice(16,16+length).text());}
  catch (_) {throw new Error('Backup index is not valid JSON.');}
  if(manifest.format!=='CBC Audio Cues' || manifest.version!==1 || !Array.isArray(manifest.files)||!Array.isArray(manifest.playlists))
    throw new Error('Unsupported backup format or version.');
  if(manifest.files.length>5000 || manifest.playlists.length>5000)throw new Error('Unusually large backup index.');
  const dataStart=16+length;
  const seenIds=new Set();
  for(const entry of manifest.files){
    if(!entry || typeof entry.id!=='string' || typeof entry.name!=='string' ||
      !Number.isSafeInteger(entry.size) || entry.size<0 || !Number.isSafeInteger(entry.offset) || entry.offset<0 ||
      entry.offset+entry.size>file.size-dataStart || seenIds.has(entry.id))
      throw new Error('Backup contains invalid or duplicate audio entries.');
    seenIds.add(entry.id);
  }
  for(const playlist of manifest.playlists){
    if(!playlist || typeof playlist.id!=='string' || typeof playlist.name!=='string' ||
      !Array.isArray(playlist.cues) || playlist.cues.length>20000 ||
      playlist.cues.some(c=>!c || typeof c.id!=='string' || typeof c.fileId!=='string' || typeof c.label!=='string'))
      throw new Error('Backup contains an invalid playlist.');
  }
  return {manifest,dataStart};
}
async function confirmRestore(file) {
  if(isAudioActive()){toast('Stop playback before restoring audio.');return;}
  try {
    const {manifest,dataStart}=await readBackup(file);
    modal('Restore Audio Backup?',`Merge the backup (${manifest.playlists.length} playlists and ${manifest.files.length} audio files) into this device?\n\nExisting playlists and files will not be deleted. If a playlist already exists, the restored one will be added as a separate copy.\n\nRestore may take time and require free storage space.`,'Restore Backup',()=>restoreBackup(file,manifest,dataStart));
  }catch(error){alert(`Cannot restore backup: ${error.message}`);}
}
async function restoreBackup(archive,manifest,dataStart) {
  if(isAudioActive()){toast('Stop playback before restoring audio.');return;}
  if(state.busy){toast('Another data operation is running.');return;}
  state.busy=true;
  let addedFiles=0,addedPlaylists=0;
  const remap=new Map();
  try {
    for(const entry of manifest.files) {
      const existing=fileById(entry.id);
      if(existing && existing.blob?.size===entry.size && existing.name===entry.name){remap.set(entry.id,entry.id);continue;}
      // If the file ID already names another file, preserve both files.
      const newId=existing?makeId():entry.id;
      const blob=archive.slice(dataStart+entry.offset,dataStart+entry.offset+entry.size,entry.type||'application/octet-stream');
      const item={id:newId,name:entry.name.slice(0,300),type:entry.type||'',size:entry.size,blob,
        lastModified:entry.lastModified||0,addedAt:entry.addedAt||Date.now(),
        duration:Number.isFinite(entry.duration)?entry.duration:0};
      await dbOperation('files','put',item);
      state.files.push(item);state.urls.set(newId,URL.createObjectURL(blob));
      remap.set(entry.id,newId);addedFiles++;
    }
    for(const playlist of manifest.playlists){
      const collides=state.playlists.some(p=>p.id===playlist.id);
      const copy={id:collides?makeId():playlist.id,
        name:(collides?`${playlist.name} (Restored)`:playlist.name).slice(0,120),
        cues:playlist.cues.map(c=>({...c,id:makeId(),fileId:remap.get(c.fileId) || c.fileId,
          note:typeof c.note==='string'?c.note:'',label:c.label.slice(0,110)}))};
      await savePlaylist(copy);state.playlists.push(copy);addedPlaylists++;
    }
    state.playlists.sort((a,b)=>a.name.localeCompare(b.name));
    state.selectedPlaylistId=state.playlists[0]?.id||null;
    state.view='playlist';render();
    toast(`Restore complete: ${addedPlaylists} playlists, ${addedFiles} new audio copies. Existing data preserved.`);
  }catch(error){
    console.error(error);
    render();
    alert(`Restore interrupted after adding ${addedFiles} audio files and ${addedPlaylists} playlists.\n\nExisting data was not deleted.\n\n${error.message}`);
  }finally{state.busy=false;}
}

/* Touch-and-pointer drag is limited to a dedicated handle in Edit Mode.
   The native desktop HTML5 drag handler continues working elsewhere on each card.
   Touch hold protects against unintentionally reordering while scrolling. */
function setupPointerDrag() {
  const main=$('main-content');
  main.addEventListener('pointerdown',event=>{
    const handle=event.target.closest('[data-drag-handle]');
    if(!handle||!state.editMode || state.view!=='playlist' || event.button!==0)return;
    event.preventDefault();
    const id=handle.dataset.cueId;
    pointerDrag={id,handle,pointerId:event.pointerId,x:event.clientX,y:event.clientY,
      active:false,hoverId:null,timer:null};
    // All pointer types use the handle, including Edge touchscreen emulation.
    try {handle.setPointerCapture(event.pointerId);}catch(_){ }
    pointerDrag.timer=setTimeout(()=>{
      if(!pointerDrag || pointerDrag.id!==id)return;
      pointerDrag.active=true;
      main.querySelectorAll('.cue-card').forEach(card=>{
        if(card.dataset.cueId===id)card.classList.add('dragging');
      });
      handle.classList.add('drag-handle-active');
    },event.pointerType==='mouse'?60:210);
  });
  main.addEventListener('pointermove',event=>{
    const d=pointerDrag;if(!d||d.pointerId!==event.pointerId)return;
    if(!d.active){
      const distance=Math.hypot(event.clientX-d.x,event.clientY-d.y);
      if(distance>13){clearTimeout(d.timer);pointerDrag=null;}
      return;
    }
    event.preventDefault();
    main.querySelectorAll('.cue-card.drag-over').forEach(card=>card.classList.remove('drag-over'));
    const beneath=document.elementFromPoint(event.clientX,event.clientY)?.closest('.cue-card');
    const over=beneath && beneath.dataset.cueId!==d.id ? beneath : null;
    d.hoverId=over?.dataset.cueId||null;
    if(over)over.classList.add('drag-over');
    // Gently scroll the main pane when dragging near its top/bottom edges.
    const rect=main.getBoundingClientRect();
    if(event.clientY<rect.top+35){main.scrollTop-=15;window.scrollBy?.(0,-12);}
    if(event.clientY>Math.min(rect.bottom,window.innerHeight)-35){main.scrollTop+=15;window.scrollBy?.(0,12);}
  });
  async function complete(event,commit) {
    const d=pointerDrag;if(!d||d.pointerId!==event.pointerId)return;
    clearTimeout(d.timer);pointerDrag=null;
    d.handle.classList.remove('drag-handle-active');
    try{d.handle.releasePointerCapture(event.pointerId);}catch(_){}
    main.querySelectorAll('.cue-card.drag-over,.cue-card.dragging').forEach(card=>card.classList.remove('drag-over','dragging'));
    if(!commit||!d.active||!d.hoverId)return;
    const p=selectedPlaylist();if(!p)return;
    const from=p.cues.findIndex(c=>c.id===d.id),to=p.cues.findIndex(c=>c.id===d.hoverId);
    if(from<0||to<0||from===to)return;
    const [moving]=p.cues.splice(from,1);p.cues.splice(to,0,moving);
    try{await savePlaylist(p);render();}catch(error){console.error(error);toast('Could not save the track order.');}
  }
  main.addEventListener('pointerup',event=>{complete(event,true);});
  main.addEventListener('pointercancel',event=>{complete(event,false);});
  main.addEventListener('lostpointercapture',event=>{complete(event,false);});
}

async function executeMainAction(action, target) {
  const cueId=target.dataset.cueId, fileId=target.dataset.fileId;
  const p=selectedPlaylist();
  try {
    switch(action) {
      case 'new-playlist': return createPlaylist();
      case 'switch-layout': return setPlaybackLayout(target.dataset.layout);
      case 'enable-edit': state.editMode=true; return render();
      case 'import': return $('file-input').click();
      case 'check-files': return checkFiles();
      case 'backup': return exportBackup();
      case 'restore': return $('backup-input').click();
      case 'offline-check': return checkOfflineSetup();
      case 'reset-played': {if(p) {for(const cue of p.cues) state.played.delete(cue.id);render();toast('Played indicators cleared for this playlist.');} return;}
      case 'rename-playlist': if (p) nameDialog('Rename Playlist',p.name,'Playlist name',async name=>{p.name=name; await savePlaylist(p);render();}); return;
      case 'duplicate-playlist': if(p) nameDialog('Duplicate Playlist',`${p.name} Copy`,'New playlist name',async name=>{
        const copy={id:makeId(),name,cues:p.cues.map(c=>({...c,id:makeId()}))};
        await savePlaylist(copy);state.playlists.push(copy);state.playlists.sort((a,b)=>a.name.localeCompare(b.name));
        state.selectedPlaylistId=copy.id;state.view='playlist';render();toast('Playlist duplicated; audio files were not copied.');
      });return;
      case 'delete-playlist': if(p) modal('Delete Playlist?',`Delete "${p.name}" and its ${p.cues.length} track references?\n\nNo audio files will be deleted.`,'Delete Playlist',async ()=>{
        await dbOperation('playlists','delete',p.id);state.playlists=state.playlists.filter(x=>x.id!==p.id);
        if(state.armedCue?.playlistId===p.id)state.armedCue=null;
        state.selectedPlaylistId=state.playlists[0]?.id||null;render();toast('Playlist deleted. Audio library unchanged.');
      }); return;
      case 'add-from-library': return picker();
      case 'move-up': return moveCue(cueId,-1);
      case 'move-down': return moveCue(cueId,1);
      case 'rename-cue': {
        const cue=currentCueFromPlaylist(cueId); if (!cue||!p) return;
        return nameDialog('Edit Track',cue.label,'Display name',async (name,note)=>{
          cue.label=name; cue.note=note; await savePlaylist(p);render();
          if(state.selectedCue?.id===cue.id && state.selectedCue?.playlistId===p.id) {state.selectedCue.label=name;}
          if(sameCue(state.armedCue,{id:cue.id,playlistId:p.id}))state.armedCue.label=name;updatePlayerUI();
        },cue.note || '');
      }
      case 'remove-cue': {
        const cue=currentCueFromPlaylist(cueId); if(!p||!cue) return;
        return modal('Remove Track?',`Remove "${cue.label}" from "${p.name}"?\n\nIts audio file will remain in the Audio Library and any other playlists.`,'Remove Track',async ()=>{
          p.cues=p.cues.filter(c=>c.id!==cue.id);await savePlaylist(p);
          if(sameCue(state.armedCue,{id:cue.id,playlistId:p.id}))state.armedCue=null;
          render();toast('Track removed; audio file retained.');
        });
      }
      case 'delete-file': {
        const file=fileById(fileId);if(!file)return;
        if (isAudioActive()) {toast('Stop playback before deleting stored audio.');return;}
        const count=countReferences(file.id);
        return modal('Permanently Delete Stored Copy?',`Delete the imported copy of "${file.name}" from CBC Audio Cues?\n\nThis will also remove ${count} ${count===1?'track reference':'track references'} across all playlists. It cannot be undone.\n\nThe original file in the Files app or computer will NOT be deleted.`,'Delete Stored Copy',async ()=>{
          if(state.selectedCue?.fileId===file.id)stopAudio(true);
          for(const playlist of state.playlists){if(playlist.cues.some(c=>c.fileId===file.id)){playlist.cues=playlist.cues.filter(c=>c.fileId!==file.id);await savePlaylist(playlist);}}
          if(state.armedCue?.fileId===file.id)state.armedCue=null;
          await dbOperation('files','delete',file.id);
          state.files=state.files.filter(f=>f.id!==file.id);URL.revokeObjectURL(state.urls.get(file.id));state.urls.delete(file.id);
          render();toast('Imported copy removed; source file untouched.');
        });
      }
      default: return;
    }
  } catch(error) {console.error(error);alert('Could not complete the action: '+error.message);}
}

function setupEvents() {
  setupPointerDrag();
  $('mode-toggle').addEventListener('click',()=>{state.editMode=!state.editMode;render();});
  $('settings-toggle').addEventListener('click',openSettings);
  $('settings-close').addEventListener('click',()=>$('settings-dialog').close());
  $('settings-done').addEventListener('click',()=>$('settings-dialog').close());
  $('settings-dialog').addEventListener('change',event=>{
    if(event.target.name==='app-theme')applyTheme(event.target.value);
    if(event.target.name==='playback-behavior')setPlaybackBehavior(event.target.value);
  });
  $('new-playlist').addEventListener('click',createPlaylist);
  $('library-nav').addEventListener('click',()=>{state.view='library';render();});
  $('playlist-nav').addEventListener('click',e=>{
    const entry=e.target.closest('[data-playlist-id]');if (!entry) return;
    state.selectedPlaylistId=entry.dataset.playlistId;state.view='playlist';
    if(state.playbackBehavior==='select' && !sameCue(state.armedCue,{id:state.selectedCue?.id,playlistId:state.selectedPlaylistId}))state.armedCue=null;
    render();
  });
  $('main-content').addEventListener('click',e=>{
    const button=e.target.closest('[data-action]');
    if (button) {executeMainAction(button.dataset.action,button);return;}
    const card=e.target.closest('[data-cue-id]');if(card && !state.editMode)tapCue(card.dataset.cueId);
  });
  $('main-content').addEventListener('keydown',e=>{
    if (e.target.matches('.cue-card[role="button"]') && (e.key==='Enter'||e.key===' ')) {e.preventDefault();tapCue(e.target.dataset.cueId);}
  });
  $('main-content').addEventListener('dragstart',e=>{
    if(e.target.closest('[data-drag-handle]')){e.preventDefault();return;}
    const card=e.target.closest('.cue-card[draggable="true"]');if(!card||!state.editMode)return;
    draggedCueId=card.dataset.cueId;e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',draggedCueId);
  });
  $('main-content').addEventListener('dragover',e=>{
    if(!draggedCueId)return;const card=e.target.closest('.cue-card[draggable="true"]');if(!card)return;
    e.preventDefault();e.dataTransfer.dropEffect='move';card.classList.add('drag-over');
  });
  $('main-content').addEventListener('dragleave',e=>{
    const card=e.target.closest('.cue-card');if(card)card.classList.remove('drag-over');
  });
  $('main-content').addEventListener('drop',async e=>{
    const card=e.target.closest('.cue-card[draggable="true"]');
    if(!card||!draggedCueId)return;
    e.preventDefault();e.stopPropagation();
    const p=selectedPlaylist();const from=p?.cues.findIndex(c=>c.id===draggedCueId),to=p?.cues.findIndex(c=>c.id===card.dataset.cueId);
    if(p && from>=0 && to>=0 && from!==to){const [moving]=p.cues.splice(from,1);p.cues.splice(to,0,moving);await savePlaylist(p);}
    draggedCueId=null;render();
  });
  document.addEventListener('dragend',()=>{draggedCueId=null;render();});
  window.addEventListener('dragover',e=>{if([...e.dataTransfer.types].includes('Files'))e.preventDefault();});
  window.addEventListener('drop',e=>{
    if(e.dataTransfer.files.length){e.preventDefault();importAudio(Array.from(e.dataTransfer.files),state.view==='playlist'?state.selectedPlaylistId:null);}
  });
  $('backup-input').addEventListener('change',e=>{
    const selected=e.target.files?.[0];e.target.value='';if(selected) confirmRestore(selected);
  });
  $('file-input').addEventListener('change',e=>{
    const files=Array.from(e.target.files);e.target.value='';
    importAudio(files,state.view==='playlist'?state.selectedPlaylistId:null);
  });
  $('play-button').addEventListener('click',playFromControls);
  $('pause-button').addEventListener('click',pause);
  $('stop-button').addEventListener('click',()=>{stopAudio();render();});

  const seekSlider = $('seek-slider');
  function validSeekDuration() {
    return !seekSlider.disabled && Number.isFinite(audio.duration) && audio.duration > 0;
  }
  function previewSeek() {
    if (!validSeekDuration()) return;
    seekPreviewTime = (Number(seekSlider.value) / 1000) * audio.duration;
    isScrubbing = true;
    updatePlayerUI();
  }
  function commitSeek() {
    if (!isScrubbing || !validSeekDuration()) { isScrubbing = false; updatePlayerUI(); return; }
    const target = Math.max(0, Math.min(audio.duration, seekPreviewTime));
    isScrubbing = false;
    try {
      audio.currentTime = target;
      // When repositioning a finished track, Play should resume from here.
      if (state.playback === 'ended' && target < audio.duration - 0.05) state.playback = 'stopped';
    } catch (error) { toast('Unable to seek in this audio file.'); }
    updatePlayerUI();
  }
  // Drag/touch seeking previews the position. Playback jumps on release.
  // Keyboard adjustments commit immediately for accessibility.
  seekSlider.addEventListener('input', () => {
    previewSeek();
    if (!isScrubbing) return;
    // Pointer movement waits for release; keyboard should seek with arrow keys.
    if (!pointerScrubbing) commitSeek();
  });
  let pointerScrubbing = false;
  seekSlider.addEventListener('pointerdown', () => { if (validSeekDuration()) pointerScrubbing = true; });
  seekSlider.addEventListener('pointerup', () => { pointerScrubbing = false; commitSeek(); });
  seekSlider.addEventListener('pointercancel', () => { pointerScrubbing = false; isScrubbing = false; updatePlayerUI(); });
  seekSlider.addEventListener('change', () => { pointerScrubbing = false; commitSeek(); });
  seekSlider.addEventListener('blur', () => { pointerScrubbing = false; commitSeek(); });

  audio.addEventListener('timeupdate',updatePlayerUI);
  audio.addEventListener('seeked',updatePlayerUI);
  audio.addEventListener('durationchange',()=>{
    if(state.selectedCue && Number.isFinite(audio.duration) && audio.duration>0){
      state.durations.set(state.selectedCue.fileId,audio.duration);
      const file=fileById(state.selectedCue.fileId);
      if(file && !file.duration){file.duration=audio.duration;dbOperation('files','put',file).catch(console.error);renderMain();}
    }
    updatePlayerUI();
  });
  audio.addEventListener('ended',()=>{
    releaseWakeLock();
    // Intentionally do NOT play or select any other track.
    if(state.selectedCue){state.played.add(state.selectedCue.id);state.playback='ended';}
    render();
  });
  audio.addEventListener('error',()=>{
    if(!state.selectedCue||!audio.getAttribute('src'))return;
    releaseWakeLock();state.playback='error';render();toast('Audio playback error. Check the file format and try again.');
  });
  $('dialog-cancel').addEventListener('click',()=>$('confirm-dialog').close());
  $('confirm-dialog').addEventListener('close',()=>{state.pending=null;});
  $('dialog-confirm').addEventListener('click',()=>{
    // Invoke the callback directly from the confirmation tap, for iPad audio permission.
    const action=state.pending;
    $('confirm-dialog').close();state.pending=null;
    if(action){const result=action();if(result?.catch)result.catch(error=>{console.error(error);alert(error.message);});}
  });
  $('name-cancel').addEventListener('click',()=>$('name-dialog').close());
  $('name-dialog').addEventListener('close',()=>{state.nameHandler=null;});
  $('name-form').addEventListener('submit',e=>{
    e.preventDefault();const name=$('name-input').value.trim();if(!name)return;
    const action=state.nameHandler, note=$('note-field').hidden ? undefined : $('note-input').value.trim();$('name-dialog').close();
    if(action){const result=action(name,note);if(result?.catch)result.catch(error=>{console.error(error);alert(error.message);});}
  });
  $('picker-close').addEventListener('click',()=>$('picker-dialog').close());
  $('check-close').addEventListener('click',()=>$('check-dialog').close());
  $('picker-list').addEventListener('click',async e=>{
    const item=e.target.closest('[data-action="pick-file"]');if(!item)return;
    try {await addReference(item.dataset.fileId,state.selectedPlaylistId);toast('Audio track added.');}catch(error){alert(error.message);}
  });
  document.addEventListener('visibilitychange',()=>{if(document.hidden) releaseWakeLock(); else requestWakeLock();});
}

async function init() {
  try {
    state.db=await openDatabase();
    [state.playlists,state.files]=await Promise.all([dbOperation('playlists','getAll'),dbOperation('files','getAll')]);
    for (const playlist of state.playlists) {if(!Array.isArray(playlist.cues)){ensureCues(playlist);await savePlaylist(playlist);}}
    state.playlists.sort((a,b)=>a.name.localeCompare(b.name));
    state.selectedPlaylistId=state.playlists[0]?.id||null;
    for(const file of state.files) if(file.blob) state.urls.set(file.id,URL.createObjectURL(file.blob));
    state.playbackLayout=readPlaybackLayout();
    state.playbackBehavior=loadPreference(PLAYBACK_BEHAVIOR_STORAGE_KEY,['instant','select'],'instant');
    applyTheme(loadPreference(THEME_STORAGE_KEY,['light','dark'],'light'));
    setupEvents();render();
    if('serviceWorker' in navigator && location.protocol==='https:' && location.hostname!=='localhost' && location.hostname!=='127.0.0.1') {
      navigator.serviceWorker.register('./sw.js').catch(error=>console.warn('Offline app-shell cache unavailable:',error));
    }
  } catch(error) {
    console.error(error);
    $('main-content').innerHTML=`<div class="empty-state"><h2>Local Storage Unavailable</h2><p>${escapeHtml(error.message)}</p><p>Open this project through a local web server (such as VS Code Live Server), not by double-clicking index.html.</p></div>`;
  }
}
init();
