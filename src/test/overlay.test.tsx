import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { defaultSettings, emptySession } from "../types";
import type { Session, Snapshot } from "../types";

const bridge = vi.hoisted(() => ({
  getSnapshot: vi.fn(),
  events: vi.fn(),
  command: vi.fn(),
  saveSettings: vi.fn(),
  completeSetup: vi.fn(),
}));
const windowApi = vi.hoisted(() => ({
  startDragging: vi.fn(),
  setTheme: vi.fn(),
  setFocus: vi.fn(),
}));
vi.mock("../bridge", () => ({ ...bridge, desktop: true }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => windowApi,
}));
import App from "../App";

let snapshot: Snapshot;
let sessionEvent: (session: Session) => void;
let refresh: () => void;
beforeEach(() => {
  vi.clearAllMocks();
  history.replaceState(null, "", "/?overlay=1");
  vi.stubGlobal("matchMedia", () => ({
    matches: true,
    addEventListener() {},
    removeEventListener() {},
  }));
  windowApi.startDragging.mockResolvedValue(undefined);
  windowApi.setTheme.mockResolvedValue(undefined);
  const settings = structuredClone(defaultSettings);
  settings.setupComplete = true;
  snapshot = {
    settings,
    session: { ...emptySession, status: "recording", level: 0.03 },
    history: [],
    hardware: {
      cpu: "Synthetic CPU",
      ramGb: 16,
      threads: 8,
      gpus: [],
      cudaAvailable: false,
    },
    models: [],
    version: "test",
    portable: true,
    dataDir: "Synthetic fixture",
  };
  bridge.getSnapshot.mockImplementation(async () => structuredClone(snapshot));
  bridge.events.mockImplementation(
    async (session, _download, _history, state) => {
      sessionEvent = session;
      refresh = state;
      return () => {};
    },
  );
});
afterEach(() => {
  cleanup();
  history.replaceState(null, "", "/");
  document.body.classList.remove("overlay-body");
  vi.unstubAllGlobals();
});

it("keeps recording and processing labels explicit, preserves preview text and never displays a technical result in the popup", async () => {
  render(<App />);
  await screen.findByText("Recording");
  expect(screen.getByLabelText("Transcript preview")).toHaveTextContent(
    "Waiting for recognized speech",
  );
  expect(screen.getByText("Release to finish · Esc to cancel")).toBeVisible();
  const longPreview = "Synthetic long transcript ".repeat(30);
  await act(async () =>
    sessionEvent({
      ...emptySession,
      status: "recording",
      outputMode: "generate",
      preview: longPreview,
      result: "PRIVATE RESULT SHOULD NOT SHOW",
    }),
  );
  expect(screen.getByLabelText("Transcript preview").textContent).toBe(
    longPreview,
  );
  expect(screen.getByLabelText("Transcript preview")).toHaveAttribute(
    "aria-live",
    "off",
  );
  expect(screen.getByText("Release to review · Esc to cancel")).toBeVisible();
  expect(screen.queryByText("PRIVATE RESULT SHOULD NOT SHOW")).toBeNull();
  for (const [status, label] of [
    ["loading", "Loading models"],
    ["transcribing", "Transcribing"],
    ["cleaning", "Cleaning"],
    ["inserting", "Inserting"],
  ] as const) {
    await act(async () => sessionEvent({ ...emptySession, status }));
    expect(
      screen.getByRole("status", { name: "Recording status" }),
    ).toHaveTextContent(label);
    expect(screen.getByText("Esc to cancel")).toBeVisible();
  }
});

it("shows corrections immediately and clears the prior take without timers or recording commands", async () => {
  render(<App />);
  await screen.findByText("Recording");
  for (const preview of [
    "Meet on Tuesday",
    "Meet on Wednesday at 3",
    "Wednesday",
  ]) {
    await act(async () =>
      sessionEvent({ ...emptySession, status: "recording", preview }),
    );
    expect(screen.getByLabelText("Transcript preview").textContent).toBe(
      preview,
    );
  }
  await act(async () => sessionEvent({ ...emptySession, status: "idle" }));
  expect(screen.getByLabelText("Transcript preview")).toHaveTextContent(
    "Waiting for recognized speech",
  );
  await act(async () =>
    sessionEvent({ ...emptySession, status: "recording", preview: "New take" }),
  );
  expect(screen.getByLabelText("Transcript preview").textContent).toBe(
    "New take",
  );
  expect(bridge.command).not.toHaveBeenCalled();
});

it("honors preview and waveform preferences while retaining an accessible error", async () => {
  snapshot.settings.appearance.livePreview = false;
  snapshot.settings.appearance.waveform = false;
  render(<App />);
  await screen.findByText("Recording");
  expect(screen.queryByLabelText("Transcript preview")).toBeNull();
  expect(document.querySelector(".waveform")).toBeNull();
  await act(async () =>
    sessionEvent({
      ...emptySession,
      status: "error",
      error: "Synthetic recognition failure",
    }),
  );
  expect(screen.getByLabelText("Recording error")).toHaveTextContent(
    "Synthetic recognition failure",
  );
  snapshot.settings.appearance.livePreview = true;
  await act(async () => refresh());
  expect(
    screen.getByRole("status", { name: "Recording status" }),
  ).toHaveTextContent("Error");
});

it("shows a preview-only failure without replacing recording or exposing final text", async () => {
  snapshot.engineStatus = {
    speech: { modelId: "whisper-turbo", device: "cuda", state: "loaded" },
    preview: { modelId: "whisper-preview", device: "cpu", state: "error" },
    cleanup: { modelId: null, device: null, state: "unloaded" },
  };
  render(<App />);
  await screen.findByText("Recording");
  expect(screen.getByLabelText("Transcript preview")).toHaveTextContent(
    "Preview unavailable. Release to transcribe.",
  );
  expect(
    screen.getByRole("status", { name: "Recording status" }),
  ).toHaveTextContent("Recording");
  await act(async () =>
    sessionEvent({
      ...emptySession,
      status: "recording",
      preview: "Most recent recognized words",
      result: "FINAL RESULT NOT SHOWN",
    }),
  );
  expect(screen.getByLabelText("Transcript preview")).toHaveTextContent(
    "Most recent recognized words",
  );
  expect(screen.queryByText("FINAL RESULT NOT SHOWN")).toBeNull();
  expect(bridge.command).not.toHaveBeenCalled();
});

it("only initiates dragging on the left pointer button without taking focus or altering recording commands", async () => {
  render(<App />);
  await screen.findByText("Recording");
  const popup = document.querySelector(".recording-overlay")!;
  fireEvent.mouseDown(popup, { button: 2 });
  expect(windowApi.startDragging).not.toHaveBeenCalled();
  fireEvent.mouseDown(popup, { button: 0 });
  expect(windowApi.startDragging).toHaveBeenCalledOnce();
  expect(windowApi.setFocus).not.toHaveBeenCalled();
  expect(bridge.command).not.toHaveBeenCalled();
});
