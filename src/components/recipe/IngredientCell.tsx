import { useTranslations } from 'next-intl';
import { measureParts, partBody, type MeasurePart } from '@/lib/units/display';
import type { UnitSystem } from '@/lib/units/units';
import type { ApiIngredient } from './types';

/** How the recipe page shows quantities: the user's preference, a scale factor, a per-recipe toggle. */
export type QuantityDisplay = { pref: UnitSystem; scale: number; toggle: UnitSystem | null };

function Part({ part }: { part: MeasurePart }) {
  const t = useTranslations();
  return (
    <>
      {part.approx && (
        <>
          <span aria-hidden="true">≈ </span>
          <span className="sr-only">{t('recipe.scale.about')} </span>
        </>
      )}
      {partBody(part)}
    </>
  );
}

/** Measure (primary, other in parentheses), name, optional note and portion label. */
export function IngredientCell({
  ingredient: i,
  display,
}: {
  ingredient: ApiIngredient;
  /** Absent: show as written (the recipe's own primary system, factor 1). */
  display?: QuantityDisplay;
}) {
  const { primary, secondary } = measureParts(i, {
    pref: display?.pref ?? i.display_primary,
    scale: display?.scale ?? 1,
    toggle: display?.toggle ?? null,
  });
  return (
    <>
      {primary && (
        <span className="rg-qty">
          <Part part={primary} />
          {secondary && (
            <>
              {' ('}
              <Part part={secondary} />
              {')'}
            </>
          )}{' '}
        </span>
      )}
      <span>{i.name}</span>
      {i.note && <span className="rg-note">, {i.note}</span>}
      {i.portion_label && <span className="rg-portion"> ({i.portion_label})</span>}
    </>
  );
}
