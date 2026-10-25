import { useEffect, useRef, useState } from "react";
import { ChevronDown, RefreshCw } from "lucide-react";
import { command } from "./bridge";

export type ApplicationStyleEditorProps = {
  app: string;
  onAppChange: (app: string) => void;
  disabled?: boolean;
  recentApps?: string[];
};

const commonApps = [
  { value: "outlook", label: "Microsoft Outlook" },
  { value: "olk", label: "Outlook (new)" },
  { value: "ms-teams", label: "Microsoft Teams" },
  { value: "slack", label: "Slack" },
  { value: "chrome", label: "Google Chrome" },
  { value: "msedge", label: "Microsoft Edge" },
  { value: "brave", label: "Brave" },
  { value: "firefox", label: "Firefox" },
  { value: "code", label: "Visual Studio Code" },
  { value: "notepad", label: "Notepad" },
  { value: "winword", label: "Microsoft Word" },
  { value: "excel", label: "Microsoft Excel" },
  { value: "windowsterminal", label: "Windows Terminal" },
];

function processNames(values: string[]) {
  return values.filter(
    (value) =>
      typeof value === "string" &&
      value.trim() &&
      value.length <= 128 &&
      !/[\\/\x00-\x1f]/.test(value),
  );
}

export default function ApplicationStyleEditor({
  app,
  onAppChange,
  disabled = false,
  recentApps = [],
}: ApplicationStyleEditorProps) {
  const [running, setRunning] = useState<string[]>([]);
  const [custom, setCustom] = useState(
    () =>
      Boolean(app) &&
      !commonApps.some(
        (entry) => entry.value.toLowerCase() === app.toLowerCase(),
      ) &&
      !recentApps.some((entry) => entry.toLowerCase() === app.toLowerCase()),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const mounted = useRef(false);
  const request = useRef(0);
  const pending = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function refresh() {
    if (pending.current || !mounted.current) return;
    pending.current = true;
    const version = ++request.current;
    setBusy(true);
    setError("");
    const current = () => mounted.current && request.current === version;
    timer.current = setTimeout(() => {
      if (!current()) return;
      request.current += 1;
      timer.current = null;
      pending.current = false;
      setBusy(false);
      setError(
        "Running applications took too long to load. Choose a common app or enter a custom name, then try Refresh.",
      );
    }, 8000);
    void command<string[]>("running_applications")
      .then((values) => {
        if (!current()) return;
        if (!Array.isArray(values))
          throw new Error("Invalid application list.");
        setRunning(processNames(values).slice(0, 256));
      })
      .catch(() => {
        if (current())
          setError(
            "Running applications could not be loaded. Choose a common app or enter a custom name, then try Refresh.",
          );
      })
      .finally(() => {
        if (!current()) return;
        if (timer.current !== null) clearTimeout(timer.current);
        timer.current = null;
        pending.current = false;
        setBusy(false);
      });
  }

  useEffect(() => {
    mounted.current = true;
    refresh();
    return () => {
      mounted.current = false;
      request.current += 1;
      pending.current = false;
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = null;
    };
  }, []);

  const seen = new Set<string>();
  const unique = (entries: { value: string; label: string }[]) =>
    entries.filter((entry) => {
      const name = entry.value.toLowerCase();
      if (seen.has(name)) return false;
      seen.add(name);
      return true;
    });
  const groups = [
    { label: "Common apps", entries: unique(commonApps) },
    {
      label: "Recent apps",
      entries: unique(
        processNames(recentApps).map((value) => ({ value, label: value })),
      ),
    },
    {
      label: "Running apps",
      entries: unique(running.map((value) => ({ value, label: value }))),
    },
  ];
  const currentEntry = groups
    .flatMap((group) => group.entries)
    .find((entry) => entry.value === app);
  if (app && !currentEntry)
    groups.push({
      label: "Current entry",
      entries: [{ value: app, label: app }],
    });

  return (
    <div className="application-style-editor">
      <label className="field">
        <span>Application</span>
        <span className="select-wrap">
          <select
            aria-label="Application"
            value={custom ? "custom" : app ? `app:${app}` : ""}
            disabled={disabled}
            onChange={(event) => {
              if (disabled) return;
              const value = event.target.value;
              setCustom(value === "custom");
              if (value !== "custom") onAppChange(value ? value.slice(4) : "");
            }}
          >
            <option value="">Choose an application</option>
            {groups
              .filter((group) => group.entries.length)
              .map((group) => (
                <optgroup label={group.label} key={group.label}>
                  {group.entries.map((entry) => (
                    <option value={`app:${entry.value}`} key={entry.value}>
                      {entry.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            <option value="custom">Other / custom…</option>
          </select>
          <ChevronDown size={14} />
        </span>
      </label>
      {custom && (
        <label className="field">
          <span>Executable name</span>
          <input
            aria-label="Executable name"
            value={app}
            disabled={disabled}
            placeholder="e.g. my-editor"
            spellCheck={false}
            autoComplete="off"
            onChange={(event) => {
              if (!disabled) onAppChange(event.target.value);
            }}
          />
          <small>Enter an executable name, without its folder path.</small>
        </label>
      )}
      <button
        type="button"
        className="button ghost small"
        disabled={disabled || busy}
        aria-busy={busy}
        onClick={() => {
          if (!disabled) refresh();
        }}
      >
        <RefreshCw size={14} />
        Refresh applications
      </button>
      {busy && (
        <p className="helper" role="status">
          Loading running applications…
        </p>
      )}
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
