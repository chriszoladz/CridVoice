import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { Keyboard, RotateCcw } from "lucide-react";
import { command, desktop } from "./bridge";
import { Busy, Modal, Shortcut } from "./ui";
import { defaultSettings } from "./types";
import type { Settings } from "./types";

type Kind = keyof Settings["shortcuts"];
// All three editors share one native capture lease, including while switching
// between dialogs. A new begin must wait for the previous editor's end.
let nativeQueue: Promise<unknown> = Promise.resolve();
type CaptureEvent = {
  id: string;
  phase: "listening" | "candidate" | "complete" | "cancelled" | "error";
  shortcut?: string;
  error?: string;
};
export const shortcutNames: Record<Kind, string> = {
  hold: "Hold to dictate",
  toggle: "Toggle dictation",
  rewrite: "Rewrite selected text",
};
function parts(value: string) {
  const aliases: Record<string, string> = {
    control: "ctrl",
    windows: "super",
    win: "super",
    esc: "escape",
  };
  return value
    .toLowerCase()
    .split("+")
    .map((key) => aliases[key.trim()] || key.trim());
}
export function shortcutProblem(shortcuts: Settings["shortcuts"]): string {
  const entries = Object.entries(shortcuts) as [Kind, string][];
  for (const [kind, value] of entries) {
    const keys = parts(value);
    const ordinary = keys.filter(
      (key) => !["ctrl", "alt", "shift", "super"].includes(key),
    );
    if (!keys.some((key) => ["ctrl", "alt", "super"].includes(key)))
      return "Include Ctrl, Alt or Windows with your shortcut.";
    if (!ordinary.length && !(keys.includes("ctrl") && keys.includes("super")))
      return "A shortcut with only modifiers needs both Ctrl and Windows.";
    if (
      ordinary.length > 1 ||
      ordinary.some(
        (key) => !/^(?:[a-z0-9]|space|tab|f(?:[1-9]|1[0-9]|2[0-4]))$/.test(key),
      )
    )
      return "Use one letter, number, Space, Tab or F1–F24 with your modifier keys. Escape is reserved for cancel.";
    if (new Set(keys).size !== keys.length)
      return "Each key should appear only once.";
    const duplicate = entries.find(
      ([other, otherValue]) =>
        other !== kind &&
        [...parts(otherValue)].sort().join("+") === [...keys].sort().join("+"),
    );
    if (duplicate)
      return `${shortcutNames[kind]} and ${shortcutNames[duplicate[0]]} need different shortcuts.`;
  }
  const hold = parts(shortcuts.hold).sort();
  if (hold.every((key) => ["ctrl", "alt", "shift", "super"].includes(key))) {
    for (const kind of ["toggle", "rewrite"] as const) {
      const modifiers = parts(shortcuts[kind])
        .filter((key) => ["ctrl", "alt", "shift", "super"].includes(key))
        .sort();
      if (modifiers.join("+") === hold.join("+"))
        return `${shortcutNames[kind]} would also start hold dictation. Choose different modifier keys.`;
    }
  }
  return "";
}

export default function ShortcutRecorder({
  kind,
  value,
  shortcuts,
  onSave,
  disabled = false,
}: {
  kind: Kind;
  value: string;
  shortcuts: Settings["shortcuts"];
  onSave: (value: string) => Promise<void>;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [phase, setPhase] = useState("starting");
  const [candidate, setCandidate] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const saveButton = useRef<HTMLButtonElement>(null);
  const close = () => {
    if (!savingRef.current) setOpen(false);
  };
  useEffect(() => {
    if (phase === "complete") saveButton.current?.focus();
  }, [phase]);

  useEffect(() => {
    if (!open) return;
    let disposed = false;
    let interrupted = false;
    let off: (() => void) | undefined;
    const id = crypto.randomUUID();
    function nativeAction(name: string) {
      const next = nativeQueue
        .catch(() => {})
        .then(() => {
          if (name === "begin_shortcut_capture" && (disposed || interrupted))
            return;
          return command(name, { id });
        });
      nativeQueue = next.catch(() => {});
      return next;
    }
    setCandidate("");
    setError("");
    setPhase("starting");
    function receive(event: CaptureEvent) {
      if (
        disposed ||
        event.id !== id ||
        (interrupted && event.phase !== "cancelled")
      )
        return;
      setPhase(event.phase);
      if (event.shortcut) setCandidate(event.shortcut);
      if (event.error) setError(event.error);
      if (event.phase === "cancelled") {
        setCandidate("");
        setError(
          event.error ||
            "Capture stopped. Choose Try again when you are ready.",
        );
      }
    }
    async function start() {
      try {
        off = await listen<CaptureEvent>("shortcut-capture", (event) =>
          receive(event.payload),
        );
        if (disposed || interrupted) {
          off();
          return;
        }
        await nativeAction("begin_shortcut_capture");
        if (disposed || interrupted) await nativeAction("end_shortcut_capture");
      } catch (reason) {
        if (!disposed && !interrupted) {
          setPhase("error");
          setError(String(reason).replace(/^Error: /, ""));
        }
      }
    }
    // Browser preview simulates capture. Installed capture uses the native hook
    // so Windows chords cannot activate dictation while editing a binding.
    const down = new Set<string>();
    let preview = "";
    const chord = new Set<string>();
    let done = false;
    function keydown(event: KeyboardEvent) {
      if (done || event.isComposing) return;
      if (event.key === "Escape") {
        setOpen(false);
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.repeat) return;
      down.add(event.code || event.key);
      const keys = [
        event.ctrlKey && "Ctrl",
        event.altKey && "Alt",
        event.shiftKey && "Shift",
        event.metaKey && "Super",
      ].filter(Boolean) as string[];
      if (!["Control", "Alt", "Shift", "Meta"].includes(event.key)) {
        keys.push(
          event.key === " "
            ? "Space"
            : event.key.length === 1
              ? event.key.toUpperCase()
              : event.key,
        );
      }
      keys.forEach((key) => chord.add(key));
      preview = [...chord].join("+");
      receive({ id, phase: "candidate", shortcut: preview });
    }
    function keyup(event: KeyboardEvent) {
      if (done) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      down.delete(event.code || event.key);
      if (!down.size && preview) {
        done = true;
        receive({ id, phase: "complete", shortcut: preview });
      }
    }
    function blurred() {
      interrupted = true;
      if (desktop) void nativeAction("end_shortcut_capture").catch(() => {});
      receive({
        id,
        phase: "cancelled",
        error: "Capture paused because you switched windows. Choose Try again.",
      });
      done = true;
    }
    if (desktop) void start();
    else {
      setPhase("listening");
      window.addEventListener("keydown", keydown, true);
      window.addEventListener("keyup", keyup, true);
    }
    window.addEventListener("blur", blurred);
    return () => {
      disposed = true;
      off?.();
      if (desktop) void nativeAction("end_shortcut_capture").catch(() => {});
      window.removeEventListener("blur", blurred);
      window.removeEventListener("keydown", keydown, true);
      window.removeEventListener("keyup", keyup, true);
    };
  }, [open, attempt]);

  const problem = candidate
    ? shortcutProblem({ ...shortcuts, [kind]: candidate })
    : "";
  async function save() {
    if (savingRef.current || !candidate || problem || phase !== "complete")
      return;
    savingRef.current = true;
    setSaving(true);
    setError("");
    try {
      await onSave(candidate);
      setOpen(false);
    } catch (reason) {
      setError(String(reason).replace(/^Error: /, ""));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }
  async function restoreDefault() {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setError("");
    try {
      await onSave(defaultSettings.shortcuts[kind]);
    } catch (reason) {
      setError(String(reason).replace(/^Error: /, ""));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }
  return (
    <>
      <div className="shortcut-setting">
        <div>
          <strong>{shortcutNames[kind]}</strong>
          <Shortcut value={value} />
        </div>
        <button
          type="button"
          className="button secondary small"
          aria-label={`Change ${shortcutNames[kind].toLowerCase()}`}
          disabled={disabled || saving}
          onClick={() => setOpen(true)}
        >
          <Keyboard size={15} />
          Change
        </button>
        {value !== defaultSettings.shortcuts[kind] && (
          <button
            type="button"
            className="icon-button"
            aria-label={`Reset ${shortcutNames[kind].toLowerCase()} to default`}
            title="Use default shortcut"
            disabled={disabled || saving}
            onClick={() => void restoreDefault()}
          >
            <RotateCcw size={15} />
          </button>
        )}
      </div>
      {!open && error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      {open && (
        <Modal
          title={`Change ${shortcutNames[kind].toLowerCase()}`}
          onClose={close}
        >
          <p className="helper">
            Press your shortcut together, then release all keys. Nothing changes
            until you save.
          </p>
          <div
            className="shortcut-capture"
            aria-live="polite"
            aria-atomic="true"
          >
            <Keyboard size={24} />
            {candidate ? (
              <Shortcut value={candidate} />
            ) : (
              <strong>
                {phase === "starting"
                  ? "Getting ready…"
                  : phase === "listening"
                    ? "Press your keys"
                    : "Capture stopped"}
              </strong>
            )}
            <small>
              {phase === "candidate"
                ? "Release all keys to finish"
                : phase === "complete"
                  ? "Shortcut captured"
                  : "Escape cancels"}
            </small>
          </div>
          {(error || problem) && (
            <p className="error-text" role="alert">
              {error || problem}
            </p>
          )}
          <p className="helper">
            Use Ctrl, Alt, Shift or Windows with a letter, number, Space, Tab or
            function key. Ctrl + Windows also works on its own.
          </p>
          <div className="shortcut-capture-actions">
            <button
              type="button"
              className="button ghost small"
              disabled={saving}
              onClick={() => setAttempt((n) => n + 1)}
            >
              <RotateCcw size={14} />
              Try again
            </button>
          </div>
          <div className="modal-footer">
            <button
              type="button"
              className="button secondary"
              disabled={saving}
              onClick={close}
            >
              Cancel
            </button>
            <button
              ref={saveButton}
              type="button"
              className="button primary"
              disabled={
                saving || phase !== "complete" || !candidate || !!problem
              }
              onClick={() => void save()}
            >
              {saving ? <Busy label="Saving" /> : "Save shortcut"}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
