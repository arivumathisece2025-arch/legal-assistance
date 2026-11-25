import { AlertCircle, ArrowLeft, BookOpen } from "lucide-react";
import { Link, useParams } from "wouter";
import { useGetDocument, getGetDocumentQueryKey } from "@workspace/api-client-react";
import { buildLawyerPrepBrief } from "@workspace/core/exports";
import { evaluateDocumentRisk } from "@workspace/core/rules";

export default function LawyerPrepBriefPage() {
  const { id = "" } = useParams<{ id: string }>();
  const {
    data: document,
    isLoading,
    isError,
  } = useGetDocument(id, { query: { queryKey: getGetDocumentQueryKey(id), enabled: Boolean(id) } });

  if (isLoading)
    return (
      <main className="cc-content">
        <div className="cc-skeleton cc-skeleton-brief-back" />
        <div className="cc-skeleton cc-skeleton-brief-title" />
        <div className="cc-skeleton cc-skeleton-brief-meta" />
      </main>
    );
  if (isError || !document)
    return (
      <main className="cc-content">
        <div className="cc-alert cc-alert-error" role="alert">
          <AlertCircle size={16} /> This brief is unavailable.
        </div>
      </main>
    );

  const riskClauses: Parameters<typeof evaluateDocumentRisk>[0] = document.clauses.map(
    (clause, index) => ({
      id: clause.id,
      ordinal: clause.ordinal,
      heading: clause.heading,
      type: clause.type || "other",
      text: clause.text,
      page: 1,
      charStart: index,
      charEnd: index + clause.text.length,
    }),
  );
  const riskProfile = evaluateDocumentRisk(riskClauses, "both");
  const brief = buildLawyerPrepBrief({
    documentName: document.name,
    parties: ["Party A", "Party B"],
    findings: riskProfile,
    obligations: [],
    unresolvedInconsistencies: [
      "Confirm whether governing law and forum selection are intentionally aligned.",
      "Check any undefined shorthand or clause cross-reference before signature.",
    ],
  });

  return (
    <main className="cc-content">
      <Link href={`/documents/${id}`} className="cc-back" data-testid="link-back-document">
        <ArrowLeft size={14} /> Back to document
      </Link>
      <section className="cc-panel cc-panel-pad cc-brief-panel">
        <div className="cc-panel-head">
          <div>
            <h1>Lawyer Prep Brief</h1>
            <p>{document.name}</p>
          </div>
          <BookOpen size={18} color="hsl(var(--primary))" />
        </div>
        <pre className="cc-brief-content">
          {brief}
        </pre>
      </section>
    </main>
  );
}
