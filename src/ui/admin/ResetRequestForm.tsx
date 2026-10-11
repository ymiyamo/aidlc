'use client';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { api, ApiError } from '../api-client';

/**
 * パスワード再設定の要求の画面（BR50.1）。登録済みかどうかに関わらず同じ文言を出す。
 * メールは実際には送らないので、通し版・開発の設定では、送信箱のリンクを画面に出す（BR50.25）
 */
export function ResetRequestForm() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [devLink, setDevLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setMessage(null);
    setDevLink(null);
    setBusy(true);
    try {
      const r = await api<{ message: string }>('POST', '/api/password-reset/request', { email });
      setMessage(r.message);
      // 開発用の送信箱が有効なときだけ、リンクが返る。本番では 404 なので何も出さない
      try {
        const out = await api<{ link: string | null }>(
          'GET',
          `/api/dev/mail-outbox?email=${encodeURIComponent(email)}`,
        );
        setDevLink(out.link);
      } catch {
        setDevLink(null);
      }
    } catch (err) {
      setError(
        err instanceof ApiError ? (err.fields.email ?? err.message) : 'エラーが発生しました',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="phone">
      <header className="bar">
        <h1>パスワードを再設定する</h1>
      </header>
      <main>
        <p>登録したメールアドレスを入れてください。再設定のリンクをお知らせします。</p>
        <form onSubmit={onSubmit} noValidate className="form" data-testid="reset-request-form">
          <label htmlFor="reset-email">メールアドレス</label>
          <input
            id="reset-email"
            data-testid="input-email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? 'reset-error' : undefined}
          />
          {error && (
            <p className="error" role="alert" id="reset-error" data-testid="form-error">
              {error}
            </p>
          )}
          <button
            type="submit"
            className="btn primary block"
            data-testid="submit-button"
            disabled={busy}
          >
            再設定のリンクを受け取る
          </button>
        </form>
        {message && (
          <p className="card notice" role="status" data-testid="reset-message">
            {message}
          </p>
        )}
        {devLink && (
          <div className="card" data-testid="dev-reset-box">
            <p>
              開発用の表示：メールは実際には送らないので、ここにリンクを出しています（60 分間、1
              回だけ使えます）。
            </p>
            <Link href={devLink} data-testid="dev-reset-link">
              パスワードを再設定する
            </Link>
          </div>
        )}
        <p>
          <Link href="/login">ログインに戻る</Link>
        </p>
      </main>
    </div>
  );
}
