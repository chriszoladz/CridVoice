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
