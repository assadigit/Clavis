/**
 * CLAVIS — e2e browser shim for @wailsio/runtime (dev tool, not shipped).
 *
 * The e2e bridge (tools/e2e-bridge) serves this bundle next to the real Go
 * service: Call.ByName becomes a same-origin fetch, Events become no-ops
 * (the bridge never emits). Used to verify the manager UI in a plain
 * browser against the REAL store + dispatcher — the same "web edition"
 * verification the BUILD_LOG records per release.
 */
export const Call = {
  async ByName(name: string, ...args: unknown[]): Promise<unknown> {
    const res = await fetch("/api/call", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, args }),
    });
    const data = (await res.json()) as { result?: unknown; error?: string };
    if (data.error) throw new Error(data.error);
    return data.result ?? null;
  },
};

export const Events = {
  On(_name: string, _cb: (e: unknown) => void): () => void {
    return () => {
      /* the bridge never emits */
    };
  },
  Emit(_name: string, _data?: unknown): void {
    /* no-op */
  },
};
