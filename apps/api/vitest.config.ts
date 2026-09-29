import { existsSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

const rootEnv = new URL('../../.env', import.meta.url);
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);
const testDatabaseUrl =
  process.env.TEST_DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/wchats_test';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    globalSetup: ['test/global-setup.ts'],
    // Every test process talks to the throwaway test database, never the dev one.
    env: { NODE_ENV: 'test', DATABASE_URL: testDatabaseUrl, TEST_DATABASE_URL: testDatabaseUrl },
    fileParallelism: false,
  },
});
