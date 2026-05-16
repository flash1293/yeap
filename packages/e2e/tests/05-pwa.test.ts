/**
 * 05-pwa.test.ts
 *
 * Playwright tests for the PWA:
 * - No /chat route
 * - "Open Mattermost" link present on /bots
 * - Bots page loads after login
 */
import { test, expect } from '@playwright/test'

const PWA_URL = process.env['PWA_URL'] ?? 'http://localhost:5173'
const PWA_PASSWORD = process.env['PWA_PASSWORD'] ?? 'test-password'

test.describe('PWA', () => {
  test('/chat route no longer exists — redirects to /bots or /login', async ({ page }) => {
    await page.goto(`${PWA_URL}/chat`)
    // Should end up somewhere other than /chat
    await page.waitForURL((url) => !url.pathname.startsWith('/chat'), { timeout: 10_000 })
    const pathname = new URL(page.url()).pathname
    expect(pathname).not.toMatch(/^\/chat/)
  })

  test('bots page has "Open Mattermost" link after login', async ({ page }) => {
    // Login
    await page.goto(`${PWA_URL}/login`)
    await page.fill('input[type="password"]', PWA_PASSWORD)
    await page.click('button[type="submit"]')
    await page.waitForURL(`${PWA_URL}/bots`, { timeout: 10_000 })

    const mmLink = page.locator('button, a', { hasText: /mattermost/i }).first()
    await expect(mmLink).toBeVisible()
  })

  test('bots page shows bot list', async ({ page }) => {
    await page.goto(`${PWA_URL}/login`)
    await page.fill('input[type="password"]', PWA_PASSWORD)
    await page.click('button[type="submit"]')
    await page.waitForURL(`${PWA_URL}/bots`, { timeout: 10_000 })

    // At least one bot card (coordinator) should appear
    await expect(page.locator('text=Coordinator').or(page.locator('[data-testid="bot-card"]')).first()).toBeVisible({
      timeout: 15_000,
    })
  })
})
