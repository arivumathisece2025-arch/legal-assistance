import { useEffect, useRef, useState, type FormEvent, type CSSProperties } from "react";
import {
  AlertCircle,
  ArrowLeft,
  ChevronRight,
  Fingerprint,
  MessageCircleQuestion,
  RotateCcw,
  ScanText,
  ShieldCheck,
  TriangleAlert,
  Check,
} from "lucide-react";
import { Link, useLocation, useParams } from "wouter";
import {
  getCsrfToken,
  useAnalyzeDocument,
  useAskQuestion,
  useGetDocument,
  useSimplifyDocument,
  getGetDocumentQueryKey,
} from "@workspace/api-client-react";
import { languageOptions, uiText, type UiLanguage } from "@/lib/i18n";
import { formatDate, SeverityBadge, StatusPill, type Severity, type Status } from "./shared";

export default function DocumentPage() {
  const { id = "" } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const {
    data: document,
    isLoading,
    isError,
    refetch,
  } = useGetDocument(id, { query: { queryKey: getGetDocumentQueryKey(id), enabled: Boolean(id) } });
  const analyzeDocument = useAnalyzeDocument();
  const simplifyDocument = useSimplifyDocument();
  const [question, setQuestion] = useState("");
  const [perspective, setPerspective] = useState<"party_a" | "party_b">("party_a");
  const [language, setLanguage] = useState<UiLanguage>("en");
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const texts = uiText[language];
  const askQuestion = useAskQuestion();

  useEffect(() => {
    globalThis.document.documentElement.lang = language;
  }, [language]);

  const readAnswerAloud = (answer: string) => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(answer);
    utterance.lang = language === "ta" ? "ta-IN" : language === "hi" ? "hi-IN" : "en-US";
    window.speechSynthesis.speak(utterance);
  };

  const handleVoiceInput = async () => {
    if (isRecording) {
      mediaRecorderRef.current?.stop();
      setIsRecording(false);
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) return;

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const recorder = new MediaRecorder(stream);
    audioChunksRef.current = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) audioChunksRef.current.push(event.data);
    };
    recorder.onstop = async () => {
      const blob = new Blob(audioChunksRef.current, { type: "audio/webm" });
      const formData = new FormData();
      formData.append("audio", blob, "voice.webm");
      formData.append("language", language);

      setIsTranscribing(true);
      try {
        const response = await fetch("/api/audio/transcribe", {
          method: "POST",
          headers: { "x-csrf-token": await getCsrfToken() },
          body: formData,
        });
        if (!response.ok) throw new Error("Unable to transcribe audio");
        const data = (await response.json()) as { text?: string };
        if (data.text)
          setQuestion((current) => `${current}${current ? " " : ""}${data.text}`.trim());
      } finally {
        setIsTranscribing(false);
      }
      stream.getTracks().forEach((track) => track.stop());
    };

    recorder.start();
    mediaRecorderRef.current = recorder;
    setIsRecording(true);
  };

  const handleAnalyze = () => {
    analyzeDocument.mutate(
      { id },
      {
        onSuccess: () => {
          void refetch();
        },
      },
    );
  };
  const submitQuestion = (event: FormEvent) => {
    event.preventDefault();
    if (!question.trim()) return;
    askQuestion.mutate({
      data: { documentId: id, question: question.trim(), perspective, language },
    });
  };

  if (isLoading) {
    return (
      <main className="cc-content">
        <div className="cc-skeleton cc-skeleton-doc-back" />
        <div className="cc-skeleton cc-skeleton-doc-title" />
        <div className="cc-skeleton cc-skeleton-doc-meta" />
        <div className="cc-analysis-grid">
          <div className="cc-panel cc-panel-pad">
            <div className="cc-skeleton cc-skeleton-section-title" />
            {[1, 2, 3].map((item) => (
              <div key={item} className="cc-skeleton-clause-row">
                <div className="cc-skeleton cc-skeleton-clause-title" />
                <div className="cc-skeleton cc-skeleton-clause-text" />
              </div>
            ))}
          </div>
          <div className="cc-panel cc-skeleton-side-panel" />
        </div>
      </main>
    );
  }
  if (isError || !document)
    return (
      <main className="cc-content">
        <div className="cc-alert cc-alert-error" role="alert" data-testid="status-document-error">
          <AlertCircle size={16} /> This workspace is unavailable.{" "}
          <button
            type="button"
            className="cc-button cc-button-quiet"
            onClick={() => refetch()}
            data-testid="button-retry-document"
          >
            <RotateCcw size={14} /> Try again
          </button>
        </div>
      </main>
    );

  const score = Math.max(0, Math.min(100, document.riskScore || 0));
  return (
    <main className="cc-content">
      <Link href="/" className="cc-back" data-testid="link-back-inbox">
        <ArrowLeft size={14} /> Back to inbox
      </Link>
      <header className="cc-detail-header">
        <div>
          <div className="cc-kicker">Document analysis</div>
          <h1 className="cc-detail-title" data-testid="text-document-name">
            {document.name}
          </h1>
          <div className="cc-detail-sub">
            <span>{document.fileType.split("/").pop()?.toUpperCase() || "DOCUMENT"}</span>
            <span>{document.pageCount} pages</span>
            <span>Added {formatDate(document.uploadedAt)}</span>
            <StatusPill status={document.status as Status} />
          </div>
        </div>
        <div className="cc-detail-actions">
          {document.status !== "ready" && (
            <button
              className="cc-button cc-button-primary"
              type="button"
              onClick={handleAnalyze}
              disabled={analyzeDocument.isPending}
              data-testid="button-analyze-document"
            >
              <ScanText size={15} /> {analyzeDocument.isPending ? "Reading…" : "Analyze document"}
            </button>
          )}
          <button
            className="cc-button cc-button-soft"
            type="button"
            onClick={() => simplifyDocument.mutate({ id, data: { language } })}
            disabled={simplifyDocument.isPending || !document.clauses.length}
            data-testid="button-simplify-document"
          >
            {simplifyDocument.isPending ? "Simplifying…" : "Simplify"}
          </button>
          <button
            className="cc-button cc-button-soft"
            type="button"
            onClick={() => setLocation(`/documents/${id}/brief`)}
            data-testid="button-lawyer-prep-brief"
          >
            Lawyer Prep Brief
          </button>
          <button
            className="cc-button cc-button-soft"
            type="button"
            onClick={() => setLocation(`/documents/${id}/compare`)}
            data-testid="button-compare-versions"
          >
            Compare versions
          </button>
          <button
            className="cc-button cc-button-soft"
            type="button"
            onClick={() => setLocation("/")}
            data-testid="button-close-document"
          >
            Close
          </button>
        </div>
      </header>

      {analyzeDocument.isError && (
        <div
          className="cc-alert cc-alert-error cc-analysis-error"
          role="alert"
          data-testid="status-analysis-error"
        >
          <AlertCircle size={16} /> Analysis could not start. Please try again.
        </div>
      )}
      {document.status === "analyzing" && (
        <div className="cc-alert cc-analysis-progress" data-testid="status-analysis-progress">
          <ScanText size={16} /> We are reading the structure of this document. You can leave this
          page and come back.
        </div>
      )}

      <div className="cc-analysis-grid">
        <section className="cc-panel cc-panel-pad" aria-labelledby="clauses-heading">
          <div className="cc-panel-head">
            <div>
              <h2 id="clauses-heading">What this document says</h2>
              <p>{document.clauseCount} clauses organized for a human first read</p>
            </div>
            <span className="cc-kicker">
              {document.status === "ready" ? "Grounded view" : "Waiting for analysis"}
            </span>
          </div>
          {document.clauses?.length ? (
            <div className="cc-clause-list">
              {document.clauses.map((clause) => (
                <article className="cc-clause" key={clause.id} data-testid={`clause-${clause.id}`}>
                  <div className="cc-clause-top">
                    <div>
                      <span className="cc-clause-id">{clause.ordinal}</span>
                      <h3>{clause.heading}</h3>
                    </div>
                    <SeverityBadge severity={clause.severity as Severity} />
                  </div>
                  <p className="cc-clause-summary">{clause.summary}</p>
                  <details className="cc-clause-details">
                    <summary
                      className="cc-clause-summary-toggle"
                      data-testid={`button-expand-clause-${clause.id}`}
                    >
                      Show document language
                    </summary>
                    <blockquote className="cc-clause-text">{clause.text}</blockquote>
                  </details>
                </article>
              ))}
            </div>
          ) : (
            <div className="cc-empty cc-empty-clauses" data-testid="status-clauses-empty">
              <ScanText size={24} className="cc-empty-icon" />
              <h3>Analysis will appear here.</h3>
              <p>
                Start a document analysis to organize its clauses and surface places worth asking
                about.
              </p>
              <button
                type="button"
                className="cc-button cc-button-primary"
                onClick={handleAnalyze}
                disabled={analyzeDocument.isPending}
                data-testid="button-analyze-empty"
              >
                Analyze now
              </button>
            </div>
          )}
        </section>

        <aside className="cc-side-stack">
          <section className="cc-panel cc-panel-pad" aria-labelledby="risk-heading">
            <div className="cc-panel-head">
              <div>
                <h2 id="risk-heading">Risk profile</h2>
                <p>A reading aid, not a verdict</p>
              </div>
              <ShieldCheck size={18} color="hsl(var(--primary))" />
            </div>
            <div className="cc-risk-score">
              <div className="cc-score-ring" style={{ "--score": `${score}%` } as CSSProperties}>
                <span className="cc-score-number" data-testid="text-risk-score">
                  {document.status === "ready" ? score : "—"}
                </span>
              </div>
              <div>
                <strong>
                  {document.status === "ready"
                    ? score > 66
                      ? "Worth a closer look"
                      : score > 33
                        ? "Some points to revisit"
                        : "Mostly straightforward"
                    : "Not assessed yet"}
                </strong>
                <p>
                  {document.status === "ready"
                    ? "Higher scores reflect more clauses marked for review."
                    : "Run analysis to build a profile from the text."}
                </p>
              </div>
            </div>
            <div className="cc-mini-stat-grid">
              <div className="cc-mini-stat">
                <b>{document.highRiskCount || 0}</b>
                <span>High attention clauses</span>
              </div>
              <div className="cc-mini-stat">
                <b>{document.clauseCount || 0}</b>
                <span>Total clauses</span>
              </div>
            </div>
          </section>
          <section className="cc-panel cc-panel-pad" aria-labelledby="security-heading">
            <div className="cc-panel-head">
              <div>
                <h2 id="security-heading">Document notes</h2>
                <p>Signals about the source file</p>
              </div>
              <Fingerprint size={17} color="hsl(var(--primary))" />
            </div>
            {document.scannedDetected && (
              <div className="cc-finding">
                <ScanText size={15} />
                <div>
                  <strong>Scanned text detected</strong>
                  <p>Some content may be harder to read accurately. Check the original page.</p>
                </div>
              </div>
            )}
            {document.securityFindings?.length ? (
              document.securityFindings.map((finding, index) => (
                <div className="cc-finding" key={`${finding.label}-${index}`}>
                  <TriangleAlert size={15} />
                  <div>
                    <strong>{finding.label}</strong>
                    <p>
                      {finding.detail} · p. {finding.page}
                    </p>
                  </div>
                </div>
              ))
            ) : !document.scannedDetected ? (
              <div className="cc-finding">
                <Check size={15} color="hsl(156 38% 45%)" />
                <div>
                  <strong>No file signals found</strong>
                  <p>This is a note about processing, not a security guarantee.</p>
                </div>
              </div>
            ) : null}
          </section>
        </aside>
      </div>

      {simplifyDocument.data?.items.length ? (
        <section
          className="cc-panel cc-panel-pad"
          aria-labelledby="simplify-heading"
          data-testid="simplify-response"
        >
          <div className="cc-panel-head">
            <div>
              <h2 id="simplify-heading">Plain-language rewrite</h2>
              <p>Review the original clause before relying on any rewrite.</p>
            </div>
          </div>
          {simplifyDocument.data.items.map((item) => (
            <article className="cc-clause" key={`${item.clauseId}-${item.level}`}>
              <h3>{item.level.replaceAll("-", " ")}</h3>
              <p>{item.text}</p>
              {item.flagged && <p role="alert">Check this rewrite: {item.issues.join("; ")}</p>}
            </article>
          ))}
        </section>
      ) : null}
      {simplifyDocument.isError && (
        <div className="cc-alert cc-alert-error" role="alert" data-testid="status-simplify-error">
          <AlertCircle size={16} /> Plain-language rewrite failed. Please try again.
        </div>
      )}

      <section className="cc-panel cc-question-panel" aria-labelledby="question-heading">
        <div className="cc-panel-pad">
          <div className="cc-question-heading">
            <MessageCircleQuestion size={22} color="hsl(var(--primary))" />
            <div>
              <h2 className="cc-question-title" id="question-heading">
                Ask from your side of the table
              </h2>
              <p className="cc-question-note">
                Answers stay anchored to this document. Ask what a phrase means, where a
                responsibility sits, or what to bring to your lawyer.
              </p>
            </div>
          </div>
          <form onSubmit={submitQuestion} className="cc-question-form">
            <label className="cc-field-label" htmlFor="question">
              {texts.questionLabel}
            </label>
            <textarea
              id="question"
              className="cc-textarea"
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder="For example: What happens if I need to end this agreement early?"
              disabled={askQuestion.isPending}
              data-testid="input-question"
            />
            <div className="cc-form-row cc-question-options">
              <div>
                <label className="cc-field-label" htmlFor="language">
                  {texts.languageLabel}
                </label>
                <select
                  id="language"
                  className="cc-select"
                  value={language}
                  onChange={(event) => setLanguage(event.target.value as UiLanguage)}
                  data-testid="select-language"
                >
                  {languageOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="cc-field-label" htmlFor="perspective">
                  I am reading as
                </label>
                <select
                  id="perspective"
                  className="cc-select"
                  value={perspective}
                  onChange={(event) => setPerspective(event.target.value as "party_a" | "party_b")}
                  data-testid="select-perspective"
                >
                  <option value="party_a">Party A</option>
                  <option value="party_b">Party B</option>
                </select>
              </div>
              <button
                className="cc-button cc-button-soft"
                type="button"
                onClick={handleVoiceInput}
                disabled={isTranscribing}
                data-testid="button-voice-input"
              >
                {isRecording ? "Stop" : isTranscribing ? "Transcribing…" : texts.micLabel}
              </button>
              <button
                className="cc-button cc-button-primary"
                type="submit"
                disabled={!question.trim() || askQuestion.isPending}
                data-testid="button-ask-question"
              >
                {askQuestion.isPending ? "Thinking…" : "Ask question"} <ChevronRight size={15} />
              </button>
            </div>
          </form>
          {askQuestion.isError && (
            <div
              className="cc-alert cc-alert-error cc-question-error"
              role="alert"
              data-testid="status-question-error"
            >
              <AlertCircle size={15} /> We could not answer from this document. Try rephrasing your
              question.
            </div>
          )}
          {askQuestion.data && (
            <div className="cc-answer" data-testid="answer-response">
              <div className="cc-answer-head">
                <span className="cc-answer-label">
                  {askQuestion.data.queued ? "Answer queued" : texts.answerLabel}
                </span>
                <span className="cc-grounding">
                  {Math.round(askQuestion.data.groundingRatio * 100)}% grounded
                </span>
              </div>
              <p>{askQuestion.data.answer}</p>
              <button
                className="cc-button cc-button-soft"
                type="button"
                onClick={() => readAnswerAloud(askQuestion.data.answer)}
              >
                {texts.readAloud}
              </button>
              <div className="cc-citations">
                {askQuestion.data.citations.map((citation) => (
                  <span className="cc-citation" key={`${citation.clauseId}-${citation.label}`}>
                    {citation.label}
                  </span>
                ))}
              </div>
            </div>
          )}
          <div className="cc-disclaimer">
            <ShieldCheck size={14} /> Clause Compass can explain the document’s words, but it cannot
            determine what is legally right for you. Treat every answer as preparation for a
            conversation with a qualified lawyer.
          </div>
        </div>
      </section>
    </main>
  );
}
