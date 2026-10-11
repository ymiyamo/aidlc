'use client';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { api, ApiError } from '../api-client';
import { stripTokenFromUrl } from './invite-storage';

/** 新しいパスワードの入力の画面（BR50.4）。リンクの値は URL から受け取り、使い終わったら URL から取り除く（BR50.27） */
export function ResetConfirmForm({ token }: { token: string | null }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [linkError, setLinkError] = useState(token === null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api('POST', '/api/password-reset/confirm', { token, password });
      setDone(true);
      stripTokenFromUrl('/password/reset');
    } catch (err) {
      if (err instanceof ApiError && err.fields.password) {
        setError(err.fields.password); // 入力は残す
      } else if (err instanceof ApiError && err.fields.token) {
        setLinkError(true);
        stripTokenFromUrl('/password/reset');
      } else {
        setError(err instanceof ApiError ? err.message : 'エラーが発生しました');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="phone">
      <header className="bar">
        <h1>新しいパスワード</h1>
      </header>
      <main>
        {done ? (
          <div className="card notice" role="status" data-testid="reset-done">
            <p>パスワードを変更しました。新しいパスワードでログインしてください。</p>
            <Link className="btn primary block" href="/login" data-testid="go-login">
              ログインへ
            </Link>
          </div>
        ) : linkError ? (
          <div className="card" role="alert" data-testid="reset-link-error">
            <p>このリンクは使えません。もう一度、再設定を要求してください。</p>
            <Link className="btn block" href="/password/forgot" data-testid="go-forgot">
              再設定を要求する
            </Link>
          </div>
        ) : (
          <form onSubmit={onSubmit} noValidate className="form" data-testid="reset-confirm-form">
            <label htmlFor="reset-password">新しいパスワード（8文字以上）</label>
            <input
              id="reset-password"
              data-testid="input-password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? 'reset-password-error' : undefined}
            />
            {error && (
              <p className="error" role="alert" id="reset-password-error" data-testid="form-error">
                {error}
              </p>
            )}
            <button
              type="submit"
              className="btn primary block"
              data-testid="submit-button"
              disabled={busy}
            >
              パスワードを変更する
            </button>
          </form>
        )}
      </main>
    </div>
  );
}
