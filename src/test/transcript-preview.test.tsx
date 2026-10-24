import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import TranscriptPreview from "../TranscriptPreview";

afterEach(cleanup);

it("immediately replaces provisional text, including corrected or shorter revisions, without live announcements", () => {
  const { rerender } = render(
    <TranscriptPreview text="Meet on Tuesday at three" variant="overlay" />,
  );
  const preview = screen.getByLabelText("Transcript preview");
  expect(preview).toHaveAttribute("aria-live", "off");
  for (const text of [
    "Meet on Wednesday at 3",
    "Cześć · dryRun = false;",
    "Short",
  ]) {
    rerender(<TranscriptPreview text={text} variant="overlay" />);
    expect(preview.textContent?.trim()).toBe(text);
  }
  rerender(<TranscriptPreview text="" variant="overlay" />);
  expect(preview).toHaveTextContent("Waiting for recognized speech");
});

function dimensions(node: HTMLElement) {
  let height = 600;
  Object.defineProperties(node, {
    scrollHeight: { configurable: true, get: () => height },
    clientHeight: { configurable: true, value: 100 },
    scrollTop: { configurable: true, writable: true, value: 0 },
  });
  return (value: number) => {
    height = value;
  };
}

it("follows new Overview text while near the bottom, leaving meter-only rerenders alone", () => {
  const { rerender } = render(
    <TranscriptPreview text="First" variant="overview" />,
  );
  const preview = screen.getByLabelText("Transcript preview");
  const height = dimensions(preview);
  rerender(<TranscriptPreview text="First second" variant="overview" />);
  expect(preview.scrollTop).toBe(600);
  preview.scrollTop = 475;
  fireEvent.scroll(preview);
  height(700);
  rerender(<TranscriptPreview text="First second third" variant="overview" />);
  expect(preview.scrollTop).toBe(475);
  preview.scrollTop = 590;
  fireEvent.scroll(preview);
  rerender(
    <TranscriptPreview text="First second third fourth" variant="overview" />,
  );
  expect(preview.scrollTop).toBe(700);
  preview.scrollTop = 12;
  rerender(
    <TranscriptPreview text="First second third fourth" variant="overview" />,
  );
  expect(preview.scrollTop).toBe(12);
});

it("preserves a reader's position until they return near the bottom and resets following on a new mount", () => {
  const { rerender, unmount } = render(
    <TranscriptPreview text="Old take" variant="overview" />,
  );
  const preview = screen.getByLabelText("Transcript preview");
  dimensions(preview);
  fireEvent.scroll(preview);
  rerender(<TranscriptPreview text="Old take revised" variant="overview" />);
  expect(preview.scrollTop).toBe(0);
  unmount();
  const next = render(<TranscriptPreview text="" variant="overview" />);
  const fresh = screen.getByLabelText("Transcript preview");
  dimensions(fresh);
  next.rerender(<TranscriptPreview text="New take" variant="overview" />);
  expect(fresh.scrollTop).toBe(600);
  expect(fresh).not.toHaveTextContent("Old take");
});
