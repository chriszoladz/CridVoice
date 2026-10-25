import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import path from "node:path";
import { defaultSettings, emptySession } from "../../src/types";
import type { Session, Snapshot } from "../../src/types";

type OverlayFixture = {
  calls: string[];
  session(value: Session): void;
  appearance(value: Partial<Snapshot["settings"]["appearance"]>): void;
};
async function overlayBackend(page: Page) {
  const settings = structuredClone(defaultSettings);
  settings.setupComplete = true;
  settings.cleanup.mode = "off";
  settings.transcription.device = "cpu";
  const snapshot: Snapshot = {
    settings,
    session: { ...emptySession, status: "recording", level: 0.06 },
    history: [],
    hardware: {
      cpu: "Synthetic CPU",
      threads: 8,
      ramGb: 16,
      gpus: [],
      cudaAvailable: false,
    },
    models: [
      {
        id: "whisper-preview",
        name: "Whisper Tiny preview",
        kind: "preview",
        description: "Synthetic CPU preview",
        sizeBytes: 78203619,
        license: "MIT",
        files: [],
        installed: true,
      },

      {
        id: "whisper-turbo",
        name: "Synthetic installed speech",
        kind: "speech",
        description: "Synthetic fixture",
        sizeBytes: 0,
        license: "Synthetic",
        files: [],
        installed: true,
      },
    ],
    version: "test",
    portable: true,
    dataDir: "Synthetic fixture",
  };
  await page.addInitScript((snapshot) => {
    const target = window as unknown as {
      isTauri: boolean;
      __TAURI_INTERNALS__: Record<string, unknown>;
      __TAURI_EVENT_PLUGIN_INTERNALS__: Record<string, unknown>;
      __overlayFixture: OverlayFixture;
    };
    const callbacks = new Map<number, (event: unknown) => void>();
    const listeners = new Map<string, number[]>();
    let next = 1;
    const calls: string[] = [];
    const emit = (event: string, payload?: unknown) => {
      for (const id of listeners.get(event) || [])
        callbacks.get(id)?.({ event, payload });
    };
    target.isTauri = true;
    target.__TAURI_INTERNALS__ = {
      metadata: {
        currentWindow: { label: "overlay" },
        currentWebview: { label: "overlay", windowLabel: "overlay" },
      },
      transformCallback(callback: (event: unknown) => void) {
        const id = next++;
        callbacks.set(id, callback);
        return id;
      },
      unregisterCallback(id: number) {
        callbacks.delete(id);
      },
      async invoke(command: string, args: Record<string, unknown> = {}) {
        if (command === "plugin:event|listen") {
          const event = args.event as string;
          listeners.set(event, [
            ...(listeners.get(event) || []),
            args.handler as number,
          ]);
          return args.handler;
        }
        if (command === "plugin:event|unlisten") {
          const event = args.event as string;
          listeners.set(
            event,
            (listeners.get(event) || []).filter((id) => id !== args.eventId),
          );
          return;
        }
        calls.push(command);
        if (command === "get_snapshot") return structuredClone(snapshot);
      },
    };
    target.__TAURI_EVENT_PLUGIN_INTERNALS__ = {
      unregisterListener(_event: string, id: number) {
        callbacks.delete(id);
      },
    };
    target.__overlayFixture = {
      calls,
      session(value) {
        snapshot.session = structuredClone(value);
        emit("session", value);
      },
      appearance(value) {
        Object.assign(snapshot.settings.appearance, value);
        emit("settings-updated");
      },
    };
  }, snapshot);
  await page.setViewportSize({ width: 440, height: 148 });
  await page.goto("/?overlay=1");
  await expect(
    page.getByRole("status", { name: "Recording status" }),
  ).toHaveText("Recording");
}
async function appearance(
  page: Page,
  value: Partial<Snapshot["settings"]["appearance"]>,
) {
  await page.evaluate(
    (value) =>
      (
        window as unknown as { __overlayFixture: OverlayFixture }
      ).__overlayFixture.appearance(value),
    value,
  );
}
async function session(page: Page, value: Session) {
  await page.evaluate(
    (value) =>
      (
        window as unknown as { __overlayFixture: OverlayFixture }
      ).__overlayFixture.session(value),
    value,
  );
}
async function fits(page: Page) {
  const metrics = await page.evaluate(() => {
    const rect = document
      .querySelector(".recording-overlay")!
      .getBoundingClientRect();
    const hint = document
      .querySelector(".overlay-hint")!
      .getBoundingClientRect();
    return {
      width: document.documentElement.scrollWidth,
      height: document.documentElement.scrollHeight,
      top: rect.top,
      bottom: rect.bottom,
      right: rect.right,
      hintBottom: hint.bottom,
    };
  });
  expect(metrics.width).toBeLessThanOrEqual(440);
  expect(metrics.height).toBeLessThanOrEqual(148);
  expect(metrics.top).toBeGreaterThanOrEqual(0);
  expect(metrics.bottom).toBeLessThanOrEqual(148);
  expect(metrics.right).toBeLessThanOrEqual(440);
  expect(metrics.hintBottom).toBeLessThanOrEqual(metrics.bottom);
}

test("compact recording popup centers the label and waveform in both themes, including long preview and large text", async ({
  page,
}) => {
  await overlayBackend(page);
  const preview =
    "Synthetic long dictation stays available in the accessible preview. ".repeat(
      25,
    ) + "LATESTWORD";
  await session(page, {
    ...emptySession,
    status: "recording",
    level: 0.2,
    preview,
  });
  for (const mode of ["dark", "light"] as const) {
    await appearance(page, { mode });
    await expect(page.locator("html")).toHaveAttribute("data-mode", mode);
    await page
      .locator(`.brand-image-${mode}`)
      .evaluate((image) => (image as HTMLImageElement).decode());
    for (const fontScale of [1, 1.4]) {
      await appearance(page, { fontScale });
      await expect(page.locator("html")).toHaveCSS(
        "--font-scale",
        String(fontScale),
      );
      await fits(page);
      const status = await page
        .getByRole("status", { name: "Recording status" })
        .boundingBox();
      const waveform = await page.locator(".waveform").boundingBox();
      expect(
        Math.abs(
          status!.x + status!.width / 2 - waveform!.x - waveform!.width / 2,
        ),
      ).toBeLessThanOrEqual(1);
      expect(await page.getByLabel("Transcript preview").textContent()).toBe(
        preview,
      );
      await expect(page.getByLabel("Transcript preview")).toHaveAttribute(
        "aria-live",
        "off",
      );
      const tail = await page
        .getByLabel("Transcript preview")
        .evaluate((element) => {
          const node = element.querySelector("span")!.firstChild!;
          const length = node.textContent!.length;
          const range = document.createRange();
          range.setStart(node, length - "LATESTWORD".length);
          range.setEnd(node, length);
          const word = range.getBoundingClientRect();
          const viewport = element.getBoundingClientRect();
          return {
            top: word.top - viewport.top,
            bottom: word.bottom - viewport.top,
            height: viewport.height,
            lineHeight: parseFloat(getComputedStyle(element).lineHeight),
          };
        });
      expect(tail.top).toBeGreaterThanOrEqual(-1);
      expect(tail.bottom).toBeLessThanOrEqual(tail.height + 1);
      expect(Math.abs(tail.height - tail.lineHeight * 2)).toBeLessThanOrEqual(
        1,
      );
      const bounds = () =>
        page.evaluate(() => {
          const box = (selector: string) => {
            const rect = document
              .querySelector(selector)!
              .getBoundingClientRect();
            return { top: rect.top, height: rect.height };
          };
          return [
            box(".recording-overlay"),
            box(".overlay-top"),
            box(".waveform"),
            box(".overlay-preview"),
          ];
        });
      const fixed = await bounds();
      for (const revised of [
        "Meet on Tuesday",
        "Meet on Wednesday at 3",
        "Short",
        "",
        preview,
      ]) {
        await session(page, {
          ...emptySession,
          status: "recording",
          level: 0.2,
          preview: revised,
        });
        await expect(page.getByLabel("Transcript preview")).toHaveText(
          revised || "Waiting for recognized speech",
        );
        expect(await bounds()).toEqual(fixed);
      }
      if (fontScale === 1)
        await page.screenshot({
          path: path.resolve(
            `../validation/overlay-recording-${mode}-0115.png`,
          ),
          animations: "disabled",
        });
      if (fontScale === 1.4 && mode === "dark")
        await page.screenshot({
          path: path.resolve("../validation/overlay-large-text-0115.png"),
          animations: "disabled",
        });
    }
  }
});

test("Overview follows new recognized text only while the reader remains near the bottom", async ({
  page,
}) => {
  await overlayBackend(page);
  await page.setViewportSize({ width: 1200, height: 820 });
  await page.goto("/");
  const preview = page.locator(".live-preview");
  await expect(preview).toBeVisible();
  await expect(preview).toHaveAttribute("aria-live", "off");
  const text = "Synthetic provisional words stay available for review. ".repeat(
    100,
  );
  await session(page, { ...emptySession, status: "recording", preview: text });
  const gap = () =>
    preview.evaluate(
      (node) => node.scrollHeight - node.clientHeight - node.scrollTop,
    );
  await expect.poll(gap).toBeLessThanOrEqual(1);
  await preview.evaluate((node) => {
    node.scrollTop = 0;
    node.dispatchEvent(new Event("scroll"));
  });
  await session(page, {
    ...emptySession,
    status: "recording",
    preview: text + "New recognized words",
  });
  await expect(preview).toHaveJSProperty("scrollTop", 0);
  await preview.evaluate((node) => {
    node.scrollTop = node.scrollHeight - node.clientHeight - 4;
    node.dispatchEvent(new Event("scroll"));
  });
  const next = text + "A corrected latest phrase";
  await session(page, { ...emptySession, status: "recording", preview: next });
  await expect.poll(gap).toBeLessThanOrEqual(1);
  await preview.evaluate((node) => {
    node.scrollTop = 12;
  });
  await session(page, {
    ...emptySession,
    status: "recording",
    preview: next,
    level: 0.8,
  });
  await expect(preview).toHaveJSProperty("scrollTop", 12);
  await session(page, { ...emptySession, status: "idle" });
  await expect(preview).toHaveCount(0);
  await session(page, {
    ...emptySession,
    status: "recording",
    preview: "New take",
  });
  await expect(preview).toHaveText("New take");
  await page.screenshot({
    path: path.resolve("../validation/overview-live-preview-0115.png"),
  });
});

test("compact popup preserves preview-off and processing states with cancellation hints and no raw-result exposure", async ({
  page,
}) => {
  await overlayBackend(page);
  await appearance(page, { livePreview: false, waveform: false });
  await expect(page.getByLabel("Transcript preview")).toHaveCount(0);
  await expect(page.locator(".waveform")).toHaveCount(0);
  await fits(page);
  await page.screenshot({
    path: path.resolve("../validation/overlay-preview-off-0115.png"),
  });
  await appearance(page, { livePreview: true, waveform: true, fontScale: 1.4 });
  for (const [status, label] of [
    ["loading", "Loading models"],
    ["transcribing", "Transcribing"],
    ["cleaning", "Cleaning"],
    ["inserting", "Inserting"],
  ] as const) {
    await session(page, {
      ...emptySession,
      status,
      preview: "Synthetic transcript under processing.",
      result: "RAW RESULT NOT SHOWN",
    });
    await expect(
      page.getByRole("status", { name: "Recording status" }),
    ).toHaveText(label);
    await expect(
      page.getByText("Esc to cancel", { exact: true }),
    ).toBeVisible();
    await expect(page.getByText("RAW RESULT NOT SHOWN")).toHaveCount(0);
    await fits(page);
    if (status === "transcribing")
      await page.screenshot({
        path: path.resolve("../validation/overlay-processing-0115.png"),
        animations: "disabled",
      });
  }
  await session(page, {
    ...emptySession,
    status: "error",
    error: "Synthetic error ".repeat(30),
  });
  await expect(page.getByLabel("Recording error")).toContainText(
    "Synthetic error",
  );
  await fits(page);
  expect(
    await page.evaluate(() =>
      (
        window as unknown as { __overlayFixture: OverlayFixture }
      ).__overlayFixture.calls.filter((command) => command !== "get_snapshot"),
    ),
  ).toEqual([]);
});
