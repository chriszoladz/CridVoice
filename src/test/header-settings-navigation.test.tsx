import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { defaultSettings } from "../types";
import type { Settings, SettingsUpdate } from "../types";

const bridge = vi.hoisted(() => ({
  getSnapshot: vi.fn(),
  events: vi.fn(),
  command: vi.fn(),
  saveSettings: vi.fn(),
  completeSetup: vi.fn(),
}));
vi.mock("../bridge", () => ({ ...bridge, desktop: false }));
vi.mock("../panels", () => ({
  Appearance: () => null,
  History: () => null,
  Models: () => null,
  Providers: () => null,
  Styles: () => null,
  VocabularyPanel: ({
    update,
  }: {
    update: (patch: SettingsUpdate) => Promise<void>;
  }) => (
    <button
      onClick={() =>
        void update((current) => ({
          general: { ...current.general, context: !current.general.context },
        })).catch(() => {})
      }
    >
      Change settings
    </button>
  ),
  SettingsPanel: () => (
    <section id="settings-speech">
      <h3>Speech recognition</h3>
      <select aria-label="Transcription engine">
        <option>Local</option>
      </select>
    </section>
  ),
}));
import App from "../App";
const originalScroll = Object.getOwnPropertyDescriptor(
  Element.prototype,
  "scrollIntoView",
);

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  if (originalScroll)
    Object.defineProperty(Element.prototype, "scrollIntoView", originalScroll);
  else Reflect.deleteProperty(Element.prototype, "scrollIntoView");
});

it("opens the real speech settings section and focuses its first control without saving settings", async () => {
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    setTimeout(() => callback(0), 0);
    return 1;
  });
  const scroll = vi.fn();
  Object.defineProperty(Element.prototype, "scrollIntoView", {
    configurable: true,
    value: scroll,
  });
  const settings = structuredClone(defaultSettings);
  settings.setupComplete = true;
  bridge.getSnapshot.mockResolvedValue({
    settings,
    history: [],
    models: [],
    version: "fixture",
    portable: true,
    dataDir: "fixture",
    hardware: {
      cpu: "Fixture",
      ramGb: 16,
      threads: 4,
      cudaAvailable: false,
      gpus: [],
    },
  });
  bridge.events.mockResolvedValue(() => {});
  render(<App />);
  fireEvent.click(
    await screen.findByRole("button", {
      name: /Local processing\..*Open processing settings/,
    }),
  );
  expect(
    await screen.findByRole("heading", { name: "Speech recognition" }),
  ).toBeVisible();
  await waitFor(() =>
    expect(
      screen.getByRole("combobox", { name: "Transcription engine" }),
    ).toHaveFocus(),
  );
  expect(scroll).toHaveBeenCalledWith({ block: "start" });
  expect(bridge.saveSettings).not.toHaveBeenCalled();
});

it("only marks the latest failed save and clears that status after recovery", async () => {
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
  const settings = structuredClone(defaultSettings);
  settings.setupComplete = true;
  const snapshot = {
    settings,
    history: [],
    models: [],
    version: "fixture",
    portable: true,
    dataDir: "fixture",
    hardware: {
      cpu: "Fixture",
      ramGb: 16,
      threads: 4,
      cudaAvailable: false,
      gpus: [],
    },
  };
  bridge.getSnapshot.mockImplementation(async () => structuredClone(snapshot));
  bridge.events.mockResolvedValue(() => {});
  const pending: { resolve: () => void; reject: () => void }[] = [];
  bridge.saveSettings.mockImplementation(
    (next: Settings) =>
      new Promise<void>((resolve, reject) => {
        pending.push({
          resolve: () => {
            snapshot.settings = next;
            resolve();
          },
          reject: () => reject(new Error("Fixture save failure")),
        });
      }),
  );
  render(<App />);
  fireEvent.click(
    await screen.findByRole("button", { name: "Vocabulary" }),
  );
  const change = screen.getByRole("button", { name: "Change settings" });
  fireEvent.click(change);
  await waitFor(() => expect(pending).toHaveLength(1));
  fireEvent.click(change);
  pending[0].reject();
  await waitFor(() => expect(pending).toHaveLength(2));
  expect(screen.getByRole("status", { name: "Saving" })).toBeVisible();
  expect(screen.queryByText("Save failed")).not.toBeInTheDocument();
  pending[1].resolve();
  await screen.findByRole("status", { name: "Saved locally" });
  fireEvent.click(change);
  await waitFor(() => expect(pending).toHaveLength(3));
  pending[2].reject();
  await screen.findByRole("status", { name: "Save failed" });
  expect(screen.queryByText("Saved locally")).not.toBeInTheDocument();
  fireEvent.click(change);
  await waitFor(() => expect(pending).toHaveLength(4));
  pending[3].resolve();
  await screen.findByRole("status", { name: "Saved locally" });
  expect(screen.queryByText("Save failed")).not.toBeInTheDocument();
});
