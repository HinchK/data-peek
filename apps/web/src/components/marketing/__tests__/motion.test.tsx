import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MotionGraphic } from "../motion";

const NAMES = ["ssh-tunnel", "local-vault", "no-telemetry"] as const;

describe("MotionGraphic", () => {
  it.each(NAMES)("renders %s with an accessible label", (name) => {
    render(<MotionGraphic component={name} />);
    const fig = screen.getByTestId(`motion-${name}`);
    expect(fig).toBeInTheDocument();
    expect(fig.querySelector("svg")).toBeTruthy();
    expect(fig.getAttribute("aria-label")).toBeTruthy();
  });

  // jsdom has no SMIL/animation engine and doesn't apply external stylesheets,
  // so we can't observe motion actually stopping (getComputedStyle won't
  // reflect the @media (prefers-reduced-motion: reduce) rule in globals.css).
  // What we *can* verify statically is the invariant that rule depends on:
  // every <animate>/<animateMotion>/<animateTransform> element must live
  // inside a `.dp-motion`-classed ancestor, because the CSS selectors are
  // `.dp-motion animate`, `.dp-motion animateMotion`, `.dp-motion animateTransform`.
  // An animation element added outside that wrapper would keep running under
  // reduced motion and this test would catch it — a plain "some .dp-motion
  // class exists somewhere" check would not.
  it.each(NAMES)("%s: every animation element is covered by .dp-motion", (name) => {
    render(<MotionGraphic component={name} />);
    const fig = screen.getByTestId(`motion-${name}`);
    const animationEls = fig.querySelectorAll("animate, animateMotion, animateTransform");

    expect(animationEls.length).toBeGreaterThan(0);
    animationEls.forEach((el) => {
      expect(el.closest(".dp-motion")).not.toBeNull();
    });
  });
});
