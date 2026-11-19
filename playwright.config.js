import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    headless: true,
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [
    {
      name: 'chromium',
      testIgnore: ['**/extension-chrome.spec.js', '**/extension-visual.spec.js', '**/draw-box.spec.js', '**/overlay-remove.spec.js', '**/worker-restart.spec.js', '**/self-update.spec.js', '**/check-live.spec.js', '**/japanese-cards.spec.js'],
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'extension',
      testMatch: ['**/extension-chrome.spec.js', '**/extension-visual.spec.js', '**/extension-wasm-popup.spec.js', '**/draw-box.spec.js', '**/overlay-remove.spec.js', '**/worker-restart.spec.js', '**/self-update.spec.js', '**/check-live.spec.js', '**/japanese-cards.spec.js'],
      timeout: 180_000,
      use: {
        headless: false,
      },
    },
    {
      name: 'demo',
      testMatch: ['**/demo-overlay.spec.js'],
      use: {
        headless: false,
      },
    },
  ],
});
