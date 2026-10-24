import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { defaultSettings, emptySession } from "../types";
import type { Snapshot } from "../types";

const bridge = vi.hoisted(() => ({
  getSnapshot: vi.fn(),
  events: vi.fn(),
  saveSettings: vi.fn(),
  command: vi.fn(),
  warmSelectedModels: vi.fn(),
}));
const windowApi = vi.hoisted(() => ({
  setTheme: vi.fn(),
  isMaximized: vi.fn(),
  onResized: vi.fn(),
}));
vi.mock("../bridge", () => ({ ...bridge, desktop: true }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => windowApi,
}));
import App from "../App";

let snapshot: Snapshot;
let onState: () => void;
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
  windowApi.setTheme.mockResolvedValue(undefined);
  windowApi.isMaximized.mockResolvedValue(false);
  windowApi.onResized.mockResolvedValue(() => {});
  snapshot = {
    settings: structuredClone(defaultSettings),
    session: emptySession,
    history: [],
    models: [],
    hardware: {
      cpu: "Test CPU",
      ramGb: 16,
      gpus: [],
      cudaAvailable: false,
      threads: 4,
    },
    version: "test",
    portable: true,
    dataDir: "Scripted test data",
  };
  snapshot.settings.setupComplete = true;
  snapshot.settings.transcription.mode = "openai";
  snapshot.settings.transcription.providerId = "local-test";
  snapshot.settings.cleanup.mode = "off";
  snapshot.settings.providers = [
    {
      id: "local-test",
      name: "Scripted provider",
      protocol: "openai",
      baseUrl: "http://127.0.0.1:1234/v1",
      model: "",
      sttModel: "fixture",
      hasKey: false,
    },
  ];
  bridge.getSnapshot.mockImplementation(async () => structuredClone(snapshot));
  bridge.events.mockImplementation(
    async (_session, _download, _history, changed) => {
      onState = changed;
      return () => {};
    },
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("updates the full palette on snapshots and custom colors while calling native theme only for an actual mode change", async () => {
  render(<App />);
  await screen.findByLabelText("Output mode");
  expect(windowApi.setTheme).toHaveBeenCalledOnce();
  expect(windowApi.setTheme).toHaveBeenLastCalledWith("dark");
  snapshot.engineStatus = {
    speech: { modelId: "fixture", device: "cpu", state: "loading" },
    cleanup: { modelId: null, device: null, state: "unloaded" },
  };
  await act(async () => onState());
  snapshot.settings.appearance.accent = "#000000";
  snapshot.settings.appearance.theme = "ocean";
  snapshot.settings.appearance.fontScale = 1.2;
  await act(async () => onState());
  await waitFor(() =>
    expect(document.documentElement.style.getPropertyValue("--accent")).toBe(
      "#000000",
    ),
  );
  expect(document.documentElement.style.getPropertyValue("--background")).toBe(
    "#0c141b",
  );
  expect(windowApi.setTheme).toHaveBeenCalledOnce();
  snapshot.settings.appearance.mode = "light";
  await act(async () => onState());
  await waitFor(() => expect(windowApi.setTheme).toHaveBeenCalledTimes(2));
  expect(windowApi.setTheme).toHaveBeenLastCalledWith("light");
  snapshot.settings.appearance.mode = "system";
  await act(async () => onState());
  await waitFor(() => expect(windowApi.setTheme).toHaveBeenCalledTimes(3));
  expect(windowApi.setTheme).toHaveBeenLastCalledWith(null);
});
