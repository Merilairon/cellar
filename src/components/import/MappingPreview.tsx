import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { RecipeGrid } from '@/components/recipe/RecipeGrid';
import { fieldId } from '@/components/recipe/FormField';
import {
  errorMessageKey,
  formToPreviewSections,
  previewIssues,
  type FormState,
} from '@/lib/recipes/form-model';

/** Live preview of the form as a grid, redrawn from form state (no request). */
export function MappingPreview({ form }: { form: FormState }) {
  const t = useTranslations();
  const [expanded, setExpanded] = useState<string | null>(null);
  const sections = useMemo(() => formToPreviewSections(form), [form]);
  const issues = useMemo(() => previewIssues(form), [form]);

  if (issues.length > 0) {
    return (
      <div>
        <p>{t('import.review.mapping.preview.invalidIntro')}</p>
        <ul className="mt-1 list-disc pl-5">
          {issues.map((e, i) => {
            const step = /\.steps\.(\d+)\./.exec(e.path);
            const message = t(errorMessageKey(e.code));
            return (
              <li key={`${i}${e.path}`}>
                <a href={`#${fieldId(e.path)}`} className="underline">
                  {step
                    ? t('import.review.mapping.preview.invalidItem', {
                        n: Number(step[1]) + 1,
                        message,
                      })
                    : message}
                </a>
              </li>
            );
          })}
        </ul>
      </div>
    );
  }

  const multiple = sections.length > 1;
  return (
    <div className="flex flex-col gap-6">
      {sections.map((s, si) =>
        s.steps.some((st) => st.kind === 'column') ? (
          <RecipeGrid
            key={s.id}
            // Same heading the recipe page shows for an untitled part of a longer recipe.
            sections={[
              { ...s, title: s.title ?? (multiple ? t('recipe.section', { n: si + 1 }) : null) },
            ]}
            recipeTitle={form.title}
            expandedStepId={expanded}
            onSelectStep={setExpanded}
            detailMode="inline"
          />
        ) : (
          <p key={s.id}>{t('import.review.mapping.preview.noColumns')}</p>
        ),
      )}
    </div>
  );
}

/** Counts for the sr-only summary of the preview. */
export function previewCounts(form: FormState): { steps: number; rows: number; sections: number } {
  const secs = formToPreviewSections(form);
  return {
    steps: secs.reduce((n, s) => n + s.steps.filter((t) => t.kind === 'column').length, 0),
    rows: secs.reduce((n, s) => n + s.ingredients.length, 0),
    sections: secs.length,
  };
}
