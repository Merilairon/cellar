// Pure helpers for the notes UI: limits, error mapping, counter announcements.

export const NOTE_MAX = 4000;

/** The reason the Add button is disabled, or null when the text can be saved. */
export function noteReason(
  text: string,
): { key: 'empty' } | { key: 'tooLong'; over: number } | null {
  if (text.trim() === '') return { key: 'empty' };
  if (text.length > NOTE_MAX) return { key: 'tooLong', over: text.length - NOTE_MAX };
  return null;
}

export type CounterAnnouncement = { key: 'left'; n: number } | { key: 'limit' } | null;

/** One announcement when typing crosses 3800, 3950 or 4000 characters (not on every keystroke). */
export function counterAnnouncement(prev: number, next: number): CounterAnnouncement {
  if (next >= NOTE_MAX && prev < NOTE_MAX) return { key: 'limit' };
  if (next >= 3950 && prev < 3950 && next < NOTE_MAX) return { key: 'left', n: NOTE_MAX - 3950 };
  if (next >= 3800 && prev < 3800 && next < 3950) return { key: 'left', n: NOTE_MAX - 3800 };
  return null;
}

export type NoteErrorKey = 'limit' | 'empty' | 'tooLong' | 'forbidden' | 'network' | 'generic';

/** Map a failed note response (status 0 = no response) to one message key. */
export function noteErrorFor(status: number, body: unknown): NoteErrorKey {
  if (status === 0) return 'network';
  if (status === 401 || status === 403 || status === 404) return 'forbidden';
  if (status === 422) {
    const code = (body as { errors?: Array<{ code?: unknown }> } | null)?.errors?.[0]?.code;
    if (code === 'note_limit') return 'limit';
    if (code === 'too_small') return 'empty';
    if (code === 'too_big') return 'tooLong';
    return 'generic';
  }
  return 'network';
}
