import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { EventCallback } from "@tauri-apps/api/event";
import type { PhysicalSize } from "@tauri-apps/api/dpi";

const api = vi.hoisted(() => ({
  getCurrentWindow: vi.fn(),
  isMaximized: vi.fn(),
  onResized: vi.fn(),
  minimize: vi.fn(),
  toggleMaximize: vi.fn(),
  close: vi.fn(),
  startDragging: vi.fn(),
  destroy: vi.fn(),
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: api.getCurrentWindow,
}));
vi.mock("../bridge", () => ({ desktop: false }));
import WindowTitlebar from "../WindowTitlebar";

let resized: EventCallback<PhysicalSize>;
let off: ReturnType<typeof vi.fn<() => void>>;
beforeEach(() => {
  vi.resetAllMocks();
  off = vi.fn<() => void>();
  api.getCurrentWindow.mockReturnValue(api);
  api.isMaximized.mockResolvedValue(false);
  api.onResized.mockImplementation(async (handler) => {
    resized = handler;
    return off;
  });
  for (const method of [
    api.minimize,
    api.toggleMaximize,
    api.close,
    api.startDragging,
  ])
    method.mockResolvedValue(undefined);
});
afterEach(cleanup);
function titlebar(onError = vi.fn(), enabled = true) {
  return (
    <WindowTitlebar
      enabled={enabled}
      onError={onError}
      actions={<button>Help</button>}
    >
      <span>CridVoice</span>
    </WindowTitlebar>
  );
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

it("uses native minimize, maximize/restore and CloseRequested actions without destroying or exiting", async () => {
  render(titlebar());
  fireEvent.click(screen.getByRole("button", { name: "Minimize window" }));
  await waitFor(() => expect(api.minimize).toHaveBeenCalledOnce());
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Maximize window" }),
    ).toBeEnabled(),
  );
  api.isMaximized.mockResolvedValue(true);
  fireEvent.click(screen.getByRole("button", { name: "Maximize window" }));
  await screen.findByRole("button", { name: "Restore window" });
  api.isMaximized.mockResolvedValue(false);
  fireEvent.click(screen.getByRole("button", { name: "Restore window" }));
  await screen.findByRole("button", { name: "Maximize window" });
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Close window" })).toBeEnabled(),
  );
  fireEvent.click(screen.getByRole("button", { name: "Close window" }));
  await waitFor(() => expect(api.close).toHaveBeenCalledOnce());
  expect(api.toggleMaximize).toHaveBeenCalledTimes(2);
  expect(api.destroy).not.toHaveBeenCalled();
});

it("applies a newer resize result instead of an older delayed initial maximized query", async () => {
  const initial = deferred<boolean>();
  api.isMaximized.mockReturnValueOnce(initial.promise).mockResolvedValue(true);
  render(titlebar());
  await waitFor(() => expect(api.onResized).toHaveBeenCalledOnce());
  await act(async () =>
    resized({ payload: { width: 1440, height: 1080 } } as never),
  );
  await screen.findByRole("button", { name: "Restore window" });
  await act(async () => initial.resolve(false));
  expect(screen.getByRole("button", { name: "Restore window" })).toBeVisible();
});

it("removes a late resize subscription and ignores its callbacks after unmounting", async () => {
  const registered = deferred<() => void>();
  api.onResized.mockImplementation((handler) => {
    resized = handler;
    return registered.promise;
  });
  const onError = vi.fn();
  const view = render(titlebar(onError));
  view.unmount();
  await act(async () => registered.resolve(off));
  expect(off).toHaveBeenCalledOnce();
  api.isMaximized.mockRejectedValue(new Error("Private error text"));
  await act(async () =>
    resized({ payload: { width: 900, height: 640 } } as never),
  );
  expect(onError).not.toHaveBeenCalled();
});

it("drags only a left single press and maximizes exactly once for a double-click in the drag area", async () => {
  const view = render(titlebar());
  const drag = view.container.querySelector(".window-drag-region")!;
  expect(drag).not.toHaveAttribute("data-tauri-drag-region");
  fireEvent.mouseDown(drag, { button: 2, detail: 1 });
  fireEvent.mouseDown(drag, { button: 0, detail: 1 });
  fireEvent.mouseDown(drag, { button: 0, detail: 2 });
  fireEvent.doubleClick(drag, { button: 0, detail: 2 });
  await waitFor(() => expect(api.toggleMaximize).toHaveBeenCalledOnce());
  expect(api.startDragging).toHaveBeenCalledOnce();
  fireEvent.mouseDown(screen.getByRole("button", { name: "Help" }), {
    button: 0,
    detail: 1,
  });
  fireEvent.doubleClick(screen.getByRole("button", { name: "Close window" }), {
    button: 0,
  });
  expect(api.startDragging).toHaveBeenCalledOnce();
  expect(api.toggleMaximize).toHaveBeenCalledOnce();
});

it("excludes interactive descendants supplied inside the drag region", async () => {
  render(
    <WindowTitlebar enabled onError={vi.fn()}>
      <a href="#help">Documentation</a>
      <button>Another action</button>
    </WindowTitlebar>,
  );
  for (const element of [
    screen.getByRole("link"),
    screen.getByRole("button", { name: "Another action" }),
  ]) {
    fireEvent.mouseDown(element, { button: 0, detail: 1 });
    fireEvent.doubleClick(element, { button: 0 });
  }
  expect(api.startDragging).not.toHaveBeenCalled();
  expect(api.toggleMaximize).not.toHaveBeenCalled();
});

it("does not register listeners, show controls or call window APIs in browser preview", () => {
  const view = render(titlebar(vi.fn(), false));
  fireEvent.mouseDown(view.container.querySelector(".window-drag-region")!, {
    button: 0,
    detail: 1,
  });
  fireEvent.doubleClick(view.container.querySelector(".window-drag-region")!, {
    button: 0,
  });
  expect(screen.queryByRole("group", { name: "Window controls" })).toBeNull();
  expect(api.getCurrentWindow).not.toHaveBeenCalled();
});

it("bounds action retries and reports a fixed error after failure", async () => {
  const pending = deferred<void>();
  api.minimize
    .mockReturnValueOnce(pending.promise)
    .mockRejectedValueOnce(new Error("Private error text"));
  const onError = vi.fn();
  render(titlebar(onError));
  const minimize = screen.getByRole("button", { name: "Minimize window" });
  fireEvent.click(minimize);
  fireEvent.click(minimize);
  expect(api.minimize).toHaveBeenCalledOnce();
  await act(async () => pending.resolve());
  await waitFor(() => expect(minimize).toBeEnabled());
  fireEvent.click(minimize);
  await waitFor(() =>
    expect(onError).toHaveBeenCalledWith(
      "The window action could not be completed.",
    ),
  );
  expect(minimize).toBeEnabled();
});
