import type {
  AlignableClause,
  ClauseAlignment,
  SimilarityBreakdown,
} from "../align";
import type { LLMProvider } from "../llm/base";
import type { RiskFinding, RiskPerspective, RiskSeverity } from "../rules/packV1";

export type ChangeLabel = "Added" | "Removed" | "Changed" | "Favors other party";
export type VersionChangeKind = "unchanged" | "changed" | "added" | "removed";

export type ClauseView = {
  id: string;
  ordinal: string;
  heading: string;
  type: string;
  text: string;
};

export type MaterialChangeNote = {
  available: boolean;
  fromCache: boolean;
  materiallyChanged: boolean;
  summary: string;
  favors: "partyA" | "partyB" | "neither";
  rationale: string;
};

export type FindingChangeStatus = "introduced" | "resolved" | "changed" | "unchanged";

export type FindingChange = {
  status: FindingChangeStatus;
  /** Omitted when the finding is unchanged, so no false "Changed" label appears. */
  label?: "Added" | "Removed" | "Changed";
  ruleId: string;
  title: string;
  severity: RiskSeverity;
  /** The party the rule warns about. */
  concerns: RiskPerspective;
  /** True when the change moves the risk onto the reader's side. */
  favorsOtherParty: boolean;
  message: string;
  beforeClauseId?: string;
  afterClauseId?: string;
};

export type ComparisonRow = {
  key: string;
  kind: VersionChangeKind;
  similarity: number;
  labels: ChangeLabel[];
  before?: ClauseView;
  after?: ClauseView;
  breakdown?: SimilarityBreakdown;
  materialChange?: MaterialChangeNote;
  findingChanges: FindingChange[];
};

export type VersionComparisonSummary = {
  totalRows: number;
  changedCount: number;
  addedCount: number;
  removedCount: number;
  unchangedCount: number;
  introducedRiskCount: number;
  resolvedRiskCount: number;
  favorsOtherPartyCount: number;
};

export type VersionDocument = {
  id: string;
  name: string;
  clauses: AlignableClause[];
};

export type VersionComparison = {
  base: { id: string; name: string };
  revised: { id: string; name: string };
  threshold: number;
  perspective: RiskPerspective;
  rows: ComparisonRow[];
  summary: VersionComparisonSummary;
};

export type CompareVersionsOptions = {
  perspective?: RiskPerspective;
  threshold?: number;
  minMatchScore?: number;
  provider?: LLMProvider;
  /** Set false for a fully deterministic, model-free comparison. */
  analyzeMaterialChanges?: boolean;
  model?: string;
};

export type BuildComparisonRowsInput = {
  alignment: ClauseAlignment;
  base: VersionDocument;
  revised: VersionDocument;
  perspective?: RiskPerspective;
  materialChanges?: Map<string, MaterialChangeNote>;
  findings?: ComparisonFindings;
};

export type ComparisonFindings = {
  before: Map<string, RiskFinding[]>;
  after: Map<string, RiskFinding[]>;
};