import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import ProviderModelPicker from "../ProviderModelPicker";
import type { Provider } from "../types";

afterEach(cleanup);
const provider: Provider = {
  id: "fixture",
  name: "Fixture",
  protocol: "openai",
  baseUrl: "http://localhost:1234/v1",
  model: "saved-text",
  sttModel: "",
  hasKey: true,
};
function fields(onChange = vi.fn()) {
  return [
    { id: "text", label: "Text model", value: provider.model, onChange },
    { id: "speech", label: "Speech model", value: "", onChange },
  ];
}
function deferred() {
  let resolve!: (values: string[]) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<string[]>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

it("fetches only explicitly and shares unclassified returned IDs across text and speech choices", async () => {
  const changed = vi.fn();
  const fetchModels = vi.fn(async () => [
    "server/voice",
    "server/text",
    "server/voice",
  ]);
  render(
    <ProviderModelPicker
      provider={provider}
      fields={fields(changed)}
      apiKey="draft-key"
      fetchModels={fetchModels}
    />,
  );
  expect(fetchModels).not.toHaveBeenCalled();
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Fetch models" }));
  await screen.findByText("2 model IDs returned");
  expect(fetchModels).toHaveBeenCalledExactlyOnceWith({
    provider,
    key: "draft-key",
    useSavedKey: true,
  });
  expect(screen.getAllByRole("option", { name: "server/voice" })).toHaveLength(
    2,
  );
  fireEvent.change(screen.getByLabelText("Speech model"), {
    target: { value: "model:server/voice" },
  });
  expect(changed).toHaveBeenCalledWith("server/voice");
  expect(
    screen.getByText(/do not identify text or speech support/),
  ).toBeVisible();
});

it("requires an explicit custom fallback and preserves existing selections without pretending they were fetched", () => {
  const changed = vi.fn();
  render(
    <ProviderModelPicker
      provider={provider}
      fields={fields(changed)}
      fetchModels={vi.fn()}
    />,
  );
  expect(
    screen.getByRole("option", { name: "saved-text (current)" }),
  ).toBeVisible();
  fireEvent.change(screen.getByLabelText("Text model"), {
    target: { value: "custom" },
  });
  fireEvent.change(screen.getByLabelText("Custom text model"), {
    target: { value: "arbitrary/new-model" },
  });
  expect(changed).toHaveBeenCalledWith("arbitrary/new-model");
});

it("ignores stale results and stale errors after endpoint/key changes", async () => {
  const first = deferred(),
    second = deferred();
  const fetchModels = vi
    .fn()
    .mockReturnValueOnce(first.promise)
    .mockReturnValueOnce(second.promise);
  const view = render(
    <ProviderModelPicker
      provider={provider}
      fields={fields()}
      apiKey="first-key"
      fetchModels={fetchModels}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Fetch models" }));
  view.rerender(
    <ProviderModelPicker
      provider={{ ...provider, baseUrl: "http://localhost:5678/v1" }}
      fields={fields()}
      apiKey="second-key"
      fetchModels={fetchModels}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Fetch models" }));
  await act(async () => first.resolve(["stale-model"]));
  expect(
    screen.queryByRole("option", { name: "stale-model" }),
  ).not.toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Fetching models…" }),
  ).toBeDisabled();
  await act(async () => second.reject(new Error("HTTP 401")));
  expect(screen.getByRole("alert")).toHaveTextContent("Could not fetch models");
});

it("guards duplicate fetches, permits retry, and never displays a draft key echoed in an error", async () => {
  const pending = deferred();
  const fetchModels = vi
    .fn()
    .mockReturnValueOnce(pending.promise)
    .mockResolvedValueOnce([]);
  render(
    <ProviderModelPicker
      provider={provider}
      fields={fields()}
      apiKey="private-fixture-key"
      useSavedKey={false}
      fetchModels={fetchModels}
    />,
  );
  const button = screen.getByRole("button", { name: "Fetch models" });
  fireEvent.click(button);
  fireEvent.click(button);
  expect(fetchModels).toHaveBeenCalledOnce();
  await act(async () => pending.reject(new Error("private-fixture-key")));
  expect(screen.getByRole("alert")).not.toHaveTextContent(
    "private-fixture-key",
  );
  fireEvent.click(screen.getByRole("button", { name: "Fetch models" }));
  await waitFor(() =>
    expect(screen.getByRole("alert")).toHaveTextContent("No model IDs"),
  );
  expect(fetchModels.mock.calls[0][0].useSavedKey).toBe(false);
});

it("does not publish results after unmount or fetch while disabled", async () => {
  const pending = deferred(),
    fetchModels = vi.fn(() => pending.promise);
  const view = render(
    <ProviderModelPicker
      provider={provider}
      fields={fields()}
      disabled
      fetchModels={fetchModels}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Fetch models" }));
  expect(fetchModels).not.toHaveBeenCalled();
  view.rerender(
    <ProviderModelPicker
      provider={provider}
      fields={fields()}
      fetchModels={fetchModels}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Fetch models" }));
  view.unmount();
  await act(async () => pending.resolve(["late"]));
});

it("permits clearing an optional model and resets custom mode only when provider identity changes", () => {
  const changed = vi.fn();
  const fetchModels = vi.fn();
  const view = render(
    <ProviderModelPicker
      provider={provider}
      fields={fields(changed)}
      fetchModels={fetchModels}
    />,
  );
  fireEvent.change(screen.getByLabelText("Speech model"), {
    target: { value: "" },
  });
  expect(changed).toHaveBeenCalledWith("");
  fireEvent.change(screen.getByLabelText("Text model"), {
    target: { value: "custom" },
  });
  view.rerender(
    <ProviderModelPicker
      provider={{ ...provider, baseUrl: "http://localhost:5678/v1" }}
      fields={fields(changed)}
      fetchModels={fetchModels}
    />,
  );
  expect(screen.getByLabelText("Custom text model")).toBeVisible();
  view.rerender(
    <ProviderModelPicker
      provider={{ ...provider, id: "different-provider" }}
      fields={fields(changed)}
      fetchModels={fetchModels}
    />,
  );
  expect(screen.queryByLabelText("Custom text model")).not.toBeInTheDocument();
});
