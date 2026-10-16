import type { AssetFs } from '../studio/assets';
import { api } from './api';

/** File access to the open project's folder, through the Electron main process (which enforces the folder limit). */
export const assetFs: AssetFs = {
  read: (f) => api().fs.read(f),
  write: (f, t) => api().fs.write(f, t),
  exists: (f) => api().fs.exists(f),
  remove: (f) => api().fs.remove(f),
  list: (d) => api().fs.list(d),
  writeBinary: (f, b) => api().fs.writeBinary(f, b),
};