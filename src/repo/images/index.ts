import type { Queryable } from '@/db/types';

export type ImageType = 'jpeg' | 'png' | 'webp' | 'gif';
export type GeneratedStatus = 'pending' | 'ready' | 'failed';

export interface RegisteredImageRow {
  imageId: string;
  householdId: string;
  dishId: string;
  contentType: ImageType;
  byteSize: number;
  storageKey: string;
  uploadedBy: string | null;
  uploadedAt: Date;
}

export interface GeneratedImageRow {
  generatedImageId: string;
  householdId: string;
  dishId: string;
  status: GeneratedStatus;
  attemptCount: number;
  storageKey: string | null;
  contentType: ImageType | null;
  requestedAt: Date;
  completedAt: Date | null;
}

interface RawRegistered {
  image_id: string;
  household_id: string;
  dish_id: string;
  content_type: ImageType;
  byte_size: number;
  storage_key: string;
  uploaded_by: string | null;
  uploaded_at: Date;
}

interface RawGenerated {
  generated_image_id: string;
  household_id: string;
  dish_id: string;
  status: GeneratedStatus;
  attempt_count: number;
  storage_key: string | null;
  content_type: ImageType | null;
  requested_at: Date;
  completed_at: Date | null;
}

const toRegistered = (r: RawRegistered): RegisteredImageRow => ({
  imageId: r.image_id,
  householdId: r.household_id,
  dishId: r.dish_id,
  contentType: r.content_type,
  byteSize: r.byte_size,
  storageKey: r.storage_key,
  uploadedBy: r.uploaded_by,
  uploadedAt: r.uploaded_at,
});

const toGenerated = (r: RawGenerated): GeneratedImageRow => ({
  generatedImageId: r.generated_image_id,
  householdId: r.household_id,
  dishId: r.dish_id,
  status: r.status,
  attemptCount: r.attempt_count,
  storageKey: r.storage_key,
  contentType: r.content_type,
  requestedAt: r.requested_at,
  completedAt: r.completed_at,
});

const REGISTERED_COLUMNS =
  'image_id, household_id, dish_id, content_type, byte_size, storage_key, uploaded_by, uploaded_at';
const GENERATED_COLUMNS = `generated_image_id, household_id, dish_id, status, attempt_count,
  storage_key, content_type, requested_at, completed_at`;

// ---- 登録画像（すべての問い合わせは householdId を必須にする。ADR-005、BR60.6） ----

export async function getRegistered(
  q: Queryable,
  householdId: string,
  dishId: string,
): Promise<RegisteredImageRow | null> {
  const res = await q.query<RawRegistered>(
    `select ${REGISTERED_COLUMNS} from registered_images where household_id = $1 and dish_id = $2`,
    [householdId, dishId],
  );
  return res.rows[0] ? toRegistered(res.rows[0]) : null;
}

/**
 * 登録画像を置く。同じ料理にすでにあれば置き換え、古い保管の名前を返す（BR60.5）。
 * 取引（deps.db.transaction）の中で呼ぶこと。同時に 2 件来ても、有効なのは 1 件（一意制約）
 */
export async function upsertRegistered(
  q: Queryable,
  householdId: string,
  r: {
    imageId: string;
    dishId: string;
    contentType: ImageType;
    byteSize: number;
    storageKey: string;
    uploadedBy: string | null;
    now: Date;
  },
): Promise<{ replacedStorageKey: string | null }> {
  const old = await q.query<{ storage_key: string }>(
    'select storage_key from registered_images where household_id = $1 and dish_id = $2 for update',
    [householdId, r.dishId],
  );
  await q.query(
    `insert into registered_images (image_id, household_id, dish_id, content_type, byte_size,
                                    storage_key, uploaded_by, uploaded_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8)
     on conflict (dish_id) do update
       set image_id = excluded.image_id, content_type = excluded.content_type,
           byte_size = excluded.byte_size, storage_key = excluded.storage_key,
           uploaded_by = excluded.uploaded_by, uploaded_at = excluded.uploaded_at
       where registered_images.household_id = excluded.household_id`,
    [
      r.imageId,
      householdId,
      r.dishId,
      r.contentType,
      r.byteSize,
      r.storageKey,
      r.uploadedBy,
      r.now,
    ],
  );
  return { replacedStorageKey: old.rows[0]?.storage_key ?? null };
}

/** 消して、消した保管の名前を返す。無ければ null（外す操作を繰り返しても同じ結果。BR60.5） */
export async function deleteRegistered(
  q: Queryable,
  householdId: string,
  dishId: string,
): Promise<string | null> {
  const res = await q.query<{ storage_key: string }>(
    `delete from registered_images where household_id = $1 and dish_id = $2 returning storage_key`,
    [householdId, dishId],
  );
  return res.rows[0]?.storage_key ?? null;
}

// ---- 生成画像 ----

export async function getGenerated(
  q: Queryable,
  householdId: string,
  dishId: string,
): Promise<GeneratedImageRow | null> {
  const res = await q.query<RawGenerated>(
    `select ${GENERATED_COLUMNS} from generated_images where household_id = $1 and dish_id = $2`,
    [householdId, dishId],
  );
  return res.rows[0] ? toGenerated(res.rows[0]) : null;
}

/** pending を作る。同じ料理にすでにあれば作らず false（冪等。BR60.7） */
export async function insertGeneratedPending(
  q: Queryable,
  householdId: string,
  g: { generatedImageId: string; dishId: string; now: Date },
): Promise<boolean> {
  const res = await q.query(
    `insert into generated_images (generated_image_id, household_id, dish_id, status,
                                   attempt_count, requested_at)
     values ($1, $2, $3, 'pending', 0, $4)
     on conflict (dish_id) do nothing`,
    [g.generatedImageId, householdId, g.dishId, g.now],
  );
  return res.rowCount === 1;
}

/**
 * 期限切れの pending、または failed を、pending から作り直す（BR60.7）。
 * 取り直せたら古い保管の名前（あれば）を含めて返す。すでに pending で期限内、または ready なら null
 */
export async function restartGenerated(
  q: Queryable,
  householdId: string,
  dishId: string,
  opts: { now: Date; expiredBefore: Date; includeFailed: boolean },
): Promise<GeneratedImageRow | null> {
  const res = await q.query<RawGenerated>(
    `update generated_images
        set status = 'pending', attempt_count = 0, storage_key = null, content_type = null,
            requested_at = $3, completed_at = null
      where household_id = $1 and dish_id = $2
        and ((status = 'pending' and requested_at <= $4) or ($5::boolean and status = 'failed'))
      returning ${GENERATED_COLUMNS}`,
    [householdId, dishId, opts.now, opts.expiredBefore, opts.includeFailed],
  );
  return res.rows[0] ? toGenerated(res.rows[0]) : null;
}

/** 試行の回数を 1 つ増やす（pending のときだけ）。増やせたら新しい回数、できなければ null */
export async function bumpAttempt(
  q: Queryable,
  householdId: string,
  generatedImageId: string,
): Promise<number | null> {
  const res = await q.query<{ attempt_count: number }>(
    `update generated_images set attempt_count = attempt_count + 1
      where household_id = $1 and generated_image_id = $2 and status = 'pending' and attempt_count < 4
      returning attempt_count`,
    [householdId, generatedImageId],
  );
  return res.rows[0]?.attempt_count ?? null;
}

/** pending のものだけ ready にする。消えた・期限切れで作り直された後なら false */
export async function markReady(
  q: Queryable,
  householdId: string,
  generatedImageId: string,
  v: { storageKey: string; contentType: ImageType; now: Date },
): Promise<boolean> {
  const res = await q.query(
    `update generated_images
        set status = 'ready', storage_key = $3, content_type = $4, completed_at = $5
      where household_id = $1 and generated_image_id = $2 and status = 'pending'`,
    [householdId, generatedImageId, v.storageKey, v.contentType, v.now],
  );
  return res.rowCount === 1;
}

export async function markFailed(
  q: Queryable,
  householdId: string,
  generatedImageId: string,
  now: Date,
): Promise<boolean> {
  const res = await q.query(
    `update generated_images set status = 'failed', completed_at = $3
      where household_id = $1 and generated_image_id = $2 and status = 'pending'`,
    [householdId, generatedImageId, now],
  );
  return res.rowCount === 1;
}

/** そのグループで、これまでに作った（または作っている）生成画像の件数（費用・回数の上限に使う。BR60.11） */
export async function countGenerated(q: Queryable, householdId: string): Promise<number> {
  const res = await q.query<{ n: string | number }>(
    'select count(*) as n from generated_images where household_id = $1',
    [householdId],
  );
  return Number(res.rows[0].n);
}

// ---- 削除の連動（BR60.12） ----

/** その料理の登録画像と生成画像を消し、消した保管の名前を返す。何度呼んでも同じ（冪等） */
export async function deleteImagesOfDish(
  q: Queryable,
  householdId: string,
  dishId: string,
): Promise<string[]> {
  const keys: string[] = [];
  const reg = await q.query<{ storage_key: string }>(
    'delete from registered_images where household_id = $1 and dish_id = $2 returning storage_key',
    [householdId, dishId],
  );
  keys.push(...reg.rows.map((r) => r.storage_key));
  const gen = await q.query<{ storage_key: string | null }>(
    'delete from generated_images where household_id = $1 and dish_id = $2 returning storage_key',
    [householdId, dishId],
  );
  keys.push(...gen.rows.flatMap((r) => (r.storage_key ? [r.storage_key] : [])));
  return keys;
}

/** そのグループの画像をすべて消し、消した保管の名前を返す。何度呼んでも同じ（冪等） */
export async function deleteImagesOfHousehold(
  q: Queryable,
  householdId: string,
): Promise<string[]> {
  const reg = await q.query<{ storage_key: string }>(
    'delete from registered_images where household_id = $1 returning storage_key',
    [householdId],
  );
  const gen = await q.query<{ storage_key: string | null }>(
    'delete from generated_images where household_id = $1 returning storage_key',
    [householdId],
  );
  return [
    ...reg.rows.map((r) => r.storage_key),
    ...gen.rows.flatMap((r) => (r.storage_key ? [r.storage_key] : [])),
  ];
}
