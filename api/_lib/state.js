// Stateless state model.
//
// On Vercel there is no durable disk between serverless invocations, so the
// browser is the source of truth: the client holds the full state object and
// sends it with every request. Each endpoint normalizes the incoming state,
// mutates a copy, and returns the new state for the client to persist.

export const DEFAULT_STATE = {
  network: "wss://s.devnet.rippletest.net:51233",
  sender: {
    wallet: null,
    issuance: null,
    domainId: null,
    credentialAcceptedFromReceiver: false,
    offers: [],
    payments: [],
  },
  receiver: {
    wallet: null,
    issuance: null,
    credentialsIssued: [],
  },
  marketMaker: {
    wallet: null,
    credentialAcceptedFromReceiver: false,
    offers: [],
  },
  trustLines: [],
  log: [],
};

/**
 * Merge a (possibly partial or untrusted) client-supplied state onto the
 * defaults so downstream handlers can rely on every field/array existing.
 */
export function normalizeState(incoming) {
  const base = structuredClone(DEFAULT_STATE);
  if (!incoming || typeof incoming !== "object") return base;
  return {
    ...base,
    ...incoming,
    sender: { ...base.sender, ...(incoming.sender || {}) },
    receiver: { ...base.receiver, ...(incoming.receiver || {}) },
    marketMaker: { ...base.marketMaker, ...(incoming.marketMaker || {}) },
    log: Array.isArray(incoming.log) ? incoming.log : [],
  };
}

export function pushLog(state, entry) {
  state.log.unshift({ at: new Date().toISOString(), ...entry });
  if (state.log.length > 200) state.log.length = 200;
}
