/** 問い合わせの結果 */
export interface QueryResult<T> {
  rows: T[];
  rowCount: number;
}

/** 共通の薄い DB インターフェース（pg と PGlite の違いを隠す） */
export interface Queryable {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<QueryResult<T>>;
  /** 複数の文をまとめて実行する（移行用。パラメータなし） */
  exec(sql: string): Promise<void>;
}

export interface Db extends Queryable {
  /** 1 つの処理として実行する。例外が出たら取り消す */
  transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}
