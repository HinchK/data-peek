// @vitest-environment node
//
// Deliberately not jsdom: the bug this file guards against (server/client
// `controls` attribute mismatch under prefers-reduced-motion) only exists
// because `window` is genuinely absent during SSR. A jsdom-environment test
// always has a `window`, so `renderToString` would never see the real SSR
// condition and the regression would slip back in unnoticed. This file runs
// the SSR half with no DOM at all, then constructs one real jsdom `Window`
// by hand for the hydration half, mirroring what actually happens between a
// Next.js server render and the browser picking it up.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { renderToString } from "react-dom/server";
import { JSDOM } from "jsdom";
import { ClipPlayer } from "../clip-player";
import type { FeatureClip } from "../feature-clips";

const clip: FeatureClip = {
  id: "command-palette",
  title: "Command palette",
  blurb: "⌘K opens every action. Switch connections, run queries, jump to tables.",
  category: "editor",
  media: { kind: "video", file: "command-palette", width: 1280, height: 800 },
};

function stubReducedMotionMatchMedia(window: Window) {
  window.matchMedia = ((query: string) => ({
    matches: query.includes("prefers-reduced-motion"),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
    onchange: null,
  })) as unknown as typeof window.matchMedia;
}

describe("ClipPlayer hydration under prefers-reduced-motion", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders identically on the server and after hydration — no attribute mismatch, controls survive", async () => {
    // Sanity check that this really is the SSR condition the bug depends on.
    expect(typeof window).toBe("undefined");

    const html = renderToString(<ClipPlayer clip={clip} active />);
    // getServerSnapshot() is always `false`: the server never knows the
    // visitor's OS preference, so it must never emit `controls` — emitting
    // it unconditionally would show playback controls to everyone.
    expect(html).not.toContain("controls");

    const dom = new JSDOM("<!doctype html><html><body><div id=\"root\"></div></body></html>");
    stubReducedMotionMatchMedia(dom.window as unknown as Window);
    // IntersectionObserver is stubbed globally in vitest.setup.ts via
    // vi.stubGlobal, which lands on globalThis and is visible here too —
    // ClipPlayer's other effect needs it regardless of environment.
    vi.stubGlobal("window", dom.window);
    vi.stubGlobal("document", dom.window.document);
    vi.stubGlobal("navigator", dom.window.navigator);

    const container = dom.window.document.getElementById("root")!;
    container.innerHTML = html;

    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const { hydrateRoot } = await import("react-dom/client");

    await act(async () => {
      hydrateRoot(container, <ClipPlayer clip={clip} active />);
    });

    // `<video muted>` has a separate, pre-existing React SSR quirk (the
    // boolean muted *property* can't be reflected server-side, independent
    // of anything here — deferred, tracked elsewhere) that fires its own
    // "didn't match" warning on every render of this component, reduced
    // motion or not, and that warning's diff dump prints every prop
    // (including `controls`) as unmarked context. Only a line React actually
    // flags as differing is prefixed with `+`/`-`, so matching on that
    // prefix (rather than the plain substring "controls") is what makes this
    // assertion about the bug it's meant to catch instead of failing on
    // unrelated, already-known, already-deferred noise.
    const controlsMismatch = consoleError.mock.calls.some((args) =>
      /^[+-]\s*controls=/m.test(String(args)),
    );
    expect(controlsMismatch).toBe(false);

    const video = container.querySelector('[data-testid="clip-video"]') as HTMLVideoElement;
    expect(video.hasAttribute("controls")).toBe(true);

    consoleError.mockRestore();
  });
});
