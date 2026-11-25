import { Link } from "wouter";
import { MessageCircleQuestion, Menu, ScanText, ShieldCheck } from "lucide-react";
import { AccessibleForm } from "@/components/a11y/AccessibleForm";
import { FontToggle } from "@/components/a11y/FontToggle";
import { InfoAdviceBoundary } from "@/components/a11y/InfoAdviceBoundary";

function KeyboardIcon() { return <Menu size={20} aria-hidden="true" />; }
function EyeIcon() { return <ScanText size={20} aria-hidden="true" />; }

export default function AccessibilityPage() {
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
        <Link href="/" className="cc-button cc-button-primary cc-accessibility-return" data-testid="link-sidebar-accessibility">Back to inbox</Link>
      </div>
    </main>
  );
}