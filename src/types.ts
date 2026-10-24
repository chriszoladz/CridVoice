export type Page =
  | "overview"
  | "history"
  | "providers"
  | "models"
  | "vocabulary"
  | "styles"
  | "appearance"
  | "settings";
export type Device = "auto" | "cpu" | "cuda";
export type Language = "auto" | "en" | "pl";
export type OutputMode = "text" | "code" | "generate";
export type RewriteStrength = "light" | "balanced" | "thorough";
export interface Provider {
  id: string;
  name: string;
  protocol: "openai" | "anthropic";
  baseUrl: string;
  model: string;
  sttModel: string;
  hasKey: boolean;
}
export interface Vocabulary {
  word: string;
  aliases: string[];
}
export interface AppRule {
  app: string;
  style: string;
  customPrompt: string;
}
export interface Settings {
  setupComplete: boolean;
  transcription: {
    mode: "local" | "openai";
    modelId: string;
    device: Device;
    language: Language;
    providerId: string;
  };
  cleanup: {
    mode: "managed" | "provider" | "off";
    modelId: string;
    device: Device;
    providerId: string;
    style: string;
    rewriteStrength: RewriteStrength;
    outputMode: OutputMode;
    codeLanguage: string;
  };
  providers: Provider[];
  vocabulary: Vocabulary[];
  appRules: AppRule[];
  appearance: {
    theme: string;
    mode: "dark" | "light" | "system";
    accent: string;
    fontScale: number;
    overlayVisible: boolean;
    waveform: boolean;
    livePreview: boolean;
  };
  shortcuts: { hold: string; toggle: string; rewrite: string };
  general: {
    insertionMethod: "clipboard" | "unicode";
    copyDictationToClipboard: boolean;
    startup: boolean;
    saveHistory: boolean;
    context: boolean;
    microphone: string;
    duckBackgroundAudio: boolean;
    duckingReductionPercent: number;
    maxRecordingSeconds: number;
    historyDays: number;
  };
}
export type SettingsUpdate =
  Partial<Settings> | ((current: Settings) => Partial<Settings>);
export interface HistoryEntry {
  id: string;
  createdAt: string;
  rawText: string;
  text: string;
  language: string;
  app: string;
  durationSeconds: number;
  wordCount: number;
  mode: string;
  inserted: boolean;
}
export interface Hardware {
  cpu: string;
  ramGb: number;
  gpus: { name: string; vramMb: number }[];
  cudaAvailable: boolean;
  threads: number;
}
export interface ModelFile {
  url: string;
  name: string;
  sha256: string;
  bytes: number;
}
export interface ModelInfo {
  id: string;
  name: string;
  kind: "speech" | "preview" | "cleanup" | "runtime";
  description: string;
  sizeBytes: number;
  license: string;
  files: ModelFile[];
  installed: boolean;
}
export interface Session {
  status:
    | "idle"
    | "loading"
    | "recording"
    | "transcribing"
    | "cleaning"
    | "inserting"
    | "error";
  preview: string;
  level: number;
  startedAt: number | null;
  error: string;
  result: string;
  app: string;
  outputMode?: OutputMode;
  codingLanguage?: string | null;
  reviewRequired?: boolean;
  resultIsRaw?: boolean;
}
export interface Snapshot {
  settings: Settings;
  session?: Session;
  history: HistoryEntry[];
  hardware: Hardware;
  models: ModelInfo[];
  activeDownloads?: Record<string, DownloadProgress>;
  engineStatus?: {
    speech: EngineStatus;
    preview?: EngineStatus;
    cleanup: EngineStatus;
  };
  version: string;
  portable: boolean;
  dataDir: string;
}
export interface EngineStatus {
  modelId: string | null;
  device: string | null;
  state: "unloaded" | "loading" | "loaded" | "error";
}
export interface DownloadProgress {
  id: string;
  completed: number;
  total: number;
  state:
    | "queued"
    | "downloading"
    | "verifying"
    | "extracting"
    | "complete"
    | "error"
    | "cancelled";
  stageCompleted?: number;
  stageTotal?: number;
  error?: string;
}
export const defaultSettings: Settings = {
  setupComplete: false,
  transcription: {
    mode: "local",
    modelId: "whisper-turbo",
    device: "auto",
    language: "auto",
    providerId: "",
  },
  cleanup: {
    mode: "managed",
    modelId: "qwen3-4b",
    device: "auto",
    providerId: "",
    style: "faithful",
    rewriteStrength: "balanced",
    outputMode: "text",
    codeLanguage: "",
  },
  providers: [],
  vocabulary: [],
  appRules: [],
  appearance: {
    theme: "violet",
    mode: "dark",
    accent: "#a78bfa",
    fontScale: 1,
    overlayVisible: true,
    waveform: true,
    livePreview: true,
  },
  shortcuts: {
    hold: "Ctrl+Super",
    toggle: "Ctrl+Shift+Space",
    rewrite: "Ctrl+Alt+R",
  },
  general: {
    insertionMethod: "clipboard",
    copyDictationToClipboard: false,
    startup: false,
    saveHistory: true,
    context: true,
    microphone: "",
    duckBackgroundAudio: false,
    duckingReductionPercent: 60,
    maxRecordingSeconds: 300,
    historyDays: 0,
  },
};
export const emptySession: Session = {
  status: "idle",
  preview: "",
  level: 0,
  startedAt: null,
  error: "",
  result: "",
  app: "",
};
