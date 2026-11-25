import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

let testDocumentId: string;
let testSessionCookie: string;

// The API server runs on its own port; the frontend proxies `/api/*` to it.
const apiBaseURL =
  process.env.PLAYWRIGHT_API_BASE_URL || 'http://localhost:3000';

const axeTags = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'];

// Numbered content ensures the upload test exercises real clause segmentation.
const accessibilityDocumentText = '1. Termination. Either party may end this agreement with thirty days written notice.';

test.beforeAll(async ({ playwright }) => {
  const apiContext = await playwright.request.newContext({
    baseURL: apiBaseURL,
  });

  const form = new FormData();
  form.append(
    'file',
    new Blob([accessibilityDocumentText], { type: 'text/plain' }),
    'accessibility-audit.txt',
  );

  const sessionResponse = await apiContext.get('/api/session');
  const { csrfToken } = await sessionResponse.json() as { csrfToken: string };
  const sessionCookieValue = /cc_session=([^;]+)/.exec(sessionResponse.headers()['set-cookie'] ?? '')?.[1];
  if (!sessionCookieValue) throw new Error('Could not extract test session cookie');
  testSessionCookie = decodeURIComponent(sessionCookieValue);

  const response = await apiContext.post('/api/documents/upload', {
    multipart: form,
    headers: { 'x-csrf-token': csrfToken },
  });

  if (!response.ok()) {
    const text = await response.text();
    throw new Error(
      `Failed to seed test document: ${response.status()} ${text}`,
    );
  }

  const data = await response.json();
  testDocumentId = data.id;

  if (!testDocumentId) {
    throw new Error(
      `Could not extract document ID from upload response: ${JSON.stringify(data)}`,
    );
  }

  await apiContext.dispose();
});

test.beforeEach(async ({ context }) => {
  await context.addCookies([{
    name: 'cc_session',
    value: testSessionCookie,
    url: 'http://localhost:4173',
    httpOnly: true,
    sameSite: 'Strict',
  }]);
});


test.describe('WCAG 2.2 AA accessibility checks', () => {
  test('1. document view has zero axe violations', async ({ page }) => {
    await page.goto(`/documents/${testDocumentId}`);
    await expect(page.getByTestId('text-document-name')).toBeVisible();

    const results = await new AxeBuilder({ page })
      .withTags(axeTags)
      .analyze();

    expect(results.violations).toEqual([]);
  });

  test('2. ask-the-document view has zero axe violations', async ({ page }) => {
    await page.goto(`/documents/${testDocumentId}`);
    await expect(
      page.getByRole('heading', { name: 'Ask from your side of the table' }),
    ).toBeVisible();

    const results = await new AxeBuilder({ page })
      .withTags(axeTags)
      .include('.cc-question-panel')
      .analyze();

    expect(results.violations).toEqual([]);
  });

  test('3. version diff view has zero axe violations', async ({ page }) => {
    await page.goto(`/documents/${testDocumentId}/compare`);
    await expect(page.getByTestId('text-compare-title')).toBeVisible();

    const results = await new AxeBuilder({ page })
      .withTags(axeTags)
      .analyze();

    expect(results.violations).toEqual([]);
  });

  test('4. base accessibility page has zero axe violations', async ({ page }) => {
    await page.goto('/accessibility');
    await expect(
      page.getByRole('heading', {
        name: 'A workspace that leaves room for people.',
      }),
    ).toBeVisible();

    const results = await new AxeBuilder({ page })
      .withTags(axeTags)
      .analyze();

    expect(results.violations).toEqual([]);
  });

  test('5. skip link focuses main content', async ({ page }) => {
    await page.goto(`/documents/${testDocumentId}`);
    await expect(page.getByTestId('text-document-name')).toBeVisible();

    await page.keyboard.press('Tab');
    const skipLink = page.locator('.cc-skip-link');
    await expect(skipLink).toBeFocused();

    await page.keyboard.press('Enter');
    await expect(page.locator('#main-content')).toBeFocused();
  });

  test('6. severity badges include explicit text and icon', async ({ page }) => {
    await page.goto(`/documents/${testDocumentId}`);
    const badge = page.locator('.cc-severity').first();
    await expect(badge).toBeVisible();

    // The icon is decorative, so the meaning has to survive without it.
    await expect(badge.locator('svg')).toHaveAttribute('aria-hidden', 'true');
    await expect(badge).toHaveText(/\b(low|medium|high) risk\b/i);
  });

  test('7. accessible form announces and focuses validation errors', async ({ page }) => {
    await page.goto('/accessibility');

    const emailInput = page.locator('#a11y-contact-email');
    await page.getByRole('button', { name: /submit/i }).click();

    const errorSummary = page.getByRole('alert');
    await expect(errorSummary).toBeFocused();
    await expect(errorSummary).toContainText(
      'Please enter a valid email address.',
    );
    await expect(emailInput).toHaveAttribute('aria-invalid', 'true');
    await expect(emailInput).toHaveAttribute('aria-describedby', /.+/);
  });
});

