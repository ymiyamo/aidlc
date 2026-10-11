'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { api, ApiError } from '../api-client';
import {
  clearPendingInvite,
  pendingInviteToken,
  savePendingInvite,
  stripTokenFromUrl,
} from './invite-storage';

type Preview =
  | { status: 'loading' }
  | { status: 'valid'; householdName: string }
  | { status: 'expired' }
  | { status: 'unusable' };

/**
 * 招待リンクを開いた人の画面（BR50.11〜BR50.13）。
 * 参加する前にグループ名を見せ、ログインは参加の操作のときに求める。表示名は参加の画面で入力する
 */
export function JoinPanel({ token: urlToken }: { token: string | null }) {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview>({ status: 'loading' });
  const [loggedIn, setLoggedIn] = useState<boolean | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // リンクの値は URL から受け取る。ログインを挟んで戻ったときは、このタブに覚えた値を使う
  useEffect(() => {
    const t = urlToken ?? pendingInviteToken();
    setToken(t);
    if (!t) setPreview({ status: 'unusable' });
  }, [urlToken]);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    api<Preview>('POST', '/api/invitations/preview', { token })
      .then((p) => {
        if (cancelled) return;
        setPreview(p);
        if (p.status !== 'valid') {
          clearPendingInvite();
          stripTokenFromUrl('/join');
        }
      })
      .catch(() => {
        if (!cancelled) setPreview({ status: 'unusable' });
      });
    api('GET', '/api/me')
      .then(() => {
        if (!cancelled) setLoggedIn(true);
      })
      .catch(() => {
        if (!cancelled) setLoggedIn(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const goLogin = () => {
    if (token) savePendingInvite(token);
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api('POST', '/api/invitations/join', { token, displayName });
      clearPendingInvite();
      stripTokenFromUrl('/join');
      router.replace('/');
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setLoggedIn(false);
      } else if (err instanceof ApiError && err.code === 'expired') {
        setPreview({ status: 'expired' });
        clearPendingInvite();
        stripTokenFromUrl('/join');
      } else if (err instanceof ApiError && err.status === 404) {
        setPreview({ status: 'unusable' });
        clearPendingInvite();
        stripTokenFromUrl('/join');
      } else {
        // 入力は残したまま、理由を出す（すでに別のグループにいる、など）
        setError(
          err instanceof ApiError
            ? (err.fields.displayName ?? err.message)
            : 'エラーが発生しました。もう一度お試しください',
        );
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="phone">
      <header className="bar">
        <h1>グループに参加する</h1>
      </header>
      <main>
        {preview.status === 'loading' && <p role="status">確認しています…</p>}
        {preview.status === 'unusable' && (
          <p className="card" role="alert" data-testid="join-unusable">
            このリンクは使えません。招待した人に、新しいリンクを発行してもらってください。
          </p>
        )}
        {preview.status === 'expired' && (
          <p className="card" role="alert" data-testid="join-expired">
            このリンクは期限が切れています。招待した人に、新しいリンクを発行してもらってください。
          </p>
        )}
        {preview.status === 'valid' && (
          <>
            <p data-testid="join-group">
              「<strong>{preview.householdName}</strong>」に招待されています。
            </p>
            {loggedIn === false ? (
              <div className="card" data-testid="join-login-needed">
                <p>
                  参加するには、ログイン（はじめての方は登録）が必要です。終わったら、この画面に戻ります。
                </p>
                <div className="row">
                  <Link
                    className="btn primary"
                    href="/login"
                    onClick={goLogin}
                    data-testid="join-login"
                  >
                    ログイン
                  </Link>
                  <Link
                    className="btn"
                    href="/register"
                    onClick={goLogin}
                    data-testid="join-register"
                  >
                    新しく登録
                  </Link>
                </div>
              </div>
            ) : (
              <form onSubmit={onSubmit} noValidate className="form" data-testid="join-form">
                <label htmlFor="join-name">
                  あなたの表示名（家族に見える名前。空なら自動で決まります）
                </label>
                <input
                  id="join-name"
                  data-testid="input-displayname"
                  type="text"
                  autoComplete="nickname"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  aria-invalid={error ? true : undefined}
                  aria-describedby={error ? 'join-error' : undefined}
                />
                {error && (
                  <p className="error" role="alert" id="join-error" data-testid="form-error">
                    {error}
                  </p>
                )}
                <button
                  type="submit"
                  className="btn primary block"
                  data-testid="submit-button"
                  disabled={busy || loggedIn === null}
                >
                  参加する
                </button>
              </form>
            )}
          </>
        )}
      </main>
    </div>
  );
}
