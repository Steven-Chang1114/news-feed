import { cp } from 'node:fs/promises';
import { defineConfig } from 'tsup';

/**
 * Two entry points: the server, and the migration runner the `start` script executes
 * before it. Bundling inlines `@news-feed/api-contract`, so the deployed process
 * needs no workspace linking and no separate build for it.
 */
export default defineConfig({
  entry: ['src/index.ts', 'src/db/migrate-cli.ts'],
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  // Left external so their own runtime resolution is untouched.
  external: ['express', 'cors', 'postgres', 'openai', 'axios'],

  /**
   * tsup treats everything in `dependencies` as external, but the contract is a
   * workspace package whose entry point is TypeScript source. Left external, the
   * deployed process would try to import a `.ts` file and fail at startup.
   */
  noExternal: ['@news-feed/api-contract'],

  /**
   * Migrations are `.sql` files read from disk at runtime, and a bundler only emits
   * JavaScript. Without this the built migrator finds an empty directory and the
   * deploy fails before the server starts.
   */
  onSuccess: async () => {
    await cp('src/db/migrations', 'dist/db/migrations', { recursive: true });
  },
});
