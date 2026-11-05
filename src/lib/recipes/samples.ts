import { parseIngredientLine, toIngredientFields } from '@/lib/import/ingredient-parser';
import type { IngredientInput, RecipeInput, StepInput } from './schemas';

// Self-written sample recipes (no third-party text). They mirror the structure of the
// layout reference: A = one section, two top banners, 9 rows, spans 0-0 0-3 0-4 0-8 0-8;
// B = two sections, a split ingredient and a bottom banner. Shared by the seed script,
// unit tests and Playwright.

function ing(line: string, extra: Partial<IngredientInput> = {}): IngredientInput {
  const f = toIngredientFields(parseIngredientLine(line));
  return {
    name: f.name,
    note: f.note,
    raw_text: f.raw_text,
    metric_qty: f.metric_qty,
    metric_unit: f.metric_unit,
    us_qty: f.us_qty,
    us_unit: f.us_unit,
    display_primary: f.display_primary,
    ...extra,
  };
}

const banner = (
  kind: 'banner_top' | 'banner_bottom',
  label: string,
  detail: string,
): StepInput => ({ kind, label, detail });

const col = (
  label: string,
  detail: string,
  row_start: number,
  row_end: number,
  extra: Partial<Pick<StepInput, 'temp_c' | 'temp_f' | 'minutes_min' | 'minutes_max'>> = {},
): StepInput => ({ kind: 'column', label, detail, row_start, row_end, ...extra });

export const SAMPLE_SKILLET_COOKIES: RecipeInput = {
  title: 'Mocha Skillet Cookie',
  description: 'A soft, fudgy cookie baked in a single skillet and cut into wedges.',
  servings: 8,
  servings_label: 'wedges',
  prep_minutes: 15,
  cook_minutes: 35,
  source_name: 'Cellar samples',
  visibility: 'private',
  view_mode: 'grid',
  sections: [
    {
      title: null,
      ingredients: [
        ing('4 oz (115 g) unsalted butter'),
        ing('3/4 cup (150 g) brown sugar'),
        ing('1 tsp vanilla extract'),
        ing('1 shot espresso, cooled'),
        ing('2 large eggs'),
        ing('1 1/2 cups (190 g) flour'),
        ing('1/4 cup (25 g) cocoa powder'),
        ing('1/2 tsp salt'),
        ing('1 cup (170 g) dark chocolate chunks'),
      ],
      steps: [
        banner('banner_top', 'prep', 'Grease a 10 inch oven-safe skillet with a little butter.'),
        banner('banner_top', 'preheat', 'Heat the oven to 350°F (170°C).'),
        col(
          'melt',
          'Melt the butter in a small pan over low heat, then take it off the heat.',
          0,
          0,
        ),
        col('mix', 'Stir the sugar, vanilla and espresso into the warm butter until smooth.', 0, 3),
        col('mix', 'Whisk in the eggs one at a time until glossy.', 0, 4),
        col(
          'fold in',
          'Fold in the flour, cocoa and salt, then the chocolate chunks. Press into the skillet.',
          0,
          8,
        ),
        col('bake', 'Bake until the edges are set and the centre is still soft.', 0, 8, {
          temp_f: 350,
          temp_c: 170,
          minutes_min: 30,
          minutes_max: 40,
        }),
      ],
    },
  ],
};

export const SAMPLE_VANILLA_CAKE: RecipeInput = {
  title: 'Vanilla Cake with Frosting',
  description: 'A simple one-layer vanilla cake with a quick buttercream.',
  servings: 10,
  servings_label: 'slices',
  prep_minutes: 25,
  cook_minutes: 30,
  source_name: 'Cellar samples',
  visibility: 'private',
  view_mode: 'grid',
  sections: [
    {
      title: 'Cake',
      ingredients: [
        ing('1/2 cup (115 g) unsalted butter, softened'),
        ing('1/2 cup (100 g) sugar', { split_group_id: 'sugar', portion_label: 'half' }),
        ing('2 large eggs'),
        ing('2 tsp vanilla extract'),
        ing('1 1/2 cups (190 g) flour'),
        ing('1 1/2 tsp baking powder'),
        ing('1/2 cup (120 mL) milk'),
        ing('1/2 cup (100 g) sugar', { split_group_id: 'sugar', portion_label: 'remaining' }),
      ],
      steps: [
        banner(
          'banner_top',
          'preheat',
          'Heat the oven to 350°F (170°C) and line a 9 inch round pan.',
        ),
        col('cream', 'Beat the butter with half of the sugar until pale and fluffy.', 0, 1),
        col('beat in', 'Beat in the eggs and the vanilla, one egg at a time.', 0, 3),
        col('mix', 'Stir in the flour and baking powder alternately with the milk.', 0, 6),
        col('fold in', 'Fold in the remaining sugar until just combined. Pour into the pan.', 0, 7),
        col('bake', 'Bake until a skewer comes out clean. Cool in the pan for 10 minutes.', 0, 7, {
          temp_f: 350,
          temp_c: 170,
          minutes_min: 28,
          minutes_max: 32,
        }),
      ],
    },
    {
      title: 'Frosting',
      ingredients: [
        ing('1/2 cup (115 g) unsalted butter, softened'),
        ing('2 cups (240 g) powdered sugar'),
        ing('2 tbsp (30 mL) milk'),
        ing('1 tsp vanilla extract'),
      ],
      steps: [
        col('beat', 'Beat the butter until creamy, then add the powdered sugar gradually.', 0, 1),
        col('thin', 'Add the milk and vanilla and beat until light and spreadable.', 0, 3),
        bannerFinish(),
      ],
    },
  ],
};

function bannerFinish(): StepInput {
  return banner(
    'banner_bottom',
    'finish',
    'Once the cake is completely cool, spread the frosting on top. Chill 15 minutes, then serve.',
  );
}

export const SAMPLE_RECIPES: readonly RecipeInput[] = [SAMPLE_SKILLET_COOKIES, SAMPLE_VANILLA_CAKE];
