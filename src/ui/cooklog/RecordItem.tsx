'use client';
import { useState } from 'react';
import { dayText, IMPRESSION_LABEL, IMPRESSION_MARK, type RecordDto } from './types';

interface Props {
  record: RecordDto;
  /** 作った日を行に出すか（日の一覧では出さない） */
  showDate?: boolean;
  /** 料理名を行に出すか（項目の詳細では出さない） */
  showDish?: boolean;
  onEdit: (record: RecordDto) => void;
  onDelete: (record: RecordDto) => Promise<void>;
}

/** 記録 1 行：感想、メモ、記録した人、編集と削除（確認のあとだけ消す。BR40.9） */
export function RecordItem({ record, showDate = true, showDish = true, onEdit, onDelete }: Props) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const remove = async () => {
    setError(null);
    try {
      await onDelete(record);
    } catch {
      setError('削除できませんでした。もう一度お試しください');
    }
  };

  return (
    <li className="card record-item" data-testid="record-row">
      <p className="record-head">
        {showDate && <strong data-testid="record-date-text">{dayText(record.cookedOn)}</strong>}
        {showDish && (
          <span data-testid="record-dish-name">
            {' '}
            {record.dishName}
            {record.dishDeleted ? '（削除済み）' : ''}
          </span>
        )}
      </p>
      <p className="hint">
        {record.impression ? (
          <span data-testid="record-impression">
            <span aria-hidden="true">{IMPRESSION_MARK[record.impression]} </span>
            {IMPRESSION_LABEL[record.impression]}
          </span>
        ) : (
          <span data-testid="record-impression">感想なし</span>
        )}
        {' ・ '}
        {record.memberLabel}
      </p>
      {record.cautionMemo && (
        <p
          data-testid="record-memo-text"
          style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}
        >
          {record.cautionMemo}
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {confirming ? (
        <div role="alertdialog" aria-label="削除の確認" data-testid="record-delete-confirm-box">
          <p>この記録を削除しますか？ 同じ料理の他の記録は残ります。</p>
          <div className="row">
            <button
              type="button"
              className="btn grow"
              data-testid="record-delete-cancel"
              onClick={() => setConfirming(false)}
            >
              やめる
            </button>
            <button
              type="button"
              className="btn danger grow"
              data-testid="record-delete-confirm"
              onClick={remove}
            >
              削除する
            </button>
          </div>
        </div>
      ) : (
        <div className="row">
          <button
            type="button"
            className="btn small grow"
            data-testid="record-edit"
            onClick={() => onEdit(record)}
          >
            編集する
          </button>
          <button
            type="button"
            className="btn small danger grow"
            data-testid="record-delete"
            onClick={() => setConfirming(true)}
          >
            削除する
          </button>
        </div>
      )}
    </li>
  );
}
