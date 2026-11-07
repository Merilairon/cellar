import { extractRecipeNode, type ExtractResult } from './extract-jsonld';
import { extractMicrodataRecipe } from './extract-microdata';

/** JSON-LD first; microdata only when JSON-LD found no Recipe node. Pure. */
export function extractRecipe(html: string): ExtractResult {
  const ld = extractRecipeNode(html);
  if (ld.node) return ld;
  const md = extractMicrodataRecipe(html);
  if (!md.node) return ld;
  return { ...md, notes: [...ld.notes, ...md.notes] };
}
