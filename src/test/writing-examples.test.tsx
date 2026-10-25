import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { command } from "../bridge";
import { Styles } from "../panels";
import { defaultSettings } from "../types";
import type { Settings, SettingsUpdate, Snapshot } from "../types";
import { writingStyles } from "../ui";
import {
  rewriteStrengths,
  writingExample,
  writingExampleInput,
  writingStyleDescription,
} from "../writingExamples";

vi.mock("../bridge", () => ({
  command: vi.fn(async () => []),
  warmSelectedModels: vi.fn(),
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function snapshot(settings: Settings): Snapshot {
  return {
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
}

describe("Local writing style illustrations", () => {
  it("preserves every point, uncertainty and corrected date across all style and strength illustrations", () => {
    const matrix = new Set<string>();
    for (const strength of rewriteStrengths) {
      const outputs = new Set<string>();
      for (const style of writingStyles) {
        const example = writingExample(style.value, strength.value);
        expect(example.input).toBe(writingExampleInput);
        expect(example.output).toMatch(
          /[Ss]ign-in fix in auth\.ts (?:is )?ready/,
        );
        expect(example.output).toMatch(
          /I (?:haven’t|have not) (?:tested mobile|tried it on mobile) yet/,
        );
        expect(example.output).toContain("Thursday around two");
        expect(example.output).toMatch(
          /(?:not (?:promising|committing)|[Nn]o promise|not promised)/,
        );
        expect(example.output).toMatch(/(?:ship|shipping)/i);
        expect(example.output).toMatch(
          /Maya’s approval (?:is )?still needed|still need Maya’s approval/,
        );
        expect(example.output).not.toMatch(
          /Friday|at two|\b(?:AM|PM|a\.m\.|p\.m\.)\b|auth\.js/,
        );
        outputs.add(example.output);
        matrix.add(example.output);
      }
      expect(outputs.size).toBe(writingStyles.length);
      expect(
        writingExample("concise", strength.value).output.length,
      ).toBeLessThan(writingExample("faithful", strength.value).output.length);
    }
    expect(matrix.size).toBe(writingStyles.length * rewriteStrengths.length);
  });

  it("keeps the legacy technical style as identifier-preserving prose, with meaningful newlines", () => {
    const example = writingExample("code");
    expect(example.output).toContain("auth.ts");
    expect(example.output).toContain("\n\n");
    expect(example.output).not.toContain("```");
    expect(example.output).not.toMatch(/git |def |const /);
    expect(writingExample("unknown")).toEqual(writingExample("faithful"));
    expect(writingExample("faithful", "unknown")).toEqual(
      writingExample("faithful", "balanced"),
    );
    for (const style of writingStyles) {
      expect(writingExample(style.value, "light").output).not.toContain("\n\n");
      expect(
        writingExample(style.value, "balanced").output.split("\n\n"),
      ).toHaveLength(2);
      expect(
        writingExample(style.value, "thorough").output.split("\n\n"),
      ).toHaveLength(3);
    }
  });

  it("updates the visible example with the chosen default style and only changes that setting", () => {
    let current = structuredClone(defaultSettings);
    const updates = vi.fn();
    function Harness() {
      const [settings, setSettings] = useState(current);
      async function update(patch: SettingsUpdate) {
        updates(patch);
        current = {
          ...current,
          ...(typeof patch === "function" ? patch(current) : patch),
        };
        setSettings(current);
      }
      return (
        <Styles
          settings={settings}
          snapshot={snapshot(settings)}
          update={update}
          refresh={vi.fn(async () => {})}
          notify={vi.fn()}
        />
      );
    }
    render(<Harness />);
    expect(screen.getByText(/Style example · Natural/)).toBeVisible();
    expect(
      screen.getByText("Illustrative result. Exact AI wording may vary."),
    ).toBeVisible();
    for (const style of writingStyles) {
      fireEvent.change(
        screen.getByRole("combobox", { name: "Default writing style" }),
        { target: { value: style.value } },
      );
      expect(
        screen.getByLabelText("Writing style example output").textContent,
      ).toBe(writingExample(style.value).output);
      expect(
        screen.getByText(writingStyleDescription(style.value)),
      ).toBeVisible();
      expect(current).toEqual({
        ...defaultSettings,
        cleanup: { ...defaultSettings.cleanup, style: style.value },
      });
    }
    expect(updates).toHaveBeenCalledTimes(writingStyles.length);
    expect(
      vi
        .mocked(command)
        .mock.calls.every(([name]) => name === "running_applications"),
    ).toBe(true);
    expect(screen.getByText(/Technical is a Text writing style/)).toBeVisible();
  });

  it("updates rewrite strength and its illustration while preserving the latest tone, model and mode", () => {
    let current = structuredClone(defaultSettings);
    const updates = vi.fn();
    function Harness() {
      const [settings, setSettings] = useState(current);
      async function update(patch: SettingsUpdate) {
        updates(patch);
        current = {
          ...current,
          ...(typeof patch === "function" ? patch(current) : patch),
        };
        setSettings(current);
      }
      return (
        <Styles
          settings={settings}
          snapshot={snapshot(settings)}
          update={update}
          refresh={vi.fn(async () => {})}
          notify={vi.fn()}
        />
      );
    }
    render(<Harness />);
    expect(
      screen.getByRole("combobox", { name: "Rewrite strength" }),
    ).toHaveValue("balanced");
    // A newer backend selection arrives while the rendered control is older.
    current = {
      ...current,
      cleanup: { ...current.cleanup, modelId: "new-model", style: "casual" },
    };
    for (const strength of rewriteStrengths) {
      fireEvent.change(
        screen.getByRole("combobox", { name: "Rewrite strength" }),
        { target: { value: strength.value } },
      );
      expect(current.cleanup).toEqual({
        ...defaultSettings.cleanup,
        style: "casual",
        modelId: "new-model",
        rewriteStrength: strength.value,
      });
      expect(
        screen.getByLabelText("Writing style example output").textContent,
      ).toBe(writingExample("casual", strength.value).output);
      expect(screen.getByText(strength.description)).toBeVisible();
    }
    expect(updates).toHaveBeenCalledTimes(3);
  });

  it("explains when cleanup or the active output mode prevents writing styles from applying", () => {
    const settings = structuredClone(defaultSettings);
    settings.cleanup.mode = "off";
    const props = {
      settings,
      snapshot: snapshot(settings),
      update: vi.fn(async () => {}),
      refresh: vi.fn(async () => {}),
      notify: vi.fn(),
    };
    const view = render(<Styles {...props} />);
    expect(
      screen.getByText(
        /Text cleanup is off\. Enable cleanup to apply writing styles/,
      ),
    ).toBeVisible();
    for (const mode of ["code", "generate"] as const) {
      const next = {
        ...settings,
        cleanup: {
          ...settings.cleanup,
          mode: "managed" as const,
          outputMode: mode,
        },
      };
      view.rerender(
        <Styles {...props} settings={next} snapshot={snapshot(next)} />,
      );
      expect(
        screen.getByText(
          /Writing styles apply to Text output\. Your current code or generation mode/,
        ),
      ).toBeVisible();
      expect(
        screen.getByLabelText("Writing style example output"),
      ).toBeVisible();
    }
    expect(props.update).not.toHaveBeenCalled();
    expect(
      vi
        .mocked(command)
        .mock.calls.every(([name]) => name === "running_applications"),
    ).toBe(true);
  });
});
