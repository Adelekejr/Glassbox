import { MARK_CORNER, MARK_INK, WORDMARK, WORDMARK_VIEWBOX } from "./brand-paths";

export function Mark({ className = "mark" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 100 100" aria-hidden="true" focusable="false">
      <path fill="var(--mark-ink)" d={MARK_INK} />
      <path className="corner" fill="var(--accent)" d={MARK_CORNER} />
    </svg>
  );
}

export function Wordmark() {
  return (
    <svg className="wordmark" viewBox={WORDMARK_VIEWBOX} aria-hidden="true" focusable="false">
      <path fill="currentColor" fillRule="evenodd" d={WORDMARK} />
    </svg>
  );
}

export function Brand() {
  return (
    <a className="brand" href="/" aria-label="Glassbox home">
      <Mark />
      <Wordmark />
    </a>
  );
}
