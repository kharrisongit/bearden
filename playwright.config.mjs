import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './test-ui',
  fullyParallel: true,
  workers: process.env.CI ? 2 : 1,
  use: {
    browserName: 'chromium',
    reducedMotion: 'reduce',
    launchOptions: process.env.BEARDEN_TEST_CHROMIUM ? {
      executablePath: process.env.BEARDEN_TEST_CHROMIUM,
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    } : {},
  },
});
