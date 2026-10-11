/**
 * 招待リンクを開いたあと、ログイン（または登録）を挟んでも参加の確認に戻れるよう、
 * リンクの値をこのタブの中だけに覚えておく（sessionStorage。タブを閉じれば消える。BR50.11）
 */
const KEY = 'mp_invite_token';

export function savePendingInvite(token: string): void {
  try {
    window.sessionStorage.setItem(KEY, token);
  } catch {
    // 保存できない環境では、リンクをもう一度開いてもらう
  }
}

export function pendingInviteToken(): string | null {
  try {
    return window.sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function clearPendingInvite(): void {
  try {
    window.sessionStorage.removeItem(KEY);
  } catch {
    // 何もしない
  }
}

/** リンクの値を、画面の URL から取り除く。使い終わったあと、外へ漏れないようにする（BR50.27） */
export function stripTokenFromUrl(path: string): void {
  try {
    window.history.replaceState(null, '', path);
  } catch {
    // 何もしない
  }
}
