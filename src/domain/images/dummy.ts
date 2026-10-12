import { deflateSync } from 'node:zlib';
import type { ImageType } from '@/repo/images';
import { hueOf } from './hue';

/**
 * 生成 AI の差し替え可能な入口（C4 の ImageGeneratorPort）。
 * 生成 AI のサービスは未決定（OQ7）。サービスが決まったら、この入口の実装だけを差し替える
 */
export interface ImageGeneratorPort {
  /** 失敗したら例外を投げる。待つ上限は呼び出し側が管理する（BR60.11） */
  generate(req: {
    /** 料理名と材料から作った短い文 */
    prompt: string;
    width: number;
    height: number;
  }): Promise<{ bytes: Uint8Array; contentType: ImageType }>;
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/**
 * 料理名から色を決めた、固定の絵（PNG）を作る。外部のサービスは呼ばない。
 * 背景は料理名の色、中央に明るい丸。頭文字と「AI が作ったイメージ」の印は、画面が重ねて出す
 */
export function renderDummyPng(name: string, size = 96): Uint8Array {
  const hue = hueOf(name);
  const bg = hslToRgb(hue, 0.7, 0.78);
  const fg = hslToRgb(hue, 0.7, 0.9);
  const raw = new Uint8Array((size * 3 + 1) * size);
  const c = size / 2;
  const r2 = (size * 0.32) ** 2;
  let p = 0;
  for (let y = 0; y < size; y++) {
    raw[p++] = 0; // フィルターなし
    for (let x = 0; x < size; x++) {
      const inside = (x + 0.5 - c) ** 2 + (y + 0.5 - c) ** 2 <= r2;
      const [r, g, b] = inside ? fg : bg;
      raw[p++] = r;
      raw[p++] = g;
      raw[p++] = b;
    }
  }
  const ihdr = new Uint8Array(13);
  const v = new DataView(ihdr.buffer);
  v.setUint32(0, size);
  v.setUint32(4, size);
  ihdr[8] = 8; // ビット深度
  ihdr[9] = 2; // RGB
  const parts = [
    Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', new Uint8Array(0)),
  ];
  const out = new Uint8Array(parts.reduce((n, a) => n + a.length, 0));
  let o = 0;
  for (const a of parts) {
    out.set(a, o);
    o += a.length;
  }
  return out;
}

/**
 * 通し版の生成の実装（ダミー）。prompt の先頭（料理名）から色を決める。
 * prompt は「料理名」または「料理名（材料: …）」の形
 */
export const dummyImageGenerator: ImageGeneratorPort = {
  async generate({ prompt, width }) {
    const name = prompt.split('（材料:')[0];
    return { bytes: renderDummyPng(name, Math.min(width, 256)), contentType: 'png' };
  },
};
