import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { DownloadProgress, Session, Snapshot } from "../types";
import { defaultSettings, emptySession } from "../types";

const bridge = vi.hoisted(() => ({
  getSnapshot: vi.fn(),
  saveSettings: vi.fn(),
  events: vi.fn(),
  command: vi.fn(),
  warmSelectedModels: vi.fn(),
}));
vi.mock("../bridge", () => ({ ...bridge, desktop: false }));
import App from "../App";

let snapshot: Snapshot;
let onDownload: (progress: DownloadProgress) => void;
let onState: () => void;
let onSession: (session: Session) => void;
beforeEach(() => {
  vi.clearAllMocks();
  localStorage.removeItem("cridvoice-sidebar-collapsed");
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
  snapshot = {
    settings: structuredClone(defaultSettings),
    history: [],
    hardware: {
      cpu: "Test CPU",
      threads: 8,
      ramGb: 16,
      gpus: [],
      cudaAvailable: false,
    },
    models: [
      {
        id: "whisper-turbo",
        name: "Whisper Turbo",
        kind: "speech",
        description: "Test",
        sizeBytes: 1,
        license: "MIT",
        files: [],
        installed: false,
      },
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
    ],
    version: "test",
    portable: true,
    dataDir: "test",
    engineStatus: {
      preview: { modelId: "whisper-preview", device: "cpu", state: "loaded" },
      speech: { modelId: null, device: null, state: "unloaded" },
      cleanup: { modelId: null, device: null, state: "unloaded" },
    },
  };
  snapshot.settings.setupComplete = true;
  snapshot.settings.cleanup.mode = "off";
  snapshot.settings.transcription.device = "cpu";
  bridge.getSnapshot.mockImplementation(async () => structuredClone(snapshot));
  bridge.saveSettings.mockResolvedValue(undefined);
  bridge.events.mockImplementation(
    async (
      session: (s: Session) => void,
      download: typeof onDownload,
      _history: () => void,
      state: typeof onState,
    ) => {
      onDownload = download;
      onState = state;
      onSession = session;
      return () => {};
    },
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("collapses and expands the sidebar without unmounting an unsaved language override or saving native settings", async () => {
  render(<App />);
  fireEvent.change(await screen.findByLabelText("Code language or shell"), {
    target: { value: "manual" },
  });
  const hint = screen.getByLabelText("Language or shell override");
  fireEvent.change(hint, { target: { value: "New unsaved DSL" } });
  const hide = screen.getByRole("button", { name: "Collapse sidebar" });
  expect(hide).toHaveAttribute("aria-expanded", "true");
  expect(hide).toHaveAttribute("aria-controls", "main-sidebar");
  fireEvent.click(hide);
  expect(document.getElementById("main-sidebar")).not.toHaveAttribute("hidden");
  expect(document.querySelector(".app-shell")).toHaveClass("sidebar-collapsed");
  expect(
    screen.getByRole("button", { name: "Expand sidebar" }),
  ).toHaveAttribute("aria-expanded", "false");
  expect(screen.getByLabelText("Language or shell override")).toBe(hint);
  expect(hint).toHaveValue("New unsaved DSL");
  fireEvent.click(screen.getByRole("button", { name: "Overview" }));
  expect(screen.getByLabelText("Language or shell override")).toBe(hint);
  expect(hint).toHaveValue("New unsaved DSL");
  expect(localStorage.getItem("cridvoice-sidebar-collapsed")).toBe("true");
  fireEvent.click(screen.getByRole("button", { name: "Expand sidebar" }));
  expect(document.getElementById("main-sidebar")).not.toHaveAttribute("hidden");
  expect(hint).toHaveValue("New unsaved DSL");
  expect(bridge.saveSettings).not.toHaveBeenCalled();
});

it("keeps every rail navigation action named and shows tooltips on hover and keyboard focus", async () => {
  render(<App />);
  await screen.findByLabelText("Output mode");
  fireEvent.click(
    await screen.findByRole("button", { name: "Collapse sidebar" }),
  );
  const history = screen.getByRole("button", { name: "History" });
  fireEvent.mouseEnter(history);
  expect(screen.getByRole("tooltip")).toHaveTextContent("History");
  expect(history).toHaveAttribute("aria-describedby", "sidebar-tooltip");
  expect(history).not.toHaveAttribute("title");
  fireEvent.mouseLeave(history);
  expect(screen.queryByRole("tooltip")).toBeNull();
  const models = screen.getByRole("button", { name: "Local models" });
  fireEvent.focus(models);
  expect(screen.getByRole("tooltip")).toHaveTextContent("Local models");
  act(() => models.focus());
  fireEvent.mouseLeave(models);
  expect(screen.getByRole("tooltip")).toHaveTextContent("Local models");
  fireEvent(window, new Event("resize"));
  expect(screen.queryByRole("tooltip")).toBeNull();
  fireEvent.focus(models);
  fireEvent.keyDown(window, { key: "Escape" });
  expect(screen.queryByRole("tooltip")).toBeNull();
  fireEvent.focus(models);
  fireEvent.click(models);
  expect(models).toHaveAttribute("aria-current", "page");
  expect(screen.queryByRole("tooltip")).toBeNull();
  act(() => models.blur());
  fireEvent.mouseEnter(models);
  expect(screen.getByRole("tooltip")).toHaveTextContent("Local models");
  fireEvent.keyDown(window, { key: "k", ctrlKey: true });
  expect(screen.getByRole("dialog", { name: "Find a page" })).toBeVisible();
  expect(screen.queryByRole("tooltip")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Close dialog" }));
  expect(screen.queryByRole("tooltip")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Find a page" }));
  expect(screen.getByRole("dialog", { name: "Find a page" })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Close dialog" }));
  fireEvent.click(screen.getByRole("button", { name: "About CridVoice" }));
  expect(
    screen.getByRole("dialog", { name: "Help and shortcuts" }),
  ).toBeVisible();
  expect(bridge.saveSettings).not.toHaveBeenCalled();
});

it("waits for a settled rail before showing a focused tooltip and ignores unrelated transition events", async () => {
  render(<App />);
  await screen.findByLabelText("Output mode");
  const sidebar = document.getElementById("main-sidebar")!;
  let width = 220;
  vi.spyOn(sidebar, "getBoundingClientRect").mockImplementation(
    () => ({ width }) as DOMRect,
  );
  fireEvent.click(screen.getByRole("button", { name: "Collapse sidebar" }));
  const vocabulary = screen.getByRole("button", { name: "Vocabulary" });
  const transition = (element: Element, property: string) => {
    const event = new Event("transitionend", { bubbles: true });
    Object.defineProperty(event, "propertyName", { value: property });
    fireEvent(element, event);
  };
  act(() => vocabulary.focus());
  expect(screen.queryByRole("tooltip")).toBeNull();
  width = 64;
  transition(vocabulary, "width");
  transition(sidebar, "opacity");
  expect(screen.queryByRole("tooltip")).toBeNull();
  transition(sidebar, "width");
  expect(screen.getByRole("tooltip")).toHaveTextContent("Vocabulary");
  fireEvent.click(screen.getByRole("button", { name: "Expand sidebar" }));
  expect(screen.queryByRole("tooltip")).toBeNull();
  transition(sidebar, "width");
  expect(screen.queryByRole("tooltip")).toBeNull();
});

it("returns home and replays one owned logo animation while respecting reduced motion and cleaning up rapid clicks", async () => {
  const animation = () => ({
    cancel: vi.fn(),
    onfinish: null as (() => void) | null,
  });
  const first = animation(),
    second = animation();
  const animate = vi
    .fn()
    .mockReturnValueOnce(first)
    .mockReturnValueOnce(second);
  const original = Object.getOwnPropertyDescriptor(
    HTMLImageElement.prototype,
    "animate",
  );
  Object.defineProperty(HTMLImageElement.prototype, "animate", {
    configurable: true,
    value: animate,
  });
  try {
    const view = render(<App />);
    await screen.findByLabelText("Output mode");
    fireEvent.click(screen.getByRole("button", { name: "History" }));
    const brand = screen.getByRole("button", { name: "CridVoice overview" });
    fireEvent.click(brand);
    expect(screen.getByRole("button", { name: "Overview" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(animate).toHaveBeenCalledOnce();
    expect(animate.mock.calls[0][1]).toEqual({
      duration: 260,
      easing: "ease-out",
    });
    fireEvent.click(brand);
    expect(animate).toHaveBeenCalledTimes(2);
    expect(first.cancel).toHaveBeenCalledOnce();
    first.onfinish?.();
    view.unmount();
    expect(second.cancel).toHaveBeenCalledOnce();
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query.includes("reduced-motion"),
      addEventListener() {},
      removeEventListener() {},
    }));
    render(<App />);
    await screen.findByLabelText("Output mode");
    fireEvent.click(screen.getByRole("button", { name: "History" }));
    fireEvent.click(screen.getByRole("button", { name: "CridVoice overview" }));
    expect(screen.getByRole("button", { name: "Overview" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(animate).toHaveBeenCalledTimes(2);
  } finally {
    if (original)
      Object.defineProperty(HTMLImageElement.prototype, "animate", original);
    else
      delete (HTMLImageElement.prototype as unknown as { animate?: unknown })
        .animate;
  }
});

it("restores the saved UI-only sidebar preference and keeps its toggle available after startup failure", async () => {
  localStorage.setItem("cridvoice-sidebar-collapsed", "true");
  let reject!: (reason: Error) => void;
  bridge.getSnapshot.mockImplementationOnce(
    () =>
      new Promise<Snapshot>((_done, fail) => {
        reject = fail;
      }),
  );
  render(<App />);
  expect(
    screen.getByRole("button", { name: "Expand sidebar" }),
  ).toHaveAttribute("aria-expanded", "false");
  await act(async () => reject(new Error("Scripted startup failure")));
  await screen.findByText("CridVoice could not load");
  fireEvent.click(screen.getByRole("button", { name: "Expand sidebar" }));
  expect(
    screen.getByRole("button", { name: "Collapse sidebar" }),
  ).toHaveAttribute("aria-expanded", "true");
  expect(localStorage.getItem("cridvoice-sidebar-collapsed")).toBe("false");
  expect(bridge.saveSettings).not.toHaveBeenCalled();
});

it("keeps the sidebar usable when local UI preference storage is blocked", async () => {
  const read = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("Storage blocked");
  });
  const write = vi
    .spyOn(Storage.prototype, "setItem")
    .mockImplementation(() => {
      throw new Error("Storage blocked");
    });
  try {
    render(<App />);
    await screen.findByLabelText("Output mode");
    fireEvent.click(
      await screen.findByRole("button", { name: "Collapse sidebar" }),
    );
    expect(
      screen.getByRole("button", { name: "Expand sidebar" }),
    ).toBeVisible();
    expect(bridge.saveSettings).not.toHaveBeenCalled();
  } finally {
    read.mockRestore();
    write.mockRestore();
  }
});

it("shows selected local warming without blocking recording and becomes loaded from model events", async () => {
  snapshot.models[0].installed = true;
  snapshot.engineStatus!.speech = {
    modelId: "whisper-turbo",
    device: "cpu",
    state: "loading",
  };
  render(<App />);
  const status = await screen.findByRole("status", {
    name: "Dictation status",
  });
  await waitFor(() => expect(status).toHaveTextContent("Warming local models"));
  expect(
    screen.getByRole("status", { name: "Local model readiness" }),
  ).toHaveTextContent("You can record while local models prepare.");
  const record = screen.getByRole("button", { name: "Test dictation" });
  expect(record).toBeEnabled();
  fireEvent.click(record);
  await waitFor(() =>
    expect(bridge.command).toHaveBeenCalledWith("start_recording", {
      rewrite: false,
    }),
  );
  expect(screen.getByLabelText("Output mode")).toBeEnabled();
  snapshot.engineStatus!.speech.state = "loaded";
  await act(async () => onState());
  await waitFor(() => expect(status).toHaveTextContent("Ready"));
  expect(
    screen.getByRole("status", { name: "Local model readiness" }),
  ).toHaveTextContent("Selected local models are loaded and ready.");
});

it("ignores other model and device warming identities and never assigns local readiness to provider routes", async () => {
  snapshot.models[0].installed = true;
  snapshot.engineStatus!.speech = {
    modelId: "whisper-small",
    device: "cpu",
    state: "loading",
  };
  render(<App />);
  const status = await screen.findByRole("status", {
    name: "Dictation status",
  });
  await waitFor(() => expect(status).toHaveTextContent("Ready"));
  expect(
    screen.getByRole("status", { name: "Local model readiness" }),
  ).toHaveTextContent("Selected local models are unloaded.");
  snapshot.engineStatus!.speech = {
    modelId: "whisper-turbo",
    device: "cuda",
    state: "loading",
  };
  await act(async () => onState());
  expect(status).toHaveTextContent("Ready");
  snapshot.settings.transcription.mode = "openai";
  snapshot.settings.transcription.providerId = "remote";
  snapshot.settings.providers = [
    {
      id: "remote",
      name: "Scripted provider",
      protocol: "openai",
      baseUrl: "http://127.0.0.1:1234/v1",
      model: "",
      sttModel: "speech",
      hasKey: false,
    },
  ];
  snapshot.engineStatus!.speech.device = "cpu";
  await act(async () => onState());
  expect(status).toHaveTextContent("Ready");
  expect(
    screen.queryByRole("status", { name: "Local model readiness" }),
  ).toBeNull();
  expect(bridge.warmSelectedModels).not.toHaveBeenCalled();
});

it("keeps explicit unload unloaded through later model snapshots without requesting background warming", async () => {
  snapshot.models[0].installed = true;
  snapshot.engineStatus!.speech = {
    modelId: "whisper-turbo",
    device: "cpu",
    state: "loaded",
  };
  bridge.command.mockImplementation(async (name) => {
    if (name === "unload_models")
      snapshot.engineStatus!.speech = {
        modelId: null,
        device: null,
        state: "unloaded",
      };
  });
  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: "Local models" }));
  fireEvent.click(
    screen.getByRole("button", { name: "Unload models from memory" }),
  );
  await waitFor(() =>
    expect(
      screen.getByRole("status", { name: "Speech model memory status" }),
    ).toHaveTextContent("Unloaded"),
  );
  await act(async () => onState());
  fireEvent.click(screen.getByRole("button", { name: "Overview" }));
  expect(
    screen.getByRole("status", { name: "Local model readiness" }),
  ).toHaveTextContent("Your next dictation will load them");
  expect(bridge.warmSelectedModels).not.toHaveBeenCalled();
  expect(bridge.command).toHaveBeenCalledTimes(1);
});

it("reuses saved-history metrics through recording updates and recalculates when history changes", async () => {
  const readWords = vi.fn(() => 120);
  const readDuration = vi.fn(() => 30);
  snapshot.history = [
    {
      id: "history-1",
      createdAt: "2026-10-13T12:00:00Z",
      rawText: "Synthetic transcript",
      text: "Synthetic transcript",
      language: "en",
      app: "Test editor",
      get wordCount() {
        return readWords();
      },
      get durationSeconds() {
        return readDuration();
      },
      mode: "local",
      inserted: true,
    },
  ];
  // Keep one backend payload so accessor reads measure App work, not mock serialization.
  bridge.getSnapshot.mockImplementation(async () => snapshot);
  const { container } = render(<App />);
  const words = await screen.findByText("Saved words");
  expect(words.closest(".stat-card")).toHaveTextContent(/120\s*words/);
  expect(
    screen.getByText("Estimated time saved").closest(".stat-card"),
  ).toHaveTextContent(/3\s*min/);
  expect(container.querySelector(".waveform")).toBeNull();
  const initialWordReads = readWords.mock.calls.length;
  const initialDurationReads = readDuration.mock.calls.length;
  for (const level of [0.1, 0.5, 0.8]) {
    await act(async () =>
      onSession({ ...emptySession, status: "recording", level }),
    );
    expect(
      screen.getByRole("status", { name: "Dictation status" }),
    ).toHaveTextContent("Recording");
  }
  expect(container.querySelector(".waveform.active")).not.toBeNull();
  expect(readWords).toHaveBeenCalledTimes(initialWordReads);
  expect(readDuration).toHaveBeenCalledTimes(initialDurationReads);
  snapshot = {
    ...snapshot,
    history: [{ ...snapshot.history[0], wordCount: 200, durationSeconds: 60 }],
  };
  await act(async () => onState());
  await waitFor(() =>
    expect(words.closest(".stat-card")).toHaveTextContent(/200\s*words/),
  );
  expect(
    screen.getByText("Estimated time saved").closest(".stat-card"),
  ).toHaveTextContent(/4\s*min/);
  await act(async () => onSession(emptySession));
  expect(container.querySelector(".waveform")).toBeNull();
});

it("updates dictation readiness after a completed download without remounting", async () => {
  render(<App />);
  await waitFor(() =>
    expect(
      screen.getByRole("status", { name: "Dictation status" }),
    ).toHaveTextContent("Setup required"),
  );
  snapshot.models[0].installed = true;
  await act(async () =>
    onDownload({
      id: "whisper-turbo",
      completed: 1,
      total: 1,
      state: "complete",
    }),
  );
  await waitFor(() =>
    expect(
      screen.getByRole("status", { name: "Dictation status" }),
    ).toHaveTextContent("Ready"),
  );
});

it("does not rebuild saved history rows for audio events and still displays fresh history", async () => {
  const readDate = vi.fn(() => "2026-10-24T12:00:00Z");
  snapshot.history = Array.from({ length: 80 }, (_, index) => ({
    id: String(index),
    get createdAt() {
      return readDate();
    },
    rawText: `Synthetic speech ${index}`,
    text: `Saved transcript ${index}`,
    language: "en",
    app: "Test editor",
    durationSeconds: 2,
    wordCount: 3,
    mode: "local",
    inserted: true,
  }));
  // Preserve payload identity so accessor reads measure rendering, not cloning.
  bridge.getSnapshot.mockImplementation(async () => snapshot);
  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: "History" }));
  expect(
    screen.getAllByRole("button", { name: /^Saved transcript / }),
  ).toHaveLength(80);
  const initialReads = readDate.mock.calls.length;
  for (const level of [0.1, 0.5, 0.8]) {
    await act(async () =>
      onSession({ ...emptySession, status: "recording", level }),
    );
  }
  expect(readDate).toHaveBeenCalledTimes(initialReads);
  fireEvent.change(screen.getByRole("textbox", { name: "Search history" }), {
    target: { value: "transcript 79" },
  });
  expect(
    screen.getAllByRole("button", { name: /^Saved transcript / }),
  ).toHaveLength(1);
  snapshot = {
    ...snapshot,
    history: [{ ...snapshot.history[79], text: "Updated transcript 79" }],
  };
  await act(async () => onState());
  expect(
    screen.getByRole("button", { name: "Updated transcript 79" }),
  ).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "Saved transcript 79" }),
  ).toBeNull();
});

it("shows loading, loaded and unloaded memory state from backend events", async () => {
  render(<App />);
  await waitFor(() =>
    expect(
      screen.getByRole("status", { name: "Dictation status" }),
    ).toHaveTextContent("Setup required"),
  );
  fireEvent.click(screen.getByRole("button", { name: "Local models" }));
  const status = screen.getByRole("status", {
    name: "Speech model memory status",
  });
  expect(status).toHaveTextContent("Unloaded");
  snapshot.engineStatus!.speech = {
    modelId: "whisper-turbo",
    device: "cpu",
    state: "loading",
  };
  await act(async () => onState());
  await waitFor(() => expect(status).toHaveTextContent("Loading"));
  snapshot.engineStatus!.speech.state = "loaded";
  await act(async () => onState());
  await waitFor(() => expect(status).toHaveTextContent("Loaded"));
  snapshot.engineStatus!.speech = {
    modelId: null,
    device: null,
    state: "unloaded",
  };
  await act(async () => onState());
  await waitFor(() => expect(status).toHaveTextContent("Unloaded"));
});

it("reflects saved settings from another window while preserving an in-flight local edit", async () => {
  render(<App />);
  const language = await screen.findByRole("combobox", {
    name: "Quick dictation language",
  });
  snapshot.settings.transcription.language = "pl";
  await act(async () => onState());
  await waitFor(() => expect(language).toHaveValue("pl"));
  let finishSave!: () => void;
  bridge.saveSettings.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finishSave = resolve;
      }),
  );
  fireEvent.change(language, { target: { value: "en" } });
  await waitFor(() => expect(bridge.saveSettings).toHaveBeenCalled());
  await act(async () => onState());
  expect(language).toHaveValue("en");
  snapshot.settings.transcription.language = "en";
  await act(async () => finishSave());
  await waitFor(() => expect(language).toHaveValue("en"));
});

it("keeps settings controls steady during queued saves and locks them only for active dictation", async () => {
  const saves: { settings: typeof snapshot.settings; finish: () => void }[] =
    [];
  bridge.saveSettings.mockImplementation(
    (settings: typeof snapshot.settings) =>
      new Promise<void>((resolve) => {
        saves.push({
          settings,
          finish() {
            snapshot.settings = settings;
            resolve();
          },
        });
      }),
  );
  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: "Settings" }));
  const ducking = screen.getByRole("switch", {
    name: "Lower background audio while speaking",
  });
  const history = screen.getByRole("switch", {
    name: "Save transcript history",
  });
  const fieldset = ducking.closest("fieldset")!;
  const disabledChanges: MutationRecord[] = [];
  const observer = new MutationObserver((changes) =>
    disabledChanges.push(...changes),
  );
  observer.observe(fieldset, {
    attributes: true,
    attributeFilter: ["disabled"],
  });
  try {
    fireEvent.click(ducking);
    await waitFor(() => expect(saves).toHaveLength(1));
    expect(ducking).toHaveAttribute("aria-checked", "true");
    expect(ducking).toBeEnabled();
    expect(history).toBeEnabled();
    fireEvent.click(history);
    expect(history).toHaveAttribute("aria-checked", "false");
    await act(async () => saves[0].finish());
    await waitFor(() => expect(saves).toHaveLength(2));
    expect(saves[1].settings.general).toMatchObject({
      duckBackgroundAudio: true,
      saveHistory: false,
    });
    await act(async () => saves[1].finish());
    await screen.findByText("Saved locally");
    expect(disabledChanges).toHaveLength(0);
    expect(ducking).toBeEnabled();
    expect(history).toBeEnabled();
    await act(async () => onSession({ ...emptySession, status: "recording" }));
    expect(ducking).toBeDisabled();
    expect(history).toBeDisabled();
    await act(async () => onSession(emptySession));
    expect(ducking).toBeEnabled();
  } finally {
    observer.disconnect();
  }
});

it("ignores an older delayed snapshot after a newer model update", async () => {
  render(<App />);
  await waitFor(() =>
    expect(
      screen.getByRole("status", { name: "Dictation status" }),
    ).toHaveTextContent("Setup required"),
  );
  let finishOld!: (value: Snapshot) => void;
  const oldSnapshot = structuredClone(snapshot);
  bridge.getSnapshot.mockImplementationOnce(
    () =>
      new Promise<Snapshot>((resolve) => {
        finishOld = resolve;
      }),
  );
  await act(async () => onState());
  snapshot.models[0].installed = true;
  await act(async () => onState());
  await waitFor(() =>
    expect(
      screen.getByRole("status", { name: "Dictation status" }),
    ).toHaveTextContent("Ready"),
  );
  await act(async () => finishOld(oldSnapshot));
  expect(
    screen.getByRole("status", { name: "Dictation status" }),
  ).toHaveTextContent("Ready");
});

it("ignores an older startup response after a newer backend state event", async () => {
  let finishStartup!: (value: Snapshot) => void;
  const oldSnapshot = structuredClone(snapshot);
  bridge.getSnapshot.mockImplementationOnce(
    () =>
      new Promise<Snapshot>((resolve) => {
        finishStartup = resolve;
      }),
  );
  render(<App />);
  await waitFor(() => expect(bridge.events).toHaveBeenCalled());
  snapshot.models[0].installed = true;
  snapshot.settings.transcription.language = "pl";
  await act(async () => onState());
  await waitFor(() =>
    expect(
      screen.getByRole("status", { name: "Dictation status" }),
    ).toHaveTextContent("Ready"),
  );
  await act(async () => finishStartup(oldSnapshot));
  expect(
    screen.getByRole("status", { name: "Dictation status" }),
  ).toHaveTextContent("Ready");
  expect(
    screen.getByRole("combobox", { name: "Quick dictation language" }),
  ).toHaveValue("pl");
});

it("preserves a live recording event that arrives before the startup snapshot", async () => {
  let finishStartup!: (value: Snapshot) => void;
  bridge.getSnapshot.mockImplementationOnce(
    () =>
      new Promise<Snapshot>((resolve) => {
        finishStartup = resolve;
      }),
  );
  render(<App />);
  await waitFor(() => expect(bridge.events).toHaveBeenCalled());
  await act(async () =>
    onSession({
      ...emptySession,
      status: "recording",
      level: 0.4,
      preview: "Synthetic live preview",
    }),
  );
  await act(async () => finishStartup({ ...snapshot, session: emptySession }));
  expect(
    screen.getByRole("status", { name: "Dictation status" }),
  ).toHaveTextContent("Recording");
  expect(screen.getByText("Synthetic live preview")).toBeVisible();
  expect(screen.getByRole("button", { name: "Stop recording" })).toBeVisible();
});

it("reports a failed event connection without an unhandled rejection", async () => {
  bridge.events.mockRejectedValueOnce(new Error("Scripted listener failure"));
  render(<App />);
  await waitFor(() =>
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Live updates could not be connected",
    ),
  );
});

it("does not notify or start a toast timer for a subscription failure after unmount", async () => {
  let failEvents!: (error: Error) => void;
  bridge.events.mockImplementationOnce(
    () =>
      new Promise<() => void>((_resolve, reject) => {
        failEvents = reject;
      }),
  );
  const view = render(<App />);
  await screen.findByRole("status", { name: "Dictation status" });
  view.unmount();
  const timer = vi.spyOn(globalThis, "setTimeout");
  await act(async () =>
    failEvents(new Error("Scripted late listener failure")),
  );
  expect(timer).not.toHaveBeenCalled();
  timer.mockRestore();
});

it("clears stale active progress from a fresh authoritative snapshot when the terminal event was missed", async () => {
  snapshot.activeDownloads = {
    "whisper-turbo": {
      id: "whisper-turbo",
      state: "downloading",
      completed: 0,
      total: 1,
    },
  };
  render(<App />);
  const models = await screen.findByRole("button", { name: "Local models" });
  expect(models.querySelector(".nav-count")).toHaveTextContent("1");
  snapshot.activeDownloads = {};
  snapshot.models[0].installed = true;
  await act(async () => onState());
  await waitFor(() => expect(models.querySelector(".nav-count")).toBeNull());
  expect(
    screen.getByRole("status", { name: "Dictation status" }),
  ).toHaveTextContent("Ready");
});

it("keeps terminal progress when an older model snapshot returns after completion", async () => {
  snapshot.activeDownloads = {
    "whisper-turbo": {
      id: "whisper-turbo",
      state: "downloading",
      completed: 0,
      total: 1,
    },
  };
  render(<App />);
  const models = await screen.findByRole("button", { name: "Local models" });
  const oldSnapshot = structuredClone(snapshot);
  let finishOld!: (value: Snapshot) => void;
  let finishCurrent!: (value: Snapshot) => void;
  bridge.getSnapshot
    .mockImplementationOnce(
      () =>
        new Promise<Snapshot>((resolve) => {
          finishOld = resolve;
        }),
    )
    .mockImplementationOnce(
      () =>
        new Promise<Snapshot>((resolve) => {
          finishCurrent = resolve;
        }),
    );
  await act(async () => onState());
  snapshot.activeDownloads = {};
  snapshot.models[0].installed = true;
  await act(async () =>
    onDownload({
      id: "whisper-turbo",
      state: "complete",
      completed: 1,
      total: 1,
    }),
  );
  expect(models.querySelector(".nav-count")).toBeNull();
  await act(async () => finishCurrent(structuredClone(snapshot)));
  await act(async () => finishOld(oldSnapshot));
  expect(models.querySelector(".nav-count")).toBeNull();
  expect(
    screen.getByRole("status", { name: "Dictation status" }),
  ).toHaveTextContent("Ready");
});

it("preserves a new queued job received while an older empty snapshot is in flight", async () => {
  snapshot.activeDownloads = {};
  render(<App />);
  const models = await screen.findByRole("button", { name: "Local models" });
  const oldSnapshot = structuredClone(snapshot);
  let finishOld!: (value: Snapshot) => void;
  bridge.getSnapshot.mockImplementationOnce(
    () =>
      new Promise<Snapshot>((resolve) => {
        finishOld = resolve;
      }),
  );
  await act(async () => onState());
  await act(async () =>
    onDownload({
      id: "whisper-turbo",
      state: "queued",
      completed: 0,
      total: 1,
    }),
  );
  await act(async () => finishOld(oldSnapshot));
  expect(models.querySelector(".nav-count")).toHaveTextContent("1");
  expect(
    screen.getByRole("status", { name: "Dictation status" }),
  ).toHaveTextContent("Setup required");
});

it("persists separate code and generation modes with a freeform hint across Overview and Writing styles", async () => {
  snapshot.settings.cleanup.mode = "provider";
  snapshot.settings.cleanup.providerId = "text-provider";
  snapshot.settings.providers = [
    {
      id: "text-provider",
      name: "Test provider",
      protocol: "openai",
      baseUrl: "http://127.0.0.1:1234/v1",
      model: "test-model",
      sttModel: "",
      hasKey: false,
    },
  ];
  bridge.saveSettings.mockImplementation(async (settings) => {
    snapshot.settings = structuredClone(settings);
  });
  render(<App />);
  const output = await screen.findByLabelText("Output mode");
  expect(output).toHaveValue("text");
  for (const mode of ["code", "generate"]) {
    fireEvent.change(output, { target: { value: mode } });
    await waitFor(() =>
      expect(snapshot.settings.cleanup.outputMode).toBe(mode),
    );
    await waitFor(() => expect(output).not.toBeDisabled());
  }
  fireEvent.change(screen.getByLabelText("Code language or shell"), {
    target: { value: "manual" },
  });
  const hint = screen.getByLabelText("Language or shell override");
  fireEvent.change(hint, { target: { value: "Nushell / custom DSL" } });
  fireEvent.blur(hint);
  await waitFor(() =>
    expect(snapshot.settings.cleanup.codeLanguage).toBe("Nushell / custom DSL"),
  );
  await waitFor(() => expect(output).not.toBeDisabled());
  fireEvent.click(screen.getByRole("button", { name: "Writing styles" }));
  expect(screen.getByLabelText("Output mode")).toHaveValue("generate");
  expect(screen.getByLabelText("Language or shell override")).toHaveValue(
    "Nushell / custom DSL",
  );
  expect(snapshot.settings.cleanup.style).toBe("faithful");
});

it("shows captured generated output on Overview with exact whitespace and copying after settings change", async () => {
  const writeText = vi.fn(async (_value: string) => {});
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  });
  render(<App />);
  fireEvent.click(
    await screen.findByRole("button", { name: "Writing styles" }),
  );
  const code = "def greet(name):\n    return f'Hello {name}'\n";
  await act(async () =>
    onSession({
      ...emptySession,
      outputMode: "generate",
      codingLanguage: "Python",
      reviewRequired: true,
      result: code,
    }),
  );
  const output = screen.getByLabelText("Code or command output");
  expect(output.tagName).toBe("PRE");
  expect(output.textContent).toBe(code);
  expect(
    screen.getByText("Generated output opens here for review and copying."),
  ).toBeVisible();
  expect(screen.getByRole("button", { name: "Overview" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await act(async () => onState());
  expect(output.textContent).toBe(code);
  fireEvent.click(screen.getByRole("button", { name: "Copy" }));
  await waitFor(() => expect(writeText).toHaveBeenCalledWith(code));
  fireEvent.click(screen.getByRole("button", { name: "History" }));
  await act(async () =>
    onSession({
      ...emptySession,
      outputMode: "generate",
      codingLanguage: "Python",
      reviewRequired: true,
      result: code,
    }),
  );
  expect(screen.getByRole("button", { name: "History" })).toHaveAttribute(
    "aria-current",
    "page",
  );
});

it("opens multiline terminal dictation for review and disables coding controls for an active take", async () => {
  render(<App />);
  await screen.findByLabelText("Output mode");
  await act(async () =>
    onSession({
      ...emptySession,
      status: "recording",
      outputMode: "code",
      codingLanguage: "PowerShell",
    }),
  );
  expect(screen.getByLabelText("Output mode")).toBeDisabled();
  expect(screen.getByLabelText("Code language or shell")).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Writing styles" }));
  await act(async () =>
    onSession({
      ...emptySession,
      outputMode: "code",
      codingLanguage: "PowerShell",
      reviewRequired: true,
      result: "git status\ngit log --oneline\n",
    }),
  );
  expect(screen.getByLabelText("Code or command output").textContent).toBe(
    "git status\ngit log --oneline\n",
  );
  expect(
    screen.getByText(
      "Multiline terminal output opens here for review and copying.",
    ),
  ).toBeVisible();
});

it("labels failed generation as a raw transcript without claiming it is generated code", async () => {
  render(<App />);
  fireEvent.click(
    await screen.findByRole("button", { name: "Writing styles" }),
  );
  await act(async () =>
    onSession({
      ...emptySession,
      status: "error",
      outputMode: "generate",
      codingLanguage: null,
      resultIsRaw: true,
      result: "write a script that lists files",
      error:
        "Text cleanup failed: Scripted failure. The raw transcript was saved.",
    }),
  );
  expect(screen.getByText("Raw transcript")).toBeVisible();
  expect(screen.queryByLabelText("Code or command output")).toBeNull();
  expect(screen.queryByText("Generated output")).toBeNull();
  expect(screen.getByText("write a script that lists files")).toBeVisible();
  expect(screen.getByRole("button", { name: "Overview" })).toHaveAttribute(
    "aria-current",
    "page",
  );
});

it("keeps successful code formatting when only target insertion failed", async () => {
  render(<App />);
  await screen.findByLabelText("Output mode");
  const code = "git status\n";
  await act(async () =>
    onSession({
      ...emptySession,
      status: "error",
      outputMode: "code",
      codingLanguage: "Bash",
      resultIsRaw: false,
      result: code,
      error: "Target insertion failed: Scripted clipboard failure.",
    }),
  );
  expect(screen.getByText("Dictated code or commands")).toBeVisible();
  expect(screen.queryByText("Raw transcript")).toBeNull();
  expect(screen.getByLabelText("Code or command output").textContent).toBe(
    code,
  );
});

it("opens successful generated output for review even when saving history failed", async () => {
  render(<App />);
  fireEvent.click(
    await screen.findByRole("button", { name: "Writing styles" }),
  );
  const code = "def greet(name):\n    return f'Hello {name}'\n";
  await act(async () =>
    onSession({
      ...emptySession,
      status: "error",
      outputMode: "generate",
      codingLanguage: "Python",
      resultIsRaw: false,
      reviewRequired: true,
      result: code,
      error:
        "History could not be saved. The result is still available to copy.",
    }),
  );
  expect(screen.getByRole("button", { name: "Overview" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  expect(screen.getByText("Generated output")).toBeVisible();
  expect(screen.queryByText("Raw transcript")).toBeNull();
  expect(screen.getByLabelText("Code or command output").textContent).toBe(
    code,
  );
  expect(screen.getByRole("button", { name: "Copy" })).toBeEnabled();
  expect(
    screen.getByText(
      "History could not be saved. The result is still available to copy.",
    ),
  ).toBeVisible();
});
