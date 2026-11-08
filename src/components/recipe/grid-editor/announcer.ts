// Polite live-region queue (UX spec 15): one message per user action, and a newer message that
// arrives within `delay` ms replaces the pending one, so five rapid presses read only the last
// result. Timer functions are injected so the logic is testable without a DOM.

export type Announcer = {
  announce: (message: string) => void;
  dispose: () => void;
};

export function createAnnouncer(
  publish: (text: string) => void,
  delay = 400,
  timers: {
    set: (fn: () => void, ms: number) => unknown;
    clear: (id: unknown) => void;
  } = { set: (fn, ms) => setTimeout(fn, ms), clear: (id) => clearTimeout(id as never) },
): Announcer {
  let pending: string | null = null;
  let timer: unknown = null;
  let last = '';
  let flip = false;

  const flush = () => {
    timer = null;
    if (pending === null) return;
    // A repeated identical message must still be re-read: alternate a trailing no-break space.
    flip = pending === last ? !flip : false;
    last = pending;
    publish(flip ? `${pending} ` : pending);
    pending = null;
  };

  return {
    announce(message) {
      pending = message;
      if (timer !== null) timers.clear(timer);
      timer = timers.set(flush, delay);
    },
    dispose() {
      if (timer !== null) timers.clear(timer);
      timer = null;
      pending = null;
    },
  };
}
