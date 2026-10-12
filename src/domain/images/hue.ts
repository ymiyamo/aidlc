/**
 * 料理名から決まる色相（0〜359）。同じ料理名なら、いつも同じ色になる。
 * 画面（色の枠）とダミーの絵で同じ式を使うため、Node の部品に頼らない小さな部品に分けてある
 */
export function hueOf(name: string): number {
  let h = 2166136261;
  for (const ch of name) {
    h ^= ch.codePointAt(0)!;
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % 360;
}
