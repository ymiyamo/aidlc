'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { api, ApiError } from '../api-client';

interface Overview {
  householdName: string;
  activeMemberCount: number;
}

const errorText = (err: unknown) =>
  err instanceof ApiError ? err.message : 'エラーが発生しました。もう一度お試しください';

/** 招待リンクの発行と表示（BR50.9）。リンクは発行した直後のこの画面にだけ出る */
function InviteSection() {
  const [link, setLink] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);

  const issue = async () => {
    setError(null);
    setCopied(false);
    setBusy(true);
    try {
      const r = await api<{ path: string; expiresAt: string }>('POST', '/api/invitations');
      setLink(`${window.location.origin}${r.path}`);
      setExpiresAt(r.expiresAt);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link ?? '');
      setCopied(true);
    } catch {
      setCopied(false); // コピーできないときは、欄の文字を選んでコピーしてもらう
    }
  };

  return (
    <section className="card" aria-labelledby="invite-heading" data-testid="invite-section">
      <h2 id="invite-heading">家族を招待する</h2>
      <p>招待リンクを作って、家族に送ってください。7 日間、1 回だけ使えます。</p>
      <button
        type="button"
        className="btn primary block"
        data-testid="invite-issue"
        onClick={issue}
        disabled={busy}
      >
        招待リンクを作る
      </button>
      {error && (
        <p className="error" role="alert" data-testid="invite-error">
          {error}
        </p>
      )}
      {link && (
        <div data-testid="invite-result">
          <label htmlFor="invite-link">
            招待リンク（この画面を閉じると、もう一度は表示できません）
          </label>
          <input
            id="invite-link"
            data-testid="invite-link"
            type="text"
            readOnly
            value={link}
            onFocus={(e) => e.currentTarget.select()}
          />
          <button type="button" className="btn block" data-testid="invite-copy" onClick={copy}>
            コピーする
          </button>
          {copied && (
            <p role="status" data-testid="invite-copied">
              コピーしました
            </p>
          )}
          {expiresAt && <p className="hint">期限：{new Date(expiresAt).toLocaleString('ja-JP')}</p>}
        </div>
      )}
    </section>
  );
}

/** グループから抜ける（BR50.16、BR50.19）。最後の 1 人のときは、データがすべて消えることを示して、もう一度確認する */
function LeaveSection({ overview }: { overview: Overview | null }) {
  const router = useRouter();
  const [step, setStep] = useState<'idle' | 'confirm' | 'last'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const isLast = overview?.activeMemberCount === 1;

  const leave = async (confirmLast: boolean) => {
    setError(null);
    setBusy(true);
    try {
      await api('POST', '/api/household/leave', {
        confirm: true,
        ...(confirmLast ? { confirmLast } : {}),
      });
      router.replace('/household/new');
    } catch (err) {
      if (err instanceof ApiError && err.data.needsLastConfirm === true) setStep('last');
      else setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card" aria-labelledby="leave-heading" data-testid="leave-section">
      <h2 id="leave-heading">グループから抜ける</h2>
      <p>
        抜けても、あなたが保存した料理と記録はグループに残ります（「退会したメンバー」と表示されます）。
      </p>
      {step === 'idle' && (
        <button
          type="button"
          className="btn block"
          data-testid="leave-start"
          onClick={() => setStep('confirm')}
        >
          グループから抜ける
        </button>
      )}
      {step === 'confirm' && (
        <div role="group" aria-label="抜ける前の確認" data-testid="leave-confirm-box">
          <p>本当にグループから抜けますか？</p>
          {isLast && (
            <p className="error" data-testid="leave-last-hint">
              あなたが最後のメンバーです。抜けると、グループのデータがすべて削除されます。
            </p>
          )}
          <div className="row">
            <button
              type="button"
              className="btn"
              data-testid="leave-cancel"
              onClick={() => setStep('idle')}
            >
              やめる
            </button>
            <button
              type="button"
              className="btn primary"
              data-testid="leave-confirm"
              onClick={() => leave(false)}
              disabled={busy}
            >
              抜ける
            </button>
          </div>
        </div>
      )}
      {step === 'last' && (
        <div role="alertdialog" aria-label="最後のメンバーの確認" data-testid="leave-last-box">
          <p className="error">
            あなたが最後のメンバーです。抜けると、グループの料理、記録、献立、買い物リストなどのデータがすべて削除されます。元に戻せません。
          </p>
          <div className="row">
            <button
              type="button"
              className="btn"
              data-testid="leave-last-cancel"
              onClick={() => setStep('idle')}
            >
              やめる
            </button>
            <button
              type="button"
              className="btn primary"
              data-testid="leave-last-confirm"
              onClick={() => leave(true)}
              disabled={busy}
            >
              すべて削除して抜ける
            </button>
          </div>
        </div>
      )}
      {error && (
        <p className="error" role="alert" data-testid="leave-error">
          {error}
        </p>
      )}
    </section>
  );
}

/** アカウント削除（BR50.19、BR50.20）。パスワードの再入力と、元に戻せないことの確認が要る */
function DeleteSection() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [understood, setUnderstood] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!understood) {
      setError('元に戻せないことを確認して、チェックを入れてください');
      return;
    }
    setBusy(true);
    try {
      await api('POST', '/api/account/delete', { confirm: true, password });
      router.replace('/login');
    } catch (err) {
      setError(err instanceof ApiError ? (err.fields.password ?? err.message) : errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card" aria-labelledby="delete-heading" data-testid="delete-section">
      <h2 id="delete-heading">アカウントを削除する</h2>
      <p>メールアドレスとパスワードが消え、ログインできなくなります。元に戻せません。</p>
      {!open ? (
        <button
          type="button"
          className="btn block"
          data-testid="delete-start"
          onClick={() => setOpen(true)}
        >
          アカウントを削除する
        </button>
      ) : (
        <form onSubmit={onSubmit} noValidate className="form" data-testid="delete-form">
          <label htmlFor="delete-password">パスワード（確認のため、もう一度入力）</label>
          <input
            id="delete-password"
            data-testid="delete-password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? 'delete-error' : undefined}
          />
          <label htmlFor="delete-understood">
            <input
              id="delete-understood"
              data-testid="delete-understood"
              type="checkbox"
              checked={understood}
              onChange={(e) => setUnderstood(e.target.checked)}
            />{' '}
            元に戻せないことを理解しました
          </label>
          {error && (
            <p className="error" role="alert" id="delete-error" data-testid="delete-error">
              {error}
            </p>
          )}
          <div className="row">
            <button
              type="button"
              className="btn"
              data-testid="delete-cancel"
              onClick={() => setOpen(false)}
            >
              やめる
            </button>
            <button
              type="submit"
              className="btn primary"
              data-testid="delete-confirm"
              disabled={busy}
            >
              削除する
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

/** 設定の画面の中身：招待、グループから抜ける、アカウント削除（外枠は呼び出し側） */
export function SettingsPanel() {
  const [overview, setOverview] = useState<Overview | null>(null);
  useEffect(() => {
    let cancelled = false;
    api<Overview>('GET', '/api/admin/overview')
      .then((o) => {
        if (!cancelled) setOverview(o);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <>
      {overview && (
        <p data-testid="settings-group">
          グループ：{overview.householdName}（メンバー {overview.activeMemberCount} 人）
        </p>
      )}
      <InviteSection />
      <LeaveSection overview={overview} />
      <DeleteSection />
    </>
  );
}
