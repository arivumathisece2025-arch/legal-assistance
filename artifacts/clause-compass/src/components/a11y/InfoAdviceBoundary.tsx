import { SeverityBadge, type AccessibilitySeverity } from './SeverityBadge';

export function InfoAdviceBoundary({
  severity,
  information,
  advice,
}: {
  severity: AccessibilitySeverity;
  information: React.ReactNode;
  advice: React.ReactNode;
}) {
  return (
    <div className="grid gap-4 md:grid-cols-2 my-6" role="region" aria-label="Analysis and recommendations">
      <section className="rounded-xl border border-slate-300 bg-slate-100 p-5 shadow-sm" aria-labelledby="a11y-info-heading">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 id="a11y-info-heading" className="text-lg font-bold">Context & Information</h2>
          <SeverityBadge severity={severity} testId="a11y-severity-badge" />
        </div>
        <div className="text-sm leading-relaxed text-slate-700">{information}</div>
      </section>

      <section className="rounded-xl border border-slate-300 bg-white p-5 shadow-sm" aria-labelledby="a11y-advice-heading">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 id="a11y-advice-heading" className="text-lg font-bold">Actionable Advice</h2>
          <SeverityBadge severity={severity} testId="a11y-severity-badge-secondary" />
        </div>
        <div className="text-sm leading-relaxed text-slate-700">{advice}</div>
      </section>
    </div>
  );
}
