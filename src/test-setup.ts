// 画面のテスト（jsdom）でだけ、jest-dom の判定を使えるようにする
export {};

if (typeof window !== 'undefined') {
  await import('@testing-library/jest-dom/vitest');
}
