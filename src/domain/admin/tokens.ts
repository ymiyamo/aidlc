import { createHash, randomBytes } from 'node:crypto';

/** リンクの種類。種類ごとに変換値が変わるので、再設定のリンクを招待に流用できない */
export type LinkKind = 'invite' | 'reset';

/** 推測できない、十分に長いランダムな値（256 ビット）。リンクに入れて渡したあとは保存しない（BR50.3、BR50.10） */
export const newLinkToken = () => randomBytes(32).toString('base64url');

/** DB に保存するのは、この変換値だけ。元の値や変換値をログに出さない（BR50.26） */
export const digestLinkToken = (kind: LinkKind, token: string) =>
  createHash('sha256').update(`${kind}:${token}`, 'utf8').digest('hex');
