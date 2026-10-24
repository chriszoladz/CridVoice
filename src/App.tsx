import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SyntheticEvent } from "react";
import {
  Activity,
  ArrowRight,
  AudioLines,
  BookOpen,
  CheckCircle2,
  CircleHelp,
  Clock3,
  Copy,
  Cpu,
  History as HistoryIcon,
  Keyboard,
  LayoutDashboard,
  LoaderCircle,
  Mic,
  Monitor,
  Palette,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Server,
  Settings2,
  ShieldCheck,
  Sparkles,
  Square,
  X,
} from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  command,
  completeSetup,
  desktop,
  events,
  getSnapshot,
  saveSettings,
} from "./bridge";
import {
  Appearance,
  History,
  Models,
  Providers,
  SettingsPanel,
  Styles,
  VocabularyPanel,
} from "./panels";
import {
  Busy,
  Empty,
  Modal,
  Select,
  Shortcut,
  Waveform,
  languages,
} from "./ui";
import { applyAppearance } from "./themes";
import Onboarding from "./Onboarding";
import CodingControls from "./CodingControls";
import WindowTitlebar from "./WindowTitlebar";
import ProcessingStatus from "./ProcessingStatus";
import TranscriptPreview from "./TranscriptPreview";
import { BrandLockup, BrandMark } from "./BrandMark";
import { getSetupPlan } from "./setupPlan";
import { selectedLocalModels } from "./localModelStatus";
import { defaultSettings, emptySession } from "./types";
import type {
  DownloadProgress,
  Page,
  Session,
  Settings,
  SettingsUpdate,
  Snapshot,
} from "./types";
const navigation = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "history", label: "History", icon: HistoryIcon },
  { id: "vocabulary", label: "Vocabulary", icon: BookOpen },
  { id: "styles", label: "Writing styles", icon: Sparkles },
  { id: "providers", label: "AI providers", icon: Server },
  { id: "models", label: "Local models", icon: Cpu },
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "settings", label: "Settings", icon: Settings2 },
] as const;
const activeDownloadStates = [
  "queued",
  "downloading",
  "verifying",
  "extracting",
];
const pageInfo: Record<Page, { title: string; description: string }> = {
  overview: {
    title: "Overview",
    description: "Dictation, processing settings, and recent transcripts.",
  },
  history: {
    title: "History",
    description: "Review and copy saved transcripts.",
  },
  vocabulary: {
    title: "Personal vocabulary",
    description: "Names and spellings to prioritize during dictation.",
  },
  styles: {
    title: "Writing styles",
    description: "Default and per-application text cleanup styles.",
  },
  providers: {
    title: "AI providers",
    description: "Connections for speech recognition and text cleanup.",
  },
  models: {
    title: "Local models",
    description: "Speech models, cleanup models, runtimes, and memory status.",
  },
  appearance: {
    title: "Appearance",
    description: "Theme, text size, and recording display.",
  },
  settings: {
    title: "Settings",
    description: "Audio, shortcuts, privacy, and startup.",
  },
};
const pageKeywords: Record<Page, string> = {
  overview:
    "record speak output mode code cli commands generate automatic language",
  settings:
    "microphone mic input audio hotkey keybind key bind keyboard shortcut privacy retention context startup windows clipboard paste insertion recording length device",
  appearance:
    "theme preset color colour dark light system font text size preview waveform overlay popup",
  styles:
    "application app rules tone formal casual professional writing code language shell override",
  providers:
    "api key endpoint url server cloud openai anthropic lm studio connection model id",
  models:
    "download install cuda nvidia gpu cpu runtime whisper qwen tiny memory ram warm load",
  vocabulary: "word names spelling pronunciation aliases dictionary",
  history: "transcript previous search copy delete export",
};
function matchesPage(page: (typeof navigation)[number], query: string) {
  const text =
    `${page.label} ${pageInfo[page.id].description} ${pageKeywords[page.id]}`.toLowerCase();
  return query
    .toLowerCase()
    .trim()
    .split(/\s+/)
    .every((word) => text.includes(word));
}
export default function App() {
  const overlay = new URLSearchParams(location.search).has("overlay");
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null),
    [settings, setSettings] = useState(defaultSettings),
    [session, setSession] = useState<Session>(emptySession),
    [page, setPage] = useState<Page>("overview"),
    [toast, setToast] = useState<{ message: string; error: boolean } | null>(
      null,
    ),
    [downloads, setDownloads] = useState<Record<string, DownloadProgress>>({}),
    [setup, setSetup] = useState(false),
    [setupRepair, setSetupRepair] = useState(false),
    [saving, setSaving] = useState(false),
    [saveFailed, setSaveFailed] = useState(false),
    [fatal, setFatal] = useState(""),
    [help, setHelp] = useState(false),
    [search, setSearch] = useState(""),
    [searchOpen, setSearchOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      return localStorage.getItem("cridvoice-sidebar-collapsed") === "true";
    } catch {
      return false;
    }
  });
  const [railTooltip, setRailTooltip] = useState<{
    label: string;
    top: number;
  } | null>(null);
  const brandAnimation = useRef<Animation | null>(null);
  useEffect(
    () => () => {
      brandAnimation.current?.cancel();
      brandAnimation.current = null;
    },
    [],
  );
  useEffect(() => {
    if (!railTooltip) return;
    const dismiss = () => setRailTooltip(null);
    window.addEventListener("resize", dismiss);
    return () => window.removeEventListener("resize", dismiss);
  }, [railTooltip]);
  useEffect(() => {
    if (setup || help || searchOpen) setRailTooltip(null);
  }, [setup, help, searchOpen]);
  const settingsRef = useRef(settings),
    lastSaved = useRef(settings),
    queue = useRef(Promise.resolve()),
    saveCount = useRef(0),
    pendingSaves = useRef(0),
    refreshEpoch = useRef(0),
    downloadVersions = useRef<Record<string, number>>({}),
    active = useRef(false),
    initialized = useRef(false),
    liveSessionSeen = useRef(false),
    reviewShown = useRef(false),
    toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const { totalWords, minutesSaved } = useMemo(() => {
    let totalWords = 0;
    let totalSeconds = 0;
    for (const entry of snapshot?.history || []) {
      totalWords += entry.wordCount;
      totalSeconds += entry.durationSeconds;
    }
    return {
      totalWords,
      minutesSaved: Math.max(
        0,
        Math.round(totalWords / 40 - totalSeconds / 60),
      ),
    };
  }, [snapshot?.history]);
  const notify = useCallback((message: string, error = false) => {
    setToast({
      message: message.replace(/^Error: /, "").replace(/^.*?\n/, ""),
      error,
    });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), error ? 10000 : 4500);
  }, []);
  const refresh = useCallback(async () => {
    if (!active.current) return;
    const epoch = ++refreshEpoch.current;
    const requestedDownloadVersions = { ...downloadVersions.current };
    let data: Snapshot;
    try {
      data = await getSnapshot();
    } catch (error) {
      if (!active.current || epoch !== refreshEpoch.current) return;
      throw error;
    }
    if (!active.current || epoch !== refreshEpoch.current) return;
    setSnapshot(data);
    if (!initialized.current) {
      initialized.current = true;
      if (!liveSessionSeen.current) {
        setSession(data.session || emptySession);
        reviewShown.current =
          !!data.session?.result && !!data.session?.reviewRequired;
      }
      setSetupRepair(data.settings.setupComplete);
      setSetup(
        !data.settings.setupComplete ||
          (desktop &&
            !getSetupPlan(data.settings, data.hardware, data.models).ready),
      );
    }
    const activeDownloads = data.activeDownloads;
    if (activeDownloads)
      setDownloads((previous) => {
        const next = { ...previous };
        const ids = new Set([
          ...Object.keys(previous),
          ...Object.keys(activeDownloads),
        ]);
        for (const id of ids) {
          // Progress events received during this request are newer than its snapshot.
          if (downloadVersions.current[id] !== requestedDownloadVersions[id])
            continue;
          if (activeDownloads[id]) next[id] = activeDownloads[id];
          else if (
            previous[id] &&
            activeDownloadStates.includes(previous[id].state)
          )
            delete next[id];
        }
        return next;
      });
    const next =
      pendingSaves.current === 0
        ? data.settings
        : {
            ...settingsRef.current,
            providers: settingsRef.current.providers.map((p) => ({
              ...p,
              hasKey:
                data.settings.providers.find((n) => n.id === p.id)?.hasKey ??
                p.hasKey,
            })),
          };
    settingsRef.current = next;
    setSettings(next);
    if (pendingSaves.current === 0) lastSaved.current = data.settings;
  }, []);
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    active.current = true;
    void refresh().catch((error) => {
      if (!disposed) setFatal(String(error));
    });
    events(
      (s) => {
        if (!disposed) {
          liveSessionSeen.current = true;
          setSession(s);
          if (!s.result) reviewShown.current = false;
          if (
            !overlay &&
            (((s.status === "idle" || s.status === "error") &&
              s.reviewRequired) ||
              (s.status === "error" &&
                s.resultIsRaw &&
                (s.outputMode === "code" || s.outputMode === "generate"))) &&
            s.result &&
            !reviewShown.current
          ) {
            reviewShown.current = true;
            setPage("overview");
          }
        }
      },
      (d) => {
        if (!disposed) {
          downloadVersions.current[d.id] =
            (downloadVersions.current[d.id] || 0) + 1;
          setDownloads((prev) => ({ ...prev, [d.id]: d }));
        }
        if (!disposed && ["complete", "error", "cancelled"].includes(d.state))
          void refresh().catch((e) => notify(String(e), true));
      },
      () => {
        if (!disposed) void refresh().catch((e) => notify(String(e), true));
      },
      () => {
        if (!disposed) void refresh().catch((e) => notify(String(e), true));
      },
    )
      .then((off) => {
        if (disposed) off();
        else unlisten = off;
      })
      .catch((error) => {
        if (!disposed)
          notify(`Live updates could not be connected: ${String(error)}`, true);
      });
    return () => {
      disposed = true;
      active.current = false;
      refreshEpoch.current += 1;
      unlisten?.();
      clearTimeout(toastTimer.current);
    };
  }, [refresh, notify, overlay]);
  useEffect(() => {
    if (overlay) return;
    try {
      localStorage.setItem(
        "cridvoice-sidebar-collapsed",
        String(sidebarCollapsed),
      );
    } catch {
      /* The sidebar remains usable when UI preference storage is unavailable. */
    }
  }, [sidebarCollapsed, overlay]);
  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    function apply() {
      const a = settings.appearance;
      applyAppearance(document.documentElement, a, media.matches);
      document.body.classList.toggle("overlay-body", overlay);
    }
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [settings.appearance, overlay]);
  useEffect(() => {
    if (desktop && !overlay)
      void getCurrentWindow()
        .setTheme(
          settings.appearance.mode === "system"
            ? null
            : settings.appearance.mode,
        )
        .catch(() => {});
  }, [settings.appearance.mode, overlay]);
  useEffect(() => {
    function keys(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        const dialog = document.querySelector(
          '[role="dialog"][aria-modal="true"]',
        );
        if (dialog && dialog.getAttribute("aria-label") !== "Find a page")
          return;
        setSearchOpen((o) => !o);
      }
      if (e.key === "Escape") {
        setRailTooltip(null);
        setSearchOpen(false);
        setHelp(false);
      }
    }
    window.addEventListener("keydown", keys);
    return () => window.removeEventListener("keydown", keys);
  }, []);
  async function update(patch: SettingsUpdate, completingSetup = false) {
    const latest = settingsRef.current;
    const next = {
      ...latest,
      ...(typeof patch === "function" ? patch(latest) : patch),
    };
    settingsRef.current = next;
    setSettings(next);
    setSaving(true);
    const count = ++saveCount.current;
    pendingSaves.current += 1;
    const saving = queue.current
      .catch(() => {})
      .then(() => (completingSetup ? completeSetup(next) : saveSettings(next)));
    queue.current = saving;
    try {
      await saving;
      lastSaved.current = next;
      if (count === saveCount.current) {
        setSaving(false);
        setSaveFailed(false);
      }
    } catch (e) {
      if (count === saveCount.current) {
        settingsRef.current = lastSaved.current;
        setSettings(lastSaved.current);
        setSaving(false);
        setSaveFailed(true);
      }
      notify(`Settings could not be saved: ${String(e)}`, true);
      throw e;
    } finally {
      pendingSaves.current -= 1;
      if (pendingSaves.current === 0)
        void refresh().catch((e) => notify(String(e), true));
    }
  }
  async function finish(
    s: Settings,
    credential?: { id: string; value: string },
  ) {
    if (credential) {
      await update({ ...s, setupComplete: false });
      await command("set_provider_key", {
        id: credential.id,
        key: credential.value,
      });
    }
    await update(s, true);
    await refresh();
    setSetup(false);
    setSession((previous) =>
      previous.status === "error"
        ? { ...previous, status: "idle", error: "" }
        : previous,
    );
    if (!s.general.saveHistory) notify("Setup complete. History is off.");
  }
  async function dictate() {
    try {
      if (
        snapshot &&
        session.status !== "recording" &&
        !getSetupPlan(settingsRef.current, snapshot.hardware, snapshot.models)
          .ready
      ) {
        setSetupRepair(true);
        setSetup(true);
        return;
      }
      if (session.status === "recording") await command("stop_recording");
      else if (
        !["transcribing", "cleaning", "inserting"].includes(session.status)
      )
        await command("start_recording", { rewrite: false });
    } catch (e) {
      notify(String(e), true);
    }
  }
  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      notify("Copied to clipboard.");
    } catch {
      notify("Clipboard access was blocked.", true);
    }
  }
  const sidebarToggle = (
    <button
      type="button"
      className="icon-button sidebar-toggle"
      aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
      title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
      aria-expanded={!sidebarCollapsed}
      aria-controls="main-sidebar"
      onClick={() => {
        setRailTooltip(null);
        setSidebarCollapsed((previous) => !previous);
      }}
    >
      {sidebarCollapsed ? (
        <PanelLeftOpen size={18} />
      ) : (
        <PanelLeftClose size={18} />
      )}
    </button>
  );
  function showSidebarHint(button: HTMLButtonElement) {
    if (
      !sidebarCollapsed ||
      (document.getElementById("main-sidebar")?.getBoundingClientRect().width ||
        0) > 64.5
    )
      return;
    const label = button.getAttribute("aria-label");
    if (!label) return;
    const rect = button.getBoundingClientRect();
    setRailTooltip({
      label,
      top: Math.max(18, Math.min(innerHeight - 18, rect.top + rect.height / 2)),
    });
  }
  function sidebarHint(label: string) {
    function show(event: SyntheticEvent<HTMLButtonElement>) {
      showSidebarHint(event.currentTarget);
    }
    return {
      title: sidebarCollapsed ? undefined : label,
      onMouseEnter: show,
      onFocus: show,
      onMouseLeave: (event: SyntheticEvent<HTMLButtonElement>) => {
        if (document.activeElement !== event.currentTarget)
          setRailTooltip(null);
      },
      onBlur: () => setRailTooltip(null),
      "aria-describedby":
        sidebarCollapsed && railTooltip?.label === label
          ? "sidebar-tooltip"
          : undefined,
    };
  }
  function navigateSidebar(nextPage: Page) {
    setRailTooltip(null);
    setPage(nextPage);
  }
  function activateBrand(event: SyntheticEvent<HTMLButtonElement>) {
    navigateSidebar("overview");
    brandAnimation.current?.cancel();
    brandAnimation.current = null;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const image = event.currentTarget.querySelector<HTMLImageElement>(
      `${sidebarCollapsed ? ".brand-mark" : ".brand-lockup"} .brand-image-${document.documentElement.dataset.mode === "light" ? "light" : "dark"}`,
    );
    if (!image || typeof image.animate !== "function") return;
    const animation = image.animate(
      [
        { transform: "scale(1)" },
        { transform: "scale(0.94)", offset: 0.32 },
        { transform: "scale(1.025)", offset: 0.7 },
        { transform: "scale(1)" },
      ],
      { duration: 260, easing: "ease-out" },
    );
    brandAnimation.current = animation;
    animation.onfinish = () => {
      if (brandAnimation.current === animation) brandAnimation.current = null;
    };
  }
  const previewEmptyMessage =
    settings.transcription.mode === "local" &&
    snapshot?.engineStatus?.preview?.state === "error"
      ? "Preview unavailable. Release to transcribe."
      : undefined;
  if (overlay)
    return (
      <div
        className="recording-overlay"
        onMouseDown={(event) => {
          if (desktop && event.button === 0)
            void getCurrentWindow()
              .startDragging()
              .catch(() => {});
        }}
      >
        <div className="overlay-top">
          <BrandMark size={20} className="brand-mark tiny" />
          <strong role="status" aria-label="Recording status">
            {
              {
                idle: "Ready",
                loading: "Loading models",
                recording: "Recording",
                transcribing: "Transcribing",
                cleaning: "Cleaning",
                inserting: "Inserting",
                error: "Error",
              }[session.status]
            }
          </strong>
          <span className="overlay-progress" aria-hidden="true">
            {["loading", "transcribing", "cleaning", "inserting"].includes(
              session.status,
            ) && <LoaderCircle size={12} className="spin" />}
          </span>
        </div>
        {settings.appearance.waveform && (
          <Waveform
            level={session.level}
            active={session.status === "recording"}
          />
        )}{" "}
        {session.status === "error" ? (
          <p
            className="overlay-preview"
            aria-live="polite"
            aria-label="Recording error"
          >
            {session.error}
          </p>
        ) : settings.appearance.livePreview ? (
          <TranscriptPreview
            text={session.preview}
            variant="overlay"
            emptyMessage={previewEmptyMessage}
          />
        ) : null}
        <p className="overlay-hint">
          {session.status === "recording"
            ? `${session.outputMode === "generate" ? "Release to review" : "Release to finish"} · Esc to cancel`
            : ["loading", "transcribing", "cleaning", "inserting"].includes(
                  session.status,
                )
              ? "Esc to cancel"
              : session.status === "error"
                ? "Open CridVoice to review the error."
                : ""}
        </p>
      </div>
    );
  if (fatal)
    return (
      <div className="startup-shell">
        <WindowTitlebar onError={(message) => notify(message, true)}>
          <div className="breadcrumb">
            {sidebarToggle}
            <strong>CridVoice</strong>
          </div>
        </WindowTitlebar>
        <div className="startup-error">
          <ShieldCheck size={32} />
          <h1>CridVoice could not load</h1>
          <p>{fatal}</p>
          <button className="button primary" onClick={() => location.reload()}>
            Try again
          </button>
        </div>
      </div>
    );
  if (!snapshot)
    return (
      <div className="startup-shell">
        <WindowTitlebar onError={(message) => notify(message, true)}>
          <div className="breadcrumb">
            {sidebarToggle}
            <strong>CridVoice</strong>
          </div>
        </WindowTitlebar>
        <div className="startup-error">
          <BrandMark />
          <Busy label="Opening CridVoice" />
        </div>
      </div>
    );
  const activeDownloads = Object.values(downloads).filter((d) =>
    activeDownloadStates.includes(d.state),
  ).length;
  const localSpeech = settings.transcription.mode === "local",
    localCleanup = settings.cleanup.mode === "managed";
  const setupPlan = getSetupPlan(settings, snapshot.hardware, snapshot.models);
  const speechReady = localSpeech
    ? true
    : settings.providers.some(
        (p) =>
          p.id === settings.transcription.providerId &&
          p.protocol === "openai" &&
          !!p.sttModel,
      );
  const cleanupReady =
    settings.cleanup.mode === "off" ||
    (localCleanup
      ? true
      : settings.providers.some(
          (p) => p.id === settings.cleanup.providerId && !!p.model,
        ));
  const modelReady = setupPlan.ready && speechReady && cleanupReady;
  const localModels = selectedLocalModels(
    settings,
    snapshot.hardware,
    snapshot.models,
    snapshot.engineStatus,
  );
  const warming = localModels.some((model) => model.state === "loading");
  const loadFailed = localModels.some((model) => model.state === "error");
  const busy = ["transcribing", "cleaning", "inserting", "loading"].includes(
      session.status,
    ),
    recording = session.status === "recording";
  const props = {
    settings,
    snapshot,
    update,
    refresh,
    notify,
    controlsDisabled: busy || recording || saving,
    openSettings: () => setPage("settings"),
    detectedLanguage: session.codingLanguage,
    detectionActive: busy || recording,
  };
  function openProcessingSettings() {
    props.openSettings();
    requestAnimationFrame(() => {
      const section = document.getElementById("settings-speech");
      section?.scrollIntoView({ block: "start" });
      section
        ?.querySelector<HTMLElement>("select, input, button")
        ?.focus({ preventScroll: true });
    });
  }
  const dictationStatus = recording
    ? "Recording"
    : busy
      ? {
          loading: "Loading models",
          transcribing: "Transcribing",
          cleaning: "Cleaning",
          inserting: "Inserting",
        }[
          session.status as
            "loading" | "transcribing" | "cleaning" | "inserting"
        ]
      : session.status === "error"
        ? "Error"
        : !modelReady
          ? "Setup required"
          : warming
            ? "Warming local models"
            : loadFailed
              ? "Model loading failed"
              : "Ready";
  const modelName = (id: string) =>
    snapshot.models.find((model) => model.id === id)?.name || id;
  const speechProvider = settings.providers.find(
    (provider) => provider.id === settings.transcription.providerId,
  );
  const cleanupProvider = settings.providers.find(
    (provider) => provider.id === settings.cleanup.providerId,
  );
  const speechDescription = localSpeech
    ? `${modelName(settings.transcription.modelId)} · ${settings.transcription.device === "auto" ? "Automatic device" : settings.transcription.device === "cpu" ? "CPU" : "CUDA GPU"}`
    : `${speechProvider?.name || "Provider not selected"}${speechProvider?.sttModel ? ` · ${speechProvider.sttModel}` : ""}`;
  const cleanupDescription =
    settings.cleanup.mode === "off"
      ? "Off · raw transcript"
      : localCleanup
        ? `${modelName(settings.cleanup.modelId)} · ${settings.cleanup.device === "auto" ? "Automatic device" : settings.cleanup.device === "cpu" ? "CPU" : "Vulkan GPU"}`
        : `${cleanupProvider?.name || "Provider not selected"}${cleanupProvider?.model ? ` · ${cleanupProvider.model}` : ""}`;
  return (
    <div className={`app-shell${sidebarCollapsed ? " sidebar-collapsed" : ""}`}>
      <aside
        className="sidebar"
        id="main-sidebar"
        onScroll={() => setRailTooltip(null)}
        onTransitionEnd={(event) => {
          if (
            event.target !== event.currentTarget ||
            event.propertyName !== "width" ||
            !sidebarCollapsed
          )
            return;
          const focused = document.activeElement;
          const hovered =
            event.currentTarget.querySelector<HTMLButtonElement>(
              "button:hover",
            );
          if (hovered) showSidebarHint(hovered);
          else if (
            focused instanceof HTMLButtonElement &&
            event.currentTarget.contains(focused)
          )
            showSidebarHint(focused);
        }}
      >
        <button
          {...sidebarHint("CridVoice overview")}
          className="brand"
          aria-label="CridVoice overview"
          onClick={activateBrand}
        >
          <BrandLockup />
          <BrandMark size={28} />
        </button>
        <button
          {...sidebarHint("Find a page")}
          className="sidebar-search"
          aria-label="Find a page"
          onClick={() => {
            setRailTooltip(null);
            setSearchOpen(true);
          }}
        >
          <Search size={16} />
          <span>Find a page</span>
          <kbd>Ctrl K</kbd>
        </button>
        <div className="nav-label">Dictation</div>
        <nav aria-label="Main navigation">
          {navigation.slice(0, 4).map((n) => (
            <button
              {...sidebarHint(n.label)}
              key={n.id}
              className={page === n.id ? "active" : ""}
              aria-current={page === n.id ? "page" : undefined}
              aria-label={n.label}
              onClick={() => navigateSidebar(n.id)}
            >
              <n.icon size={18} />
              <span className="nav-text">{n.label}</span>
              {n.id === "history" && snapshot.history.length > 0 && (
                <span className="nav-count">{snapshot.history.length}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="nav-label">Configuration</div>
        <nav aria-label="Configuration">
          {navigation.slice(4).map((n) => (
            <button
              {...sidebarHint(n.label)}
              key={n.id}
              className={page === n.id ? "active" : ""}
              aria-current={page === n.id ? "page" : undefined}
              aria-label={n.label}
              onClick={() => navigateSidebar(n.id)}
            >
              <n.icon size={18} />
              <span className="nav-text">{n.label}</span>
              {n.id === "models" && activeDownloads > 0 && (
                <span className="nav-count">{activeDownloads}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom sidebar-footer">
          <button
            {...sidebarHint("About CridVoice")}
            className="sidebar-about"
            aria-label="About CridVoice"
            onClick={() => {
              setRailTooltip(null);
              setHelp(true);
            }}
          >
            <CircleHelp size={16} />
            <span>About CridVoice</span>
          </button>
          <span className="sidebar-version">
            Version {snapshot.version} ·{" "}
            {snapshot.portable ? "Portable" : "Installed"}
          </span>
        </div>
      </aside>
      {sidebarCollapsed && railTooltip && !setup && !help && !searchOpen && (
        <span
          id="sidebar-tooltip"
          className="sidebar-tooltip"
          role="tooltip"
          style={{ top: railTooltip.top }}
        >
          {railTooltip.label}
        </span>
      )}
      <div className="main-shell">
        <WindowTitlebar
          onError={(message) => notify(message, true)}
          actions={
            <button
              className="icon-button"
              aria-label="Help and shortcuts"
              onClick={() => setHelp(true)}
            >
              <CircleHelp size={18} />
            </button>
          }
        >
          <div className="breadcrumb">
            {sidebarToggle}
            <strong>{navigation.find((n) => n.id === page)?.label}</strong>
          </div>
          <ProcessingStatus
            settings={settings}
            saving={saving}
            saveFailed={saveFailed}
            openSettings={openProcessingSettings}
          />
        </WindowTitlebar>
        {!desktop && (
          <div className="preview-banner">
            <Monitor size={14} />
            Browser preview · microphone capture and Windows integration run in
            the desktop app.
          </div>
        )}
        <main
          className={`main-content${page === "overview" ? " overview-page" : ""}`}
        >
          <div className="page-heading">
            <div>
              <h1>{pageInfo[page].title}</h1>
              <p>{pageInfo[page].description}</p>
            </div>
            {page === "overview" && (
              <button
                className="button secondary small"
                onClick={() => setHelp(true)}
              >
                <Keyboard size={15} />
                Shortcuts
              </button>
            )}
            {page === "settings" && (
              <button
                className="button secondary small"
                disabled={busy || saving}
                onClick={() => {
                  setSetupRepair(true);
                  setSetup(true);
                }}
              >
                <DownloadIcon /> Run setup wizard
              </button>
            )}
          </div>
          {session.error && (
            <div className="error-banner" role="alert">
              <ShieldCheck size={19} />
              <p>{session.error}</p>
              <button
                className="icon-button"
                aria-label="Dismiss error"
                onClick={() =>
                  setSession({ ...session, error: "", status: "idle" })
                }
              >
                <X size={16} />
              </button>
            </div>
          )}
          {page === "overview" ? (
            <>
              <section
                className="panel dictation-panel"
                aria-label="Dictation controls"
              >
                <div className="dictation-panel-heading">
                  <h2>Dictation</h2>
                  <span
                    className="dictation-state"
                    role="status"
                    aria-label="Dictation status"
                    data-state={
                      recording || busy || session.status === "error"
                        ? session.status
                        : !modelReady
                          ? "setup-required"
                          : warming
                            ? "warming"
                            : loadFailed
                              ? "load-error"
                              : "ready"
                    }
                  >
                    {dictationStatus}
                  </span>
                </div>
                <p className="dictation-instructions">
                  {recording
                    ? session.outputMode === "generate"
                      ? "Release either key to finish. Generated output opens here for review."
                      : "Release either key to finish, then release both to insert."
                    : busy
                      ? session.outputMode === "generate"
                        ? "Processing your request for review and copying. Escape cancels processing."
                        : "Keep the original text field focused. Escape cancels processing."
                      : "Test recognition here, or use the shortcut to dictate into another application."}
                </p>
                {modelReady && localModels.length > 0 && (
                  <p
                    className="processing-note"
                    role="status"
                    aria-label="Local model readiness"
                  >
                    {warming
                      ? `Warming ${localModels
                          .filter((model) => model.state === "loading")
                          .map((model) => modelName(model.modelId))
                          .join(
                            " and ",
                          )}. You can record while local models prepare.`
                      : loadFailed
                        ? "A selected local model could not be loaded. Retry loading in Local models, or check its model and runtime."
                        : localModels.every((model) => model.state === "loaded")
                          ? "Selected local models are loaded and ready."
                          : localModels.some(
                                (model) => model.state === "unavailable",
                              )
                            ? "Live model status is available in the Windows desktop app."
                            : "Selected local models are unloaded. Your next dictation will load them, or load them in Local models."}
                  </p>
                )}
                <div className="dictation-shortcut">
                  <Keyboard size={16} />
                  <Shortcut value={settings.shortcuts.hold} />
                  <span>Hold to record · release to stop</span>
                </div>
                {settings.appearance.waveform && recording && (
                  <Waveform level={session.level} active={recording} />
                )}{" "}
                {settings.appearance.livePreview && recording && (
                  <TranscriptPreview
                    text={session.preview}
                    variant="overview"
                    emptyMessage={previewEmptyMessage}
                  />
                )}
                <CodingControls
                  settings={settings}
                  update={update}
                  disabled={busy || recording || saving}
                  onOpenSettings={() => setPage("settings")}
                  detectedLanguage={session.codingLanguage}
                  detectionActive={busy || recording}
                />
                <div className="dictation-controls">
                  <div className="dictation-language">
                    <span>Language</span>
                    <Select
                      label="Quick dictation language"
                      value={settings.transcription.language}
                      onChange={(v) =>
                        update({
                          transcription: {
                            ...settings.transcription,
                            language:
                              v as typeof settings.transcription.language,
                          },
                        })
                      }
                      options={languages}
                    />
                  </div>
                  <div className="dictation-actions">
                    <button
                      className={`button ${recording ? "danger" : "primary"}`}
                      disabled={busy || saving}
                      onClick={dictate}
                    >
                      {busy ? (
                        <Busy
                          label={
                            session.status === "cleaning"
                              ? "Cleaning"
                              : dictationStatus
                          }
                        />
                      ) : recording ? (
                        <>
                          <Square size={14} fill="currentColor" />
                          Stop recording
                        </>
                      ) : (
                        <>
                          <Mic size={16} />
                          Test dictation
                        </>
                      )}
                    </button>
                    {(recording || busy) && (
                      <button
                        className="button secondary"
                        onClick={() =>
                          void command("cancel_recording").catch((error) =>
                            notify(String(error), true),
                          )
                        }
                      >
                        Cancel
                      </button>
                    )}
                  </div>
                </div>
              </section>
              {!modelReady && (
                <button
                  className="setup-callout"
                  onClick={() => {
                    setSetupRepair(true);
                    setSetup(true);
                  }}
                >
                  <DownloadIcon />
                  <div>
                    <strong>Setup required</strong>
                    <span>
                      {setupPlan.missing.length > 0
                        ? `Missing: ${setupPlan.missing.map((model) => model.name).join(", ")}. Open the wizard to install everything required.`
                        : "Open the setup wizard to check your selected models, runtimes and providers."}
                    </span>
                  </div>
                  <ArrowRight size={18} />
                </button>
              )}
              {session.result && (
                <div className="result-card">
                  <div>
                    <strong>
                      {session.resultIsRaw
                        ? "Raw transcript"
                        : session.outputMode === "generate"
                          ? "Generated output"
                          : session.outputMode === "code"
                            ? "Dictated code or commands"
                            : "Latest transcript"}
                    </strong>
                    <button
                      className="button ghost small"
                      onClick={() => copy(session.result)}
                    >
                      <Copy size={14} />
                      Copy
                    </button>
                  </div>
                  {!session.resultIsRaw &&
                  (session.outputMode === "code" ||
                    session.outputMode === "generate") ? (
                    <>
                      <p className="result-language">
                        {session.codingLanguage || "Automatic"}
                      </p>
                      <pre
                        className="code-output"
                        aria-label="Code or command output"
                      >
                        {session.result}
                      </pre>
                      {session.reviewRequired && (
                        <p className="result-review-hint">
                          {session.outputMode === "generate"
                            ? "Generated output opens here for review and copying."
                            : "Multiline terminal output opens here for review and copying."}
                        </p>
                      )}
                    </>
                  ) : (
                    <p>{session.result}</p>
                  )}
                </div>
              )}
              <div className="stats-grid">
                <div className="stat-card">
                  <span>
                    <Activity size={15} />
                    Saved words
                  </span>
                  <strong>
                    {totalWords.toLocaleString()}
                    <small>words</small>
                  </strong>
                  <p>From saved transcripts</p>
                </div>
                <div className="stat-card">
                  <span>
                    <Clock3 size={15} />
                    Estimated time saved
                  </span>
                  <strong>
                    {minutesSaved}
                    <small>min</small>
                  </strong>
                  <p>Estimate versus typing at 40 wpm</p>
                </div>
                <div className="stat-card">
                  <span>
                    <HistoryIcon size={15} />
                    Saved transcripts
                  </span>
                  <strong>
                    {snapshot.history.length}
                    <small>dictations</small>
                  </strong>
                  <p>Local history entries</p>
                </div>
              </div>
              <div className="overview-bottom">
                <section className="panel recent-panel">
                  <div className="panel-heading">
                    <h3>Recent transcripts</h3>
                    <button
                      className="text-button"
                      onClick={() => setPage("history")}
                    >
                      View history
                      <ArrowRight size={14} />
                    </button>
                  </div>
                  {snapshot.history.slice(0, 3).map((h) => (
                    <div className="recent-row" key={h.id}>
                      <div className="square-icon">
                        <AudioLines size={17} />
                      </div>
                      <div>
                        <p>{h.text}</p>
                        <span>
                          {h.app || "Dictation"} ·{" "}
                          {new Date(h.createdAt).toLocaleTimeString(undefined, {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                      </div>
                      <button
                        className="icon-button"
                        aria-label="Copy recent transcript"
                        onClick={() => copy(h.text)}
                      >
                        <Copy size={14} />
                      </button>
                    </div>
                  ))}
                  {!snapshot.history.length && (
                    <Empty
                      icon={<AudioLines />}
                      title="No saved transcripts"
                      description={
                        settings.general.saveHistory
                          ? "Saved dictations will appear here."
                          : "History saving is off. Enable it in Settings to keep transcripts."
                      }
                    />
                  )}
                </section>
                <section className="panel processing-summary">
                  <div className="panel-heading">
                    <h3>Processing configuration</h3>
                    <button
                      className="text-button"
                      onClick={() => setPage("settings")}
                    >
                      Configure
                      <ArrowRight size={14} />
                    </button>
                  </div>
                  <dl className="processing-details">
                    <div>
                      <dt>Speech recognition</dt>
                      <dd>{speechDescription}</dd>
                    </div>
                    <div>
                      <dt>Text cleanup</dt>
                      <dd>{cleanupDescription}</dd>
                    </div>
                  </dl>
                  <p className="processing-note">
                    Speech and cleanup are configured independently.{" "}
                    <button
                      className="text-button"
                      onClick={() => setPage("models")}
                    >
                      View model status
                    </button>
                  </p>
                </section>
              </div>
            </>
          ) : page === "history" ? (
            <History {...props} />
          ) : page === "providers" ? (
            <Providers {...props} />
          ) : page === "models" ? (
            <Models {...props} downloads={downloads} />
          ) : page === "vocabulary" ? (
            <VocabularyPanel {...props} />
          ) : page === "styles" ? (
            <Styles {...props} />
          ) : page === "appearance" ? (
            <Appearance {...props} />
          ) : (
            <SettingsPanel {...props} controlsDisabled={busy || recording} />
          )}
          <footer className="content-footer">
            <span>No automatic cloud fallback</span>
            <span>
              CridVoice · {snapshot.portable ? "Portable" : "Desktop"} · v
              {snapshot.version}
            </span>
          </footer>
        </main>
      </div>
      {toast && (
        <div
          className={`toast ${toast.error ? "error" : ""}`}
          role={toast.error ? "alert" : "status"}
        >
          {toast.error ? <CircleHelp size={18} /> : <CheckCircle2 size={18} />}
          <span>{toast.message}</span>
          <button
            aria-label="Dismiss notification"
            onClick={() => setToast(null)}
          >
            <X size={15} />
          </button>
        </div>
      )}
      {setup && (
        <Onboarding
          snapshot={{ ...snapshot, settings }}
          downloads={downloads}
          repair={setupRepair}
          onClose={setupRepair ? () => setSetup(false) : undefined}
          onFinish={finish}
          notify={notify}
        />
      )}{" "}
      {help && (
        <Modal title="Help and shortcuts" onClose={() => setHelp(false)}>
          <p className="about-version">
            CridVoice {snapshot.version} ·{" "}
            {snapshot.portable ? "Portable" : "Installed"} · Windows 11
            dictation
          </p>
          <div className="help-shortcuts">
            {[
              {
                label: "Hold to dictate",
                value: settings.shortcuts.hold,
                description: "Hold both keys, speak, then release to insert.",
              },
              {
                label: "Toggle dictation",
                value: settings.shortcuts.toggle,
                description: "Press once to start and again to stop.",
              },
              {
                label: "Rewrite selected text",
                value: settings.shortcuts.rewrite,
                description:
                  "Select text, press to start, speak your change, then press again.",
              },
            ].map((k) => (
              <div key={k.label}>
                <span>
                  <strong>{k.label}</strong>
                  <small>{k.description}</small>
                </span>
                <Shortcut value={k.value} />
              </div>
            ))}
            <div>
              <span>
                <strong>Cancel recording</strong>
                <small>Discard the current recording.</small>
              </span>
              <kbd>Esc</kbd>
            </div>
          </div>
          <div className="notice">
            <ShieldCheck size={17} />
            <p>
              Keep the target text field focused while processing. If focus
              changes, CridVoice saves your words instead of inserting
              elsewhere.
            </p>
          </div>
          <div className="modal-footer">
            <button
              className="button ghost"
              onClick={() =>
                command("open_documentation").catch((e) =>
                  notify(String(e), true),
                )
              }
            >
              <BookOpen size={15} />
              Full documentation
            </button>
            <button
              className="button secondary"
              onClick={() => {
                setHelp(false);
                setPage("settings");
              }}
            >
              Customize shortcuts
            </button>
            <button className="button primary" onClick={() => setHelp(false)}>
              Close
            </button>
          </div>
        </Modal>
      )}{" "}
      {searchOpen && (
        <Modal title="Find a page" onClose={() => setSearchOpen(false)}>
          <div className="search-input command-search">
            <Search size={18} />
            <input
              autoFocus
              aria-label="Find a page"
              placeholder="Search pages and settings…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="command-results">
            {navigation
              .filter((n) => matchesPage(n, search))
              .map((n) => (
                <button
                  key={n.id}
                  onClick={() => {
                    setPage(n.id);
                    setSearchOpen(false);
                    setSearch("");
                  }}
                >
                  <n.icon size={18} />
                  <span>
                    {n.label}
                    <small>{pageInfo[n.id].description}</small>
                  </span>
                  <ArrowRight size={15} />
                </button>
              ))}
            {!navigation.some((n) => matchesPage(n, search)) && (
              <p className="helper" role="status">
                No matching page. Try microphone, shortcuts, theme or models.
              </p>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
function DownloadIcon() {
  return (
    <span className="square-icon">
      <Cpu size={19} />
    </span>
  );
}
