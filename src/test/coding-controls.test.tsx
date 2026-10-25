import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import CodingControls from "../CodingControls";
import { defaultSettings } from "../types";
import type { SettingsUpdate } from "../types";

afterEach(cleanup);
function settings() {
  const value = structuredClone(defaultSettings);
  value.cleanup.outputMode = "code";
  return value;
}
function deferred() {
  let resolve!: () => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function selectManual() {
  fireEvent.change(screen.getByLabelText("Code language or shell"), {
    target: { value: "manual" },
  });
  return screen.getByLabelText("Language or shell override");
}

it("keeps code modes unavailable with cleanup off while allowing an arbitrary override and a Settings link", () => {
  const value = settings();
  value.cleanup.mode = "off";
  value.cleanup.outputMode = "text";
  const update = vi.fn(async (_patch: SettingsUpdate) => {});
  const open = vi.fn();
  render(
    <CodingControls settings={value} update={update} onOpenSettings={open} />,
  );
  expect(
    screen.getByRole("option", { name: "Dictate code or commands" }),
  ).toBeDisabled();
  expect(
    screen.getByRole("option", { name: "Generate code or commands" }),
  ).toBeDisabled();
  expect(screen.getByRole("option", { name: "Text" })).not.toBeDisabled();
  expect(screen.getByLabelText("Code language or shell")).not.toBeDisabled();
  expect(selectManual()).not.toBeDisabled();
  expect(
    screen.getByText(/Automatic detection applies until an override is saved/),
  ).toBeVisible();
  fireEvent.change(screen.getByLabelText("Output mode"), {
    target: { value: "code" },
  });
  expect(update).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Enable in Settings" }));
  expect(open).toHaveBeenCalledOnce();
});

it("shows actual automatic detection and persists a freeform single-line override without replacing newer cleanup fields", async () => {
  const value = settings();
  const update = vi.fn(async (_patch: SettingsUpdate) => {});
  render(
    <CodingControls
      settings={value}
      update={update}
      detectedLanguage="Rust"
      detectionActive
    />,
  );
  expect(screen.getByText(/Detected: Rust/)).toBeVisible();
  expect(screen.getByLabelText("Code language or shell")).toHaveValue("auto");
  expect(screen.queryByLabelText("Language or shell override")).toBeNull();
  const input = selectManual();
  expect(input).toHaveAttribute("maxlength", "80");
  expect(input).toHaveAttribute("placeholder", "e.g. Python or PowerShell");
  fireEvent.change(input, { target: { value: "Nushell / custom DSL" } });
  fireEvent.blur(input);
  await waitFor(() => expect(update).toHaveBeenCalledOnce());
  const patch = update.mock.calls[0][0];
  const latest = {
    ...value,
    cleanup: {
      ...value.cleanup,
      device: "cpu" as const,
      outputMode: "generate" as const,
    },
  };
  expect(typeof patch).toBe("function");
  expect(
    typeof patch === "function" ? patch(latest).cleanup : undefined,
  ).toEqual({ ...latest.cleanup, codeLanguage: "Nushell / custom DSL" });
});

it("disables output and override controls during a recording, processing or save lock", () => {
  const value = settings();
  value.cleanup.codeLanguage = "Custom DSL";
  const update = vi.fn(async () => {});
  render(
    <CodingControls settings={value} update={update} disabled />,
  );
  expect(screen.getByLabelText("Output mode")).toBeDisabled();
  expect(screen.getByLabelText("Code language or shell")).toBeDisabled();
  expect(screen.getByLabelText("Language or shell override")).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Code language or shell"), {
    target: { value: "preset:Python" },
  });
  expect(screen.getByLabelText("Code language or shell")).toHaveValue("manual");
  expect(update).not.toHaveBeenCalled();
});

it("preserves a newer unsaved draft when an earlier save and subsequent canonical snapshots complete", async () => {
  const value = settings();
  const first = deferred();
  const update = vi
    .fn(async (_patch: SettingsUpdate) => {})
    .mockReturnValueOnce(first.promise);
  const view = render(<CodingControls settings={value} update={update} />);
  const input = selectManual();
  fireEvent.change(input, { target: { value: "Python" } });
  fireEvent.blur(input);
  fireEvent.change(input, { target: { value: "TypeScript / JSX" } });
  view.rerender(
    <CodingControls
      settings={{
        ...value,
        cleanup: { ...value.cleanup, codeLanguage: "Python" },
      }}
      update={update}
    />,
  );
  await act(async () => first.resolve());
  view.rerender(
    <CodingControls
      settings={{
        ...value,
        cleanup: { ...value.cleanup, codeLanguage: "Bash" },
      }}
      update={update}
    />,
  );
  expect(input).toHaveValue("TypeScript / JSX");
  fireEvent.blur(input);
  await waitFor(() => expect(update).toHaveBeenCalledTimes(2));
});

it("keeps a failed hint draft for an explicit retry rather than replacing it with older settings", async () => {
  const value = settings();
  const update = vi
    .fn(async (_patch: SettingsUpdate) => {})
    .mockRejectedValueOnce(new Error("Scripted save failure"));
  const view = render(<CodingControls settings={value} update={update} />);
  const input = selectManual();
  fireEvent.change(input, { target: { value: "PowerShell" } });
  fireEvent.blur(input);
  await screen.findByRole("alert");
  view.rerender(
    <CodingControls
      settings={{
        ...value,
        cleanup: { ...value.cleanup, codeLanguage: "Python" },
      }}
      update={update}
    />,
  );
  expect(input).toHaveValue("PowerShell");
  fireEvent.blur(input);
  await waitFor(() => expect(update).toHaveBeenCalledTimes(2));
});

it("tracks distinct A-B-A saves so an old completion cannot clear the latest request or overwrite its status", async () => {
  const work = [deferred(), deferred(), deferred()];
  const update = vi
    .fn(async (_patch: SettingsUpdate) => {})
    .mockReturnValueOnce(work[0].promise)
    .mockReturnValueOnce(work[1].promise)
    .mockReturnValueOnce(work[2].promise);
  render(<CodingControls settings={settings()} update={update} />);
  const input = selectManual();
  for (const value of ["Python", "Rust", "Python"]) {
    fireEvent.change(input, { target: { value } });
    fireEvent.blur(input);
  }
  expect(update).toHaveBeenCalledTimes(3);
  await act(async () => work[0].resolve());
  fireEvent.blur(input);
  expect(update).toHaveBeenCalledTimes(3);
  await act(async () => work[1].reject(new Error("Old Rust save failed")));
  expect(screen.queryByRole("alert")).toBeNull();
  await act(async () => work[2].reject(new Error("Latest Python save failed")));
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Latest Python save failed",
  );
  expect(input).toHaveValue("Python");
  fireEvent.blur(input);
  await waitFor(() => expect(update).toHaveBeenCalledTimes(4));
});

it("returns to automatic detection by explicitly clearing the saved override, without changing the output mode", async () => {
  const value = settings();
  value.cleanup.codeLanguage = "PowerShell";
  const update = vi.fn(async (_patch: SettingsUpdate) => {});
  const view = render(
    <CodingControls settings={value} update={update} detectedLanguage="Bash" />,
  );
  expect(screen.getByLabelText("Code language or shell")).toHaveValue(
    "preset:PowerShell",
  );
  fireEvent.change(screen.getByLabelText("Code language or shell"), {
    target: { value: "auto" },
  });
  const patch = update.mock.calls[0][0];
  expect(
    typeof patch === "function" ? patch(value).cleanup : undefined,
  ).toEqual({ ...value.cleanup, codeLanguage: "" });
  await act(async () => {});
  view.rerender(
    <CodingControls
      settings={{ ...value, cleanup: { ...value.cleanup, codeLanguage: "" } }}
      update={update}
      detectedLanguage="Bash"
    />,
  );
  expect(screen.queryByLabelText("Language or shell override")).toBeNull();
  expect(screen.getByText(/Last detected: Bash/)).toBeVisible();
  expect(screen.getByLabelText("Output mode")).toHaveValue("code");
});

it("keeps a newer manual draft while an earlier automatic-clear request completes", async () => {
  const value = settings();
  value.cleanup.codeLanguage = "Python";
  const first = deferred();
  const update = vi
    .fn(async (_patch: SettingsUpdate) => {})
    .mockReturnValueOnce(first.promise);
  const view = render(<CodingControls settings={value} update={update} />);
  fireEvent.change(screen.getByLabelText("Code language or shell"), {
    target: { value: "auto" },
  });
  const input = selectManual();
  fireEvent.change(input, { target: { value: "Rust / custom DSL" } });
  view.rerender(
    <CodingControls
      settings={{ ...value, cleanup: { ...value.cleanup, codeLanguage: "" } }}
      update={update}
    />,
  );
  await act(async () => first.resolve());
  expect(screen.getByLabelText("Code language or shell")).toHaveValue("manual");
  expect(input).toHaveValue("Rust / custom DSL");
  fireEvent.blur(input);
  expect(update).toHaveBeenCalledTimes(2);
});

it("shows the still-saved override after a failed automatic-clear request and offers a bounded explicit retry", async () => {
  const value = settings();
  value.cleanup.codeLanguage = "Python";
  const update = vi
    .fn(async (_patch: SettingsUpdate) => {})
    .mockRejectedValueOnce(new Error("Scripted save failure"));
  render(<CodingControls settings={value} update={update} />);
  fireEvent.change(screen.getByLabelText("Code language or shell"), {
    target: { value: "auto" },
  });
  await screen.findByRole("alert");
  expect(screen.getByText("Override: Python")).toBeVisible();
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Automatic detection could not be saved",
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Retry language setting" }),
  );
  await waitFor(() => expect(update).toHaveBeenCalledTimes(2));
});

it("keeps the saved override explicit while an empty manual draft is pending, then selects Automatic after its successful clear", async () => {
  const value = settings();
  value.cleanup.codeLanguage = "Python";
  const first = deferred();
  const update = vi
    .fn(async (_patch: SettingsUpdate) => {})
    .mockReturnValueOnce(first.promise);
  render(<CodingControls settings={value} update={update} />);
  const input = selectManual();
  fireEvent.change(input, { target: { value: "" } });
  expect(screen.getByText(/Saved override: Python/)).toBeVisible();
  expect(
    screen.queryByText(
      /Automatic detection applies until an override is saved/,
    ),
  ).toBeNull();
  fireEvent.blur(input);
  expect(screen.getByLabelText("Code language or shell")).toHaveValue("manual");
  await act(async () => first.resolve());
  expect(screen.getByLabelText("Code language or shell")).toHaveValue("auto");
  expect(screen.queryByLabelText("Language or shell override")).toBeNull();
});

it("chooses common languages and shells directly without typing or changing newer cleanup settings", async () => {
  const value = settings();
  const update = vi.fn(async (_patch: SettingsUpdate) => {});
  render(<CodingControls settings={value} update={update} />);
  const picker = screen.getByLabelText("Code language or shell");
  for (const language of ["Python", "PowerShell", "Bash", "SQL"]) {
    fireEvent.change(picker, { target: { value: `preset:${language}` } });
    await act(async () => {});
    expect(picker).toHaveValue(`preset:${language}`);
    expect(screen.queryByLabelText("Language or shell override")).toBeNull();
    const patch = update.mock.calls.at(-1)![0];
    const latest = {
      ...value,
      cleanup: {
        ...value.cleanup,
        device: "cpu" as const,
        outputMode: "generate" as const,
      },
    };
    expect(
      typeof patch === "function" ? patch(latest).cleanup : undefined,
    ).toEqual({ ...latest.cleanup, codeLanguage: language });
  }
  expect(screen.getByLabelText("Output mode")).toHaveValue("code");
});

it("recognizes saved preset values and preserves unknown saved overrides until the user changes them", () => {
  const value = settings();
  value.cleanup.codeLanguage = "PowerShell";
  const update = vi.fn(async (_patch: SettingsUpdate) => {});
  const view = render(<CodingControls settings={value} update={update} />);
  expect(screen.getByLabelText("Code language or shell")).toHaveValue(
    "preset:PowerShell",
  );
  expect(screen.queryByLabelText("Language or shell override")).toBeNull();
  view.rerender(
    <CodingControls
      settings={{
        ...value,
        cleanup: { ...value.cleanup, codeLanguage: "OCaml / domain DSL" },
      }}
      update={update}
    />,
  );
  expect(screen.getByLabelText("Code language or shell")).toHaveValue("manual");
  expect(screen.getByLabelText("Language or shell override")).toHaveValue(
    "OCaml / domain DSL",
  );
  expect(update).not.toHaveBeenCalled();
});

it("keeps a newer preset after an older custom save resolves and can retry that preset after failure", async () => {
  const first = deferred();
  const second = deferred();
  const update = vi
    .fn(async (_patch: SettingsUpdate) => {})
    .mockReturnValueOnce(first.promise)
    .mockReturnValueOnce(second.promise);
  const value = settings();
  const view = render(<CodingControls settings={value} update={update} />);
  const input = selectManual();
  fireEvent.change(input, { target: { value: "Custom shell" } });
  fireEvent.blur(input);
  fireEvent.change(screen.getByLabelText("Code language or shell"), {
    target: { value: "preset:PowerShell" },
  });
  view.rerender(
    <CodingControls
      settings={{
        ...value,
        cleanup: { ...value.cleanup, codeLanguage: "Custom shell" },
      }}
      update={update}
    />,
  );
  await act(async () => first.resolve());
  expect(screen.getByLabelText("Code language or shell")).toHaveValue(
    "preset:PowerShell",
  );
  expect(screen.queryByLabelText("Language or shell override")).toBeNull();
  await act(async () => second.reject(new Error("Preset save failed")));
  expect(screen.getByRole("alert")).toHaveTextContent("Preset save failed");
  fireEvent.click(
    screen.getByRole("button", { name: "Retry language setting" }),
  );
  await waitFor(() => expect(update).toHaveBeenCalledTimes(3));
  const patch = update.mock.calls[2][0];
  expect(
    typeof patch === "function"
      ? patch(value).cleanup?.codeLanguage
      : undefined,
  ).toBe("PowerShell");
});

it("keeps a newer custom draft when an older preset request fails or completes", async () => {
  const first = deferred();
  const second = deferred();
  const update = vi
    .fn(async (_patch: SettingsUpdate) => {})
    .mockReturnValueOnce(first.promise)
    .mockReturnValueOnce(second.promise);
  const value = settings();
  const view = render(<CodingControls settings={value} update={update} />);
  fireEvent.change(screen.getByLabelText("Code language or shell"), {
    target: { value: "preset:Python" },
  });
  const input = selectManual();
  fireEvent.change(input, { target: { value: "Nushell / future DSL" } });
  await act(async () => first.reject(new Error("Old preset failure")));
  expect(screen.queryByRole("alert")).toBeNull();
  fireEvent.blur(input);
  view.rerender(
    <CodingControls
      settings={{
        ...value,
        cleanup: { ...value.cleanup, codeLanguage: "Python" },
      }}
      update={update}
    />,
  );
  fireEvent.change(input, { target: { value: "Newer unsaved DSL" } });
  await act(async () => second.resolve());
  expect(screen.getByLabelText("Code language or shell")).toHaveValue("manual");
  expect(input).toHaveValue("Newer unsaved DSL");
});
