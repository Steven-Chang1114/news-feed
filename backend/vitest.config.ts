import { fileURLToPath } from 'node:url';
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

export default defineConfig(({ mode }) => ({
  test: {
    /**
     * The integration suite needs TEST_DATABASE_URL, which lives in the repo-root
     * `.env` alongside every other secret. Vitest does not read `.env` on its own,
     * and the third argument (an empty prefix) is what allows non-`VITE_` names.
     */
    env: loadEnv(mode, repoRoot, ''),
  },
}));
