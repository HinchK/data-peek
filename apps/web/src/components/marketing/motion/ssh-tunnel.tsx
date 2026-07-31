"use client";

import { useSvgReducedMotionPause } from "./use-svg-reduced-motion";

export function SshTunnel() {
  const svgRef = useSvgReducedMotionPause<SVGSVGElement>();
  return (
    <figure
      data-testid="motion-ssh-tunnel"
      aria-label="A connection travelling from your machine through a bastion host into a private database"
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
        <defs>
          <marker
            id="dp-arrow"
            markerWidth="8"
            markerHeight="8"
            refX="6"
            refY="4"
            orient="auto"
          >
            <path d="M0 0 L8 4 L0 8 z" fill="var(--n-fg-faint)" />
          </marker>
        </defs>

        <g
          fontFamily="ui-monospace, monospace"
          fontSize="11"
          fill="var(--n-fg-muted)"
        >
          <rect
            x="24"
            y="100"
            width="120"
            height="60"
            fill="none"
            stroke="var(--n-line)"
          />
          <text x="84" y="134" textAnchor="middle">
            your machine
          </text>

          <rect
            x="260"
            y="100"
            width="120"
            height="60"
            fill="none"
            stroke="var(--n-line)"
          />
          <text x="320" y="128" textAnchor="middle">
            bastion
          </text>
          <text x="320" y="144" textAnchor="middle" fontSize="9.5">
            ssh
          </text>

          <rect
            x="496"
            y="100"
            width="120"
            height="60"
            fill="none"
            stroke="var(--n-line)"
          />
          <text x="556" y="134" textAnchor="middle">
            database
          </text>

          <text
            x="556"
            y="86"
            textAnchor="middle"
            fontSize="9.5"
            fill="var(--n-fg-faint)"
          >
            private subnet
          </text>
          <rect
            x="470"
            y="72"
            width="150"
            height="112"
            fill="none"
            stroke="var(--n-line-soft)"
            strokeDasharray="3 3"
          />

          <line
            x1="144"
            y1="130"
            x2="252"
            y2="130"
            stroke="var(--n-line)"
            markerEnd="url(#dp-arrow)"
          />
          <line
            x1="380"
            y1="130"
            x2="488"
            y2="130"
            stroke="var(--n-line)"
            markerEnd="url(#dp-arrow)"
          />
        </g>

        <circle className="dp-packet" r="4.5" fill="var(--n-accent)">
          <animateMotion
            dur="3.2s"
            repeatCount="indefinite"
            path="M144,130 L252,130 L320,130 L380,130 L488,130"
          />
        </circle>
      </svg>
    </figure>
  );
}
