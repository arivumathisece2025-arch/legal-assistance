import { useMemo, useRef, useState, type ReactNode, type ChangeEvent, type FormEvent } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, ArrowLeft, ArrowUpRight, BookOpen, Check, ChevronRight, CircleHelp, FileText, Fingerprint, LockKeyhole, Menu, MessageCircleQuestion, RotateCcw, ScanText, ShieldCheck, Upload, X, TriangleAlert } from 'lucide-react';
import { Link, Route, Switch, useLocation, useParams, Router as WouterRouter } from 'wouter';
import { useAnalyzeDocument, useAskQuestion, useCreateDocument, useGetDocument, useListDocuments, getGetDocumentQueryKey, getListDocumentsQueryKey } from '@workspace/api-client-react';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';

const queryClient = new QueryClient();

type Severity = 'low' | 'medium' | 'high';
type Status = 'uploaded' | 'analyzing' | 'ready';

function Logo() {
  return (
    <Link href="/" className="cc-brand" data-testid="link-brand">
      <span className="cc-mark" aria-hidden="true" />
      <span>
        <span className="cc-brand-name">Clause Compass</span>
        <span className="cc-brand-note">read with confidence</span>
      </span>
    </Link>
  );
}

function Shell({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const homeActive = location === '/';
  return (
    <div className="cc-app">
      <div className="cc-shell">
        <aside className="cc-sidebar" aria-label="Primary navigation">
          <Logo />
          <nav className="cc-nav">
            <Link href="/" className="cc-nav-link" data-active={homeActive} data-testid="link-inbox">
              <BookOpen size={16} strokeWidth={1.8} /> <span>Contract inbox</span>
            </Link>
            <Link href="/accessibility" className="cc-nav-link" data-active={location === '/accessibility'} data-testid="link-accessibility">
              <ScanText size={16} strokeWidth={1.8} /> <span>Accessibility</span>
            </Link>
          </nav>
          <div className="cc-sidebar-footer">
            <div style={{ display: 'flex', gap: 7, alignItems: 'center', marginBottom: 7 }}>
              <LockKeyhole size={13} />
              <strong style={{ color: 'hsl(42 33% 94%)', fontSize: 11 }}>Private by design</strong>
            </div>
            Documents are processed to explain what is on the page, not to make decisions for you.
            <div style={{ marginTop: 12 }}><Link href="/accessibility" data-testid="link-sidebar-accessibility">Read our limitations →</Link></div>
          </div>
        </aside>
        <div className="cc-main">
          <header className="cc-topbar">
            <span className="cc-kicker">{location.startsWith('/documents/') ? 'Document workspace' : location === '/accessibility' ? 'About the workspace' : 'Your private workspace'}</span>
            <div className="cc-topbar-right">
              <span className="cc-privacy-chip"><span className="cc-privacy-dot" aria-hidden="true" /> Private session</span>
              <button className="cc-icon-button" type="button" aria-label="Help and guidance" title="Help and guidance" data-testid="button-help">
                <CircleHelp size={16} />
              </button>
            </div>
          </header>
          <div className="cc-mobile-nav">
            <Link href="/" className="cc-nav-link" data-active={homeActive} data-testid="link-mobile-inbox"><BookOpen size={14} /> Inbox</Link>
            <Link href="/accessibility" className="cc-nav-link" data-active={location === '/accessibility'} data-testid="link-mobile-accessibility"><ScanText size={14} /> Accessibility</Link>
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}

function formatDate(value?: string) {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric' }).format(parsed);
}

function StatusPill({ status }: { status: Status }) {
  const labels: Record<Status, string> = { uploaded: 'Uploaded', analyzing: 'Analyzing', ready: 'Ready' };
  return <span className={`cc-status cc-status-${status}`}><span aria-hidden="true">●</span> {labels[status]}</span>;
}

function SeverityBadge({ severity }: { severity: Severity }) {
  const Icon = severity === 'high' ? TriangleAlert : severity === 'medium' ? AlertCircle : Check;
  return <span className={`cc-severity cc-severity-${severity}`}><Icon size={12} aria-hidden="true" /> {severity} risk</span>;
}

function HomePage() {
  const [location, setLocation] = useLocation();
  const fileRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadError, setUploadError] = useState('');
  const { data: documents, isLoading, isError, refetch } = useListDocuments();
  const createDocument = useCreateDocument();
  const queryClientInstance = useQueryClient();

  const handleFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setUploadError('');
    setSelectedFile(file);
  };

  const handleUpload = () => {
    if (!selectedFile) {
      fileRef.current?.click();
      return;
    }
    createDocument.mutate({
      data: { name: selectedFile.name, fileType: selectedFile.type || 'application/pdf', sizeBytes: selectedFile.size },
    }, {
      onSuccess: (document) => {
        queryClientInstance.invalidateQueries({ queryKey: getListDocumentsQueryKey() });
        setSelectedFile(null);
        if (fileRef.current) fileRef.current.value = '';
        setLocation(`/documents/${document.id}`);
      },
      onError: () => setUploadError('We could not add that file. Please try again, or choose another PDF or DOCX.'),
    });
  };

  return (
    <main className="cc-content">
      <section className="cc-hero">
        <div>
          <div className="cc-kicker">A clearer first read</div>
          <h1 className="cc-title">Make the fine print<br /><em>feel navigable.</em></h1>
          <p className="cc-lede">Clause Compass turns a contract into a calm, grounded conversation starter — so you can arrive at legal advice with better questions.</p>
        </div>
        <button className="cc-button cc-button-primary" type="button" onClick={() => fileRef.current?.click()} data-testid="button-upload-top">
          <Upload size={16} /> Add a document
        </button>
      </section>

      <section className="cc-upload" aria-label="Upload a contract">
        <div className="cc-upload-copy">
          <div className="cc-upload-icon"><Upload size={18} /></div>
          <div>
            <strong>{selectedFile ? selectedFile.name : 'Bring a contract into focus'}</strong>
            <span>{selectedFile ? `${Math.max(1, Math.round(selectedFile.size / 1024))} KB selected · ready to read` : 'PDF or DOCX · processed in your private workspace'}</span>
          </div>
          {selectedFile && <button type="button" className="cc-icon-button" aria-label="Remove selected file" title="Remove selected file" onClick={() => { setSelectedFile(null); if (fileRef.current) fileRef.current.value = ''; }} data-testid="button-remove-file"><X size={15} /></button>}
        </div>
        <input ref={fileRef} type="file" accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={handleFile} hidden data-testid="input-file" />
        <button className="cc-button cc-button-primary" type="button" onClick={handleUpload} disabled={createDocument.isPending} data-testid="button-upload-document">
          {createDocument.isPending ? 'Adding…' : selectedFile ? 'Create workspace' : 'Choose a file'}
        </button>
      </section>

      {uploadError && <div className="cc-alert cc-alert-error" role="alert" style={{ marginBottom: 20 }} data-testid="status-upload-error"><AlertCircle size={16} /> {uploadError}</div>}

      <section aria-labelledby="documents-heading">
        <div className="cc-section-head">
          <h2 className="cc-section-title" id="documents-heading">Your documents</h2>
          <span className="cc-section-meta">{documents?.length ?? 0} {documents?.length === 1 ? 'workspace' : 'workspaces'}</span>
        </div>
        {isLoading && <div className="cc-document-list" aria-label="Loading documents" data-testid="status-documents-loading">{[1, 2, 3].map((item) => <div className="cc-document-card" key={item}><div className="cc-skeleton" style={{ height: 42 }} /><div className="cc-skeleton" style={{ height: 30 }} /><div className="cc-skeleton" style={{ height: 30 }} /><div className="cc-skeleton" style={{ height: 30 }} /></div>)}</div>}
        {isError && <div className="cc-alert cc-alert-error" role="alert" data-testid="status-documents-error"><AlertCircle size={16} /> We could not load your documents. <button type="button" className="cc-button cc-button-quiet" onClick={() => refetch()} data-testid="button-retry-documents"><RotateCcw size={14} /> Try again</button></div>}
        {!isLoading && !isError && documents?.length === 0 && <div className="cc-empty" data-testid="status-documents-empty"><FileText size={27} className="cc-empty-icon" /><h3>Your reading desk is clear.</h3><p>Add a contract to see its clauses, risk signals, and a place to ask grounded questions.</p><button type="button" className="cc-button cc-button-soft" onClick={() => fileRef.current?.click()} data-testid="button-upload-empty"><Upload size={15} /> Add your first document</button></div>}
        {!isLoading && !isError && !!documents?.length && <div className="cc-document-list" data-testid="list-documents">
          {documents.map((document, index) => <Link href={`/documents/${document.id}`} className="cc-document-card" key={document.id} style={{ animationDelay: `${index * 45}ms` }} data-testid={`card-document-${document.id}`}>
            <div className="cc-document-name"><span className="cc-file-icon"><FileText size={17} /></span><span><strong>{document.name}</strong><small>{document.fileType.split('/').pop()?.toUpperCase() || 'DOCUMENT'} · Added {formatDate(document.uploadedAt)}</small></span></div>
            <div><span className="cc-stat-label">Pages</span><span className="cc-stat-value">{document.pageCount || '—'}</span></div>
            <div><span className="cc-stat-label">Clauses</span><span className="cc-stat-value">{document.clauseCount || '—'}</span></div>
            <div><span className="cc-stat-label">Risk</span><span className="cc-stat-value">{document.status === 'ready' ? `${document.riskScore}/100` : 'Pending'}</span></div>
            <div><StatusPill status={document.status as Status} /></div>
            <ArrowUpRight size={15} color="hsl(var(--muted-foreground))" aria-hidden="true" />
          </Link>)}
        </div>}
      </section>

      <section style={{ marginTop: 42, paddingTop: 21, borderTop: '1px solid hsl(var(--border))', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
        <ShieldCheck size={17} color="hsl(var(--primary))" />
        <p style={{ margin: 0, color: 'hsl(var(--muted-foreground))', fontSize: 11, lineHeight: 1.55, maxWidth: 650 }}>Clause Compass explains language that appears in your document. It does not provide legal advice, predict an outcome, or replace a lawyer’s judgment.</p>
      </section>
    </main>
  );
}

function DocumentPage() {
  const { id = '' } = useParams<{ id: string }>();
  const [location, setLocation] = useLocation();
  const queryClientInstance = useQueryClient();
  const { data: document, isLoading, isError, refetch } = useGetDocument(id, { query: { queryKey: getGetDocumentQueryKey(id), enabled: Boolean(id) } });
  const analyzeDocument = useAnalyzeDocument();
  const [question, setQuestion] = useState('');
  const [perspective, setPerspective] = useState<'party_a' | 'party_b'>('party_a');
  const askQuestion = useAskQuestion();

  const handleAnalyze = () => {
    analyzeDocument.mutate({ id }, {
      onSuccess: () => {
        queryClientInstance.invalidateQueries({ queryKey: getGetDocumentQueryKey(id) });
        queryClientInstance.invalidateQueries({ queryKey: getListDocumentsQueryKey() });
      },
    });
  };
  const submitQuestion = (event: FormEvent) => {
    event.preventDefault();
    if (!question.trim()) return;
    askQuestion.mutate({ data: { documentId: id, question: question.trim(), perspective } });
  };

  if (isLoading) return <main className="cc-content"><div className="cc-skeleton" style={{ width: 88, height: 14, marginBottom: 24 }} /><div className="cc-skeleton" style={{ width: '60%', height: 52, marginBottom: 10 }} /><div className="cc-skeleton" style={{ width: '35%', height: 17, marginBottom: 35 }} /><div className="cc-analysis-grid"><div className="cc-panel cc-panel-pad"><div className="cc-skeleton" style={{ width: '35%', height: 20, marginBottom: 22 }} />{[1,2,3].map(item => <div key={item} style={{ padding: '25px 0', borderTop: '1px solid hsl(var(--border))' }}><div className="cc-skeleton" style={{ width: '55%', height: 18, marginBottom: 12 }} /><div className="cc-skeleton" style={{ width: '90%', height: 42 }} /></div>)}</div><div className="cc-panel" style={{ height: 260 }} /></div></main>;
  if (isError || !document) return <main className="cc-content"><div className="cc-alert cc-alert-error" role="alert" data-testid="status-document-error"><AlertCircle size={16} /> This workspace is unavailable. <button type="button" className="cc-button cc-button-quiet" onClick={() => refetch()} data-testid="button-retry-document"><RotateCcw size={14} /> Try again</button></div></main>;

  const score = Math.max(0, Math.min(100, document.riskScore || 0));
  return (
    <main className="cc-content">
      <Link href="/" className="cc-back" data-testid="link-back-inbox"><ArrowLeft size={14} /> Back to inbox</Link>
      <header className="cc-detail-header">
        <div>
          <div className="cc-kicker">Document analysis</div>
          <h1 className="cc-detail-title" data-testid="text-document-name">{document.name}</h1>
          <div className="cc-detail-sub"><span>{document.fileType.split('/').pop()?.toUpperCase() || 'DOCUMENT'}</span><span>{document.pageCount} pages</span><span>Added {formatDate(document.uploadedAt)}</span><StatusPill status={document.status as Status} /></div>
        </div>
        <div className="cc-detail-actions">
          {document.status !== 'ready' && <button className="cc-button cc-button-primary" type="button" onClick={handleAnalyze} disabled={analyzeDocument.isPending} data-testid="button-analyze-document"><ScanText size={15} /> {analyzeDocument.isPending ? 'Reading…' : 'Analyze document'}</button>}
          <button className="cc-button cc-button-soft" type="button" onClick={() => setLocation('/')} data-testid="button-close-document">Close</button>
        </div>
      </header>

      {analyzeDocument.isError && <div className="cc-alert cc-alert-error" role="alert" style={{ marginBottom: 18 }} data-testid="status-analysis-error"><AlertCircle size={16} /> Analysis could not start. Please try again.</div>}
      {document.status === 'analyzing' && <div className="cc-alert" style={{ marginBottom: 18, color: 'hsl(26 50% 29%)', background: 'hsl(31 75% 61% / .12)', borderColor: 'hsl(31 75% 61% / .35)' }} data-testid="status-analysis-progress"><ScanText size={16} /> We are reading the structure of this document. You can leave this page and come back.</div>}

      <div className="cc-analysis-grid">
        <section className="cc-panel cc-panel-pad" aria-labelledby="clauses-heading">
          <div className="cc-panel-head"><div><h2 id="clauses-heading">What this document says</h2><p>{document.clauseCount} clauses organized for a human first read</p></div><span className="cc-kicker">{document.status === 'ready' ? 'Grounded view' : 'Waiting for analysis'}</span></div>
          {document.clauses?.length ? <div className="cc-clause-list">{document.clauses.map((clause) => <article className="cc-clause" key={clause.id} data-testid={`clause-${clause.id}`}>
            <div className="cc-clause-top"><div><span className="cc-clause-id">{clause.ordinal}</span><h3>{clause.heading}</h3></div><SeverityBadge severity={clause.severity as Severity} /></div>
            <p className="cc-clause-summary">{clause.summary}</p>
            <details style={{ marginTop: 11 }}><summary style={{ color: 'hsl(var(--primary))', fontSize: 11, cursor: 'pointer' }} data-testid={`button-expand-clause-${clause.id}`}>Show document language</summary><blockquote className="cc-clause-text">{clause.text}</blockquote></details>
          </article>)}</div> : <div className="cc-empty" style={{ marginTop: 20 }} data-testid="status-clauses-empty"><ScanText size={24} className="cc-empty-icon" /><h3>Analysis will appear here.</h3><p>Start a document analysis to organize its clauses and surface places worth asking about.</p><button type="button" className="cc-button cc-button-primary" onClick={handleAnalyze} disabled={analyzeDocument.isPending} data-testid="button-analyze-empty">Analyze now</button></div>}
        </section>

        <aside className="cc-side-stack">
          <section className="cc-panel cc-panel-pad" aria-labelledby="risk-heading">
            <div className="cc-panel-head"><div><h2 id="risk-heading">Risk profile</h2><p>A reading aid, not a verdict</p></div><ShieldCheck size={18} color="hsl(var(--primary))" /></div>
            <div className="cc-risk-score">
              <div className="cc-score-ring" style={{ '--score': `${score}%` } as React.CSSProperties}><span className="cc-score-number" data-testid="text-risk-score">{document.status === 'ready' ? score : '—'}</span></div>
              <div><strong>{document.status === 'ready' ? (score > 66 ? 'Worth a closer look' : score > 33 ? 'Some points to revisit' : 'Mostly straightforward') : 'Not assessed yet'}</strong><p>{document.status === 'ready' ? 'Higher scores reflect more clauses marked for review.' : 'Run analysis to build a profile from the text.'}</p></div>
            </div>
            <div className="cc-mini-stat-grid"><div className="cc-mini-stat"><b>{document.highRiskCount || 0}</b><span>High attention clauses</span></div><div className="cc-mini-stat"><b>{document.clauseCount || 0}</b><span>Total clauses</span></div></div>
          </section>
          <section className="cc-panel cc-panel-pad" aria-labelledby="security-heading">
            <div className="cc-panel-head"><div><h2 id="security-heading">Document notes</h2><p>Signals about the source file</p></div><Fingerprint size={17} color="hsl(var(--primary))" /></div>
            {document.scannedDetected && <div className="cc-finding"><ScanText size={15} /><div><strong>Scanned text detected</strong><p>Some content may be harder to read accurately. Check the original page.</p></div></div>}
            {document.securityFindings?.length ? document.securityFindings.map((finding, index) => <div className="cc-finding" key={`${finding.label}-${index}`}><TriangleAlert size={15} /><div><strong>{finding.label}</strong><p>{finding.detail} · p. {finding.page}</p></div></div>) : !document.scannedDetected ? <div className="cc-finding"><Check size={15} color="hsl(156 38% 45%)" /><div><strong>No file signals found</strong><p>This is a note about processing, not a security guarantee.</p></div></div> : null}
          </section>
        </aside>
      </div>

      <section className="cc-panel cc-question-panel" aria-labelledby="question-heading">
        <div className="cc-panel-pad">
          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}><MessageCircleQuestion size={22} color="hsl(var(--primary))" /><div><h2 className="cc-question-title" id="question-heading">Ask from your side of the table</h2><p className="cc-question-note">Answers stay anchored to this document. Ask what a phrase means, where a responsibility sits, or what to bring to your lawyer.</p></div></div>
          <form onSubmit={submitQuestion} style={{ marginTop: 16 }}>
            <label className="cc-field-label" htmlFor="question">Your question</label>
            <textarea id="question" className="cc-textarea" value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="For example: What happens if I need to end this agreement early?" disabled={askQuestion.isPending} data-testid="input-question" />
            <div className="cc-form-row" style={{ marginTop: 10 }}>
              <div><label className="cc-field-label" htmlFor="perspective">I am reading as</label><select id="perspective" className="cc-select" value={perspective} onChange={(event) => setPerspective(event.target.value as 'party_a' | 'party_b')} data-testid="select-perspective"><option value="party_a">Party A</option><option value="party_b">Party B</option></select></div>
              <button className="cc-button cc-button-primary" type="submit" disabled={!question.trim() || askQuestion.isPending} data-testid="button-ask-question">{askQuestion.isPending ? 'Thinking…' : 'Ask question'} <ChevronRight size={15} /></button>
            </div>
          </form>
          {askQuestion.isError && <div className="cc-alert cc-alert-error" role="alert" style={{ marginTop: 15 }} data-testid="status-question-error"><AlertCircle size={15} /> We could not answer from this document. Try rephrasing your question.</div>}
          {askQuestion.data && <div className="cc-answer" data-testid="answer-response"><div className="cc-answer-head"><span className="cc-answer-label">{askQuestion.data.queued ? 'Answer queued' : 'Grounded answer'}</span><span className="cc-grounding">{Math.round(askQuestion.data.groundingRatio * 100)}% grounded</span></div><p>{askQuestion.data.answer}</p><div className="cc-citations">{askQuestion.data.citations.map((citation) => <span className="cc-citation" key={`${citation.clauseId}-${citation.label}`}>{citation.label}</span>)}</div></div>}
          <div className="cc-disclaimer"><ShieldCheck size={14} /> Clause Compass can explain the document’s words, but it cannot determine what is legally right for you. Treat every answer as preparation for a conversation with a qualified lawyer.</div>
        </div>
      </section>
    </main>
  );
}

function AccessibilityPage() {
  return <main className="cc-content"><div className="cc-prose"><div className="cc-kicker">Accessibility statement</div><h1>A workspace that leaves room for people.</h1><p>Clause Compass is designed for careful reading, different ways of navigating, and the moments when a document feels like too much. We are working toward WCAG 2.2 AA and document the gaps plainly.</p><h2>What we support today</h2><div className="cc-limitations"><div className="cc-limit-card"><KeyboardIcon /><strong>Keyboard-first navigation</strong><span>Controls, links, forms, and expandable clauses can be reached and operated without a mouse.</span></div><div className="cc-limit-card"><EyeIcon /><strong>Visible, non-color cues</strong><span>Risk levels pair color with icons and plain-language labels. Focus states remain visible.</span></div><div className="cc-limit-card"><MessageCircleQuestion size={20} /><strong>Readable explanations</strong><span>Questions and answers use short paragraphs, descriptive labels, and grounded citations.</span></div><div className="cc-limit-card"><ShieldCheck size={20} /><strong>Reduced motion</strong><span>Decorative movement is disabled when your device asks for reduced motion.</span></div></div><h2>Known limitations</h2><ul><li>Scanned or image-only documents may not be read with the same reliability as selectable text. We flag this when detected.</li><li>The original document’s accessibility is outside our control. Always refer back to the source file for exact layout, signatures, and visual context.</li><li>Generated explanations are not legal advice and should not be used as a substitute for a qualified lawyer.</li></ul><h2>Tell us what got in the way</h2><p>If a control, explanation, or document state was difficult to use, please share the detail with the person supporting your Clause Compass workspace. Specific page names and steps help us make a better fix.</p><Link href="/" className="cc-button cc-button-primary" style={{ marginTop: 9 }} data-testid="link-accessibility-back"><ArrowLeft size={15} /> Back to contract inbox</Link></div></main>;
}

function KeyboardIcon() { return <Menu size={20} aria-hidden="true" />; }
function EyeIcon() { return <ScanText size={20} aria-hidden="true" />; }

function Router() {
  const [location] = useLocation();
  return <Shell><ErrorBoundary resetKey={location}><Switch><Route path="/" component={HomePage} /><Route path="/documents/:id" component={DocumentPage} /><Route path="/accessibility" component={AccessibilityPage} /><Route component={NotFound} /></Switch></ErrorBoundary></Shell>;
}

function App() {
  return <QueryClientProvider client={queryClient}><TooltipProvider><WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}><Router /></WouterRouter><Toaster /></TooltipProvider></QueryClientProvider>;
}

export default App;