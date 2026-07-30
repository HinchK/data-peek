// Local dev serves video from apps/web/public/clips/ (the encoder writes the
// mp4/webm there alongside the poster). Production points this at the R2
// bucket instead: NEXT_PUBLIC_CLIP_BASE=https://pub-84538e6ab6f94b80b94b8aa308ad1270.r2.dev/clips
export const CLIP_BASE = process.env.NEXT_PUBLIC_CLIP_BASE ?? "/clips";

export type ClipCategory = "editor" | "performance" | "ai" | "data" | "infra";

export type ClipMedia =
  | {
      kind: "video";
      /** Basename shared by the mp4/webm on R2 and the poster in /public/clips. */
      file: string;
      width: number;
      height: number;
    }
  | { kind: "motion"; component: "ssh-tunnel" | "local-vault" | "no-telemetry" };

export type FeatureClip = {
  /** Kebab-case; also the URL hash fragment and the capture spec's test title. */
  id: string;
  title: string;
  blurb: string;
  category: ClipCategory;
  media: ClipMedia;
};

export const CATEGORY_LABELS: Record<ClipCategory, string> = {
  editor: "Editor",
  performance: "Performance",
  ai: "AI",
  data: "Data",
  infra: "Infrastructure",
};

export const FEATURE_CLIPS: FeatureClip[] = [
  {
    id: "command-palette",
    title: "Command palette",
    blurb: "⌘K opens every action. Switch connections, run queries, jump to tables.",
    category: "editor",
    media: { kind: "video", file: "command-palette", width: 1280, height: 800 },
  },
];

export function clipById(id: string): FeatureClip | undefined {
  return FEATURE_CLIPS.find((c) => c.id === id);
}

export function mp4Url(file: string): string {
  return `${CLIP_BASE}/${file}.mp4`;
}

export function webmUrl(file: string): string {
  return `${CLIP_BASE}/${file}.webm`;
}

export function posterUrl(file: string): string {
  return `/clips/${file}.webp`;
}
