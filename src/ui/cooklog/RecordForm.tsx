'use client';
import { useState, type FormEvent } from 'react';
import { ApiError } from '../api-client';
import { IMPRESSION_LABEL, type RecordFormValues } from './types';

// `.form input` は幅いっぱいなので、選択ボタンだけ元の大きさに戻す
const RADIO_STYLE = { width: 'auto', minHeight: 'auto' } as const;

interface Props {
  /** 見出しに出す料理名 */
  dishName: string;
  initial: RecordFormValues;
  /** 選べる最後の日（日本時間の今日。BR40.1） */
  maxDate: string;
  submitLabel: string;
  onSubmit: (values: RecordFormValues) => Promise<void>;
  onCancel: () => void;
  /** 同じ日の記録がすでにあるとき、その記録の編集へ進む（BR40.4） */
  onOpenExisting?: (recordId: string) => void;
}

/** 作った日・感想・メモの入力（追加と編集で共通。BR40.1〜BR40.3） */
export function RecordForm({
  dishName,
  initial,
  maxDate,
  submitLabel,
  onSubmit,
  onCancel,
  onOpenExisting,
}: Props) {
  const [values, setValues] = useState<RecordFormValues>(initial);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [existingId, setExistingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setFieldErrors({});
    setFormError(null);
    setExistingId(null);
    setBusy(true);
    try {
      await onSubmit(values);
    } catch (err) {
      // 入力は残したまま、理由を示す
      if (err instanceof ApiError) {
        if (err.code === 'DUPLICATE_RECORD') {
          setFormError(err.message);
          const id = err.data.existingRecordId;
          setExistingId(typeof id === 'string' ? id : null);
        } else if (Object.keys(err.fields).length > 0) {
          setFieldErrors(err.fields);
        } else {
          setFormError(err.message);
        }
      } else {
        setFormError('保存できませんでした。もう一度お試しください');
      }
    } finally {
      setBusy(false);
    }
  };

  const dateError = fieldErrors.cookedOn;
  const impressionError = fieldErrors.impression;
  const memoError = fieldErrors.cautionMemo;

  return (
    <form
      className="form card"
      onSubmit={submit}
      noValidate
      aria-label="作った記録の入力"
      data-testid="record-form"
    >
      <p data-testid="record-form-dish">
        <strong>{dishName}</strong>
      </p>

      <label htmlFor="record-date">作った日（今日まで）</label>
      <input
        id="record-date"
        data-testid="record-date"
        type="date"
        max={maxDate}
        value={values.cookedOn}
        onChange={(e) => setValues({ ...values, cookedOn: e.target.value })}
        aria-invalid={dateError ? true : undefined}
        aria-describedby={dateError ? 'record-date-error' : undefined}
      />
      {dateError && (
        <p className="error" role="alert" id="record-date-error" data-testid="record-date-error">
          {dateError}
        </p>
      )}

      <fieldset
        className="radios"
        aria-describedby={impressionError ? 'record-imp-error' : undefined}
      >
        <legend>感想（選ばなくてもよい）</legend>
        {(['again', 'never_again'] as const).map((value) => (
          <label key={value} htmlFor={`record-imp-${value}`}>
            <input
              id={`record-imp-${value}`}
              data-testid={`record-imp-${value}`}
              type="radio"
              style={RADIO_STYLE}
              name="record-impression"
              checked={values.impression === value}
              onChange={() => setValues({ ...values, impression: value })}
            />{' '}
            {IMPRESSION_LABEL[value]}
          </label>
        ))}
        <label htmlFor="record-imp-none">
          <input
            id="record-imp-none"
            data-testid="record-imp-none"
            type="radio"
            style={RADIO_STYLE}
            name="record-impression"
            checked={values.impression === ''}
            onChange={() => setValues({ ...values, impression: '' })}
          />{' '}
          感想なし
        </label>
      </fieldset>
      {impressionError && (
        <p className="error" role="alert" id="record-imp-error">
          {impressionError}
        </p>
      )}

      <label htmlFor="record-memo">料理中の注意点のメモ（1000文字まで）</label>
      <textarea
        id="record-memo"
        data-testid="record-memo"
        rows={3}
        value={values.cautionMemo}
        onChange={(e) => setValues({ ...values, cautionMemo: e.target.value })}
        aria-invalid={memoError ? true : undefined}
        aria-describedby={memoError ? 'record-memo-error' : undefined}
      />
      {memoError && (
        <p className="error" role="alert" id="record-memo-error">
          {memoError}
        </p>
      )}

      {formError && (
        <p className="error" role="alert" data-testid="record-form-error">
          {formError}
        </p>
      )}
      {existingId && onOpenExisting && (
        <button
          type="button"
          className="btn block"
          data-testid="record-open-existing"
          onClick={() => onOpenExisting(existingId)}
        >
          すでにある記録を編集する
        </button>
      )}

      <div className="row">
        <button type="button" className="btn grow" data-testid="record-cancel" onClick={onCancel}>
          やめる
        </button>
        <button
          type="submit"
          className="btn primary grow"
          data-testid="record-submit"
          disabled={busy}
        >
          {submitLabel}
        </button>
      </div>
    </form>
  );
}
