"use client";

import { useSvgReducedMotionPause } from "./use-svg-reduced-motion";

export function LocalVault() {
  const svgRef = useSvgReducedMotionPause<SVGSVGElement>();
  return (
    <figure
      data-testid="motion-local-vault"
      aria-label="A credential being sealed into the operating system keychain on your own machine"
      className="m-0 w-full"
      style={{
        border: "1px solid var(--n-line-soft)",
        background: "var(--n-bg-sunken)",
      }}
    >
      <svg
        ref={svgRef}
        viewBox="0 0 640 260"
        className="w-full h-auto block"
        role="img"
      >
        <g
          fontFamily="ui-monospace, monospace"
          fontSize="11"
          fill="var(--n-fg-muted)"
        >
          <rect
            x="60"
            y="60"
            width="520"
            height="150"
            fill="none"
            stroke="var(--n-line-soft)"
            strokeDasharray="3 3"
          />
          <text x="72" y="52" fontSize="9.5" fill="var(--n-fg-faint)">
            your machine — nothing crosses this boundary
          </text>

          <rect
            x="110"
            y="112"
            width="130"
            height="46"
            fill="none"
            stroke="var(--n-line)"
          />
          <text x="175" y="140" textAnchor="middle">
            password
          </text>

          <rect
            x="400"
            y="102"
            width="140"
            height="66"
            fill="none"
            stroke="var(--n-line)"
          />
          <text x="470" y="130" textAnchor="middle">
            OS keychain
          </text>
          <text x="470" y="148" textAnchor="middle" fontSize="9.5">
            encrypted
          </text>
        </g>

        <g className="dp-key">
          <rect
            x="250"
            y="126"
            width="26"
            height="8"
            rx="2"
            fill="var(--n-accent)"
          />
          <circle
            cx="248"
            cy="130"
            r="7"
            fill="none"
            stroke="var(--n-accent)"
            strokeWidth="3"
          />
          <animateTransform
            attributeName="transform"
            type="translate"
            values="0 0; 132 0; 132 0; 0 0"
            keyTimes="0; 0.45; 0.8; 1"
            dur="4s"
            repeatCount="indefinite"
          />
        </g>
      </svg>
    </figure>
  );
}
