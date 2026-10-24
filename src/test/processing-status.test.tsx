import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import ProcessingStatus, { processingRoute } from "../ProcessingStatus";
import { defaultSettings } from "../types";

afterEach(cleanup);

it("describes configured speech and cleanup routes without treating providers as local or connected", () => {
  for (const [speech, cleanupMode, label, detail] of [
    [
      "local",
      "managed",
      "Local processing",
      "Speech: Local model. Cleanup: Local model.",
    ],
    [
      "local",
      "provider",
      "Mixed processing",
      "Speech: Local model. Cleanup: Provider (Local endpoint).",
    ],
    [
      "openai",
      "managed",
      "Mixed processing",
      "Speech: Provider (Local endpoint). Cleanup: Local model.",
    ],
    [
      "openai",
      "provider",
      "Provider processing",
      "Speech: Provider (Local endpoint). Cleanup: Provider (Local endpoint).",
    ],
    ["local", "off", "Local speech", "Speech: Local model. Cleanup: Off."],
    [
      "openai",
      "off",
      "Provider speech",
      "Speech: Provider (Local endpoint). Cleanup: Off.",
    ],
  ] as const) {
    const settings = structuredClone(defaultSettings);
    settings.transcription.mode = speech;
    settings.cleanup.mode = cleanupMode;
    settings.transcription.providerId = settings.cleanup.providerId =
      "local-endpoint";
    settings.providers = [
      {
        id: "local-endpoint",
        name: "Local endpoint",
        baseUrl: "http://localhost:1234/v1",
        protocol: "openai",
        model: "fixture",
        sttModel: "fixture",
        hasKey: false,
      },
    ];
    expect(processingRoute(settings)).toEqual({ label, detail });
  }
  const unconfigured = structuredClone(defaultSettings);
  unconfigured.cleanup.mode = "provider";
  expect(processingRoute(unconfigured).detail).toContain(
    "Provider (not selected)",
  );
});

it("keeps source details accessible and opens settings without changing processing settings", () => {
  const settings = structuredClone(defaultSettings);
  const original = structuredClone(settings);
  const openSettings = vi.fn();
  render(
    <ProcessingStatus
      settings={settings}
      saving={false}
      saveFailed={false}
      openSettings={openSettings}
    />,
  );
  const button = screen.getByRole("button", {
    name: /Local processing\. Speech: Local model\. Cleanup: Local model\. Open processing settings/,
  });
  expect(button.title).toBe(
    "Speech: Local model. Cleanup: Local model. Open processing settings.",
  );
  fireEvent.click(button);
  expect(openSettings).toHaveBeenCalledTimes(1);
  expect(settings).toEqual(original);
});

it("reports saving, failed and saved states accurately while newer saves are pending", () => {
  const props = { settings: defaultSettings, openSettings: vi.fn() };
  const view = render(
    <ProcessingStatus {...props} saving={false} saveFailed={false} />,
  );
  expect(
    screen.getByRole("status", { name: "Saved locally" }),
  ).toHaveTextContent("Saved locally");
  view.rerender(
    <ProcessingStatus {...props} saving={true} saveFailed={true} />,
  );
  expect(screen.getByRole("status", { name: "Saving" })).toHaveTextContent(
    "Saving",
  );
  expect(screen.queryByText("Save failed")).not.toBeInTheDocument();
  view.rerender(
    <ProcessingStatus {...props} saving={false} saveFailed={true} />,
  );
  expect(screen.getByRole("status", { name: "Save failed" }).title).toContain(
    "Previous saved settings are active",
  );
  view.rerender(
    <ProcessingStatus {...props} saving={false} saveFailed={false} />,
  );
  expect(screen.getByText("Saved locally")).toBeVisible();
});
