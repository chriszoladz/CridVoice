import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { defaultSettings } from "../types";
import type { Settings, SettingsUpdate, Snapshot } from "../types";

const bridge = vi.hoisted(() => ({
  getSnapshot: vi.fn(),
  saveSettings: vi.fn(),
  events: vi.fn(),
  command: vi.fn(),
  completeSetup: vi.fn(),
}));
vi.mock("../bridge", () => ({ ...bridge, desktop: false }));
vi.mock("../panels", () => ({
  Appearance: () => null,
  History: () => null,
  Models: () => null,
  Providers: () => null,
  SettingsPanel: () => null,
  Styles: () => null,
  VocabularyPanel: ({
    settings,
    update,
  }: {
    settings: Settings;
    update: (patch: SettingsUpdate) => Promise<void>;
  }) => (
    <>
      <output aria-label="Queued vocabulary">
        {settings.vocabulary.map((item) => item.word).join(", ")}
      </output>
      {["Alpha", "Beta"].map((word) => (
        <button
          key={word}
          onClick={() =>
            void update((current) => ({
              vocabulary: [...current.vocabulary, { word, aliases: [] }],
            }))
          }
        >
          Queue {word}
        </button>
      ))}
    </>
  ),
}));
import App from "../App";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

it("evaluates collection updates against pending settings and persists both changes in order", async () => {
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
  const settings = structuredClone(defaultSettings);
  settings.setupComplete = true;
  settings.cleanup.mode = "off";
  settings.transcription.device = "cpu";
  const snapshot: Snapshot = {
    settings,
    history: [],
    models: [],
    version: "test",
    portable: true,
    dataDir: "test",
    hardware: {
      cpu: "Test CPU",
      ramGb: 16,
      threads: 8,
      cudaAvailable: false,
      gpus: [],
    },
  };
  const saves: { settings: Settings; finish: () => void }[] = [];
  bridge.getSnapshot.mockImplementation(async () => structuredClone(snapshot));
  bridge.events.mockResolvedValue(() => {});
  bridge.saveSettings.mockImplementation(
    (next: Settings) =>
      new Promise<void>((resolve) => {
        saves.push({
          settings: next,
          finish() {
            snapshot.settings = next;
            resolve();
          },
        });
      }),
  );
  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: "Vocabulary" }));
  fireEvent.click(screen.getByRole("button", { name: "Queue Alpha" }));
  fireEvent.click(screen.getByRole("button", { name: "Queue Beta" }));
  expect(screen.getByLabelText("Queued vocabulary")).toHaveTextContent(
    "Alpha, Beta",
  );
  await waitFor(() => expect(saves).toHaveLength(1));
  expect(saves[0].settings.vocabulary.map((item) => item.word)).toEqual([
    "Alpha",
  ]);
  await act(async () => saves[0].finish());
  await waitFor(() => expect(saves).toHaveLength(2));
  expect(saves[1].settings.vocabulary.map((item) => item.word)).toEqual([
    "Alpha",
    "Beta",
  ]);
  await act(async () => saves[1].finish());
  await screen.findByText("Saved locally");
  expect(snapshot.settings.vocabulary.map((item) => item.word)).toEqual([
    "Alpha",
    "Beta",
  ]);
  expect(screen.getByLabelText("Queued vocabulary")).toHaveTextContent(
    "Alpha, Beta",
  );
});
