import { useLayoutEffect, useRef } from "react";

export default function TranscriptPreview({
  text,
  variant,
  emptyMessage = "Waiting for recognized speech",
}: {
  text: string;
  variant: "overlay" | "overview";
  emptyMessage?: string;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const follow = useRef(true);

  useLayoutEffect(() => {
    if (variant === "overview" && follow.current && viewport.current) {
      viewport.current.scrollTop = viewport.current.scrollHeight;
    }
  }, [text, variant]);

  return (
    <div
      ref={viewport}
      className={`${variant === "overlay" ? "overlay-preview" : "live-preview"} transcript-preview`}
      aria-label="Transcript preview"
      aria-description="Provisional recent speech. Recognition may revise earlier words."
      aria-live="off"
      onScroll={
        variant === "overview"
          ? (event) => {
              const node = event.currentTarget;
              follow.current =
                node.scrollHeight - node.clientHeight - node.scrollTop <= 24;
            }
          : undefined
      }
    >
      <span className="transcript-preview-text">{text || emptyMessage}</span>
    </div>
  );
}
