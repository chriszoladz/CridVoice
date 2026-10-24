import { beforeEach, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ listen: vi.fn(), invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => true,
  invoke: api.invoke,
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: api.listen }));
import { events, warmSelectedModels } from "../bridge";

beforeEach(() => vi.clearAllMocks());

it("requests background model warming without microphone, text or credential payloads", async () => {
  api.invoke.mockResolvedValue(undefined);
  await warmSelectedModels();
  expect(api.invoke).toHaveBeenCalledOnce();
  expect(api.invoke).toHaveBeenCalledWith("warm_selected_models", undefined);
});

it("cleans every successful event registration when another fails, including a late registration", async () => {
  const unsubscribers = [vi.fn(), vi.fn(), vi.fn(), vi.fn()];
  let finishLate!: (off: () => void) => void;
  const failure = new Error("Scripted event registration failure");
  api.listen
    .mockResolvedValueOnce(unsubscribers[0])
    .mockImplementationOnce(
      () =>
        new Promise<() => void>((resolve) => {
          finishLate = resolve;
        }),
    )
    .mockRejectedValueOnce(failure)
    .mockResolvedValueOnce(unsubscribers[2])
    .mockResolvedValueOnce(unsubscribers[3]);
  const result = events(vi.fn(), vi.fn(), vi.fn(), vi.fn()).catch(
    (error) => error,
  );
  await Promise.resolve();
  expect(api.listen).toHaveBeenCalledTimes(5);
  finishLate(unsubscribers[1]);
  expect(await result).toBe(failure);
  for (const unsubscribe of unsubscribers)
    expect(unsubscribe).toHaveBeenCalledOnce();
});
