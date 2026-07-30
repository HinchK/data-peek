"use client";

import { useSvgReducedMotionPause } from "./use-svg-reduced-motion";

export function NoTelemetry() {
  const svgRef = useSvgReducedMotionPause<SVGSVGElement>();
  return (
    <figure
      data-testid="motion-no-telemetry"
      aria-label="Outbound analytics and logging requests terminating at your machine's boundary"
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
            x="40"
            y="70"
            width="150"
            height="120"
            fill="none"
            stroke="var(--n-line)"
          />
          <text x="115" y="124" textAnchor="middle">
            data-peek
          </text>
          <text x="115" y="142" textAnchor="middle" fontSize="9.5">
            your queries
          </text>

          <line
            x1="330"
            y1="50"
            x2="330"
            y2="210"
            stroke="var(--n-line)"
            strokeDasharray="4 4"
          />
          <text
            x="330"
            y="38"
            textAnchor="middle"
            fontSize="9.5"
            fill="var(--n-fg-faint)"
          >
            the internet
          </text>

          {["analytics", "crash logs", "usage stats"].map((label, i) => (
            <g key={label}>
              <text
                x="200"
                y={96 + i * 40}
                fontSize="9.5"
                fill="var(--n-fg-faint)"
              >
                {label}
              </text>
              <line
                x1="196"
                y1={100 + i * 40}
                x2="322"
                y2={100 + i * 40}
                stroke="var(--n-line-soft)"
              />
            </g>
          ))}
        </g>

        {[0, 1, 2].map((i) => (
          <g key={i}>
            <circle r="4" cy={100 + i * 40} fill="oklch(0.70 0.16 30)">
              <animate
                attributeName="cx"
                values="200; 318; 318"
                keyTimes="0; 0.55; 1"
                dur="2.6s"
                begin={`${i * 0.45}s`}
                repeatCount="indefinite"
              />
              <animate
                attributeName="opacity"
                values="0; 1; 1; 0"
                keyTimes="0; 0.2; 0.55; 0.62"
                dur="2.6s"
                begin={`${i * 0.45}s`}
                repeatCount="indefinite"
              />
            </circle>
          </g>
        ))}

        <g stroke="oklch(0.70 0.16 30)" strokeWidth="2">
          {[0, 1, 2].map((i) => (
            <g key={i}>
              <line x1="324" y1={94 + i * 40} x2="336" y2={106 + i * 40} />
              <line x1="336" y1={94 + i * 40} x2="324" y2={106 + i * 40} />
            </g>
          ))}
        </g>
      </svg>
    </figure>
  );
}
