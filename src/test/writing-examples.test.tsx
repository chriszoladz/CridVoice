import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { command } from "../bridge";
import { Styles } from "../panels";
import { defaultSettings } from "../types";
import type { Settings, SettingsUpdate, Snapshot } from "../types";
import { writingStyles } from "../ui";
import { writingExample, writingExampleInput } from "../writingExamples";

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
  it("covers every available style using the same input without changing facts or identifier case", () => {
    const outputs = new Set<string>();
    for (const style of writingStyles) {
      const example = writingExample(style.value);
      expect(example.input).toBe(writingExampleInput);
      for (const fact of [
        "Wednesday",
        "around three",
        "CridVoice",
        "dryRun",
        "false",
      ])
        expect(example.output).toContain(fact);
      expect(example.output).not.toMatch(
        /Tuesday|\b(?:AM|PM|a\.m\.|p\.m\.)\b|at three|dryrun|DryRun/,
      );
      expect(example.output).toMatch(/(?:[Dd]on’t|not) set dryRun to false/);
      outputs.add(example.output);
    }
    expect(outputs.size).toBe(writingStyles.length);
    expect(writingExample("concise").output.length).toBeLessThan(
      writingExample("faithful").output.length,
    );
  });

  it("keeps the legacy technical style as identifier-preserving prose, with meaningful newlines", () => {
    const example = writingExample("code");
    expect(example.output).toContain(
      "dryRun flag.\nDo not set dryRun to false.",
    );
    expect(example.output).not.toContain("```");
    expect(example.output).not.toMatch(/git |def |const /);
    expect(writingExample("unknown")).toEqual(writingExample("faithful"));
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
    expect(
      screen.getByText(/Code & technical is a Text writing style/),
    ).toBeVisible();
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
