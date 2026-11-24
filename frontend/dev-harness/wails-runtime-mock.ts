/**
 * CLAVIS — dev harness: the Wails runtime mock. The harness build aliases
 * "@wailsio/runtime" to this file (see vite.harness.config.ts), so the
 * unmodified app code runs in a plain browser. Dev tool only — never
 * shipped; the production build uses the real runtime.
 */
export const Call = {
  ByName: async (_name: string, ..._args: unknown[]): Promise<unknown> => ({}),
};

export const Events = {
  On: (_name: string, _handler: (payload: unknown) => void): (() => void) => () => {},
};
