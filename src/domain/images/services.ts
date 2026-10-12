import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { AppDeps } from '@/domain/deps';
import { createDiskStorage, defaultImageDir, type ObjectStorage } from '@/lib/storage';
import type { ImageType } from '@/repo/images';
import { dummyImageGenerator, renderDummyPng, type ImageGeneratorPort } from './dummy';
import { detectImageType, MAX_IMAGE_BYTES } from './sniff';

/** 生成の上限など（BR60.11）。値は未決定（OQ7）なので外に出してある */
export interface ImageConfig {
  /** 最初の 1 回 + 再試行 3 回 */
  maxAttempts: number;
  /** 1 回の生成を待つ上限（ミリ秒） */
  timeoutMs: number;
  /** 再試行の前に待つ時間（ミリ秒）。回数に比例して延ばす */
  retryDelayMs: number;
  /** pending をこの時間で失敗扱いにする（BR60.7）。10 分 */
  pendingTtlMs: number;
  /** 1 グループが持てる生成画像の数の上限。null なら無制限（費用・回数の上限） */
  maxGeneratedPerHousehold: number | null;
}

export const DEFAULT_IMAGE_CONFIG: ImageConfig = {
  maxAttempts: 4,
  timeoutMs: 30_000,
  retryDelayMs: 500,
  pendingTtlMs: 10 * 60 * 1000,
  maxGeneratedPerHousehold: null,
};

/** 初期データの画像素材（読み取り専用。全グループで共有する。BR60.9） */
export interface SeedImageSource {
  /** 素材が見つからない、または形式・大きさが範囲外なら null */
  get(
    seedKey: string,
    dishName: string,
  ): Promise<{ bytes: Uint8Array; contentType: ImageType } | null>;
}

export interface ImageServices {
  storage: ObjectStorage;
  generator: ImageGeneratorPort;
  seeds: SeedImageSource;
  config: ImageConfig;
  /** 再試行の待ち（テストで差し替える） */
  sleep(ms: number): Promise<void>;
}

const SEED_KEY_RE = /^[a-z0-9][a-z0-9_-]{0,99}$/i;
const SEED_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'gif'];

/**
 * 既定の素材の置き場：data/seed-images/<seedKey>.<拡張子>（SEED_IMAGE_DIR で変えられる）。
 * 素材を差し替えるだけで、プログラムを変えずに反映される（AC9.1.8）。
 * 通し版では素材ファイルを置かなくてよい：置いていない seedKey は、ローカルで作る固定の絵（ダミー）で代える。
 * 置いてあるのに画像でない・5MB 超のものは null（その料理だけ色の枠にする）
 */
export function createFileSeedSource(
  dir: string = process.env.SEED_IMAGE_DIR || path.join(process.cwd(), 'data', 'seed-images'),
): SeedImageSource {
  return {
    async get(seedKey, dishName) {
      if (!SEED_KEY_RE.test(seedKey)) return null;
      for (const ext of SEED_EXTENSIONS) {
        let bytes: Uint8Array;
        try {
          bytes = new Uint8Array(await readFile(path.join(dir, `${seedKey}.${ext}`)));
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code === 'ENOENT') continue;
          return null;
        }
        const contentType = detectImageType(bytes);
        if (!contentType || bytes.length > MAX_IMAGE_BYTES) return null;
        return { bytes, contentType };
      }
      return { bytes: renderDummyPng(dishName), contentType: 'png' };
    },
  };
}

const overrides = new WeakMap<AppDeps, ImageServicesOverride>();
const resolved = new WeakMap<AppDeps, ImageServices>();
let defaultStorage: ObjectStorage | null = null;

/** この deps の画像まわりの部品を差し替える（テストや、サービスが決まったときの差し替え用） */
export type ImageServicesOverride = Partial<Omit<ImageServices, 'config'>> & {
  /** 一部の値だけ差し替えられる。undefined を渡すと既定に戻る */
  config?: Partial<ImageConfig>;
};

export function setImageServices(deps: AppDeps, over: ImageServicesOverride): void {
  overrides.set(deps, { ...overrides.get(deps), ...over });
  resolved.delete(deps);
}

export function imageServices(deps: AppDeps): ImageServices {
  const cached = resolved.get(deps);
  if (cached) return cached;
  const o = overrides.get(deps) ?? {};
  defaultStorage ??= createDiskStorage(defaultImageDir());
  const services: ImageServices = {
    storage: o.storage ?? defaultStorage,
    generator: o.generator ?? dummyImageGenerator,
    seeds: o.seeds ?? createFileSeedSource(),
    config: { ...DEFAULT_IMAGE_CONFIG, ...o.config },
    sleep: o.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))),
  };
  resolved.set(deps, services);
  return services;
}
