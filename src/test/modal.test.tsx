import { StrictMode, useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { Modal, useDialogFocus } from "../ui";
import { useRef } from "react";

afterEach(cleanup);
function Fixture() {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>Open dialog</button>
      {open && (
        <Modal title="Test dialog" onClose={() => setOpen(false)}>
          <input autoFocus aria-label="Dialog draft" />
          <button disabled={pending} onClick={() => setPending(true)}>
            Last dialog action
          </button>
        </Modal>
      )}
    </>
  );
}
it("restores the launcher after Escape even when React autofocus moved focus before the modal effect", () => {
  render(
    <StrictMode>
      <Fixture />
    </StrictMode>,
  );
  const launcher = screen.getByRole("button", { name: "Open dialog" });
  launcher.focus();
  fireEvent.click(launcher);
  const input = screen.getByLabelText("Dialog draft");
  expect(input).toHaveFocus();
  fireEvent.change(input, { target: { value: "Unsaved synthetic draft" } });
  fireEvent.keyDown(input, { key: "Escape" });
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(launcher).toHaveFocus();
});
it("traps Tab in the dialog and distinguishes inside clicks from backdrop dismissal", () => {
  render(<Fixture />);
  const launcher = screen.getByRole("button", { name: "Open dialog" });
  launcher.focus();
  fireEvent.click(launcher);
  const first = screen.getByRole("button", { name: "Close dialog" });
  const last = screen.getByRole("button", { name: "Last dialog action" });
  last.focus();
  fireEvent.keyDown(last, { key: "Tab" });
  expect(first).toHaveFocus();
  fireEvent.keyDown(first, { key: "Tab", shiftKey: true });
  expect(last).toHaveFocus();
  fireEvent.mouseDown(screen.getByRole("dialog"));
  expect(screen.getByRole("dialog")).toBeVisible();
  fireEvent.mouseDown(document.querySelector(".modal-backdrop")!);
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(launcher).toHaveFocus();
});

it("returns Tab to the dialog after a focused action becomes disabled or external feedback takes focus", () => {
  render(<Fixture />);
  const launcher = screen.getByRole("button", { name: "Open dialog" });
  launcher.focus();
  fireEvent.click(launcher);
  const last = screen.getByRole("button", { name: "Last dialog action" });
  last.focus();
  fireEvent.click(last);
  expect(last).toBeDisabled();
  fireEvent.keyDown(last, { key: "Tab" });
  expect(screen.getByRole("button", { name: "Close dialog" })).toHaveFocus();
  launcher.focus();
  fireEvent.keyDown(launcher, { key: "Tab", shiftKey: true });
  expect(screen.getByLabelText("Dialog draft")).toHaveFocus();
  launcher.focus();
  fireEvent.keyDown(launcher, { key: "Escape" });
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(launcher).toHaveFocus();
});

it("keeps setup-style Tab isolation without adding Escape dismissal or focus restoration", () => {
  function SetupFixture() {
    const ref = useRef<HTMLDivElement>(null);
    const [pending, setPending] = useState(false);
    useDialogFocus(ref, { restoreFocus: false, focusOnMount: false });
    return (
      <>
        <button>Outside feedback</button>
        <div ref={ref} role="dialog" aria-modal="true">
          <button>Pause setup</button>
          <button disabled={pending} onClick={() => setPending(true)}>
            Finish setup
          </button>
        </div>
      </>
    );
  }
  render(<SetupFixture />);
  const finish = screen.getByRole("button", { name: "Finish setup" });
  finish.focus();
  fireEvent.click(finish);
  fireEvent.keyDown(finish, { key: "Tab" });
  expect(screen.getByRole("button", { name: "Pause setup" })).toHaveFocus();
  const outside = screen.getByRole("button", { name: "Outside feedback" });
  outside.focus();
  fireEvent.keyDown(outside, { key: "Tab" });
  expect(screen.getByRole("button", { name: "Pause setup" })).toHaveFocus();
  fireEvent.keyDown(screen.getByRole("button", { name: "Pause setup" }), {
    key: "Escape",
  });
  expect(screen.getByRole("dialog")).toBeVisible();
});

it("lets only the top connected dialog handle Escape when dialogs overlap", () => {
  const previousOverflow = document.documentElement.style.overflow;
  function NestedFixture() {
    const [lower, setLower] = useState(true),
      [upper, setUpper] = useState(true);
    return (
      <>
        {lower && (
          <Modal title="Lower dialog" onClose={() => setLower(false)}>
            <button>Lower action</button>
          </Modal>
        )}
        {upper && (
          <Modal title="Upper dialog" onClose={() => setUpper(false)}>
            <button>Upper action</button>
          </Modal>
        )}
      </>
    );
  }
  render(<NestedFixture />);
  expect(document.documentElement.style.overflow).toBe("hidden");
  const upper = screen.getByRole("button", { name: "Upper action" });
  upper.focus();
  fireEvent.keyDown(upper, { key: "Tab" });
  expect(
    screen
      .getByRole("dialog", { name: "Upper dialog" })
      .contains(document.activeElement),
  ).toBe(true);
  fireEvent.keyDown(upper, { key: "Escape" });
  expect(screen.queryByRole("dialog", { name: "Upper dialog" })).toBeNull();
  expect(screen.getByRole("dialog", { name: "Lower dialog" })).toBeVisible();
  expect(document.documentElement.style.overflow).toBe("hidden");
  fireEvent.keyDown(document.body, { key: "Escape" });
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(document.documentElement.style.overflow).toBe(previousOverflow);
});

it("calls the current Escape callback and removes its document listener when unmounted", () => {
  const initial = vi.fn(),
    current = vi.fn();
  const view = render(
    <Modal title="Callback dialog" onClose={initial}>
      <button>Dialog action</button>
    </Modal>,
  );
  view.rerender(
    <Modal title="Callback dialog" onClose={current}>
      <button>Dialog action</button>
    </Modal>,
  );
  fireEvent.keyDown(document.body, { key: "Escape" });
  expect(initial).not.toHaveBeenCalled();
  expect(current).toHaveBeenCalledOnce();
  view.unmount();
  fireEvent.keyDown(document.body, { key: "Escape" });
  expect(current).toHaveBeenCalledOnce();
});
