import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import path from "node:path";
import { defaultSettings } from "../../src/types";
import type { Settings } from "../../src/types";

async function preview(page: Page, mode: "dark" | "light" = "dark") {
  const settings = structuredClone(defaultSettings);
  settings.setupComplete = true;
  settings.appearance.mode = mode;
  settings.providers = [
    {
      id: "public-qol-fixture",
      name: "Synthetic server",
      protocol: "openai",
      baseUrl: "http://127.0.0.1:9/v1",
      model: "fixture-text-v1",
      sttModel: "fixture-speech-v1",
      hasKey: false,
    },
  ];
  await page.addInitScript((settings) => {
    if (!localStorage.getItem("cridvoice-preview"))
      localStorage.setItem("cridvoice-preview", JSON.stringify(settings));
  }, settings);
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
}

async function saved(page: Page): Promise<Settings> {
  return page.evaluate(() =>
    JSON.parse(localStorage.getItem("cridvoice-preview")!),
  );
}

async function capture(page: Page, name: string, keys: string) {
  await page.getByRole("button", { name, exact: true }).click();
  const dialog = page.getByRole("dialog", { name, exact: true });
  await expect(
    dialog.getByText("Press your keys", { exact: true }),
  ).toBeVisible();
  await page.keyboard.press(keys);
  return dialog;
}

async function screenshot(page: Page, name: string) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(
      Array.from(document.images).map((image) =>
        image.decode().catch(() => {}),
      ),
    );
  });
  await expect(
    page.locator(".brand img").filter({ visible: true }).first(),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: path.resolve(`../validation/qol-0.1.15-${name}.png`),
    animations: "disabled",
    fullPage: (await page.getByRole("dialog").count()) === 0,
  });
}

test("press capture persists a new binding, rejects conflicts and cancels without changing settings", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1200, height: 820 });
  await preview(page);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page
    .getByRole("navigation", { name: "Settings sections" })
    .getByRole("button", { name: "Shortcuts", exact: true })
    .click();
  const first = await capture(page, "Change hold to dictate", "Control+h");
  await expect(
    first.getByText("Shortcut captured", { exact: true }),
  ).toBeVisible();
  await expect(
    first.getByRole("button", { name: "Save shortcut" }),
  ).toBeEnabled();
  await screenshot(page, "capture-dark");
  await first.getByRole("button", { name: "Save shortcut" }).click();
  await expect(first).not.toBeVisible();
  await expect
    .poll(async () => (await saved(page)).shortcuts.hold)
    .toBe("Ctrl+H");
  await page.reload();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page
    .getByRole("navigation", { name: "Settings sections" })
    .getByRole("button", { name: "Shortcuts", exact: true })
    .click();
  const conflict = await capture(page, "Change toggle dictation", "Control+h");
  await expect(conflict.getByRole("alert")).toContainText(
    "different shortcuts",
  );
  await expect(
    conflict.getByRole("button", { name: "Save shortcut" }),
  ).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(conflict).not.toBeVisible();
  expect((await saved(page)).shortcuts.toggle).toBe(
    defaultSettings.shortcuts.toggle,
  );
  await page
    .getByRole("button", { name: "Change hold to dictate", exact: true })
    .click();
  const cancelled = page.getByRole("dialog", {
    name: "Change hold to dictate",
  });
  await expect(
    cancelled.getByText("Press your keys", { exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(cancelled).not.toBeVisible();
  expect((await saved(page)).shortcuts.hold).toBe("Ctrl+H");
  await screenshot(page, "settings-dark");
});

test("settings keywords, no-result feedback and section jumps stay accessible at the minimum size", async ({
  page,
}) => {
  await page.setViewportSize({ width: 900, height: 640 });
  await preview(page, "light");
  for (const query of ["keybind", "microphone"]) {
    await page.keyboard.press("Control+k");
    const search = page.getByRole("dialog", { name: "Find a page" });
    await search.getByRole("textbox", { name: "Find a page" }).fill(query);
    await expect(
      search.getByRole("button", { name: /^Settings/ }),
    ).toBeVisible();
    await search.getByRole("button", { name: /^Settings/ }).click();
    await expect(search).not.toBeVisible();
  }
  await page.keyboard.press("Control+k");
  const search = page.getByRole("dialog", { name: "Find a page" });
  await search
    .getByRole("textbox", { name: "Find a page" })
    .fill("zzzz-unmatched-fixture");
  await expect(search.getByRole("status")).toContainText("No matching page");
  await page.keyboard.press("Escape");
  const jumps = page.getByRole("navigation", { name: "Settings sections" });
  await jumps.getByRole("button", { name: "Privacy", exact: true }).click();
  await expect(
    page.getByRole("switch", { name: "Save transcript history", exact: true }),
  ).toBeFocused();
  await jumps.getByRole("button", { name: "Speech", exact: true }).click();
  await expect(
    page.getByRole("combobox", { name: "Transcription engine" }),
  ).toBeFocused();
  await expect
    .poll(async () => {
      const heading = await page
        .locator("#settings-speech")
        .getByRole("heading", { name: "Speech recognition", exact: true })
        .boundingBox();
      const topbar = await page.locator(".topbar").boundingBox();
      return heading!.y - (topbar!.y + topbar!.height);
    })
    .toBeGreaterThanOrEqual(0);
  await screenshot(page, "settings-light-narrow");
  await jumps.getByRole("button", { name: "Shortcuts", exact: true }).click();
  const dialog = await capture(
    page,
    "Change rewrite selected text",
    "Control+Shift+j",
  );
  await expect(
    dialog.getByRole("button", { name: "Save shortcut" }),
  ).toBeEnabled();
  const bounds = await dialog.boundingBox();
  expect(bounds!.y).toBeGreaterThanOrEqual(0);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(640);
  await screenshot(page, "capture-light-narrow");
  await page.keyboard.press("Escape");
});

test("application rules and language choices can be picked, edited and saved while custom names remain available", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1200, height: 820 });
  await preview(page, "light");
  await page
    .getByRole("button", { name: "Writing styles", exact: true })
    .click();
  await page
    .getByRole("combobox", { name: "Code language or shell" })
    .selectOption("preset:PowerShell");
  await expect
    .poll(async () => (await saved(page)).cleanup.codeLanguage)
    .toBe("PowerShell");
  await expect(
    page.getByRole("textbox", { name: "Language or shell override" }),
  ).toHaveCount(0);
  await page
    .getByRole("combobox", { name: "Application", exact: true })
    .selectOption("app:outlook");
  await page
    .getByRole("combobox", { name: "Application style", exact: true })
    .selectOption("casual");
  await page
    .getByRole("textbox", { name: "Extra guidance for this app · optional" })
    .fill("Use short paragraphs.");
  await page
    .getByRole("button", { name: "Add application rule", exact: true })
    .click();
  await expect.poll(async () => (await saved(page)).appRules.length).toBe(1);
  await page
    .getByRole("button", { name: "Edit outlook rule", exact: true })
    .click();
  await expect(
    page.getByRole("combobox", { name: "Application", exact: true }),
  ).toHaveValue("app:outlook");
  await expect(
    page.getByRole("textbox", { name: "Extra guidance for this app · optional" }),
  ).toHaveValue("Use short paragraphs.");
  await page
    .getByRole("combobox", { name: "Application style", exact: true })
    .selectOption("concise");
  await page
    .getByRole("button", { name: "Save application rule", exact: true })
    .click();
  await expect
    .poll(async () => (await saved(page)).appRules[0].style)
    .toBe("concise");
  expect((await saved(page)).appRules).toHaveLength(1);
  await page
    .getByRole("combobox", { name: "Application", exact: true })
    .selectOption("custom");
  await page
    .getByRole("textbox", { name: "Executable name", exact: true })
    .fill("my-custom-editor");
  await page
    .getByRole("button", { name: "Add application rule", exact: true })
    .click();
  await expect.poll(async () => (await saved(page)).appRules.length).toBe(2);
  await page
    .getByRole("button", { name: "Edit my-custom-editor rule", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Executable name", exact: true }),
  ).toHaveValue("my-custom-editor");
  await screenshot(page, "application-picker-light");
  await page
    .getByRole("combobox", { name: "Code language or shell" })
    .selectOption("manual");
  await page
    .getByRole("textbox", { name: "Language or shell override" })
    .fill("Nushell / public DSL");
  await page
    .getByRole("textbox", { name: "Language or shell override" })
    .press("Enter");
  await expect
    .poll(async () => (await saved(page)).cleanup.codeLanguage)
    .toBe("Nushell / public DSL");
  await page
    .getByRole("combobox", { name: "Code language or shell" })
    .selectOption("auto");
  await expect
    .poll(async () => (await saved(page)).cleanup.codeLanguage)
    .toBe("");
});

test("provider model controls preserve current IDs and permit custom values without making a network request", async ({
  page,
}) => {
  await page.setViewportSize({ width: 900, height: 640 });
  await preview(page);
  let requests = 0;
  await page.route("http://127.0.0.1:9/**", async (route) => {
    requests += 1;
    await route.abort();
  });
  await page.getByRole("button", { name: "AI providers", exact: true }).click();
  await page
    .locator(".list-row")
    .filter({ hasText: "Synthetic server" })
    .getByRole("button", { name: "Edit", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Edit provider",
    exact: true,
  });
  await expect(
    dialog.getByRole("combobox", { name: "Text model ID" }),
  ).toHaveValue("model:fixture-text-v1");
  await expect(
    dialog.getByRole("textbox", { name: "Custom text model id" }),
  ).toHaveCount(0);
  await dialog
    .getByRole("button", { name: "Fetch models", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toContainText(
    "Could not fetch models",
  );
  await expect(
    dialog.getByRole("combobox", { name: "Text model ID" }),
  ).toHaveValue("model:fixture-text-v1");
  await dialog
    .getByRole("combobox", { name: "Text model ID" })
    .selectOption("custom");
  await dialog
    .getByRole("textbox", { name: "Custom text model id" })
    .fill("public/custom-text-v2");
  await dialog
    .getByRole("combobox", { name: "Speech model ID" })
    .selectOption("custom");
  await dialog
    .getByRole("textbox", { name: "Custom speech model id" })
    .fill("public/custom-speech-v2");
  await dialog.evaluate((element) => {
    element.scrollTop = 0;
  });
  await expect(
    dialog.getByRole("heading", { name: "Edit provider" }),
  ).toBeInViewport();
  await screenshot(page, "provider-picker-top-dark-narrow");
  await dialog
    .getByRole("button", { name: "Save connection", exact: true })
    .scrollIntoViewIfNeeded();
  await expect(
    dialog.getByRole("button", { name: "Save connection", exact: true }),
  ).toBeInViewport();
  await screenshot(page, "provider-picker-dark-narrow");
  await dialog
    .getByRole("button", { name: "Save connection", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  await expect
    .poll(async () => (await saved(page)).providers[0].model)
    .toBe("public/custom-text-v2");
  expect((await saved(page)).providers[0].sttModel).toBe(
    "public/custom-speech-v2",
  );
  expect(requests).toBe(0);
});
