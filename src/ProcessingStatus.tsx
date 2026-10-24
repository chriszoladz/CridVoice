import {
  Check,
  LoaderCircle,
  SlidersHorizontal,
  TriangleAlert,
} from "lucide-react";
import type { Settings } from "./types";

export function processingRoute(settings: Settings) {
  const localSpeech = settings.transcription.mode === "local";
  const localCleanup = settings.cleanup.mode === "managed";
  const cleanupOff = settings.cleanup.mode === "off";
  const providerName = (id: string) =>
    settings.providers.find((provider) => provider.id === id)?.name ||
    "not selected";
  const speech = localSpeech
    ? "Local model"
    : `Provider (${providerName(settings.transcription.providerId)})`;
  const cleanup = cleanupOff
    ? "Off"
    : localCleanup
      ? "Local model"
      : `Provider (${providerName(settings.cleanup.providerId)})`;
  const label = cleanupOff
    ? localSpeech
      ? "Local speech"
      : "Provider speech"
    : localSpeech && localCleanup
      ? "Local processing"
      : !localSpeech && !localCleanup
        ? "Provider processing"
        : "Mixed processing";
  return { label, detail: `Speech: ${speech}. Cleanup: ${cleanup}.` };
}

export default function ProcessingStatus({
  settings,
  saving,
  saveFailed,
  openSettings,
}: {
  settings: Settings;
  saving: boolean;
  saveFailed: boolean;
  openSettings: () => void;
}) {
  const route = processingRoute(settings);
  const status = saving
    ? "Saving"
    : saveFailed
      ? "Save failed"
      : "Saved locally";
  const saveDetail = saving
    ? "Saving your settings on this device."
    : saveFailed
      ? "The latest change could not be saved. Previous saved settings are active."
      : "Your settings are saved on this device.";
  return (
    <div className="topbar-information">
      <span
        className={`saving${saveFailed && !saving ? " save-failed" : ""}`}
        role="status"
        aria-live="polite"
        aria-label={status}
        title={saveDetail}
      >
        {saving ? (
          <LoaderCircle size={14} className="spin" aria-hidden="true" />
        ) : saveFailed ? (
          <TriangleAlert size={14} aria-hidden="true" />
        ) : (
          <Check size={14} aria-hidden="true" />
        )}
        <span className="save-status-text">{status}</span>
      </span>
      <button
        type="button"
        className="processing-status-button"
        title={`${route.detail} Open processing settings.`}
        aria-label={`${route.label}. ${route.detail} Open processing settings.`}
        onClick={openSettings}
      >
        <SlidersHorizontal size={15} aria-hidden="true" />
        <span>{route.label}</span>
      </button>
    </div>
  );
}
