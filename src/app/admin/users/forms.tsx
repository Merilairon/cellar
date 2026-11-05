'use client';

import { useActionState } from 'react';
import { t } from '@/lib/messages';
import {
  createInviteAction,
  createResetAction,
  deactivateAction,
  type ActionState,
} from './actions';

const initial: ActionState = {};

function Feedback({ state, linkLabel }: { state: ActionState; linkLabel: string }) {
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
