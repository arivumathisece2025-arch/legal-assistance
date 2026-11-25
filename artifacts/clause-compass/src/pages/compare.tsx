import { useEffect, useRef, useState, type RefObject } from "react";
import { AlertCircle, ArrowLeft, Check, RotateCcw, ScanText, TriangleAlert, X } from "lucide-react";
import { Link, useParams } from "wouter";
import { useCompareDocumentVersions, useGetDocument, useListDocuments, getGetDocumentQueryKey } from "@workspace/api-client-react";
import { SeverityBadge, type Severity } from "./shared";

type VersionComparisonData = NonNullable<ReturnType<typeof useCompareDocumentVersions>["data"]>;
type ComparisonRowData = VersionComparisonData["rows"][number];
type CompareChangeLabel = "Added" | "Removed" | "Changed" | "Favors other party";
type PaneRef = RefObject<HTMLDivElement | null>;

function ChangeLabelChip({ label }: { label: CompareChangeLabel }) {
  const Icon = label === "Added" ? Check : label === "Removed" ? X : label === "Favors other party" ? TriangleAlert : RotateCcw;
  const modifier = label === "Favors other party" ? "favors" : label.toLowerCase();
  return <span className={`cc-change-label cc-change-label-${modifier}`} data-label={label}><Icon size={12} aria-hidden="true" /> {label}</span>;
}

function DifferenceCard({
  clause,
  labels,
  similarity,
  findings,
  emptyMessage,
}: {
  clause?: { id: string; ordinal: string; heading: string; text: string };
  labels: CompareChangeLabel[];
  similarity?: number;
  findings: ComparisonRowData["findingChanges"];
  emptyMessage: string;
}) {
  if (!clause) return <div className="cc-diff-card cc-diff-card-empty">{emptyMessage}</div>;

  return (
    <article className="cc-diff-card">
      <div className="cc-diff-card-head">
        <span className="cc-diff-ordinal">{clause.ordinal}</span>
        <span className="cc-diff-heading">{clause.heading}</span>
      </div>
      {labels.length > 0 && <div className="cc-change-labels">{labels.map((label) => <ChangeLabelChip key={label} label={label} />)}</div>}
      <p className="cc-diff-text">{clause.text}</p>
      {typeof similarity === "number" && <p className="cc-diff-similarity">Wording match {Math.round(similarity * 100)}% against the other version</p>}
      {findings.length > 0 && (
        <ul className="cc-diff-findings">
          {findings.map((finding) => (
            <li key={`${finding.ruleId}-${finding.status}`}>
              <SeverityBadge severity={finding.severity as Severity} />
              <span>{finding.message}</span>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}

function ComparisonView({
  comparison,
  visibleRows,
  totalRows,
  changesOnly,
  leftPaneRef,
  rightPaneRef,
  onScroll,
  favourLabel,
}: {
  comparison: VersionComparisonData;
  visibleRows: ComparisonRowData[];
  totalRows: number;
  changesOnly: boolean;
  leftPaneRef: PaneRef;
  rightPaneRef: PaneRef;
  onScroll: (source: "left" | "right") => void;
  favourLabel: (favors: string) => string;
}) {
  return (
    <>
      <section className="cc-diff-summary" aria-label="Comparison summary" data-testid="section-compare-summary">
        <div className="cc-diff-summary-item"><span className="cc-stat-label">Changed</span><span className="cc-stat-value" data-testid="text-changed-count">{comparison.summary.changedCount}</span></div>
        <div className="cc-diff-summary-item"><span className="cc-stat-label">Added</span><span className="cc-stat-value" data-testid="text-added-count">{comparison.summary.addedCount}</span></div>
        <div className="cc-diff-summary-item"><span className="cc-stat-label">Removed</span><span className="cc-stat-value" data-testid="text-removed-count">{comparison.summary.removedCount}</span></div>
        <div className="cc-diff-summary-item"><span className="cc-stat-label">New risk findings</span><span className="cc-stat-value" data-testid="text-introduced-count">{comparison.summary.introducedRiskCount}</span></div>
        <div className="cc-diff-summary-item"><span className="cc-stat-label">Resolved risk findings</span><span className="cc-stat-value" data-testid="text-resolved-count">{comparison.summary.resolvedRiskCount}</span></div>
        <p className="cc-diff-legend" id="compare-legend">
          Labels in this view:
          <ChangeLabelChip label="Added" />
          <ChangeLabelChip label="Removed" />
          <ChangeLabelChip label="Changed" />
          <ChangeLabelChip label="Favors other party" />
        </p>
      </section>

      <div className="cc-diff-panes">
        <div className="cc-diff-pane">
          <h2 className="cc-diff-pane-title">{comparison.base.name} <span className="cc-diff-pane-note">earlier version</span></h2>
          <div className="cc-diff-pane-body" ref={leftPaneRef} onScroll={() => onScroll("left")} tabIndex={0} role="region" aria-label={`${comparison.base.name}, earlier version`} data-testid="pane-base-version">
            {visibleRows.map((row, index) => (
              <div className="cc-diff-row" key={`left-${row.key}`}>
                <DifferenceCard
                  clause={row.before}
                  labels={row.labels as CompareChangeLabel[]}
                  findings={row.kind === "removed" ? row.findingChanges : []}
                  emptyMessage={row.kind === "added" ? "New clause, not present in this version." : `Clause ${index + 1} has no counterpart here.`}
                />
              </div>
            ))}
            {visibleRows.length === 0 && <p className="cc-diff-empty-pane">No differences to show with this filter. Untick “Changes only” to read every clause.</p>}
          </div>
        </div>

        <div className="cc-diff-pane">
          <h2 className="cc-diff-pane-title">{comparison.revised.name} <span className="cc-diff-pane-note">revised version</span></h2>
          <div className="cc-diff-pane-body" ref={rightPaneRef} onScroll={() => onScroll("right")} tabIndex={0} role="region" aria-label={`${comparison.revised.name}, revised version`} data-testid="pane-revised-version">
            {visibleRows.map((row) => (
              <div className="cc-diff-row" key={`right-${row.key}`}>
                <DifferenceCard
                  clause={row.after}
                  labels={row.labels as CompareChangeLabel[]}
                  similarity={row.before && row.after ? row.similarity : undefined}
                  findings={row.kind === "removed" ? [] : row.findingChanges}
                  emptyMessage="This clause was removed in the revised version."
                />
                {row.materialChange && (
                  <p className="cc-diff-note" data-testid={`text-material-change-${row.key}`}>
                    What changed: {row.materialChange.summary} It favours {favourLabel(row.materialChange.favors)}.
                    {row.materialChange.available ? "" : " (reasoning model unavailable)"}
                  </p>
                )}
              </div>
            ))}
            {visibleRows.length === 0 && <p className="cc-diff-empty-pane">No differences to show with this filter. Untick “Changes only” to read every clause.</p>}
          </div>
        </div>
      </div>

      <p className="cc-diff-footnote">
        {changesOnly ? `Showing ${visibleRows.length} of ${totalRows} aligned clauses.` : `Showing all ${totalRows} aligned clauses.`} Unchanged clauses are still compared, they are just hidden by the filter.
      </p>
    </>
  );
}

export default function CompareVersionsPage() {
  const { id = "" } = useParams<{ id: string }>();
  const { data: documents, isLoading: documentsLoading } = useListDocuments();
  const { data: revisedDocument, isLoading, isError } = useGetDocument(id, { query: { queryKey: getGetDocumentQueryKey(id), enabled: Boolean(id) } });
  const [baseId, setBaseId] = useState("");
  const [perspective, setPerspective] = useState<"party_a" | "party_b">("party_a");
  const [changesOnly, setChangesOnly] = useState(true);
  const leftPaneRef = useRef<HTMLDivElement>(null);
  const rightPaneRef = useRef<HTMLDivElement>(null);
  const scrollLock = useRef(false);
  const compare = useCompareDocumentVersions();
  const { mutate: compareVersions } = compare;

  const candidateVersions = (documents ?? []).filter((document) => document.id !== id);

  useEffect(() => {
    if (!baseId && candidateVersions.length > 0) setBaseId(candidateVersions[0].id);
  }, [baseId, candidateVersions]);

  useEffect(() => {
    if (!id || !baseId || baseId === id) return;
    compareVersions({ id, data: { against: baseId, perspective } });
  }, [id, baseId, perspective, compareVersions]);

  const handleScroll = (source: "left" | "right") => {
    const from = source === "left" ? leftPaneRef.current : rightPaneRef.current;
    const to = source === "left" ? rightPaneRef.current : leftPaneRef.current;
    if (!from || !to || scrollLock.current) return;
    scrollLock.current = true;
    to.scrollTop = from.scrollTop;
    window.requestAnimationFrame(() => { scrollLock.current = false; });
  };

  if (isLoading || documentsLoading) return <main className="cc-content"><div className="cc-skeleton" style={{ width: 140, height: 16, marginBottom: 20 }} /><div className="cc-skeleton" style={{ width: "70%", height: 44, marginBottom: 12 }} /><div className="cc-skeleton" style={{ width: "50%", height: 18 }} /></main>;
  if (isError || !revisedDocument) return <main className="cc-content"><div className="cc-alert cc-alert-error" role="alert" data-testid="status-compare-unavailable"><AlertCircle size={16} /> This comparison is unavailable.</div></main>;

  const comparison = compare.data;
  const rows = comparison?.rows ?? [];
  const visibleRows = changesOnly ? rows.filter((row) => row.kind !== "unchanged") : rows;
  const favourLabel = (favors: string) => favors === "neither" ? "neither party identified" : favors === "partyA" ? "Party A" : "Party B";

  return (
    <main className="cc-content">
      <Link href={`/documents/${id}`} className="cc-back" data-testid="link-back-from-compare"><ArrowLeft size={14} /> Back to document</Link>
      <header className="cc-detail-header">
        <div>
          <div className="cc-kicker">Version comparison</div>
          <h1 className="cc-detail-title" data-testid="text-compare-title">{comparison ? `${comparison.revised.name} against ${comparison.base.name}` : revisedDocument.name}</h1>
          <p className="cc-lede">Clauses are matched by heading, clause type and wording. Every change carries a written label, and risk findings are re-run on both versions.</p>
        </div>
      </header>

      <section className="cc-diff-controls" aria-label="Comparison controls">
        <div>
          <label className="cc-field-label" htmlFor="base-version">Compare against</label>
          <select id="base-version" className="cc-select" value={baseId} onChange={(event) => setBaseId(event.target.value)} data-testid="select-base-version">
            {candidateVersions.length === 0 && <option value="">No other version yet</option>}
            {candidateVersions.map((document) => <option key={document.id} value={document.id}>{document.name}</option>)}
          </select>
        </div>
        <div>
          <label className="cc-field-label" htmlFor="compare-perspective">I am reading as</label>
          <select id="compare-perspective" className="cc-select" value={perspective} onChange={(event) => setPerspective(event.target.value as "party_a" | "party_b")} data-testid="select-compare-perspective">
            <option value="party_a">Party A</option>
            <option value="party_b">Party B</option>
          </select>
        </div>
        <div className="cc-diff-filter">
          <input id="changes-only" type="checkbox" checked={changesOnly} onChange={(event) => setChangesOnly(event.target.checked)} data-testid="checkbox-changes-only" aria-describedby="changes-only-hint" />
          <label htmlFor="changes-only">Changes only</label>
          <span id="changes-only-hint">Hide clauses that are identical in both versions.</span>
        </div>
      </section>

      {candidateVersions.length === 0 && <div className="cc-alert" style={{ marginBottom: 18 }} role="status" data-testid="status-needs-second-version"><ScanText size={16} /> Add a revised version to the inbox and this page will align it clause by clause.</div>}
      {compare.isPending && <div className="cc-alert" style={{ marginBottom: 18 }} role="status" data-testid="status-compare-pending"><ScanText size={16} /> Aligning clauses and diffing risk findings…</div>}
      {compare.isError && <div className="cc-alert cc-alert-error" role="alert" style={{ marginBottom: 18 }} data-testid="status-compare-error"><AlertCircle size={16} /> The comparison could not be built. <button type="button" className="cc-button cc-button-quiet" onClick={() => compare.mutate({ id, data: { against: baseId, perspective } })}>Try again</button></div>}
      {comparison && <ComparisonView comparison={comparison} visibleRows={visibleRows} totalRows={rows.length} changesOnly={changesOnly} leftPaneRef={leftPaneRef} rightPaneRef={rightPaneRef} onScroll={handleScroll} favourLabel={favourLabel} />}
    </main>
  );
}