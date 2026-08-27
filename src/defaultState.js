// Mirror of the backend DEFAULT_STATE. The browser is the source of truth in
// the serverless model, so the initial/empty state lives here and is persisted
// to localStorage across reloads.
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

const STORAGE_KEY = "payments-on-dex:state";

export function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return structuredClone(DEFAULT_STATE);
    return { ...structuredClone(DEFAULT_STATE), ...JSON.parse(raw) };
  } catch {
    return structuredClone(DEFAULT_STATE);
  }
}

export function saveState(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Ignore quota/serialization errors — state still lives in memory.
  }
}

export function clearState() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // no-op
  }
}
