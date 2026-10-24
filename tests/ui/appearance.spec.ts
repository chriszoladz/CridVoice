import { test, expect } from "@playwright/test";
import path from "node:path";
import { colorContrast, resolveAppearance, themes } from "../../src/themes";
import { defaultSettings } from "../../src/types";

function rgb(hex: string) {
  return `rgb(${[1, 3, 5].map((position) => parseInt(hex.slice(position, position + 2), 16)).join(", ")})`;
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.evaluate((settings) => {
    localStorage.setItem(
      "cridvoice-preview",
      JSON.stringify({ ...settings, setupComplete: true }),
    );
    localStorage.removeItem("cridvoice-sidebar-collapsed");
  }, defaultSettings);
  await page.reload();
  await page.getByRole("button", { name: "Appearance", exact: true }).click();
});

test("all presets color the actual sidebar and panels in light and dark modes", async ({
  page,
}) => {
  for (const mode of ["light", "dark"] as const) {
    await page
      .getByRole("button", {
        name: mode === "light" ? "Light" : "Dark",
        exact: true,
      })
      .click();
    for (const preset of themes) {
      await page.getByRole("button", { name: new RegExp(preset.name) }).click();
      const palette = resolveAppearance(
        {
          ...defaultSettings.appearance,
          theme: preset.id,
          accent: preset.accent,
          mode,
        },
        false,
      ).variables;
      await expect(page.locator("html")).toHaveAttribute("data-mode", mode);
      await expect(page.locator("body")).toHaveCSS(
        "background-color",
        rgb(palette["--background"]),
      );
      await expect(page.locator(".sidebar")).toHaveCSS(
        "background-color",
        rgb(palette["--surface"]),
      );
      await expect(page.locator(".panel").first()).toHaveCSS(
        "background-color",
        rgb(palette["--surface"]),
      );
      await expect(page.locator(".panel").first()).toHaveCSS(
        "border-top-color",
        rgb(palette["--border"]),
      );
      await expect(
        page.getByRole("button", { name: new RegExp(preset.name) }),
      ).toHaveAttribute("aria-pressed", "true");
    }
    await page.screenshot({
      path: path.resolve(
        "../validation",
        `appearance-presets-${mode}-0115.png`,
      ),
      fullPage: true,
      animations: "disabled",
    });
  }
});

test("custom color and text size persist and keep primary buttons readable", async ({
  page,
}) => {
  await page.getByRole("button", { name: /Ocean/ }).click();
  for (const accent of ["#000000", "#ffffff", "#777777"]) {
    await page.getByLabel("Accent color").fill(accent);
    await page.getByRole("button", { name: "Overview", exact: true }).click();
    const primary = page.getByRole("button", {
      name: "Test dictation",
      exact: true,
    });
    const foreground = resolveAppearance(
      { ...defaultSettings.appearance, theme: "ocean", accent },
      false,
    ).variables["--accent-foreground"];
    expect(colorContrast(accent, foreground)).toBeGreaterThanOrEqual(4.5);
    await expect(primary).toHaveCSS("background-color", rgb(accent));
    await expect(primary).toHaveCSS("color", rgb(foreground));
    await primary.hover();
    const palette = resolveAppearance(
      { ...defaultSettings.appearance, theme: "ocean", accent },
      false,
    ).variables;
    await expect(primary).toHaveCSS(
      "background-color",
      rgb(palette["--surface-hover"]),
    );
    await expect(primary).toHaveCSS("color", rgb(palette["--text"]));
    expect(
      colorContrast(palette["--surface-hover"], palette["--text"]),
    ).toBeGreaterThanOrEqual(4.5);
    await expect(primary).toHaveCSS("box-shadow", "none");
    await page.getByRole("button", { name: "Appearance", exact: true }).click();
  }
  await page.getByLabel("Text size", { exact: true }).fill("1.3");
  await expect(page.locator("html")).toHaveCSS("font-size", "18.2px");
  await page.reload();
  await page.getByRole("button", { name: "Appearance", exact: true }).click();
  await expect(page.getByLabel("Accent color")).toHaveValue("#777777");
  await expect(page.getByLabel("Text size", { exact: true })).toHaveValue(
    "1.3",
  );
  await expect(page.getByRole("button", { name: /Ocean/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.locator("html")).toHaveCSS("font-size", "18.2px");
  await page.screenshot({
    path: path.resolve("../validation/appearance-custom-persisted-0115.png"),
    fullPage: true,
    animations: "disabled",
  });
});

test("System mode and preset previews react to the live color preference", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.getByRole("button", { name: "System", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-mode", "light");
  await expect(page.locator(".theme-preview").first()).toHaveCSS(
    "background-color",
    rgb(themes[0].light),
  );
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveAttribute("data-mode", "dark");
  await expect(page.locator(".theme-preview").first()).toHaveCSS(
    "background-color",
    rgb(themes[0].dark),
  );
  await expect(
    page.getByRole("button", { name: "System", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-mode", "dark");
  await page.getByRole("button", { name: "Appearance", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "System", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
});
