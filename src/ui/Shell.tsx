'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { api, ApiError } from './api-client';

export interface Me {
  account: { displayName: string | null };
  hasHousehold: boolean;
}

/** ログイン状態とグループを確認する。未ログインならログイン画面、グループがなければ作成画面へ移す */
export function useSession(opts: { requireHousehold?: boolean } = { requireHousehold: true }) {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  useEffect(() => {
    let cancelled = false;
    api<Me>('GET', '/api/me')
      .then((m) => {
        if (cancelled) return;
        if (opts.requireHousehold !== false && !m.hasHousehold) router.replace('/household/new');
        else setMe(m);
      })
      .catch((e) => {
        if (e instanceof ApiError && e.status === 401) router.replace('/login');
      });
    return () => {
      cancelled = true;
    };
  }, [router, opts.requireHousehold]);
  return me;
}

const TABS = [
  { href: '/suggest', label: '買い物前', icon: '🍽' },
  { href: '/dishes', label: '保存', icon: '📌' },
  { href: '/picked', label: '選んだもの', icon: '🛒' },
];

/** ログイン後の共通の枠：見出し、下のタブ、右下の「＋」 */
export function Shell({
  title,
  children,
  fab = true,
}: {
  title: string;
  children: ReactNode;
  fab?: boolean;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const logout = async () => {
    await api('POST', '/api/auth/logout');
    router.replace('/login');
  };
  return (
    <div className="phone">
      <header className="bar">
        <h1>{title}</h1>
        <button type="button" className="btn small" data-testid="logout-button" onClick={logout}>
          ログアウト
        </button>
      </header>
      <main>{children}</main>
      {fab && (
        <Link className="fab" href="/dishes/new" aria-label="保存する" data-testid="fab-add">
          ＋
        </Link>
      )}
      <nav className="tabs" aria-label="主な画面">
        <Link href="/" aria-current={pathname === '/' ? 'page' : undefined} data-testid="tab-home">
          🏠<span>ホーム</span>
        </Link>
        {TABS.map((t) => (
          <Link
            key={t.href}
            href={t.href}
            aria-current={pathname === t.href ? 'page' : undefined}
            data-testid={`tab-${t.href.slice(1)}`}
          >
            {t.icon}
            <span>{t.label}</span>
          </Link>
        ))}
      </nav>
    </div>
  );
}
