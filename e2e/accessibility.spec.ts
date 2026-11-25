import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

let testDocumentId: string;
let testSessionCookie: string;

// The API server runs on its own port; the frontend proxies `/api/*` to it.
const apiBaseURL = process.env.PLAYWRIGHT_API_BASE_URL || "http://localhost:3000";

const axeTags = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"];

// Numbered content ensures the upload test exercises real clause segmentation.
const accessibilityDocumentText =
  "1. Termination. Either party may end this agreement with thirty days written notice.";

test.beforeAll(async ({ playwright }) => {
  const apiContext = await playwright.request.newContext({
    baseURL: apiBaseURL,
  });

  const form = new FormData();
  form.append(
    "file",
    new Blob([accessibilityDocumentText], { type: "text/plain" }),
    "accessibility-audit.txt",
  );

  const sessionResponse = await apiContext.get("/api/session");
  const { csrfToken } = (await sessionResponse.json()) as { csrfToken: string };
  const sessionCookieValue = /cc_session=([^;]+)/.exec(
    sessionResponse.headers()["set-cookie"] ?? "",
  )?.[1];
  if (!sessionCookieValue) throw new Error("Could not extract test session cookie");
  testSessionCookie = decodeURIComponent(sessionCookieValue);

  const response = await apiContext.post("/api/documents/upload", {
    multipart: form,
    headers: { "x-csrf-token": csrfToken },
  });

  if (!response.ok()) {
    const text = await response.text();
    throw new Error(`Failed to seed test document: ${response.status()} ${text}`);
  }

  const data = await response.json();
  testDocumentId = data.id;

  if (!testDocumentId) {
    throw new Error(`Could not extract document ID from upload response: ${JSON.stringify(data)}`);
  }

  await apiContext.dispose();
});

test.beforeEach(async ({ context }) => {
  await context.addCookies([
    {
      name: "cc_session",
      value: testSessionCookie,
      url: "http://localhost:4173",
      httpOnly: true,
      sameSite: "Strict",
    },
  ]);
});

test.describe("WCAG 2.2 AA accessibility checks", () => {
  test("1. document view has zero axe violations", async ({ page }) => {
    await page.goto(`/documents/${testDocumentId}`);
    await expect(page.getByTestId("text-document-name")).toBeVisible();

    const results = await new AxeBuilder({ page }).withTags(axeTags).analyze();

    expect(results.violations).toEqual([]);
  });

  test("2. ask-the-document view has zero axe violations", async ({ page }) => {
    await page.goto(`/documents/${testDocumentId}`);
    await expect(
      page.getByRole("heading", { name: "Ask from your side of the table" }),
    ).toBeVisible();

    const results = await new AxeBuilder({ page })
      .withTags(axeTags)
      .include(".cc-question-panel")
      .analyze();

    expect(results.violations).toEqual([]);
  });

  test("3. version diff view has zero axe violations", async ({ page }) => {
    await page.goto(`/documents/${testDocumentId}/compare`);
    await expect(page.getByTestId("text-compare-title")).toBeVisible();

    const results = await new AxeBuilder({ page }).withTags(axeTags).analyze();

    expect(results.violations).toEqual([]);
  });

  test("4. base accessibility page has zero axe violations", async ({ page }) => {
    await page.goto("/accessibility");
    await expect(
      page.getByRole("heading", {
        name: "A workspace that leaves room for people.",
      }),
    ).toBeVisible();

    const results = await new AxeBuilder({ page }).withTags(axeTags).analyze();

    expect(results.violations).toEqual([]);
  });

  test("5. skip link focuses main content", async ({ page }) => {
    await page.goto(`/documents/${testDocumentId}`);
    await expect(page.getByTestId("text-document-name")).toBeVisible();

    await page.keyboard.press("Tab");
    const skipLink = page.locator(".cc-skip-link");
    await expect(skipLink).toBeFocused();

    await page.keyboard.press("Enter");
    await expect(page.locator("#main-content")).toBeFocused();
  });

  test("6. severity badges include explicit text and icon", async ({ page }) => {
    await page.goto(`/documents/${testDocumentId}`);
    const badge = page.locator(".cc-severity").first();
    await expect(badge).toBeVisible();

    // The icon is decorative, so the meaning has to survive without it.
    await expect(badge.locator("svg")).toHaveAttribute("aria-hidden", "true");
    await expect(badge).toHaveText(/\b(low|medium|high) risk\b/i);
  });

  test("7. accessible form announces and focuses validation errors", async ({ page }) => {
    await page.goto("/accessibility");

    const emailInput = page.locator("#a11y-contact-email");
    await page.getByRole("button", { name: /submit/i }).click();

    const errorSummary = page.getByRole("alert");
    await expect(errorSummary).toBeFocused();
    await expect(errorSummary).toContainText("Please enter a valid email address.");
    await expect(emailInput).toHaveAttribute("aria-invalid", "true");
    await expect(emailInput).toHaveAttribute("aria-describedby", /.+/);
  });

  test("8. simplify panel has zero axe violations", async ({ page }) => {
    await page.goto(`/documents/${testDocumentId}`);
    await expect(page.getByTestId("text-document-name")).toBeVisible();
    await page.getByTestId("button-simplify-document").click();
    const simplifyPanel = page.getByTestId("simplify-response");
    await expect(simplifyPanel).toBeVisible({ timeout: 15000 });

    const results = await new AxeBuilder({ page })
      .withTags(axeTags)
      .include('[data-testid="simplify-response"]')
      .analyze();

    expect(results.violations).toEqual([]);
  });

  test("9. Lawyer Prep Brief page has zero axe violations", async ({ page }) => {
    await page.goto(`/documents/${testDocumentId}/brief`);
    await expect(page.getByRole("heading", { name: "Lawyer Prep Brief" })).toBeVisible();

    const results = await new AxeBuilder({ page }).withTags(axeTags).analyze();

    expect(results.violations).toEqual([]);
  });

  test("10. keyboard navigation reaches upload, simplify, compare, and ask controls", async ({
    page,
  }) => {
    async function tabUntilFocused(target: ReturnType<typeof page.getByTestId>) {
      for (let attempt = 0; attempt < 80; attempt += 1) {
        if (await target.evaluate((element) => element === document.activeElement)) return;
        await page.keyboard.press("Tab");
      }
      throw new Error("Keyboard navigation did not reach the expected control");
    }

    await page.goto("/");
    const uploadButton = page.getByTestId("button-upload-top");
    await tabUntilFocused(uploadButton);
    await expect(uploadButton).toBeFocused();

    await page.goto(`/documents/${testDocumentId}`);
    await expect(page.getByTestId("text-document-name")).toBeVisible();
    const simplifyButton = page.getByTestId("button-simplify-document");
    const compareButton = page.getByTestId("button-compare-versions");
    await tabUntilFocused(simplifyButton);
    await expect(simplifyButton).toBeFocused();
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await expect(compareButton).toBeFocused();
    const askInput = page.getByTestId("input-question");
    await tabUntilFocused(askInput);
    await expect(askInput).toBeFocused();
    await page.keyboard.type("What does the termination clause say?");
    const askButton = page.getByTestId("button-ask-question");
    await tabUntilFocused(askButton);
    await expect(askButton).toBeFocused();
  });

  test("11. reduced-motion preference minimizes button transitions", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    const duration = await page
      .getByTestId("button-upload-top")
      .evaluate((element) => getComputedStyle(element).transitionDuration);
    const longestTransitionMs = duration.split(",").reduce((longest, value) => {
      const trimmed = value.trim();
      const numericValue = Number.parseFloat(trimmed);
      const milliseconds = trimmed.endsWith("ms") ? numericValue : numericValue * 1000;
      return Math.max(longest, milliseconds);
    }, 0);

    expect(longestTransitionMs).toBeLessThanOrEqual(0.01);
  });

  test("12. primary buttons meet the 44 by 44 pixel target size", async ({ page }) => {
    await page.goto("/");
    const buttons = page.locator("main .cc-button-primary");
    const count = await buttons.count();
    expect(count).toBeGreaterThan(0);

    for (let index = 0; index < count; index += 1) {
      const box = await buttons.nth(index).boundingBox();
      expect(box, `primary button ${index} should have a rendered bounding box`).not.toBeNull();
      expect(box!.width, `primary button ${index} width`).toBeGreaterThanOrEqual(44);
      expect(box!.height, `primary button ${index} height`).toBeGreaterThanOrEqual(44);
    }
  });
});
