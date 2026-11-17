import { notFound, redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { notFoundMetadata, titleFromCatalog } from '@/lib/page-meta';
import { getTranslations } from 'next-intl/server';
import { ReviewForm } from '@/components/import/ReviewForm';
import { getCurrentUser } from '@/lib/auth/current-user';
import { getDb } from '@/lib/db';
import { getImportFor } from '@/lib/import/service';
import type { Draft } from '@/lib/import/normalize';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const user = await getCurrentUser();
  // Owner only, like the page: another user's job id is the shared 404.
  return user && getImportFor(getDb(), user, (await params).id)
    ? titleFromCatalog('import.review.title')
    : notFoundMetadata();
}

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) notFound(); // the (app) layout already redirects; this narrows the type
  // Owner only: another user's job id is indistinguishable from a missing one.
  const job = getImportFor(getDb(), user, (await params).id);
  if (!job) notFound();
  if (job.status !== 'needs_review' || !job.draft) redirect('/import');
  const t = await getTranslations();
  return (
    <main>
      <h1 className="mb-4 text-2xl font-bold">{t('import.review.title')}</h1>
      <ReviewForm
        jobId={job.id}
        draft={job.draft as Draft}
        warnings={job.warnings}
        duplicate={job.duplicate}
        headless={job.method === 'headless'}
      />
    </main>
  );
}
