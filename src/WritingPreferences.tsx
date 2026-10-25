import { useEffect, useId, useRef, useState } from "react";
import type { Settings, SettingsUpdate } from "./types";

const LIMIT = 2000;

export default function WritingPreferences({
  settings,
  update,
  disabled = false,
}: {
  settings: Settings;
  update: (patch: SettingsUpdate) => Promise<void>;
  disabled?: boolean;
}) {
  const value = settings.cleanup.writingPreferences || "";
  const [draft, setDraft] = useState(value),
    [saved, setSaved] = useState(value);
  const [saving, setSaving] = useState(false),
    [error, setError] = useState("");
  const draftRef = useRef(value),
    savedRef = useRef(value),
    observedValue = useRef(value);
  const revision = useRef(0),
    submittedRevision = useRef(0),
    pending = useRef(false),
    mounted = useRef(false);
  const id = useId();
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (observedValue.current === value) return;
    observedValue.current = value;
    // App saves optimistically. The promise, not its intermediate snapshot,
    // acknowledges this editor's save. External changes never erase a draft.
    if (pending.current) return;
    const wasClean = draftRef.current === savedRef.current;
    savedRef.current = value;
    setSaved(value);
    if (wasClean) {
      draftRef.current = value;
      setDraft(value);
    }
  }, [value]);

  async function save(text: string) {
    if (pending.current || disabled || Array.from(text).length > LIMIT) return;
    const submitted = text.trim(),
      version = revision.current;
    submittedRevision.current = version;
    pending.current = true;
    setSaving(true);
    setError("");
    try {
      await update((current) => ({
        cleanup: { ...current.cleanup, writingPreferences: submitted },
      }));
      if (!mounted.current) return;
      savedRef.current = submitted;
      setSaved(submitted);
      if (revision.current === version) {
        draftRef.current = submitted;
        setDraft(submitted);
      }
    } catch (failure) {
      if (mounted.current)
        setError(
          `${revision.current === version ? "Preferences could not be saved." : "The previous draft could not be saved."} Your draft is still here. ${String(failure).replace(/^Error: /, "")}`,
        );
    } finally {
      pending.current = false;
      if (mounted.current) setSaving(false);
    }
  }
  const dirty = draft !== saved,
    length = Array.from(draft).length,
    tooLong = length > LIMIT;
  const status = saving
    ? revision.current === submittedRevision.current
      ? "Saving preferences..."
      : "Saving the previous draft. Your new changes are not saved."
    : dirty
      ? "Unsaved changes"
      : saved
        ? "Preferences saved"
        : "Using default preferences";
  return (
    <div className="writing-preferences">
      <label className="field" htmlFor={id}>
        <span>
          How should CridVoice write for you? <small>Optional</small>
        </span>
        <textarea
          id={id}
          rows={3}
          value={draft}
          disabled={disabled}
          aria-describedby={`${id}-help ${id}-limit`}
          aria-invalid={tooLong || undefined}
          placeholder={
            "Keep my slang, including “bro”. Don’t replace it with “buddy”. Use short paragraphs without making me sound formal."
          }
          onChange={(event) => {
            ++revision.current;
            draftRef.current = event.target.value;
            setDraft(event.target.value);
            setError("");
          }}
        />
      </label>
      <p className="helper" id={`${id}-help`}>
        Your own slang and forms of address are kept by default. Add preferences
        for tone, wording or formatting. Meaning, facts and uncertainty come
        first. Applies to Text mode across styles and strengths; code and CLI
        modes are unchanged.
      </p>
      <p className="helper">
        Custom preferences may take a little longer to apply while CridVoice
        checks your requested changes.
      </p>
      <div className="writing-preferences-actions">
        <button
          type="button"
          className="button primary small"
          disabled={disabled || saving || !dirty || tooLong}
          onClick={() => void save(draft)}
        >
          Save preferences
        </button>
        <button
          type="button"
          className="button secondary small"
          disabled={disabled || saving || (!draft && !saved)}
          onClick={() => void save("")}
        >
          Use defaults
        </button>
        <span className="helper" role="status" aria-live="polite">
          {status}
        </span>
        <small id={`${id}-limit`}>
          {length} / {LIMIT}
        </small>
      </div>
      {tooLong && (
        <p className="field-error" role="alert">
          Keep preferences to {LIMIT} characters. Your draft has not been
          shortened.
        </p>
      )}
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      {settings.cleanup.mode === "off" && (
        <p className="helper">
          Text cleanup is off. Your preferences can be saved now and will apply
          when cleanup is enabled.
        </p>
      )}
      {settings.cleanup.outputMode !== "text" && (
        <p className="helper">
          Your current output mode is code or commands. These preferences apply
          when you return to Text.
        </p>
      )}
    </div>
  );
}
