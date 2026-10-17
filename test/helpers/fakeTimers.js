// -----------------------------------------------------------------------------
// Timers the tests drive by hand (the app takes them as `timers`), and a
// helper that lets pending promises settle.
// -----------------------------------------------------------------------------

export const settle = async (rounds = 20) => {
  for (let i = 0; i < rounds; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
};

export function createFakeTimers() {
  let nextId = 1;
  const pending = new Map();
  const add = (kind, fn, ms) => {
    const id = nextId++;
    pending.set(id, { id, kind, fn, ms });
    return id;
  };
  return {
    pending,
    setTimeout: (fn, ms) => add('timeout', fn, ms),
    setInterval: (fn, ms) => add('interval', fn, ms),
    clearTimeout: (id) => pending.delete(id),
    clearInterval: (id) => pending.delete(id),
    timeouts: () => [...pending.values()].filter((t) => t.kind === 'timeout'),
    intervals: () => [...pending.values()].filter((t) => t.kind === 'interval'),
    /** Run (and remove) the pending timeouts once (those `filter` keeps). */
    async runTimeouts(filter = () => true) {
      for (const t of [...pending.values()].filter((t) => t.kind === 'timeout' && filter(t))) {
        pending.delete(t.id);
        await t.fn();
      }
    },
    async runIntervals() {
      for (const t of [...pending.values()].filter((t) => t.kind === 'interval')) {
        await t.fn();
      }
    },
  };
}
