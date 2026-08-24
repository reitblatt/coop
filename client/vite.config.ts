/// <reference types="vitest/config" />
import { fileURLToPath } from 'node:url';
import path, { dirname } from 'path';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';
import svgr from 'vite-plugin-svgr';
import tsconfigPaths from 'vite-tsconfig-paths';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ mode }) => {
  const isProduction = mode === 'production';
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  const allowedHosts = (env.VITE_DEV_ALLOWED_HOSTS ?? '')
    .split(',')
    .map((host) => host.trim())
    .filter((v) => !!v);
  const reactCompilerConfig = {
    compilationMode: 'annotation',
    target: '18',
    panicThreshold: isProduction ? 'none' : 'critical_errors',
    logger: {
      logEvent(filename: string | null, event: { kind: string }) {
        if (!isProduction && event.kind === 'CompileError') {
          console.error(
            `[React Compiler] Skipped ${filename ?? 'unknown file'}`,
          );
        }
      },
    },
  };

  return {
    plugins: [
      react({
        babel: {
          plugins: [['babel-plugin-react-compiler', reactCompilerConfig]],
        },
      }),
      svgr(),
      tsconfigPaths(),
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
        // Redirect `recharts-scale/es6/getNiceTickValues` through our wrapper so
        // we can recover from upstream's DecimalError "Division by zero" on
        // degenerate chart domains. See `src/rechartsScaleWrapper.js`.
        'recharts-scale/es6/getNiceTickValues': path.resolve(
          __dirname,
          './src/rechartsScaleWrapper.js',
        ),
      },
    },
    build: {
      outDir: 'build',
    },
    server: {
      // See VITE_DEV_ALLOWED_HOSTS in .env.example.
      allowedHosts: allowedHosts.length > 0 ? allowedHosts : undefined,
      proxy: {
        '/api': {
          target: 'http://localhost:8080',
          changeOrigin: true,
        },
      },
    },
    test: {
      globals: true,
      environment: 'jsdom',
      setupFiles: './src/setupTests.ts',
      typecheck: {
        tsconfig: './tsconfig.test.json',
      },
    },
  };
});
