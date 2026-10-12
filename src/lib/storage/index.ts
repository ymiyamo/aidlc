import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * ファイル（画像など）の実体の保管場所の抽象。
 * ローカルではディスク（.data/images/）、AWS ではオブジェクト保管に差し替える。
 * TODO(infra): AWS 用の実装（S3）は Infrastructure Design で決める。ここではポートだけを定める
 */
export interface ObjectStorage {
  put(key: string, bytes: Uint8Array): Promise<void>;
  /** 無ければ null */
  get(key: string): Promise<Uint8Array | null>;
  /** 無くても成功する（冪等） */
  delete(key: string): Promise<void>;
}

/** 推測できない保管の名前を作る（BR60.6）。kind は保管場所の下の区分 */
export function newStorageKey(kind: 'registered' | 'generated'): string {
  return `${kind}/${randomBytes(24).toString('hex')}`;
}

const KEY_RE = /^(registered|generated)\/[0-9a-f]{48}$/;

/** 決まった形の名前だけを受け付ける。「..」や絶対パスでディスクの外へ出さない */
function assertSafeKey(key: string): void {
  if (!KEY_RE.test(key)) throw new Error('invalid_storage_key');
}

/** ディスクに保管する実装。書き込みは一時ファイル経由で、途中の状態を見せない */
export function createDiskStorage(rootDir: string): ObjectStorage {
  const resolve = (key: string) => {
    assertSafeKey(key);
    return path.join(rootDir, key);
  };
  return {
    async put(key, bytes) {
      const file = resolve(key);
      await mkdir(path.dirname(file), { recursive: true });
      const tmp = `${file}.${randomBytes(4).toString('hex')}.tmp`;
      await writeFile(tmp, bytes);
      await rename(tmp, file);
    },
    async get(key) {
      try {
        return new Uint8Array(await readFile(resolve(key)));
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw err;
      }
    },
    async delete(key) {
      await rm(resolve(key), { force: true });
    },
  };
}

/** メモリ上の実装（テスト用） */
export function createMemoryStorage(): ObjectStorage & { size(): number; keys(): string[] } {
  const files = new Map<string, Uint8Array>();
  return {
    async put(key, bytes) {
      assertSafeKey(key);
      files.set(key, new Uint8Array(bytes));
    },
    async get(key) {
      assertSafeKey(key);
      const v = files.get(key);
      return v ? new Uint8Array(v) : null;
    },
    async delete(key) {
      assertSafeKey(key);
      files.delete(key);
    },
    size: () => files.size,
    keys: () => [...files.keys()],
  };
}

/** ローカルの既定の保管場所。IMAGE_STORAGE_DIR で変えられる */
export const defaultImageDir = (env: NodeJS.ProcessEnv = process.env) =>
  env.IMAGE_STORAGE_DIR || path.join(process.cwd(), '.data', 'images');
