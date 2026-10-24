import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Appearance } from "../panels";
import {
  applyAppearance,
  colorContrast,
  resolveAppearance,
  themes,
} from "../themes";
import { defaultSettings } from "../types";
import type { Settings, SettingsUpdate, Snapshot } from "../types";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function panelProps(
  settings: Settings,
  update: (patch: SettingsUpdate) => Promise<void>,
) {
  const snapshot: Snapshot = {
    settings,
    history: [],
    models: [],
    hardware: {
      cpu: "Fixture",
      ramGb: 16,
      gpus: [],
      cudaAvailable: false,
      threads: 4,
    },
    version: "fixture",
    portable: false,
    dataDir: "fixture",
  };
  return {
    settings,
    snapshot,
    update,
    refresh: vi.fn(async () => {}),
    notify: vi.fn(),
  };
}

describe("Appearance palette and saved controls", () => {
  it("applies every preset to real surfaces and replaces the whole palette on a mode change", () => {
    const root = document.createElement("div");
    root.style.setProperty("--unrelated", "preserved");
    for (const mode of ["dark", "light"] as const) {
      const surfaces = new Set<string>();
      for (const preset of themes) {
        const appearance = {
          ...defaultSettings.appearance,
          mode,
          theme: preset.id,
          accent: preset.accent,
        };
        const palette = applyAppearance(root, appearance, false);
        expect(root.dataset.mode).toBe(mode);
        expect(palette.variables["--background"]).toBe(preset[mode]);
        for (const [key, value] of Object.entries(palette.variables))
          expect(root.style.getPropertyValue(key)).toBe(value);
        surfaces.add(palette.variables["--surface"]);
        expect(root.style.getPropertyValue("--unrelated")).toBe("preserved");
      }
      expect(surfaces.size).toBe(themes.length);
    }
    const fresh = resolveAppearance(defaultSettings.appearance, false);
    applyAppearance(root, defaultSettings.appearance, false);
    for (const [key, value] of Object.entries(fresh.variables))
      expect(root.style.getPropertyValue(key)).toBe(value);
  });

  it("preserves custom colors and text size while keeping accent text readable in both modes", () => {
    expect(colorContrast("#000000", "#ffffff")).toBeCloseTo(21);
    for (const mode of ["dark", "light"] as const) {
      for (const accent of ["#000000", "#ffffff", "#777777", "#123abc"]) {
        const appearance = {
          ...defaultSettings.appearance,
          theme: "forest",
          mode,
          accent,
          fontScale: 1.35,
        };
        const palette = resolveAppearance(appearance, false).variables;
        expect(palette["--accent"]).toBe(accent);
        expect(palette["--font-scale"]).toBe("1.35");
        expect(
          colorContrast(accent, palette["--accent-foreground"]),
        ).toBeGreaterThanOrEqual(4.5);
        for (const background of [
          "--background",
          "--surface",
          "--surface-raised",
          "--surface-hover",
        ])
          expect(
            colorContrast(palette["--accent-text"], palette[background]),
          ).toBeGreaterThanOrEqual(4.5);
        expect(appearance.accent).toBe(accent);
        expect(appearance.fontScale).toBe(1.35);
      }
    }
  });

  it("resolves System to either mode without changing the saved preference", () => {
    const appearance = {
      ...defaultSettings.appearance,
      mode: "system" as const,
      theme: "ocean",
    };
    expect(resolveAppearance(appearance, false).mode).toBe("light");
    expect(resolveAppearance(appearance, true).mode).toBe("dark");
    expect(appearance.mode).toBe("system");
  });

  it("merges rapid preset, mode, color, scale and overlay changes against the latest settings", async () => {
    const saved = structuredClone(defaultSettings);
    let current = structuredClone(saved);
    const update = vi.fn(async (patch: SettingsUpdate) => {
      current = {
        ...current,
        ...(typeof patch === "function" ? patch(current) : patch),
      };
    });
    render(<Appearance {...panelProps(saved, update)} />);
    fireEvent.click(screen.getByRole("button", { name: "Light" }));
    fireEvent.click(screen.getByRole("button", { name: /Ocean/ }));
    fireEvent.change(screen.getByLabelText("Text size"), {
      target: { value: "1.2" },
    });
    fireEvent.change(screen.getByLabelText("Accent color"), {
      target: { value: "#123456" },
    });
    fireEvent.click(screen.getByRole("switch", { name: "Audio waveform" }));
    await act(async () => {});
    expect(current.appearance).toEqual({
      ...saved.appearance,
      theme: "ocean",
      mode: "light",
      accent: "#123456",
      fontScale: 1.2,
      waveform: false,
    });
    expect(current.cleanup).toEqual(saved.cleanup);
    expect(current.transcription).toEqual(saved.transcription);
    expect(
      update.mock.calls.every(([patch]) => typeof patch === "function"),
    ).toBe(true);
  });

  it("shows System thumbnails from the live Windows color preference and removes the listener", () => {
    const listeners = new Set<() => void>();
    const media = {
      matches: false,
      addEventListener: vi.fn((_event: string, listener: () => void) =>
        listeners.add(listener),
      ),
      removeEventListener: vi.fn((_event: string, listener: () => void) =>
        listeners.delete(listener),
      ),
    };
    vi.stubGlobal("matchMedia", () => media);
    const settings = structuredClone(defaultSettings);
    settings.appearance.mode = "system";
    const { container, unmount } = render(
      <Appearance
        {...panelProps(
          settings,
          vi.fn(async () => {}),
        )}
      />,
    );
    const preview = container.querySelector<HTMLElement>(".theme-preview")!;
    expect(preview.style.background).toBe("rgb(248, 247, 252)");
    act(() => {
      media.matches = true;
      for (const listener of listeners) listener();
    });
    expect(preview.style.background).toBe("rgb(16, 16, 20)");
    expect(screen.getByRole("button", { name: "System" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    unmount();
    expect(listeners.size).toBe(0);
  });

  it("reports failed saves without losing the selected settings or rejecting an event handler", async () => {
    const settings = structuredClone(defaultSettings);
    render(
      <Appearance
        {...panelProps(
          settings,
          vi.fn(async () => {
            throw new Error("fixture failure");
          }),
        )}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Ocean/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Appearance changes could not be saved",
    );
    expect(settings.appearance).toEqual(defaultSettings.appearance);
  });
});
