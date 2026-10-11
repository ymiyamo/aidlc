// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const replace = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
  usePathname: () => '/',
}));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
const apiMock = vi.fn();
vi.mock('../../api-client', async (orig) => {
  const actual = await orig<typeof import('../../api-client')>();
  return { ...actual, api: (...args: unknown[]) => apiMock(...args) };
});

import { ApiError } from '../../api-client';
import { JoinPanel } from '../JoinPanel';
import { ResetConfirmForm } from '../ResetConfirmForm';
import { ResetRequestForm } from '../ResetRequestForm';
import { SettingsPanel } from '../SettingsPanel';
import { pendingInviteToken, savePendingInvite } from '../invite-storage';

type Handler = (method: string, path: string, body?: unknown) => unknown;
/** 呼び出しごとに (method, path) で応答を決める。値が Error なら失敗にする */
function routeApi(handler: Handler) {
  apiMock.mockImplementation(async (method: string, path: string, body?: unknown) => {
    const r = handler(method, path, body);
    if (r instanceof Error) throw r;
    return r;
  });
}
const calls = (path: string) => apiMock.mock.calls.filter((c) => c[1] === path);
const fill = (testId: string, value: string) =>
  fireEvent.change(screen.getByTestId(testId), { target: { value } });

beforeEach(() => {
  apiMock.mockReset();
  replace.mockReset();
  window.sessionStorage.clear();
});
afterEach(cleanup);

describe('設定：招待リンクの発行と表示', () => {
  it('発行すると、リンクの全体が欄に出る', async () => {
    routeApi((m, p) =>
      p === '/api/admin/overview'
        ? { householdName: 'わが家', activeMemberCount: 2 }
        : { path: '/join?token=abc', expiresAt: '2026-01-08T00:00:00Z' },
    );
    render(<SettingsPanel />);
    expect(await screen.findByTestId('settings-group')).toHaveTextContent(
      'わが家（メンバー 2 人）',
    );
    fireEvent.click(screen.getByTestId('invite-issue'));
    const input = (await screen.findByTestId('invite-link')) as HTMLInputElement;
    expect(input.value).toBe(`${window.location.origin}/join?token=abc`);
    expect(input).toHaveAttribute('readonly');
    expect(screen.getByLabelText(/招待リンク（/)).toBe(input);
  });

  it('いっぱいのとき（409）は、理由を出す', async () => {
    routeApi((m, p) =>
      p === '/api/invitations'
        ? new ApiError(409, 'conflict', '有効な招待リンクがいっぱいです')
        : { householdName: 'g', activeMemberCount: 2 },
    );
    render(<SettingsPanel />);
    fireEvent.click(screen.getByTestId('invite-issue'));
    expect(await screen.findByTestId('invite-error')).toHaveTextContent('いっぱい');
    expect(screen.queryByTestId('invite-link')).not.toBeInTheDocument();
  });
});

describe('設定：グループから抜ける', () => {
  it('確認画面を挟み、「やめる」なら何も送らない', async () => {
    routeApi(() => ({ householdName: 'g', activeMemberCount: 3 }));
    render(<SettingsPanel />);
    await screen.findByTestId('settings-group');
    fireEvent.click(screen.getByTestId('leave-start'));
    expect(screen.getByTestId('leave-confirm-box')).toBeInTheDocument();
    expect(screen.queryByTestId('leave-last-hint')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('leave-cancel'));
    expect(screen.queryByTestId('leave-confirm-box')).not.toBeInTheDocument();
    expect(calls('/api/household/leave')).toHaveLength(0);
  });

  it('確認すると抜けて、グループ作成の画面へ移る', async () => {
    routeApi((m, p) =>
      p === '/api/household/leave' ? { ok: true } : { householdName: 'g', activeMemberCount: 3 },
    );
    render(<SettingsPanel />);
    fireEvent.click(screen.getByTestId('leave-start'));
    fireEvent.click(screen.getByTestId('leave-confirm'));
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/household/new'));
    expect(calls('/api/household/leave')[0][2]).toEqual({ confirm: true });
  });

  it('最後の 1 人は、削除の注意を最初から出し、2 回目の確認のあとで確定する', async () => {
    let first = true;
    routeApi((m, p) => {
      if (p !== '/api/household/leave') return { householdName: 'g', activeMemberCount: 1 };
      if (first) {
        first = false;
        return new ApiError(409, 'conflict', '最後のメンバー', {}, { needsLastConfirm: true });
      }
      return { ok: true, householdDeleted: true };
    });
    render(<SettingsPanel />);
    await screen.findByTestId('settings-group');
    fireEvent.click(screen.getByTestId('leave-start'));
    expect(screen.getByTestId('leave-last-hint')).toHaveTextContent('すべて削除されます');
    fireEvent.click(screen.getByTestId('leave-confirm'));
    expect(await screen.findByTestId('leave-last-box')).toHaveTextContent('すべて削除されます');
    expect(replace).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('leave-last-confirm'));
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/household/new'));
    expect(calls('/api/household/leave')[1][2]).toEqual({ confirm: true, confirmLast: true });
  });
});

describe('設定：アカウント削除', () => {
  const open = async () => {
    routeApi(() => ({ householdName: 'g', activeMemberCount: 2 }));
    render(<SettingsPanel />);
    await screen.findByTestId('settings-group');
    fireEvent.click(screen.getByTestId('delete-start'));
  };

  it('チェックがなければ送らない', async () => {
    await open();
    fill('delete-password', 'password-1234');
    fireEvent.click(screen.getByTestId('delete-confirm'));
    expect(await screen.findByTestId('delete-error')).toHaveTextContent('チェックを入れてください');
    expect(calls('/api/account/delete')).toHaveLength(0);
  });

  it('パスワードが違えば理由を出し、入力は残る', async () => {
    routeApi((m, p) =>
      p === '/api/account/delete'
        ? new ApiError(401, 'auth_failed', 'パスワードが違います')
        : { householdName: 'g', activeMemberCount: 2 },
    );
    render(<SettingsPanel />);
    await screen.findByTestId('settings-group');
    fireEvent.click(screen.getByTestId('delete-start'));
    fill('delete-password', 'wrong');
    fireEvent.click(screen.getByTestId('delete-understood'));
    fireEvent.click(screen.getByTestId('delete-confirm'));
    expect(await screen.findByTestId('delete-error')).toHaveTextContent('パスワードが違います');
    expect(screen.getByTestId('delete-password')).toHaveValue('wrong');
    expect(replace).not.toHaveBeenCalled();
  });

  it('確認とパスワードがそろえば削除して、ログイン画面へ移る', async () => {
    await open();
    fill('delete-password', 'password-1234');
    fireEvent.click(screen.getByTestId('delete-understood'));
    fireEvent.click(screen.getByTestId('delete-confirm'));
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/login'));
    expect(calls('/api/account/delete')[0][2]).toEqual({
      confirm: true,
      password: 'password-1234',
    });
  });

  it('入力欄にはラベルがある', async () => {
    await open();
    expect(screen.getByLabelText(/パスワード（確認のため/)).toBeInTheDocument();
    expect(screen.getByLabelText(/元に戻せないことを理解しました/)).toBeInTheDocument();
  });
});

describe('参加の画面', () => {
  const previewValid = { status: 'valid', householdName: '佐藤家' };

  it('未ログインなら、グループ名とログイン・登録の案内を出し、リンクの値をこのタブに覚える', async () => {
    routeApi((m, p) => {
      if (p === '/api/invitations/preview') return previewValid;
      return new ApiError(401, 'unauthorized', 'ログインしてください');
    });
    render(<JoinPanel token="tok-1" />);
    expect(await screen.findByTestId('join-group')).toHaveTextContent('佐藤家');
    expect(await screen.findByTestId('join-login-needed')).toBeInTheDocument();
    // 実際の画面遷移は起こさず、クリックの処理（リンクの値を覚える）だけ確かめる
    screen.getByTestId('join-login').addEventListener('click', (e) => e.preventDefault());
    fireEvent.click(screen.getByTestId('join-login'));
    expect(pendingInviteToken()).toBe('tok-1');
    expect(screen.queryByTestId('join-form')).not.toBeInTheDocument();
  });

  it('ログイン済みなら、表示名を入れて参加でき、ホームへ移る。覚えたリンクは消える', async () => {
    savePendingInvite('tok-2');
    routeApi((m, p) => {
      if (p === '/api/invitations/preview') return previewValid;
      return { ok: true };
    });
    render(<JoinPanel token={null} />); // ログインを挟んで戻ったとき
    const input = await screen.findByLabelText(/あなたの表示名/);
    await waitFor(() => expect(screen.getByTestId('submit-button')).toBeEnabled());
    fireEvent.change(input, { target: { value: 'はなこ' } });
    fireEvent.click(screen.getByTestId('submit-button'));
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/'));
    expect(calls('/api/invitations/join')[0][2]).toEqual({ token: 'tok-2', displayName: 'はなこ' });
    expect(pendingInviteToken()).toBeNull();
  });

  it('すでに別のグループにいれば、理由を出して入力を残す', async () => {
    routeApi((m, p) => {
      if (p === '/api/invitations/preview') return previewValid;
      if (p === '/api/invitations/join') {
        return new ApiError(409, 'conflict', '先に今のグループから抜けてください');
      }
      return { account: {}, hasHousehold: true };
    });
    render(<JoinPanel token="tok-3" />);
    const input = await screen.findByLabelText(/あなたの表示名/);
    await waitFor(() => expect(screen.getByTestId('submit-button')).toBeEnabled());
    fireEvent.change(input, { target: { value: 'たろう' } });
    fireEvent.click(screen.getByTestId('submit-button'));
    expect(await screen.findByTestId('form-error')).toHaveTextContent(
      '先に今のグループから抜けてください',
    );
    expect(input).toHaveValue('たろう');
    expect(replace).not.toHaveBeenCalled();
  });

  it('期限切れ・使えないリンクは、参加の操作を出さずに理由を示す', async () => {
    routeApi(() => ({ status: 'expired' }));
    const { unmount } = render(<JoinPanel token="old" />);
    expect(await screen.findByTestId('join-expired')).toHaveTextContent(
      '新しいリンクを発行してもらってください',
    );
    expect(screen.queryByTestId('join-form')).not.toBeInTheDocument();
    unmount();
    routeApi(() => ({ status: 'unusable' }));
    render(<JoinPanel token="used" />);
    expect(await screen.findByTestId('join-unusable')).toHaveTextContent('このリンクは使えません');
  });

  it('参加の瞬間に期限が切れていた（410）ときも、期限切れの表示になる', async () => {
    routeApi((m, p) => {
      if (p === '/api/invitations/preview') return previewValid;
      if (p === '/api/invitations/join') return new ApiError(410, 'expired', '期限切れ');
      return { account: {}, hasHousehold: false };
    });
    render(<JoinPanel token="tok-4" />);
    await waitFor(() => expect(screen.getByTestId('submit-button')).toBeEnabled());
    fireEvent.click(screen.getByTestId('submit-button'));
    expect(await screen.findByTestId('join-expired')).toBeInTheDocument();
  });

  it('リンクの値がまったくなければ「使えません」', async () => {
    routeApi(() => ({}));
    render(<JoinPanel token={null} />);
    expect(await screen.findByTestId('join-unusable')).toBeInTheDocument();
    expect(calls('/api/invitations/preview')).toHaveLength(0);
  });
});

describe('パスワード再設定の画面', () => {
  it('要求すると、同じ文言を出し、開発用の送信箱のリンクがあれば画面に出す', async () => {
    routeApi((m, p) =>
      p === '/api/password-reset/request'
        ? { ok: true, message: '登録されているメールアドレスなら、案内を送りました' }
        : { link: '/password/reset?token=zzz' },
    );
    render(<ResetRequestForm />);
    fill('input-email', 'a@example.com');
    fireEvent.click(screen.getByTestId('submit-button'));
    expect(await screen.findByTestId('reset-message')).toHaveTextContent('案内を送りました');
    expect(await screen.findByTestId('dev-reset-link')).toHaveAttribute(
      'href',
      '/password/reset?token=zzz',
    );
  });

  it('本番（送信箱が使えない）では、リンクを出さない', async () => {
    routeApi((m, p) =>
      p === '/api/password-reset/request'
        ? { ok: true, message: '案内を送りました' }
        : new ApiError(404, 'not_found', '見つかりません'),
    );
    render(<ResetRequestForm />);
    fill('input-email', 'a@example.com');
    fireEvent.click(screen.getByTestId('submit-button'));
    expect(await screen.findByTestId('reset-message')).toBeInTheDocument();
    expect(screen.queryByTestId('dev-reset-box')).not.toBeInTheDocument();
  });

  it('メールアドレスの形が違えば、理由を出す', async () => {
    routeApi((m, p) =>
      p === '/api/password-reset/request'
        ? new ApiError(400, 'validation', '入力エラー', {
            email: 'メールアドレスの形式が正しくありません',
          })
        : {},
    );
    render(<ResetRequestForm />);
    fill('input-email', 'bad');
    fireEvent.click(screen.getByTestId('submit-button'));
    expect(await screen.findByTestId('form-error')).toHaveTextContent('形式が正しくありません');
    expect(screen.getByLabelText('メールアドレス')).toHaveAttribute('aria-invalid', 'true');
  });

  it('新しいパスワードを設定できる。成功したらログインへ案内する', async () => {
    routeApi(() => ({ ok: true }));
    render(<ResetConfirmForm token="tok" />);
    fill('input-password', 'new-password-1');
    fireEvent.click(screen.getByTestId('submit-button'));
    expect(await screen.findByTestId('reset-done')).toBeInTheDocument();
    expect(calls('/api/password-reset/confirm')[0][2]).toEqual({
      token: 'tok',
      password: 'new-password-1',
    });
    expect(screen.getByTestId('go-login')).toHaveAttribute('href', '/login');
  });

  it('弱いパスワードは理由を出し、入力を残す', async () => {
    routeApi(
      () =>
        new ApiError(400, 'validation', '入力エラー', {
          password: 'パスワードは8文字以上にしてください',
        }),
    );
    render(<ResetConfirmForm token="tok" />);
    fill('input-password', 'short');
    fireEvent.click(screen.getByTestId('submit-button'));
    expect(await screen.findByTestId('form-error')).toHaveTextContent('8文字以上');
    expect(screen.getByTestId('input-password')).toHaveValue('short');
  });

  it('使えないリンクは、理由を区別せず、再要求へ案内する', async () => {
    routeApi(
      () => new ApiError(400, 'validation', '入力エラー', { token: 'このリンクは使えません' }),
    );
    render(<ResetConfirmForm token="tok" />);
    fill('input-password', 'new-password-1');
    fireEvent.click(screen.getByTestId('submit-button'));
    expect(await screen.findByTestId('reset-link-error')).toHaveTextContent(
      'このリンクは使えません',
    );
    expect(screen.getByTestId('go-forgot')).toHaveAttribute('href', '/password/forgot');
  });

  it('リンクの値がなければ、最初から使えない表示', () => {
    routeApi(() => ({}));
    render(<ResetConfirmForm token={null} />);
    expect(screen.getByTestId('reset-link-error')).toBeInTheDocument();
  });
});
