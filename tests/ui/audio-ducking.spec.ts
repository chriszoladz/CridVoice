import { test, expect } from "@playwright/test";
import path from "node:path";
import { defaultSettings } from "../../src/types";

test("optional background audio reduction persists across reopen and stays readable in a compact window", async ({
  page,
}) => {
  const settings = structuredClone(defaultSettings);
  settings.setupComplete = true;
  await page.addInitScript((initial) => {
    if (!localStorage.getItem("cridvoice-preview"))
      localStorage.setItem("cridvoice-preview", JSON.stringify(initial));
  }, settings);
  await page.setViewportSize({ width: 900, height: 640 });
  await page.goto("/");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const toggle = page.getByRole("switch", {
    name: "Lower background audio while speaking",
  });
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("cridvoice-preview")!).general
            .duckBackgroundAudio,
      ),
    )
    .toBe(true);
  await page.reload();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await toggle.scrollIntoViewIfNeeded();
  await expect(
    page.getByText(/Temporarily lower other apps by 25%/),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: path.resolve("../validation/background-audio-0.1.16-compact.png"),
  });
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("cridvoice-preview")!).general
            .duckBackgroundAudio,
      ),
    )
    .toBe(false);
});
