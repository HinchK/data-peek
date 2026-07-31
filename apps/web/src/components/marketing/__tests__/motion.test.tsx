import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MotionGraphic } from "../motion";
import { setReducedMotion } from "../../../../vitest.setup";

const NAMES = ["ssh-tunnel", "local-vault", "no-telemetry"] as const;

describe("MotionGraphic", () => {
  beforeEach(() => {
    setReducedMotion(false);
    vi.clearAllMocks();
  });

  it.each(NAMES)("renders %s with an accessible label", (name) => {
    render(<MotionGraphic component={name} />);
    const fig = screen.getByTestId(`motion-${name}`);
    expect(fig).toBeInTheDocument();
    expect(fig.querySelector("svg")).toBeTruthy();
    expect(fig.getAttribute("aria-label")).toBeTruthy();
  });

  // These graphics animate with SMIL (<animate>, <animateMotion>,
  // <animateTransform>), which CSS cannot pause — animation-play-state only
  // affects CSS animations, and display:none does not stop a running SMIL
  // timeline. The only real fix is calling the SVG DOM API directly (see
  // use-svg-reduced-motion.ts). jsdom has no SMIL engine at all, so we can't
  // observe an animation actually stop — but jsdom also has no
  // pauseAnimations/unpauseAnimations methods by default, so vitest.setup.ts
  // stubs both as spies, and what we *can* verify is that the component
  // calls the right one for the current reduced-motion state. This proves
  // the DOM-API call happens; it does not prove the call visibly stops
  // motion in a real browser (that was verified manually in Chromium, not
  // by this suite).
  it.each(NAMES)(
    "%s: pauses SVG animations when reduced motion is on",
    (name) => {
      setReducedMotion(true);
      render(<MotionGraphic component={name} />);
      const fig = screen.getByTestId(`motion-${name}`);
      const svg = fig.querySelector("svg") as SVGSVGElement;

      expect(svg.pauseAnimations).toHaveBeenCalled();
      expect(svg.unpauseAnimations).not.toHaveBeenCalled();
    },
  );

  it.each(NAMES)(
    "%s: does not pause SVG animations when reduced motion is off",
    (name) => {
      render(<MotionGraphic component={name} />);
      const fig = screen.getByTestId(`motion-${name}`);
      const svg = fig.querySelector("svg") as SVGSVGElement;

      expect(svg.unpauseAnimations).toHaveBeenCalled();
      expect(svg.pauseAnimations).not.toHaveBeenCalled();
    },
  );
});
