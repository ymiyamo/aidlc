'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { api, ApiError } from '@/ui/api-client';
import { useSession } from '@/ui/Shell';

export default function NewHouseholdPage() {
  const router = useRouter();
  const me = useSession({ requireHousehold: false });
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // すでにグループに入っていれば、ホームへ移す
  useEffect(() => {
    if (me?.hasHousehold) router.replace('/');
  }, [me, router]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api('POST', '/api/household', { name });
      router.replace('/');
    } catch (err) {
      if (err instanceof ApiError && err.code === 'conflict') {
        router.replace('/'); // すでにグループに入っている
        return;
      }
      setError(err instanceof ApiError ? (err.fields.name ?? err.message) : 'エラーが発生しました');
    } finally {
      setBusy(false);
    }
  };

  if (!me || me.hasHousehold) return <p role="status">読み込み中…</p>;

  return (
    <div className="phone">
      <header className="bar">
        <h1>家族のグループを作る</h1>
      </header>
      <main>
        <p>
          家族みんなで料理の候補を共有するグループを作ります。作ると、定番の料理 30
          件が最初から入ります。
        </p>
        <form onSubmit={onSubmit} noValidate className="form" data-testid="household-form">
          <label htmlFor="hh-name">グループ名（空なら「わが家」）</label>
          <input
            id="hh-name"
            data-testid="input-household-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="わが家"
            aria-invalid={error ? true : undefined}
          />
          {error && (
            <p className="error" role="alert" data-testid="form-error">
              {error}
            </p>
          )}
          <button
            type="submit"
            className="btn primary block"
            data-testid="submit-button"
            disabled={busy}
          >
            グループを作る
          </button>
        </form>
      </main>
    </div>
  );
}
