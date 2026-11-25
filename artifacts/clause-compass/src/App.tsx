import {
  lazy,
  Suspense,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type ChangeEvent,
} from "react";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  ArrowUpRight,
  BookOpen,
  CircleHelp,
  FileText,
  LockKeyhole,
  RotateCcw,
  ScanText,
  ShieldCheck,
  Upload,
  X,
} from "lucide-react";
import { Link, Route, Switch, useLocation, Router as WouterRouter } from "wouter";
import {
  getCsrfToken,
  useListDocuments,
  getListDocumentsQueryKey,
} from "@workspace/api-client-react";
import { ErrorBoundary } from "@/components/error-boundary";
import { LiveRegion } from "@/components/a11y/LiveRegion";
import { SkipToContent } from "@/components/a11y/SkipToContent";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import { formatDate, StatusPill, type Status } from "@/pages/shared";

const queryClient = new QueryClient();

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
  const homeActive = location === "/";
  return (
    <div className="cc-app">
      <SkipToContent />
      <div className="cc-shell">
        <aside className="cc-sidebar" aria-label="Primary navigation">
          <Logo />
          <nav className="cc-nav">
            <Link
              href="/"
              className="cc-nav-link"
              data-active={homeActive}
              data-testid="link-inbox"
            >
              <BookOpen size={16} strokeWidth={1.8} /> <span>Contract inbox</span>
            </Link>
            <Link
              href="/accessibility"
              className="cc-nav-link"
              data-active={location === "/accessibility"}
              data-testid="link-accessibility"
            >
              <ScanText size={16} strokeWidth={1.8} /> <span>Accessibility</span>
            </Link>
          </nav>
          <div className="cc-sidebar-footer">
            <div className="cc-sidebar-security-row">
              <LockKeyhole size={13} />
              <strong className="cc-sidebar-security-title">Private by design</strong>
            </div>
            Documents are processed to explain what is on the page, not to make decisions for you.
            <div className="cc-sidebar-limitations-link">
              <Link href="/accessibility" data-testid="link-sidebar-accessibility">
                Read our limitations →
              </Link>
            </div>
          </div>
        </aside>
        <div className="cc-main" id="main-content" tabIndex={-1}>
          <header className="cc-topbar">
            <span className="cc-kicker">
              {location.startsWith("/documents/")
                ? "Document workspace"
                : location === "/accessibility"
                  ? "About the workspace"
                  : "Your private workspace"}
            </span>
            <div className="cc-topbar-right">
              <span className="cc-privacy-chip">
                <span className="cc-privacy-dot" aria-hidden="true" /> Private session
              </span>
              <button
                className="cc-icon-button"
                type="button"
                aria-label="Help and guidance"
                title="Help and guidance"
                data-testid="button-help"
              >
                <CircleHelp size={16} />
              </button>
            </div>
          </header>
          <div className="cc-mobile-nav">
            <Link
              href="/"
              className="cc-nav-link"
              data-active={homeActive}
              data-testid="link-mobile-inbox"
            >
              <BookOpen size={14} /> Inbox
            </Link>
            <Link
              href="/accessibility"
              className="cc-nav-link"
              data-active={location === "/accessibility"}
              data-testid="link-mobile-accessibility"
            >
              <ScanText size={14} /> Accessibility
            </Link>
          </div>
          {children}
        </div>
      </div>
      <LiveRegion />
    </div>
  );
}

function HomePage() {
  const [, setLocation] = useLocation();
  const fileRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadError, setUploadError] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const { data: documents, isLoading, isError, refetch } = useListDocuments();
  const queryClientInstance = useQueryClient();

  const handleFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setUploadError("");
    setSelectedFile(file);
  };

  const handleUpload = async () => {
    if (!selectedFile) {
      fileRef.current?.click();
      return;
    }
    setIsUploading(true);
    setUploadError("");
    try {
      const formData = new FormData();
      formData.append("file", selectedFile);
      const response = await fetch("/api/documents/upload", {
        method: "POST",
        headers: { "x-csrf-token": await getCsrfToken() },
        body: formData,
      });
      if (!response.ok) throw new Error("Document upload failed");
      const document = (await response.json()) as { id: string };
      await queryClientInstance.invalidateQueries({ queryKey: getListDocumentsQueryKey() });
      setSelectedFile(null);
      if (fileRef.current) fileRef.current.value = "";
      setLocation(`/documents/${document.id}`);
    } catch {
      setUploadError(
        "We could not add that file. Please try again, or choose another PDF or DOCX.",
      );
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <main className="cc-content">
      <section className="cc-hero">
        <div>
          <div className="cc-kicker">A clearer first read</div>
          <h1 className="cc-title">
            Make the fine print
            <br />
            <em>feel navigable.</em>
          </h1>
          <p className="cc-lede">
            Clause Compass turns a contract into a calm, grounded conversation starter — so you can
            arrive at legal advice with better questions.
          </p>
        </div>
        <button
          className="cc-button cc-button-primary"
          type="button"
          onClick={() => fileRef.current?.click()}
          data-testid="button-upload-top"
        >
          <Upload size={16} /> Add a document
        </button>
      </section>

      <section className="cc-upload" aria-label="Upload a contract">
        <div className="cc-upload-copy">
          <div className="cc-upload-icon">
            <Upload size={18} />
          </div>
          <div>
            <strong>{selectedFile ? selectedFile.name : "Bring a contract into focus"}</strong>
            <span>
              {selectedFile
                ? `${Math.max(1, Math.round(selectedFile.size / 1024))} KB selected · ready to read`
                : "PDF or DOCX · processed in your private workspace"}
            </span>
          </div>
          {selectedFile && (
            <button
              type="button"
              className="cc-icon-button"
              aria-label="Remove selected file"
              title="Remove selected file"
              onClick={() => {
                setSelectedFile(null);
                if (fileRef.current) fileRef.current.value = "";
              }}
              data-testid="button-remove-file"
            >
              <X size={15} />
            </button>
          )}
        </div>
        <input
          ref={fileRef}
          type="file"
          accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          onChange={handleFile}
          hidden
          data-testid="input-file"
        />
        <button
          className="cc-button cc-button-primary"
          type="button"
          onClick={handleUpload}
          disabled={isUploading}
          data-testid="button-upload-document"
        >
          {isUploading ? "Adding…" : selectedFile ? "Upload document" : "Choose a file"}
        </button>
      </section>

      {uploadError && (
        <div
          className="cc-alert cc-alert-error cc-upload-error"
          role="alert"
          data-testid="status-upload-error"
        >
          <AlertCircle size={16} /> {uploadError}
        </div>
      )}

      <section aria-labelledby="documents-heading">
        <div className="cc-section-head">
          <h2 className="cc-section-title" id="documents-heading">
            Your documents
          </h2>
          <span className="cc-section-meta">
            {documents?.length ?? 0} {documents?.length === 1 ? "workspace" : "workspaces"}
          </span>
        </div>
        {isLoading && (
          <div
            className="cc-document-list"
            aria-label="Loading documents"
            data-testid="status-documents-loading"
          >
            {[1, 2, 3].map((item) => (
              <div className="cc-document-card" key={item}>
                <div className="cc-skeleton cc-skeleton-card-name" />
                <div className="cc-skeleton cc-skeleton-card-line" />
                <div className="cc-skeleton cc-skeleton-card-line" />
                <div className="cc-skeleton cc-skeleton-card-line" />
              </div>
            ))}
          </div>
        )}
        {isError && (
          <div
            className="cc-alert cc-alert-error"
            role="alert"
            data-testid="status-documents-error"
          >
            <AlertCircle size={16} /> We could not load your documents.{" "}
            <button
              type="button"
              className="cc-button cc-button-quiet"
              onClick={() => refetch()}
              data-testid="button-retry-documents"
            >
              <RotateCcw size={14} /> Try again
            </button>
          </div>
        )}
        {!isLoading && !isError && documents?.length === 0 && (
          <div className="cc-empty" data-testid="status-documents-empty">
            <FileText size={27} className="cc-empty-icon" />
            <h3>Your reading desk is clear.</h3>
            <p>
              Add a contract to see its clauses, risk signals, and a place to ask grounded
              questions.
            </p>
            <button
              type="button"
              className="cc-button cc-button-soft"
              onClick={() => fileRef.current?.click()}
              data-testid="button-upload-empty"
            >
              <Upload size={15} /> Add your first document
            </button>
          </div>
        )}
        {!isLoading && !isError && !!documents?.length && (
          <div className="cc-document-list" data-testid="list-documents">
            {documents.map((document, index) => (
              <Link
                href={`/documents/${document.id}`}
                className="cc-document-card"
                key={document.id}
                style={{ animationDelay: `${index * 45}ms` }}
                data-testid={`card-document-${document.id}`}
              >
                <div className="cc-document-name">
                  <span className="cc-file-icon">
                    <FileText size={17} />
                  </span>
                  <span>
                    <strong>{document.name}</strong>
                    <small>
                      {document.fileType.split("/").pop()?.toUpperCase() || "DOCUMENT"} · Added{" "}
                      {formatDate(document.uploadedAt)}
                    </small>
                  </span>
                </div>
                <div>
                  <span className="cc-stat-label">Pages</span>
                  <span className="cc-stat-value">{document.pageCount || "—"}</span>
                </div>
                <div>
                  <span className="cc-stat-label">Clauses</span>
                  <span className="cc-stat-value">{document.clauseCount || "—"}</span>
                </div>
                <div>
                  <span className="cc-stat-label">Risk</span>
                  <span className="cc-stat-value">
                    {document.status === "ready" ? `${document.riskScore}/100` : "Pending"}
                  </span>
                </div>
                <div>
                  <StatusPill status={document.status as Status} />
                </div>
                <ArrowUpRight size={15} color="hsl(var(--muted-foreground))" aria-hidden="true" />
              </Link>
            ))}
          </div>
        )}
      </section>

      <section className="cc-home-disclaimer">
        <ShieldCheck size={17} color="hsl(var(--primary))" />
        <p className="cc-home-disclaimer-copy">
          Clause Compass explains language that appears in your document. It does not provide legal
          advice, predict an outcome, or replace a lawyer’s judgment.
        </p>
      </section>
    </main>
  );
}

const LazyDocumentPage = lazy(() => import("@/pages/document"));
const LazyLawyerPrepBriefPage = lazy(() => import("@/pages/brief"));
const LazyCompareVersionsPage = lazy(() => import("@/pages/compare"));
const LazyAccessibilityPage = lazy(() => import("@/pages/accessibility"));

function DocumentRoute() {
  return (
    <Suspense
      fallback={
        <div className="cc-content" role="status">
          Loading document…
        </div>
      }
    >
      <LazyDocumentPage />
    </Suspense>
  );
}
function BriefRoute() {
  return (
    <Suspense
      fallback={
        <div className="cc-content" role="status">
          Loading brief…
        </div>
      }
    >
      <LazyLawyerPrepBriefPage />
    </Suspense>
  );
}
function CompareRoute() {
  return (
    <Suspense
      fallback={
        <div className="cc-content" role="status">
          Loading comparison…
        </div>
      }
    >
      <LazyCompareVersionsPage />
    </Suspense>
  );
}
function AccessibilityRoute() {
  return (
    <Suspense
      fallback={
        <div className="cc-content" role="status">
          Loading accessibility information…
        </div>
      }
    >
      <LazyAccessibilityPage />
    </Suspense>
  );
}

function Router() {
  const [location] = useLocation();
  return (
    <Shell>
      <ErrorBoundary resetKey={location}>
        <Switch>
          <Route path="/" component={HomePage} />
          <Route path="/documents/:id" component={DocumentRoute} />
          <Route path="/documents/:id/brief" component={BriefRoute} />
          <Route path="/documents/:id/compare" component={CompareRoute} />
          <Route path="/accessibility" component={AccessibilityRoute} />
          <Route component={NotFound} />
        </Switch>
      </ErrorBoundary>
    </Shell>
  );
}

function App() {
  useEffect(() => {
    void getCsrfToken().catch(() => undefined);
  }, []);
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
