import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ClipPlayer } from "../clip-player";
import type { FeatureClip } from "../feature-clips";
import { observers, setReducedMotion } from "../../../../vitest.setup";

const clip: FeatureClip = {
  id: "command-palette",
  title: "Command palette",
  blurb: "⌘K opens every action. Switch connections, run queries, jump to tables.",
  category: "editor",
  media: { kind: "video", file: "command-palette", width: 1280, height: 800 },
};

describe("ClipPlayer", () => {
  beforeEach(() => {
    observers.length = 0;
    setReducedMotion(false);
    vi.clearAllMocks();
  });

  it("renders both sources, a poster, and explicit dimensions", () => {
    render(<ClipPlayer clip={clip} active />);
    const video = screen.getByTestId("clip-video") as HTMLVideoElement;

    expect(video).toHaveAttribute("poster", "/clips/command-palette.webp");
    expect(video).toHaveAttribute("width", "1280");
    expect(video).toHaveAttribute("height", "800");
    expect(video.getAttribute("preload")).toBe("none");

    const types = Array.from(video.querySelectorAll("source")).map((s) =>
      s.getAttribute("type"),
    );
    expect(types).toEqual(["video/webm", "video/mp4"]);
  });

  it("plays when scrolled into view and pauses when it leaves", () => {
    render(<ClipPlayer clip={clip} active />);
    const video = screen.getByTestId("clip-video") as HTMLVideoElement;

    expect(video.play).not.toHaveBeenCalled();

    observers[0].emit(true);
    expect(video.play).toHaveBeenCalledTimes(1);

    observers[0].emit(false);
    expect(video.pause).toHaveBeenCalledTimes(1);
  });

  it("never autoplays under prefers-reduced-motion, and exposes native controls instead", () => {
    setReducedMotion(true);
    render(<ClipPlayer clip={clip} active />);
    const video = screen.getByTestId("clip-video") as HTMLVideoElement;

    observers[0].emit(true);
    expect(video.play).not.toHaveBeenCalled();
    expect(video).toHaveAttribute("controls");
  });

  it("does not expose controls when motion is not reduced", () => {
    render(<ClipPlayer clip={clip} active />);
    const video = screen.getByTestId("clip-video") as HTMLVideoElement;

    expect(video).not.toHaveAttribute("controls");
  });

  it("does not play while inactive even if visible", () => {
    render(<ClipPlayer clip={clip} active={false} />);
    const video = screen.getByTestId("clip-video") as HTMLVideoElement;

    observers[0].emit(true);
    expect(video.play).not.toHaveBeenCalled();
    expect(video.pause).toHaveBeenCalled();
  });
});
