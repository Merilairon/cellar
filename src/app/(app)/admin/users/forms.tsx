'use client';

import { useActionState, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  createInviteAction,
  createResetAction,
  deactivateAction,
  deleteUserAction,
  type ActionState,
} from './actions';

const initial: ActionState = {};

function Feedback({ state, linkLabel }: { state: ActionState; linkLabel: string }) {
  const t = useTranslations();
  return (
    <>
      {state.error && (
        <p role="alert" className="text-red-600">
          {t(state.error)}
        </p>
      )}
      {state.message && <p role="status">{t(state.message)}</p>}
      {state.link && (
        <p role="status">
          {linkLabel}{' '}
          <code data-testid="one-time-link" className="break-all">
            {state.link}
          </code>
        </p>
      )}
    </>
  );
}

export function InviteForm() {
  const t = useTranslations();
  const [state, action, pending] = useActionState(createInviteAction, initial);
  return (
    <form action={action} className="flex flex-col gap-2">
      <label className="flex flex-col gap-1">
        {t('admin.users.inviteEmail')}
        <input name="email" type="email" maxLength={254} className="border p-2" />
      </label>
      <button type="submit" disabled={pending} className="bg-emerald-600 p-2 text-white">
        {t('admin.users.inviteSubmit')}
      </button>
      <Feedback state={state} linkLabel={t('admin.users.linkOnce')} />
    </form>
  );
}

export function ResetButton({ userId }: { userId: string }) {
  const t = useTranslations();
  const [state, action, pending] = useActionState(createResetAction, initial);
  return (
    <form action={action}>
      <input type="hidden" name="userId" value={userId} />
      <button type="submit" disabled={pending} className="underline">
        {t('admin.users.reset')}
      </button>
      <Feedback state={state} linkLabel={t('admin.users.resetLinkOnce')} />
    </form>
  );
}

export function DeactivateButton({ userId }: { userId: string }) {
  const t = useTranslations();
  const [state, action, pending] = useActionState(deactivateAction, initial);
  return (
    <form action={action}>
      <input type="hidden" name="userId" value={userId} />
      <button type="submit" disabled={pending} className="underline">
        {t('admin.users.deactivate')}
      </button>
      <Feedback state={state} linkLabel="" />
    </form>
  );
}

export function DeleteButton({
  userId,
  reassignOptions,
}: {
  userId: string;
  reassignOptions: { id: string; label: string }[];
}) {
  const t = useTranslations();
  const [state, action, pending] = useActionState(deleteUserAction, initial);
  const [choice, setChoice] = useState<'delete' | 'reassign'>('delete');
  const targets = reassignOptions.filter((o) => o.id !== userId);
  return (
    <details>
      <summary className="cursor-pointer underline">{t('admin.users.delete')}</summary>
      <form action={action} className="flex flex-col gap-1">
        <input type="hidden" name="userId" value={userId} />
        <p>{t('admin.users.deleteWarning')}</p>
        <fieldset className="flex flex-col gap-1">
          <legend>{t('admin.users.recipesLegend')}</legend>
          <label>
            <input
              type="radio"
              name="recipes"
              value="delete"
              checked={choice === 'delete'}
              onChange={() => setChoice('delete')}
            />{' '}
            {t('admin.users.recipesDelete')}
          </label>
          <label>
            <input
              type="radio"
              name="recipes"
              value="reassign"
              checked={choice === 'reassign'}
              onChange={() => setChoice('reassign')}
            />{' '}
            {t('admin.users.recipesReassign')}
          </label>
          {choice === 'reassign' && (
            <select name="reassignTo" required aria-label={t('admin.users.reassignTo')}>
              {targets.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          )}
        </fieldset>
        <button type="submit" disabled={pending} className="bg-red-600 p-2 text-white">
          {t('admin.users.deleteConfirm')}
        </button>
        <Feedback state={state} linkLabel="" />
      </form>
    </details>
  );
}
