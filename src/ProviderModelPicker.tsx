import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import type { Provider } from "./types";

export interface ModelDiscoveryRequest {
  provider: Provider;
  key?: string;
  useSavedKey: boolean;
}
export interface ProviderModelField {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
}
interface Props {
  provider: Provider;
  apiKey?: string;
  useSavedKey?: boolean;
  fields: ProviderModelField[];
  fetchModels: (request: ModelDiscoveryRequest) => Promise<string[]>;
  disabled?: boolean;
}

export default function ProviderModelPicker({
  provider,
  apiKey = "",
  useSavedKey = provider.hasKey,
  fields,
  fetchModels,
  disabled = false,
}: Props) {
  const [models, setModels] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [custom, setCustom] = useState<Record<string, boolean>>({});
  const current = {
    id: provider.id,
    protocol: provider.protocol,
    baseUrl: provider.baseUrl,
    apiKey,
    useSavedKey,
  };
  const latest = useRef(current);
  latest.current = current;
  const mounted = useRef(true);
  const request = useRef<object | null>(null);
  const same = (captured: typeof current) =>
    Object.keys(captured).every(
      (name) =>
        captured[name as keyof typeof current] ===
        latest.current[name as keyof typeof current],
    );
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      request.current = null;
    };
  }, []);
  useEffect(() => {
    request.current = null;
    setModels([]);
    setLoading(false);
    setError("");
  }, [provider.id, provider.protocol, provider.baseUrl, apiKey, useSavedKey]);
  useEffect(() => setCustom({}), [provider.id]);

  async function fetch() {
    if (disabled || request.current) return;
    const token = {};
    const captured = current;
    request.current = token;
    setLoading(true);
    setError("");
    try {
      const values = await fetchModels({
        provider: { ...provider },
        key: apiKey || undefined,
        useSavedKey,
      });
      if (!mounted.current || request.current !== token || !same(captured))
        return;
      const ids = [
        ...new Set(
          values.filter(
            (value) =>
              typeof value === "string" &&
              value.trim() &&
              value.length <= 512 &&
              !/[\u0000-\u001f\u007f]/.test(value),
          ),
        ),
      ].sort();
      setModels(ids);
      if (!ids.length)
        setError(
          "No model IDs were returned. Enter a custom model ID instead.",
        );
    } catch {
      if (!mounted.current || request.current !== token || !same(captured))
        return;
      setError(
        "Could not fetch models. Check the address and credentials, then retry or enter a custom model ID.",
      );
    } finally {
      if (mounted.current && request.current === token && same(captured)) {
        request.current = null;
        setLoading(false);
      }
    }
  }

  return (
    <div className="provider-model-picker">
      <div className="provider-model-actions">
        <button
          type="button"
          className="button secondary small"
          disabled={disabled || loading}
          onClick={() => void fetch()}
        >
          {loading ? "Fetching models…" : "Fetch models"}
        </button>
        {loading && <span role="status">Requesting model IDs…</span>}
        {!loading && models.length > 0 && (
          <span role="status">{models.length} model IDs returned</span>
        )}
      </div>
      <small>
        Model lists do not identify text or speech support. Choose a model
        supported by your provider.
      </small>
      {error && <p role="alert">{error}</p>}
      {fields.map((field) => {
        const manual = Boolean(custom[field.id]);
        const choices =
          field.value && !models.includes(field.value)
            ? [field.value, ...models]
            : models;
        return (
          <div className="field" key={field.id}>
            <label>
              <span>{field.label}</span>
              <span className="select-wrap">
                <select
                  aria-label={field.label}
                  disabled={disabled}
                  value={
                    manual
                      ? "custom"
                      : field.value
                        ? `model:${field.value}`
                        : ""
                  }
                  onChange={(event) => {
                    const value = event.target.value;
                    setCustom((previous) => ({
                      ...previous,
                      [field.id]: value === "custom",
                    }));
                    if (value.startsWith("model:"))
                      field.onChange(value.slice(6));
                    else if (value === "") field.onChange("");
                  }}
                >
                  <option value="">Not selected</option>
                  {choices.map((id) => (
                    <option key={id} value={`model:${id}`}>
                      {id}
                      {!models.includes(id) ? " (current)" : ""}
                    </option>
                  ))}
                  <option value="custom">Enter a custom model ID</option>
                </select>
                <ChevronDown size={14} />
              </span>
            </label>
            {manual && (
              <input
                aria-label={`Custom ${field.label.toLowerCase()}`}
                value={field.value}
                maxLength={512}
                disabled={disabled}
                placeholder="Exact model ID from your provider"
                onChange={(event) =>
                  field.onChange(event.target.value.replace(/[\r\n]/g, ""))
                }
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
