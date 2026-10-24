import { useState } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import ApplicationStyleEditor from "../ApplicationStyleEditor";
import { command } from "../bridge";

vi.mock("../bridge", () => ({ command: vi.fn() }));
beforeEach(() => {
  vi.mocked(command).mockReset().mockResolvedValue([]);
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
});

function deferred() {
  let resolve!: (apps: string[]) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<string[]>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function Editor({
  initialApp = "",
  recentApps = [],
  disabled = false,
  changed = vi.fn(),
}: {
  initialApp?: string;
  recentApps?: string[];
  disabled?: boolean;
  changed?: (app: string) => void;
}) {
  const [app, setApp] = useState(initialApp);
  return (
    <ApplicationStyleEditor
      app={app}
      recentApps={recentApps}
      disabled={disabled}
      onAppChange={(value) => {
        changed(value);
        setApp(value);
      }}
    />
  );
}

it("loads names once and offers common, recent and running apps without duplicate names or paths", async () => {
  vi.mocked(command).mockResolvedValue([
    "CODE",
    "godot",
    "godot",
    "C:\\private\\app.exe",
    "bad\nname",
  ]);
  const changed = vi.fn();
  render(
    <Editor recentApps={["previous-editor", "brave"]} changed={changed} />,
  );
  await screen.findByRole("option", { name: "godot" });
  expect(command).toHaveBeenCalledExactlyOnceWith("running_applications");
  expect(
    screen.getByRole("option", { name: "Visual Studio Code" }),
  ).toBeVisible();
  expect(screen.queryByRole("option", { name: "CODE" })).toBeNull();
  expect(screen.getAllByRole("option", { name: "godot" })).toHaveLength(1);
  expect(screen.getByRole("option", { name: "previous-editor" })).toBeVisible();
  expect(screen.queryByRole("option", { name: /private/ })).toBeNull();
  fireEvent.change(screen.getByLabelText("Application"), {
    target: { value: "app:code" },
  });
  expect(changed).toHaveBeenLastCalledWith("code");
  expect(screen.queryByLabelText("Executable name")).toBeNull();
  fireEvent.change(screen.getByLabelText("Application"), {
    target: { value: "app:godot" },
  });
  expect(changed).toHaveBeenLastCalledWith("godot");
});

it("keeps an arbitrary custom draft, including an empty edit, while discovery completes", async () => {
  const work = deferred();
  vi.mocked(command).mockReturnValue(work.promise);
  const changed = vi.fn();
  render(<Editor initialApp="my-editor" changed={changed} />);
  const input = screen.getByLabelText("Executable name");
  fireEvent.change(input, { target: { value: "" } });
  expect(input).toBeVisible();
  fireEvent.change(input, { target: { value: "Custom.Unicode-Łukasz" } });
  await act(async () => work.resolve(["Custom.Unicode-Łukasz", "another-app"]));
  expect(screen.getByLabelText("Application")).toHaveValue("custom");
  expect(input).toHaveValue("Custom.Unicode-Łukasz");
  expect(changed.mock.calls.map(([app]) => app)).toEqual([
    "",
    "Custom.Unicode-Łukasz",
  ]);
});

it("retains a selected running app after it disappears from a refreshed list", async () => {
  vi.mocked(command).mockResolvedValueOnce(["godot"]).mockResolvedValueOnce([]);
  const changed = vi.fn();
  render(<Editor changed={changed} />);
  await screen.findByRole("option", { name: "godot" });
  fireEvent.change(screen.getByLabelText("Application"), {
    target: { value: "app:godot" },
  });
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Refresh applications" }),
    ).not.toBeDisabled(),
  );
  fireEvent.click(screen.getByRole("button", { name: "Refresh applications" }));
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Refresh applications" }),
    ).not.toBeDisabled(),
  );
  expect(command).toHaveBeenCalledTimes(2);
  expect(screen.getByLabelText("Application")).toHaveValue("app:godot");
  expect(screen.getByRole("option", { name: "godot" })).toBeVisible();
  expect(changed).toHaveBeenCalledOnce();
});

it("keeps common and custom choices usable after a sanitized discovery error, then refreshes explicitly", async () => {
  vi.mocked(command)
    .mockRejectedValueOnce(new Error("private process details"))
    .mockResolvedValueOnce(["new-editor"]);
  const changed = vi.fn();
  render(<Editor initialApp="saved-editor" changed={changed} />);
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Running applications could not be loaded",
  );
  expect(screen.getByRole("alert")).not.toHaveTextContent(
    "private process details",
  );
  expect(screen.getByLabelText("Executable name")).toHaveValue("saved-editor");
  expect(screen.getByLabelText("Application")).not.toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Refresh applications" }));
  await screen.findByRole("option", { name: "new-editor" });
  expect(screen.queryByRole("alert")).toBeNull();
  expect(changed).not.toHaveBeenCalled();
});

it("bounds a stalled lookup and ignores its late result while a newer refresh is active", async () => {
  vi.useFakeTimers();
  const old = deferred(),
    fresh = deferred();
  vi.mocked(command)
    .mockReturnValueOnce(old.promise)
    .mockReturnValueOnce(fresh.promise);
  render(<Editor />);
  expect(
    screen.getByRole("button", { name: "Refresh applications" }),
  ).toBeDisabled();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(8000);
  });
  expect(screen.getByRole("alert")).toHaveTextContent("took too long");
  fireEvent.click(screen.getByRole("button", { name: "Refresh applications" }));
  await act(async () => old.resolve(["old-result"]));
  expect(screen.queryByRole("option", { name: "old-result" })).toBeNull();
  expect(
    screen.getByRole("button", { name: "Refresh applications" }),
  ).toBeDisabled();
  await act(async () => fresh.resolve(["fresh-result"]));
  expect(screen.getByRole("option", { name: "fresh-result" })).toBeVisible();
  expect(
    screen.getByRole("button", { name: "Refresh applications" }),
  ).not.toBeDisabled();
  expect(vi.getTimerCount()).toBe(0);
});

it("cleans the timeout on unmount and never invokes the app-change callback for a late lookup", async () => {
  vi.useFakeTimers();
  const work = deferred();
  vi.mocked(command).mockReturnValue(work.promise);
  const changed = vi.fn();
  const view = render(<Editor changed={changed} />);
  expect(vi.getTimerCount()).toBe(1);
  view.unmount();
  expect(vi.getTimerCount()).toBe(0);
  await act(async () => work.resolve(["late-result"]));
  expect(changed).not.toHaveBeenCalled();
  expect(screen.queryByLabelText("Application")).toBeNull();
});

it("disables selection, custom typing and refresh without changing the existing draft", async () => {
  const changed = vi.fn();
  render(<Editor initialApp="custom-app" disabled changed={changed} />);
  await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
  expect(screen.getByLabelText("Application")).toBeDisabled();
  expect(screen.getByLabelText("Executable name")).toBeDisabled();
  expect(
    screen.getByRole("button", { name: "Refresh applications" }),
  ).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Application"), {
    target: { value: "app:code" },
  });
  expect(screen.getByLabelText("Executable name")).toHaveValue("custom-app");
  expect(changed).not.toHaveBeenCalled();
});
