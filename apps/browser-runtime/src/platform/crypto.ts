// node:crypto — the synchronous subset AIRP and pi-rp use: createHash/createHmac
// (@noble/hashes), randomUUID/randomBytes/randomInt/getRandomValues (WebCrypto),
// timingSafeEqual. Ciphers / keys / signing throw clearly.
import { sha256, sha224 } from '@noble/hashes/sha256';
import { sha512, sha384 } from '@noble/hashes/sha512';
import { sha1, md5 } from '@noble/hashes/legacy';
import { hmac } from '@noble/hashes/hmac';
import { Buffer } from 'buffer';

const ALGS: Record<string, any> = { sha256, sha224, sha512, sha384, sha1, md5 };

function alg(name: string) {
  const a = ALGS[name.toLowerCase().replace('-', '')];
  if (!a) throw new Error(`Digest method not supported in browser mode: ${name}`);
  return a;
}

function bytes(data: unknown, enc?: string): Uint8Array {
  if (typeof data === 'string') return Buffer.from(data, (enc as any) ?? 'utf8');
  if (data instanceof Uint8Array) return data;
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  throw new TypeError('The "data" argument must be of type string or an instance of Buffer, TypedArray, or DataView.');
}

function digestOut(out: Uint8Array, enc?: string): any {
  const b = Buffer.from(out);
  return enc ? b.toString(enc as any) : b;
}

class Hash {
  #h: any;
  constructor(h: any) { this.#h = h; }
  update(data: unknown, enc?: string) { this.#h.update(bytes(data, enc)); return this; }
  digest(enc?: string) { return digestOut(this.#h.digest(), enc); }
  copy() { return new Hash(this.#h.clone()); }
}

export function createHash(name: string) { return new Hash(alg(name).create()); }
export function createHmac(name: string, key: unknown) { return new Hash(hmac.create(alg(name), bytes(key))); }
export function hash(name: string, data: unknown, enc = 'hex') { return createHash(name).update(data).digest(enc); }
export function getHashes() { return Object.keys(ALGS); }

export const webcrypto = globalThis.crypto;
export const subtle = globalThis.crypto.subtle;
export function getRandomValues<T extends ArrayBufferView>(a: T): T { return globalThis.crypto.getRandomValues(a as any) as T; }
export function randomUUID(): string { return globalThis.crypto.randomUUID(); }
export function randomBytes(n: number, cb?: (e: Error | null, b: Buffer) => void) {
  const b = Buffer.alloc(n);
  for (let i = 0; i < n; i += 65536) globalThis.crypto.getRandomValues(b.subarray(i, Math.min(n, i + 65536)));
  if (cb) { queueMicrotask(() => cb(null, b)); return undefined as any; }
  return b;
}
export function randomFillSync<T extends ArrayBufferView>(a: T): T { return getRandomValues(a); }
export function randomInt(min: number, max?: number) {
  if (max === undefined) { max = min; min = 0; }
  const range = max - min;
  const v = new Uint32Array(1);
  globalThis.crypto.getRandomValues(v);
  return min + (v[0] % range);
}
export function timingSafeEqual(a: Uint8Array, b: Uint8Array) {
  if (a.length !== b.length) throw new RangeError('Input buffers must have the same byte length');
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
  return d === 0;
}
function unsupported(name: string) {
  return () => { throw new Error(`crypto.${name} is not supported in browser mode`); };
}
export const createCipheriv = unsupported('createCipheriv');
export const createDecipheriv = unsupported('createDecipheriv');
export const createSign = unsupported('createSign');
export const createVerify = unsupported('createVerify');
export const createPublicKey = unsupported('createPublicKey');
export const createPrivateKey = unsupported('createPrivateKey');
export const generateKeyPairSync = unsupported('generateKeyPairSync');
export const pbkdf2Sync = unsupported('pbkdf2Sync');
export const scryptSync = unsupported('scryptSync');
export const constants = {};

export default {
  createHash, createHmac, hash, getHashes, webcrypto, subtle, getRandomValues, randomUUID, randomBytes,
  randomFillSync, randomInt, timingSafeEqual, createCipheriv, createDecipheriv, createSign, createVerify,
  createPublicKey, createPrivateKey, generateKeyPairSync, pbkdf2Sync, scryptSync, constants,
};
