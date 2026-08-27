import express from "express";
import cors from "cors";
import { DEFAULT_STATE, normalizeState, pushLog } from "./state.js";
import {
  fundOrLoadWallet,
  enableDefaultRipple,
  setTrustLine,
  mintIou,
  createPermissionedDomain,
  createCredential,
  acceptCredential,
  createOffer,
  sendIouPayment,
  getAccountLines,
  getAccountInfo,
  currencyCode,
} from "./xrpl-helpers.js";

const USC = "USC";
const MXC = "MXC";
const CREDENTIAL_LABEL = "KYC";

export const app = express();
app.use(cors());
// The whole state object rides along in the request body, so allow a roomy limit.
app.use(express.json({ limit: "1mb" }));

// Read the client-supplied state from the request body. The browser is the
// source of truth in this stateless model.
function readState(req) {
  return normalizeState(req.body?.state);
}

// Wrap a handler that takes (state, req) and returns the mutated state. The
// response always echoes the full state back so the client can persist it.
function wrap(handler) {
  return async (req, res) => {
    const state = readState(req);
    try {
      const next = await handler(state, req);
      res.json({ state: next ?? state });
    } catch (err) {
      console.error("[error]", err);
      pushLog(state, {
        level: "error",
        message: err.message,
        engine_result: err.result?.meta?.TransactionResult,
      });
      res.status(500).json({
        error: err.message,
        engine_result: err.result?.meta?.TransactionResult,
        state,
      });
    }
  };
}

function summarizeTx(txResult, kind) {
  return {
    kind,
    hash: txResult.hash,
    ledger_index: txResult.ledger_index,
    engine_result: txResult.meta?.TransactionResult,
  };
}

function ensureWallet(persona, state) {
  const personaState = state[persona];
  if (!personaState?.wallet?.seed) {
    throw new Error(`${persona} has no wallet yet — run Fund wallets first`);
  }
  return personaState.wallet;
}

async function loadWallet(personaWalletRecord) {
  return fundOrLoadWallet(personaWalletRecord.seed);
}

// ──────────────────────────────────────────────────────────────
// Health + live balances
// ──────────────────────────────────────────────────────────────

app.get("/api/health", (_req, res) => res.json({ ok: true }));

// Balances are live chain reads, not persisted state. The client posts its
// current state (for the wallet addresses) and gets fresh balances back.
app.post("/api/balances", async (req, res) => {
  const state = readState(req);
  const balances = {};
  const balanceErrors = {};
  for (const role of ["sender", "receiver", "marketMaker"]) {
    const w = state[role]?.wallet;
    if (!w) continue;
    try {
      const info = await getAccountInfo(w.address);
      const lines = await getAccountLines(w.address);
      balances[role] = {
        xrpDrops: info?.Balance ?? null,
        lines: lines.map((l) => ({
          currency: l.currency,
          issuer: l.account,
          balance: l.balance,
          limit: l.limit,
        })),
      };
    } catch (err) {
      // Devnet rippled nodes occasionally return notSynced or similar
      // transient errors. Skip balances for this role rather than failing
      // the whole request — the UI can operate without live balances.
      balances[role] = null;
      balanceErrors[role] = err?.data?.error || err?.message || String(err);
    }
  }
  res.json({ balances, balanceErrors });
});

// ──────────────────────────────────────────────────────────────
// Setup / reset
// ──────────────────────────────────────────────────────────────

app.post(
  "/api/setup",
  wrap(async (state) => {
    pushLog(state, { level: "info", message: "Funding wallets via devnet faucet…" });
    for (const persona of ["sender", "receiver", "marketMaker"]) {
      const existingSeed = state[persona].wallet?.seed;
      const wallet = await fundOrLoadWallet(existingSeed);
      state[persona].wallet = {
        address: wallet.address,
        seed: wallet.seed,
        publicKey: wallet.publicKey,
      };
      pushLog(state, {
        level: "info",
        message: `${persona} funded: ${wallet.address}`,
      });
    }
    return state;
  }),
);

app.post(
  "/api/reset",
  wrap(async () => structuredClone(DEFAULT_STATE)),
);

// ──────────────────────────────────────────────────────────────
// Sender
// ──────────────────────────────────────────────────────────────

app.post(
  "/api/sender/issue-uscoin",
  wrap(async (state) => {
    const senderRec = ensureWallet("sender", state);
    const sender = await loadWallet(senderRec);

    await enableDefaultRipple(sender);

    state.sender.issuance = {
      currency: USC,
      currencyHex: currencyCode(USC),
      issuer: sender.address,
      issuedSupply: "1000000",
    };
    pushLog(state, {
      level: "tx",
      message: `Sender enabled DefaultRipple — USCoin issuer ready (1,000,000 USC capacity)`,
    });
    return state;
  }),
);

app.post(
  "/api/sender/create-domain",
  wrap(async (state) => {
    const senderRec = ensureWallet("sender", state);
    const receiverRec = ensureWallet("receiver", state);
    const sender = await loadWallet(senderRec);

    const { result, domainId } = await createPermissionedDomain(sender, [
      { issuer: receiverRec.address, type: CREDENTIAL_LABEL },
    ]);

    state.sender.domainId = domainId;
    state.sender.domainTx = summarizeTx(result, "PermissionedDomainSet");
    pushLog(state, {
      level: "tx",
      message: `Sender created PermissionedDomain ${domainId?.slice(0, 12)}…`,
    });
    return state;
  }),
);

app.post(
  "/api/sender/accept-credential",
  wrap(async (state) => {
    const senderRec = ensureWallet("sender", state);
    const receiverRec = ensureWallet("receiver", state);
    const sender = await loadWallet(senderRec);

    try {
      const result = await acceptCredential(sender, receiverRec.address, CREDENTIAL_LABEL);
      state.sender.acceptTx = summarizeTx(result, "CredentialAccept");
      pushLog(state, {
        level: "tx",
        message: `Sender accepted "${CREDENTIAL_LABEL}" credential from receiver`,
      });
    } catch (err) {
      if (err.result?.meta?.TransactionResult !== "tecDUPLICATE") throw err;
      pushLog(state, {
        level: "info",
        message: `Sender already accepted "${CREDENTIAL_LABEL}" credential from receiver — skipped`,
      });
    }
    state.sender.credentialAcceptedFromReceiver = true;
    return state;
  }),
);

app.post(
  "/api/sender/create-offer",
  wrap(async (state, req) => {
    const senderRec = ensureWallet("sender", state);
    const receiverRec = ensureWallet("receiver", state);
    if (!state.sender.domainId) throw new Error("Sender must create a domain first");
    if (!state.receiver.issuance) throw new Error("Receiver must issue MXCoin first");

    const sender = await loadWallet(senderRec);
    const offerUsc = String(req.body?.offerUsc ?? 1000);
    const wantMxc = String(req.body?.wantMxc ?? 1000);

    // Sender needs a trust line to MXC to be able to receive it
    await setTrustLine(sender, receiverRec.address, MXC, 1_000_000);

    const result = await createOffer(sender, {
      takerGets: { currency: currencyCode(USC), issuer: sender.address, value: offerUsc },
      takerPays: { currency: currencyCode(MXC), issuer: receiverRec.address, value: wantMxc },
      domainId: state.sender.domainId,
    });

    const tx = summarizeTx(result, "OfferCreate (permissioned)");
    state.sender.offers.unshift({ ...tx, offerUsc, wantMxc });
    pushLog(state, {
      level: "tx",
      message: `Sender posted permissioned offer: gives ${offerUsc} USC, wants ${wantMxc} MXC`,
    });
    return state;
  }),
);

app.post(
  "/api/sender/send-mxc",
  wrap(async (state, req) => {
    const senderRec = ensureWallet("sender", state);
    const receiverRec = ensureWallet("receiver", state);
    const sender = await loadWallet(senderRec);
    const value = String(req.body?.value ?? 50);

    const result = await sendIouPayment(sender, receiverRec.address, MXC, receiverRec.address, value);
    const tx = summarizeTx(result, "Payment (MXC)");
    state.sender.payments.unshift({ ...tx, value, currency: MXC });
    pushLog(state, {
      level: "tx",
      message: `Sender sent ${value} MXC to receiver`,
    });
    return state;
  }),
);

// ──────────────────────────────────────────────────────────────
// Receiver
// ──────────────────────────────────────────────────────────────

app.post(
  "/api/receiver/issue-mxcoin",
  wrap(async (state) => {
    const receiverRec = ensureWallet("receiver", state);
    const receiver = await loadWallet(receiverRec);

    await enableDefaultRipple(receiver);

    state.receiver.issuance = {
      currency: MXC,
      currencyHex: currencyCode(MXC),
      issuer: receiver.address,
      issuedSupply: "1000000",
    };
    pushLog(state, {
      level: "tx",
      message: `Receiver enabled DefaultRipple — MXCoin issuer ready (1,000,000 MXC capacity)`,
    });
    return state;
  }),
);

app.post(
  "/api/receiver/create-credentials",
  wrap(async (state) => {
    const receiverRec = ensureWallet("receiver", state);
    const senderRec = ensureWallet("sender", state);
    const mmRec = ensureWallet("marketMaker", state);
    const receiver = await loadWallet(receiverRec);

    const subjects = [
      { role: "sender", address: senderRec.address },
      { role: "marketMaker", address: mmRec.address },
      { role: "receiver", address: receiverRec.address },
    ];

    const created = state.receiver.credentialsIssued ?? [];
    for (const subj of subjects) {
      const alreadyIssued = created.some(
        (c) => c.subject === subj.address && !c.self,
      );
      if (alreadyIssued) continue;
      try {
        const result = await createCredential(
          receiver,
          subj.address,
          CREDENTIAL_LABEL,
          `https://example.com/credentials/${subj.role}`,
        );
        const tx = summarizeTx(result, "CredentialCreate");
        created.push({ ...tx, subject: subj.address, role: subj.role });
        pushLog(state, {
          level: "tx",
          message: `Receiver issued "${CREDENTIAL_LABEL}" credential to ${subj.role} (${subj.address})`,
        });
      } catch (err) {
        if (err.result?.meta?.TransactionResult === "tecDUPLICATE") {
          created.push({ subject: subj.address, role: subj.role, note: "already on-chain" });
          pushLog(state, {
            level: "info",
            message: `Credential for ${subj.role} already on-chain — skipped`,
          });
        } else {
          throw err;
        }
      }
      state.receiver.credentialsIssued = created;
    }
    // Note: a credential where Issuer == Subject is auto-accepted on creation,
    // so the receiver does not need a separate CredentialAccept for itself.
    return state;
  }),
);

// ──────────────────────────────────────────────────────────────
// Market maker
// ──────────────────────────────────────────────────────────────

app.post(
  "/api/marketmaker/accept-credential",
  wrap(async (state) => {
    const mmRec = ensureWallet("marketMaker", state);
    const receiverRec = ensureWallet("receiver", state);
    const mm = await loadWallet(mmRec);

    try {
      const result = await acceptCredential(mm, receiverRec.address, CREDENTIAL_LABEL);
      state.marketMaker.acceptTx = summarizeTx(result, "CredentialAccept");
      pushLog(state, {
        level: "tx",
        message: `Market maker accepted "${CREDENTIAL_LABEL}" credential from receiver`,
      });
    } catch (err) {
      if (err.result?.meta?.TransactionResult !== "tecDUPLICATE") throw err;
      pushLog(state, {
        level: "info",
        message: `Market maker already accepted "${CREDENTIAL_LABEL}" credential from receiver — skipped`,
      });
    }
    state.marketMaker.credentialAcceptedFromReceiver = true;
    return state;
  }),
);

app.post(
  "/api/marketmaker/create-offer",
  wrap(async (state, req) => {
    const mmRec = ensureWallet("marketMaker", state);
    const senderRec = ensureWallet("sender", state);
    const receiverRec = ensureWallet("receiver", state);
    if (!state.sender.domainId) throw new Error("Sender must create a domain first");
    if (!state.sender.issuance) throw new Error("Sender must issue USCoin first");
    if (!state.receiver.issuance) throw new Error("Receiver must issue MXCoin first");

    const mm = await loadWallet(mmRec);

    // Market maker offers MXC, asks for USC — needs trust lines for both
    await setTrustLine(mm, receiverRec.address, MXC, 1_000_000);
    await setTrustLine(mm, senderRec.address, USC, 1_000_000);

    // For the market maker to actually offer MXC, the receiver must mint some to them
    const receiver = await loadWallet(receiverRec);
    const seedMxc = String(req.body?.seedMxc ?? 10_000);
    await mintIou(receiver, mm.address, MXC, seedMxc);
    pushLog(state, {
      level: "tx",
      message: `Receiver minted ${seedMxc} MXC to market maker (seed liquidity)`,
    });

    const offerMxc = String(req.body?.offerMxc ?? 500);
    const wantUsc = String(req.body?.wantUsc ?? 500);

    const result = await createOffer(mm, {
      takerGets: { currency: currencyCode(MXC), issuer: receiverRec.address, value: offerMxc },
      takerPays: { currency: currencyCode(USC), issuer: senderRec.address, value: wantUsc },
      domainId: state.sender.domainId,
    });

    const tx = summarizeTx(result, "OfferCreate (permissioned)");
    state.marketMaker.offers.unshift({ ...tx, offerMxc, wantUsc });
    pushLog(state, {
      level: "tx",
      message: `Market maker posted permissioned offer: gives ${offerMxc} MXC, wants ${wantUsc} USC`,
    });
    return state;
  }),
);

export default app;
