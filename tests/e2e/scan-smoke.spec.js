/**
 * Smoke test — loads a real page with Pokemon card images,
 * clicks the Scan button, and verifies pricing results appear.
 *
 * Run: npx playwright test scan-smoke --project=extension
 * Requires: Node server running at http://127.0.0.1:3000 (npm start)
 */

import { test, expect, chromium } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXT_PATH  = path.resolve(__dirname, '../../dist/extension-wasm');
const TEST_PAGE_URL = 'http://127.0.0.1:3000/scan-test.html';
const SERVER_URL = 'http://127.0.0.1:3000';
const REPO_ROOT = path.resolve(__dirname, '../..');

let serverProcess = null;

async function ensureServerRunning() {
  // Check if server is already running
  try {
    const res = await fetch(`${SERVER_URL}/api/health`, { signal: AbortSignal.timeout(2000) });
    if (res.ok) {
      console.log('  Server already running');
      return;
    }
  } catch {
    // Server not running, will start it
  }

  if (!fs.existsSync(path.join(REPO_ROOT, '.env'))) {
    return 'no-env';
  }

  console.log('  Starting Node server...');
  return new Promise((resolve, reject) => {
    serverProcess = spawn(process.execPath, ['--env-file=.env', 'src/index.js'], {
      cwd: REPO_ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PORT: '3000' },
    });

    let output = '';
    serverProcess.stdout.on('data', (data) => {
      output += data.toString();
      if (output.includes('listening on') || output.includes('Server running')) {
        console.log('  Server started');
        resolve();
      }
    });
    serverProcess.stderr.on('data', (data) => {
      output += data.toString();
    });

    serverProcess.on('error', (err) => {
      reject(new Error(`Failed to start server: ${err.message}`));
    });

    serverProcess.on('exit', (code) => {
      if (code !== 0 && serverProcess) {
        reject(new Error(`Server exited with code ${code}: ${output}`));
      }
    });

    // Timeout after 30 seconds
    setTimeout(() => {
      if (serverProcess && !serverProcess.killed) {
        reject(new Error('Server startup timeout'));
      }
    }, 30_000);
  });
}

async function stopServer() {
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
}

test.describe('Scan smoke test — real page scan', () => {
  let context;
  let extensionId;
  let skipReason = '';

  test.beforeAll(async () => {
    // Ensure server is running
    const started = await ensureServerRunning();
    if (started === 'no-env') {
      skipReason = 'Server is not running and .env is missing, so it cannot be started';
      return;
    }

    context = await chromium.launchPersistentContext('', {
      headless: false,
      args: [
        `--disable-extensions-except=${EXT_PATH}`,
        `--load-extension=${EXT_PATH}`,
        '--no-sandbox',
      ],
    });

    // Wait for service worker - models download takes ~30-60s on first run
    let sw = context.serviceWorkers().find(w => w.url().startsWith('chrome-extension://'));
    if (!sw) {
      sw = await context.waitForEvent('serviceworker', {
        predicate: w => w.url().startsWith('chrome-extension://'),
        timeout: 90_000,
      });
    }
    extensionId = new URL(sw.url()).hostname;
    console.log(`\n  Extension ID: ${extensionId}\n`);

    // Wait for models to be ready before running tests
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/popup.html`);
    await page.waitForFunction(
      () => {
        const downloadText = document.querySelector('.download-progress');
        return !downloadText || downloadText.textContent.includes('100%') || downloadText.textContent.includes('complete') || downloadText.textContent.includes('Ready');
      },
      { timeout: 120_000 }
    );
    await page.close();
  });

  test.afterAll(async () => {
    await context?.close();
    await stopServer();
  });

  test('loads test page, clicks Scan, and verifies pricing results', async () => {
    test.skip(Boolean(skipReason), skipReason);
    // 1. FIRST: Open the extension popup (like visual tests do)
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);

    // Wait for popup to be ready
    await popup.waitForFunction(() => typeof window.updateResults === 'function', { timeout: 8_000 });
    console.log('  Popup ready');

    // 2. SECOND: Open the test page with Pokemon card images via HTTP
    const page = await context.newPage();
    await page.goto(TEST_PAGE_URL, { waitUntil: 'networkidle' });

    // Wait for images to load
    await page.waitForFunction(() => {
      const imgs = document.querySelectorAll('img');
      return Array.from(imgs).every(img => img.complete && img.naturalWidth > 0);
    }, { timeout: 30_000 });

    console.log('  Test page loaded, images ready');

    // 3. Make the TEST PAGE the active tab (bring to front)
    await page.bringToFront();
    console.log('  Test page brought to front');

    // Small delay to ensure tab activation
    await page.waitForTimeout(500);

    // 4. Click the Scan button in the popup
    const scanBtn = popup.locator('#btn-scan');
    await expect(scanBtn).toBeVisible();
    await scanBtn.click();

    // Wait for scanning state
    await expect(popup.locator('body')).toHaveClass(/scanning/, { timeout: 5_000 });
    console.log('  Scan started');

    // 5. Wait for scan to complete (results appear in popup)
    await popup.waitForFunction(
      () => {
        const cards = document.querySelectorAll('.card-row');
        return cards.length > 0;
      },
      { timeout: 240_000 } // 4 minutes max for full scan
    );

    console.log('  Scan completed, results visible');

    // 6. Verify results
    const cardRows = popup.locator('.card-row');
    const count = await cardRows.count();
    console.log(`  Cards detected: ${count}`);
    expect(count).toBeGreaterThan(0);

    const firstCardName = popup.locator('.card-name').first();
    await expect(firstCardName).toBeVisible();
    const cardNameText = await firstCardName.textContent();
    console.log(`  First card: ${cardNameText}`);

    const priceMains = popup.locator('.price-main');
    const priceCount = await priceMains.count();
    console.log(`  Cards with prices: ${priceCount}`);

    const totalValue = popup.locator('#s-value');
    await expect(totalValue).toBeVisible();
    const valueText = await totalValue.textContent();
    console.log(`  Total value: ${valueText}`);

    const detectedCount = popup.locator('#s-detected');
    await expect(detectedCount).toBeVisible();
    const detectedText = await detectedCount.textContent();
    console.log(`  Detected: ${detectedText}`);

    // Take screenshot for verification
    await popup.screenshot({ path: path.join(__dirname, 'screenshots', 'scan-smoke-result.png'), fullPage: true });
    console.log('  Screenshot saved');

    await page.close();
    await popup.close();
  });
});