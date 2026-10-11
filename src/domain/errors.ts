export type DomainErrorCode =
  | 'validation' // 入力エラー（400）
  | 'unauthorized' // 未ログイン（401）
  | 'auth_failed' // 認証エラー（401）
  | 'no_household' // グループに入っていない（403）
  | 'not_found' // 見つからない（404）
  | 'conflict' // 競合（409）
  | 'duplicate_url'; // 同じ URL がすでにある（409。確認用）

export class DomainError extends Error {
  constructor(
    readonly code: DomainErrorCode,
    message: string,
    readonly fields?: Record<string, string>,
    readonly data?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}

export const notFound = () => new DomainError('not_found', '見つかりません');
