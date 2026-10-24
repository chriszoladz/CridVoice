import { useEffect, useRef } from "react";
import type { ReactNode, RefObject } from "react";
import { ChevronDown, LoaderCircle, X } from "lucide-react";
export function Toggle({
  checked,
  onChange,
  label,
  description,
  disabled = false,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
}) {
  return (
    <label className="toggle-row">
      <span>
        <strong>{label}</strong>
        {description && <small>{description}</small>}
      </span>
      <button
        type="button"
        role="switch"
        aria-label={label}
        aria-checked={checked}
        disabled={disabled}
        className={`switch ${checked ? "on" : ""}`}
        onClick={() => onChange(!checked)}
      >
        <span />
      </button>
    </label>
  );
}
export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}
export function Select({
  value,
  onChange,
  options,
  label,
  disabled = false,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  label?: string;
  disabled?: boolean;
}) {
  return (
    <span className="select-wrap">
      <select
        disabled={disabled}
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown size={14} />
    </span>
  );
}
export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "green" | "violet" | "amber";
}) {
  return <span className={`badge ${tone}`}>{children}</span>;
}
export function Section({
  title,
  description,
  children,
  action,
  id,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  action?: ReactNode;
  id?: string;
}) {
  return (
    <section className="panel" id={id}>
      <div className="panel-heading">
        <div>
          <h3>{title}</h3>
          {description && <p>{description}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
export function Empty({
  icon,
  title,
  description,
  action,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">{icon}</div>
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}
let dialogScrollLocks = 0;
let previousDocumentOverflow = "";
export function useDialogFocus(
  ref: RefObject<HTMLDivElement | null>,
  {
    onEscape,
    restoreFocus = true,
    focusOnMount = true,
  }: {
    onEscape?: () => void;
    restoreFocus?: boolean;
    focusOnMount?: boolean;
  } = {},
) {
  const previous = useRef(document.activeElement as HTMLElement | null);
  const close = useRef(onEscape);
  close.current = onEscape;
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const root: HTMLDivElement = element;
    if (dialogScrollLocks++ === 0) {
      previousDocumentOverflow = document.documentElement.style.overflow;
      document.documentElement.style.overflow = "hidden";
    }
    const items = () =>
      Array.from(
        root.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]',
        ),
      );
    if (focusOnMount && !root.contains(document.activeElement))
      (root.querySelector<HTMLElement>("[autofocus]") || items()[0])?.focus();
    function trap(e: KeyboardEvent) {
      const dialogs = document.querySelectorAll(
        '[role="dialog"][aria-modal="true"]',
      );
      if (!root.isConnected || dialogs[dialogs.length - 1] !== root) return;
      if (e.key === "Escape" && close.current) {
        e.preventDefault();
        e.stopImmediatePropagation();
        close.current();
        return;
      }
      if (e.key !== "Tab") return;
      const focusable = items(),
        first = focusable[0],
        last = focusable[focusable.length - 1];
      if (
        !root.contains(document.activeElement) ||
        !focusable.includes(document.activeElement as HTMLElement)
      ) {
        e.preventDefault();
        (e.shiftKey ? last : first)?.focus();
        return;
      }
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    }
    document.addEventListener("keydown", trap, true);
    return () => {
      document.removeEventListener("keydown", trap, true);
      if (--dialogScrollLocks === 0)
        document.documentElement.style.overflow = previousDocumentOverflow;
      if (restoreFocus && !root.isConnected && previous.current?.isConnected)
        previous.current.focus({ preventScroll: true });
    };
  }, [ref, restoreFocus, focusOnMount]);
}
export function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useDialogFocus(ref, { onEscape: onClose });
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        className={`modal ${wide ? "wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="modal-heading">
          <h2>{title}</h2>
          <button
            className="icon-button"
            aria-label="Close dialog"
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
export function Busy({ label = "Working…" }: { label?: string }) {
  return (
    <span className="inline">
      <LoaderCircle size={15} className="spin" />
      {label}
    </span>
  );
}
export function Shortcut({ value }: { value: string }) {
  const keys = value.split("+");
  return (
    <span className="shortcut">
      {keys.map((k, i) => (
        <span key={i}>
          <kbd>{k === "Super" ? "Win" : k}</kbd>
          {i < keys.length - 1 && <i>+</i>}
        </span>
      ))}
    </span>
  );
}
export function Waveform({
  level = 0,
  active = false,
}: {
  level?: number;
  active?: boolean;
}) {
  return (
    <div className={`waveform ${active ? "active" : ""}`} aria-hidden="true">
      {Array.from({ length: 45 }, (_, i) => (
        <span
          key={i}
          style={{
            height: `${active ? 6 + Math.sin(i * 1.7) ** 2 * Math.max(8, level * 400) : 5 + Math.sin(i * 0.42) ** 2 * 16}px`,
            animationDelay: `${i * -0.09}s`,
          }}
        />
      ))}
    </div>
  );
}
export const devices = [
  { value: "auto", label: "Automatic · prefer NVIDIA GPU" },
  { value: "cuda", label: "NVIDIA GPU" },
  { value: "cpu", label: "CPU · Intel / AMD" },
];
export const cleanupDevices = devices.map((device) =>
  device.value === "cuda" ? { ...device, label: "GPU · Vulkan" } : device,
);
export const languages = [
  { value: "auto", label: "Automatic · English + Polish" },
  { value: "en", label: "English" },
  { value: "pl", label: "Polski" },
];
export const writingStyles = [
  { value: "faithful", label: "Natural · preserve my voice" },
  { value: "professional", label: "Professional" },
  { value: "casual", label: "Casual" },
  { value: "concise", label: "Concise" },
  { value: "code", label: "Code & technical" },
];
export const bytes = (n: number) =>
  n >= 1e9
    ? `${(n / 1e9).toFixed(1)} GB`
    : `${Math.max(1, Math.round(n / 1e6))} MB`;
