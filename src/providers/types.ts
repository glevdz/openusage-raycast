export interface ProgressLine {
  type: "progress";
  label: string;
  used: number;
  limit: number;
  format: { kind: "percent" } | { kind: "dollars" } | { kind: "count"; suffix: string };
  resetsAt?: string; // ISO 8601
  periodDurationMs?: number;
}

export interface TextLine {
  type: "text";
  label: string;
  value: string;
}

export interface BadgeLine {
  type: "badge";
  label: string;
  text: string;
  color?: string;
}

export type MetricLine = ProgressLine | TextLine | BadgeLine;

export interface ProbeResult {
  plan?: string;
  lines: MetricLine[];
  error?: string;
}

export interface Provider {
  id: string;
  name: string;
  icon: string; // asset filename
  brandColor: string;
  probe: () => Promise<ProbeResult>;
}

export interface CachedProviderResult {
  provider: Provider;
  result: ProbeResult;
  timestamp: number;
}
