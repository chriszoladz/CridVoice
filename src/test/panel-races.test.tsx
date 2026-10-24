import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { command } from "../bridge";
import { History, Providers, Styles, VocabularyPanel } from "../panels";
import type { PanelProps } from "../panels";
import { defaultSettings } from "../types";
import type { Provider, Settings, SettingsUpdate, Snapshot } from "../types";

vi.mock("../bridge", () => ({ command: vi.fn() }));
beforeEach(() => {
  vi.mocked(command).mockResolvedValue(undefined);
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

function deferred() {
  let resolve!: () => void, reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function snapshot(): Snapshot {
  return {
    settings: structuredClone(defaultSettings),
    history: [],
    models: [],
    hardware: {
      cpu: "Test CPU",
      ramGb: 16,
      gpus: [],
      cudaAvailable: false,
      threads: 4,
    },
    version: "0.1.3",
    portable: false,
    dataDir: "Test data",
  };
}
function props(
  data: Snapshot,
  update: PanelProps["update"] = vi.fn(async () => {}),
): PanelProps {
  return {
    settings: data.settings,
    snapshot: data,
    update,
    refresh: vi.fn(async () => {}),
    notify: vi.fn(),
  };
}
function controlledUpdate(data: Snapshot, gate: ReturnType<typeof deferred>) {
  let current = data.settings;
  return {
    update: vi.fn(async (patch: SettingsUpdate) => {
      current = {
        ...current,
        ...(typeof patch === "function" ? patch(current) : patch),
      };
      await gate.promise;
    }),
    get: () => current,
    set: (settings: Settings) => {
      current = settings;
    },
  };
}
function provider(id: string): Provider {
  return {
    id,
    name: id,
    protocol: "openai",
    baseUrl: "https://api.example/v1",
    model: "text-model",
    sttModel: "audio-model",
    hasKey: true,
  };
}
function editProvider(name: string) {
  fireEvent.click(
    within(
      screen.getByText(name).closest(".list-row") as HTMLElement,
    ).getByRole("button", { name: "Edit" }),
  );
}

describe("Pending panel mutations", () => {
  it("adds vocabulary once, retains newer typing, and uses the latest collection", async () => {
    const data = snapshot(),
      gate = deferred(),
      changes = controlledUpdate(data, gate);
    changes.set({
      ...data.settings,
      vocabulary: [{ word: "Concurrent entry", aliases: [] }],
    });
    render(<VocabularyPanel {...props(data, changes.update)} />);
    const word = screen.getByLabelText("Correct spelling"),
      aliases = screen.getByLabelText("Aliases · comma separated");
    fireEvent.change(word, { target: { value: "First word" } });
    fireEvent.change(aliases, { target: { value: "first alias" } });
    const form = screen
      .getByRole("button", { name: "Add word" })
      .closest("form")!;
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(changes.update).toHaveBeenCalledOnce();
    expect(changes.get().vocabulary.map((entry) => entry.word)).toEqual([
      "Concurrent entry",
      "First word",
    ]);
    fireEvent.change(word, { target: { value: "Next word" } });
    fireEvent.change(aliases, { target: { value: "next alias" } });
    await act(async () => gate.resolve());
    expect(word).toHaveValue("Next word");
    expect(aliases).toHaveValue("next alias");
    expect(screen.getByRole("button", { name: "Add word" })).toBeEnabled();
  });

  it("retains a rejected vocabulary draft and catches the save error", async () => {
    const data = snapshot(),
      gate = deferred(),
      changes = controlledUpdate(data, gate),
      panel = props(data, changes.update);
    render(<VocabularyPanel {...panel} />);
    fireEvent.change(screen.getByLabelText("Correct spelling"), {
      target: { value: "Unchanged draft" },
    });
    fireEvent.change(screen.getByLabelText("Aliases · comma separated"), {
      target: { value: "draft alias" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add word" }));
    await act(async () => gate.reject(new Error("Synthetic save failure")));
    expect(screen.getByLabelText("Correct spelling")).toHaveValue(
      "Unchanged draft",
    );
    expect(screen.getByLabelText("Aliases · comma separated")).toHaveValue(
      "draft alias",
    );
    expect(panel.notify).toHaveBeenCalledWith(
      "Error: Synthetic save failure",
      true,
    );
    expect(screen.getByRole("button", { name: "Add word" })).toBeEnabled();
  });

  it("retains application style fields after a rejected save and prevents duplicate submission", async () => {
    const data = snapshot(),
      gate = deferred(),
      changes = controlledUpdate(data, gate),
      panel = props(data, changes.update);
    render(<Styles {...panel} />);
    fireEvent.change(screen.getByLabelText("Application"), {
      target: { value: "app:notepad" },
    });
    fireEvent.change(screen.getByLabelText("Additional guidance · optional"), {
      target: { value: "Preserve paragraphs" },
    });
    const form = screen
      .getByRole("button", { name: "Add application rule" })
      .closest("form")!;
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(changes.update).toHaveBeenCalledOnce();
    await act(async () => gate.reject(new Error("Synthetic save failure")));
    expect(screen.getByLabelText("Application")).toHaveValue("app:notepad");
    expect(screen.getByLabelText("Additional guidance · optional")).toHaveValue(
      "Preserve paragraphs",
    );
    expect(panel.notify).toHaveBeenCalledWith(
      "Error: Synthetic save failure",
      true,
    );
    expect(
      screen.getByRole("button", { name: "Add application rule" }),
    ).toBeEnabled();
  });

  it("keeps a newer application-style draft when an older save completes", async () => {
    const data = snapshot(),
      gate = deferred(),
      changes = controlledUpdate(data, gate);
    changes.set({
      ...data.settings,
      appRules: [{ app: "Concurrent app", style: "concise", customPrompt: "" }],
    });
    render(<Styles {...props(data, changes.update)} />);
    fireEvent.change(screen.getByLabelText("Application"), {
      target: { value: "app:notepad" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Add application rule" }),
    );
    fireEvent.change(screen.getByLabelText("Application"), {
      target: { value: "app:outlook" },
    });
    fireEvent.change(screen.getByLabelText("Additional guidance · optional"), {
      target: { value: "Next rule" },
    });
    await act(async () => gate.resolve());
    expect(changes.get().appRules.map((rule) => rule.app)).toEqual([
      "Concurrent app",
      "notepad",
    ]);
    expect(screen.getByLabelText("Application")).toHaveValue("app:outlook");
    expect(screen.getByLabelText("Additional guidance · optional")).toHaveValue(
      "Next rule",
    );
  });

  it("does not close a newer provider editor or clear its key after an older save", async () => {
    const data = snapshot(),
      gate = deferred();
    data.settings.providers = [provider("First"), provider("Second")];
    const changes = controlledUpdate(data, gate);
    changes.set({
      ...data.settings,
      providers: [...data.settings.providers, provider("Concurrent")],
    });
    render(<Providers {...props(data, changes.update)} />);
    editProvider("First");
    fireEvent.change(screen.getByLabelText(/^API key/), {
      target: { value: "synthetic-first-key" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save connection" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    editProvider("Second");
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "New editor draft" },
    });
    fireEvent.change(screen.getByLabelText(/^API key/), {
      target: { value: "synthetic-second-key" },
    });
    await act(async () => gate.resolve());
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Save connection" }),
      ).toBeEnabled(),
    );
    expect(
      screen.getByRole("dialog", { name: "Edit provider" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toHaveValue("New editor draft");
    expect(
      (screen.getByLabelText(/^API key/) as HTMLInputElement).value ===
        "synthetic-second-key",
    ).toBe(true);
    expect(changes.get().providers.map((entry) => entry.id)).toEqual([
      "Second",
      "Concurrent",
      "First",
    ]);
    expect(vi.mocked(command).mock.calls[0]?.[0]).toBe("set_provider_key");
    expect(vi.mocked(command).mock.calls[0]?.[1]?.id).toBe("First");
    expect(
      vi.mocked(command).mock.calls[0]?.[1]?.key === "synthetic-first-key",
    ).toBe(true);
  });

  it("preserves a key typed into the same editor during an older blank-key save", async () => {
    const data = snapshot(),
      gate = deferred();
    data.settings.providers = [provider("First")];
    const changes = controlledUpdate(data, gate);
    render(<Providers {...props(data, changes.update)} />);
    editProvider("First");
    fireEvent.click(screen.getByRole("button", { name: "Save connection" }));
    fireEvent.change(screen.getByLabelText(/^API key/), {
      target: { value: "synthetic-later-key" },
    });
    await act(async () => gate.resolve());
    expect(
      screen.getByRole("dialog", { name: "Edit provider" }),
    ).toBeInTheDocument();
    expect(
      (screen.getByLabelText(/^API key/) as HTMLInputElement).value ===
        "synthetic-later-key",
    ).toBe(true);
    expect(command).not.toHaveBeenCalled();
  });

  it("keeps a rejected provider draft and does not write its key before settings save", async () => {
    const data = snapshot(),
      gate = deferred();
    data.settings.providers = [provider("First")];
    const changes = controlledUpdate(data, gate),
      panel = props(data, changes.update);
    render(<Providers {...panel} />);
    editProvider("First");
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Unsaved provider" },
    });
    fireEvent.change(screen.getByLabelText(/^API key/), {
      target: { value: "synthetic-unsaved-key" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save connection" }));
    await act(async () => gate.reject(new Error("Synthetic save failure")));
    expect(screen.getByLabelText("Name")).toHaveValue("Unsaved provider");
    expect(
      (screen.getByLabelText(/^API key/) as HTMLInputElement).value ===
        "synthetic-unsaved-key",
    ).toBe(true);
    expect(command).not.toHaveBeenCalled();
    expect(panel.notify).toHaveBeenCalledWith(
      "Error: Synthetic save failure",
      true,
    );
  });

  it("removes a provider using settings changed while credential removal was pending", async () => {
    const data = snapshot(),
      gate = deferred();
    data.settings.providers = [provider("First"), provider("Second")];
    const changes = controlledUpdate(data, {
      ...gate,
      promise: Promise.resolve(),
    });
    vi.mocked(command).mockReturnValueOnce(gate.promise);
    render(<Providers {...props(data, changes.update)} />);
    fireEvent.click(screen.getByRole("button", { name: "Remove First" }));
    changes.set({
      ...data.settings,
      providers: [...data.settings.providers, provider("Concurrent")],
      cleanup: {
        ...data.settings.cleanup,
        mode: "provider",
        providerId: "Second",
      },
      transcription: {
        ...data.settings.transcription,
        mode: "openai",
        providerId: "Second",
      },
    });
    await act(async () => gate.resolve());
    expect(changes.get().providers.map((entry) => entry.id)).toEqual([
      "Second",
      "Concurrent",
    ]);
    expect(changes.get().cleanup.providerId).toBe("Second");
    expect(changes.get().transcription.providerId).toBe("Second");
  });

  it.each(["complete", "reject"])(
    "keeps the newer history selection when an earlier deletion %s",
    async (outcome) => {
      const data = snapshot(),
        gate = deferred(),
        panel = props(data);
      data.history = ["First", "Second"].map((text) => ({
        id: text,
        createdAt: "2026-10-13T12:00:00Z",
        text,
        rawText: `${text} raw`,
        app: "notepad.exe",
        language: "en",
        wordCount: 1,
        durationSeconds: 1,
        mode: "dictation",
        inserted: true,
      }));
      vi.mocked(command).mockReturnValueOnce(gate.promise);
      render(<History {...panel} />);
      fireEvent.click(
        within(
          screen.getByRole("button", { name: "First" }).closest("article")!,
        ).getByRole("button", { name: "Delete transcript" }),
      );
      fireEvent.click(screen.getByRole("button", { name: "Second" }));
      await act(async () =>
        outcome === "complete"
          ? gate.resolve()
          : gate.reject(new Error("Synthetic delete failure")),
      );
      expect(
        within(
          screen.getByRole("dialog", { name: "Transcript details" }),
        ).getByText("Second"),
      ).toBeInTheDocument();
      expect(command).toHaveBeenCalledWith("delete_history", { id: "First" });
      if (outcome === "reject")
        expect(panel.notify).toHaveBeenCalledWith(
          "Error: Synthetic delete failure",
          true,
        );
    },
  );
});
