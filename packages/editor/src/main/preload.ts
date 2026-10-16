import { contextBridge } from 'electron';

contextBridge.exposeInMainWorld('tilewright', {
  platform: process.platform,
  versions: { electron: process.versions.electron, chrome: process.versions.chrome },
});
