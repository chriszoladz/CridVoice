import { expect, test } from "@playwright/test";
import path from "node:path";
import { defaultSettings } from "../../src/types";

test("personal writing preferences save explicitly, reopen and clear without changing strength", async ({
  page,
}) => {
  await page.goto("/");
  await page.evaluate(
    (defaults) =>
      localStorage.setItem(
        "cridvoice-preview",
        JSON.stringify({ ...defaults, setupComplete: true }),
      ),
    defaultSettings,
  );
  await page.reload();
  await page
    .getByRole("button", { name: "Writing styles", exact: true })
    .click();
  const editor = page.getByRole("textbox", {
    name: /How should CridVoice write for you/,
  });
  const text =
    "Keep my slang, including bro. Don’t swap it for buddy. Use short paragraphs.";
  await editor.fill(text);
  await expect(
    page.getByText("Unsaved changes", { exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("cridvoice-preview")!).cleanup
          .writingPreferences,
    ),
  ).toBe("");
  await page
    .getByRole("combobox", { name: "Rewrite strength", exact: true })
    .selectOption("thorough");
  await expect(editor).toHaveValue(text);
  await page
    .getByRole("button", { name: "Save preferences", exact: true })
    .click();
  await expect(
    page.getByText("Preferences saved", { exact: true }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("cridvoice-preview")!).cleanup
            .writingPreferences,
      ),
    )
    .toBe(text);
  await page.getByRole("button", { name: "History", exact: true }).click();
  await page
    .getByRole("button", { name: "Writing styles", exact: true })
    .click();
  await expect(editor).toHaveValue(text);
  await expect(
    page.getByText(
      "This example uses default preferences. Your saved preferences apply to real dictation.",
      { exact: true },
    ),
  ).toBeVisible();
  await page.getByRole("button", { name: "Use defaults", exact: true }).click();
  await expect(editor).toHaveValue("");
  await expect(
    page.getByRole("combobox", { name: "Rewrite strength", exact: true }),
  ).toHaveValue("thorough");
  expect(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("cridvoice-preview")!).cleanup
          .writingPreferences,
    ),
  ).toBe("");
});

test("writing preferences remain readable at minimum width with large text in both themes", async ({
  page,
}) => {
  await page.setViewportSize({ width: 760, height: 1000 });
  await page.goto("/");
  for (const mode of ["dark", "light"] as const) {
    await page.evaluate(
      ({ defaults, mode }) =>
        localStorage.setItem(
          "cridvoice-preview",
          JSON.stringify({
            ...defaults,
            setupComplete: true,
            appearance: { ...defaults.appearance, mode, fontScale: 1.4 },
          }),
        ),
      { defaults: defaultSettings, mode },
    );
    await page.reload();
    await page
      .getByRole("button", { name: "Writing styles", exact: true })
      .click();
    const editor = page.getByRole("textbox", {
      name: /How should CridVoice write for you/,
    });
    await editor.fill(
      "Keep my own words and slang. Fix grammar without making me sound formal.",
    );
    await editor.scrollIntoViewIfNeeded();
    const layout = await page
      .locator(".writing-preferences")
      .evaluate((section) => {
        const textarea = section.querySelector("textarea")!;
        return {
          overflow: document.documentElement.scrollWidth > innerWidth,
          left: textarea.getBoundingClientRect().left,
          right: textarea.getBoundingClientRect().right,
          width: innerWidth,
          font: parseFloat(getComputedStyle(textarea).fontSize),
        };
      });
    expect(layout.overflow).toBe(false);
    expect(layout.left).toBeGreaterThanOrEqual(0);
    expect(layout.right).toBeLessThanOrEqual(layout.width);
    expect(layout.font).toBeGreaterThan(18);
    await expect(
      page.getByRole("button", { name: "Save preferences", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Use defaults", exact: true }),
    ).toBeVisible();
    await page
      .locator(".writing-preferences")
      .screenshot({
        path: path.resolve(
          `../validation/writing-preferences-0120-${mode}.png`,
        ),
        animations: "disabled",
      });
  }
});
