'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { pendingInviteToken } from './admin/invite-storage';
import { api, ApiError } from './api-client';

/** 登録とログインの画面（mode で切り替える） */
export function AuthForm({ mode }: { mode: 'login' | 'register' }) {
  const router = useRouter();
  const isRegister = mode === 'register';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setErrors({});
    setFormError(null);
    setBusy(true);
    try {
      await api('POST', isRegister ? '/api/auth/register' : '/api/auth/login', {
        email,
        password,
        ...(isRegister ? { displayName } : {}),
      });
      // 招待リンクから来た人は、参加の確認に戻す（U7。BR50.11）
      router.replace(pendingInviteToken() ? '/join' : isRegister ? '/household/new' : '/');
    } catch (err) {
      if (err instanceof ApiError && err.code === 'validation') setErrors(err.fields);
      else if (err instanceof ApiError) setFormError(err.message);
      else setFormError('エラーが発生しました。もう一度お試しください');
    } finally {
      setBusy(false);
    }
  };

  const fieldError = (k: string) =>
    errors[k] ? (
      <p className="error" role="alert" id={`err-${k}`} data-testid={`error-${k}`}>
        {errors[k]}
      </p>
    ) : null;

  return (
    <div className="phone">
      <header className="bar">
        <h1>{isRegister ? '新しく登録する' : 'ログイン'}</h1>
      </header>
      <main>
        <form onSubmit={onSubmit} noValidate className="form" data-testid="auth-form">
          {isRegister && (
            <>
              <label htmlFor="auth-name">表示名（家族に見える名前）</label>
              <input
                id="auth-name"
                data-testid="input-displayname"
                type="text"
                autoComplete="nickname"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
              />
              {fieldError('displayName')}
            </>
          )}
          <label htmlFor="auth-email">メールアドレス</label>
          <input
            id="auth-email"
            data-testid="input-email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-invalid={errors.email ? true : undefined}
            aria-describedby={errors.email ? 'err-email' : undefined}
          />
          {fieldError('email')}
          <label htmlFor="auth-password">パスワード（8文字以上）</label>
          <input
            id="auth-password"
            data-testid="input-password"
            type="password"
            autoComplete={isRegister ? 'new-password' : 'current-password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-invalid={errors.password ? true : undefined}
            aria-describedby={errors.password ? 'err-password' : undefined}
          />
          {fieldError('password')}
          {formError && (
            <p className="error" role="alert" data-testid="form-error">
              {formError}
            </p>
          )}
          <button
            type="submit"
            className="btn primary block"
            data-testid="submit-button"
            disabled={busy}
          >
            {isRegister ? '登録する' : 'ログインする'}
          </button>
        </form>
        <p>
          {isRegister ? (
            <>
              登録済みの方は <Link href="/login">ログイン</Link>
            </>
          ) : (
            <>
              はじめての方は <Link href="/register">新しく登録</Link>
              <br />
              <Link href="/password/forgot" data-testid="go-forgot-password">
                パスワードを忘れた方
              </Link>
            </>
          )}
        </p>
      </main>
    </div>
  );
}
