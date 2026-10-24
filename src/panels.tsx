import { memo, useEffect, useMemo, useRef, useState } from "react";
import BackgroundAudioControl from "./BackgroundAudioControl";
import {
  Check,
  Cloud,
  Copy,
  Cpu,
  Download,
  ExternalLink,
  HardDrive,
  KeyRound,
  Monitor,
  Plus,
  Search,
  Server,
  ShieldCheck,
  Sparkles,
  Trash2,
} from "lucide-react";
import { command, warmSelectedModels } from "./bridge";
import { selectedLocalModels } from "./localModelStatus";
import {
  Badge,
  Busy,
  Empty,
  Field,
  Modal,
  Section,
  Select,
  Toggle,
  bytes,
  cleanupDevices,
  devices,
  languages,
  writingStyles,
} from "./ui";
import { resolveAppearance, themes } from "./themes";
import CodingControls from "./CodingControls";
import ApplicationStyleEditor from "./ApplicationStyleEditor";
import ProviderModelPicker from "./ProviderModelPicker";
import ShortcutRecorder, { shortcutProblem } from "./ShortcutRecorder";
import { writingExample } from "./writingExamples";
import type {
  Settings,
  Snapshot,
  DownloadProgress,
  Provider,
  EngineStatus,
  SettingsUpdate,
} from "./types";
export type PanelProps = {
  settings: Settings;
  snapshot: Snapshot;
  update: (s: SettingsUpdate) => Promise<void>;
  refresh: () => Promise<void>;
  notify: (message: string, error?: boolean) => void;
  controlsDisabled?: boolean;
  openSettings?: () => void;
  detectedLanguage?: string | null;
  detectionActive?: boolean;
};
export function Providers({ settings, update, refresh, notify }: PanelProps) {
  const [editing, setEditing] = useState<Provider | null>(null),
    [key, setKey] = useState(""),
    [busy, setBusy] = useState("");
  const editorVersion = useRef(0),
    saving = useRef(false);
  function openEditor(provider: Provider | null) {
    editorVersion.current += 1;
    setKey("");
    setEditing(provider);
  }
  function changeEditor(patch: Partial<Provider>) {
    editorVersion.current += 1;
    setEditing((current) => (current ? { ...current, ...patch } : current));
  }
  const presets = [
    {
      name: "LM Studio",
      protocol: "openai" as const,
      baseUrl: "http://127.0.0.1:1234/v1",
      model: "",
      sttModel: "",
    },
    {
      name: "llama.cpp",
      protocol: "openai" as const,
      baseUrl: "http://127.0.0.1:8080/v1",
      model: "",
      sttModel: "",
    },
    {
      name: "OpenAI",
      protocol: "openai" as const,
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-4.1-mini",
      sttModel: "gpt-4o-mini-transcribe",
    },
    {
      name: "Anthropic",
      protocol: "anthropic" as const,
      baseUrl: "https://api.anthropic.com/v1",
      model: "",
      sttModel: "",
    },
  ];
  const add = (p: (typeof presets)[number]) => {
    openEditor({ ...p, id: crypto.randomUUID(), hasKey: false });
  };
  async function save() {
    if (!editing || saving.current) return;
    if (!editing.name.trim() || !editing.baseUrl.trim()) {
      notify("Enter a name and provider URL.", true);
      return;
    }
    const savedProvider = editing,
      savedKey = key.trim(),
      version = editorVersion.current;
    saving.current = true;
    try {
      setBusy("save");
      await update((current) => ({
        providers: [
          ...current.providers.filter((p) => p.id !== savedProvider.id),
          savedProvider,
        ],
      }));
      if (savedKey) {
        await command("set_provider_key", {
          id: savedProvider.id,
          key: savedKey,
        });
        await refresh();
      }
      if (editorVersion.current === version) openEditor(null);
      notify("Provider saved. Choose it in Settings to use it.");
    } catch (e) {
      notify(String(e), true);
    } finally {
      saving.current = false;
      setBusy("");
    }
  }
  async function test(id: string) {
    try {
      setBusy(id);
      await command("test_provider", { id });
      notify("Connected successfully.");
    } catch (e) {
      notify(String(e), true);
    } finally {
      setBusy("");
    }
  }
  async function remove(p: Provider) {
    try {
      if (p.hasKey) await command("set_provider_key", { id: p.id, key: "" });
      await update((current) => ({
        providers: current.providers.filter((x) => x.id !== p.id),
        cleanup: {
          ...current.cleanup,
          providerId:
            current.cleanup.providerId === p.id
              ? ""
              : current.cleanup.providerId,
        },
        transcription: {
          ...current.transcription,
          providerId:
            current.transcription.providerId === p.id
              ? ""
              : current.transcription.providerId,
        },
      }));
      notify("Provider removed.");
    } catch (e) {
      notify(String(e), true);
    }
  }
  return (
    <>
      <div className="page-intro">
        <h2>Provider connections</h2>
        <p>
          Connect local servers or cloud APIs for speech recognition and text
          cleanup.
        </p>
      </div>
      <div className="provider-presets">
        {presets.map((p) => (
          <button
            key={p.name}
            className="provider-preset"
            onClick={() => add(p)}
          >
            {p.name === "LM Studio" ? (
              <Monitor />
            ) : p.name === "llama.cpp" ? (
              <Server />
            ) : (
              <Cloud />
            )}
            <strong>{p.name}</strong>
            <span>
              {p.baseUrl.startsWith("http:")
                ? "Local connection"
                : "Cloud connection"}
            </span>
            <Plus size={17} />
          </button>
        ))}
      </div>
      <Section
        title="Connected providers"
        description="Speech and text cleanup can use different providers."
        action={
          <button
            className="button secondary"
            onClick={() =>
              add({
                name: "Custom provider",
                protocol: "openai",
                baseUrl: "https://",
                model: "",
                sttModel: "",
              })
            }
          >
            <Plus size={15} />
            Custom endpoint
          </button>
        }
      >
        {settings.providers.length ? (
          settings.providers.map((p) => (
            <div className="list-row" key={p.id}>
              <div className="square-icon">
                <Server size={20} />
              </div>
              <div className="row-info">
                <strong>{p.name}</strong>
                <small>{p.baseUrl}</small>
                <span className="row-meta">
                  {p.protocol === "openai"
                    ? "OpenAI compatible"
                    : "Anthropic compatible"}{" "}
                  · {p.model || "No text model set"}
                </span>
              </div>
              {p.hasKey && <KeyRound size={15} />}
              <button
                className="button secondary small"
                disabled={!!busy}
                onClick={() => test(p.id)}
              >
                {busy === p.id ? <Busy label="Testing" /> : "Test"}
              </button>
              <button
                className="button ghost small"
                onClick={() => openEditor(p)}
              >
                Edit
              </button>
              <button
                className="icon-button"
                aria-label={`Remove ${p.name}`}
                onClick={() => remove(p)}
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))
        ) : (
          <Empty
            icon={<Server />}
            title="No providers configured"
            description="Connect LM Studio, llama.cpp, or any supported API endpoint. Nothing is sent to a cloud provider unless you select it."
          />
        )}
      </Section>
      <div className="notice">
        <ShieldCheck size={18} />
        <p>
          API keys are DPAPI-encrypted and kept in Windows Credential Manager.
          Anthropic-compatible providers handle text cleanup; speech requires an
          audio transcription endpoint.
        </p>
      </div>
      {editing && (
        <Modal
          title={
            settings.providers.some((p) => p.id === editing.id)
              ? "Edit provider"
              : "Connect a provider"
          }
          onClose={() => openEditor(null)}
        >
          <div className="form-grid">
            <Field label="Name">
              <input
                autoFocus
                value={editing.name}
                onChange={(e) => changeEditor({ name: e.target.value })}
              />
            </Field>
            <Field label="API format">
              <Select
                label="API format"
                value={editing.protocol}
                onChange={(v) =>
                  changeEditor({
                    protocol: v as Provider["protocol"],
                  })
                }
                options={[
                  { value: "openai", label: "OpenAI compatible" },
                  { value: "anthropic", label: "Anthropic compatible" },
                ]}
              />
            </Field>
            <Field
              label="Base URL"
              hint="Include your API prefix, such as /v1. Remote endpoints require HTTPS."
            >
              <input
                value={editing.baseUrl}
                onChange={(e) => changeEditor({ baseUrl: e.target.value })}
              />
            </Field>
            <Field
              label="API key"
              hint={
                editing.hasKey
                  ? "A key is saved. Leave blank to keep it."
                  : "Local servers often do not need a key."
              }
            >
              <input
                type="password"
                autoComplete="new-password"
                value={key}
                placeholder={
                  editing.hasKey
                    ? "•••••••• (saved)"
                    : "Optional for local providers"
                }
                onChange={(e) => {
                  editorVersion.current += 1;
                  setKey(e.target.value);
                }}
              />
            </Field>
            <ProviderModelPicker
              provider={editing}
              apiKey={key}
              useSavedKey={
                !key.trim() &&
                settings.providers.some(
                  (saved) =>
                    saved.hasKey &&
                    saved.id === editing.id &&
                    saved.protocol === editing.protocol &&
                    saved.baseUrl === editing.baseUrl,
                )
              }
              disabled={!!busy}
              fetchModels={(request) =>
                command<string[]>("discover_provider_models", { ...request })
              }
              fields={[
                {
                  id: "text",
                  label: "Text model ID",
                  value: editing.model,
                  onChange: (model) => changeEditor({ model }),
                },
                ...(editing.protocol === "openai"
                  ? [
                      {
                        id: "speech",
                        label: "Speech model ID",
                        value: editing.sttModel,
                        onChange: (sttModel: string) =>
                          changeEditor({ sttModel }),
                      },
                    ]
                  : []),
              ]}
            />
          </div>
          <div className="modal-footer">
            <button
              className="button secondary"
              onClick={() => openEditor(null)}
            >
              Cancel
            </button>
            <button className="button primary" disabled={!!busy} onClick={save}>
              {busy === "save" ? <Busy label="Saving" /> : "Save connection"}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
export function Models({
  settings,
  snapshot,
  update,
  refresh,
  notify,
  downloads,
  controlsDisabled,
}: { downloads: Record<string, DownloadProgress> } & PanelProps) {
  const [removing, setRemoving] = useState("");
  const [memoryAction, setMemoryAction] = useState("");
  const pendingMemoryAction = useRef(false);
  const selected = selectedLocalModels(
    settings,
    snapshot.hardware,
    snapshot.models,
    snapshot.engineStatus,
  );
  const warming = selected.some((model) => model.state === "loading");
  const loadFailed = selected.some((model) => model.state === "error");
  const canLoad = selected.some(
    (model) => model.loadable && model.state !== "loaded",
  );
  async function changeMemory(load: boolean) {
    if (
      pendingMemoryAction.current ||
      controlsDisabled ||
      (load && (!canLoad || warming))
    )
      return;
    pendingMemoryAction.current = true;
    setMemoryAction(load ? "load" : "unload");
    try {
      if (load) await warmSelectedModels();
      else await command("unload_models");
      await refresh();
      notify(
        load
          ? "Selected local models are preparing. Live status shows when they are loaded."
          : "Local models unloaded. Your next dictation or manual load will load them again.",
      );
    } catch (error) {
      notify(String(error), true);
    } finally {
      pendingMemoryAction.current = false;
      setMemoryAction("");
    }
  }
  const memoryLabel = (status?: EngineStatus) =>
    status
      ? {
          unloaded: "Unloaded",
          loading: "Loading",
          loaded: "Loaded",
          error: "Error",
        }[status.state]
      : "Status unavailable";
  const memoryTone = (status?: EngineStatus) =>
    status?.state === "loaded"
      ? "green"
      : status?.state === "loading" || status?.state === "error"
        ? "amber"
        : "neutral";
  function memoryDescription(
    kind: "speech" | "preview" | "cleanup",
    status?: EngineStatus,
  ) {
    if (!status) return "Live status is available in the Windows desktop app.";
    if (status.state === "unloaded") return "No local model in memory.";
    const model = snapshot.models.find((m) => m.id === status.modelId);
    const device =
      status.device === "cpu"
        ? "CPU"
        : ["cuda", "gpu", "vulkan"].includes(status.device || "")
          ? kind === "speech"
            ? "CUDA GPU"
            : "Vulkan GPU"
          : status.device;
    return [model?.name || status.modelId, device].filter(Boolean).join(" · ");
  }
  async function download(id: string) {
    try {
      await command("download_model", { id });
      await refresh();
      notify("Download complete. The model is ready to use.");
    } catch (e) {
      notify(String(e), true);
    }
  }
  async function remove(id: string) {
    try {
      setRemoving(id);
      await command("remove_model", { id });
      await refresh();
      notify("Model files removed.");
    } catch (e) {
      notify(String(e), true);
    } finally {
      setRemoving("");
    }
  }
  return (
    <>
      <div className="hardware-strip">
        <div className="square-icon">
          <Cpu size={22} />
        </div>
        <div>
          <strong>{snapshot.hardware.gpus[0]?.name || "CPU inference"}</strong>
          <span>
            {snapshot.hardware.gpus[0]
              ? `${Math.round(snapshot.hardware.gpus[0].vramMb / 1024)} GB VRAM · `
              : ""}
            {snapshot.hardware.ramGb
              ? `${Math.round(snapshot.hardware.ramGb)} GB RAM · `
              : ""}
            {snapshot.hardware.cpu}
          </span>
        </div>
        <Badge tone={snapshot.hardware.cudaAvailable ? "green" : "neutral"}>
          {snapshot.hardware.cudaAvailable
            ? "NVIDIA detected"
            : "Intel / AMD supported"}
        </Badge>
      </div>
      <Section
        title="Models in memory"
        description="Live status of local inference. Installed model files stay on disk when unloaded."
      >
        {(["speech", "preview", "cleanup"] as const).map((kind) => {
          const status = snapshot.engineStatus?.[kind];
          return (
            <div
              className="list-row"
              role="status"
              aria-label={`${kind === "speech" ? "Speech" : kind === "preview" ? "Preview" : "Cleanup"} model memory status`}
              key={kind}
            >
              <div className="square-icon">
                {kind !== "cleanup" ? (
                  <Monitor size={20} />
                ) : (
                  <Sparkles size={20} />
                )}
              </div>
              <div className="row-info">
                <strong>
                  {kind === "speech"
                    ? "Speech recognition"
                    : kind === "preview"
                      ? "Live preview"
                      : "Text cleanup"}
                </strong>
                <small>{memoryDescription(kind, status)}</small>
              </div>
              <Badge tone={memoryTone(status)}>{memoryLabel(status)}</Badge>
            </div>
          );
        })}
        <div className="model-actions">
          <button
            className="button secondary"
            disabled={
              !!controlsDisabled || !!memoryAction || warming || !canLoad
            }
            onClick={() => void changeMemory(true)}
          >
            {memoryAction === "load"
              ? "Requesting model loading"
              : warming
                ? "Warming selected models"
                : loadFailed
                  ? "Retry model loading"
                  : "Load selected models"}
          </button>
          <button
            className="button secondary"
            disabled={!!controlsDisabled || !!memoryAction}
            onClick={() => void changeMemory(false)}
          >
            {memoryAction === "unload"
              ? "Unloading models"
              : "Unload models from memory"}
          </button>
        </div>
      </Section>
      {(["speech", "preview", "cleanup", "runtime"] as const).map((kind) => (
        <Section
          key={kind}
          title={
            kind === "speech"
              ? "Speech recognition"
              : kind === "preview"
                ? "Live preview"
                : kind === "cleanup"
                  ? "Text cleanup"
                  : "Inference runtimes"
          }
          description={
            kind === "speech"
              ? "Multilingual models for English and Polish."
              : kind === "preview"
                ? "A small CPU model for provisional words. Final recognition uses your selected speech model."
                : kind === "cleanup"
                  ? "Local models for corrections, formatting, and rewriting."
                  : "Download only the engines your selected hardware needs."
          }
        >
          {snapshot.models
            .filter((m) => m.kind === kind)
            .map((m) => {
              const p = downloads[m.id],
                active =
                  p &&
                  ["queued", "downloading", "verifying", "extracting"].includes(
                    p.state,
                  ),
                selected =
                  kind === "speech"
                    ? settings.transcription.modelId === m.id
                    : kind === "preview"
                      ? settings.transcription.mode === "local" &&
                        settings.appearance.livePreview
                      : settings.cleanup.modelId === m.id,
                memory =
                  kind === "runtime"
                    ? undefined
                    : snapshot.engineStatus?.[kind];
              return (
                <div className="model-card" key={m.id}>
                  <div className="model-top">
                    <div className="square-icon">
                      {kind === "speech" || kind === "preview" ? (
                        <Monitor size={21} />
                      ) : kind === "cleanup" ? (
                        <Sparkles size={21} />
                      ) : (
                        <Cpu size={21} />
                      )}
                    </div>
                    <div className="row-info">
                      <strong>
                        {m.name}
                        {selected && kind !== "runtime" && (
                          <Badge tone="violet">Selected</Badge>
                        )}
                        {memory?.modelId === m.id &&
                          memory.state !== "unloaded" && (
                            <Badge tone={memoryTone(memory)}>
                              {memoryLabel(memory)}
                            </Badge>
                          )}
                      </strong>
                      <p>{m.description}</p>
                      <small>
                        {bytes(m.sizeBytes)} download · {m.license}
                      </small>
                    </div>
                    {m.installed ? (
                      <Badge tone="green">Installed</Badge>
                    ) : (
                      <Badge>Not installed</Badge>
                    )}
                  </div>
                  {active && (
                    <div className="download-progress">
                      <div>
                        <span>
                          {p.state === "verifying"
                            ? "Verifying files…"
                            : p.state === "extracting"
                              ? "Extracting runtime…"
                              : p.state === "queued"
                                ? "Waiting to download…"
                                : `${bytes(p.completed)} / ${bytes(p.total)}`}
                        </span>
                        <span>
                          {Math.round(
                            ((p.stageCompleted ?? p.completed) /
                              Math.max(p.stageTotal ?? p.total, 1)) *
                              100,
                          )}
                          %
                        </span>
                      </div>
                      <progress
                        max={p.stageTotal ?? p.total}
                        value={p.stageCompleted ?? p.completed}
                      />
                    </div>
                  )}
                  <div className="model-actions">
                    {(kind === "speech" || kind === "cleanup") && (
                      <button
                        className="button secondary small"
                        disabled={!m.installed || selected}
                        onClick={() =>
                          update(
                            kind === "speech"
                              ? {
                                  transcription: {
                                    ...settings.transcription,
                                    modelId: m.id,
                                  },
                                }
                              : {
                                  cleanup: {
                                    ...settings.cleanup,
                                    modelId: m.id,
                                  },
                                },
                          )
                        }
                      >
                        {selected ? (
                          <>
                            <Check size={14} />
                            Selected
                          </>
                        ) : (
                          "Use this model"
                        )}
                      </button>
                    )}
                    {active ? (
                      <button
                        className="button secondary small"
                        onClick={() =>
                          command("cancel_download", { id: m.id }).catch((e) =>
                            notify(String(e), true),
                          )
                        }
                      >
                        Pause download
                      </button>
                    ) : m.installed ? (
                      <button
                        className="button ghost small"
                        disabled={!!removing}
                        onClick={() => remove(m.id)}
                      >
                        {removing === m.id ? (
                          <Busy label="Removing" />
                        ) : (
                          <>
                            <Trash2 size={14} />
                            Remove
                          </>
                        )}
                      </button>
                    ) : (
                      <button
                        className="button primary small"
                        onClick={() => download(m.id)}
                      >
                        <Download size={15} />
                        {p?.state === "cancelled"
                          ? "Resume download"
                          : "Download"}
                      </button>
                    )}
                  </div>
                  {p?.state === "error" && (
                    <p className="error-text">{p.error}</p>
                  )}
                </div>
              );
            })}
          {!snapshot.models.length && (
            <Empty
              icon={<HardDrive />}
              title="Model catalog available in the desktop app"
              description="The Windows build includes verified model and runtime downloads."
            />
          )}
        </Section>
      ))}
      <div className="notice">
        <ShieldCheck size={18} />
        <p>
          Downloads are pinned and verified with SHA-256. Once installed, models
          run offline. Runtimes need additional space when extracted.
        </p>
      </div>
    </>
  );
}
export function VocabularyPanel({ settings, update, notify }: PanelProps) {
  const [word, setWord] = useState(""),
    [aliases, setAliases] = useState(""),
    [search, setSearch] = useState(""),
    [saving, setSaving] = useState(false);
  const pending = useRef(false),
    draftVersion = useRef(0);
  const query = search.toLowerCase();
  async function add() {
    if (!word.trim() || pending.current) return;
    const entry = {
        word: word.trim(),
        aliases: aliases
          .split(",")
          .map((a) => a.trim())
          .filter(Boolean),
      },
      version = draftVersion.current;
    pending.current = true;
    setSaving(true);
    try {
      await update((current) => {
        if (
          current.vocabulary.some(
            (v) =>
              v.word.toLocaleLowerCase() === entry.word.toLocaleLowerCase(),
          )
        )
          throw new Error("This word is already in your vocabulary.");
        return { vocabulary: [...current.vocabulary, entry] };
      });
      if (draftVersion.current === version) {
        setWord("");
        setAliases("");
      }
    } catch (e) {
      notify(String(e), true);
    } finally {
      pending.current = false;
      setSaving(false);
    }
  }
  return (
    <>
      <div className="page-intro">
        <h2>Custom vocabulary</h2>
        <p>Add preferred spellings for names and terms in English or Polish.</p>
      </div>
      <Section
        title="Add a word"
        description="Use aliases for common mishearings or spoken pronunciations."
      >
        <form
          className="inline-form"
          onSubmit={(e) => {
            e.preventDefault();
            void add();
          }}
        >
          <Field label="Correct spelling">
            <input
              value={word}
              onChange={(e) => {
                draftVersion.current += 1;
                setWord(e.target.value);
              }}
              placeholder="CridVoice, Łukasz, Kubernetes…"
              maxLength={256}
            />
          </Field>
          <Field label="Aliases · comma separated">
            <input
              value={aliases}
              onChange={(e) => {
                draftVersion.current += 1;
                setAliases(e.target.value);
              }}
              placeholder="crid voice, grid voice"
            />
          </Field>
          <button className="button primary" disabled={!word.trim() || saving}>
            <Plus size={16} />
            Add word
          </button>
        </form>
      </Section>
      <Section
        title={`Saved words · ${settings.vocabulary.length}`}
        action={
          <div className="search-input">
            <Search size={15} />
            <input
              aria-label="Search vocabulary"
              placeholder="Find a word"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        }
      >
        {settings.vocabulary
          .filter((v) =>
            `${v.word} ${v.aliases.join(" ")}`.toLowerCase().includes(query),
          )
          .map((v) => (
            <div className="list-row" key={v.word}>
              <span className="word-symbol">Aa</span>
              <div className="row-info">
                <strong>{v.word}</strong>
                <small>
                  {v.aliases.length ? v.aliases.join(", ") : "No aliases"}
                </small>
              </div>
              <button
                className="icon-button"
                aria-label={`Remove ${v.word}`}
                onClick={() =>
                  void update((current) => ({
                    vocabulary: current.vocabulary.filter(
                      (x) => x.word !== v.word,
                    ),
                  })).catch((e) => notify(String(e), true))
                }
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))}
        {!settings.vocabulary.length && (
          <Empty
            icon={<Sparkles />}
            title="No vocabulary entries"
            description="Add names, places, technical terms, and Polish words you use often."
          />
        )}
      </Section>
    </>
  );
}
export function Styles({
  settings,
  snapshot,
  update,
  notify,
  controlsDisabled,
  openSettings,
  detectedLanguage,
  detectionActive,
}: PanelProps) {
  const [app, setApp] = useState(""),
    [style, setStyle] = useState("professional"),
    [prompt, setPrompt] = useState(""),
    [saving, setSaving] = useState(false);
  const example = writingExample(settings.cleanup.style);
  const exampleStyle =
    writingStyles.find((style) => style.value === settings.cleanup.style)
      ?.label || writingStyles[0].label;
  const pending = useRef(false),
    draftVersion = useRef(0);
  async function add() {
    if (!app.trim() || pending.current) return;
    const rule = { app: app.trim(), style, customPrompt: prompt.trim() },
      version = draftVersion.current;
    pending.current = true;
    setSaving(true);
    try {
      await update((current) => ({
        appRules: [
          ...current.appRules.filter(
            (r) => r.app.toLowerCase() !== rule.app.toLowerCase(),
          ),
          rule,
        ],
      }));
      if (draftVersion.current === version) {
        setApp("");
        setPrompt("");
      }
    } catch (e) {
      notify(String(e), true);
    } finally {
      pending.current = false;
      setSaving(false);
    }
  }
  return (
    <>
      <Section
        title="Dictation output"
        description="Turn your voice into Text, literal code or CLI commands, or generated code from spoken instructions."
      >
        <CodingControls
          settings={settings}
          update={update}
          disabled={controlsDisabled || saving}
          onOpenSettings={openSettings}
          detectedLanguage={detectedLanguage}
          detectionActive={detectionActive}
        />
      </Section>
      <Section
        title="Default writing style"
        description="Writing styles apply to Text mode. Corrections and punctuation preserve your intended meaning."
      >
        <Field label="Default writing style">
          <Select
            label="Default writing style"
            value={settings.cleanup.style}
            onChange={(v) =>
              update((current) => ({
                cleanup: { ...current.cleanup, style: v },
              }))
            }
            options={writingStyles}
          />
        </Field>
        <div className="style-example">
          <strong>Style example · {exampleStyle}</strong>
          <small>Illustrative result. Exact AI wording may vary.</small>
          <span>YOU SAY</span>
          <p>{example.input}</p>
          <span>CRIDVOICE WRITES</span>
          <p aria-label="Writing style example output">{example.output}</p>
        </div>
        {settings.cleanup.mode === "off" && (
          <p className="helper">
            Text cleanup is off. Enable cleanup to apply writing styles; this
            example is a local illustration.
          </p>
        )}
        {settings.cleanup.outputMode !== "text" && (
          <p className="helper">
            Writing styles apply to Text output. Your current code or generation
            mode uses its own instructions; selecting a writing style does not
            change the output mode.
          </p>
        )}
        {settings.cleanup.style === "code" && (
          <p className="helper">
            Code &amp; technical is a Text writing style that preserves
            identifiers. Choose Dictate code or commands above for literal
            syntax conversion.
          </p>
        )}
      </Section>
      <Section
        title="Application styles"
        description="Choose an application and its writing style. Running and recently used apps appear in the picker."
      >
        <form
          className="form-grid"
          onSubmit={(e) => {
            e.preventDefault();
            void add();
          }}
        >
          <ApplicationStyleEditor
            app={app}
            recentApps={snapshot.history.map((entry) => entry.app)}
            disabled={controlsDisabled}
            onAppChange={(value) => {
              draftVersion.current += 1;
              setApp(value);
            }}
          />
          <Field label="Style">
            <Select
              label="Application style"
              value={style}
              onChange={(value) => {
                draftVersion.current += 1;
                setStyle(value);
              }}
              options={writingStyles}
            />
          </Field>
          <Field label="Additional guidance · optional">
            <input
              value={prompt}
              onChange={(e) => {
                draftVersion.current += 1;
                setPrompt(e.target.value);
              }}
              placeholder="Keep emails brief and warm."
            />
          </Field>
          <button className="button primary" disabled={!app.trim() || saving}>
            <Plus size={15} />
            {settings.appRules.some(
              (rule) => rule.app.toLowerCase() === app.trim().toLowerCase(),
            )
              ? "Save application rule"
              : "Add application rule"}
          </button>
        </form>
        {settings.appRules.map((r) => (
          <div className="list-row" key={r.app}>
            <div className="square-icon">
              <Monitor size={18} />
            </div>
            <div className="row-info">
              <strong>{r.app}</strong>
              <small>
                {writingStyles.find((s) => s.value === r.style)?.label}
                {r.customPrompt ? ` · ${r.customPrompt}` : ""}
              </small>
            </div>
            <button
              type="button"
              className="button secondary small"
              aria-label={`Edit ${r.app} rule`}
              disabled={saving || controlsDisabled}
              onClick={() => {
                draftVersion.current += 1;
                setApp(r.app);
                setStyle(r.style);
                setPrompt(r.customPrompt);
              }}
            >
              Edit
            </button>
            <button
              className="icon-button"
              aria-label={`Remove ${r.app} rule`}
              onClick={() =>
                void update((current) => ({
                  appRules: current.appRules.filter((x) => x.app !== r.app),
                })).catch((e) => notify(String(e), true))
              }
            >
              <Trash2 size={16} />
            </button>
          </div>
        ))}
      </Section>
      <div className="notice">
        <Sparkles size={18} />
        <p>
          Select text in another app, press your rewrite shortcut, and speak the
          change you want. CridVoice replaces the selection after processing.
        </p>
      </div>
    </>
  );
}
export function Appearance({ settings, update }: PanelProps) {
  const a = settings.appearance;
  const [systemDark, setSystemDark] = useState(
    () =>
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches,
  );
  const [error, setError] = useState("");
  const changeVersion = useRef(0);
  const previewMode = resolveAppearance(a, systemDark).mode;
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const changed = () => setSystemDark(media.matches);
    changed();
    media.addEventListener("change", changed);
    return () => media.removeEventListener("change", changed);
  }, []);
  function change(patch: Partial<typeof a>) {
    const version = ++changeVersion.current;
    setError("");
    void update((current) => ({
      appearance: { ...current.appearance, ...patch },
    })).catch(() => {
      if (version === changeVersion.current)
        setError("Appearance changes could not be saved. Try again.");
    });
  }
  return (
    <>
      <Section
        title="Theme and color mode"
        description="Choose a theme and use light, dark, or Windows system colors."
      >
        <div className="segmented" aria-label="Color mode">
          {(["light", "dark", "system"] as const).map((mode) => (
            <button
              className={a.mode === mode ? "selected" : ""}
              key={mode}
              aria-pressed={a.mode === mode}
              onClick={() => change({ mode })}
            >
              {mode[0].toUpperCase() + mode.slice(1)}
            </button>
          ))}
        </div>
        <div className="theme-grid">
          {themes.map((t) => (
            <button
              key={t.id}
              className={`theme-card ${a.theme === t.id ? "selected" : ""}`}
              aria-pressed={a.theme === t.id}
              onClick={() => change({ theme: t.id, accent: t.accent })}
            >
              <div
                className="theme-preview"
                style={{
                  background: t[previewMode],
                }}
              >
                <span className="theme-sidebar" />
                <div>
                  <i style={{ background: t.accent }} />
                  <i />
                  <i />
                </div>
                <b style={{ background: t.accent }} />
              </div>
              <span>
                <strong>{t.name}</strong>
                {a.theme === t.id && <Check size={16} />}
              </span>
              <small>{t.description}</small>
            </button>
          ))}
        </div>
      </Section>
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      <Section title="Color and text size">
        <div className="form-grid">
          <Field label="Accent color">
            <div className="color-picker">
              <input
                aria-label="Accent color"
                type="color"
                value={a.accent}
                onChange={(e) => change({ accent: e.target.value })}
              />
              <code>{a.accent.toUpperCase()}</code>
            </div>
          </Field>
          <Field label={`Text size · ${Math.round(a.fontScale * 100)}%`}>
            <input
              aria-label="Text size"
              type="range"
              min="0.85"
              max="1.4"
              step="0.05"
              value={a.fontScale}
              onChange={(e) => change({ fontScale: Number(e.target.value) })}
            />
          </Field>
        </div>
      </Section>
      <Section
        title="Recording bar"
        description="Choose what appears while recording."
      >
        <Toggle
          label="Show floating recording bar"
          checked={a.overlayVisible}
          onChange={(v) => change({ overlayVisible: v })}
        />
        <Toggle
          label="Audio waveform"
          description="See microphone activity while speaking."
          checked={a.waveform}
          onChange={(v) => change({ waveform: v })}
        />
        <Toggle
          label="Live transcript preview"
          description="Preview recognition while speaking. Final cleanup happens on release."
          checked={a.livePreview}
          onChange={(v) => change({ livePreview: v })}
        />
      </Section>
    </>
  );
}
export function SettingsPanel({
  settings,
  snapshot,
  update,
  notify,
  controlsDisabled = false,
}: PanelProps) {
  const [mics, setMics] = useState<string[]>([]);
  const [micLoading, setMicLoading] = useState(false);
  const [micError, setMicError] = useState("");
  const [micLoaded, setMicLoaded] = useState(false);
  const micRequest = useRef(0);
  const change = (patch: SettingsUpdate) => {
    void update(patch).catch((reason) => notify(String(reason), true));
  };
  async function loadMicrophones() {
    const request = ++micRequest.current;
    setMicLoading(true);
    setMicError("");
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const found = await Promise.race([
        command<string[]>("microphone_devices"),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error("Microphone lookup timed out")),
            8000,
          );
        }),
      ]);
      if (request !== micRequest.current) return;
      setMics(Array.isArray(found) ? found : []);
      setMicLoaded(true);
    } catch {
      if (request === micRequest.current)
        setMicError(
          "Microphones could not be refreshed. Your saved choice is unchanged.",
        );
    } finally {
      clearTimeout(timer);
      if (request === micRequest.current) setMicLoading(false);
    }
  }
  useEffect(() => {
    void loadMicrophones();
    return () => {
      ++micRequest.current;
    };
  }, []);
  const s = settings;
  const providerOptions = s.providers.map((p) => ({
    value: p.id,
    label: p.name,
  }));
  return (
    <>
      <div
        className="settings-jumps"
        role="navigation"
        aria-label="Settings sections"
      >
        {[
          ["speech", "Speech"],
          ["cleanup", "Cleanup"],
          ["shortcuts", "Shortcuts"],
          ["privacy", "Privacy"],
          ["windows", "Windows"],
        ].map(([id, label]) => (
          <button
            key={id}
            className="button secondary small"
            onClick={() => {
              const section = document.getElementById(`settings-${id}`);
              section?.scrollIntoView({ block: "start" });
              section
                ?.querySelector<HTMLElement>("button, select, input")
                ?.focus({ preventScroll: true });
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <fieldset className="settings-fields" disabled={controlsDisabled}>
        <Section
          id="settings-speech"
          title="Speech recognition"
          description="Choose where your audio is transcribed."
        >
          <div className="form-grid">
            <Field label="Transcription engine">
              <Select
                label="Transcription engine"
                value={s.transcription.mode}
                onChange={(v) =>
                  change((current) => ({
                    transcription: {
                      ...current.transcription,
                      mode: v as "local" | "openai",
                    },
                  }))
                }
                options={[
                  { value: "local", label: "Local · app-managed" },
                  { value: "openai", label: "Selected provider · audio API" },
                ]}
              />
            </Field>
            {s.transcription.mode === "local" ? (
              <Field label="Speech processing device">
                <Select
                  label="Speech processing device"
                  value={s.transcription.device}
                  onChange={(v) =>
                    change((current) => ({
                      transcription: {
                        ...current.transcription,
                        device: v as typeof s.transcription.device,
                      },
                    }))
                  }
                  options={devices}
                />
              </Field>
            ) : (
              <Field label="Speech provider">
                <Select
                  label="Speech provider"
                  value={s.transcription.providerId}
                  onChange={(v) =>
                    change((current) => ({
                      transcription: {
                        ...current.transcription,
                        providerId: v,
                      },
                    }))
                  }
                  options={[
                    { value: "", label: "Select a provider" },
                    ...providerOptions.filter(
                      (o) =>
                        s.providers.find((p) => p.id === o.value)?.protocol ===
                        "openai",
                    ),
                  ]}
                />
              </Field>
            )}
            <Field label="Dictation language">
              <Select
                label="Dictation language"
                value={s.transcription.language}
                onChange={(v) =>
                  change((current) => ({
                    transcription: {
                      ...current.transcription,
                      language: v as typeof s.transcription.language,
                    },
                  }))
                }
                options={languages}
              />
            </Field>
            <Field label="Microphone">
              <Select
                label="Microphone"
                value={s.general.microphone}
                onChange={(v) =>
                  change((current) => ({
                    general: { ...current.general, microphone: v },
                  }))
                }
                options={[
                  { value: "", label: "Windows default microphone" },
                  ...Array.from(
                    new Set([s.general.microphone, ...mics].filter(Boolean)),
                  ).map((m) => ({ value: m, label: m })),
                ]}
              />
            </Field>
          </div>
          <button
            className="button ghost small"
            disabled={micLoading}
            onClick={() => void loadMicrophones()}
          >
            {micLoading ? (
              <Busy label="Finding microphones" />
            ) : (
              "Refresh microphones"
            )}
          </button>
          {micError && (
            <p className="error-text" role="alert">
              {micError}
            </p>
          )}
          {micLoaded &&
            s.general.microphone &&
            !mics.includes(s.general.microphone) && (
              <p className="helper">
                Your saved microphone is not connected. Connect it, or choose
                Windows default microphone.
              </p>
            )}
          <BackgroundAudioControl
            general={s.general}
            update={update}
            notify={notify}
          />
          {s.transcription.mode === "openai" && s.appearance.livePreview && (
            <p className="helper">
              Live preview can make multiple audio requests to your selected
              provider. Turn it off in Appearance to transcribe only after
              release.
            </p>
          )}
        </Section>
        <Section
          id="settings-cleanup"
          title="Text cleanup"
          description="Select a local model or provider for corrections and rewriting."
        >
          <div className="form-grid">
            <Field label="Cleanup engine">
              <Select
                label="Cleanup engine"
                value={s.cleanup.mode}
                onChange={(v) =>
                  change((current) => ({
                    cleanup: {
                      ...current.cleanup,
                      mode: v as typeof s.cleanup.mode,
                      outputMode:
                        v === "off" ? "text" : current.cleanup.outputMode,
                    },
                  }))
                }
                options={[
                  { value: "managed", label: "Local · app-managed" },
                  {
                    value: "provider",
                    label: "Selected provider · LM Studio / cloud",
                  },
                  { value: "off", label: "Off · raw transcript" },
                ]}
              />
            </Field>
            {s.cleanup.mode === "managed" ? (
              <Field label="Cleanup processing device">
                <Select
                  label="Cleanup processing device"
                  value={s.cleanup.device}
                  onChange={(v) =>
                    change((current) => ({
                      cleanup: {
                        ...current.cleanup,
                        device: v as typeof s.cleanup.device,
                      },
                    }))
                  }
                  options={cleanupDevices}
                />
              </Field>
            ) : (
              s.cleanup.mode === "provider" && (
                <Field label="Text provider">
                  <Select
                    label="Text provider"
                    value={s.cleanup.providerId}
                    onChange={(v) =>
                      change((current) => ({
                        cleanup: { ...current.cleanup, providerId: v },
                      }))
                    }
                    options={[
                      { value: "", label: "Select a provider" },
                      ...providerOptions,
                    ]}
                  />
                </Field>
              )
            )}
          </div>
        </Section>
        <Section
          id="settings-shortcuts"
          title="Keyboard shortcuts"
          description="Choose Change, press your keys together, then save. Hold records until you release; Toggle starts and stops with a press."
        >
          <div className="shortcut-settings">
            {(["hold", "toggle", "rewrite"] as const).map((k) => (
              <ShortcutRecorder
                key={k}
                kind={k}
                value={s.shortcuts[k]}
                shortcuts={s.shortcuts}
                disabled={controlsDisabled}
                onSave={(value) =>
                  update((current) => {
                    const shortcuts = { ...current.shortcuts, [k]: value };
                    const problem = shortcutProblem(shortcuts);
                    if (problem) throw new Error(problem);
                    return { shortcuts };
                  })
                }
              />
            ))}
          </div>
          <p className="helper">
            Escape cancels a recording. Shortcut changes are available while
            dictation is idle.
          </p>
        </Section>
        <Section id="settings-privacy" title="Privacy & history">
          <Toggle
            label="Save transcript history"
            description="Store transcript text locally. Audio is discarded after processing."
            checked={s.general.saveHistory}
            onChange={(v) =>
              change((current) => ({
                general: { ...current.general, saveHistory: v },
              }))
            }
          />
          <Toggle
            label="Use application context"
            description="Use selected text for rewriting and editor hints for code language detection. Normal dictation only inserts your new speech. Password fields are excluded."
            checked={s.general.context}
            onChange={(v) =>
              change((current) => ({
                general: { ...current.general, context: v },
              }))
            }
          />
          <Field label="History retention">
            <Select
              label="History retention"
              value={String(s.general.historyDays)}
              onChange={(v) =>
                change((current) => ({
                  general: { ...current.general, historyDays: Number(v) },
                }))
              }
              options={[
                { value: "0", label: "Keep until I delete it" },
                { value: "7", label: "7 days" },
                { value: "30", label: "30 days" },
                { value: "90", label: "90 days" },
                ...([0, 7, 30, 90].includes(s.general.historyDays)
                  ? []
                  : [
                      {
                        value: String(s.general.historyDays),
                        label: `${s.general.historyDays} days`,
                      },
                    ]),
              ]}
            />
          </Field>
          <p className="helper">
            Only your selected provider receives requests. When enabled,
            relevant context can be sent for rewriting or code generation. There
            is no automatic cloud fallback.
          </p>
        </Section>
        <Section id="settings-windows" title="Windows & storage">
          <Field
            label="Text insertion"
            hint="Clipboard paste restores previous contents when safe. If a clipboard format cannot be preserved, CridVoice automatically uses Unicode typing. Unicode typing leaves the clipboard untouched."
          >
            <Select
              label="Text insertion"
              value={s.general.insertionMethod || "clipboard"}
              onChange={(v) =>
                change((current) => ({
                  general: {
                    ...current.general,
                    insertionMethod: v as "clipboard" | "unicode",
                  },
                }))
              }
              options={[
                {
                  value: "clipboard",
                  label: "Clipboard paste · restore previous contents",
                },
                {
                  value: "unicode",
                  label: "Unicode typing · no clipboard use",
                },
              ]}
            />
          </Field>
          <Toggle
            label="Launch at startup"
            description="Start quietly in the system tray when you sign in."
            checked={s.general.startup}
            onChange={(v) =>
              change((current) => ({
                general: { ...current.general, startup: v },
              }))
            }
          />
          <Field label="Maximum recording length">
            <Select
              label="Maximum recording length"
              value={String(s.general.maxRecordingSeconds)}
              onChange={(v) =>
                change((current) => ({
                  general: {
                    ...current.general,
                    maxRecordingSeconds: Number(v),
                  },
                }))
              }
              options={[
                { value: "60", label: "1 minute" },
                { value: "300", label: "5 minutes" },
                { value: "600", label: "10 minutes" },
                { value: "1800", label: "30 minutes" },
                ...([60, 300, 600, 1800].includes(s.general.maxRecordingSeconds)
                  ? []
                  : [
                      {
                        value: String(s.general.maxRecordingSeconds),
                        label: `${s.general.maxRecordingSeconds} seconds`,
                      },
                    ]),
              ]}
            />
          </Field>
          <div className="storage-row">
            <div>
              <strong>
                {snapshot.portable
                  ? "Portable storage"
                  : "Local application storage"}
              </strong>
              <code>{snapshot.dataDir}</code>
            </div>
            <button
              className="button secondary small"
              onClick={() =>
                command("open_data_folder").catch((e) =>
                  notify(String(e), true),
                )
              }
            >
              <ExternalLink size={14} />
              Open folder
            </button>
          </div>
        </Section>
      </fieldset>
    </>
  );
}
export function History({ snapshot, refresh, notify }: PanelProps) {
  return (
    <HistoryContent
      history={snapshot.history}
      refresh={refresh}
      notify={notify}
    />
  );
}
// Audio levels and provisional speech update App frequently. Keep those events
// from rebuilding every saved transcript while this page is open.
const HistoryContent = memo(function HistoryContent({
  history,
  refresh,
  notify,
}: {
  history: Snapshot["history"];
  refresh: PanelProps["refresh"];
  notify: PanelProps["notify"];
}) {
  const [search, setSearch] = useState(""),
    [language, setLanguage] = useState("all"),
    [confirm, setConfirm] = useState(false),
    [selected, setSelected] = useState<string | null>(null);
  const query = search.toLowerCase();
  const filtered = useMemo(
    () =>
      history.filter(
        (h) =>
          (language === "all" || h.language === language) &&
          (!query ||
            `${h.text} ${h.rawText} ${h.app}`.toLowerCase().includes(query)),
      ),
    [history, language, query],
  );
  const entry = selected ? history.find((h) => h.id === selected) : undefined;
  const technical = (mode: string) =>
    ["code", "code-rewrite", "generate"].includes(mode);
  const rawTechnical = (mode: string) =>
    ["code-raw", "code-rewrite-raw", "generate-raw"].includes(mode);
  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      notify("Copied to clipboard.");
    } catch {
      notify("Clipboard access was blocked.", true);
    }
  }
  async function remove(id: string) {
    try {
      await command("delete_history", { id });
      await refresh();
      setSelected((current) => (current === id ? null : current));
    } catch (e) {
      notify(String(e), true);
    }
  }
  async function exportHistory() {
    const blob = new Blob([JSON.stringify(filtered, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `CridVoice-history-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <>
      <div className="history-toolbar">
        <div className="search-input">
          <Search size={17} />
          <input
            aria-label="Search history"
            placeholder="Search your thoughts…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select
          label="History language"
          value={language}
          onChange={setLanguage}
          options={[
            { value: "all", label: "All languages" },
            { value: "en", label: "English" },
            { value: "pl", label: "Polski" },
          ]}
        />
        <button
          className="button secondary"
          disabled={!filtered.length}
          onClick={exportHistory}
        >
          <Download size={15} />
          Export
        </button>
        <button
          className="icon-button"
          aria-label="Clear history"
          disabled={!history.length}
          onClick={() => setConfirm(true)}
        >
          <Trash2 size={17} />
        </button>
      </div>
      <div className="history-count">
        {filtered.length} {filtered.length === 1 ? "transcript" : "transcripts"}{" "}
        · stored on your device
      </div>
      {filtered.length ? (
        <div className="history-list">
          {filtered.map((h) => (
            <article className="history-card" key={h.id}>
              <div className="history-meta">
                <span>
                  {new Date(h.createdAt).toLocaleString(undefined, {
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
                <Badge>
                  {h.language === "pl"
                    ? "Polski"
                    : h.language === "en"
                      ? "English"
                      : h.language}
                </Badge>
                {h.app && <span>{h.app}</span>}
                <span className="push-right">
                  {h.wordCount} words · {Math.round(h.durationSeconds)}s
                </span>
              </div>
              <button
                className={`history-text${technical(h.mode) ? " code-output" : ""}`}
                onClick={() => setSelected(h.id)}
              >
                {h.text}
              </button>
              <div className="history-actions">
                <span>
                  {rawTechnical(h.mode)
                    ? "Raw transcript · conversion failed"
                    : h.mode === "rewrite"
                      ? "Selection rewritten"
                      : h.mode === "code-rewrite"
                        ? "Selected code rewritten"
                        : h.mode === "generate"
                          ? "Generated code or commands"
                          : h.mode === "code"
                            ? "Dictated code or commands"
                            : h.inserted
                              ? "Inserted into application"
                              : "Saved transcript"}
                </span>
                <button
                  className="button ghost small"
                  onClick={() => copy(h.text)}
                >
                  <Copy size={14} />
                  Copy
                </button>
                <button
                  className="icon-button"
                  aria-label="Delete transcript"
                  onClick={() => remove(h.id)}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <Empty
          icon={<Search />}
          title={search ? "No matching transcripts" : "No saved transcripts"}
          description={
            search
              ? "Try a different search or language filter."
              : "Saved dictations appear here when transcript history is enabled."
          }
        />
      )}{" "}
      {confirm && (
        <Modal
          title="Clear transcript history?"
          onClose={() => setConfirm(false)}
        >
          <p className="modal-copy">
            This permanently removes all saved transcript text from this device.
            Downloaded models and settings are kept.
          </p>
          <div className="modal-footer">
            <button
              className="button secondary"
              onClick={() => setConfirm(false)}
            >
              Cancel
            </button>
            <button
              className="button danger"
              onClick={() =>
                command("clear_history")
                  .then(refresh)
                  .then(() => {
                    setConfirm(false);
                    notify("History cleared.");
                  })
                  .catch((e) => notify(String(e), true))
              }
            >
              Clear history
            </button>
          </div>
        </Modal>
      )}
      {entry && (
        <Modal
          title="Transcript details"
          onClose={() => setSelected(null)}
          wide
        >
          <div className="transcript-detail">
            <label>
              {rawTechnical(entry.mode)
                ? "RAW TRANSCRIPT"
                : technical(entry.mode)
                  ? "CODE OR COMMAND OUTPUT"
                  : "FINAL TEXT"}
            </label>
            {technical(entry.mode) ? (
              <pre className="code-output">{entry.text}</pre>
            ) : (
              <p>{entry.text}</p>
            )}
            <label>ORIGINAL TRANSCRIPTION</label>
            <p>{entry.rawText}</p>
          </div>
          <div className="modal-footer">
            <button
              className="button secondary"
              onClick={() => setSelected(null)}
            >
              Close
            </button>
            <button className="button primary" onClick={() => copy(entry.text)}>
              <Copy size={15} />
              Copy final text
            </button>
          </div>
        </Modal>
      )}
    </>
  );
});
