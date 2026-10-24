import type { Hardware, ModelInfo, Settings } from "./types";

export type SetupRoute = "managed" | "external" | "cloud";

export function getSetupPlan(
  settings: Settings,
  hardware: Pick<Hardware, "cudaAvailable">,
  models: ModelInfo[],
) {
  const gpu = (device: "auto" | "cpu" | "cuda") =>
    device === "cuda" || (device === "auto" && hardware.cudaAvailable);
  const requiredIds = Array.from(
    new Set([
      ...(settings.transcription.mode === "local"
        ? [
            settings.transcription.modelId,
            ...(gpu(settings.transcription.device) ? ["nvidia-runtime"] : []),
            ...(settings.appearance.livePreview ? ["whisper-preview"] : []),
          ]
        : []),
      ...(settings.cleanup.mode === "managed"
        ? [
            settings.cleanup.modelId,
            gpu(settings.cleanup.device) ? "llama-gpu" : "llama-cpu",
          ]
        : []),
    ]),
  );
  const assets = requiredIds.flatMap((id) => {
    const model = models.find((model) => model.id === id);
    return model ? [model] : [];
  });
  const unknownIds = requiredIds.filter(
    (id) => !models.some((model) => model.id === id),
  );
  const missing = assets.filter((asset) => !asset.installed);
  const missingIds = requiredIds.filter(
    (id) => !models.some((model) => model.id === id && model.installed),
  );
  const configurationErrors: string[] = [];
  if (
    settings.cleanup.mode === "off" &&
    settings.cleanup.outputMode &&
    settings.cleanup.outputMode !== "text"
  ) {
    configurationErrors.push(
      "Code and command modes require text cleanup. Enable it in Settings or select Text output mode.",
    );
  }
  if (settings.transcription.mode === "openai") {
    const provider = settings.providers.find(
      (p) => p.id === settings.transcription.providerId,
    );
    if (!provider) configurationErrors.push("Select an audio provider.");
    else if (provider.protocol !== "openai")
      configurationErrors.push(
        "Speech requires an OpenAI-compatible audio provider.",
      );
    else if (!provider.baseUrl.trim() || !provider.sttModel.trim())
      configurationErrors.push(
        "Set the selected audio provider URL and speech model ID.",
      );
  } else if (
    settings.transcription.device === "cuda" &&
    !hardware.cudaAvailable
  ) {
    configurationErrors.push(
      "NVIDIA GPU speech is unavailable. Select CPU or Automatic for speech.",
    );
  }
  if (settings.cleanup.mode === "provider") {
    const provider = settings.providers.find(
      (p) => p.id === settings.cleanup.providerId,
    );
    if (!provider) configurationErrors.push("Select a text-cleanup provider.");
    else if (!provider.baseUrl.trim() || !provider.model.trim())
      configurationErrors.push(
        "Set the selected text provider URL and text model ID.",
      );
  }
  return {
    requiredIds,
    assets,
    missingIds,
    missing,
    unknownIds,
    configurationErrors,
    downloadBytes: missing.reduce((total, asset) => total + asset.sizeBytes, 0),
    ready: missingIds.length === 0 && configurationErrors.length === 0,
  };
}

export function inferSetupProvider(settings: Settings) {
  return (
    (settings.cleanup.mode === "provider"
      ? settings.providers.find(
          (provider) => provider.id === settings.cleanup.providerId,
        )
      : undefined) ||
    (settings.transcription.mode === "openai"
      ? settings.providers.find(
          (provider) => provider.id === settings.transcription.providerId,
        )
      : undefined)
  );
}

export function inferSetupRoute(settings: Settings): SetupRoute {
  if (settings.cleanup.mode === "managed") return "managed";
  const provider = inferSetupProvider(settings);
  if (!provider) return "managed";
  try {
    return ["localhost", "127.0.0.1", "::1", "[::1]"].includes(
      new URL(provider.baseUrl).hostname,
    )
      ? "external"
      : "cloud";
  } catch {
    return "external";
  }
}
