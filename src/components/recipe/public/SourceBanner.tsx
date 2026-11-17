import { useTranslations } from 'next-intl';
import { safeHttpUrl } from '../api';

/**
 * Attribution line on the public page (G8, UX spec 3.2). Rendered whenever a source URL or name
 * exists. `{source}` is the source name, else the host of the URL; it links out only for a safe
 * http(s) URL. The banner is content, not a `role="note"`.
 */
export function SourceBanner({
  sourceUrl,
  sourceName,
}: {
  sourceUrl: string | null;
  sourceName: string | null;
}) {
  const t = useTranslations();
  const url = safeHttpUrl(sourceUrl);
  const name = sourceName?.trim() || null;
  const host = url ? new URL(url).hostname : null;
  const label = name ?? host;
  if (!label) return null;

  const source = url ? (
    <a
      href={url}
      rel="noopener noreferrer"
      aria-label={name ? undefined : t('publicPage.bannerSourceLabel', { source: label })}
      className="print-url underline"
    >
      {label}
      <svg
        viewBox="0 0 24 24"
        width="14"
        height="14"
        aria-hidden="true"
        focusable="false"
        className="ml-1 inline-block align-[-1px]"
      >
        <path
          d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </a>
  ) : (
    label
  );

  // The message is translated as one sentence; the source node is spliced in at its slot.
  const SLOT = '\u0000';
  const [before, after = ''] = t('publicPage.banner', { source: SLOT }).split(SLOT);
  return (
    <p className="my-3 rounded-md border border-[var(--rg-line)] bg-[var(--rg-banner)] p-3 text-[var(--rg-ink)] print:rounded-none print:border-0 print:p-0">
      {before}
      {source}
      {after}
    </p>
  );
}
