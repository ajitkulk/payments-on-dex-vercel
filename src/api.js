// Stateless API client. The browser holds the authoritative state and sends it
// with every request; mutating endpoints return the new state to persist.

async function call(path, body = {}) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `${res.status} ${res.statusText}`);
  return data;
}

// Endpoints that mutate return { state }. Unwrap to the state object.
const mutate = (path, state, extra = {}) =>
  call(path, { state, ...extra }).then((d) => d.state);

export const api = {
  // Live chain balances for the wallets in `state`. Returns { balances, balanceErrors }.
  balances: (state) => call("/api/balances", { state }),
  setup: (state) => mutate("/api/setup", state),
  reset: () => mutate("/api/reset", {}),
  sender: {
    issue: (state) => mutate("/api/sender/issue-uscoin", state),
    createDomain: (state) => mutate("/api/sender/create-domain", state),
    acceptCredential: (state) => mutate("/api/sender/accept-credential", state),
    createOffer: (state, body) => mutate("/api/sender/create-offer", state, body),
    sendMxc: (state, body) => mutate("/api/sender/send-mxc", state, body),
  },
  receiver: {
    issue: (state) => mutate("/api/receiver/issue-mxcoin", state),
    createCredentials: (state) => mutate("/api/receiver/create-credentials", state),
  },
  marketMaker: {
    acceptCredential: (state) => mutate("/api/marketmaker/accept-credential", state),
    createOffer: (state, body) => mutate("/api/marketmaker/create-offer", state, body),
  },
};
