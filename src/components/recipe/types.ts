import type { ApiRecipe } from '@/lib/recipes/service';

export type { ApiRecipe };
export type ApiSection = ApiRecipe['sections'][number];
export type ApiIngredient = ApiSection['ingredients'][number];
export type ApiStep = ApiSection['steps'][number];
