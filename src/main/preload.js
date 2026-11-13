// Pont sécurisé entre les pages et le processus principal (liste blanche de canaux).
const { contextBridge, ipcRenderer, webUtils } = require('electron');

const SEND = new Set([
  'cmd', 'player:hitRects', 'player:move', 'glass:shapes', 'player:hide', 'app:quit', 'open:external',
  'engine:status', 'engine:meta', 'engine:ended', 'engine:error', 'colors', 'audio', 'perf',
]);
const INVOKE = new Set([
  'state:get', 'settings:set', 'search', 'playlists', 'playlist:tracks', 'queue:get',
  'spotify:connect', 'spotify:disconnect', 'local:pickFolder', 'local:addFolder', 'local:removeFolder',
  'wallpaper:addVideo', 'wallpaper:removeVideo', 'wallpaper:videoUrl', 'fonts:list', 'edge:layout',
]);
const ON = new Set(['state', 'pos', 'engine:cmd', 'audio', 'glass', 'edge:layout']);

contextBridge.exposeInMainWorld('muisik', {
  send(ch, data) { if (SEND.has(ch)) ipcRenderer.send(ch, data); },
  invoke(ch, ...args) {
    if (!INVOKE.has(ch)) return Promise.reject(new Error(`canal refusé: ${ch}`));
    return ipcRenderer.invoke(ch, ...args);
  },
  on(ch, fn) {
    if (!ON.has(ch)) return () => {};
    const h = (_e, d) => fn(d);
    ipcRenderer.on(ch, h);
    return () => ipcRenderer.removeListener(ch, h);
  },
  pathForFile(file) { try { return webUtils.getPathForFile(file); } catch { return ''; } },
});
