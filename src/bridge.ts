import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { defaultSettings } from "./types";
import type { Settings, Snapshot, Session, DownloadProgress } from "./types";
export const desktop = isTauri();
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));
function previewSettings(): Settings {
  const base = clone(defaultSettings);
  let saved: Partial<Settings> = {};
  try {
    saved = JSON.parse(localStorage.getItem("cridvoice-preview") || "{}") || {};
  } catch {
    /* Restore a valid preview configuration. */
  }
  return {
    ...base,
    ...saved,
    transcription: { ...base.transcription, ...saved.transcription },
    cleanup: { ...base.cleanup, ...saved.cleanup },
    general: { ...base.general, ...saved.general },
    appearance: { ...base.appearance, ...saved.appearance },
    shortcuts: { ...base.shortcuts, ...saved.shortcuts },
  };
}
const previewSnapshot = (): Snapshot => ({
  settings: previewSettings(),
  history: [],
  hardware: {
    cpu: "Hardware detected in desktop app",
    ramGb: 0,
    gpus: [],
    cudaAvailable: false,
    threads: 0,
  },
  models: [],
  version: "0.1.18",
  portable: false,
  dataDir: "Available in desktop app",
});
export async function getSnapshot(): Promise<Snapshot> {
  return desktop ? invoke("get_snapshot") : previewSnapshot();
}
export async function saveSettings(settings: Settings): Promise<void> {
  if (desktop) return invoke("save_settings", { settings });
  localStorage.setItem("cridvoice-preview", JSON.stringify(settings));
}
export async function completeSetup(settings: Settings): Promise<void> {
  if (desktop) return invoke("complete_setup", { settings });
  if (
    settings.transcription.mode === "local" ||
    settings.cleanup.mode === "managed"
  )
    throw new Error(
      "Local AI setup must be completed in the Windows desktop app.",
    );
  return saveSettings(settings);
}
export async function command<T = void>(
  name: string,
  args?: Record<string, unknown>,
): Promise<T> {
  if (!desktop)
    throw new Error("This feature requires the Windows desktop app.");
  return invoke<T>(name, args);
}
export function warmSelectedModels(): Promise<void> {
  return command("warm_selected_models");
}
export async function events(
  onSession: (s: Session) => void,
  onDownload: (p: DownloadProgress) => void,
  onHistory: () => void,
  onState: () => void,
) {
  if (!desktop) return () => {};
  const registrations = await Promise.allSettled([
    listen<Session>("session", (e) => onSession(e.payload)),
    listen<DownloadProgress>("download", (e) => onDownload(e.payload)),
    listen("history-updated", onHistory),
    listen("models-updated", onState),
    listen("settings-updated", onState),
  ]);
  const off = registrations.flatMap((result) =>
    result.status === "fulfilled" ? [result.value] : [],
  );
  const failed = registrations.find((result) => result.status === "rejected");
  if (failed?.status === "rejected") {
    off.forEach((fn) => fn());
    throw failed.reason;
  }
  return () => off.forEach((fn) => fn());
}
