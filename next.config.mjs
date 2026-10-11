import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/** @type {import('next').NextConfig} */
const nextConfig = {
  // ホームディレクトリ等の別の lockfile に惑わされず、このフォルダをルートにする
  outputFileTracingRoot: dirname(fileURLToPath(import.meta.url)),
  reactStrictMode: true,
  poweredByHeader: false,
  // DB ドライバは Node.js の実行時にそのまま読み込む（バンドルしない）
  serverExternalPackages: ['@electric-sql/pglite', 'pg'],
  // 起動時の移行と初期データで読むファイルを、ビルド成果物に含める
  outputFileTracingIncludes: {
    '/api/[...path]': ['./db/migrations/**/*', './data/seed-dishes.json'],
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'same-origin' },
        ],
      },
    ];
  },
};

export default nextConfig;
