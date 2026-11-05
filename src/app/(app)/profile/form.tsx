'use client';

import { useActionState } from 'react';
import { useTranslations } from 'next-intl';
import { updateProfileAction, type ProfileState } from './actions';

const initial: ProfileState = {};

export function ProfileForm({ unitPref }: { unitPref: 'metric' | 'us' }) {
  const t = useTranslations();
  const [state, action, pending] = useActionState(updateProfileAction, initial);
  return (
    <form action={action} className="flex max-w-sm flex-col gap-3">
      <label className="flex flex-col gap-1">
        {t('profile.unitPref')}
        <select
          name="unitPref"
          defaultValue={unitPref}
          className="border border-neutral-400 bg-transparent p-2 dark:bg-neutral-900"
        >
          <option value="metric">{t('profile.metric')}</option>
          <option value="us">{t('profile.us')}</option>
        </select>
      </label>
      <button type="submit" disabled={pending} className="bg-emerald-700 p-2 text-white">
        {t('profile.submit')}
      </button>
      {state.error && (
        <p role="alert" className="text-red-600">
          {t(state.error)}
        </p>
      )}
      {state.message && <p role="status">{t(state.message)}</p>}
    </form>
  );
}
