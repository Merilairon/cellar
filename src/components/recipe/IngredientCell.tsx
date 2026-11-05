import { formatMeasure } from './formatIngredient';
import type { ApiIngredient } from './types';

/** Measure (primary, other in parentheses), name, optional note and portion label. */
export function IngredientCell({ ingredient: i }: { ingredient: ApiIngredient }) {
  const measure = formatMeasure(i);
  return (
    <>
      {measure && <span className="rg-qty">{measure} </span>}
      <span>{i.name}</span>
      {i.note && <span className="rg-note">, {i.note}</span>}
      {i.portion_label && <span className="rg-portion"> ({i.portion_label})</span>}
    </>
  );
}
