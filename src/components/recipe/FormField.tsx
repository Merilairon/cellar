import type { ReactNode } from 'react';
import { FieldError } from './FieldError';

export type ControlProps = {
  id: string;
  'aria-invalid'?: true;
  'aria-describedby'?: string;
};

/** Label + control + inline error, wired with for/id and aria-describedby. */
export function FormField({
  id,
  label,
  code,
  hint,
  className,
  children,
}: {
  id: string;
  label: string;
  code?: string;
  hint?: string;
  className?: string;
  children: (props: ControlProps) => ReactNode;
}) {
  const describedBy = [hint ? `${id}-hint` : null, code ? `${id}-err` : null]
    .filter(Boolean)
    .join(' ');
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1 block text-sm font-medium">
        {label}
      </label>
      {children({
        id,
        'aria-invalid': code ? true : undefined,
        'aria-describedby': describedBy || undefined,
      })}
      {hint && (
        <p id={`${id}-hint`} className="mt-1 text-sm text-neutral-700 dark:text-neutral-300">
          {hint}
        </p>
      )}
      <FieldError id={`${id}-err`} code={code} />
    </div>
  );
}

/** DOM id for an API error path, e.g. sections.0.steps.1.label -> f-sections-0-steps-1-label. */
export const fieldId = (path: string): string => `f-${path.replace(/\./g, '-')}`;
