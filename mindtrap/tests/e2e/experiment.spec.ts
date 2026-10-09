import { expect, test, type Page } from "@playwright/test";

const tiles = (page: Page) => page.locator("[data-row][data-col]");
const openTiles = (page: Page) => page.locator('[data-row][data-col]:not([disabled])');

async function enterChamber(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "כניסה לניסוי" }).click();
  await expect(page.getByRole("heading", { name: "התוצאה שלך נקבעה ונחתמה." })).toBeVisible();
  await page.getByRole("button", { name: "הצג חותמת מלאה" }).click();
  const hash = (await page.getByTestId("full-hash").textContent())!.trim();
  expect(hash).toMatch(/^[0-9a-f]{64}$/);
  await page.getByRole("button", { name: "אני מוכן לבחור" }).click();
  await expect(page.getByRole("heading", { name: "חדר הבחירה" })).toBeVisible();
  return hash;
}

async function pickAny(page: Page, n: number) {
  for (let i = 0; i < n; i++) await openTiles(page).last().click();
}

test("RTL document with no horizontal overflow", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.locator("html")).toHaveAttribute("lang", "he");
  await expect(page.getByRole("heading", { name: "אתה חושב שהבחירות שלך חופשיות?" })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test("full flow: seal, choose, reveal, verify, tamper, new session", async ({ page }) => {
  const hash = await enterChamber(page);

  await expect(tiles(page)).toHaveCount(16);
  await expect(openTiles(page)).toHaveCount(16);

  // Select 6 (row 2, col 2): its row and column lock.
  await page.getByRole("button", { name: /^תיק 6,/ }).click();
  await expect(openTiles(page)).toHaveCount(9);
  for (const v of [5, 7, 8, 2, 10, 14]) {
    await expect(page.getByRole("button", { name: new RegExp(`^תיק ${v},.*נעול`) })).toBeDisabled();
  }

  // Undo restores all 16.
  await page.getByRole("button", { name: "בטל בחירה" }).click();
  await expect(openTiles(page)).toHaveCount(16);

  // Restart clears progress.
  await pickAny(page, 2);
  await expect(openTiles(page)).toHaveCount(4);
  await page.getByRole("button", { name: "התחל מחדש" }).click();
  await expect(openTiles(page)).toHaveCount(16);
  await expect(page.locator('[data-state="selected"]')).toHaveCount(0);

  // Complete a game.
  await pickAny(page, 4);
  await expect(page.locator('[data-state="selected"]')).toHaveCount(4);
  await expect(openTiles(page)).toHaveCount(0);
  await page.getByRole("button", { name: "לחישוב התוצאה" }).click();

  await expect(page.getByTestId("user-total")).toHaveText("34");
  await page.getByRole("button", { name: "פתח את התחזית" }).click();

  await expect(page.getByRole("heading", { name: "לא הצלחת לשנות את התוצאה." })).toBeVisible();
  await expect(page.getByTestId("prediction")).toHaveText("34");
  await expect(page.getByTestId("reveal-total")).toHaveText("34");

  // Verify against the hash shown before the first selection.
  await page.getByRole("button", { name: "אמת את התחזית" }).click();
  await expect(page.getByTestId("original-hash")).toHaveText(hash);
  await page.getByRole("button", { name: "חשב מחדש והשווה" }).click();
  await expect(page.getByTestId("verify-result")).toHaveAttribute("data-ok", "true");

  // Tampering with the prediction fails.
  await page.getByLabel("התחזית שנחשפה").fill("35");
  await page.getByRole("button", { name: "חשב מחדש והשווה" }).click();
  await expect(page.getByTestId("verify-result")).toHaveAttribute("data-ok", "false");
  await page.getByRole("button", { name: "שחזר ערכים מקוריים" }).click();

  // Tampering with the nonce fails.
  const nonce = page.getByLabel("המפתח האקראי (nonce)");
  const original = await nonce.inputValue();
  await nonce.fill((original[0] === "a" ? "b" : "a") + original.slice(1));
  await page.getByRole("button", { name: "חשב מחדש והשווה" }).click();
  await expect(page.getByTestId("verify-result")).toHaveAttribute("data-ok", "false");

  // Try again → a clearly distinct new session.
  await page.getByRole("button", { name: "נסה שוב" }).click();
  await expect(page.getByText("סשן חדש:")).toBeVisible();
  await page.getByRole("button", { name: "הצג חותמת מלאה" }).click();
  const next = (await page.getByTestId("full-hash").textContent())!.trim();
  expect(next).not.toBe(hash);
});

test("share does not spoil the prediction", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.addInitScript(() => {
    // Force the clipboard fallback so the shared text can be inspected.
    Object.defineProperty(navigator, "share", { value: undefined });
  });
  await enterChamber(page);
  await pickAny(page, 4);
  await page.getByRole("button", { name: "לחישוב התוצאה" }).click();
  await page.getByRole("button", { name: "פתח את התחזית" }).click();
  await page.getByRole("button", { name: "שתף את MindTrap" }).click();
  await expect(page.getByText("הקישור והטקסט הועתקו")).toBeVisible();
  const shared = await page.evaluate(() => navigator.clipboard.readText());
  expect(shared).toContain("http");
  expect(shared).not.toContain("34");
});

test("keyboard-only play with reduced motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await page.getByRole("button", { name: "כניסה לניסוי" }).focus();
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "אני מוכן לבחור" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "חדר הבחירה" })).toBeFocused();

  // Tab into the grid, then use Enter + arrow keys.
  await openTiles(page).first().focus();
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press("Enter");
    if (i < 3) await page.keyboard.press("ArrowDown");
  }
  await expect(page.locator('[data-state="selected"]')).toHaveCount(4);
  await expect(page.getByRole("button", { name: "לחישוב התוצאה" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("user-total")).toHaveText("34");
  await page.getByRole("button", { name: "פתח את התחזית" }).press("Enter");
  await expect(page.getByTestId("reveal-total")).toHaveText("34");
});
