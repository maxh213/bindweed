import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'qa',
  testMatch: '**/*.e2e.ts',
  timeout: 60_000,
  workers: Number(process.env.PW_WORKERS ?? 1),
  use: { headless: true, trace: 'retain-on-failure' }
});
