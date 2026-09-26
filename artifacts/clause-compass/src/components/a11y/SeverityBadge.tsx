import { AlertCircle, AlertTriangle, Info } from 'lucide-react';

export type AccessibilitySeverity = 'info' | 'warning' | 'critical';

const severityConfig: Record<AccessibilitySeverity, { icon: React.ReactNode; label: string }> = {
  info: { icon: <Info className="h-4 w-4" aria-hidden="true" />, label: 'Information' },
  warning: { icon: <AlertTriangle className="h-4 w-4" aria-hidden="true" />, label: 'Warning' },
  critical: { icon: <AlertCircle className="h-4 w-4" aria-hidden="true" />, label: 'Critical' },
};

export function SeverityBadge({ severity, testId }: { severity: AccessibilitySeverity; testId?: string }) {
  const config = severityConfig[severity];

  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border border-current px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] bg-white/80 text-foreground"
      data-testid={testId}
    >
      {config.icon}
      <span>{config.label}</span>
    </span>
  );
}
