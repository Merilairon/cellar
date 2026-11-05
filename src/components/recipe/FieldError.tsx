import { useTranslations } from 'next-intl';
import { errorMessageKey } from '@/lib/recipes/form-model';
import { errorText } from './styles';

/** Inline error text for one field; render it with an id and point aria-describedby at it. */
export function FieldError({ id, code }: { id: string; code: string | undefined }) {
  const t = useTranslations();
  if (!code) return null;
  return (
    <p id={id} className={errorText}>
      {t(errorMessageKey(code))}
    </p>
  );
}
