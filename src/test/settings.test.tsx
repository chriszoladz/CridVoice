import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { command } from "../bridge";
import { SettingsPanel } from "../panels";
import { defaultSettings } from "../types";
import type { Settings, SettingsUpdate, Snapshot } from "../types";

vi.mock("../bridge", () => ({
  command: vi.fn(async () => []),
  desktop: false,
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function panel(
  settings: Settings,
  update: (patch: SettingsUpdate) => Promise<void> = vi.fn(async () => {}),
) {
  const snapshot: Snapshot = {
    settings,
    history: [],
    hardware: {
      cpu: "Test CPU",
      ramGb: 16,
      gpus: [],
      cudaAvailable: false,
      threads: 4,
    },
    models: [],
    version: "0.1.0",
    portable: false,
    dataDir: "Test data",
  };
  return (
    <SettingsPanel
      settings={settings}
      snapshot={snapshot}
      update={update}
      refresh={vi.fn(async () => {})}
      notify={vi.fn()}
    />
  );
}

describe("Persisted settings", () => {
  it("makes completed-dictation copying optional without replacing the current insertion method", () => {
    const settings = structuredClone(defaultSettings);
    settings.general.insertionMethod = "unicode";
    expect(settings.general.copyDictationToClipboard).toBe(false);
    const update = vi.fn(async (_patch: SettingsUpdate) => {});
    const view = render(panel(settings, update));
    const copy = screen.getByRole("switch", {
      name: "Copy dictation to clipboard",
    });
    expect(copy).toHaveAttribute("aria-checked", "false");
    expect(screen.getByLabelText("Text insertion")).toHaveValue("unicode");
    expect(
      screen.getByText(/Replaces your previous clipboard contents/),
    ).toBeVisible();
    fireEvent.click(copy);
    const enable = update.mock.calls[0][0];
    const latest = structuredClone(settings);
    latest.general.microphone = "New USB microphone";
    latest.general.duckingReductionPercent = 80;
    expect(typeof enable === "function" && enable(latest)).toEqual({
      general: { ...latest.general, copyDictationToClipboard: true },
    });
    view.rerender(
      panel(
        {
          ...settings,
          general: { ...settings.general, copyDictationToClipboard: true },
        },
        update,
      ),
    );
    expect(copy).toHaveAttribute("aria-checked", "true");
    expect(screen.getByLabelText("Text insertion")).toHaveValue("unicode");
    fireEvent.click(copy);
    const disable = update.mock.calls[1][0];
    expect(typeof disable === "function" && disable(latest)).toEqual({
      general: { ...latest.general, copyDictationToClipboard: false },
    });
  });
  it("previews reduction while dragging and saves once on release while preserving newer settings", () => {
    const settings = structuredClone(defaultSettings);
    settings.general.duckBackgroundAudio = true;
    const update = vi.fn(async (_patch: SettingsUpdate) => {});
    render(panel(settings, update));
    const slider = screen.getByRole("slider", {
      name: "Background audio reduction",
    });
    expect(slider).toHaveValue("60");
    fireEvent.change(slider, { target: { value: "80" } });
    expect(screen.getByText("Reduce by 80%")).toBeInTheDocument();
    expect(update).not.toHaveBeenCalled();
    fireEvent.pointerUp(slider);
    fireEvent.blur(slider);
    expect(update).toHaveBeenCalledTimes(1);
    const patch = update.mock.calls[0][0];
    const latest = structuredClone(settings);
    latest.general.microphone = "New microphone";
    latest.general.saveHistory = false;
    expect(
      typeof patch === "function" ? patch(latest).general : undefined,
    ).toEqual({ ...latest.general, duckingReductionPercent: 80 });
  });
  it("supports keyboard reduction changes and keeps the chosen amount when disabled", () => {
    const settings = structuredClone(defaultSettings);
    const update = vi.fn(async (_patch: SettingsUpdate) => {});
    const view = render(panel(settings, update));
    expect(
      screen.getByRole("slider", { name: "Background audio reduction" }),
    ).toBeDisabled();
    settings.general.duckBackgroundAudio = true;
    view.rerender(panel(settings, update));
    const slider = screen.getByRole("slider", {
      name: "Background audio reduction",
    });
    fireEvent.change(slider, { target: { value: "90" } });
    fireEvent.keyUp(slider, { key: "End" });
    expect(slider).toHaveAttribute(
      "aria-valuetext",
      "90% reduction, 10% playback volume",
    );
    expect(update).toHaveBeenCalledTimes(1);
    expect(
      typeof update.mock.calls[0][0] === "function"
        ? update.mock.calls[0][0](settings).general?.duckingReductionPercent
        : undefined,
    ).toBe(90);
  });
  it("keeps background audio reduction optional and merges with the latest microphone setting", () => {
    const settings = structuredClone(defaultSettings);
    expect(settings.general.duckBackgroundAudio).toBe(false);
    const update = vi.fn(async (_patch: SettingsUpdate) => {});
    const view = render(panel(settings, update));
    const toggle = screen.getByRole("switch", {
      name: "Lower background audio while speaking",
    });
    expect(toggle).toHaveAttribute("aria-checked", "false");
    fireEvent.click(toggle);
    const patch = update.mock.calls[0][0];
    const latest = structuredClone(settings);
    latest.general.microphone = "USB microphone";
    expect(
      typeof patch === "function" ? patch(latest).general : undefined,
    ).toEqual({
      ...latest.general,
      duckBackgroundAudio: true,
    });
    view.rerender(
      panel(
        {
          ...settings,
          general: { ...settings.general, duckBackgroundAudio: true },
        },
        update,
      ),
    );
    fireEvent.click(
      screen.getByRole("switch", {
        name: "Lower background audio while speaking",
      }),
    );
    const disable = update.mock.calls[1][0];
    expect(
      typeof disable === "function"
        ? disable(latest).general?.duckBackgroundAudio
        : undefined,
    ).toBe(false);
  });
  it("turns coding off with cleanup without losing the latest override or unrelated cleanup settings", () => {
    const settings = structuredClone(defaultSettings);
    settings.cleanup.outputMode = "generate";
    settings.cleanup.codeLanguage = "PowerShell";
    const update = vi.fn(async (_patch: SettingsUpdate) => {});
    render(panel(settings, update));
    fireEvent.change(screen.getByLabelText("Cleanup engine"), {
      target: { value: "off" },
    });
    const patch = update.mock.calls[0][0];
    const latest = {
      ...settings,
      cleanup: {
        ...settings.cleanup,
        device: "cpu" as const,
        codeLanguage: "Bash",
      },
    };
    expect(
      typeof patch === "function" ? patch(latest).cleanup : undefined,
    ).toEqual({ ...latest.cleanup, mode: "off", outputMode: "text" });
  });
  it("shows the saved microphone before and after enumerating other devices", async () => {
    const settings = structuredClone(defaultSettings);
    settings.general.microphone = "Saved USB microphone";
    vi.mocked(command).mockResolvedValue(["Other microphone"]);
    render(panel(settings));

    const microphone = screen.getByRole("combobox", { name: "Microphone" });
    expect(microphone).toHaveValue("Saved USB microphone");
    expect(
      screen.getByRole("option", { name: "Saved USB microphone" }),
    ).toBeInTheDocument();

    await screen.findByRole("option", { name: "Other microphone" });
    expect(command).toHaveBeenCalledWith("microphone_devices");
    expect(microphone).toHaveValue("Saved USB microphone");
  });

  it("captures a pressed shortcut without saving until confirmed, preserving the latest sibling binding", async () => {
    const settings = structuredClone(defaultSettings);
    const update = vi.fn(async (_patch: SettingsUpdate) => {});
    render(panel(settings, update));
    fireEvent.click(
      screen.getByRole("button", { name: "Change hold to dictate" }),
    );
    fireEvent.keyDown(window, {
      key: "Control",
      code: "ControlLeft",
      ctrlKey: true,
    });
    fireEvent.keyDown(window, { key: "h", code: "KeyH", ctrlKey: true });
    expect(
      screen.getByRole("button", { name: "Save shortcut" }),
    ).toBeDisabled();
    fireEvent.keyUp(window, { key: "h", code: "KeyH", ctrlKey: true });
    fireEvent.keyUp(window, { key: "Control", code: "ControlLeft" });
    expect(update).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Save shortcut" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    const patch = update.mock.calls[0][0];
    const latest = {
      ...settings,
      shortcuts: { ...settings.shortcuts, rewrite: "Alt+R" },
    };
    expect(typeof patch === "function" && patch(latest)).toEqual({
      shortcuts: { ...latest.shortcuts, hold: "Ctrl+H" },
    });
  });
  it("keeps a rejected shortcut available for retry without changing the saved value", async () => {
    const update = vi.fn(async () => {
      throw new Error("Could not save shortcut");
    });
    render(panel(structuredClone(defaultSettings), update));
    fireEvent.click(
      screen.getByRole("button", { name: "Change hold to dictate" }),
    );
    fireEvent.keyDown(window, { key: "h", code: "KeyH", ctrlKey: true });
    fireEvent.keyUp(window, { key: "h", code: "KeyH" });
    fireEvent.click(screen.getByRole("button", { name: "Save shortcut" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not save shortcut",
    );
    expect(screen.getByRole("button", { name: "Save shortcut" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
  it("preserves nonpreset saved recording and retention values", () => {
    const settings = structuredClone(defaultSettings);
    settings.general.maxRecordingSeconds = 120;
    settings.general.historyDays = 14;
    render(panel(settings));
    expect(screen.getByLabelText("Maximum recording length")).toHaveValue(
      "120",
    );
    expect(screen.getByLabelText("History retention")).toHaveValue("14");
  });
  it("merges microphone edits against current general settings", () => {
    const settings = structuredClone(defaultSettings);
    const update = vi.fn(async (_patch: SettingsUpdate) => {});
    render(panel(settings, update));
    fireEvent.click(screen.getByRole("switch", { name: "Launch at startup" }));
    const patch = update.mock.calls[0][0];
    const latest = {
      ...settings,
      general: { ...settings.general, microphone: "New device" },
    };
    expect(typeof patch === "function" && patch(latest)).toEqual({
      general: { ...latest.general, startup: true },
    });
  });
});
