import { AlertCircle, Check, TriangleAlert } from "lucide-react";

export type Severity = "low" | "medium" | "high";
export type Status = "uploaded" | "analyzing" | "ready";

export function formatDate(value?: string) {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" }).format(parsed);
}

export function StatusPill({ status }: { status: Status }) {
  const labels: Record<Status, string> = { uploaded: "Uploaded", analyzing: "Analyzing", ready: "Ready" };
  return <span className={`cc-status cc-status-${status}`}><span aria-hidden="true">●</span> {labels[status]}</span>;
}

export function SeverityBadge({ severity }: { severity: Severity }) {
  const Icon = severity === "high" ? TriangleAlert : severity === "medium" ? AlertCircle : Check;
  return <span className={`cc-severity cc-severity-${severity}`}><Icon size={12} aria-hidden="true" /> {severity} risk</span>;
}