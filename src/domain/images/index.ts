import type { AppDeps } from '@/domain/deps';
import type { HouseholdContext } from '@/domain/dish';
import { DomainError, notFound } from '@/domain/errors';
import { newStorageKey } from '@/lib/storage';
import { getDish, type Dish } from '@/repo/dishes';
import {
  bumpAttempt,
  countGenerated,
  deleteImagesOfDish,
  deleteImagesOfHousehold,
  deleteRegistered,
  getGenerated,
  getRegistered,
  insertGeneratedPending,
  markFailed,
  markReady,
  restartGenerated,
  upsertRegistered,
  type ImageType,
} from '@/repo/images';
import { CONTENT_TYPE_HEADER, MAX_IMAGE_BYTES, detectImageType } from './sniff';
import { imageServices } from './services';

export { MAX_IMAGE_BYTES, detectImageType } from './sniff';
export { dummyImageGenerator, renderDummyPng, type ImageGeneratorPort } from './dummy';
export { hueOf } from './hue';
export {
  type ImageServicesOverride,
  DEFAULT_IMAGE_CONFIG,
  createFileSeedSource,
  imageServices,
  setImageServices,
  type ImageConfig,
  type ImageServices,
  type SeedImageSource,
} from './services';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const NOT_IMAGE_MESSAGE = '画像ではありません。JPEG、PNG、WebP、GIF の画像を選んでください';
export const TOO_LARGE_MESSAGE = '5MB を超えています。5MB 以下の画像を選んでください';

/** 画面に返す、料理の画像の状態（保存しない。entities.md の DishImage） */
export interface DishImageView {
  source: 'registered' | 'generated' | 'none';
  status: 'ready' | 'pending' | 'failed';
  /** 画像の実体を取る場所。ready のときだけ。取るたびにグループを確認する（BR60.6） */
  url: string | null;
  /** 「AI が作ったイメージ」の印を出すか（BR60.10） */
  isAiGenerated: boolean;
  altText: string;
}

export interface ImageFile {
  bytes: Uint8Array;
  contentType: ImageType;
  mime: string;
}

const fileUrl = (dishId: string, version: string) =>
  `/api/dishes/${dishId}/image/file?v=${encodeURIComponent(version)}`;

/** BR60.14：代わりの文字。生成画像は「AI が作ったイメージ」と分かるようにする */
const altOf = (name: string, aiGenerated: boolean) =>
  aiGenerated ? `${name}のイメージ（AI が作ったイメージ）` : name;

// ---- 裏の処理の管理 ----

const jobs = new WeakMap<AppDeps, Set<Promise<void>>>();

function kick(deps: AppDeps, work: () => Promise<void>): void {
  const set = jobs.get(deps) ?? new Set<Promise<void>>();
  jobs.set(deps, set);
  // 裏の失敗は、画面の応答にも料理の保存にも影響させない（BR60.7）
  const p: Promise<void> = work()
    .catch((err) => deps.logger.error('image_generation_job_failed', { error: err }))
    .finally(() => {
      set.delete(p);
    });
  set.add(p);
}

/** 裏で動いている生成が終わるまで待つ（テスト用） */
export async function flushImageJobs(deps: AppDeps): Promise<void> {
  const set = jobs.get(deps);
  while (set && set.size > 0) await Promise.allSettled([...set]);
}

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('image_generation_timeout')), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

const promptOf = (dish: Dish) => {
  const names = dish.ingredients.slice(0, 5).map((i) => i.name);
  return names.length > 0 ? `${dish.name}（材料: ${names.join('、')}）` : dish.name;
};

/** BR60.7、BR60.11：生成を行う。失敗は再試行し、上限に達したら failed にする */
async function runGeneration(
  deps: AppDeps,
  householdId: string,
  generatedImageId: string,
  prompt: string,
): Promise<void> {
  const { generator, storage, config, sleep } = imageServices(deps);
  for (;;) {
    const attempt = await bumpAttempt(deps.db, householdId, generatedImageId);
    if (attempt === null) {
      // 回数の上限、または料理の削除・作り直しで対象でなくなった（pending のままなら failed にする）
      await markFailed(deps.db, householdId, generatedImageId, deps.now());
      return;
    }
    try {
      const out = await withTimeout(
        generator.generate({ prompt, width: 256, height: 256 }),
        config.timeoutMs,
      );
      const type = detectImageType(out.bytes);
      if (!type || out.bytes.length > MAX_IMAGE_BYTES) throw new Error('generated_image_invalid');
      const key = newStorageKey('generated');
      await storage.put(key, out.bytes);
      const ok = await markReady(deps.db, householdId, generatedImageId, {
        storageKey: key,
        contentType: type,
        now: deps.now(),
      });
      // 料理の削除などで対象が消えていたら、置いた実体も消す
      if (!ok) await storage.delete(key).catch(() => undefined);
      return;
    } catch (err) {
      deps.logger.warn('image_generation_attempt_failed', { attempt, error: err });
      if (attempt >= config.maxAttempts) {
        await markFailed(deps.db, householdId, generatedImageId, deps.now());
        // 運用者が分かる形で記録する。利用者には見せない（BR60.11）
        deps.logger.error('image_generation_failed', { generatedImageId, attempts: attempt });
        return;
      }
      await sleep(config.retryDelayMs * attempt);
    }
  }
}

/**
 * 生成画像の作成を要求する（C2 ImageRequest.requestGeneration 相当）。すぐ返し、生成は裏で行う（BR60.7）。
 * 登録画像がある、または記録がすでにある（期限内の pending、ready）なら何もしない（冪等）。
 * 期限切れの pending は作り直す。explicit のとき（利用者の再要求）は failed も作り直す
 */
async function ensureGeneration(
  deps: AppDeps,
  householdId: string,
  dish: Dish,
  explicit: boolean,
): Promise<'accepted' | 'noop'> {
  if (await getRegistered(deps.db, householdId, dish.dishId)) return 'noop';
  const { config } = imageServices(deps);
  const now = deps.now();
  const prompt = promptOf(dish);

  const created = await insertGeneratedPending(deps.db, householdId, {
    generatedImageId: deps.newId(),
    dishId: dish.dishId,
    now,
  });
  let row = created ? await getGenerated(deps.db, householdId, dish.dishId) : null;
  if (!created) {
    row = await restartGenerated(deps.db, householdId, dish.dishId, {
      now,
      expiredBefore: new Date(now.getTime() - config.pendingTtlMs),
      includeFailed: explicit,
    });
    if (!row) return 'noop';
  }
  if (!row) return 'noop';

  // 費用・回数の上限（BR60.11）。超えたら生成せず failed にして記録する
  if (
    config.maxGeneratedPerHousehold !== null &&
    (await countGenerated(deps.db, householdId)) > config.maxGeneratedPerHousehold
  ) {
    await markFailed(deps.db, householdId, row.generatedImageId, now);
    deps.logger.error('image_generation_limit_reached', { householdId });
    return 'accepted';
  }
  const id = row.generatedImageId;
  kick(deps, () => runGeneration(deps, householdId, id, prompt));
  return 'accepted';
}

// ---- 見せる ----

async function loadDish(deps: AppDeps, ctx: HouseholdContext, dishId: string): Promise<Dish> {
  // 他のグループ・削除済み・形の違う ID は、存在しないものとして扱う（BR60.6）
  if (!UUID.test(dishId)) throw notFound();
  const dish = await getDish(deps.db, ctx.householdId, dishId);
  if (!dish) throw notFound();
  return dish;
}

async function viewOf(deps: AppDeps, householdId: string, dish: Dish): Promise<DishImageView> {
  const none = (status: 'pending' | 'failed'): DishImageView => ({
    source: 'none',
    status,
    url: null,
    isAiGenerated: false,
    altText: altOf(dish.name, false),
  });

  // BR60.3：登録画像を優先。生成画像と印は返さない
  const registered = await getRegistered(deps.db, householdId, dish.dishId);
  if (registered) {
    return {
      source: 'registered',
      status: 'ready',
      url: fileUrl(dish.dishId, registered.imageId),
      isAiGenerated: false,
      altText: altOf(dish.name, false),
    };
  }

  // BR60.9：初期データの料理は素材を共有して見せる（生成を要求しない）
  if (dish.source === 'seed' && dish.seedKey) {
    const seed = await imageServices(deps).seeds.get(dish.seedKey, dish.name);
    if (!seed) {
      deps.logger.error('seed_image_invalid', { seedKey: dish.seedKey });
      return none('failed');
    }
    return {
      source: 'generated',
      status: 'ready',
      url: fileUrl(dish.dishId, `seed-${dish.seedKey}`),
      isAiGenerated: true,
      altText: altOf(dish.name, true),
    };
  }

  // BR60.4、BR60.8
  const gen = await getGenerated(deps.db, householdId, dish.dishId);
  if (gen?.status === 'ready') {
    return {
      source: 'generated',
      status: 'ready',
      url: fileUrl(dish.dishId, gen.generatedImageId),
      isAiGenerated: true,
      altText: altOf(dish.name, true),
    };
  }
  if (gen?.status === 'failed') return none('failed');
  // 記録がない、または期限切れの pending：作成を（再）要求して、作成中として返す
  await ensureGeneration(deps, householdId, dish, false);
  return none('pending');
}

/** BR60.3〜BR60.10：料理の画像の状態を返す。householdId は呼び出し側が決めたものだけを使う */
export async function getDishImage(
  deps: AppDeps,
  ctx: HouseholdContext,
  dishId: string,
): Promise<DishImageView> {
  const dish = await loadDish(deps, ctx, dishId);
  return viewOf(deps, ctx.householdId, dish);
}

/** 利用者が AI の画像を要求する。登録画像があるとき、初期データの料理のときは何もしない */
export async function requestDishImage(
  deps: AppDeps,
  ctx: HouseholdContext,
  dishId: string,
): Promise<DishImageView> {
  const dish = await loadDish(deps, ctx, dishId);
  if (dish.source !== 'seed') await ensureGeneration(deps, ctx.householdId, dish, true);
  return viewOf(deps, ctx.householdId, dish);
}

/** 画像の実体を返す。取るたびにグループを確認する（URL を知っていても他グループは取れない。BR60.6） */
export async function readDishImageFile(
  deps: AppDeps,
  ctx: HouseholdContext,
  dishId: string,
): Promise<ImageFile> {
  const dish = await loadDish(deps, ctx, dishId);
  const { storage, seeds } = imageServices(deps);
  const out = (bytes: Uint8Array, contentType: ImageType): ImageFile => ({
    bytes,
    contentType,
    mime: CONTENT_TYPE_HEADER[contentType],
  });

  const registered = await getRegistered(deps.db, ctx.householdId, dish.dishId);
  if (registered) {
    const bytes = await storage.get(registered.storageKey);
    if (!bytes) {
      deps.logger.error('image_object_missing', { kind: 'registered' });
      throw notFound();
    }
    return out(bytes, registered.contentType);
  }
  if (dish.source === 'seed' && dish.seedKey) {
    const seed = await seeds.get(dish.seedKey, dish.name);
    if (!seed) throw notFound();
    return out(seed.bytes, seed.contentType);
  }
  const gen = await getGenerated(deps.db, ctx.householdId, dish.dishId);
  if (gen?.status === 'ready' && gen.storageKey && gen.contentType) {
    const bytes = await storage.get(gen.storageKey);
    if (!bytes) {
      deps.logger.error('image_object_missing', { kind: 'generated' });
      throw notFound();
    }
    return out(bytes, gen.contentType);
  }
  throw notFound();
}

// ---- 登録・外す ----

const rejected = (code: 'IMAGE_NOT_SUPPORTED' | 'IMAGE_TOO_LARGE', message: string) =>
  new DomainError('validation', '入力エラー', { image: message }, { code });

/** base64 の文字列から、復元したときの大きさ（バイト）を数える。復元せずに大きさを確かめるために使う */
const decodedLength = (b64: string) => {
  const pad = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
  return Math.floor((b64.length * 3) / 4) - pad;
};

/**
 * BR60.1、BR60.2、BR60.5：画像を登録する（置き換えを含む）。
 * 入力は { data: base64 }。形式は中身の先頭バイトで判定し、大きさは受け取った中身で数える。
 * 拒否したときは、すでにある登録画像を変えない
 */
export async function registerImage(
  deps: AppDeps,
  ctx: HouseholdContext,
  dishId: string,
  raw: unknown,
): Promise<DishImageView> {
  const dish = await loadDish(deps, ctx, dishId);
  const data = raw && typeof raw === 'object' ? (raw as Record<string, unknown>).data : undefined;
  if (typeof data !== 'string' || data.length === 0) {
    throw rejected('IMAGE_NOT_SUPPORTED', NOT_IMAGE_MESSAGE);
  }
  // 大きすぎるものは、復元する前に断る（メモリを使わない）
  if (decodedLength(data) > MAX_IMAGE_BYTES) {
    throw rejected('IMAGE_TOO_LARGE', TOO_LARGE_MESSAGE);
  }
  const bytes = new Uint8Array(Buffer.from(data, 'base64'));
  const contentType = detectImageType(bytes);
  if (!contentType) throw rejected('IMAGE_NOT_SUPPORTED', NOT_IMAGE_MESSAGE);
  if (bytes.length > MAX_IMAGE_BYTES) throw rejected('IMAGE_TOO_LARGE', TOO_LARGE_MESSAGE);

  const { storage } = imageServices(deps);
  const storageKey = newStorageKey('registered');
  await storage.put(storageKey, bytes);
  let replaced: string | null;
  try {
    ({ replacedStorageKey: replaced } = await deps.db.transaction((tx) =>
      upsertRegistered(tx, ctx.householdId, {
        imageId: deps.newId(),
        dishId: dish.dishId,
        contentType,
        byteSize: bytes.length,
        storageKey,
        uploadedBy: ctx.memberId,
        now: deps.now(),
      }),
    ));
  } catch (err) {
    await storage.delete(storageKey).catch(() => undefined);
    throw err;
  }
  if (replaced) await deleteObject(deps, replaced);
  return viewOf(deps, ctx.householdId, dish);
}

/** BR60.5：登録画像を外す。繰り返しても同じ結果。外すと生成画像の表示に戻る */
export async function removeImage(
  deps: AppDeps,
  ctx: HouseholdContext,
  dishId: string,
): Promise<DishImageView> {
  const dish = await loadDish(deps, ctx, dishId);
  const key = await deleteRegistered(deps.db, ctx.householdId, dish.dishId);
  if (key) await deleteObject(deps, key);
  return viewOf(deps, ctx.householdId, dish);
}

// ---- 削除の連動（BR60.12） ----

/** 実体の削除に失敗しても、記録の削除は済んでいる。残った実体は運用者が分かる形で記録する */
async function deleteObject(deps: AppDeps, key: string): Promise<void> {
  try {
    await imageServices(deps).storage.delete(key);
  } catch (err) {
    deps.logger.error('image_object_delete_failed', { error: err });
  }
}

/**
 * 料理が削除されたとき（C2 ImageRequest.deleteForDish 相当）、その料理の画像を消す。
 * 何度呼んでも結果は同じ。初期データの素材は共有なので消さない
 */
export async function deleteImagesForDish(
  deps: AppDeps,
  householdId: string,
  dishId: string,
): Promise<void> {
  const keys = await deleteImagesOfDish(deps.db, householdId, dishId);
  for (const k of keys) await deleteObject(deps, k);
}

/** グループが削除されたとき、そのグループの画像をすべて消す。何度受けても結果は同じ */
export async function deleteImagesForHousehold(deps: AppDeps, householdId: string): Promise<void> {
  const keys = await deleteImagesOfHousehold(deps.db, householdId);
  for (const k of keys) await deleteObject(deps, k);
}

const registeredHandlers = new WeakSet<AppDeps>();

/** 出来事の受け口を登録する（何度呼んでも 1 回だけ）。household.deleted で画像を消す（BR60.12、ADR-007） */
export function ensureImageHandlers(deps: AppDeps): void {
  if (registeredHandlers.has(deps)) return;
  registeredHandlers.add(deps);
  deps.events.subscribe('household.deleted', async ({ householdId }) => {
    await deleteImagesForHousehold(deps, householdId);
  });
}
