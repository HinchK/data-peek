import Module from "node:module";
import { createRequire } from "node:module";
import { dirname } from "node:path";

// This workspace pins an exact react/react-dom version, and the machine's
// pnpm is configured with node-linker=hoisted. Combined, that makes
// @testing-library/react's peer-resolved react-dom land in its own
// physically separate copy on disk (same version, different files), rather
// than the symlink a non-hoisted install would produce. Vite's resolve.alias
// can't reach it — react-dom is plain CJS and Node requires it natively,
// bypassing Vite's resolver entirely — so every hook call inside a rendered
// component throws "Invalid hook call: ... more than one copy of React".
// Patching Node's own resolver to canonicalize react/react-dom (and their
// subpaths, e.g. react-dom/client) fixes it at the one layer that's actually
// in the require path, no matter how deeply nested the requester is.
const require = createRequire(import.meta.url);
const canonical: Record<string, string> = {
  react: dirname(require.resolve("react/package.json")),
  "react-dom": dirname(require.resolve("react-dom/package.json")),
};
type ResolveFilename = (this: unknown, request: string, ...rest: unknown[]) => string;
const moduleWithInternals = Module as unknown as { _resolveFilename: ResolveFilename };
const originalResolveFilename = moduleWithInternals._resolveFilename;
moduleWithInternals._resolveFilename = function (this: unknown, request, ...rest) {
  for (const pkg of Object.keys(canonical)) {
    if (request === pkg || request.startsWith(`${pkg}/`)) {
      const rewritten = canonical[pkg] + request.slice(pkg.length);
      return originalResolveFilename.call(this, rewritten, ...rest);
    }
  }
  return originalResolveFilename.call(this, request, ...rest);
};

import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

// jsdom implements neither of these, and ClipPlayer depends on both.
class MockIntersectionObserver implements IntersectionObserver {
  readonly root = null;
  readonly rootMargin = "";
  readonly thresholds: readonly number[] = [];
  constructor(private cb: IntersectionObserverCallback) {
    observers.push(this);
  }
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
  takeRecords = () => [];
  /** Test hook: drive the callback by hand. */
  emit(isIntersecting: boolean) {
    this.cb(
      [{ isIntersecting } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver,
    );
  }
}

export const observers: MockIntersectionObserver[] = [];
vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);

let reducedMotion = false;
export function setReducedMotion(value: boolean) {
  reducedMotion = value;
}
vi.stubGlobal(
  "matchMedia",
  (query: string) =>
    ({
      matches: query.includes("prefers-reduced-motion") ? reducedMotion : false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
      onchange: null,
    }) as MediaQueryList,
);

// jsdom's HTMLMediaElement has no playback implementation.
Object.defineProperty(HTMLMediaElement.prototype, "play", {
  configurable: true,
  value: vi.fn().mockResolvedValue(undefined),
});
Object.defineProperty(HTMLMediaElement.prototype, "pause", {
  configurable: true,
  value: vi.fn(),
});
