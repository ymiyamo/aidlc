import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/__tests__/**/*.test.{ts,tsx}'],
    setupFiles: ['./src/test-setup.ts'],
    // PGlite（WASM）の起動に少し時間がかかるため、余裕を持たせる
    testTimeout: 30000,
    hookTimeout: 60000,
    coverage: {
      provider: 'v8',
      // U4 が変更した共有経路を、本番の import 経由で判定する（R-03）。
      include: [
        'src/api/router.ts',
        'src/api/http.ts',
        'src/repo/dishes.ts',
        'src/domain/suggestion.ts',
        'src/domain/seed.ts',
        'src/domain/validation.ts',
        'src/ui/DishForm.tsx',
        'src/ui/types.ts',
      ],
      exclude: ['src/**/__tests__/**', 'src/app/**', 'src/test-setup.ts', 'src/test-helpers/**'],
      thresholds: { lines: 80 },
      reporter: ['text-summary', 'text'],
    },
  },
});
