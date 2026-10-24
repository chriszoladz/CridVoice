import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { listen } from "@tauri-apps/api/event";
import { command } from "../bridge";
import ShortcutRecorder, { shortcutProblem } from "../ShortcutRecorder";
import { defaultSettings } from "../types";

vi.mock("../bridge", () => ({ desktop: true, command: vi.fn(async () => {}) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
let callback: (event: { payload: Record<string, unknown> }) => void;
const off = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(command).mockResolvedValue(undefined);
  vi.mocked(listen).mockImplementation(async (_name, fn) => {
    callback = fn as typeof callback;
    return off;
  });
});
afterEach(async () => {
  cleanup();
  await act(async () => {});
});
function open(onSave = vi.fn(async () => {})) {
  const view = render(
    <ShortcutRecorder
      kind="hold"
      value={defaultSettings.shortcuts.hold}
      shortcuts={defaultSettings.shortcuts}
      onSave={onSave}
    />,
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Change hold to dictate" }),
  );
  return { ...view, onSave };
}
async function id() {
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith(
      "begin_shortcut_capture",
      expect.any(Object),
    ),
  );
  return vi
    .mocked(command)
    .mock.calls.find(([name]) => name === "begin_shortcut_capture")![1]!
    .id as string;
}
function emit(value: Record<string, unknown>) {
  act(() => callback({ payload: value }));
}

it("subscribes before native capture, ignores other leases, and ends its own lease after saving", async () => {
  const { onSave } = open();
  const captureId = await id();
  expect(vi.mocked(listen).mock.invocationCallOrder[0]).toBeLessThan(
    vi.mocked(command).mock.invocationCallOrder[0],
  );
  emit({ id: "old", phase: "complete", shortcut: "Ctrl+J" });
  expect(screen.getByRole("button", { name: "Save shortcut" })).toBeDisabled();
  emit({ id: captureId, phase: "complete", shortcut: "Ctrl+H" });
  expect(command).not.toHaveBeenCalledWith(
    "end_shortcut_capture",
    expect.anything(),
  );
  fireEvent.click(screen.getByRole("button", { name: "Save shortcut" }));
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("end_shortcut_capture", {
      id: captureId,
    }),
  );
  expect(onSave).toHaveBeenCalledExactlyOnceWith("Ctrl+H");
  expect(off).toHaveBeenCalledOnce();
});

it("blocks duplicate and shadowing bindings, and permits modifier press order differences", () => {
  expect(
    shortcutProblem({ ...defaultSettings.shortcuts, hold: "Super+Ctrl" }),
  ).toBe("");
  expect(
    shortcutProblem({ ...defaultSettings.shortcuts, toggle: "Super+Ctrl+H" }),
  ).toContain("also start hold");
  expect(
    shortcutProblem({ ...defaultSettings.shortcuts, hold: "Ctrl+Shift+Space" }),
  ).toContain("different shortcuts");
  expect(
    shortcutProblem({ ...defaultSettings.shortcuts, hold: "Ctrl" }),
  ).toContain("both Ctrl and Windows");
});

it("does not save a conflicting captured chord", async () => {
  const { onSave } = open();
  const captureId = await id();
  emit({
    id: captureId,
    phase: "complete",
    shortcut: defaultSettings.shortcuts.toggle,
  });
  expect(screen.getByRole("alert")).toHaveTextContent("different shortcuts");
  expect(screen.getByRole("button", { name: "Save shortcut" })).toBeDisabled();
  expect(onSave).not.toHaveBeenCalled();
});

it("releases a pending begin after focus loss and ignores late capture events", async () => {
  let resolve!: () => void;
  const pending = new Promise<void>((done) => {
    resolve = done;
  });
  vi.mocked(command).mockImplementation(async (name) => {
    if (name === "begin_shortcut_capture") await pending;
    return undefined as never;
  });
  open();
  const captureId = await id();
  fireEvent.blur(window);
  expect(screen.getByRole("alert")).toHaveTextContent("switched windows");
  emit({ id: captureId, phase: "complete", shortcut: "Ctrl+H" });
  expect(screen.getByRole("button", { name: "Save shortcut" })).toBeDisabled();
  await act(async () => resolve());
  expect(
    vi
      .mocked(command)
      .mock.calls.filter(
        ([name, args]) =>
          name === "end_shortcut_capture" && args?.id === captureId,
      ),
  ).toHaveLength(2);
});

it("cleans up a late event subscription without beginning capture after unmount", async () => {
  let resolve!: (off: () => void) => void;
  vi.mocked(listen).mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  const view = open();
  view.unmount();
  await act(async () => resolve(off));
  expect(off).toHaveBeenCalledOnce();
  expect(command).not.toHaveBeenCalledWith(
    "begin_shortcut_capture",
    expect.anything(),
  );
});

it("shows capture errors with a retry and keeps the saved shortcut untouched", async () => {
  const { onSave } = open();
  const captureId = await id();
  emit({ id: captureId, phase: "error", error: "Shortcut is unavailable" });
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Shortcut is unavailable",
  );
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  await waitFor(() =>
    expect(
      vi
        .mocked(command)
        .mock.calls.filter(([name]) => name === "begin_shortcut_capture"),
    ).toHaveLength(2),
  );
  expect(command).toHaveBeenCalledWith("end_shortcut_capture", {
    id: captureId,
  });
  expect(onSave).not.toHaveBeenCalled();
});

it("waits for the previous native lease to end before rearming", async () => {
  open();
  const captureId = await id();
  let resolve!: () => void;
  const pending = new Promise<void>((done) => {
    resolve = done;
  });
  vi.mocked(command).mockImplementation(async (name) => {
    if (name === "end_shortcut_capture") await pending;
    return undefined as never;
  });
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("end_shortcut_capture", {
      id: captureId,
    }),
  );
  expect(
    vi
      .mocked(command)
      .mock.calls.filter(([name]) => name === "begin_shortcut_capture"),
  ).toHaveLength(1);
  await act(async () => resolve());
  await waitFor(() =>
    expect(
      vi
        .mocked(command)
        .mock.calls.filter(([name]) => name === "begin_shortcut_capture"),
    ).toHaveLength(2),
  );
});

it("serializes native leases when switching between different shortcut editors", async () => {
  render(
    <>
      <ShortcutRecorder
        kind="hold"
        value={defaultSettings.shortcuts.hold}
        shortcuts={defaultSettings.shortcuts}
        onSave={vi.fn(async () => {})}
      />
      <ShortcutRecorder
        kind="toggle"
        value={defaultSettings.shortcuts.toggle}
        shortcuts={defaultSettings.shortcuts}
        onSave={vi.fn(async () => {})}
      />
    </>,
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Change hold to dictate" }),
  );
  const captureId = await id();
  let resolve!: () => void;
  const pending = new Promise<void>((done) => {
    resolve = done;
  });
  vi.mocked(command).mockImplementation(async (name) => {
    if (name === "end_shortcut_capture") await pending;
    return undefined as never;
  });
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  fireEvent.click(
    screen.getByRole("button", { name: "Change toggle dictation" }),
  );
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("end_shortcut_capture", {
      id: captureId,
    }),
  );
  expect(
    vi
      .mocked(command)
      .mock.calls.filter(([name]) => name === "begin_shortcut_capture"),
  ).toHaveLength(1);
  await act(async () => resolve());
  await waitFor(() =>
    expect(
      vi
        .mocked(command)
        .mock.calls.filter(([name]) => name === "begin_shortcut_capture"),
    ).toHaveLength(2),
  );
});
