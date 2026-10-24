import { useEffect, useRef, useState } from "react";
import type { Settings, SettingsUpdate } from "./types";
import { Toggle } from "./ui";

export default function BackgroundAudioControl({
  general,
  update,
  notify,
}: {
  general: Settings["general"];
  update: (patch: SettingsUpdate) => Promise<void>;
  notify: (message: string, error?: boolean) => void;
}) {
  const [reduction, setReduction] = useState(general.duckingReductionPercent);
  const submitted = useRef(general.duckingReductionPercent);
  const latest = useRef(general);
  latest.current = general;
  useEffect(() => {
    submitted.current = general.duckingReductionPercent;
    setReduction(general.duckingReductionPercent);
  }, [general.duckingReductionPercent]);

  function commit(value: number) {
    if (value === submitted.current) return;
    submitted.current = value;
    void update((current) => ({
      general: { ...current.general, duckingReductionPercent: value },
    })).catch((reason) => {
      if (submitted.current === value) {
        submitted.current = latest.current.duckingReductionPercent;
        setReduction(latest.current.duckingReductionPercent);
      }
      notify(String(reason), true);
    });
  }

  return (
    <div className="background-audio-control">
      <Toggle
        label="Lower background audio while speaking"
        description="Temporarily lower other apps while recording, then restore their volume when you stop."
        checked={general.duckBackgroundAudio}
        onChange={(enabled) => {
          void update((current) => ({
            general: { ...current.general, duckBackgroundAudio: enabled },
          })).catch((reason) => notify(String(reason), true));
        }}
      />
      <div className="audio-reduction">
        <div className="audio-reduction-label">
          <label htmlFor="background-audio-reduction">
            Background audio reduction
          </label>
          <output htmlFor="background-audio-reduction">
            Reduce by {reduction}%
          </output>
        </div>
        <input
          id="background-audio-reduction"
          type="range"
          min="10"
          max="90"
          step="5"
          value={reduction}
          disabled={!general.duckBackgroundAudio}
          aria-valuetext={`${reduction}% reduction, ${100 - reduction}% playback volume`}
          onChange={(event) => setReduction(Number(event.currentTarget.value))}
          onPointerUp={(event) => commit(Number(event.currentTarget.value))}
          onKeyUp={(event) => {
            if (
              [
                "ArrowLeft",
                "ArrowRight",
                "ArrowUp",
                "ArrowDown",
                "Home",
                "End",
                "PageUp",
                "PageDown",
              ].includes(event.key)
            )
              commit(Number(event.currentTarget.value));
          }}
          onBlur={(event) => commit(Number(event.currentTarget.value))}
        />
        <div className="audio-reduction-scale" aria-hidden="true">
          <span>Subtle</span>
          <span>Stronger</span>
        </div>
        <p className="helper">
          Playback stays at {100 - reduction}% of its original volume while you
          speak. Applies to the next recording.
        </p>
      </div>
    </div>
  );
}
