import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Toggle, Select, languages } from "../ui";
import { defaultSettings } from "../types";
import { themes } from "../themes";
afterEach(cleanup);
describe("User controls", () => {
  it("shows a switch state and sends the actual changed value", () => {
    const change = vi.fn();
    render(<Toggle label="Save history" checked onChange={change} />);
    const toggle = screen.getByRole("switch", { name: "Save history" });
    expect(toggle).toHaveAttribute("aria-checked", "true");
    fireEvent.click(toggle);
    expect(change).toHaveBeenCalledWith(false);
  });
  it("allows an explicit Polish override", () => {
    const change = vi.fn();
    render(
      <Select
        label="Dictation language"
        value="auto"
        onChange={change}
        options={languages}
      />,
    );
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "pl" } });
    expect(change).toHaveBeenCalledWith("pl");
  });
  it("keeps cloud opt-in and history local in the initial configuration", () => {
    expect(defaultSettings.transcription.mode).toBe("local");
    expect(defaultSettings.cleanup.mode).toBe("managed");
    expect(defaultSettings.providers).toEqual([]);
    expect(defaultSettings.general.saveHistory).toBe(true);
    expect(defaultSettings.shortcuts.hold).toBe("Ctrl+Super");
  });
  it("can disable waveform and preview independently", () => {
    const s = structuredClone(defaultSettings);
    s.appearance.waveform = false;
    expect(s.appearance.livePreview).toBe(true);
    s.appearance.livePreview = false;
    expect(s.appearance.overlayVisible).toBe(true);
  });
  it("includes eight distinct presets with valid accent colors", () => {
    expect(new Set(themes.map((t) => t.id)).size).toBe(8);
    for (const theme of themes) expect(theme.accent).toMatch(/^#[0-9a-f]{6}$/i);
  });
});
