import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import path from "node:path";
import appPackage from "../../package.json" with { type: "json" };
import { defaultSettings, emptySession } from "../../src/types";
import type { Session, Snapshot } from "../../src/types";
import { colorContrast } from "../../src/themes";

test("setup remains incomplete if encrypted credential storage fails", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Connect a provider/ }).click();
  const key = "test-only-setup-key";
  await page.getByLabel(/^API key/).fill(key);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Setup speech engine" })
    .selectOption("openai");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: "Finish setup", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "Set up CridVoice" }).getByRole("alert"),
  ).toContainText("Windows desktop app");
  await expect(
    page.getByRole("dialog", { name: "Set up CridVoice" }),
  ).toBeVisible();
  const saved = await page.evaluate(() =>
    localStorage.getItem("cridvoice-preview")!,
  );
  expect(saved).not.toContain(key);
  expect(JSON.parse(saved).setupComplete).toBe(false);
});
test("browser preview exposes local requirements and cannot claim managed setup is installed", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("dialog", { name: "Set up CridVoice" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();
  await page
    .getByRole("combobox", { name: "Setup language" })
    .selectOption("pl");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("switch", { name: "Launch at Windows startup" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(
    page.getByRole("region", { name: "Required local components" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "Open desktop to complete setup",
      exact: true,
    }),
  ).toBeDisabled();
  await expect(page.getByText(/Windows desktop app/i).last()).toBeVisible();
  await expect(
    page.getByRole("dialog", { name: "Set up CridVoice" }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => localStorage.getItem("cridvoice-preview")),
  ).toBeNull();
});

type ScriptedSetup = {
  calls: { command: string; args: Record<string, unknown> }[];
  progress: (id: string, state: string) => void;
  complete: (id: string) => void;
  fail: (id: string) => void;
  snapshot: Snapshot;
  session: (value: Session) => void;
  copied?: string;
};

async function nativeSetupBackend(page: Page, ready = false) {
  const snapshot: Snapshot = {
    settings: structuredClone(defaultSettings),
    history: [],
    hardware: {
      cpu: "Scripted test CPU",
      threads: 8,
      ramGb: 32,
      cudaAvailable: true,
      gpus: [{ name: "Scripted NVIDIA GPU", vramMb: 16384 }],
    },
    models: [
      {
        id: "whisper-preview",
        name: "Whisper Tiny preview",
        kind: "preview",
        installed: true,
      },
      {
        id: "whisper-turbo",
        name: "Whisper Turbo",
        kind: "speech",
        installed: true,
      },
      {
        id: "nvidia-runtime",
        name: "NVIDIA speech runtime",
        kind: "runtime",
        installed: true,
      },
      { id: "qwen3-4b", name: "Qwen3 4B", kind: "cleanup", installed: false },
      {
        id: "llama-gpu",
        name: "llama.cpp GPU runtime",
        kind: "runtime",
        installed: false,
      },
    ].map((asset) => ({
      ...asset,
      kind: asset.kind as Snapshot["models"][number]["kind"],
      description: "Scripted asset",
      sizeBytes: 100 * 1024 * 1024,
      license: "Test",
      files: [],
    })),
    engineStatus: {
      preview: { modelId: "whisper-preview", device: "cpu", state: "loaded" },
      speech: { modelId: null, device: null, state: "unloaded" },
      cleanup: { modelId: null, device: null, state: "unloaded" },
    },
    version: appPackage.version,
    portable: true,
    dataDir: "Scripted test data",
  };
  if (ready) {
    snapshot.settings.setupComplete = true;
    snapshot.models.forEach((model) => {
      model.installed = true;
    });
    snapshot.engineStatus = {
      preview: { modelId: "whisper-preview", device: "cpu", state: "loaded" },
      speech: { modelId: "whisper-turbo", device: "cuda", state: "loaded" },
      cleanup: { modelId: "qwen3-4b", device: "vulkan", state: "loaded" },
    };
    snapshot.history = [1, 2, 3].map((id) => ({
      id: String(id),
      createdAt: "2026-10-13T12:00:00Z",
      rawText: "Synthetic saved transcript",
      text: `Synthetic saved transcript ${id}`,
      app: "Test editor",
      language: "en",
      durationSeconds: 3,
      wordCount: 4,
      mode: "dictation",
      inserted: false,
    }));
  }
  await page.addInitScript((snapshot) => {
    const target = window as unknown as {
      isTauri: boolean;
      __TAURI_INTERNALS__: Record<string, unknown>;
      __TAURI_EVENT_PLUGIN_INTERNALS__: Record<string, unknown>;
      __cridSetup: ScriptedSetup;
    };
    const callbacks = new Map<number, (event: unknown) => void>();
    const listeners = new Map<string, number[]>();
    const pending = new Map<
      string,
      { resolve: () => void; reject: (message: string) => void }
    >();
    const calls: ScriptedSetup["calls"] = [];
    let nextCallback = 1;
    let maximized = false;
    function send(event: string, payload?: unknown) {
      for (const id of listeners.get(event) || [])
        callbacks.get(id)?.({ event, payload });
    }
    target.isTauri = true;
    target.__TAURI_INTERNALS__ = {
      metadata: {
        currentWindow: { label: "main" },
        currentWebview: { label: "main", windowLabel: "main" },
      },
      transformCallback(callback: (event: unknown) => void) {
        const id = nextCallback++;
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
        calls.push({ command, args: structuredClone(args) });
        if (command === "plugin:window|is_maximized") return maximized;
        if (command === "plugin:window|toggle_maximize") {
          maximized = !maximized;
          send("tauri://resize", {
            width: maximized ? 1920 : 1440,
            height: maximized ? 1080 : 1000,
          });
          return;
        }
        if (command === "get_snapshot") return structuredClone(snapshot);
        if (command === "save_settings" || command === "complete_setup") {
          snapshot.settings = structuredClone(
            args.settings as Snapshot["settings"],
          );
          send("settings-updated");
          return;
        }
        if (command === "download_model")
          return new Promise<void>((resolve, reject) =>
            pending.set(args.id as string, { resolve, reject }),
          );
      },
    };
    target.__TAURI_EVENT_PLUGIN_INTERNALS__ = {
      unregisterListener(_event: string, id: number) {
        callbacks.delete(id);
      },
    };
    target.__cridSetup = {
      calls,
      snapshot,
      session(value) {
        snapshot.session = structuredClone(value);
        send("session", value);
      },
      progress(id, state) {
        const total = snapshot.models.find(
          (model) => model.id === id,
        )!.sizeBytes;
        send("download", {
          id,
          state,
          completed: state === "downloading" ? total / 2 : total,
          total,
        });
      },
      complete(id) {
        const model = snapshot.models.find((model) => model.id === id)!;
        model.installed = true;
        send("download", {
          id,
          state: "complete",
          completed: model.sizeBytes,
          total: model.sizeBytes,
        });
        send("models-updated");
        pending.get(id)!.resolve();
      },
      fail(id) {
        send("download", {
          id,
          state: "error",
          completed: 0,
          total: snapshot.models.find((model) => model.id === id)!.sizeBytes,
          error: "Scripted runtime download failure.",
        });
        pending.get(id)!.reject("Scripted runtime download failure.");
      },
    };
  }, snapshot);
}

test("desktop wizard shows required cleanup downloads, progress and retry through real bridge event handlers", async ({
  page,
}) => {
  await nativeSetupBackend(page);
  await page.goto("/");
  for (let i = 0; i < 3; i++)
    await page.getByRole("button", { name: "Continue", exact: true }).click();
  const required = page.getByRole("region", {
    name: "Required local components",
  });
  await expect(required.getByText("Qwen3 4B", { exact: true })).toBeVisible();
  await expect(
    required.getByText("llama.cpp GPU runtime", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", {
      name: "Install required components & finish",
      exact: true,
    })
    .click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as unknown as { __cridSetup: ScriptedSetup }).__cridSetup.calls
          .filter((call) => call.command === "download_model")
          .map((call) => call.args.id),
      ),
    )
    .toEqual(["qwen3-4b"]);
  await page.evaluate(() =>
    (window as unknown as { __cridSetup: ScriptedSetup }).__cridSetup.progress(
      "qwen3-4b",
      "downloading",
    ),
  );
  await expect(
    page.getByRole("status", { name: "Qwen3 4B setup status" }),
  ).toContainText("Downloading");
  await page.mouse.move(1400, 990);
  await page.screenshot({
    path: path.resolve("../validation/redesign-wizard-progress-dark-0115.png"),
    animations: "disabled",
  });
  await page.evaluate(() =>
    (window as unknown as { __cridSetup: ScriptedSetup }).__cridSetup.progress(
      "qwen3-4b",
      "verifying",
    ),
  );
  await expect(
    page.getByRole("status", { name: "Qwen3 4B setup status" }),
  ).toContainText("Verifying");
  await page.evaluate(() =>
    (window as unknown as { __cridSetup: ScriptedSetup }).__cridSetup.complete(
      "qwen3-4b",
    ),
  );
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as unknown as { __cridSetup: ScriptedSetup }).__cridSetup.calls
          .filter((call) => call.command === "download_model")
          .map((call) => call.args.id),
      ),
    )
    .toEqual(["qwen3-4b", "llama-gpu"]);
  await page.evaluate(() =>
    (window as unknown as { __cridSetup: ScriptedSetup }).__cridSetup.progress(
      "llama-gpu",
      "extracting",
    ),
  );
  await expect(
    page.getByRole("status", { name: "llama.cpp GPU runtime setup status" }),
  ).toContainText("Extracting");
  await page.setViewportSize({ width: 900, height: 640 });
  await page.mouse.move(890, 630);
  await expect(
    page.getByRole("status", { name: "Overall setup status" }),
  ).toContainText("Extracting llama.cpp GPU runtime");
  expect(
    await page
      .getByRole("status", { name: "Overall setup status" })
      .evaluate((progress) => progress.getBoundingClientRect().bottom),
  ).toBeLessThanOrEqual(
    await page
      .locator(".setup-footer")
      .evaluate((footer) => footer.getBoundingClientRect().top),
  );
  expect(
    await page
      .locator(".setup-footer")
      .evaluate((footer) => footer.getBoundingClientRect().bottom),
  ).toBeLessThanOrEqual(640);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(900);
  await page.screenshot({
    path: path.resolve("../validation/redesign-wizard-progress-min-0115.png"),
    animations: "disabled",
  });
  expect(
    await page.evaluate(() =>
      (
        window as unknown as { __cridSetup: ScriptedSetup }
      ).__cridSetup.calls.some((call) => call.command === "save_settings"),
    ),
  ).toBe(false);
  await page.evaluate(() =>
    (window as unknown as { __cridSetup: ScriptedSetup }).__cridSetup.fail(
      "llama-gpu",
    ),
  );
  await page.getByRole("button", { name: "Retry setup", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as unknown as { __cridSetup: ScriptedSetup }).__cridSetup.calls
          .filter((call) => call.command === "download_model")
          .map((call) => call.args.id),
      ),
    )
    .toEqual(["qwen3-4b", "llama-gpu", "llama-gpu"]);
  await page.evaluate(() =>
    (window as unknown as { __cridSetup: ScriptedSetup }).__cridSetup.complete(
      "llama-gpu",
    ),
  );
  await expect(
    page.getByRole("dialog", { name: "Set up CridVoice" }),
  ).not.toBeVisible();
  await expect(
    page.getByRole("status", { name: "Dictation status" }),
  ).toContainText("Ready");
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { __cridSetup: ScriptedSetup }).__cridSetup
          .snapshot.settings.setupComplete,
    ),
  ).toBe(true);
  const maximize = page.getByRole("button", {
    name: "Maximize window",
    exact: true,
  });
  await maximize.focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("button", { name: "Restore window", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Restore window", exact: true })
    .click();
  await expect(maximize).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("button", { name: "Dismiss notification" }).click();
  await page.mouse.move(1400, 990);
  await expect(
    page.getByRole("button", { name: "Test dictation", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Overview", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await page.screenshot({
    path: path.resolve("../validation/redesign-overview-dark-0115.png"),
  });
  const outputMode = page.getByLabel("Output mode");
  const codeLanguage = page.getByLabel("Language or shell override");
  await expect(outputMode).toHaveValue("text");
  await outputMode.selectOption("code");
  await expect(outputMode).toBeEnabled();
  await page.getByLabel("Code language or shell").selectOption("manual");
  await codeLanguage.fill("PowerShell");
  await codeLanguage.blur();
  await expect(outputMode).toBeEnabled();
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { __cridSetup: ScriptedSetup }).__cridSetup
          .snapshot.settings.cleanup,
    ),
  ).toMatchObject({
    outputMode: "code",
    codeLanguage: "PowerShell",
    style: "faithful",
  });
  const literal: Session = {
    ...emptySession,
    outputMode: "code",
    codingLanguage: "PowerShell",
    reviewRequired: false,
    result: "git switch --create feature-name\n",
  };
  await page.evaluate(
    (value) =>
      (window as unknown as { __cridSetup: ScriptedSetup }).__cridSetup.session(
        value,
      ),
    literal,
  );
  await expect(page.getByLabel("Code or command output")).toHaveText(
    literal.result,
  );
  await page.screenshot({
    path: path.resolve("../validation/coding-dictation-preview-0115.png"),
  });
  await page.getByLabel("Code language or shell").selectOption("preset:Python");
  await expect(outputMode).toBeEnabled();
  await outputMode.selectOption("generate");
  await expect(outputMode).toBeEnabled();
  await page
    .getByRole("button", { name: "Writing styles", exact: true })
    .click();
  await expect(page.getByLabel("Output mode")).toHaveValue("generate");
  await expect(page.getByLabel("Code language or shell")).toHaveValue(
    "preset:Python",
  );
  const recording: Session = {
    ...emptySession,
    status: "recording",
    outputMode: "generate",
    codingLanguage: "Python",
  };
  await page.evaluate(
    (value) =>
      (window as unknown as { __cridSetup: ScriptedSetup }).__cridSetup.session(
        value,
      ),
    recording,
  );
  await expect(page.getByLabel("Output mode")).toBeDisabled();
  const generated: Session = {
    ...emptySession,
    outputMode: "generate",
    codingLanguage: "Python",
    reviewRequired: true,
    result: "def greet(name):\n    return f'Hello {name}'\n",
  };
  await page.evaluate(
    (value) =>
      (window as unknown as { __cridSetup: ScriptedSetup }).__cridSetup.session(
        value,
      ),
    generated,
  );
  await expect(
    page.getByRole("button", { name: "Overview", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  expect(await page.getByLabel("Code or command output").textContent()).toBe(
    generated.result,
  );
  await expect(
    page.getByText("Generated output opens here for review and copying.", {
      exact: true,
    }),
  ).toBeVisible();
  await page.screenshot({
    path: path.resolve("../validation/coding-generation-preview-0115.png"),
  });
  await page.evaluate(() =>
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (value: string) => {
          (
            window as unknown as { __cridSetup: ScriptedSetup }
          ).__cridSetup.copied = value;
        },
      },
    }),
  );
  await page.getByRole("button", { name: "Copy", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { __cridSetup: ScriptedSetup }).__cridSetup
            .copied,
      ),
    )
    .toBe(generated.result);
  await outputMode.selectOption("text");
  await expect(outputMode).toBeEnabled();
  await page.getByLabel("Code language or shell").selectOption("auto");
  await expect(outputMode).toBeEnabled();
  await page.evaluate(
    (value) =>
      (window as unknown as { __cridSetup: ScriptedSetup }).__cridSetup.session(
        value,
      ),
    emptySession,
  );
  const notice = page.getByRole("button", { name: "Dismiss notification" });
  if (await notice.isVisible()) await notice.click();
  await page.evaluate(() => window.scrollTo(0, 0));
  for (const [label, file] of [
    ["Local models", "redesign-models-dark-0115.png"],
    ["Settings", "redesign-settings-dark-0115.png"],
    ["AI providers", "redesign-providers-dark-0115.png"],
  ]) {
    await page.getByRole("button", { name: label, exact: true }).click();
    await page.mouse.move(1400, 990);
    await page.screenshot({
      path: path.resolve("../validation", file),
      animations: "disabled",
    });
    if (label === "Settings") {
      const hint = page.getByText(
        "Clipboard paste restores previous contents when safe. If a clipboard format cannot be preserved, CridVoice automatically uses Unicode typing. Unicode typing leaves the clipboard untouched.",
      );
      await expect(hint).toBeVisible();
      await hint.scrollIntoViewIfNeeded();
      await page.screenshot({
        path: path.resolve("../validation/settings-insertion-hint-0115.png"),
        animations: "disabled",
      });
    }
  }
  await page.getByRole("button", { name: "Appearance", exact: true }).click();
  await page.getByRole("button", { name: "Light", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-mode", "light");
  await page.getByRole("button", { name: "Overview", exact: true }).click();
  await page.mouse.move(1400, 990);
  await page.waitForTimeout(200); // Let the theme color transition finish before visual capture.
  await expect(
    page.getByRole("button", { name: "Test dictation", exact: true }),
  ).toHaveCSS("color", "rgb(21, 16, 31)");
  await expect(
    page.getByRole("button", { name: "Test dictation", exact: true }),
  ).toHaveCSS("filter", "none");
  await page
    .getByRole("button", { name: "Test dictation", exact: true })
    .hover();
  await page.mouse.move(1400, 990);
  await page
    .getByRole("button", { name: "Test dictation", exact: true })
    .screenshot({
      path: path.resolve(
        "../validation/redesign-primary-button-light-0115.png",
      ),
    });
  // Refresh the viewport before the full-frame capture after a theme switch.
  await page.setViewportSize({ width: 1439, height: 1000 });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({
    path: path.resolve("../validation/redesign-overview-light-0115.png"),
  });
  await page.setViewportSize({ width: 900, height: 640 });
  await page.mouse.move(890, 630);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(900);
  expect(
    await page
      .locator(".sidebar-footer")
      .evaluate((footer) => footer.getBoundingClientRect().bottom),
  ).toBeLessThanOrEqual(640);
  await page.screenshot({
    path: path.resolve("../validation/redesign-overview-min-0115.png"),
    animations: "disabled",
  });
});
test("default Overview fits, smaller windows scroll with themed controls, and sidebar visibility persists", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1200, height: 820 });
  await nativeSetupBackend(page, true);
  await page.goto("/");
  await expect(
    page.getByRole("status", { name: "Local model readiness" }),
  ).toHaveText("Selected local models are loaded and ready.");
  await page
    .locator(".brand-lockup .brand-image-dark")
    .evaluate((image) => (image as HTMLImageElement).decode());
  const viewportMetrics = () =>
    page.evaluate(() => ({
      width: document.documentElement.scrollWidth,
      height: document.documentElement.scrollHeight,
      viewportWidth: innerWidth,
      viewportHeight: innerHeight,
      footerBottom: document
        .querySelector(".content-footer")!
        .getBoundingClientRect().bottom,
    }));
  const normal = await viewportMetrics();
  expect(normal.width).toBeLessThanOrEqual(normal.viewportWidth);
  expect(normal.height).toBeLessThanOrEqual(normal.viewportHeight);
  expect(normal.footerBottom).toBeLessThanOrEqual(820);
  for (const state of ["loaded", "loading"] as const) {
    await page.evaluate((state) => {
      const fixture = (window as unknown as { __cridSetup: ScriptedSetup })
        .__cridSetup;
      fixture.snapshot.engineStatus!.speech.state = state;
      fixture.snapshot.engineStatus!.cleanup.state = state;
      fixture.progress("whisper-turbo", "complete");
    }, state);
    for (const mode of ["code", "generate", "text"]) {
      await page.getByLabel("Output mode").selectOption(mode);
      await expect(page.getByLabel("Output mode")).toHaveValue(mode);
      await expect(page.getByLabel("Output mode")).toBeEnabled();
      await expect
        .poll(async () => (await viewportMetrics()).height, {
          message: `Idle ${mode} Overview with ${state} models fits the default window.`,
        })
        .toBeLessThanOrEqual(820);
      if (state === "loaded" && mode !== "text")
        await page.screenshot({
          path: path.resolve(
            `../validation/layout-overview-${mode}-default-0115.png`,
          ),
        });
    }
  }
  const hide = page.getByRole("button", {
    name: "Collapse sidebar",
    exact: true,
  });
  await hide.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#main-sidebar")).toBeVisible();
  await expect(page.locator("#main-sidebar")).toHaveCSS("width", "64px");
  await expect(
    page.getByRole("button", { name: "Expand sidebar", exact: true }),
  ).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator(".main-shell")).toHaveCSS("margin-left", "64px");
  await page.reload();
  await expect(page.locator("#main-sidebar")).toHaveCSS("width", "64px");
  const railHistory = page.getByRole("button", {
    name: "History",
    exact: true,
  });
  await railHistory.hover();
  await expect(page.getByRole("tooltip")).toHaveText("History");
  await page.mouse.move(1150, 800);
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  await railHistory.focus();
  await expect(page.getByRole("tooltip")).toHaveText("History");
  await page.keyboard.press("Enter");
  await expect(railHistory).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  await page.getByRole("button", { name: "Overview", exact: true }).click();
  await page.getByRole("button", { name: "Local models", exact: true }).focus();
  await expect(page.getByRole("tooltip")).toHaveText("Local models");
  await page.screenshot({
    path: path.resolve("../validation/sidebar-rail-focus-dark-0115.png"),
  });
  await page.keyboard.press("Escape");
  await page
    .getByRole("button", { name: "Expand sidebar", exact: true })
    .click();
  await expect(page.locator("#main-sidebar")).toBeVisible();
  await page.setViewportSize({ width: 900, height: 640 });
  const small = await viewportMetrics();
  expect(small.width).toBeLessThanOrEqual(900);
  expect(small.height).toBeGreaterThan(640);
  const scrollbar = await page.evaluate(() => ({
    width: getComputedStyle(document.documentElement, "::-webkit-scrollbar")
      .width,
    track: getComputedStyle(
      document.documentElement,
      "::-webkit-scrollbar-track",
    ).backgroundColor,
    thumb: getComputedStyle(
      document.documentElement,
      "::-webkit-scrollbar-thumb",
    ).backgroundColor,
    buttons: getComputedStyle(
      document.documentElement,
      "::-webkit-scrollbar-button",
    ).display,
    standardWidth: getComputedStyle(document.documentElement).scrollbarWidth,
  }));
  expect(scrollbar.width).toBe("10px");
  expect(scrollbar.buttons).toBe("none");
  expect(scrollbar.standardWidth).toBe("auto");
  expect(scrollbar.track).not.toBe(scrollbar.thumb);
  await page.screenshot({
    path: path.resolve("../validation/layout-scrollbar-small-0115.png"),
  });
  await page.evaluate(() =>
    window.scrollTo(0, document.documentElement.scrollHeight),
  );
  await expect(page.locator(".content-footer")).toBeInViewport();
  await expect(
    page.getByRole("button", { name: "Collapse sidebar", exact: true }),
  ).toBeInViewport();
  await page.setViewportSize({ width: 1200, height: 820 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: path.resolve("../validation/layout-overview-default-0115.png"),
  });
});

test("keys are never persisted in interface storage and dialogs keep keyboard focus", async ({
  page,
}) => {
  await page.goto("/");
  await page.evaluate(
    (s) =>
      localStorage.setItem(
        "cridvoice-preview",
        JSON.stringify({ ...s, setupComplete: true }),
      ),
    defaultSettings,
  );
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Control+k");
  await expect(
    page.getByRole("textbox", { name: "Find a page" }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "AI providers", exact: true }).click();
  await page.getByRole("button", { name: "OpenAI Cloud connection" }).click();
  const secret = "test-only-provider-key-not-a-real-secret";
  await page.getByLabel(/^API key/).fill(secret);
  await page.getByRole("button", { name: "Save connection" }).click();
  await expect(page.getByRole("alert")).toContainText("Windows desktop app");
  expect(
    await page.evaluate(() => localStorage.getItem("cridvoice-preview")),
  ).not.toContain(secret);
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page.setViewportSize({ width: 1200, height: 820 });
  expect(
    await page.evaluate(
      () =>
        document.querySelector(".sidebar-footer")!.getBoundingClientRect()
          .bottom,
    ),
  ).toBeLessThanOrEqual(820);
});

test("sidebar icons keep their vertical tracks through collapse, expansion and rapid reversal at both window sizes", async ({
  page,
}) => {
  await nativeSetupBackend(page, true);
  await page.goto("/");
  await expect(page.getByLabel("Output mode")).toBeVisible();
  const centers = () =>
    page
      .locator(
        ".sidebar nav button svg, .sidebar-search > svg, .sidebar-about > svg",
      )
      .evaluateAll((icons) =>
        icons.map((icon) => {
          const rect = icon.getBoundingClientRect();
          return {
            x: rect.x + rect.width / 2,
            y: rect.y + rect.height / 2,
            w: rect.width,
            h: rect.height,
          };
        }),
      );
  const compare = (
    actual: { x: number; y: number; w: number; h: number }[],
    expected: { x: number; y: number; w: number; h: number }[],
  ) => {
    expect(actual).toHaveLength(10);
    for (let i = 0; i < actual.length; i++) {
      expect(Math.abs(actual[i].y - expected[i].y)).toBeLessThanOrEqual(1);
      expect(Math.abs(actual[i].x - expected[i].x)).toBeLessThanOrEqual(1);
      expect(actual[i].w).toBe(i === 0 || i === 9 ? 16 : 18);
      expect(actual[i].h).toBe(actual[i].w);
    }
  };
  for (const viewport of [
    { width: 1200, height: 820 },
    { width: 900, height: 640 },
  ]) {
    await page.setViewportSize(viewport);
    for (const fontScale of [1, 1.4]) {
      await page.evaluate((fontScale) => {
        const fixture = (window as unknown as { __cridSetup: ScriptedSetup })
          .__cridSetup;
        fixture.snapshot.settings.appearance.fontScale = fontScale;
        fixture.progress("whisper-turbo", "complete");
      }, fontScale);
      await expect(page.locator("html")).toHaveCSS(
        "--font-scale",
        String(fontScale),
      );
      const before = await centers();
      const samples = await page.evaluate(async () => {
        const icons = Array.from(
          document.querySelectorAll(
            ".sidebar nav button svg, .sidebar-search > svg, .sidebar-about > svg",
          ),
        );
        const button =
          document.querySelector<HTMLButtonElement>(".sidebar-toggle")!;
        button.click();
        const frames: {
          width: number;
          centers: { x: number; y: number; w: number; h: number }[];
          tooltips: number;
        }[] = [];
        const start = performance.now();
        do {
          await new Promise(requestAnimationFrame);
          frames.push({
            width: document
              .getElementById("main-sidebar")!
              .getBoundingClientRect().width,
            centers: icons.map((icon) => {
              const rect = icon.getBoundingClientRect();
              return {
                x: rect.x + rect.width / 2,
                y: rect.y + rect.height / 2,
                w: rect.width,
                h: rect.height,
              };
            }),
            tooltips: document.querySelectorAll('[role="tooltip"]').length,
          });
        } while (performance.now() - start < 230);
        return frames;
      });
      expect(
        samples.some((sample) => sample.width > 65 && sample.width < 200),
      ).toBe(true);
      for (const sample of samples) {
        compare(sample.centers, before);
        if (sample.width > 64.5) expect(sample.tooltips).toBe(0);
      }
      await expect(page.locator("#main-sidebar")).toHaveCSS("width", "64px");
      compare(await centers(), before);
      await expect(
        page.getByRole("button", { name: "Find a page", exact: true }),
      ).toBeInViewport();
      await expect(
        page.getByRole("button", { name: "About CridVoice", exact: true }),
      ).toBeInViewport();
      const vocabulary = page.getByRole("button", {
        name: "Vocabulary",
        exact: true,
      });
      await vocabulary.hover();
      await expect(page.getByRole("tooltip")).toHaveText("Vocabulary");
      await page.screenshot({
        path: path.resolve(
          `../validation/sidebar-stable-${viewport.width}-font${fontScale === 1 ? 100 : 140}-0115.png`,
        ),
        animations: "disabled",
      });
      await page.evaluate(async () => {
        const button =
          document.querySelector<HTMLButtonElement>(".sidebar-toggle")!;
        button.click();
        await new Promise(requestAnimationFrame);
        button.click();
        await new Promise(requestAnimationFrame);
        button.click();
      });
      await expect(page.locator("#main-sidebar")).toHaveCSS(
        "width",
        viewport.width === 900 ? "210px" : "220px",
      );
      compare(await centers(), before);
      await expect(page.getByRole("tooltip")).toHaveCount(0);
    }
  }
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(page.locator("#main-sidebar")).toHaveCSS(
    "transition-duration",
    "0s",
  );
  const before = await centers();
  await page
    .getByRole("button", { name: "Collapse sidebar", exact: true })
    .click();
  await expect(page.locator("#main-sidebar")).toHaveCSS("width", "64px");
  compare(await centers(), before);
  await page
    .getByRole("button", { name: "Writing styles", exact: true })
    .focus();
  await expect(page.getByRole("tooltip")).toHaveText("Writing styles");
});

async function fullScrim(page: Page, selector = ".modal-backdrop") {
  const viewport = page.viewportSize()!;
  const backdrop = page.locator(selector);
  const bounds = await backdrop.boundingBox();
  expect(bounds).toMatchObject({
    x: 0,
    y: 0,
    width: viewport.width,
    height: viewport.height,
  });
  const layers = await backdrop.evaluate((element) => ({
    scrim: Number(getComputedStyle(element).zIndex),
    header: Number(
      getComputedStyle(document.querySelector(".window-titlebar")!).zIndex,
    ),
    sidebar: Number(
      getComputedStyle(document.querySelector(".sidebar")!).zIndex,
    ),
    corners: [
      [4, 4],
      [innerWidth - 15, 4],
      [4, innerHeight - 4],
      [innerWidth - 15, innerHeight - 4],
    ].map(([x, y]) => document.elementFromPoint(x, y) === element),
  }));
  expect(layers.scrim).toBeGreaterThan(layers.header);
  expect(layers.scrim).toBeGreaterThan(layers.sidebar);
  expect(layers.corners).toEqual([true, true, true, true]);
  const dialog = await backdrop.getByRole("dialog").boundingBox();
  expect(dialog!.x).toBeGreaterThanOrEqual(0);
  expect(dialog!.y).toBeGreaterThanOrEqual(0);
  expect(dialog!.x + dialog!.width).toBeLessThanOrEqual(viewport.width);
  expect(dialog!.y + dialog!.height).toBeLessThanOrEqual(viewport.height);
  await expect(page.locator("html")).toHaveCSS("overflow", "hidden");
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(viewport.width);
}

test("shared dialogs dim the complete header and sidebar, preserve focus and feedback, and keep window actions behind the scrim", async ({
  page,
}) => {
  await nativeSetupBackend(page, true);
  await page.setViewportSize({ width: 1200, height: 820 });
  await page.goto("/");
  await expect(page.getByLabel("Output mode")).toBeVisible();
  const search = page.getByRole("button", { name: "Find a page", exact: true });
  await search.focus();
  await search.click();
  await expect(
    page.getByRole("textbox", { name: "Find a page", exact: true }),
  ).toBeFocused();
  await fullScrim(page);
  await page.screenshot({
    path: path.resolve("../validation/dialog-find-full-dark-0115.png"),
    animations: "disabled",
  });
  const close = page.getByRole("button", { name: "Close dialog", exact: true });
  await close.focus();
  await page.keyboard.press("Shift+Tab");
  await expect(
    page.getByRole("dialog").getByRole("button").last(),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(close).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(search).toBeFocused();
  await page.keyboard.press("Control+k");
  await fullScrim(page);
  const nativeBefore = await page.evaluate(
    () =>
      (
        window as unknown as { __cridSetup: ScriptedSetup }
      ).__cridSetup.calls.filter((call) =>
        call.command.startsWith("plugin:window|"),
      ).length,
  );
  const minimize = page.getByRole("button", {
    name: "Minimize window",
    exact: true,
  });
  const position = await minimize.boundingBox();
  await page.mouse.click(
    position!.x + position!.width / 2,
    position!.y + position!.height / 2,
  );
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(
    await page.evaluate(
      () =>
        (
          window as unknown as { __cridSetup: ScriptedSetup }
        ).__cridSetup.calls.filter((call) =>
          call.command.startsWith("plugin:window|"),
        ).length,
    ),
  ).toBe(nativeBefore);
  await minimize.click();
  expect(
    await page.evaluate(() =>
      (
        window as unknown as { __cridSetup: ScriptedSetup }
      ).__cridSetup.calls.some(
        (call) => call.command === "plugin:window|minimize",
      ),
    ),
  ).toBe(true);
  for (const state of [
    { width: 900, height: 640, mode: "dark", fontScale: 1 },
    { width: 900, height: 640, mode: "light", fontScale: 1.4 },
  ] as const) {
    await page.setViewportSize({ width: state.width, height: state.height });
    await page.evaluate((state) => {
      const fixture = (window as unknown as { __cridSetup: ScriptedSetup })
        .__cridSetup;
      Object.assign(fixture.snapshot.settings.appearance, {
        mode: state.mode,
        fontScale: state.fontScale,
      });
      fixture.progress("whisper-turbo", "complete");
    }, state);
    await expect(page.locator("html")).toHaveAttribute("data-mode", state.mode);
    await expect(page.locator("html")).toHaveCSS(
      "--font-scale",
      String(state.fontScale),
    );
    await page
      .getByRole("button", { name: "Help and shortcuts", exact: true })
      .click();
    await fullScrim(page);
    await page.screenshot({
      path: path.resolve(
        `../validation/dialog-help-${state.mode}-font${state.fontScale === 1 ? 100 : 140}-0115.png`,
      ),
      animations: "disabled",
    });
    await page.keyboard.press("Escape");
    await page
      .getByRole("button", { name: "AI providers", exact: true })
      .click();
    const provider = page.getByRole("button", {
      name: "OpenAI Cloud connection",
      exact: true,
    });
    await provider.click();
    await fullScrim(page);
    await page.keyboard.press("Control+k");
    await expect(page.getByRole("dialog")).toHaveCount(1);
    await expect(page.getByRole("dialog")).toHaveAttribute(
      "aria-label",
      "Connect a provider",
    );
    await page.screenshot({
      path: path.resolve(
        `../validation/dialog-provider-${state.mode}-0115.png`,
      ),
      animations: "disabled",
    });
    await page.keyboard.press("Escape");
    await expect(provider).toBeFocused();
    await page.getByRole("button", { name: "History", exact: true }).click();
    const entry = page.locator(".history-text").first();
    await entry.click();
    await fullScrim(page);
    await page.evaluate(() =>
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: async (value: string) => {
            (
              window as unknown as { __cridSetup: ScriptedSetup }
            ).__cridSetup.copied = value;
          },
        },
      }),
    );
    await page
      .getByRole("button", { name: "Copy final text", exact: true })
      .click();
    const toast = page.locator(".toast");
    await expect(toast).toContainText("Copied to clipboard.");
    expect(
      await toast.evaluate((element) =>
        Number(getComputedStyle(element).zIndex),
      ),
    ).toBeGreaterThan(110);
    expect(
      await toast.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return element.contains(
          document.elementFromPoint(
            rect.x + rect.width / 2,
            rect.y + rect.height / 2,
          ),
        );
      }),
    ).toBe(true);
    await page
      .getByRole("button", { name: "Dismiss notification", exact: true })
      .click();
    await page.keyboard.press("Tab");
    expect(
      await page
        .getByRole("dialog")
        .evaluate((element) => element.contains(document.activeElement)),
    ).toBe(true);
    await page.keyboard.press("Escape");
    await expect(entry).toBeFocused();
    await page
      .getByRole("button", { name: "Clear history", exact: true })
      .click();
    await fullScrim(page);
    await page.keyboard.press("Escape");
    expect(
      await page.evaluate(() =>
        (
          window as unknown as { __cridSetup: ScriptedSetup }
        ).__cridSetup.calls.some((call) => call.command === "clear_history"),
      ),
    ).toBe(false);
  }
});

test("setup uses the same full-window scrim and preserves busy Escape and disabled-action focus rules", async ({
  page,
}) => {
  await nativeSetupBackend(page);
  await page.setViewportSize({ width: 900, height: 640 });
  await page.goto("/");
  const setup = page.getByRole("dialog", { name: "Set up CridVoice" });
  await expect(setup).toBeVisible();
  await fullScrim(page, ".setup-backdrop");
  await page.keyboard.press("Control+k");
  await expect(page.getByRole("dialog")).toHaveCount(1);
  for (let i = 0; i < 3; i++)
    await setup.getByRole("button", { name: "Continue", exact: true }).click();
  const finish = setup.getByRole("button", {
    name: "Install required components & finish",
    exact: true,
  });
  await finish.focus();
  await finish.click();
  await expect(
    setup.getByRole("button", {
      name: "Installing required components",
      exact: true,
    }),
  ).toBeDisabled();
  await page.keyboard.press("Tab");
  expect(
    await setup.evaluate((element) => element.contains(document.activeElement)),
  ).toBe(true);
  await page.keyboard.press("Escape");
  await expect(setup).toBeVisible();
  await page.mouse.click(2, 2);
  await expect(setup).toBeVisible();
  await page.screenshot({
    path: path.resolve("../validation/dialog-setup-busy-full-0115.png"),
    animations: "disabled",
  });
});

test("brand home button has balanced compact bounds and restrained hover and keyboard focus in both sidebar states", async ({
  page,
}) => {
  await nativeSetupBackend(page, true);
  await page.goto("/");
  await expect(page.getByLabel("Output mode")).toBeVisible();
  for (const mode of ["dark", "light"] as const) {
    await page.evaluate((mode) => {
      const fixture = (window as unknown as { __cridSetup: ScriptedSetup })
        .__cridSetup;
      fixture.snapshot.settings.appearance.mode = mode;
      fixture.progress("whisper-turbo", "complete");
    }, mode);
    await expect(page.locator("html")).toHaveAttribute("data-mode", mode);
    for (const rail of [false, true]) {
      if (rail) {
        await page
          .getByRole("button", { name: "Collapse sidebar", exact: true })
          .click();
        await expect(page.locator("#main-sidebar")).toHaveCSS("width", "64px");
      }
      const brand = page.getByRole("button", {
        name: "CridVoice overview",
        exact: true,
      });
      const image = brand.locator(rail ? ".brand-mark" : ".brand-lockup");
      await expect(image).toHaveCSS("opacity", "1");
      await image
        .locator(`.brand-image-${mode}`)
        .evaluate((element) => (element as HTMLImageElement).decode());
      const bounds = await brand.boundingBox();
      const mark = await image.boundingBox();
      expect(bounds!.height).toBe(40);
      expect(
        Math.abs(bounds!.x + bounds!.width / 2 - mark!.x - mark!.width / 2),
      ).toBeLessThanOrEqual(1);
      expect(
        Math.abs(bounds!.y + bounds!.height / 2 - mark!.y - mark!.height / 2),
      ).toBeLessThanOrEqual(1);
      await brand.hover();
      await expect(brand).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
      await page.screenshot({
        path: path.resolve(
          `../validation/brand-hover-${mode}-${rail ? "rail" : "full"}-0115.png`,
        ),
        animations: "disabled",
      });
      await page.mouse.move(850, 620);
      await brand.focus();
      await page.keyboard.press("Tab");
      await page.keyboard.press("Shift+Tab");
      await expect(brand).toHaveCSS("outline-offset", "-2px");
      await expect(brand).toHaveCSS("outline-width", "2px");
      await page.screenshot({
        path: path.resolve(
          `../validation/brand-focus-${mode}-${rail ? "rail" : "full"}-0115.png`,
        ),
        animations: "disabled",
      });
      await page.getByRole("button", { name: "History", exact: true }).click();
      await brand.click();
      await expect(
        page.getByRole("button", { name: "Overview", exact: true }),
      ).toHaveAttribute("aria-current", "page");
      const replay = await brand.evaluate((button) => {
        const first = Array.from(button.querySelectorAll("img"))
          .flatMap((image) => image.getAnimations())
          .find((animation) => animation.playState === "running");
        (button as HTMLButtonElement).click();
        const animations = Array.from(button.querySelectorAll("img")).flatMap(
          (image) => image.getAnimations(),
        );
        return {
          hadPulse: Boolean(first),
          previous: first?.playState,
          replayed: animations.some(
            (animation) =>
              animation !== first && animation.playState === "running",
          ),
          count: animations.filter(
            (animation) => animation.playState === "running",
          ).length,
        };
      });
      expect(replay).toEqual({
        hadPulse: true,
        previous: "idle",
        replayed: true,
        count: 1,
      });
      await expect
        .poll(() =>
          brand
            .locator("img")
            .evaluateAll(
              (images) =>
                images
                  .flatMap((image) => image.getAnimations())
                  .filter((animation) => animation.playState === "running")
                  .length,
            ),
        )
        .toBe(0);
      if (rail) {
        await page
          .getByRole("button", { name: "Expand sidebar", exact: true })
          .click();
        await expect(page.locator("#main-sidebar")).toHaveCSS("width", "220px");
      }
    }
  }
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.getByRole("button", { name: "History", exact: true }).click();
  const brand = page.getByRole("button", {
    name: "CridVoice overview",
    exact: true,
  });
  await brand.click();
  await expect(
    page.getByRole("button", { name: "Overview", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  expect(
    await brand
      .locator("img")
      .evaluateAll(
        (images) => images.flatMap((image) => image.getAnimations()).length,
      ),
  ).toBe(0);
});

test("long prose stays within the window and technical results scroll locally with a themed scrollbar corner", async ({
  page,
}) => {
  await page.setViewportSize({ width: 900, height: 640 });
  await nativeSetupBackend(page, true);
  await page.goto("/");
  await expect(page.getByLabel("Output mode")).toBeVisible();
  const longToken = "PUBLIC_SYNTHETIC_TRANSCRIPT_".repeat(150);
  await page.evaluate(
    (result) =>
      (window as unknown as { __cridSetup: ScriptedSetup }).__cridSetup.session(
        {
          status: "idle",
          preview: "",
          level: 0,
          startedAt: null,
          error: "",
          result,
          app: "Test editor",
          outputMode: "text",
        },
      ),
    longToken,
  );
  await expect(page.locator(".result-card")).toContainText(longToken);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(900);
  const code =
    `const token = '${longToken}';\n` + "console.log(token);\n".repeat(50);
  await page.evaluate(
    (result) =>
      (window as unknown as { __cridSetup: ScriptedSetup }).__cridSetup.session(
        {
          status: "idle",
          preview: "",
          level: 0,
          startedAt: null,
          error: "",
          result,
          app: "Test editor",
          outputMode: "code",
        },
      ),
    code,
  );
  const output = page.getByLabel("Code or command output");
  await expect(output).toHaveText(code);
  expect(
    await output.evaluate(
      (element) =>
        element.scrollWidth > element.clientWidth &&
        element.scrollHeight > element.clientHeight,
    ),
  ).toBe(true);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(900);
  for (const mode of ["dark", "light"] as const) {
    await page.evaluate((mode) => {
      const fixture = (window as unknown as { __cridSetup: ScriptedSetup })
        .__cridSetup;
      fixture.snapshot.settings.appearance.mode = mode;
      fixture.progress("whisper-turbo", "complete");
    }, mode);
    await expect(page.locator("html")).toHaveAttribute("data-mode", mode);
    const corner = await output.evaluate((element) => ({
      color: getComputedStyle(element, "::-webkit-scrollbar-corner")
        .backgroundColor,
      surface: getComputedStyle(document.querySelector(".sidebar")!)
        .backgroundColor,
    }));
    expect(corner.color).toBe(corner.surface);
    await output.scrollIntoViewIfNeeded();
    await output.evaluate((element) => {
      element.scrollLeft = element.scrollWidth;
      element.scrollTop = element.scrollHeight;
    });
    expect(
      await output.evaluate((element) => element.scrollLeft),
    ).toBeGreaterThan(0);
    expect(await output.textContent()).toBe(code);
    await output.evaluate((element) => {
      element.scrollLeft = 0;
      element.scrollIntoView({ block: "center", behavior: "instant" });
    });
    await output.screenshot({
      path: path.resolve(
        `../validation/code-scrollbar-corner-${mode}-0115.png`,
      ),
      animations: "disabled",
    });
    await page.screenshot({
      path: path.resolve(`../validation/scrollbar-corner-${mode}-0115.png`),
      animations: "disabled",
    });
  }
});

test("download and shared buttons have even neutral hover and visible keyboard focus in both themes", async ({
  page,
}) => {
  await nativeSetupBackend(page, true);
  await page.goto("/");
  await expect(page.getByLabel("Output mode")).toBeVisible();
  await page.evaluate(() => {
    const fixture = (window as unknown as { __cridSetup: ScriptedSetup })
      .__cridSetup;
    fixture.snapshot.models.find(
      (model) => model.id === "qwen3-4b",
    )!.installed = false;
    fixture.progress("whisper-turbo", "complete");
  });
  const hex = (rgb: string) =>
    "#" +
    (rgb.match(/[\d.]+/g) || [])
      .slice(0, 3)
      .map((number) =>
        Math.round(Number(number) * (rgb.startsWith("color(srgb") ? 255 : 1))
          .toString(16)
          .padStart(2, "0"),
      )
      .join("");
  for (const mode of ["dark", "light"] as const) {
    await page.evaluate((mode) => {
      const fixture = (window as unknown as { __cridSetup: ScriptedSetup })
        .__cridSetup;
      fixture.snapshot.settings.appearance.mode = mode;
      fixture.progress("whisper-turbo", "complete");
    }, mode);
    await expect(page.locator("html")).toHaveAttribute("data-mode", mode);
    await page
      .getByRole("button", { name: "Local models", exact: true })
      .click();
    const download = page.getByRole("button", {
      name: "Download",
      exact: true,
    });
    const neutral = await page.evaluate(() =>
      getComputedStyle(document.documentElement)
        .getPropertyValue("--surface-hover")
        .trim(),
    );
    const expectedNeutral = `rgb(${[1, 3, 5].map((position) => parseInt(neutral.slice(position, position + 2), 16)).join(", ")})`;
    for (const button of [
      download,
      page.getByRole("button", {
        name: "Unload models from memory",
        exact: true,
      }),
      page.getByRole("button", { name: "Remove", exact: true }).first(),
      page.getByRole("button", { name: "Help and shortcuts", exact: true }),
    ]) {
      await button.hover();
      await expect(button).toHaveCSS("background-color", expectedNeutral);
      await expect(button).toHaveCSS("box-shadow", "none");
      const colors = await button.evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          background: style.backgroundColor,
          color: style.color,
          borders: [
            style.borderTopColor,
            style.borderRightColor,
            style.borderBottomColor,
            style.borderLeftColor,
          ],
        };
      });
      expect(new Set(colors.borders).size).toBe(1);
      expect(
        colorContrast(hex(colors.background), hex(colors.color)),
      ).toBeGreaterThanOrEqual(4.5);
    }
    await download.hover();
    await page.screenshot({
      path: path.resolve(`../validation/download-hover-${mode}-0115.png`),
      animations: "disabled",
    });
    await page.mouse.move(850, 100);
    await download.focus();
    await page.keyboard.press("Tab");
    await page.keyboard.press("Shift+Tab");
    await expect(download).toBeFocused();
    await expect(download).toHaveCSS("outline-style", "solid");
    await expect(download).toHaveCSS("outline-width", "2px");
    const focus = await download.evaluate((element) => ({
      outline: getComputedStyle(element).outlineColor,
      surface: getComputedStyle(document.querySelector(".panel")!)
        .backgroundColor,
    }));
    expect(
      colorContrast(hex(focus.outline), hex(focus.surface)),
    ).toBeGreaterThanOrEqual(3);
    await page.screenshot({
      path: path.resolve(`../validation/download-focus-${mode}-0115.png`),
      animations: "disabled",
    });
    await page.getByRole("button", { name: "Overview", exact: true }).click();
    await page.evaluate(() =>
      (window as unknown as { __cridSetup: ScriptedSetup }).__cridSetup.session(
        {
          status: "recording",
          preview: "",
          level: 0,
          startedAt: null,
          error: "",
          result: "",
          app: "Synthetic editor",
        },
      ),
    );
    const danger = page.getByRole("button", {
      name: "Stop recording",
      exact: true,
    });
    await expect(danger).toBeVisible();
    const dangerContrast = () =>
      danger.evaluate((element) => {
        const style = getComputedStyle(element);
        return { background: style.backgroundColor, color: style.color };
      });
    const expectedTint = async (amount: number) =>
      page.evaluate((amount) => {
        const probe = document.createElement("span");
        probe.hidden = true;
        probe.style.color = `color-mix(in srgb, var(--red) ${amount}%, var(--surface))`;
        document.body.append(probe);
        const color = getComputedStyle(probe).color;
        probe.remove();
        return color;
      }, amount);
    await expect(danger).toHaveCSS("background-color", await expectedTint(18));
    const normalDanger = await dangerContrast();
    expect(
      colorContrast(hex(normalDanger.background), hex(normalDanger.color)),
    ).toBeGreaterThanOrEqual(4.5);
    await danger.hover();
    await expect(danger).toHaveCSS("background-color", await expectedTint(25));
    await expect
      .poll(async () => {
        const colors = await dangerContrast();
        return colorContrast(hex(colors.background), hex(colors.color));
      })
      .toBeGreaterThanOrEqual(4.5);
    await expect(danger).toHaveCSS("box-shadow", "none");
    await danger.screenshot({
      path: path.resolve(`../validation/danger-hover-${mode}-0115.png`),
      animations: "disabled",
    });
    await page.evaluate(() =>
      (window as unknown as { __cridSetup: ScriptedSetup }).__cridSetup.session(
        {
          status: "idle",
          preview: "",
          level: 0,
          startedAt: null,
          error: "",
          result: "",
          app: "",
        },
      ),
    );
    await page
      .getByRole("button", { name: "Collapse sidebar", exact: true })
      .click();
    await expect(page.locator("#main-sidebar")).toHaveCSS("width", "64px");
    await page
      .getByRole("button", { name: "Writing styles", exact: true })
      .hover();
    await expect(page.getByRole("tooltip")).toHaveText("Writing styles");
    await page.screenshot({
      path: path.resolve(`../validation/sidebar-rail-hover-${mode}-0115.png`),
      animations: "disabled",
    });
    await page
      .getByRole("button", { name: "Expand sidebar", exact: true })
      .click();
  }
});
test("theme, vocabulary, provider configuration, and navigation are functional", async ({
  page,
}) => {
  await page.goto("/");
  await page.evaluate(() => {
    localStorage.setItem(
      "cridvoice-preview",
      JSON.stringify({
        ...JSON.parse(JSON.stringify({})),
        setupComplete: true,
        transcription: {
          mode: "local",
          modelId: "whisper-turbo",
          device: "auto",
          language: "auto",
          providerId: "",
        },
        cleanup: {
          mode: "managed",
          modelId: "qwen3-4b",
          device: "auto",
          providerId: "",
          style: "faithful",
        },
        providers: [],
        vocabulary: [],
        appRules: [],
        appearance: {
          theme: "violet",
          mode: "dark",
          accent: "#a78bfa",
          fontScale: 1,
          overlayVisible: true,
          waveform: true,
          livePreview: true,
        },
        shortcuts: {
          hold: "Ctrl+Super",
          toggle: "Ctrl+Shift+Space",
          rewrite: "Ctrl+Alt+R",
        },
        general: {
          startup: false,
          saveHistory: true,
          context: true,
          microphone: "",
          maxRecordingSeconds: 300,
          historyDays: 0,
        },
      }),
    );
  });
  await page.reload();
  await page.getByRole("button", { name: "Appearance", exact: true }).click();
  await page.getByRole("button", { name: /^Ocean\b/ }).click();
  await expect(page.locator("html")).toHaveCSS("--accent", "#38bdf8");
  await page.getByRole("button", { name: "Light", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-mode", "light");
  await page.getByRole("switch", { name: "Audio waveform" }).click();
  await page.getByRole("button", { name: "Vocabulary", exact: true }).click();
  await page.getByLabel("Correct spelling").fill("Łukasz");
  await page.getByLabel("Aliases · comma separated").fill("Lucas");
  await page.getByRole("button", { name: "Add word" }).click();
  await expect(page.getByText("Łukasz", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "AI providers", exact: true }).click();
  await page
    .getByRole("button", { name: "LM Studio Local connection" })
    .click();
  await page
    .getByLabel("Text model ID", { exact: true })
    .selectOption("custom");
  await page.getByLabel("Custom text model id", { exact: true }).fill("qwen3");
  await page.getByRole("button", { name: "Save connection" }).click();
  await expect(
    page.getByText("http://127.0.0.1:1234/v1", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Cleanup engine", exact: true })
    .selectOption("provider");
  await page
    .getByRole("combobox", { name: "Text provider", exact: true })
    .selectOption({ label: "LM Studio" });
  await page.reload();
  expect(
    await page.evaluate(() =>
      JSON.parse(localStorage.getItem("cridvoice-preview")!),
    ),
  ).toMatchObject({
    vocabulary: [{ word: "Łukasz", aliases: ["Lucas"] }],
    appearance: {
      theme: "ocean",
      mode: "light",
      waveform: false,
      livePreview: true,
    },
    cleanup: { mode: "provider" },
  });
});
