import React, { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api.js";
import { loadState, saveState } from "./defaultState.js";
import { PersonaColumn } from "./PersonaColumn.jsx";

const DEVNET_EXPLORER = "https://devnet.xrpl.org";

export default function App() {
  // The browser is the source of truth: hydrate from localStorage, persist on
  // every change. Balances are live chain reads, kept separately (not persisted).
  const [state, setState] = useState(loadState);
  const [balances, setBalances] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null);

  const stateRef = useRef(state);
  stateRef.current = state;

  const refreshBalances = useCallback(async (s) => {
    const hasWallet =
      s.sender.wallet || s.receiver.wallet || s.marketMaker.wallet;
    if (!hasWallet) return;
    try {
      const { balances: b } = await api.balances(s);
      setBalances(b || {});
    } catch {
      // Transient devnet error — leave existing balances in place.
    }
  }, []);

  // Fetch balances once on load if we already have funded wallets.
  useEffect(() => {
    refreshBalances(stateRef.current);
  }, [refreshBalances]);

  const run = useCallback(
    async (label, fn) => {
      setBusy(label);
      setError(null);
      try {
        const next = await fn(stateRef.current);
        setState(next);
        saveState(next);
        await refreshBalances(next);
      } catch (err) {
        setError(err.message);
      } finally {
        setBusy(null);
      }
    },
    [refreshBalances],
  );

  const senderReady = !!state.sender.wallet;
  const receiverReady = !!state.receiver.wallet;
  const mmReady = !!state.marketMaker.wallet;
  const allFunded = senderReady && receiverReady && mmReady;

  return (
    <div className="app">
      <header className="app-header">
        <div>
          <h1>XRPL Permissioned DEX Demo</h1>
          <p className="subtitle">
            Devnet · Sender (USC) ↔ Receiver (MXC) ↔ Market maker · permissioned domain via credentials
          </p>
        </div>
        <div className="header-actions">
          <button
            disabled={busy === "setup"}
            onClick={() => run("setup", (s) => api.setup(s))}
          >
            {busy === "setup" ? "Funding…" : allFunded ? "Re-fund / sync" : "1. Fund wallets"}
          </button>
          <button
            className="ghost"
            disabled={!!busy}
            onClick={() =>
              run("reset", async () => {
                const s = await api.reset();
                setBalances({});
                return s;
              })
            }
          >
            Reset state
          </button>
        </div>
      </header>

      {error && (
        <div className="error-banner">
          <strong>Error:</strong> {error}
        </div>
      )}

      <main className="columns">
        <PersonaColumn
          title="Sender"
          subtitle="USCoin issuer"
          wallet={state.sender.wallet}
          balances={balances?.sender}
          accent="#3b82f6"
          actions={[
            {
              label: "Issue USCoin + mint 1M",
              done: !!state.sender.issuance,
              disabled: !allFunded,
              run: () => run("sender:issue", (s) => api.sender.issue(s)),
            },
            {
              label: "Create permissioned domain",
              done: !!state.sender.domainId,
              disabled: !state.sender.issuance,
              run: () => run("sender:domain", (s) => api.sender.createDomain(s)),
            },
            {
              label: "Accept credential from receiver",
              done: !!state.sender.credentialAcceptedFromReceiver,
              disabled: state.receiver.credentialsIssued.length === 0,
              hint: state.receiver.credentialsIssued.length === 0
                ? "Receiver must issue credentials first"
                : null,
              run: () => run("sender:accept", (s) => api.sender.acceptCredential(s)),
            },
            {
              label: "Create offer (1000 USC for 1000 MXC) in domain",
              done: state.sender.offers.length > 0,
              disabled: !state.sender.domainId || !state.receiver.issuance,
              run: () =>
                run("sender:offer", (s) =>
                  api.sender.createOffer(s, { offerUsc: 1000, wantMxc: 1000 }),
                ),
            },
            {
              label: "Send 50 MXC to receiver",
              done: (state.sender.payments || []).length > 0,
              disabled: state.sender.offers.length === 0,
              hint: state.sender.offers.length === 0
                ? "Post the offer first so sender receives MXC"
                : null,
              run: () =>
                run("sender:payment", (s) => api.sender.sendMxc(s, { value: 50 })),
            },
          ]}
          details={[
            state.sender.issuance && {
              label: "USCoin issuance",
              value: `${state.sender.issuance.issuedSupply} ${state.sender.issuance.currency}`,
            },
            state.sender.domainId && {
              label: "DomainID",
              value: state.sender.domainId,
              mono: true,
            },
            ...(state.sender.offers || []).map((o, i) => ({
              label: `Offer #${state.sender.offers.length - i}`,
              value: `${o.offerUsc} USC → ${o.wantMxc} MXC`,
              link: `${DEVNET_EXPLORER}/transactions/${o.hash}`,
            })),
          ].filter(Boolean)}
        />

        <PersonaColumn
          title="Receiver"
          subtitle="MXCoin issuer + credential issuer"
          wallet={state.receiver.wallet}
          balances={balances?.receiver}
          accent="#10b981"
          actions={[
            {
              label: "Issue MXCoin + mint 1M",
              done: !!state.receiver.issuance,
              disabled: !allFunded,
              run: () => run("receiver:issue", (s) => api.receiver.issue(s)),
            },
            {
              label: "Issue KYC credentials to all 3",
              done: state.receiver.credentialsIssued.length > 0,
              disabled: !state.receiver.issuance,
              hint: "CredentialCreate → sender, market maker, self",
              run: () =>
                run("receiver:credentials", (s) => api.receiver.createCredentials(s)),
            },
          ]}
          details={[
            state.receiver.issuance && {
              label: "MXCoin issuance",
              value: `${state.receiver.issuance.issuedSupply} ${state.receiver.issuance.currency}`,
            },
            ...(state.receiver.credentialsIssued || []).map((c) => ({
              label: `Credential → ${c.role || (c.self ? "self" : "subject")}`,
              value: c.hash,
              mono: true,
              link: `${DEVNET_EXPLORER}/transactions/${c.hash}`,
            })),
          ].filter(Boolean)}
        />

        <PersonaColumn
          title="Market maker"
          subtitle="Permissioned liquidity provider"
          wallet={state.marketMaker.wallet}
          balances={balances?.marketMaker}
          accent="#f59e0b"
          actions={[
            {
              label: "Accept credential from receiver",
              done: !!state.marketMaker.credentialAcceptedFromReceiver,
              disabled: state.receiver.credentialsIssued.length === 0,
              hint: state.receiver.credentialsIssued.length === 0
                ? "Receiver must issue credentials first"
                : null,
              run: () => run("mm:accept", (s) => api.marketMaker.acceptCredential(s)),
            },
            {
              label: "Create offer (500 MXC for 500 USC) in domain",
              done: state.marketMaker.offers.length > 0,
              disabled:
                !state.sender.domainId ||
                !state.receiver.issuance ||
                !state.marketMaker.credentialAcceptedFromReceiver,
              hint:
                !state.marketMaker.credentialAcceptedFromReceiver
                  ? "Accept the credential first"
                  : null,
              run: () =>
                run("mm:offer", (s) =>
                  api.marketMaker.createOffer(s, {
                    seedMxc: 10000,
                    offerMxc: 500,
                    wantUsc: 500,
                  }),
                ),
            },
          ]}
          details={(state.marketMaker.offers || []).map((o, i) => ({
            label: `Offer #${state.marketMaker.offers.length - i}`,
            value: `${o.offerMxc} MXC → ${o.wantUsc} USC`,
            link: `${DEVNET_EXPLORER}/transactions/${o.hash}`,
          }))}
        />
      </main>

      <section className="log-panel">
        <h2>Activity log</h2>
        <ul className="log">
          {(state.log || []).map((entry, i) => (
            <li key={i} className={`log-entry log-${entry.level || "info"}`}>
              <span className="log-time">{new Date(entry.at).toLocaleTimeString()}</span>
              <span className="log-msg">{entry.message}</span>
              {entry.engine_result && (
                <span className="log-result">{entry.engine_result}</span>
              )}
            </li>
          ))}
          {(!state.log || state.log.length === 0) && (
            <li className="log-empty">No activity yet — click "Fund wallets" to start.</li>
          )}
        </ul>
      </section>
    </div>
  );
}
