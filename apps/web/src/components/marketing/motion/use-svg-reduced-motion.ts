"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

function subscribeReducedMotion(onChange: () => void) {
  const mq = window.matchMedia(REDUCED_MOTION_QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

function getReducedMotion() {
  return window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

function getServerReducedMotion() {
  return false;
}

/**
 * These motion graphics animate with SMIL (<animate>, <animateMotion>,
 * <animateTransform>), which CSS cannot touch: `animation-play-state` only
 * applies to CSS animations, and `display: none` does not stop a running
 * SMIL timeline. The only way to actually stop them is the SVG DOM API, so
 * this hook calls `pauseAnimations`/`unpauseAnimations` on the ref'd <svg>
 * directly.
 *
 * useSyncExternalStore, not a lazy useState initializer, for the same reason
 * documented in apps/web/src/components/marketing/clip-player.tsx: reading
 * matchMedia during the hydration render itself diverges from the SSR pass
 * (no `window` there), and React never repairs the mismatch afterwards.
 */
export function useSvgReducedMotionPause<T extends SVGSVGElement>() {
  const ref = useRef<T>(null);
  const reduced = useSyncExternalStore(
    subscribeReducedMotion,
    getReducedMotion,
    getServerReducedMotion,
  );

  useEffect(() => {
    const svg = ref.current;
    if (!svg) return;
    // Optional chaining: jsdom (unit tests) doesn't implement either method
    // at all, unlike real browsers, where both are always present. Guarding
    // here keeps component-render tests that don't care about animation
    // state from crashing, without changing production behavior.
    if (reduced) {
      svg.pauseAnimations?.();
    } else {
      svg.unpauseAnimations?.();
    }
  }, [reduced]);

  return ref;
}
