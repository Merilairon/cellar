import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { listHref, toggleTagHref, type ListFilters } from './search-url';

export type TagChip = { name: string; count: number };

/** Server-rendered chip row: each chip is a link that toggles `?tag=` and keeps `q`/`author`. */
export function TagFilter({ tags, filters }: { tags: TagChip[]; filters: ListFilters }) {
  const t = useTranslations();
  if (tags.length === 0 && !filters.tag) return null;
  // Keep an active tag visible (so it can be switched off) even if it has no readable recipes.
  const shown =
    filters.tag && !tags.some((x) => x.name === filters.tag)
      ? [{ name: filters.tag, count: 0 }, ...tags]
      : tags;
  return (
    <nav aria-label={t('tags.filterLabel')} className="mt-4">
      <ul className="flex flex-wrap gap-2">
        {shown.map((tag) => {
          const active = filters.tag === tag.name;
          return (
            <li key={tag.name}>
              <Link
                href={toggleTagHref(filters, tag.name)}
                aria-current={active ? 'true' : undefined}
                aria-label={t(active ? 'tags.chipActive' : 'tags.chip', {
                  name: tag.name,
                  count: tag.count,
                })}
                className="inline-flex min-h-11 items-center gap-1 rounded-full border border-neutral-500 px-3 hover:bg-neutral-100 aria-[current=true]:border-emerald-800 aria-[current=true]:bg-emerald-700 aria-[current=true]:text-white dark:hover:bg-neutral-800"
              >
                <span>{tag.name}</span>
                <span aria-hidden="true" className="text-sm opacity-80">
                  {tag.count}
                </span>
              </Link>
            </li>
          );
        })}
        {filters.tag && (
          <li>
            <Link
              href={listHref({ ...filters, tag: undefined })}
              className="inline-flex min-h-11 items-center rounded px-3 underline"
            >
              {t('tags.clear')}
            </Link>
          </li>
        )}
      </ul>
    </nav>
  );
}
