// node:fs / node:fs/promises: one in-memory volume (memfs) shared by the server
// and every in-process program. Sync semantics, fs.watch included. Persisting
// the volume to OPFS is a separate step (see persist.ts).
import { Volume, createFsFromVolume } from 'memfs';

export const vol = new Volume();
export const fs: any = createFsFromVolume(vol);

// memfs lacks a few recent APIs; add the ones the server / pi-rp touch.
if (!fs.statfsSync) fs.statfsSync = () => ({ type: 0, bsize: 4096, blocks: 1e6, bfree: 1e6, bavail: 1e6, files: 1e6, ffree: 1e6 });
fs.promises.constants ??= fs.constants;
// memfs exposes the stream classes as accessors over a private slot; libraries
// that clone the fs object (graceful-fs) copy the accessor, not the slot.
for (const k of ['ReadStream', 'WriteStream', 'FileReadStream', 'FileWriteStream']) {
  const v = fs[k];
  Object.defineProperty(fs, k, { value: v, writable: true, enumerable: true, configurable: true });
}

/** Write a map of absolute path -> bytes into the volume, creating directories. */
export function writeTree(files: Record<string, Uint8Array | string>) {
  for (const [p, data] of Object.entries(files)) {
    fs.mkdirSync(p.slice(0, p.lastIndexOf('/')) || '/', { recursive: true });
    fs.writeFileSync(p, data);
  }
}

/** Every file under `root` as relative path -> bytes. */
export function readTree(root: string): Record<string, Uint8Array> {
  const out: Record<string, Uint8Array> = {};
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = `${dir}/${e.name}`;
      if (e.isDirectory()) walk(p);
      else if (e.isFile()) out[p.slice(root.length + 1)] = new Uint8Array(fs.readFileSync(p));
    }
  };
  walk(root);
  return out;
}
