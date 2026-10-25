import type {
  EngineStatus,
  Hardware,
  ModelInfo,
  Settings,
  Snapshot,
} from "./types";

export function selectedLocalModels(
  settings: Settings,
  hardware: Pick<Hardware, "cudaAvailable">,
  models: ModelInfo[],
  engines: Snapshot["engineStatus"],
) {
  const gpu = (device: "auto" | "cpu" | "cuda") =>
    device === "cuda" || (device === "auto" && hardware.cudaAvailable);
  const selected: {
    kind: "speech" | "preview" | "cleanup";
    modelId: string;
    device: string;
    state: EngineStatus["state"] | "unavailable";
    loadable: boolean;
  }[] = [];
  for (const kind of ["speech", "preview", "cleanup"] as const) {
    if (
      kind === "cleanup"
        ? settings.cleanup.mode !== "managed"
        : settings.transcription.mode !== "local" ||
          (kind === "preview" && !settings.appearance.livePreview)
    )
      continue;
    const config =
      kind === "cleanup" ? settings.cleanup : settings.transcription;
    const modelId = kind === "preview" ? "whisper-preview" : config.modelId;
    const useGpu = kind !== "preview" && gpu(config.device);
    const device = useGpu ? (kind === "speech" ? "cuda" : "vulkan") : "cpu";
    const status = engines?.[kind];
    const matches = status?.modelId === modelId && status.device === device;
    const required = [
      modelId,
      ...(kind === "cleanup"
        ? [useGpu ? "llama-gpu" : "llama-cpu"]
        : useGpu
          ? ["nvidia-runtime"]
          : []),
    ];
    selected.push({
      kind,
      modelId,
      device,
      state: !status ? "unavailable" : matches ? status.state : "unloaded",
      loadable:
        !(kind === "speech" && useGpu && !hardware.cudaAvailable) &&
        required.every((id) =>
          models.some((model) => model.id === id && model.installed),
        ),
    });
  }
  return selected;
}
