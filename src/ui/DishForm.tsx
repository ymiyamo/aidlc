'use client';

import { useState, type FormEvent } from 'react';
import { ApiError } from './api-client';
import { COOK_TIME_LABEL, EFFORT_LABEL, type DishDto, type IngredientDto } from './types';

export interface DishFormValues {
  name: string;
  url: string;
  cookTime: string | null;
  effort: string | null;
  moodTags: string[];
  ingredients: IngredientDto[];
  memo: string | null;
}

/** 「材料名 分量 単位」を 1 行に 1 つ書く形を、材料の配列にする */
export function parseIngredientLines(text: string): IngredientDto[] {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const [name, amount, unit] = line.split(/[\s、,，]+/);
      return { name, amount: amount ?? null, unit: unit ?? null };
    });
}

export const formatIngredientLines = (items: IngredientDto[]) =>
  items.map((i) => [i.name, i.amount, i.unit].filter(Boolean).join(' ')).join('\n');

const parseTags = (text: string) => [
  ...new Set(
    text
      .split(/[\s、,，]+/)
      .map((t) => t.trim())
      .filter(Boolean),
  ),
];

/** 保存の画面。1 画面で完結し、URL と料理名だけで保存できる（BR3.13） */
export function DishForm({
  initial,
  initialUrl = '',
  submitLabel = '保存する',
  onSubmit,
  onCancel,
}: {
  initial?: DishDto;
  initialUrl?: string;
  submitLabel?: string;
  onSubmit: (values: DishFormValues, opts: { confirmDuplicate: boolean }) => Promise<void>;
  onCancel?: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [url, setUrl] = useState(initial?.url ?? initialUrl);
  const [cookTime, setCookTime] = useState(initial?.cookTime ?? '');
  const [effort, setEffort] = useState(initial?.effort ?? '');
  const [tags, setTags] = useState((initial?.moodTags ?? []).join(' '));
  const [ingredients, setIngredients] = useState(formatIngredientLines(initial?.ingredients ?? []));
  const [memo, setMemo] = useState(initial?.memo ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [duplicate, setDuplicate] = useState<{ name: string } | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const values = (): DishFormValues => ({
    name: name.trim(),
    url: url.trim(),
    cookTime: cookTime || null,
    effort: effort || null,
    moodTags: parseTags(tags),
    ingredients: parseIngredientLines(ingredients),
    memo: memo.trim() || null,
  });

  const submit = async (confirmDuplicate: boolean) => {
    const v = values();
    const local: Record<string, string> = {};
    if (!v.name) local.name = '料理名を入力してください';
    else if (v.name.length > 100) local.name = '料理名は100文字までです';
    if (!/^https?:\/\/\S+$/.test(v.url)) {
      local.url = 'URLの形式が正しくありません（http:// か https:// で始めてください）';
    }
    setErrors(local);
    setFormError(null);
    if (Object.keys(local).length > 0) return;
    setSaving(true);
    try {
      await onSubmit(v, { confirmDuplicate });
    } catch (err) {
      if (err instanceof ApiError && err.code === 'duplicate_url') {
        setDuplicate({ name: (err.data.existing as { name: string } | undefined)?.name ?? '' });
      } else if (err instanceof ApiError && err.code === 'validation') {
        setErrors(err.fields);
      } else {
        setFormError('保存できませんでした。もう一度お試しください');
      }
    } finally {
      setSaving(false);
    }
  };

  const onFormSubmit = (e: FormEvent) => {
    e.preventDefault();
    setDuplicate(null);
    void submit(false);
  };

  const fieldError = (key: string) =>
    errors[key] ? (
      <p className="error" role="alert" id={`err-${key}`} data-testid={`error-${key}`}>
        {errors[key]}
      </p>
    ) : null;
  const aria = (key: string) => ({
    'aria-invalid': errors[key] ? true : undefined,
    'aria-describedby': errors[key] ? `err-${key}` : undefined,
  });
  const tagError = Object.keys(errors).find((k) => k.startsWith('moodTags'));
  const ingredientError = Object.keys(errors).find((k) => k.startsWith('ingredients'));

  return (
    <form onSubmit={onFormSubmit} noValidate className="form" data-testid="dish-form">
      <label htmlFor="dish-url">URL（必須）</label>
      <input
        id="dish-url"
        data-testid="input-url"
        type="url"
        inputMode="url"
        autoComplete="off"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="https://"
        {...aria('url')}
      />
      {fieldError('url')}

      <label htmlFor="dish-name">料理名（必須）</label>
      <input
        id="dish-name"
        data-testid="input-name"
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        {...aria('name')}
      />
      {fieldError('name')}

      <details className="more">
        <summary>くわしい情報（あとからでも入れられます）</summary>

        <label htmlFor="dish-cooktime">調理時間</label>
        <select
          id="dish-cooktime"
          data-testid="input-cooktime"
          value={cookTime}
          onChange={(e) => setCookTime(e.target.value)}
        >
          <option value="">未入力</option>
          {Object.entries(COOK_TIME_LABEL).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>

        <label htmlFor="dish-effort">手間</label>
        <select
          id="dish-effort"
          data-testid="input-effort"
          value={effort}
          onChange={(e) => setEffort(e.target.value)}
        >
          <option value="">未入力</option>
          {Object.entries(EFFORT_LABEL).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>

        <label htmlFor="dish-tags">気分のタグ（空白かカンマ区切り、5個まで・1つ20文字まで）</label>
        <input
          id="dish-tags"
          data-testid="input-tags"
          type="text"
          value={tags}
          onChange={(e) => setTags(e.target.value)}
        />
        {tagError && fieldError(tagError)}

        <label htmlFor="dish-ingredients">材料（1行に1つ。例：玉ねぎ 1 個）</label>
        <textarea
          id="dish-ingredients"
          data-testid="input-ingredients"
          rows={4}
          value={ingredients}
          onChange={(e) => setIngredients(e.target.value)}
        />
        {ingredientError && fieldError(ingredientError)}

        <label htmlFor="dish-memo">メモ</label>
        <textarea
          id="dish-memo"
          data-testid="input-memo"
          rows={3}
          value={memo}
          onChange={(e) => setMemo(e.target.value)}
        />
        {fieldError('memo')}
      </details>

      {duplicate && (
        <div
          className="card notice"
          role="alertdialog"
          aria-label="同じURLがあります"
          data-testid="duplicate-notice"
        >
          <p>
            すでに保存済みです{duplicate.name ? `：「${duplicate.name}」` : ''}
            。それでも保存しますか？
          </p>
          <div className="row">
            <button
              type="button"
              className="btn"
              data-testid="duplicate-cancel"
              onClick={() => setDuplicate(null)}
            >
              やめる
            </button>
            <button
              type="button"
              className="btn primary"
              data-testid="duplicate-confirm"
              onClick={() => {
                setDuplicate(null);
                void submit(true);
              }}
            >
              それでも保存する
            </button>
          </div>
        </div>
      )}

      {formError && (
        <p className="error" role="alert" data-testid="form-error">
          {formError}
        </p>
      )}

      <div className="row">
        {onCancel && (
          <button type="button" className="btn" data-testid="cancel-button" onClick={onCancel}>
            キャンセル
          </button>
        )}
        <button
          type="submit"
          className="btn primary grow"
          data-testid="submit-button"
          disabled={saving}
        >
          {saving ? '保存中…' : submitLabel}
        </button>
      </div>
    </form>
  );
}
