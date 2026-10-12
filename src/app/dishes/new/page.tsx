'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { api } from '@/ui/api-client';
import { DishForm, type DishFormValues } from '@/ui/DishForm';
import { Shell, useSession } from '@/ui/Shell';

function NewDish() {
  const me = useSession();
  const router = useRouter();
  const params = useSearchParams();
  // 他のアプリの共有メニューや「貼り付けて保存」から、URL を入れた状態で開く（BR3.14）
  const sharedUrl = params.get('url') ?? '';

  if (!me) return <p role="status">読み込み中…</p>;

  const onSubmit = async (v: DishFormValues, opts: { confirmDuplicate: boolean }) => {
    const r = await api<{ dish: { id: string } }>('POST', '/api/dishes', {
      ...v,
      confirmDuplicate: opts.confirmDuplicate,
    });
    // 画像の登録は DishForm が行う。移動は、画像の登録が終わってから（onSaved）
    return { dishId: r.dish.id };
  };

  return (
    <Shell title="料理を保存する" fab={false}>
      <p className="hint">
        URL と料理名だけで保存できます。くわしい情報はあとからでも入れられます。
      </p>
      <DishForm
        key={sharedUrl}
        initialUrl={sharedUrl}
        onSubmit={onSubmit}
        onSaved={() => router.replace('/dishes')}
        onOpenEdit={(id) => router.replace(`/dishes/${id}`)}
        onCancel={() => router.back()}
      />
    </Shell>
  );
}

export default function NewDishPage() {
  return (
    <Suspense fallback={<p role="status">読み込み中…</p>}>
      <NewDish />
    </Suspense>
  );
}
