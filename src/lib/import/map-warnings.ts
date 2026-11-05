// Warning collection for the mapper: deduplicated, with a bounded, priority-ordered list.
// Pure module.

import type { MappingWarning } from './map-types';

/** Data-carrying warnings (`code:data`) kept per family; the rest are counted. */
const MAX_PER_FAMILY = 10;

export class Warnings {
  private readonly set = new Set<MappingWarning>();
  add(w: MappingWarning): void {
    this.set.add(w);
  }
  has(w: MappingWarning): boolean {
    return this.set.has(w);
  }
  /**
   * Fixed codes first (they are few and always kept, so `time_ambiguous`, `mapping_invalid`
   * and `mapping_budget` can never be cut), then at most MAX_PER_FAMILY of each data-carrying
   * family in insertion order, then `warnings_more:<n>` when some were left out. Bounded:
   * fixed codes are a closed set.
   */
  list(): MappingWarning[] {
    const fixed: MappingWarning[] = [];
    const perFamily = new Map<string, number>();
    const data: MappingWarning[] = [];
    let omitted = 0;
    for (const w of this.set) {
      const colon = w.indexOf(':');
      if (colon < 0) {
        fixed.push(w);
        continue;
      }
      const family = w.slice(0, colon);
      const n = perFamily.get(family) ?? 0;
      perFamily.set(family, n + 1);
      if (n < MAX_PER_FAMILY) data.push(w);
      else omitted++;
    }
    const out = [...fixed, ...data];
    if (omitted > 0) out.push(`warnings_more:${omitted}`);
    return out;
  }
}
