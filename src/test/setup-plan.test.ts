import { describe, expect, it } from "vitest";
import {
  getSetupPlan,
  inferSetupProvider,
  inferSetupRoute,
} from "../setupPlan";
import { defaultSettings } from "../types";
import type { ModelInfo, Provider } from "../types";

const ids = [
  "whisper-turbo",
  "whisper-small",
  "whisper-preview",
  "nvidia-runtime",
  "qwen3-4b",
  "llama-gpu",
  "llama-cpu",
];
const catalog = (installed: string[] = []): ModelInfo[] =>
  ids.map((id) => ({
    id,
    name: id,
    kind:
      id === "whisper-preview"
        ? "preview"
        : id.startsWith("whisper")
          ? "speech"
          : id.startsWith("qwen")
            ? "cleanup"
            : "runtime",
    description: "Test component",
    license: "Test",
    sizeBytes: 100,
    files: [],
    installed: installed.includes(id),
  }));
const provider = (
  id: string,
  baseUrl = "https://example.test/v1",
): Provider => ({
  id,
  name: id,
  baseUrl,
  protocol: "openai",
  model: "text-model",
  sttModel: "audio-model",
  hasKey: true,
});

describe("Selected setup requirements", () => {
  it("requires cleanup for code and generation while leaving normal raw transcription available", () => {
    const settings = structuredClone(defaultSettings);
    settings.cleanup.mode = "off";
    for (const outputMode of ["code", "generate"] as const) {
      settings.cleanup.outputMode = outputMode;
      const plan = getSetupPlan(
        settings,
        { cudaAvailable: false },
        catalog(ids),
      );
      expect(plan.ready).toBe(false);
      expect(plan.configurationErrors).toContain(
        "Code and command modes require text cleanup. Enable it in Settings or select Text output mode.",
      );
    }
    settings.cleanup.outputMode = "text";
    expect(
      getSetupPlan(settings, { cudaAvailable: false }, catalog(ids)).ready,
    ).toBe(true);
  });
  it("includes every managed GPU stage and only downloads missing components", () => {
    const result = getSetupPlan(
      structuredClone(defaultSettings),
      { cudaAvailable: true },
      catalog(["whisper-turbo", "nvidia-runtime"]),
    );
    expect(result.requiredIds).toEqual([
      "whisper-turbo",
      "nvidia-runtime",
      "whisper-preview",
      "qwen3-4b",
      "llama-gpu",
    ]);
    expect(result.missingIds).toEqual([
      "whisper-preview",
      "qwen3-4b",
      "llama-gpu",
    ]);
    expect(result.downloadBytes).toBe(300);
    expect(result.ready).toBe(false);
    expect(
      getSetupPlan(
        defaultSettings,
        { cudaAvailable: true },
        catalog(result.requiredIds),
      ).ready,
    ).toBe(true);
  });

  it("chooses CPU requirements for automatic devices without NVIDIA", () => {
    expect(
      getSetupPlan(defaultSettings, { cudaAvailable: false }, catalog())
        .requiredIds,
    ).toEqual(["whisper-turbo", "whisper-preview", "qwen3-4b", "llama-cpu"]);
  });

  it("allows explicit Vulkan cleanup GPU while requiring CPU speech on non-NVIDIA hardware", () => {
    const settings = structuredClone(defaultSettings);
    settings.transcription.device = "cpu";
    settings.cleanup.device = "cuda";
    const result = getSetupPlan(
      settings,
      { cudaAvailable: false },
      catalog(["whisper-turbo", "whisper-preview", "qwen3-4b", "llama-gpu"]),
    );
    expect(result.requiredIds).toEqual([
      "whisper-turbo",
      "whisper-preview",
      "qwen3-4b",
      "llama-gpu",
    ]);
    expect(result.ready).toBe(true);
    settings.transcription.device = "cuda";
    const unsupported = getSetupPlan(
      settings,
      { cudaAvailable: false },
      catalog(ids),
    );
    expect(unsupported.ready).toBe(false);
    expect(unsupported.configurationErrors[0]).toMatch(/NVIDIA/);
  });

  it("preserves independent remote providers and requires no local components", () => {
    const settings = structuredClone(defaultSettings);
    settings.providers = [
      provider("audio"),
      provider("text", "http://127.0.0.1:1234/v1"),
    ];
    settings.transcription.mode = "openai";
    settings.transcription.providerId = "audio";
    settings.cleanup.mode = "provider";
    settings.cleanup.providerId = "text";
    const original = structuredClone(settings);
    expect(getSetupPlan(settings, { cudaAvailable: true }, []).ready).toBe(
      true,
    );
    expect(
      getSetupPlan(settings, { cudaAvailable: true }, []).requiredIds,
    ).toEqual([]);
    expect(inferSetupRoute(settings)).toBe("external");
    expect(inferSetupProvider(settings)?.id).toBe("text");
    expect(settings).toEqual(original);
  });

  it("omits disabled cleanup and does not call an unknown local component ready", () => {
    const settings = structuredClone(defaultSettings);
    settings.cleanup.mode = "off";
    settings.transcription.modelId = "unlisted-model";
    const result = getSetupPlan(
      settings,
      { cudaAvailable: true },
      catalog(ids),
    );
    expect(result.requiredIds).toEqual([
      "unlisted-model",
      "nvidia-runtime",
      "whisper-preview",
    ]);
    expect(result.unknownIds).toEqual(["unlisted-model"]);
    expect(result.missingIds).toEqual(["unlisted-model"]);
    expect(result.ready).toBe(false);
  });

  it("requires the independent preview asset only for local speech with live preview enabled", () => {
    const settings = structuredClone(defaultSettings);
    settings.cleanup.mode = "off";
    settings.transcription.device = "cpu";
    const installed = catalog(["whisper-turbo"]);
    const missing = getSetupPlan(settings, { cudaAvailable: false }, installed);
    expect(missing.requiredIds).toEqual(["whisper-turbo", "whisper-preview"]);
    expect(missing.missingIds).toEqual(["whisper-preview"]);
    expect(missing.ready).toBe(false);
    settings.appearance.livePreview = false;
    expect(
      getSetupPlan(settings, { cudaAvailable: false }, installed).ready,
    ).toBe(true);
    settings.appearance.livePreview = true;
    settings.transcription.mode = "openai";
    settings.transcription.providerId = "audio";
    settings.providers = [provider("audio")];
    const remote = getSetupPlan(settings, { cudaAvailable: false }, []);
    expect(remote.requiredIds).toEqual([]);
    expect(remote.ready).toBe(true);
  });

  it("blocks remote setup when selected providers or speech/text model IDs are invalid", () => {
    const settings = structuredClone(defaultSettings);
    settings.transcription.mode = "openai";
    settings.transcription.providerId = "audio";
    settings.cleanup.mode = "provider";
    settings.cleanup.providerId = "text";
    expect(getSetupPlan(settings, { cudaAvailable: false }, []).ready).toBe(
      false,
    );
    settings.providers = [provider("audio"), provider("text")];
    settings.providers[0].protocol = "anthropic";
    settings.providers[1].model = " ";
    const result = getSetupPlan(settings, { cudaAvailable: false }, []);
    expect(result.requiredIds).toEqual([]);
    expect(result.configurationErrors).toHaveLength(2);
    expect(result.ready).toBe(false);
  });
});
