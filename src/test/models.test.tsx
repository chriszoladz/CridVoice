import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { command, warmSelectedModels } from "../bridge";
import { Models } from "../panels";
import { selectedLocalModels } from "../localModelStatus";
import { defaultSettings } from "../types";
import type { EngineStatus, Snapshot } from "../types";

vi.mock("../bridge", () => ({ command: vi.fn(), warmSelectedModels: vi.fn() }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function snapshot(speech: EngineStatus, cleanupStatus: EngineStatus): Snapshot {
  const result: Snapshot = {
    settings: structuredClone(defaultSettings),
    history: [],
    hardware: {
      cpu: "Test CPU",
      ramGb: 16,
      gpus: [],
      cudaAvailable: false,
      threads: 4,
    },
    models: [
      {
        id: "whisper-preview",
        name: "Whisper Tiny preview",
        kind: "preview",
        description: "Independent CPU preview",
        sizeBytes: 78203619,
        license: "MIT",
        files: [],
        installed: true,
      },
      {
        id: "whisper-small",
        name: "Whisper Small",
        kind: "speech",
        description: "Speech test model",
        sizeBytes: 100,
        license: "MIT",
        files: [],
        installed: true,
      },
      {
        id: "llama-cpu",
        name: "llama.cpp CPU runtime",
        kind: "runtime",
        description: "Runtime test model",
        sizeBytes: 100,
        license: "MIT",
        files: [],
        installed: true,
      },
      {
        id: "qwen3-4b",
        name: "Qwen3 4B",
        kind: "cleanup",
        description: "Cleanup test model",
        sizeBytes: 100,
        license: "Apache-2.0",
        files: [],
        installed: true,
      },
    ],
    engineStatus: {
      speech,
      preview: { modelId: "whisper-preview", device: "cpu", state: "loaded" },
      cleanup: cleanupStatus,
    },
    version: "0.1.0",
    portable: false,
    dataDir: "Test data",
  };
  result.settings.transcription.modelId = "whisper-small";
  return result;
}

const unloaded: EngineStatus = {
  modelId: null,
  device: null,
  state: "unloaded",
};

function panel(data: Snapshot, refresh = vi.fn(async () => {})) {
  return (
    <Models
      settings={data.settings}
      snapshot={data}
      update={vi.fn(async () => {})}
      refresh={refresh}
      notify={vi.fn()}
      downloads={{}}
    />
  );
}

describe("Live local model status", () => {
  it("matches preview CPU identity independently and excludes it for cloud speech or disabled preview", () => {
    const data = snapshot(unloaded, unloaded);
    data.engineStatus!.preview = {
      modelId: "whisper-preview",
      device: "cuda",
      state: "loaded",
    };
    const selected = () =>
      selectedLocalModels(
        data.settings,
        data.hardware,
        data.models,
        data.engineStatus,
      );
    expect(selected().find((model) => model.kind === "preview")).toMatchObject({
      modelId: "whisper-preview",
      device: "cpu",
      state: "unloaded",
      loadable: true,
    });
    data.models.find((model) => model.id === "whisper-preview")!.installed =
      false;
    expect(selected().find((model) => model.kind === "preview")?.loadable).toBe(
      false,
    );
    data.settings.appearance.livePreview = false;
    expect(selected().some((model) => model.kind === "preview")).toBe(false);
    data.settings.appearance.livePreview = true;
    data.settings.transcription.mode = "openai";
    expect(selected().some((model) => model.kind === "preview")).toBe(false);
  });
  it("queues selected models once and waits for live loaded status without claiming command completion means ready", async () => {
    let resolve!: () => void;
    vi.mocked(warmSelectedModels).mockImplementationOnce(
      () =>
        new Promise<void>((done) => {
          resolve = done;
        }),
    );
    const data = snapshot(unloaded, unloaded);
    const refresh = vi.fn(async () => {});
    const view = render(panel(data, refresh));
    const load = screen.getByRole("button", { name: "Load selected models" });
    fireEvent.click(load);
    fireEvent.click(load);
    expect(warmSelectedModels).toHaveBeenCalledOnce();
    expect(load).toBeDisabled();
    resolve();
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    expect(
      within(
        screen.getByRole("status", { name: "Speech model memory status" }),
      ).queryByText("Loaded"),
    ).toBeNull();
    data.engineStatus!.speech = {
      modelId: "whisper-small",
      device: "cpu",
      state: "loading",
    };
    view.rerender(panel(data, refresh));
    expect(
      screen.getByRole("button", { name: "Warming selected models" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Unload models from memory" }),
    ).toBeEnabled();
    data.engineStatus!.speech.state = "loaded";
    data.engineStatus!.cleanup = {
      modelId: "qwen3-4b",
      device: "cpu",
      state: "loaded",
    };
    view.rerender(panel(data, refresh));
    expect(
      screen.getByRole("button", { name: "Load selected models" }),
    ).toBeDisabled();
  });

  it("offers retry for a selected failed identity and stays retryable after enqueue rejection", async () => {
    const data = snapshot(
      { modelId: "whisper-small", device: "cpu", state: "error" },
      unloaded,
    );
    const notify = vi.fn();
    vi.mocked(warmSelectedModels).mockRejectedValueOnce(
      new Error("Scripted enqueue failure"),
    );
    render(
      <Models
        settings={data.settings}
        snapshot={data}
        update={vi.fn()}
        refresh={vi.fn(async () => {})}
        notify={notify}
        downloads={{}}
      />,
    );
    const retry = screen.getByRole("button", { name: "Retry model loading" });
    fireEvent.click(retry);
    await waitFor(() =>
      expect(notify).toHaveBeenCalledWith(
        "Error: Scripted enqueue failure",
        true,
      ),
    );
    expect(retry).toBeEnabled();
    expect(
      screen.getByRole("status", { name: "Speech model memory status" }),
    ).toHaveTextContent("Error");
  });

  it("requires installed selected runtime dependencies while permitting an independently ready speech route", () => {
    const data = snapshot(unloaded, unloaded);
    data.models.find((model) => model.id === "llama-cpu")!.installed = false;
    const view = render(panel(data));
    expect(
      screen.getByRole("button", { name: "Load selected models" }),
    ).toBeEnabled();
    data.settings.transcription.mode = "openai";
    view.rerender(panel(data));
    expect(
      screen.getByRole("button", { name: "Load selected models" }),
    ).toBeDisabled();
    data.models.find((model) => model.id === "llama-cpu")!.installed = true;
    view.rerender(panel(data));
    expect(
      screen.getByRole("button", { name: "Load selected models" }),
    ).toBeEnabled();
    data.settings.cleanup.mode = "provider";
    view.rerender(panel(data));
    expect(
      screen.getByRole("button", { name: "Load selected models" }),
    ).toBeDisabled();
    expect(warmSelectedModels).not.toHaveBeenCalled();
  });

  it("does not load or unload while a take or settings save is active", () => {
    const data = snapshot(unloaded, unloaded);
    render(
      <Models
        settings={data.settings}
        snapshot={data}
        update={vi.fn()}
        refresh={vi.fn(async () => {})}
        notify={vi.fn()}
        downloads={{}}
        controlsDisabled
      />,
    );
    expect(
      screen.getByRole("button", { name: "Load selected models" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Unload models from memory" }),
    ).toBeDisabled();
  });
  it("updates loading and loaded status without remounting and keeps installation separate", () => {
    const view = render(panel(snapshot(unloaded, unloaded)));
    const speech = screen.getByRole("status", {
      name: "Speech model memory status",
    });
    const card = screen.getByText("Whisper Small").closest(".model-card")!;
    expect(within(speech).getByText("Unloaded")).toBeInTheDocument();
    expect(
      within(card as HTMLElement).getByText("Installed"),
    ).toBeInTheDocument();
    expect(
      within(card as HTMLElement).queryByText("Loaded"),
    ).not.toBeInTheDocument();

    view.rerender(
      panel(
        snapshot(
          {
            modelId: "whisper-small",
            device: "cpu",
            state: "loading",
          },
          unloaded,
        ),
      ),
    );
    expect(within(speech).getByText("Loading")).toBeInTheDocument();
    expect(
      within(card as HTMLElement).getByText("Loading"),
    ).toBeInTheDocument();

    view.rerender(
      panel(
        snapshot(
          {
            modelId: "whisper-small",
            device: "cpu",
            state: "loaded",
          },
          { modelId: "qwen3-4b", device: "vulkan", state: "loaded" },
        ),
      ),
    );
    expect(within(speech).getByText("Loaded")).toBeInTheDocument();
    expect(within(speech).getByText("Whisper Small · CPU")).toBeInTheDocument();
    expect(within(card as HTMLElement).getByText("Loaded")).toBeInTheDocument();
    expect(
      within(card as HTMLElement).getByText("Installed"),
    ).toBeInTheDocument();
    expect(screen.getByText("Qwen3 4B · Vulkan GPU")).toBeInTheDocument();

    view.rerender(panel(snapshot(unloaded, unloaded)));
    expect(within(speech).getByText("Unloaded")).toBeInTheDocument();
    expect(
      within(card as HTMLElement).queryByText("Loaded"),
    ).not.toBeInTheDocument();
    expect(
      within(card as HTMLElement).getByText("Installed"),
    ).toBeInTheDocument();
  });

  it("refreshes the snapshot after the unload command completes", async () => {
    vi.mocked(command).mockResolvedValue(undefined);
    const refresh = vi.fn(async () => {});
    render(panel(snapshot(unloaded, unloaded), refresh));
    fireEvent.click(
      screen.getByRole("button", {
        name: "Unload models from memory",
      }),
    );
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    expect(command).toHaveBeenCalledWith("unload_models");
  });

  it("does not infer loaded or unloaded state when a preview has no live status", () => {
    const data = snapshot(unloaded, unloaded);
    delete data.engineStatus;
    render(panel(data));
    expect(screen.getAllByText("Status unavailable")).toHaveLength(3);
    expect(screen.queryByText("Loaded")).not.toBeInTheDocument();
    expect(screen.queryByText("Unloaded")).not.toBeInTheDocument();
  });

  it("keeps CPU preview readiness independent and never offers it as the final speech model", () => {
    const data = snapshot(
      { modelId: "whisper-small", device: "cpu", state: "loaded" },
      { modelId: "qwen3-4b", device: "cpu", state: "loaded" },
    );
    data.engineStatus!.preview = {
      modelId: null,
      device: null,
      state: "unloaded",
    };
    const view = render(panel(data));
    const card = screen
      .getByText("Whisper Tiny preview")
      .closest(".model-card") as HTMLElement;
    expect(
      within(card).queryByRole("button", { name: "Use this model" }),
    ).toBeNull();
    expect(within(card).queryByRole("button", { name: "Selected" })).toBeNull();
    expect(
      screen.getByRole("button", { name: "Load selected models" }),
    ).toBeEnabled();
    data.engineStatus!.preview = {
      modelId: "whisper-preview",
      device: "cpu",
      state: "loading",
    };
    view.rerender(panel(data));
    expect(
      screen.getByRole("status", { name: "Preview model memory status" }),
    ).toHaveTextContent("Loading");
    expect(within(card).getByText("Loading")).toBeVisible();
    data.engineStatus!.preview.state = "loaded";
    view.rerender(panel(data));
    expect(
      screen.getByRole("status", { name: "Preview model memory status" }),
    ).toHaveTextContent("Whisper Tiny preview · CPU");
    expect(within(card).getByText("Loaded")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Load selected models" }),
    ).toBeDisabled();
    delete data.engineStatus!.preview;
    view.rerender(panel(data));
    expect(
      screen.getByRole("status", { name: "Preview model memory status" }),
    ).toHaveTextContent("Status unavailable");
    expect(
      screen.getByRole("button", { name: "Load selected models" }),
    ).toBeEnabled();
    data.settings.appearance.livePreview = false;
    view.rerender(panel(data));
    expect(
      screen.getByRole("button", { name: "Load selected models" }),
    ).toBeDisabled();
  });
});
