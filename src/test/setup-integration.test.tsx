import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { clearMocks, mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { emit } from "@tauri-apps/api/event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultSettings } from "../types";
import type { DownloadProgress, Settings, Snapshot } from "../types";

let App: (typeof import("../App"))["default"];
let snapshot: Snapshot;
let calls: { command: string; args: Record<string, unknown> }[];
let downloads: Map<
  string,
  { resolve: () => void; reject: (reason: string) => void }
>;
let credentialFailure: boolean;
let snapshotScript: Snapshot[];
let collideWithQwenJob: boolean;

function fixture(): Snapshot {
  return {
    settings: structuredClone(defaultSettings),
    history: [],
    hardware: {
      cpu: "Test CPU",
      ramGb: 32,
      threads: 8,
      cudaAvailable: true,
      gpus: [{ name: "Test NVIDIA GPU", vramMb: 16384 }],
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
      {
        id: "llama-cpu",
        name: "llama.cpp CPU runtime",
        kind: "runtime",
        installed: false,
      },
    ].map((asset) => ({
      ...asset,
      kind: asset.kind as Snapshot["models"][number]["kind"],
      description: "Synthetic test asset",
      sizeBytes: 100,
      license: "Test",
      files: [],
    })),
    version: "test",
    portable: true,
    dataDir: "Test data",
  };
}

beforeEach(async () => {
  vi.resetModules();
  vi.stubGlobal("isTauri", true);
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
  snapshot = fixture();
  calls = [];
  downloads = new Map();
  credentialFailure = false;
  snapshotScript = [];
  collideWithQwenJob = false;
  mockIPC(
    async (command, payload) => {
      const args = (payload || {}) as Record<string, unknown>;
      calls.push({ command, args: structuredClone(args) });
      if (command === "get_snapshot")
        return structuredClone(snapshotScript.shift() || snapshot);
      if (command === "save_settings" || command === "complete_setup") {
        snapshot.settings = structuredClone(args.settings as Settings);
        return;
      }
      if (command === "set_provider_key") {
        if (credentialFailure) throw "Encrypted credential storage failed.";
        return;
      }
      if (command === "download_model") {
        if (collideWithQwenJob && args.id === "qwen3-4b") {
          collideWithQwenJob = false;
          snapshot.activeDownloads = {
            ...snapshot.activeDownloads,
            "qwen3-4b": {
              id: "qwen3-4b",
              state: "downloading",
              completed: 0,
              total: 100,
            },
          };
          throw "This model is already downloading.";
        }
        return new Promise<void>((resolve, reject) =>
          downloads.set(args.id as string, { resolve, reject }),
        );
      }
      if (command === "cancel_download") {
        downloads
          .get(args.id as string)
          ?.reject("Download paused. Download again to resume.");
        return;
      }
    },
    { shouldMockEvents: true },
  );
  mockWindows("main");
  App = (await import("../App")).default;
});

afterEach(() => {
  cleanup();
  clearMocks();
  vi.unstubAllGlobals();
});

async function finalStep() {
  await screen.findByRole("dialog", { name: "Set up CridVoice" });
  for (let i = 0; i < 3; i++)
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  return screen.findByRole("region", { name: "Required local components" });
}
async function progress(
  id: string,
  state: DownloadProgress["state"],
  completed = 50,
) {
  await act(async () => emit("download", { id, state, completed, total: 100 }));
}
async function complete(id: string) {
  const asset = snapshot.models.find((model) => model.id === id)!;
  asset.installed = true;
  await act(async () => {
    await emit("download", {
      id,
      state: "complete",
      completed: 100,
      total: 100,
    });
    await emit("models-updated");
    downloads.get(id)!.resolve();
  });
}
function savedSettings() {
  return calls
    .filter(
      (call) =>
        call.command === "save_settings" || call.command === "complete_setup",
    )
    .map((call) => call.args.settings as Settings);
}

describe("Setup uses the desktop bridge and installation events", () => {
  it("repairs only the missing independent preview model and does not start its download before the install action", async () => {
    snapshot.settings.setupComplete = true;
    snapshot.models.forEach((model) => {
      model.installed = model.id !== "whisper-preview";
    });
    render(<App />);
    await screen.findByRole("dialog", { name: "Set up CridVoice" });
    expect(
      screen.getByRole("status", { name: "Whisper Tiny preview setup status" }),
    ).toHaveTextContent("Waiting");
    expect(downloads.size).toBe(0);
    fireEvent.click(
      screen.getByRole("button", {
        name: "Install required components & finish",
      }),
    );
    await waitFor(() => expect(downloads.has("whisper-preview")).toBe(true));
    expect(savedSettings()).toEqual([]);
    await progress("whisper-preview", "verifying", 100);
    expect(
      screen.getByRole("status", { name: "Whisper Tiny preview setup status" }),
    ).toHaveTextContent("Verifying");
    await complete("whisper-preview");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(
      calls
        .filter((call) => call.command === "download_model")
        .map((call) => call.args.id),
    ).toEqual(["whisper-preview"]);
    expect(savedSettings().at(-1)?.transcription.modelId).toBe("whisper-turbo");
    expect(savedSettings().at(-1)?.appearance.livePreview).toBe(true);
  });
  it("lists missing cleanup dependencies, installs them sequentially, skips installed speech and saves only after readiness", async () => {
    render(<App />);
    const components = await finalStep();
    expect(within(components).getByText("Whisper Turbo")).toBeInTheDocument();
    expect(
      within(components).getByText("NVIDIA speech runtime"),
    ).toBeInTheDocument();
    expect(within(components).getByText("Qwen3 4B")).toBeInTheDocument();
    expect(
      within(components).getByText("llama.cpp GPU runtime"),
    ).toBeInTheDocument();
    expect(
      within(components).queryByText("llama.cpp CPU runtime"),
    ).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", {
        name: "Install required components & finish",
      }),
    );
    await waitFor(() => expect(downloads.has("qwen3-4b")).toBe(true));
    expect(downloads.has("llama-gpu")).toBe(false);
    expect(savedSettings()).toEqual([]);
    await progress("qwen3-4b", "downloading");
    expect(
      screen.getByRole("status", { name: "Qwen3 4B setup status" }),
    ).toHaveTextContent(/Downloading/);
    await progress("qwen3-4b", "verifying", 100);
    expect(
      screen.getByRole("status", { name: "Qwen3 4B setup status" }),
    ).toHaveTextContent(/Verifying/);
    await complete("qwen3-4b");
    await waitFor(() => expect(downloads.has("llama-gpu")).toBe(true));
    expect(savedSettings()).toEqual([]);
    await progress("llama-gpu", "extracting", 100);
    expect(
      screen.getByRole("status", {
        name: "llama.cpp GPU runtime setup status",
      }),
    ).toHaveTextContent(/Extracting/);
    await complete("llama-gpu");
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Set up CridVoice" }),
      ).not.toBeInTheDocument(),
    );
    expect(
      calls
        .filter((call) => call.command === "download_model")
        .map((call) => call.args.id),
    ).toEqual(["qwen3-4b", "llama-gpu"]);
    expect(savedSettings().at(-1)?.setupComplete).toBe(true);
    expect(
      screen.getByRole("status", { name: "Dictation status" }),
    ).toHaveTextContent("Ready");
  });

  it("keeps setup open after failure and retries only components still missing", async () => {
    render(<App />);
    await finalStep();
    fireEvent.click(
      screen.getByRole("button", {
        name: "Install required components & finish",
      }),
    );
    await waitFor(() => expect(downloads.has("qwen3-4b")).toBe(true));
    await complete("qwen3-4b");
    await waitFor(() => expect(downloads.has("llama-gpu")).toBe(true));
    await act(async () => {
      await emit("download", {
        id: "llama-gpu",
        state: "error",
        completed: 0,
        total: 100,
        error: "Synthetic runtime download failure.",
      });
      downloads.get("llama-gpu")!.reject("Synthetic runtime download failure.");
    });
    expect(savedSettings()).toEqual([]);
    expect(
      screen.getByRole("dialog", { name: "Set up CridVoice" }),
    ).toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: "Retry setup" }));
    await waitFor(() =>
      expect(
        calls.filter(
          (call) =>
            call.command === "download_model" && call.args.id === "llama-gpu",
        ),
      ).toHaveLength(2),
    );
    await complete("llama-gpu");
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Set up CridVoice" }),
      ).not.toBeInTheDocument(),
    );
    expect(
      calls.filter(
        (call) =>
          call.command === "download_model" && call.args.id === "qwen3-4b",
      ),
    ).toHaveLength(1);
  });

  it("does not claim completion when a successful download command leaves installation markers absent", async () => {
    render(<App />);
    await finalStep();
    fireEvent.click(
      screen.getByRole("button", {
        name: "Install required components & finish",
      }),
    );
    await waitFor(() => expect(downloads.has("qwen3-4b")).toBe(true));
    await act(async () => downloads.get("qwen3-4b")!.resolve());
    await screen.findByRole("button", { name: "Retry setup" });
    expect(savedSettings()).toEqual([]);
    expect(downloads.has("llama-gpu")).toBe(false);
    expect(
      screen.getByRole("dialog", { name: "Set up CridVoice" }),
    ).toBeInTheDocument();
  });

  it("keeps credential failures incomplete and never includes a key in saved settings", async () => {
    snapshot.settings.providers = [
      {
        id: "existing-cloud",
        name: "Existing cloud",
        protocol: "openai",
        baseUrl: "https://cloud.example/v1",
        model: "text-model",
        sttModel: "speech-model",
        hasKey: false,
      },
    ];
    snapshot.settings.transcription.mode = "openai";
    snapshot.settings.transcription.providerId = "existing-cloud";
    snapshot.settings.cleanup.mode = "provider";
    snapshot.settings.cleanup.providerId = "existing-cloud";
    credentialFailure = true;
    render(<App />);
    const key = "dummy-test-key-never-a-real-secret";
    fireEvent.change(await screen.findByLabelText(/^API key/), {
      target: { value: key },
    });
    await finalStep();
    fireEvent.click(screen.getByRole("button", { name: "Finish setup" }));
    await screen.findByRole("button", { name: "Retry setup" });
    expect(calls.some((call) => call.command === "set_provider_key")).toBe(
      true,
    );
    expect(calls.some((call) => call.command === "complete_setup")).toBe(false);
    expect(savedSettings().every((settings) => !settings.setupComplete)).toBe(
      true,
    );
    expect(JSON.stringify(savedSettings())).not.toContain(key);
    expect(
      screen.getByRole("dialog", { name: "Set up CridVoice" }),
    ).toBeInTheDocument();
  });

  it("pauses an active setup and resumes the missing component without saving incomplete settings", async () => {
    render(<App />);
    await finalStep();
    fireEvent.click(
      screen.getByRole("button", {
        name: "Install required components & finish",
      }),
    );
    await waitFor(() => expect(downloads.has("qwen3-4b")).toBe(true));
    fireEvent.click(screen.getByRole("button", { name: "Pause setup" }));
    await screen.findByRole("button", { name: "Resume setup" });
    expect(
      calls.some(
        (call) =>
          call.command === "cancel_download" && call.args.id === "qwen3-4b",
      ),
    ).toBe(true);
    expect(savedSettings()).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Resume setup" }));
    await waitFor(() =>
      expect(
        calls.filter(
          (call) =>
            call.command === "download_model" && call.args.id === "qwen3-4b",
        ),
      ).toHaveLength(2),
    );
    await complete("qwen3-4b");
    await waitFor(() => expect(downloads.has("llama-gpu")).toBe(true));
    await complete("llama-gpu");
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Set up CridVoice" }),
      ).not.toBeInTheDocument(),
    );
  });

  it("preserves independent provider routes and stored credentials when completing repair without changing them", async () => {
    snapshot.settings.setupComplete = true;
    snapshot.settings.providers = [
      {
        id: "speech-account",
        name: "Existing speech",
        protocol: "openai",
        baseUrl: "https://speech.example/v1",
        model: "",
        sttModel: "audio-model",
        hasKey: true,
      },
      {
        id: "cleanup-account",
        name: "Existing cleanup",
        protocol: "anthropic",
        baseUrl: "https://cleanup.example/v1",
        model: "text-model",
        sttModel: "",
        hasKey: true,
      },
    ];
    snapshot.settings.transcription.mode = "openai";
    snapshot.settings.transcription.providerId = "speech-account";
    snapshot.settings.cleanup.mode = "provider";
    snapshot.settings.cleanup.providerId = "cleanup-account";
    const original = structuredClone(snapshot.settings);
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Settings" }));
    fireEvent.click(
      await screen.findByRole("button", {
        name: /setup wizard|run setup|repair setup/i,
      }),
    );
    await screen.findByRole("dialog", { name: "Set up CridVoice" });
    fireEvent.click(screen.getByRole("button", { name: "Finish setup" }));
    await waitFor(() => expect(savedSettings().length).toBeGreaterThan(0));
    expect(savedSettings().at(-1)?.transcription).toEqual(
      original.transcription,
    );
    expect(savedSettings().at(-1)?.cleanup).toEqual(original.cleanup);
    expect(savedSettings().at(-1)?.providers).toEqual(original.providers);
    expect(calls.some((call) => call.command === "set_provider_key")).toBe(
      false,
    );
    expect(calls.some((call) => call.command === "download_model")).toBe(false);
  });

  it("rejoins an existing active download from snapshot state instead of starting a duplicate", async () => {
    snapshot.settings.setupComplete = true;
    snapshot.activeDownloads = {
      "qwen3-4b": {
        id: "qwen3-4b",
        state: "downloading",
        completed: 50,
        total: 100,
      },
    };
    render(<App />);
    await screen.findByRole("dialog", { name: "Set up CridVoice" });
    expect(
      screen.getByRole("status", { name: "Qwen3 4B setup status" }),
    ).toHaveTextContent("Downloading");
    fireEvent.click(
      screen.getByRole("button", {
        name: "Install required components & finish",
      }),
    );
    await act(async () => {
      snapshot.models.find((model) => model.id === "qwen3-4b")!.installed =
        true;
      delete snapshot.activeDownloads!["qwen3-4b"];
      await emit("models-updated");
    });
    await waitFor(() => expect(downloads.has("llama-gpu")).toBe(true));
    expect(
      calls.some(
        (call) =>
          call.command === "download_model" && call.args.id === "qwen3-4b",
      ),
    ).toBe(false);
    await complete("llama-gpu");
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Set up CridVoice" }),
      ).not.toBeInTheDocument(),
    );
  });

  it("preserves raw transcript mode and does not install unused cleanup assets", async () => {
    snapshot.settings.cleanup.mode = "off";
    render(<App />);
    const components = await finalStep();
    expect(within(components).queryByText("Qwen3 4B")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Finish setup" }));
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Set up CridVoice" }),
      ).not.toBeInTheDocument(),
    );
    expect(savedSettings().at(-1)?.cleanup.mode).toBe("off");
    expect(calls.some((call) => call.command === "download_model")).toBe(false);
  });

  it("joins a job started between the snapshot and download command instead of failing setup", async () => {
    collideWithQwenJob = true;
    render(<App />);
    await finalStep();
    fireEvent.click(
      screen.getByRole("button", {
        name: "Install required components & finish",
      }),
    );
    await waitFor(() =>
      expect(
        calls.some(
          (call) =>
            call.command === "download_model" && call.args.id === "qwen3-4b",
        ),
      ).toBe(true),
    );
    expect(
      screen.queryByRole("button", { name: "Retry setup" }),
    ).not.toBeInTheDocument();
    expect(savedSettings()).toEqual([]);
    await act(async () => {
      snapshot.models.find((model) => model.id === "qwen3-4b")!.installed =
        true;
      delete snapshot.activeDownloads!["qwen3-4b"];
      await emit("models-updated");
    });
    await waitFor(() => expect(downloads.has("llama-gpu")).toBe(true));
    await complete("llama-gpu");
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Set up CridVoice" }),
      ).not.toBeInTheDocument(),
    );
    expect(
      calls.filter(
        (call) =>
          call.command === "download_model" && call.args.id === "qwen3-4b",
      ),
    ).toHaveLength(1);
    expect(savedSettings().at(-1)?.setupComplete).toBe(true);
  });

  it("confirms a fresh installed marker after a completion snapshot loses the active job entry", async () => {
    snapshot.settings.setupComplete = true;
    snapshot.settings.transcription.mode = "openai";
    snapshot.settings.transcription.providerId = "existing-speech";
    snapshot.settings.providers = [
      {
        id: "existing-speech",
        name: "Speech",
        protocol: "openai",
        baseUrl: "https://speech.example/v1",
        model: "",
        sttModel: "speech-model",
        hasKey: true,
      },
    ];
    snapshot.models.find((model) => model.id === "llama-gpu")!.installed = true;
    snapshot.activeDownloads = {
      "qwen3-4b": {
        id: "qwen3-4b",
        state: "downloading",
        completed: 50,
        total: 100,
      },
    };
    render(<App />);
    await screen.findByRole("dialog", { name: "Set up CridVoice" });
    const working = structuredClone(snapshot);
    const tornCompletion = structuredClone(snapshot);
    tornCompletion.activeDownloads = {};
    // Initial plan and per-component checks see the active job. The following
    // poll reads markers before completion, but reads the job map after exit.
    snapshotScript = [working, working, tornCompletion];
    snapshot.models.find((model) => model.id === "qwen3-4b")!.installed = true;
    snapshot.activeDownloads = {};
    fireEvent.click(
      screen.getByRole("button", {
        name: "Install required components & finish",
      }),
    );
    await waitFor(() => expect(snapshotScript).toHaveLength(0));
    expect(savedSettings()).toEqual([]);
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Set up CridVoice" }),
      ).not.toBeInTheDocument(),
    );
    expect(calls.some((call) => call.command === "download_model")).toBe(false);
    expect(savedSettings().at(-1)?.setupComplete).toBe(true);
  });
});
