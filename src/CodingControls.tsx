import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import type { OutputMode, Settings, SettingsUpdate } from "./types";

type CodingControlsProps = {
  settings: Settings;
  update: (patch: SettingsUpdate) => Promise<void>;
  disabled?: boolean;
  onOpenSettings?: () => void;
  detectedLanguage?: string | null;
  detectionActive?: boolean;
};

const languageGroups = [
  {
    label: "Shells",
    values: ["PowerShell", "Windows CMD", "Bash", "Zsh", "Fish", "POSIX shell"],
  },
  {
    label: "Languages",
    values: [
      "Python",
      "TypeScript",
      "JavaScript",
      "Rust",
      "Go",
      "C",
      "C++",
      "C#",
      "Java",
      "SQL",
      "HTML",
      "CSS",
      "JSON",
      "YAML",
    ],
  },
];

function selectionFor(value: string) {
  if (!value.trim()) return "auto";
  return languageGroups.some((group) => group.values.includes(value))
    ? `preset:${value}`
    : "manual";
}

export default function CodingControls({
  settings,
  update,
  disabled = false,
  onOpenSettings,
  detectedLanguage,
  detectionActive = false,
}: CodingControlsProps) {
  const value = settings.cleanup.codeLanguage || "";
  const outputMode = settings.cleanup.outputMode || "text";
  const cleanupOff = settings.cleanup.mode === "off";
  const [draft, setDraft] = useState(value);
  const [selection, setSelection] = useState(() => selectionFor(value));
  const manual = selection === "manual";
  const [modeError, setModeError] = useState("");
  const [hintError, setHintError] = useState("");
  const dirty = useRef(false);
  const revision = useRef(0);
  const latestValue = useRef(value);
  const pending = useRef<{ value: string; revision: number } | null>(null);
  const modeRequest = useRef(0);
  latestValue.current = value;
  useEffect(() => {
    if (!dirty.current) {
      setDraft(value);
      setSelection(selectionFor(value));
    }
  }, [value]);

  function changeMode(mode: OutputMode) {
    if (disabled || (cleanupOff && mode !== "text")) return;
    const request = ++modeRequest.current;
    setModeError("");
    void update((current) => {
      if (current.cleanup.mode === "off" && mode !== "text")
        throw new Error(
          "Enable text cleanup in Settings to use code or command modes.",
        );
      return { cleanup: { ...current.cleanup, outputMode: mode } };
    }).catch((reason) => {
      if (modeRequest.current === request)
        setModeError(String(reason).replace(/^Error: /, ""));
    });
  }
  function saveHint(next = draft.trim()) {
    if (disabled) return;
    if (
      pending.current?.value === next &&
      pending.current.revision === revision.current
    )
      return;
    if (!pending.current && next === latestValue.current) {
      dirty.current = false;
      setDraft(next);
      setSelection(selectionFor(next));
      setHintError("");
      return;
    }
    const request = { value: next, revision: revision.current };
    pending.current = request;
    setHintError("");
    void update((current) => ({
      cleanup: { ...current.cleanup, codeLanguage: next },
    }))
      .then(() => {
        if (
          pending.current === request &&
          revision.current === request.revision
        ) {
          dirty.current = false;
          setDraft(next);
          setSelection(selectionFor(next));
        }
      })
      .catch((reason) => {
        if (
          pending.current === request &&
          revision.current === request.revision
        ) {
          setHintError(
            `${next ? "Language override" : "Automatic detection"} could not be saved: ${String(reason).replace(/^Error: /, "")}`,
          );
        }
      })
      .finally(() => {
        if (pending.current === request) pending.current = null;
      });
  }

  return (
    <div className="coding-controls">
      <div className="coding-fields">
        <label className="field">
          <span>Output mode</span>
          <span className="select-wrap">
            <select
              aria-label="Output mode"
              value={outputMode}
              disabled={disabled}
              onChange={(event) => changeMode(event.target.value as OutputMode)}
            >
              <option value="text">Text</option>
              <option value="code" disabled={cleanupOff}>
                Dictate code or commands
              </option>
              <option value="generate" disabled={cleanupOff}>
                Generate code or commands
              </option>
            </select>
            <ChevronDown size={14} />
          </span>
        </label>
        <div className="field">
          <span>Code language or shell</span>
          <div className={`code-language-fields${manual ? " manual" : ""}`}>
            <span className="select-wrap">
              <select
                aria-label="Code language or shell"
                value={selection}
                disabled={disabled}
                onChange={(event) => {
                  if (disabled) return;
                  const choice = event.target.value;
                  dirty.current = true;
                  revision.current += 1;
                  setSelection(choice);
                  setHintError("");
                  if (choice !== "manual") {
                    const next =
                      choice === "auto" ? "" : choice.slice("preset:".length);
                    setDraft(next);
                    saveHint(next);
                  }
                }}
              >
                <option value="auto">Automatic</option>
                {languageGroups.map((group) => (
                  <optgroup label={group.label} key={group.label}>
                    {group.values.map((language) => (
                      <option value={`preset:${language}`} key={language}>
                        {language}
                      </option>
                    ))}
                  </optgroup>
                ))}
                <option value="manual">Other / custom…</option>
              </select>
              <ChevronDown size={14} />
            </span>
            {manual && (
              <input
                aria-label="Language or shell override"
                value={draft}
                disabled={disabled}
                maxLength={80}
                placeholder="e.g. Python or PowerShell"
                onChange={(event) => {
                  dirty.current = true;
                  revision.current += 1;
                  setHintError("");
                  setDraft(
                    event.target.value.replace(/[\r\n]/g, " ").slice(0, 80),
                  );
                }}
                onBlur={() => saveHint()}
                onKeyDown={(event) => {
                  if (event.key === "Enter") event.currentTarget.blur();
                }}
              />
            )}
          </div>
        </div>
      </div>
      <p className="coding-description">
        {outputMode === "generate"
          ? "Describe what to build. Generated output opens here for review and copying."
          : outputMode === "code"
            ? "Dictate literal code or commands, including punctuation and new lines. Multiline commands in a terminal open here for review."
            : "Dictate normal text using your selected writing style. Automatic detects the language or shell only in code and command modes."}
      </p>
      {manual && !draft.trim() && (
        <p className="coding-manual-empty">
          {value.trim()
            ? `Saved override: ${value}. Enter a new language or shell, or choose Automatic to clear it.`
            : "Enter a language or shell. Automatic detection applies until an override is saved."}
        </p>
      )}
      {outputMode !== "text" && (
        <p className="coding-detection">
          {value.trim()
            ? `Override: ${value}`
            : detectedLanguage
              ? `${detectionActive ? "Detected" : "Last detected"}: ${detectedLanguage}`
              : "Automatic"}
          {!value.trim() && (
            <span>
              {settings.general.context
                ? " · Uses the active editor or shell and what you say."
                : " · Target app context is off; uses what you say."}
            </span>
          )}
        </p>
      )}
      {outputMode === "code" && (
        <p className="coding-examples">
          Examples: <code>git status</code> · “git switch dash dash create
          feature-name”
        </p>
      )}
      {cleanupOff && (
        <p className="coding-unavailable">
          Code and command modes require text cleanup.{" "}
          {onOpenSettings && (
            <button
              className="text-button"
              type="button"
              disabled={disabled}
              onClick={onOpenSettings}
            >
              Enable in Settings
            </button>
          )}
        </p>
      )}
      {modeError && (
        <p className="error-text" role="alert">
          {modeError}
        </p>
      )}
      {hintError && (
        <p className="error-text" role="alert">
          {hintError}{" "}
          <button
            type="button"
            className="text-button"
            disabled={disabled}
            onClick={() => saveHint(selection === "auto" ? "" : draft.trim())}
          >
            Retry language setting
          </button>
        </p>
      )}
    </div>
  );
}
