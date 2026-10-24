import { expect, test } from "@playwright/test";
import path from "node:path";
import { defaultSettings } from "../../src/types";

test("processing header stays usable at minimum width and large text with real window controls", async ({
  page,
}) => {
  await page.setViewportSize({ width: 760, height: 900 });
  await page.addInitScript((defaults) => {
    const settings = structuredClone(defaults);
    settings.setupComplete = true;
    settings.appearance.fontScale = 1.4;
    settings.appearance.mode =
      new URLSearchParams(location.search).get("headerTheme") === "light"
        ? "light"
        : "dark";
    localStorage.setItem(
      "cridvoice-sidebar-collapsed",
      String(
        new URLSearchParams(location.search).get("headerCollapsed") === "1",
      ),
    );
    const snapshot = {
      settings,
      models: [
        ["whisper-turbo", "speech"],
        ["whisper-preview", "preview"],
        ["qwen3-4b", "cleanup"],
        ["llama-cpu", "runtime"],
      ].map(([id, kind]) => ({
        id,
        name: id,
        kind,
        description: "Installed synthetic fixture",
        sizeBytes: 1,
        license: "Fixture",
        files: [],
        installed: true,
      })),
      history: [],
      portable: true,
      version: "header-fixture",
      dataDir: "fixture",
      hardware: {
        cpu: "Fixture",
        threads: 4,
        ramGb: 16,
        gpus: [],
        cudaAvailable: false,
      },
    };
    const target = window as unknown as {
      isTauri: boolean;
      __TAURI_INTERNALS__: Record<string, unknown>;
      __TAURI_EVENT_PLUGIN_INTERNALS__: Record<string, unknown>;
    };
    target.isTauri = true;
    let callbackId = 0;
    target.__TAURI_INTERNALS__ = {
      metadata: {
        currentWindow: { label: "main" },
        currentWebview: { label: "main", windowLabel: "main" },
      },
      transformCallback: () => ++callbackId,
      unregisterCallback: () => {},
      async invoke(command: string, args: Record<string, unknown> = {}) {
        if (command === "get_snapshot") return structuredClone(snapshot);
        if (command === "plugin:event|listen") return args.handler;
        if (command === "plugin:window|is_maximized") return false;
        if (
          command === "microphone_devices" ||
          command === "running_applications"
        )
          return [];
      },
    };
    target.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
  }, defaultSettings);
  for (const theme of ["dark", "light"]) {
    for (const collapsed of ["0", "1"]) {
      await page.goto(`/?headerTheme=${theme}&headerCollapsed=${collapsed}`);
      await page
        .getByRole("button", { name: "Writing styles", exact: true })
        .click();
      const route = page.getByRole("button", {
        name: /Local processing\..*Open processing settings/,
      });
      await expect(route).toBeVisible();
      await expect(
        page.getByRole("status", { name: "Saved locally" }),
      ).toBeVisible();
      for (const label of [
        "Minimize window",
        "Maximize window",
        "Close window",
      ]) {
        await expect(
          page.getByRole("button", { name: label, exact: true }),
        ).toBeVisible();
      }
      const metrics = await page
        .locator(".window-titlebar")
        .evaluate((header) => {
          const route = header.querySelector(".processing-status-button")!;
          const controls = header.querySelector(".window-controls")!;
          const r = route.getBoundingClientRect(),
            c = controls.getBoundingClientRect();
          return {
            right: r.right,
            controlsLeft: c.left,
            controlsRight: c.right,
            viewport: innerWidth,
            overflow: document.documentElement.scrollWidth > innerWidth,
            font: parseFloat(getComputedStyle(route).fontSize),
            radius: getComputedStyle(route).borderRadius,
          };
        });
      expect(metrics.right).toBeLessThanOrEqual(metrics.controlsLeft);
      expect(metrics.controlsRight).toBeLessThanOrEqual(metrics.viewport);
      expect(metrics.overflow).toBe(false);
      expect(metrics.font).toBeGreaterThan(17);
      expect(metrics.radius).toBe("4px");
      await page.locator(".window-titlebar").screenshot({
        path: path.resolve(
          `../validation/header-0119-${theme}-${collapsed}.png`,
        ),
        animations: "disabled",
      });
      await route.click();
      await expect(
        page.getByRole("combobox", {
          name: "Transcription engine",
          exact: true,
        }),
      ).toBeFocused();
    }
  }
});
