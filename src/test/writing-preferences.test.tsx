import { useState } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import WritingPreferences from "../WritingPreferences";
import { defaultSettings } from "../types";
import type { SettingsUpdate } from "../types";

afterEach(cleanup);
const editor = () =>
  screen.getByRole("textbox", { name: /How should CridVoice write for you/ });
const saveButton = () =>
  screen.getByRole("button", { name: "Save preferences" });
const defaultsButton = () =>
  screen.getByRole("button", { name: "Use defaults" });
function deferred() {
  let resolve!: () => void, reject!: (reason: Error) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

it("saves only explicitly, merges the latest cleanup settings, reopens saved preferences and clears them", async () => {
  let latest = structuredClone(defaultSettings);
  const updates = vi.fn();
  function Harness() {
    const [settings, setSettings] = useState(latest);
    async function update(patch: SettingsUpdate) {
      updates(patch);
      latest = {
        ...latest,
        ...(typeof patch === "function" ? patch(latest) : patch),
      };
      setSettings(latest);
    }
    return <WritingPreferences settings={settings} update={update} />;
  }
  let view = render(<Harness />);
  fireEvent.change(editor(), {
    target: { value: "Keep bro. Use short paragraphs." },
  });
  expect(updates).not.toHaveBeenCalled();
  expect(screen.getByRole("status")).toHaveTextContent("Unsaved changes");
  latest.cleanup = {
    ...latest.cleanup,
    modelId: "newer-model",
    rewriteStrength: "thorough",
    style: "casual",
  };
  fireEvent.click(saveButton());
  await waitFor(() =>
    expect(screen.getByRole("status")).toHaveTextContent("Preferences saved"),
  );
  expect(latest.cleanup).toEqual({
    ...defaultSettings.cleanup,
    modelId: "newer-model",
    rewriteStrength: "thorough",
    style: "casual",
    writingPreferences: "Keep bro. Use short paragraphs.",
  });
  view.unmount();
  view = render(<Harness />);
  expect(editor()).toHaveValue("Keep bro. Use short paragraphs.");
  fireEvent.click(defaultsButton());
  await waitFor(() => expect(editor()).toHaveValue(""));
  expect(latest.cleanup.writingPreferences).toBe("");
  expect(latest.cleanup.modelId).toBe("newer-model");
  view.unmount();
  render(<Harness />);
  expect(screen.getByRole("status")).toHaveTextContent(
    "Using default preferences",
  );
  expect(updates).toHaveBeenCalledTimes(2);
});

it.each(["save", "clear"])(
  "preserves newer typing across pending %s completion and optimistic snapshots",
  async (action) => {
    const initial = structuredClone(defaultSettings);
    initial.cleanup.writingPreferences = "Previously saved";
    const gate = deferred(),
      update = vi.fn(() => gate.promise);
    const view = render(
      <WritingPreferences settings={initial} update={update} />,
    );
    if (action === "save")
      fireEvent.change(editor(), { target: { value: "First draft" } });
    fireEvent.click(action === "save" ? saveButton() : defaultsButton());
    const optimistic = {
      ...initial,
      cleanup: {
        ...initial.cleanup,
        writingPreferences: action === "save" ? "First draft" : "",
      },
    };
    view.rerender(<WritingPreferences settings={optimistic} update={update} />);
    editor().focus();
    fireEvent.change(editor(), {
      target: { value: "Newer draft while saving" },
    });
    expect(editor()).toHaveFocus();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Your new changes are not saved",
    );
    expect(saveButton()).toBeDisabled();
    await act(async () => gate.resolve());
    expect(editor()).toHaveValue("Newer draft while saving");
    expect(screen.getByRole("status")).toHaveTextContent("Unsaved changes");
    expect(saveButton()).toBeEnabled();
    expect(update).toHaveBeenCalledOnce();
  },
);

it("preserves newer typing and announces an error after failed save and rollback", async () => {
  const initial = structuredClone(defaultSettings);
  initial.cleanup.writingPreferences = "Original";
  const gate = deferred(),
    update = vi.fn(() => gate.promise);
  const view = render(
    <WritingPreferences settings={initial} update={update} />,
  );
  fireEvent.change(editor(), { target: { value: "Submitted draft" } });
  fireEvent.click(saveButton());
  view.rerender(
    <WritingPreferences
      settings={{
        ...initial,
        cleanup: { ...initial.cleanup, writingPreferences: "Submitted draft" },
      }}
      update={update}
    />,
  );
  fireEvent.change(editor(), { target: { value: "Newer typing" } });
  view.rerender(<WritingPreferences settings={initial} update={update} />);
  await act(async () => gate.reject(new Error("Fixture disk failure")));
  expect(editor()).toHaveValue("Newer typing");
  expect(screen.getByRole("alert")).toHaveTextContent(
    "previous draft could not be saved",
  );
  expect(screen.getByRole("alert")).toHaveTextContent("Fixture disk failure");
  expect(screen.getByRole("status")).toHaveTextContent("Unsaved changes");
  expect(saveButton()).toBeEnabled();
});

it("adopts external preferences only while clean and preserves unsaved text during other updates", () => {
  const initial = structuredClone(defaultSettings),
    update = vi.fn(async () => {});
  const view = render(
    <WritingPreferences settings={initial} update={update} />,
  );
  const external = {
    ...initial,
    cleanup: { ...initial.cleanup, writingPreferences: "Externally saved" },
  };
  view.rerender(<WritingPreferences settings={external} update={update} />);
  expect(editor()).toHaveValue("Externally saved");
  editor().focus();
  fireEvent.change(editor(), { target: { value: "My unsaved text" } });
  const next = {
    ...external,
    cleanup: {
      ...external.cleanup,
      writingPreferences: "New external preference",
      rewriteStrength: "thorough" as const,
    },
  };
  view.rerender(<WritingPreferences settings={next} update={update} />);
  expect(editor()).toHaveValue("My unsaved text");
  expect(editor()).toHaveFocus();
  expect(screen.getByRole("status")).toHaveTextContent("Unsaved changes");
  expect(update).not.toHaveBeenCalled();
});

it("bounds Unicode preferences without dropping an overlong pasted draft", () => {
  const update = vi.fn(async () => {});
  render(<WritingPreferences settings={defaultSettings} update={update} />);
  const text = "🐈".repeat(2001);
  fireEvent.change(editor(), { target: { value: text } });
  expect(editor()).toHaveValue(text);
  expect(screen.getByRole("alert")).toHaveTextContent("2000 characters");
  expect(saveButton()).toBeDisabled();
  expect(screen.getByText("2001 / 2000")).toBeVisible();
  fireEvent.change(editor(), { target: { value: "🐈".repeat(2000) } });
  expect(saveButton()).toBeEnabled();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(update).not.toHaveBeenCalled();
});

it("disables editing during capture and explains Text-only and cleanup-off behavior", () => {
  const settings = structuredClone(defaultSettings);
  settings.cleanup.mode = "off";
  settings.cleanup.outputMode = "code";
  render(
    <WritingPreferences
      settings={settings}
      update={vi.fn(async () => {})}
      disabled
    />,
  );
  expect(editor()).toBeDisabled();
  expect(saveButton()).toBeDisabled();
  expect(defaultsButton()).toBeDisabled();
  expect(screen.getByText(/Text cleanup is off/)).toBeVisible();
  expect(
    screen.getByText(/preferences apply when you return to Text/),
  ).toBeVisible();
});
