// Shared class strings for recipe UI controls (44px-ish touch targets, visible focus by default).
export const btn =
  'inline-flex min-h-11 items-center justify-center rounded border border-neutral-500 px-3 hover:bg-neutral-100 disabled:opacity-50 dark:hover:bg-neutral-800';
// Primary button. Disabled (`disabled` and `aria-disabled`) is styled here, in one place, with
// explicit colours instead of opacity so the label keeps >= 4.5:1 (WCAG 1.4.3): light fill,
// dark text and an inset outline (no layout change) that still differs from the enabled look.
// The forced-colors border keeps the boundary when the system overrides background colours.
export const btnPrimary = [
  'inline-flex min-h-11 items-center justify-center rounded bg-emerald-700 px-4 text-white hover:bg-emerald-800',
  'forced-colors:border forced-colors:border-[ButtonText]',
  '[&:is(:disabled,[aria-disabled=true])]:bg-emerald-100 [&:is(:disabled,[aria-disabled=true])]:text-emerald-950 [&:is(:disabled,[aria-disabled=true])]:inset-ring-1 [&:is(:disabled,[aria-disabled=true])]:inset-ring-emerald-800 [&:is(:disabled,[aria-disabled=true])]:hover:bg-emerald-100',
  'dark:[&:is(:disabled,[aria-disabled=true])]:bg-emerald-950 dark:[&:is(:disabled,[aria-disabled=true])]:text-emerald-100 dark:[&:is(:disabled,[aria-disabled=true])]:inset-ring-emerald-500 dark:[&:is(:disabled,[aria-disabled=true])]:hover:bg-emerald-950',
].join(' ');
export const btnDanger =
  'inline-flex min-h-11 items-center justify-center rounded border border-red-700 px-3 text-red-800 hover:bg-red-50 dark:border-red-400 dark:text-red-300 dark:hover:bg-red-950';
export const input =
  'w-full rounded border border-neutral-500 bg-transparent p-2 aria-[invalid=true]:border-red-600 dark:bg-neutral-900';
export const errorText = 'mt-1 text-sm text-red-700 dark:text-red-400';
