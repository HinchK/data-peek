"use client";

import { useRef, useState, useSyncExternalStore } from "react";
import { ClipPlayer } from "./clip-player";
import {
  CATEGORY_LABELS,
  FEATURE_CLIPS,
  type ClipCategory,
  type FeatureClip,
} from "./feature-clips";
import { MotionGraphic } from "./motion";

const CATEGORY_ORDER: ClipCategory[] = ["editor", "performance", "ai", "data", "infra"];
const CATEGORIES = CATEGORY_ORDER.filter((c) => FEATURE_CLIPS.some((f) => f.category === c));
const DEFAULT_CLIP = FEATURE_CLIPS.find((f) => f.category === CATEGORIES[0]) ?? FEATURE_CLIPS[0];

const PANEL_ID = "feature-showcase-panel";

function firstOf(category: ClipCategory): FeatureClip | undefined {
  return FEATURE_CLIPS.find((f) => f.category === category);
}

function tabId(category: ClipCategory): string {
  return `feature-showcase-tab-${category}`;
}

function subscribeHash(onChange: () => void) {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
}

function getHashId() {
  return window.location.hash.replace("#feature-", "");
}

function getServerHashId() {
  return "";
}

/**
 * Tabbed feature showcase. Only the selected clip mounts a <video>, so the page
 * carries one media element regardless of how many features are listed.
 *
 * Selection is derived, not duplicated: `manualSelection` is the only state,
 * and the active category falls out of whichever clip is selected. That
 * avoids the classic "sync selectedId to category in a useEffect" trap, which
 * both cascades renders and trips react-hooks/set-state-in-effect.
 *
 * The URL hash is read via useSyncExternalStore (same pattern as ClipPlayer's
 * reduced-motion check) rather than a mount effect: getServerSnapshot always
 * returns "" so the first client render matches the server-rendered HTML,
 * then a follow-up render picks up the real hash once hydration is done.
 *
 * The category switcher is a real WAI-ARIA tabs widget: each tab points at
 * the single tabpanel it controls via aria-controls, the panel points back
 * via aria-labelledby, and roving tabindex + Arrow/Home/End keys move focus
 * the way assistive tech expects from something that announces itself as
 * role="tab".
 */
export function FeatureShowcase() {
  const [manualSelection, setManualSelection] = useState<FeatureClip | null>(null);
  const hashId = useSyncExternalStore(subscribeHash, getHashId, getServerHashId);
  const hashClip = hashId ? FEATURE_CLIPS.find((f) => f.id === hashId) : undefined;
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const selected = manualSelection ?? hashClip ?? DEFAULT_CLIP;
  const category = selected.category;
  const items = FEATURE_CLIPS.filter((f) => f.category === category);

  function select(clip: FeatureClip) {
    setManualSelection(clip);
    window.history.replaceState(null, "", `#feature-${clip.id}`);
  }

  function selectCategory(c: ClipCategory) {
    const target = firstOf(c);
    if (target) select(target);
  }

  function handleTabKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight") {
      nextIndex = (index + 1) % CATEGORIES.length;
    } else if (event.key === "ArrowLeft") {
      nextIndex = (index - 1 + CATEGORIES.length) % CATEGORIES.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = CATEGORIES.length - 1;
    }
    if (nextIndex === null) return;
    event.preventDefault();
    selectCategory(CATEGORIES[nextIndex]);
    tabRefs.current[nextIndex]?.focus();
  }

  return (
    <section id="see-it-work" className="relative">
      <div className="mx-auto max-w-[1240px] px-5 sm:px-8 py-24 sm:py-32">
        <div className="mb-10">
          <div className="text-[10.5px] uppercase tracking-[0.18em] text-[var(--n-fg-faint)]">
            02 — see it work
          </div>
          <h2 className="mt-4 text-[36px] sm:text-[48px] leading-[1.02] tracking-[-0.02em] text-[var(--n-fg)] font-medium">
            Ten seconds beats
            <br />
            <span className="text-[var(--n-fg-muted)]">a paragraph of docs.</span>
          </h2>
        </div>

        <div role="tablist" aria-label="Feature categories" className="flex flex-wrap gap-1 mb-6">
          {CATEGORIES.map((c, index) => {
            const active = c === category;
            return (
              <button
                key={c}
                ref={(el) => {
                  tabRefs.current[index] = el;
                }}
                id={tabId(c)}
                role="tab"
                type="button"
                aria-selected={active}
                aria-controls={PANEL_ID}
                tabIndex={active ? 0 : -1}
                onClick={() => selectCategory(c)}
                onKeyDown={(e) => handleTabKeyDown(e, index)}
                className="h-8 px-3 text-[11px] uppercase tracking-[0.12em]"
                style={{
                  border: "1px solid var(--n-line-soft)",
                  background: active ? "var(--n-bg-raised)" : "transparent",
                  color: active ? "var(--n-fg)" : "var(--n-fg-muted)",
                }}
              >
                {CATEGORY_LABELS[c]}
              </button>
            );
          })}
        </div>

        <div
          id={PANEL_ID}
          role="tabpanel"
          aria-labelledby={tabId(category)}
          tabIndex={-1}
          className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-6"
        >
          <div role="listbox" aria-label="Features" className="flex flex-col">
            {items.map((f) => {
              const active = f.id === selected.id;
              return (
                <button
                  key={f.id}
                  role="option"
                  type="button"
                  aria-selected={active}
                  onClick={() => select(f)}
                  className="text-left px-3 py-2.5 text-[13px]"
                  style={{
                    borderLeft: `2px solid ${active ? "var(--n-accent)" : "transparent"}`,
                    background: active ? "var(--n-bg-sunken)" : "transparent",
                    color: active ? "var(--n-fg)" : "var(--n-fg-muted)",
                  }}
                >
                  {f.title}
                </button>
              );
            })}
          </div>

          <div className="flex flex-col gap-4">
            {selected.media.kind === "video" ? (
              <ClipPlayer clip={selected} active />
            ) : (
              <MotionGraphic component={selected.media.component} />
            )}
            <p className="text-[13px] leading-[1.6] text-[var(--n-fg-muted)] max-w-[70ch]">
              {selected.blurb}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
