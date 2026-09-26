import { useEffect, useMemo, useRef, useState, type ReactNode, type ChangeEvent, type FormEvent, type RefObject } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, ArrowLeft, ArrowUpRight, BookOpen, Check, ChevronRight, CircleHelp, FileText, Fingerprint, LockKeyhole, Menu, MessageCircleQuestion, RotateCcw, ScanText, ShieldCheck, Upload, X, TriangleAlert } from 'lucide-react';
import { Link, Route, Switch, useLocation, useParams, Router as WouterRouter } from 'wouter';
import { useAnalyzeDocument, useAskQuestion, useCompareDocumentVersions, useCreateDocument, useGetDocument, useListDocuments, getGetDocumentQueryKey, getListDocumentsQueryKey } from '@workspace/api-client-react';
import { buildLawyerPrepBrief, evaluateDocumentRisk } from '@workspace/core';
import { ErrorBoundary } from '@/components/error-boundary';
import { AccessibleForm } from '@/components/a11y/AccessibleForm';
import { FontToggle } from '@/components/a11y/FontToggle';
import { InfoAdviceBoundary } from '@/components/a11y/InfoAdviceBoundary';
import { LiveRegion } from '@/components/a11y/LiveRegion';
import { SkipToContent } from '@/components/a11y/SkipToContent';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { languageOptions, uiText, type UiLanguage } from '@/lib/i18n';

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
      <SkipToContent />
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
        <div className="cc-main" id="main-content" tabIndex={-1}>
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
      <LiveRegion />
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
  const [language, setLanguage] = useState<UiLanguage>('en');
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
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(answer);
    utterance.lang = language === 'ta' ? 'ta-IN' : language === 'hi' ? 'hi-IN' : 'en-US';
    window.speechSynthesis.speak(utterance);
  };

  const handleVoiceInput = async () => {
    if (isRecording) {
      mediaRecorderRef.current?.stop();
      setIsRecording(false);
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      return;
    }

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const recorder = new MediaRecorder(stream);
    audioChunksRef.current = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        audioChunksRef.current.push(event.data);
      }
    };
    recorder.onstop = async () => {
      const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
      const formData = new FormData();
      formData.append('audio', blob, 'voice.webm');
      formData.append('language', language);

      setIsTranscribing(true);
      try {
        const response = await fetch('/api/audio/transcribe', {
          method: 'POST',
          body: formData,
        });
        if (!response.ok) {
          throw new Error('Unable to transcribe audio');
        }
        const data = await response.json() as { text?: string };
        if (data.text) {
          setQuestion((current) => `${current}${current ? ' ' : ''}${data.text}`.trim());
        }
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
          <button className="cc-button cc-button-soft" type="button" onClick={() => setLocation(`/documents/${id}/brief`)} data-testid="button-lawyer-prep-brief">Lawyer Prep Brief</button>
          <button className="cc-button cc-button-soft" type="button" onClick={() => setLocation(`/documents/${id}/compare`)} data-testid="button-compare-versions">Compare versions</button>
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
            <label className="cc-field-label" htmlFor="question">{texts.questionLabel}</label>
            <textarea id="question" className="cc-textarea" value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="For example: What happens if I need to end this agreement early?" disabled={askQuestion.isPending} data-testid="input-question" />
            <div className="cc-form-row" style={{ marginTop: 10 }}>
              <div>
                <label className="cc-field-label" htmlFor="language">{texts.languageLabel}</label>
                <select id="language" className="cc-select" value={language} onChange={(event) => setLanguage(event.target.value as UiLanguage)} data-testid="select-language">
                  {languageOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </div>
              <div><label className="cc-field-label" htmlFor="perspective">I am reading as</label><select id="perspective" className="cc-select" value={perspective} onChange={(event) => setPerspective(event.target.value as 'party_a' | 'party_b')} data-testid="select-perspective"><option value="party_a">Party A</option><option value="party_b">Party B</option></select></div>
              <button className="cc-button cc-button-soft" type="button" onClick={handleVoiceInput} disabled={isTranscribing} data-testid="button-voice-input">{isRecording ? 'Stop' : isTranscribing ? 'Transcribing…' : texts.micLabel}</button>
              <button className="cc-button cc-button-primary" type="submit" disabled={!question.trim() || askQuestion.isPending} data-testid="button-ask-question">{askQuestion.isPending ? 'Thinking…' : 'Ask question'} <ChevronRight size={15} /></button>
            </div>
          </form>
          {askQuestion.isError && <div className="cc-alert cc-alert-error" role="alert" style={{ marginTop: 15 }} data-testid="status-question-error"><AlertCircle size={15} /> We could not answer from this document. Try rephrasing your question.</div>}
          {askQuestion.data && <div className="cc-answer" data-testid="answer-response"><div className="cc-answer-head"><span className="cc-answer-label">{askQuestion.data.queued ? 'Answer queued' : texts.answerLabel}</span><span className="cc-grounding">{Math.round(askQuestion.data.groundingRatio * 100)}% grounded</span></div><p>{askQuestion.data.answer}</p><button className="cc-button cc-button-soft" type="button" onClick={() => readAnswerAloud(askQuestion.data.answer)}>{texts.readAloud}</button><div className="cc-citations">{askQuestion.data.citations.map((citation) => <span className="cc-citation" key={`${citation.clauseId}-${citation.label}`}>{citation.label}</span>)}</div></div>}
          <div className="cc-disclaimer"><ShieldCheck size={14} /> Clause Compass can explain the document’s words, but it cannot determine what is legally right for you. Treat every answer as preparation for a conversation with a qualified lawyer.</div>
        </div>
      </section>
    </main>
  );
}

function LawyerPrepBriefPage() {
  const { id = '' } = useParams<{ id: string }>();
  const { data: document, isLoading, isError } = useGetDocument(id, { query: { queryKey: getGetDocumentQueryKey(id), enabled: Boolean(id) } });

  if (isLoading) return <main className="cc-content"><div className="cc-skeleton" style={{ width: 120, height: 16, marginBottom: 20 }} /><div className="cc-skeleton" style={{ width: '80%', height: 48, marginBottom: 12 }} /><div className="cc-skeleton" style={{ width: '60%', height: 18 }} /></main>;
  if (isError || !document) return <main className="cc-content"><div className="cc-alert cc-alert-error" role="alert"><AlertCircle size={16} /> This brief is unavailable.</div></main>;

  const riskProfile = evaluateDocumentRisk(document.clauses.map((clause) => ({
    ...clause,
    type: clause.type || 'other',
    page: 1,
    charStart: 0,
    charEnd: clause.text.length,
  })) as any, 'both');
  const brief = buildLawyerPrepBrief({
    documentName: document.name,
    parties: ['Party A', 'Party B'],
    findings: riskProfile,
    obligations: [],
    unresolvedInconsistencies: ['Confirm whether governing law and forum selection are intentionally aligned.', 'Check any undefined shorthand or clause cross-reference before signature.'],
  });

  return <main className="cc-content"><Link href={`/documents/${id}`} className="cc-back" data-testid="link-back-document"><ArrowLeft size={14} /> Back to document</Link><section className="cc-panel cc-panel-pad" style={{ marginTop: 18 }}><div className="cc-panel-head"><div><h1>Lawyer Prep Brief</h1><p>{document.name}</p></div><BookOpen size={18} color="hsl(var(--primary))" /></div><pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', lineHeight: 1.7, margin: 0 }}>{brief}</pre></section></main>;
}

type VersionComparisonData = NonNullable<ReturnType<typeof useCompareDocumentVersions>['data']>;
type ComparisonRowData = VersionComparisonData['rows'][number];
type CompareChangeLabel = 'Added' | 'Removed' | 'Changed' | 'Favors other party';
type PaneRef = RefObject<HTMLDivElement | null>;

function ChangeLabelChip({ label }: { label: CompareChangeLabel }) {
  const Icon = label === 'Added' ? Check : label === 'Removed' ? X : label === 'Favors other party' ? TriangleAlert : RotateCcw;
  const modifier = label === 'Favors other party' ? 'favors' : label.toLowerCase();
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
  findings: ComparisonRowData['findingChanges'];
  emptyMessage: string;
}) {
  if (!clause) {
    return <div className="cc-diff-card cc-diff-card-empty">{emptyMessage}</div>;
  }

  return (
    <article className="cc-diff-card">
      <div className="cc-diff-card-head">
        <span className="cc-diff-ordinal">{clause.ordinal}</span>
        <span className="cc-diff-heading">{clause.heading}</span>
      </div>
      {labels.length > 0 && <div className="cc-change-labels">{labels.map((label) => <ChangeLabelChip key={label} label={label} />)}</div>}
      <p className="cc-diff-text">{clause.text}</p>
      {typeof similarity === 'number' && <p className="cc-diff-similarity">Wording match {Math.round(similarity * 100)}% against the other version</p>}
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
  onScroll: (source: 'left' | 'right') => void;
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
          <div className="cc-diff-pane-body" ref={leftPaneRef} onScroll={() => onScroll('left')} tabIndex={0} role="region" aria-label={`${comparison.base.name}, earlier version`} data-testid="pane-base-version">
            {visibleRows.map((row, index) => (
              <div className="cc-diff-row" key={`left-${row.key}`}>
                <DifferenceCard
                  clause={row.before}
                  labels={row.labels as CompareChangeLabel[]}
                  findings={row.kind === 'removed' ? row.findingChanges : []}
                  emptyMessage={row.kind === 'added' ? 'New clause, not present in this version.' : `Clause ${index + 1} has no counterpart here.`}
                />
              </div>
            ))}
            {visibleRows.length === 0 && <p className="cc-diff-empty-pane">No differences to show with this filter. Untick “Changes only” to read every clause.</p>}
          </div>
        </div>

        <div className="cc-diff-pane">
          <h2 className="cc-diff-pane-title">{comparison.revised.name} <span className="cc-diff-pane-note">revised version</span></h2>
          <div className="cc-diff-pane-body" ref={rightPaneRef} onScroll={() => onScroll('right')} tabIndex={0} role="region" aria-label={`${comparison.revised.name}, revised version`} data-testid="pane-revised-version">
            {visibleRows.map((row) => (
              <div className="cc-diff-row" key={`right-${row.key}`}>
                <DifferenceCard
                  clause={row.after}
                  labels={row.labels as CompareChangeLabel[]}
                  similarity={row.before && row.after ? row.similarity : undefined}
                  findings={row.kind === 'removed' ? [] : row.findingChanges}
                  emptyMessage="This clause was removed in the revised version."
                />
                {row.materialChange && (
                  <p className="cc-diff-note" data-testid={`text-material-change-${row.key}`}>
                    What changed: {row.materialChange.summary} It favours {favourLabel(row.materialChange.favors)}.
                    {row.materialChange.available ? '' : ' (reasoning model unavailable)'}
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


function CompareVersionsPage() {
  const { id = '' } = useParams<{ id: string }>();
  const { data: documents, isLoading: documentsLoading } = useListDocuments();
  const { data: revisedDocument, isLoading, isError } = useGetDocument(id, { query: { queryKey: getGetDocumentQueryKey(id), enabled: Boolean(id) } });
  const [baseId, setBaseId] = useState('');
  const [perspective, setPerspective] = useState<'party_a' | 'party_b'>('party_a');
  const [changesOnly, setChangesOnly] = useState(true);
  const leftPaneRef = useRef<HTMLDivElement>(null);
  const rightPaneRef = useRef<HTMLDivElement>(null);
  const scrollLock = useRef(false);
  const compare = useCompareDocumentVersions();

  const candidateVersions = (documents ?? []).filter((document) => document.id !== id);

  useEffect(() => {
    if (!baseId && candidateVersions.length > 0) setBaseId(candidateVersions[0].id);
  }, [baseId, candidateVersions]);

  useEffect(() => {
    if (!id || !baseId || baseId === id) return;
    // The server caches the model note per changed pair, so re-running on a choice change is cheap.
    compare.mutate({ id, data: { against: baseId, perspective } });
  }, [id, baseId, perspective]);

  const handleScroll = (source: 'left' | 'right') => {
    const from = source === 'left' ? leftPaneRef.current : rightPaneRef.current;
    const to = source === 'left' ? rightPaneRef.current : leftPaneRef.current;
    if (!from || !to || scrollLock.current) return;
    scrollLock.current = true;
    to.scrollTop = from.scrollTop;
    window.requestAnimationFrame(() => { scrollLock.current = false; });
  };

  if (isLoading || documentsLoading) return <main className="cc-content"><div className="cc-skeleton" style={{ width: 140, height: 16, marginBottom: 20 }} /><div className="cc-skeleton" style={{ width: '70%', height: 44, marginBottom: 12 }} /><div className="cc-skeleton" style={{ width: '50%', height: 18 }} /></main>;
  if (isError || !revisedDocument) return <main className="cc-content"><div className="cc-alert cc-alert-error" role="alert" data-testid="status-compare-unavailable"><AlertCircle size={16} /> This comparison is unavailable.</div></main>;

  const comparison = compare.data;
  const rows = comparison?.rows ?? [];
  const visibleRows = changesOnly ? rows.filter((row) => row.kind !== 'unchanged') : rows;
  const favourLabel = (favors: string) => favors === 'neither' ? 'neither party identified' : favors === 'partyA' ? 'Party A' : 'Party B';

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
          <select id="compare-perspective" className="cc-select" value={perspective} onChange={(event) => setPerspective(event.target.value as 'party_a' | 'party_b')} data-testid="select-compare-perspective">
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


function AccessibilityPage() {
  return (
    <main className="cc-content">
      <div className="cc-prose">
        <div className="cc-kicker">Accessibility statement</div>
        <h1>A workspace that leaves room for people.</h1>
        <p>
          Clause Compass is designed for careful reading, different ways of navigating, and the moments when a document feels like too much.
          We are working toward WCAG 2.2 AA and document the gaps plainly.
        </p>

        <div className="mb-6 flex items-center justify-end">
          <FontToggle />
        </div>

        <InfoAdviceBoundary
          severity="warning"
          information={
            <p>
              Some contract language is read as a single block of text. We support keyboard navigation, descriptive labels, and a dyslexia-friendly font toggle
              so dense clauses are easier to interpret without losing the original context.
            </p>
          }
          advice={
            <p>
              Keep reading order logical, use headings and landmarks consistently, and pair every warning with plain language text and an icon rather than color alone.
            </p>
          }
        />

        <h2>What we support today</h2>
        <div className="cc-limitations">
          <div className="cc-limit-card"><KeyboardIcon /><strong>Keyboard-first navigation</strong><span>Controls, links, forms, and expandable clauses can be reached and operated without a mouse.</span></div>
          <div className="cc-limit-card"><EyeIcon /><strong>Visible, non-color cues</strong><span>Risk levels pair color with icons and plain-language labels. Focus states remain visible.</span></div>
          <div className="cc-limit-card"><MessageCircleQuestion size={20} /><strong>Readable explanations</strong><span>Questions and answers use short paragraphs, descriptive labels, and grounded citations.</span></div>
          <div className="cc-limit-card"><ShieldCheck size={20} /><strong>Reduced motion</strong><span>Decorative movement is disabled when your device asks for reduced motion.</span></div>
        </div>

        <section aria-labelledby="a11y-form-heading" className="mt-10 border-t border-slate-200 pt-8">
          <h2 id="a11y-form-heading" className="mb-4 text-2xl font-bold">Request Human Review</h2>
          <AccessibleForm />
        </section>

        <h2>Known limitations</h2>
        <ul>
          <li>Scanned or image-only documents may not be read with the same reliability as selectable text. We flag this when detected.</li>
          <li>The original document’s accessibility is outside our control. Always refer back to the source file for exact layout, signatures, and visual context.</li>
          <li>Generated explanations are not legal advice and should not be used as a substitute for a qualified lawyer.</li>
        </ul>
        <h2>Tell us what got in the way</h2>
        <p>If a control, explanation, or document state was difficult to use, please share the detail with the person supporting your Clause Compass workspace. Specific page names and steps help us make a better fix.</p>
        <Link href="/" className="cc-button cc-button-primary" style={{ marginTop: 9 }} data-testid="link-sidebar-accessibility">Back to inbox</Link>
      </div>
    </main>
  );
}

function KeyboardIcon() { return <Menu size={20} aria-hidden="true" />; }
function EyeIcon() { return <ScanText size={20} aria-hidden="true" />; }

function Router() {
  const [location] = useLocation();
  return <Shell><ErrorBoundary resetKey={location}><Switch><Route path="/" component={HomePage} /><Route path="/documents/:id" component={DocumentPage} /><Route path="/documents/:id/brief" component={LawyerPrepBriefPage} /><Route path="/documents/:id/compare" component={CompareVersionsPage} /><Route path="/accessibility" component={AccessibilityPage} /><Route component={NotFound} /></Switch></ErrorBoundary></Shell>;
}

function App() {
  return <QueryClientProvider client={queryClient}><TooltipProvider><WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}><Router /></WouterRouter><Toaster /></TooltipProvider></QueryClientProvider>;
}

export default App;