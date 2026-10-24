import { useState, useEffect, useRef } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Cloud,
  Cpu,
  Download,
  Mic,
  Server,
  X,
} from "lucide-react";
import { command, desktop, getSnapshot } from "./bridge";
import ProviderModelPicker from "./ProviderModelPicker";
import { BrandMark } from "./BrandMark";
import { getSetupPlan, inferSetupProvider, inferSetupRoute } from "./setupPlan";
import type { SetupRoute } from "./setupPlan";
import {
  Badge,
  Busy,
  Field,
  Select,
  Toggle,
  bytes,
  cleanupDevices,
  devices,
  languages,
  useDialogFocus,
  writingStyles,
} from "./ui";
import type { DownloadProgress, Provider, Settings, Snapshot } from "./types";
export default function Onboarding({
  snapshot,
  onFinish,
  notify,
  downloads = {},
  repair = snapshot.settings.setupComplete,
  onClose,
}: {
  snapshot: Snapshot;
  onFinish: (
    settings: Settings,
    credential?: { id: string; value: string },
  ) => Promise<void>;
  notify: (message: string, error?: boolean) => void;
  downloads?: Record<string, DownloadProgress>;
  repair?: boolean;
  onClose?: () => void;
}) {
  const [step, setStep] = useState(repair ? 3 : 0),
    [route, setRoute] = useState<SetupRoute>(() =>
      inferSetupRoute(snapshot.settings),
    ),
    [draft, setDraft] = useState<Settings>(() =>
      structuredClone(snapshot.settings),
    ),
    [provider, setProvider] = useState<Provider>(() =>
      structuredClone(
        inferSetupProvider(snapshot.settings) || newProvider("external"),
      ),
    ),
    [key, setKey] = useState(""),
    [busy, setBusy] = useState(false),
    [phase, setPhase] = useState<
      "idle" | "installing" | "checking" | "saving" | "paused" | "error"
    >("idle"),
    [activeId, setActiveId] = useState(""),
    [setupError, setSetupError] = useState(""),
    [liveSnapshot, setLiveSnapshot] = useState(snapshot);
  const running = useRef(false),
    pauseRequested = useRef(false),
    activeRef = useRef("");
  const progressRef = useRef(downloads);
  progressRef.current = downloads;
  useEffect(() => setLiveSnapshot(snapshot), [snapshot]);
  function newProvider(r: "external" | "cloud"): Provider {
    return {
      id: crypto.randomUUID(),
      name: r === "cloud" ? "OpenAI" : "LM Studio",
      protocol: "openai",
      baseUrl:
        r === "cloud"
          ? "https://api.openai.com/v1"
          : "http://127.0.0.1:1234/v1",
      model: r === "cloud" ? "gpt-4.1-mini" : "",
      sttModel: r === "cloud" ? "gpt-4o-mini-transcribe" : "",
      hasKey: false,
    };
  }
  function selectedSettings(): Settings {
    const used =
      (draft.cleanup.mode === "provider" &&
        draft.cleanup.providerId === provider.id) ||
      (draft.transcription.mode === "openai" &&
        draft.transcription.providerId === provider.id);
    const existing = draft.providers.some((p) => p.id === provider.id);
    return {
      ...draft,
      providers: existing
        ? draft.providers.map((p) => (p.id === provider.id ? provider : p))
        : used
          ? [...draft.providers, provider]
          : draft.providers,
      setupComplete: true,
    };
  }
  const selected = selectedSettings();
  const plan = getSetupPlan(
    selected,
    liveSnapshot.hardware,
    liveSnapshot.models,
  );
  const providerOptions = selected.providers.map((p) => ({
    value: p.id,
    label: p.name,
  }));
  const audioProvider = selected.providers.find(
    (p) => p.id === draft.transcription.providerId,
  );
  function changeProvider(id: string, patch: Partial<Provider>) {
    if (id === provider.id) setProvider((p) => ({ ...p, ...patch }));
    else
      setDraft((d) => ({
        ...d,
        providers: d.providers.map((p) =>
          p.id === id ? { ...p, ...patch } : p,
        ),
      }));
  }
  const progressFor = (id: string) =>
    downloads[id] || liveSnapshot.activeDownloads?.[id];
  const currentAsset = plan.assets.find((asset) => asset.id === activeId);
  const currentProgress = progressFor(activeId);
  const currentStage =
    currentProgress?.state === "extracting"
      ? "Extracting"
      : currentProgress?.state === "verifying"
        ? "Verifying"
        : currentProgress?.state === "downloading"
          ? "Downloading"
          : currentProgress?.state === "queued"
            ? "Queued"
            : currentProgress?.state === "cancelled"
              ? "Pausing"
              : currentProgress?.state === "complete"
                ? "Confirming installation of"
                : "Starting";
  const totalBytes = plan.assets.reduce(
    (total, asset) => total + asset.sizeBytes,
    0,
  );
  const completedBytes = plan.assets.reduce(
    (total, asset) =>
      total +
      (asset.installed
        ? asset.sizeBytes
        : Math.min(
            asset.sizeBytes,
            Math.max(0, progressFor(asset.id)?.completed || 0),
          )),
    0,
  );
  const dialog = useRef<HTMLDivElement>(null);
  useDialogFocus(dialog, { restoreFocus: false, focusOnMount: false });
  useEffect(() => {
    const root = dialog.current;
    if (!root) return;
    const selector =
      "button:not(:disabled), input:not(:disabled), select:not(:disabled)";
    root
      .querySelector<HTMLElement>(
        ".setup-body " + selector.split(",").join(", .setup-body "),
      )
      ?.focus();
  }, [step]);
  function chooseRoute(r: typeof route) {
    if (r === route) return;
    setRoute(r);
    const nextProvider = r === "managed" ? provider : newProvider(r);
    if (r !== "managed") {
      setProvider(nextProvider);
      setKey("");
    }
    setDraft((d) => ({
      ...d,
      cleanup: {
        ...d.cleanup,
        mode: r === "managed" ? "managed" : "provider",
        providerId: r === "managed" ? "" : nextProvider.id,
      },
    }));
  }
  async function latest() {
    const current = await getSnapshot();
    setLiveSnapshot(current);
    return current;
  }
  async function awaitExisting(id: string) {
    let absentChecks = 0;
    while (true) {
      const current = await latest();
      if (current.models.some((m) => m.id === id && m.installed)) return;
      const p = current.activeDownloads?.[id] || progressRef.current[id];
      if (pauseRequested.current || p?.state === "cancelled")
        throw new Error("Setup paused. Partial downloads are kept for resume.");
      if (p?.state === "error")
        throw new Error(p.error || "The component could not be installed.");
      if (current.activeDownloads && !current.activeDownloads[id]) {
        // Marker files and the active-job map are read separately. A job can
        // finish between those reads, so confirm with fresh snapshots first.
        absentChecks += 1;
        if (absentChecks >= 3)
          throw new Error(
            "The component stopped before installation was confirmed. Retry setup to resume.",
          );
      } else absentChecks = 0;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  async function finish() {
    if (running.current) return;
    const settings = selectedSettings();
    const cleanupProvider = settings.providers.find(
      (p) => p.id === settings.cleanup.providerId,
    );
    const speechProvider = settings.providers.find(
      (p) => p.id === settings.transcription.providerId,
    );
    if (
      settings.cleanup.mode === "provider" &&
      (!cleanupProvider?.baseUrl.trim() || !cleanupProvider.model.trim())
    ) {
      setSetupError("Select a text provider with its URL and text model ID.");
      setStep(2);
      return;
    }
    if (
      settings.transcription.mode === "openai" &&
      (!speechProvider?.baseUrl.trim() ||
        speechProvider.protocol !== "openai" ||
        !speechProvider.sttModel.trim())
    ) {
      setSetupError(
        "Select an OpenAI-compatible audio provider with its URL and speech model ID.",
      );
      setStep(1);
      return;
    }
    if (
      !desktop &&
      getSetupPlan(settings, liveSnapshot.hardware, liveSnapshot.models)
        .requiredIds.length
    ) {
      setSetupError(
        "Browser preview cannot install or verify local components. Complete this setup in the Windows desktop app.",
      );
      return;
    }
    running.current = true;
    pauseRequested.current = false;
    setSetupError("");
    setBusy(true);
    setPhase("checking");
    try {
      let current = await latest();
      const required = getSetupPlan(settings, current.hardware, current.models);
      if (required.configurationErrors.length)
        throw new Error(required.configurationErrors.join(" "));
      if (required.unknownIds.length)
        throw new Error(
          "A selected local component is missing from the bundled catalog. Restore the complete Windows app before finishing setup.",
        );
      for (const id of required.requiredIds) {
        if (pauseRequested.current)
          throw new Error(
            "Setup paused. Partial downloads are kept for resume.",
          );
        current = await latest();
        if (current.models.some((m) => m.id === id && m.installed)) continue;
        activeRef.current = id;
        setActiveId(id);
        setPhase("installing");
        if (current.activeDownloads?.[id]) await awaitExisting(id);
        else {
          try {
            await command("download_model", { id });
          } catch (error) {
            if (
              String(error)
                .replace(/^Error: /, "")
                .trim() !== "This model is already downloading."
            )
              throw error;
            // Another window may have started this job after latest().
            await awaitExisting(id);
          }
        }
        current = await latest();
        if (!current.models.some((m) => m.id === id && m.installed))
          throw new Error(
            "Installation did not finish verification. Retry setup before continuing.",
          );
      }
      if (pauseRequested.current)
        throw new Error(
          "Setup paused. Installed components and partial downloads are kept for resume.",
        );
      setPhase("checking");
      current = await latest();
      if (!getSetupPlan(settings, current.hardware, current.models).ready)
        throw new Error(
          "Some required local components are still missing. Retry setup to install them.",
        );
      setPhase("saving");
      await onFinish(
        settings,
        key.trim() && settings.providers.some((p) => p.id === provider.id)
          ? { id: provider.id, value: key.trim() }
          : undefined,
      );
      notify("Setup complete. Your selected components are ready.");
    } catch (e) {
      const message = String(e).replace(/^Error: /, "");
      const paused =
        pauseRequested.current ||
        progressRef.current[activeRef.current]?.state === "cancelled" ||
        message.startsWith("Setup paused") ||
        message.startsWith("Download paused");
      setSetupError(message);
      setPhase(paused ? "paused" : "error");
      if (!paused) notify(message, true);
    } finally {
      running.current = false;
      activeRef.current = "";
      setActiveId("");
      setBusy(false);
    }
  }
  async function pause() {
    pauseRequested.current = true;
    if (activeRef.current) {
      try {
        await command("cancel_download", { id: activeRef.current });
      } catch (e) {
        setSetupError(String(e));
        notify(String(e), true);
      }
    }
  }
  return (
    <div className="setup-backdrop">
      <div
        ref={dialog}
        className="setup"
        role="dialog"
        aria-modal="true"
        aria-label="Set up CridVoice"
      >
        <div className="setup-brand">
          <BrandMark />
          <strong>CridVoice</strong>
          <span className="setup-label">
            {repair ? "Setup repair" : "Setup"}
          </span>
          {repair && onClose && (
            <button
              className="icon-button"
              aria-label="Close setup repair"
              disabled={busy}
              onClick={onClose}
            >
              <X size={18} />
            </button>
          )}
        </div>
        <div className="setup-steps">
          {[
            "AI processing",
            "Speech recognition",
            "Preferences",
            "Install components",
          ].map((label, i) => (
            <span className={i <= step ? "active" : ""} key={label}>
              <i>{i < step ? <Check size={12} /> : i + 1}</i>
              {label}
            </span>
          ))}
        </div>
        <div className="setup-body">
          {setupError && (
            <div className="setup-error" role="alert">
              {setupError}
            </div>
          )}
          {step === 0 ? (
            <>
              <h1>AI processing</h1>
              <p className="setup-lead">
                Choose a local model, local server, or cloud provider for text
                cleanup. Speech recognition is configured next.
              </p>
              <div className="setup-routes">
                {(
                  [
                    {
                      id: "managed",
                      title: "Managed local AI",
                      description:
                        "Download and run models on this computer using its GPU or CPU.",
                      icon: <Cpu />,
                    },
                    {
                      id: "external",
                      title: "Local server",
                      description:
                        "Connect to LM Studio, llama.cpp, or another local server.",
                      icon: <Server />,
                    },
                    {
                      id: "cloud",
                      title: "Connect a provider",
                      description:
                        "Use an OpenAI-compatible or Anthropic-compatible cloud API.",
                      icon: <Cloud />,
                    },
                  ] as const
                ).map((r) => (
                  <button
                    key={r.id}
                    className={`setup-route ${route === r.id ? "selected" : ""}`}
                    onClick={() => chooseRoute(r.id)}
                  >
                    {r.icon}
                    <strong>{r.title}</strong>
                    <p>{r.description}</p>
                    {route === r.id && (
                      <span className="route-check">
                        <Check size={13} />
                      </span>
                    )}
                  </button>
                ))}
              </div>
              {route !== "managed" && (
                <div className="form-grid compact">
                  <Field label="Provider name">
                    <input
                      value={provider.name}
                      onChange={(e) =>
                        setProvider({ ...provider, name: e.target.value })
                      }
                    />
                  </Field>
                  <Field label="API format">
                    <Select
                      label="Setup API format"
                      value={provider.protocol}
                      onChange={(v) =>
                        setProvider({
                          ...provider,
                          protocol: v as Provider["protocol"],
                        })
                      }
                      options={[
                        { value: "openai", label: "OpenAI compatible" },
                        { value: "anthropic", label: "Anthropic compatible" },
                      ]}
                    />
                  </Field>
                  <Field label="Base URL">
                    <input
                      value={provider.baseUrl}
                      onChange={(e) =>
                        setProvider({ ...provider, baseUrl: e.target.value })
                      }
                    />
                  </Field>
                  <Field
                    label="API key · optional for local servers"
                    hint={
                      provider.hasKey
                        ? "A key is saved. Leave blank to keep it."
                        : undefined
                    }
                  >
                    <input
                      type="password"
                      autoComplete="new-password"
                      value={key}
                      onChange={(e) => setKey(e.target.value)}
                    />
                  </Field>
                  <ProviderModelPicker
                    provider={provider}
                    apiKey={key}
                    useSavedKey={
                      !key.trim() &&
                      snapshot.settings.providers.some(
                        (saved) =>
                          saved.hasKey &&
                          saved.id === provider.id &&
                          saved.protocol === provider.protocol &&
                          saved.baseUrl === provider.baseUrl,
                      )
                    }
                    disabled={busy}
                    fetchModels={(request) =>
                      command<string[]>("discover_provider_models", {
                        ...request,
                      })
                    }
                    fields={[
                      {
                        id: "text",
                        label: "Text model ID",
                        value: provider.model,
                        onChange: (model) =>
                          setProvider((current) => ({ ...current, model })),
                      },
                    ]}
                  />
                </div>
              )}
            </>
          ) : step === 1 ? (
            <>
              <h1>Speech recognition</h1>
              <p className="setup-lead">
                Choose a language and where your audio is transcribed. Automatic
                detection supports English and Polish.
              </p>
              <div className="form-grid">
                <Field label="Language">
                  <Select
                    label="Setup language"
                    value={draft.transcription.language}
                    onChange={(v) =>
                      setDraft({
                        ...draft,
                        transcription: {
                          ...draft.transcription,
                          language: v as Settings["transcription"]["language"],
                        },
                      })
                    }
                    options={languages}
                  />
                </Field>
                <Field label="Speech engine">
                  <Select
                    label="Setup speech engine"
                    value={draft.transcription.mode}
                    onChange={(v) =>
                      setDraft({
                        ...draft,
                        transcription: {
                          ...draft.transcription,
                          mode: v as "local" | "openai",
                          providerId:
                            v === "openai"
                              ? draft.transcription.providerId ||
                                selected.providers.find(
                                  (p) => p.protocol === "openai",
                                )?.id ||
                                (provider.protocol === "openai"
                                  ? provider.id
                                  : "")
                              : draft.transcription.providerId,
                        },
                      })
                    }
                    options={[
                      { value: "local", label: "Local · private GPU / CPU" },
                      ...(provider.protocol === "openai" ||
                      selected.providers.some((p) => p.protocol === "openai") ||
                      draft.transcription.mode === "openai"
                        ? [
                            {
                              value: "openai",
                              label: "Selected provider · cloud audio",
                            },
                          ]
                        : []),
                    ]}
                  />
                </Field>
                {draft.transcription.mode === "local" ? (
                  <>
                    <Field label="Speech device">
                      <Select
                        label="Setup speech device"
                        value={draft.transcription.device}
                        onChange={(v) =>
                          setDraft({
                            ...draft,
                            transcription: {
                              ...draft.transcription,
                              device: v as Settings["transcription"]["device"],
                            },
                          })
                        }
                        options={devices}
                      />
                    </Field>
                    <Field label="Speech model">
                      <Select
                        label="Setup speech model"
                        value={draft.transcription.modelId}
                        onChange={(v) =>
                          setDraft({
                            ...draft,
                            transcription: {
                              ...draft.transcription,
                              modelId: v,
                            },
                          })
                        }
                        options={[
                          {
                            value: "whisper-turbo",
                            label: "Whisper Large v3 Turbo · quality",
                          },
                          {
                            value: "whisper-small",
                            label: "Whisper Small · CPU-friendly",
                          },
                        ]}
                      />
                    </Field>
                  </>
                ) : (
                  <>
                    <Field label="Speech provider">
                      <Select
                        label="Setup speech provider"
                        value={draft.transcription.providerId}
                        onChange={(v) =>
                          setDraft({
                            ...draft,
                            transcription: {
                              ...draft.transcription,
                              providerId: v,
                            },
                          })
                        }
                        options={[
                          { value: "", label: "Select an audio provider" },
                          ...providerOptions.filter(
                            (p) =>
                              selected.providers.find(
                                (item) => item.id === p.value,
                              )?.protocol === "openai",
                          ),
                        ]}
                      />
                    </Field>
                    {audioProvider && (
                      <ProviderModelPicker
                        provider={audioProvider}
                        apiKey={
                          audioProvider.id === provider.id ? key : undefined
                        }
                        useSavedKey={
                          !(audioProvider.id === provider.id && key.trim()) &&
                          snapshot.settings.providers.some(
                            (saved) =>
                              saved.hasKey &&
                              saved.id === audioProvider.id &&
                              saved.protocol === audioProvider.protocol &&
                              saved.baseUrl === audioProvider.baseUrl,
                          )
                        }
                        disabled={busy}
                        fetchModels={(request) =>
                          command<string[]>("discover_provider_models", {
                            ...request,
                          })
                        }
                        fields={[
                          {
                            id: "speech",
                            label: "Audio model ID",
                            value: audioProvider.sttModel,
                            onChange: (sttModel) =>
                              changeProvider(draft.transcription.providerId, {
                                sttModel,
                              }),
                          },
                        ]}
                      />
                    )}
                  </>
                )}
              </div>
              <div className="notice">
                <Mic size={20} />
                <p>
                  Your microphone is controlled by Windows. You can select a
                  different input device in Settings after setup.
                </p>
              </div>
              {snapshot.hardware.cudaAvailable && (
                <div className="hardware-note">
                  <Check size={15} />
                  {snapshot.hardware.gpus[0]?.name} detected. GPU speech also
                  needs the selected model and NVIDIA runtime.
                </div>
              )}
            </>
          ) : step === 2 ? (
            <>
              <h1>Preferences</h1>
              <p className="setup-lead">
                Configure text cleanup, writing style, and recording options.
              </p>
              <div className="form-grid">
                <Field label="Cleanup engine">
                  <Select
                    label="Setup cleanup engine"
                    value={draft.cleanup.mode}
                    onChange={(v) =>
                      setDraft({
                        ...draft,
                        cleanup: {
                          ...draft.cleanup,
                          mode: v as Settings["cleanup"]["mode"],
                          outputMode:
                            v === "off" ? "text" : draft.cleanup.outputMode,
                          providerId:
                            v === "provider"
                              ? draft.cleanup.providerId || provider.id
                              : draft.cleanup.providerId,
                        },
                      })
                    }
                    options={[
                      { value: "managed", label: "Local · app-managed" },
                      { value: "provider", label: "Selected provider" },
                      { value: "off", label: "Off · raw transcript" },
                    ]}
                  />
                </Field>
                {draft.cleanup.mode === "managed" ? (
                  <Field label="Cleanup device">
                    <Select
                      label="Setup cleanup device"
                      value={draft.cleanup.device}
                      onChange={(v) =>
                        setDraft({
                          ...draft,
                          cleanup: {
                            ...draft.cleanup,
                            device: v as Settings["cleanup"]["device"],
                          },
                        })
                      }
                      options={cleanupDevices}
                    />
                  </Field>
                ) : (
                  draft.cleanup.mode === "provider" && (
                    <Field label="Text provider">
                      <Select
                        label="Setup cleanup provider"
                        value={draft.cleanup.providerId}
                        onChange={(v) =>
                          setDraft({
                            ...draft,
                            cleanup: { ...draft.cleanup, providerId: v },
                          })
                        }
                        options={[
                          { value: "", label: "Select a text provider" },
                          ...providerOptions,
                        ]}
                      />
                    </Field>
                  )
                )}
              </div>
              <Field label="Default writing style">
                <Select
                  label="Setup writing style"
                  value={draft.cleanup.style}
                  onChange={(v) =>
                    setDraft({
                      ...draft,
                      cleanup: { ...draft.cleanup, style: v },
                    })
                  }
                  options={writingStyles}
                />
              </Field>
              <div className="setup-preferences">
                <Toggle
                  label="Use application context"
                  description="Selected and nearby text improve cleanup. Password fields are excluded."
                  checked={draft.general.context}
                  onChange={(v) =>
                    setDraft({
                      ...draft,
                      general: { ...draft.general, context: v },
                    })
                  }
                />
                <Toggle
                  label="Save transcript text automatically"
                  description="Text stays on this device. Audio is discarded after processing."
                  checked={draft.general.saveHistory}
                  onChange={(v) =>
                    setDraft({
                      ...draft,
                      general: { ...draft.general, saveHistory: v },
                    })
                  }
                />
                <Toggle
                  label="Show live transcript preview"
                  checked={draft.appearance.livePreview}
                  onChange={(v) =>
                    setDraft({
                      ...draft,
                      appearance: { ...draft.appearance, livePreview: v },
                    })
                  }
                />
                <Toggle
                  label="Launch at Windows startup"
                  checked={draft.general.startup}
                  onChange={(v) =>
                    setDraft({
                      ...draft,
                      general: { ...draft.general, startup: v },
                    })
                  }
                />
              </div>
            </>
          ) : (
            <>
              {!repair && !busy && phase === "idle" && (
                <p className="setup-final-intro">
                  After setup, hold <kbd>Ctrl</kbd> + <kbd>Windows</kbd> while
                  speaking. Release either key to process and insert. Escape
                  cancels.
                </p>
              )}
              <section
                className="setup-installation"
                aria-label="Required local components"
              >
                <h2>Install components</h2>
                <p className="setup-download-notice">
                  {plan.requiredIds.length === 0
                    ? "Your selected providers do not require local model downloads."
                    : !desktop
                      ? "Browser preview cannot install or verify local components. Open the Windows desktop app to complete setup."
                      : plan.missingIds.length
                        ? `${bytes(plan.downloadBytes)} of required downloads. Starting setup installs every missing component below, verifies it, and keeps this wizard open until all are ready. Installed components are reused.`
                        : "All required local components are installed. Finish setup to save your choices."}
                </p>
                {plan.requiredIds.length > 0 && (
                  <div
                    className="setup-overall-progress"
                    role="status"
                    aria-label="Overall setup status"
                  >
                    <div>
                      <span>
                        {plan.assets.filter((m) => m.installed).length} of{" "}
                        {plan.requiredIds.length} components ready
                      </span>
                      <span>
                        {bytes(completedBytes)} / {bytes(totalBytes)} ·{" "}
                        {Math.round(
                          (completedBytes / Math.max(totalBytes, 1)) * 100,
                        )}
                        % downloaded
                      </span>
                    </div>
                    <progress
                      aria-label="Overall setup progress"
                      max={Math.max(totalBytes, 1)}
                      value={completedBytes}
                    />
                    {busy && (
                      <small>
                        {phase === "saving"
                          ? "Finishing setup"
                          : phase === "checking"
                            ? "Checking installation"
                            : `${currentStage} ${currentAsset?.name || "required component"}${currentProgress?.stageTotal ? ` · ${Math.round(((currentProgress.stageCompleted || 0) / currentProgress.stageTotal) * 100)}%` : ""}. Download progress can reach 100% before verification and extraction finish.`}
                      </small>
                    )}
                  </div>
                )}
                {plan.assets.map((asset) => {
                  const p = progressFor(asset.id);
                  const state = asset.installed
                    ? "Installed"
                    : p?.state === "queued"
                      ? "Queued"
                      : p?.state === "verifying"
                        ? "Verifying"
                        : p?.state === "extracting"
                          ? "Extracting"
                          : p?.state === "downloading"
                            ? "Downloading"
                            : p?.state === "cancelled"
                              ? "Paused"
                              : p?.state === "error"
                                ? "Error"
                                : activeId === asset.id && busy
                                  ? "Starting"
                                  : "Waiting";
                  const stage =
                    p?.stageTotal &&
                    ["verifying", "extracting"].includes(p.state);
                  return (
                    <div
                      key={asset.id}
                      className="setup-component"
                      role="status"
                      aria-label={`${asset.name} setup status`}
                    >
                      <div className="setup-component-header">
                        <strong>{asset.name}</strong>
                        <Badge
                          tone={
                            asset.installed
                              ? "green"
                              : state === "Error"
                                ? "amber"
                                : "neutral"
                          }
                        >
                          {state}
                        </Badge>
                      </div>
                      <div className="setup-component-progress">
                        <small>
                          {asset.installed
                            ? "Already installed and reused"
                            : `${bytes(p?.completed || 0)} / ${bytes(asset.sizeBytes)}`}
                        </small>
                        {!asset.installed && (
                          <progress
                            aria-label={`${asset.name} download progress`}
                            max={Math.max(asset.sizeBytes, 1)}
                            value={Math.min(asset.sizeBytes, p?.completed || 0)}
                          />
                        )}
                        {stage && (
                          <>
                            <small>
                              {state} ·{" "}
                              {Math.round(
                                ((p.stageCompleted || 0) / p.stageTotal!) * 100,
                              )}
                              %
                            </small>
                            <progress
                              aria-label={`${asset.name} ${state.toLowerCase()} progress`}
                              max={p.stageTotal}
                              value={p.stageCompleted || 0}
                            />
                          </>
                        )}
                        {!asset.installed && p?.state === "error" && (
                          <small className="error-text">{p.error}</small>
                        )}
                      </div>
                    </div>
                  );
                })}
                {desktop && plan.unknownIds.length > 0 && (
                  <p className="error-text">
                    A selected component is missing from the bundled catalog.
                    Restore the complete app before finishing setup.
                  </p>
                )}
                {plan.configurationErrors.map((message) => (
                  <p className="error-text" key={message}>
                    {message}
                  </p>
                ))}
              </section>
            </>
          )}
        </div>
        <div className="setup-footer">
          <button
            className="button ghost"
            disabled={step === 0 || busy}
            onClick={() => setStep(step - 1)}
          >
            <ArrowLeft size={16} />
            Back
          </button>
          <span>{step + 1} of 4</span>
          <div className="setup-footer-actions">
            {busy && phase === "installing" && (
              <button className="button secondary" onClick={() => void pause()}>
                Pause setup
              </button>
            )}
            <button
              className="button primary"
              disabled={
                busy || (step === 3 && !desktop && plan.requiredIds.length > 0)
              }
              onClick={() => (step < 3 ? setStep(step + 1) : void finish())}
            >
              {busy ? (
                <Busy
                  label={
                    phase === "saving"
                      ? "Finishing setup"
                      : phase === "checking"
                        ? "Checking installation"
                        : "Installing required components"
                  }
                />
              ) : step === 3 ? (
                <>
                  {plan.missingIds.length ? (
                    <Download size={16} />
                  ) : (
                    <Check size={16} />
                  )}
                  {!desktop && plan.requiredIds.length
                    ? "Open desktop to complete setup"
                    : phase === "paused"
                      ? "Resume setup"
                      : phase === "error"
                        ? "Retry setup"
                        : plan.missingIds.length
                          ? "Install required components & finish"
                          : "Finish setup"}
                </>
              ) : (
                <>
                  Continue
                  <ArrowRight size={16} />
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
