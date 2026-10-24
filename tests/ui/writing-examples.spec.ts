import { test, expect } from "@playwright/test";
import path from "node:path";
import { defaultSettings } from "../../src/types";
import { writingStyles } from "../../src/ui";
import { writingExample } from "../../src/writingExamples";

test("the selected writing style changes its local illustration and preserves the output mode", async ({
  page,
}) => {
  await page.goto("/");
  await page.evaluate((settings) => {
    localStorage.setItem(
      "cridvoice-preview",
      JSON.stringify({ ...settings, setupComplete: true }),
    );
    localStorage.removeItem("cridvoice-sidebar-collapsed");
  }, defaultSettings);
  await page.reload();
  await page
    .getByRole("button", { name: "Writing styles", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Dictation output", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Illustrative result. Exact AI wording may vary."),
  ).toBeVisible();
  for (const style of writingStyles) {
    await page
      .getByRole("combobox", { name: "Default writing style", exact: true })
      .selectOption(style.value);
    await expect(page.getByLabel("Writing style example output")).toHaveText(
      writingExample(style.value).output,
    );
    await expect(
      page.getByText(`Style example · ${style.label}`, { exact: true }),
    ).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(() => {
          const saved = JSON.parse(localStorage.getItem("cridvoice-preview")!);
          return { style: saved.cleanup.style, mode: saved.cleanup.outputMode };
        }),
      )
      .toEqual({ style: style.value, mode: "text" });
  }
  await page.reload();
  await page
    .getByRole("button", { name: "Writing styles", exact: true })
    .click();
  await expect(
    page.getByRole("combobox", { name: "Default writing style", exact: true }),
  ).toHaveValue("code");
  await expect(page.getByLabel("Writing style example output")).toHaveCSS(
    "white-space",
    "pre-wrap",
  );
  await expect(
    page.getByText(/Code & technical is a Text writing style/),
  ).toBeVisible();
  await page.screenshot({
    path: path.resolve("../validation/writing-style-example-0115.png"),
    fullPage: true,
    animations: "disabled",
  });
});
