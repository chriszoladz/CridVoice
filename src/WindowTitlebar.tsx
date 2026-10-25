import { useEffect, useRef, useState } from "react";
import type { MouseEvent, ReactNode } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Copy, Minus, Square, X } from "lucide-react";
import { desktop } from "./bridge";

type Props = {
  children: ReactNode;
  actions?: ReactNode;
  onError: (message: string) => void;
  enabled?: boolean;
};

export default function WindowTitlebar({
  children,
  actions,
  onError,
  enabled = desktop,
}: Props) {
  const [maximized, setMaximized] = useState(false);
  const [pending, setPending] = useState(false);
  const handle = useRef<ReturnType<typeof getCurrentWindow> | null>(null);
  const active = useRef(false);
  const operation = useRef(false);
  const queryEpoch = useRef(0);
  const refreshState = useRef<() => Promise<void>>(async () => {});
  const report = useRef(onError);
  report.current = onError;
  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    const current = getCurrentWindow();
    handle.current = current;
    active.current = true;
    async function sync() {
      if (disposed) return;
      const epoch = ++queryEpoch.current;
      try {
        const value = await current.isMaximized();
        if (!disposed && epoch === queryEpoch.current) setMaximized(value);
      } catch {
        if (!disposed && epoch === queryEpoch.current)
          report.current("Window state could not be read.");
      }
    }
    refreshState.current = sync;
    void current
      .onResized(() => void sync())
      .then((off) => {
        if (disposed) off();
        else unlisten = off;
      })
      .catch(() => {
        if (!disposed)
          report.current("Window resize updates could not be connected.");
      });
    void sync();
    return () => {
      disposed = true;
      active.current = false;
      queryEpoch.current += 1;
      handle.current = null;
      unlisten?.();
    };
  }, [enabled]);

  async function run(action: "minimize" | "toggleMaximize" | "close") {
    const current = handle.current;
    if (!enabled || !active.current || !current || operation.current) return;
    operation.current = true;
    setPending(true);
    try {
      await current[action]();
      if (action === "toggleMaximize") await refreshState.current();
    } catch {
      if (active.current)
        report.current("The window action could not be completed.");
    } finally {
      operation.current = false;
      if (active.current) setPending(false);
    }
  }
  function interactive(event: MouseEvent<HTMLDivElement>) {
    return (
      event.target instanceof Element &&
      !!event.target.closest(
        "button, a, input, select, textarea, [role='button'], [contenteditable='true']",
      )
    );
  }
  function drag(event: MouseEvent<HTMLDivElement>) {
    if (
      !enabled ||
      event.button !== 0 ||
      event.detail > 1 ||
      interactive(event)
    )
      return;
    void handle.current?.startDragging().catch(() => {
      if (active.current) report.current("The window could not be moved.");
    });
  }
  return (
    <header className="topbar window-titlebar">
      <div
        className="window-drag-region"
        onMouseDown={drag}
        onDoubleClick={(event) => {
          if (event.button === 0 && !interactive(event))
            void run("toggleMaximize");
        }}
      >
        {children}
      </div>
      <div className="topbar-actions">
        {actions}
        {enabled && (
          <div
            className="window-controls"
            role="group"
            aria-label="Window controls"
          >
            <button
              type="button"
              aria-label="Minimize window"
              title="Minimize"
              disabled={pending}
              onClick={() => void run("minimize")}
            >
              <Minus size={15} />
            </button>
            <button
              type="button"
              aria-label={maximized ? "Restore window" : "Maximize window"}
              title={maximized ? "Restore" : "Maximize"}
              disabled={pending}
              onClick={() => void run("toggleMaximize")}
            >
              {maximized ? <Copy size={13} /> : <Square size={13} />}
            </button>
            <button
              type="button"
              className="window-close"
              aria-label="Close window"
              title="Close to tray"
              disabled={pending}
              onClick={() => void run("close")}
            >
              <X size={16} />
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
