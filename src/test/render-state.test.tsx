import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import Onboarding from "../Onboarding";
import { History, SettingsPanel, VocabularyPanel } from "../panels";
import { defaultSettings } from "../types";
import type { Settings, SettingsUpdate, Snapshot } from "../types";
import { getSnapshot } from "../bridge";

vi.mock("../bridge", () => ({
  command: vi.fn(),
  desktop: true,
  getSnapshot: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function snapshot(): Snapshot {
  return {
    settings: structuredClone(defaultSettings),
    history: [],
    hardware: {
      cpu: "Test CPU",
      ramGb: 16,
      gpus: [],
      cudaAvailable: false,
      threads: 4,
    },
    models: [],
    version: "0.1.3",
    portable: false,
    dataDir: "Test data",
  };
}

function props(data: Snapshot) {
  return {
    snapshot: data,
    settings: data.settings,
    update: vi.fn(async (_patch: SettingsUpdate) => {}),
    refresh: vi.fn(async () => {}),
    notify: vi.fn(),
  };
}

describe("Render state and filtering", () => {
  it("resets technical output to Text when cleanup is disabled in the repair wizard", async () => {
    const data = snapshot();
    data.settings.setupComplete = true;
    data.settings.cleanup.outputMode = "generate";
    data.settings.cleanup.codeLanguage = "PowerShell";
    data.models = [
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

      {
        id: "whisper-turbo",
        name: "Whisper Turbo",
        kind: "speech",
        installed: true,
        description: "Test",
        sizeBytes: 1,
        license: "Test",
        files: [],
      },
    ];
    vi.mocked(getSnapshot).mockResolvedValue(data);
    const onFinish = vi.fn(async (_settings: Settings) => {});
    render(
      <Onboarding
        snapshot={data}
        repair
        onFinish={onFinish}
        notify={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    fireEvent.change(screen.getByLabelText("Setup cleanup engine"), {
      target: { value: "off" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByRole("button", { name: "Finish setup" }));
    await waitFor(() => expect(onFinish).toHaveBeenCalledOnce());
    expect(onFinish.mock.calls[0][0].cleanup).toMatchObject({
      mode: "off",
      outputMode: "text",
      codeLanguage: "PowerShell",
    });
  });

  it("labels technical history modes, preserves code whitespace and distinguishes failed raw output", () => {
    const data = snapshot();
    const values = [
      "git status\ngit log --oneline\n",
      "let value = 1;\n",
      'fn main() {\n    println!("hello");\n}\n',
      "write a script that lists files",
    ];
    data.history = ["code", "code-rewrite", "generate", "generate-raw"].map(
      (mode, index) => ({
        id: String(index),
        createdAt: "2026-10-13T12:00:00Z",
        rawText: "Synthetic spoken request",
        text: values[index],
        language: "en",
        app: "Test editor",
        durationSeconds: 1,
        wordCount: 2,
        mode,
        inserted: !mode.startsWith("generate"),
      }),
    );
    const { container } = render(<History {...props(data)} />);
    expect(screen.getByText("Dictated code or commands")).toBeVisible();
    expect(screen.getByText("Selected code rewritten")).toBeVisible();
    expect(screen.getByText("Generated code or commands")).toBeVisible();
    const rows = container.querySelectorAll<HTMLButtonElement>(
      ".history-text.code-output",
    );
    expect(Array.from(rows).map((row) => row.textContent)).toEqual(
      values.slice(0, 3),
    );
    fireEvent.click(rows[2]);
    const dialog = screen.getByRole("dialog", { name: "Transcript details" });
    expect(within(dialog).getByText("CODE OR COMMAND OUTPUT")).toBeVisible();
    expect(dialog.querySelector("pre.code-output")?.textContent).toBe(
      values[2],
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    expect(
      screen.getByText("Raw transcript · conversion failed"),
    ).toBeVisible();
    fireEvent.click(
      container.querySelectorAll<HTMLButtonElement>(".history-text")[3],
    );
    const rawDialog = screen.getByRole("dialog", {
      name: "Transcript details",
    });
    expect(within(rawDialog).getByText("RAW TRANSCRIPT")).toBeVisible();
    expect(rawDialog.querySelector("pre.code-output")).toBeNull();
  });
  it("keeps an edited setup draft through snapshot and download-progress updates", () => {
    const data = snapshot();
    const onFinish = vi.fn(async () => {});
    const notify = vi.fn();
    const view = render(
      <Onboarding snapshot={data} onFinish={onFinish} notify={notify} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Local server/ }));
    fireEvent.change(screen.getByLabelText("Provider name"), {
      target: { value: "My local server" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Setup language" }), {
      target: { value: "pl" },
    });

    const updated = snapshot();
    updated.settings.transcription.language = "en";
    view.rerender(
      <Onboarding
        snapshot={updated}
        onFinish={onFinish}
        notify={notify}
        downloads={{
          "qwen3-4b": {
            id: "qwen3-4b",
            state: "downloading",
            completed: 50,
            total: 100,
          },
        }}
      />,
    );

    expect(
      screen.getByRole("combobox", { name: "Setup language" }),
    ).toHaveValue("pl");
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByLabelText("Provider name")).toHaveValue(
      "My local server",
    );
    expect(data.settings.transcription.language).toBe("auto");
    expect(updated.settings.transcription.language).toBe("en");
    expect(onFinish).not.toHaveBeenCalled();
  });

  it("finds vocabulary words and aliases regardless of query case", () => {
    const data = snapshot();
    data.settings.vocabulary = [
      { word: "Łukasz", aliases: ["Lucas"] },
      { word: "Kubernetes", aliases: ["k8s"] },
    ];
    render(<VocabularyPanel {...props(data)} />);
    const search = screen.getByRole("textbox", { name: "Search vocabulary" });
    for (const query of ["ŁUKASZ", "LUCAS"]) {
      fireEvent.change(search, { target: { value: query } });
      expect(screen.getByText("Łukasz")).toBeInTheDocument();
      expect(screen.queryByText("Kubernetes")).not.toBeInTheDocument();
    }
  });

  it("searches final text, raw recognition, and app names while retaining the language filter", () => {
    const data = snapshot();
    data.history = [
      {
        id: "first",
        createdAt: "2026-10-13T12:00:00Z",
        rawText: "Original Bravo",
        text: "Cleaned meeting",
        language: "en",
        app: "notepad.exe",
        durationSeconds: 2,
        wordCount: 2,
        mode: "dictation",
        inserted: true,
      },
      {
        id: "second",
        createdAt: "2026-10-13T12:01:00Z",
        rawText: "Original Charlie",
        text: "Other transcript",
        language: "pl",
        app: "outlook.exe",
        durationSeconds: 2,
        wordCount: 2,
        mode: "dictation",
        inserted: true,
      },
    ];
    render(<History {...props(data)} />);
    const search = screen.getByRole("textbox", { name: "Search history" });
    for (const query of ["CLEANED", "BRAVO", "NOTEPAD"]) {
      fireEvent.change(search, { target: { value: query } });
      expect(
        screen.getByRole("button", { name: "Cleaned meeting" }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Other transcript" }),
      ).not.toBeInTheDocument();
    }
    fireEvent.change(
      screen.getByRole("combobox", { name: "History language" }),
      { target: { value: "pl" } },
    );
    expect(
      screen.queryByRole("button", { name: "Cleaned meeting" }),
    ).not.toBeInTheDocument();
    fireEvent.change(search, { target: { value: "" } });
    expect(
      screen.getByRole("button", { name: "Other transcript" }),
    ).toBeInTheDocument();
  });

  it("labels CUDA speech and Vulkan cleanup separately while retaining the stored GPU value", () => {
    const data = snapshot();
    const panelProps = props(data);
    render(<SettingsPanel {...panelProps} />);
    const speech = screen.getByRole("combobox", {
      name: "Speech processing device",
    });
    const text = screen.getByRole("combobox", {
      name: "Cleanup processing device",
    });
    expect(
      within(speech).getByRole("option", { name: "NVIDIA GPU" }),
    ).toHaveValue("cuda");
    expect(
      within(text).getByRole("option", { name: "GPU · Vulkan" }),
    ).toHaveValue("cuda");
    fireEvent.change(speech, { target: { value: "cuda" } });
    fireEvent.change(text, { target: { value: "cuda" } });
    expect(vi.mocked(panelProps.update).mock.calls[0][0]).toBeTypeOf(
      "function",
    );
    expect(
      (
        vi.mocked(panelProps.update).mock.calls[0][0] as (
          s: Settings,
        ) => unknown
      )(data.settings),
    ).toEqual({
      transcription: { ...data.settings.transcription, device: "cuda" },
    });
    expect(
      (
        vi.mocked(panelProps.update).mock.calls[1][0] as (
          s: Settings,
        ) => unknown
      )(data.settings),
    ).toEqual({
      cleanup: { ...data.settings.cleanup, device: "cuda" },
    });
  });
});
