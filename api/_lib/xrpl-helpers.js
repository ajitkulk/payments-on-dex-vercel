import { Client, Wallet, convertStringToHex } from "xrpl";

const NETWORK = "wss://s.devnet.rippletest.net:51233";

// AccountSet flag: asfDefaultRipple (8) — required for IOU issuers so trust lines ripple by default
const ASF_DEFAULT_RIPPLE = 8;

let _client;

export async function getClient() {
  if (_client && _client.isConnected()) return _client;
  _client = new Client(NETWORK);
  await _client.connect();
  return _client;
}

export async function disconnect() {
  if (_client && _client.isConnected()) await _client.disconnect();
  _client = null;
}

/** Convert short currency code (≤3 chars) as-is, otherwise pad/uppercase to 40-char hex. */
export function currencyCode(code) {
  if (code.length <= 3) return code.toUpperCase();
  return convertStringToHex(code).padEnd(40, "0").toUpperCase();
}

/** Credential type per XLS-70: arbitrary hex blob, up to 64 bytes (128 hex chars). */
export function credentialTypeHex(label) {
  return convertStringToHex(label).toUpperCase();
}

/** Fund a new wallet via the devnet faucet. Reuse the saved wallet if one is supplied. */
export async function fundOrLoadWallet(savedSeed) {
  const client = await getClient();
  if (savedSeed) {
    const wallet = Wallet.fromSeed(savedSeed);
    // ensure account is funded; if not, fund via faucet
    try {
      await client.request({
        command: "account_info",
        account: wallet.address,
        ledger_index: "validated",
      });
      return wallet;
    } catch (err) {
      if (err?.data?.error !== "actNotFound") throw err;
      const { wallet: funded } = await client.fundWallet(wallet);
      return funded;
    }
  }
  const { wallet } = await client.fundWallet();
  return wallet;
}

/** Submit a transaction and assert tesSUCCESS. */
export async function submit(wallet, tx, { description } = {}) {
  const client = await getClient();
  const prepared = await client.autofill(tx);
  const signed = wallet.sign(prepared);
  const result = await client.submitAndWait(signed.tx_blob);
  const code = result.result.meta?.TransactionResult;
  if (code !== "tesSUCCESS") {
    const message = `${description || tx.TransactionType} failed: ${code}`;
    const err = new Error(message);
    err.result = result.result;
    throw err;
  }
  return result.result;
}

/** Enable DefaultRipple on an IOU issuer. Idempotent. */
export async function enableDefaultRipple(wallet) {
  return submit(
    wallet,
    {
      TransactionType: "AccountSet",
      Account: wallet.address,
      SetFlag: ASF_DEFAULT_RIPPLE,
    },
    { description: "AccountSet asfDefaultRipple" },
  );
}

/** Create or update a trust line from `holder` to `issuer` for a given currency. */
export async function setTrustLine(holderWallet, issuerAddress, currency, limit) {
  return submit(
    holderWallet,
    {
      TransactionType: "TrustSet",
      Account: holderWallet.address,
      LimitAmount: {
        currency: currencyCode(currency),
        issuer: issuerAddress,
        value: String(limit),
      },
    },
    { description: `TrustSet ${currency} from ${holderWallet.address}` },
  );
}

/** Issue (mint) an IOU by sending a Payment from the issuer to a holder. */
export async function mintIou(issuerWallet, holderAddress, currency, value) {
  return submit(
    issuerWallet,
    {
      TransactionType: "Payment",
      Account: issuerWallet.address,
      Destination: holderAddress,
      Amount: {
        currency: currencyCode(currency),
        issuer: issuerWallet.address,
        value: String(value),
      },
    },
    { description: `Mint ${value} ${currency} to ${holderAddress}` },
  );
}

/** Create a permissioned domain accepting credentials of the given (issuer, type) pairs. */
export async function createPermissionedDomain(ownerWallet, acceptedCredentials) {
  const result = await submit(
    ownerWallet,
    {
      TransactionType: "PermissionedDomainSet",
      Account: ownerWallet.address,
      AcceptedCredentials: acceptedCredentials.map((c) => ({
        Credential: {
          Issuer: c.issuer,
          CredentialType: credentialTypeHex(c.type),
        },
      })),
    },
    { description: "PermissionedDomainSet (create)" },
  );

  const domainId = extractDomainId(result);
  return { result, domainId };
}

function extractDomainId(txResult) {
  const nodes = txResult.meta?.AffectedNodes || [];
  for (const node of nodes) {
    const created = node.CreatedNode;
    if (created?.LedgerEntryType === "PermissionedDomain") return created.LedgerIndex;
  }
  return null;
}

export async function createCredential(issuerWallet, subjectAddress, credentialLabel, uri) {
  const tx = {
    TransactionType: "CredentialCreate",
    Account: issuerWallet.address,
    Subject: subjectAddress,
    CredentialType: credentialTypeHex(credentialLabel),
  };
  if (uri) tx.URI = convertStringToHex(uri);
  return submit(issuerWallet, tx, {
    description: `CredentialCreate ${credentialLabel} for ${subjectAddress}`,
  });
}

export async function acceptCredential(subjectWallet, issuerAddress, credentialLabel) {
  return submit(
    subjectWallet,
    {
      TransactionType: "CredentialAccept",
      Account: subjectWallet.address,
      Issuer: issuerAddress,
      CredentialType: credentialTypeHex(credentialLabel),
    },
    { description: `CredentialAccept ${credentialLabel} from ${issuerAddress}` },
  );
}

/** Create an OfferCreate transaction, optionally scoped to a permissioned domain. */
export async function createOffer(
  wallet,
  { takerGets, takerPays, domainId, hybrid },
) {
  const tx = {
    TransactionType: "OfferCreate",
    Account: wallet.address,
    TakerGets: takerGets,
    TakerPays: takerPays,
  };
  if (domainId) tx.DomainID = domainId;
  if (hybrid) tx.Flags = 0x00100000; // tfHybrid

  return submit(wallet, tx, {
    description: `OfferCreate${domainId ? " (permissioned)" : ""}`,
  });
}

export async function sendIouPayment(senderWallet, destination, currency, issuer, value) {
  return submit(
    senderWallet,
    {
      TransactionType: "Payment",
      Account: senderWallet.address,
      Destination: destination,
      Amount: {
        currency: currencyCode(currency),
        issuer,
        value: String(value),
      },
    },
    { description: `Payment ${value} ${currency} to ${destination}` },
  );
}

export async function getAccountLines(address) {
  const client = await getClient();
  const res = await client.request({
    command: "account_lines",
    account: address,
    ledger_index: "validated",
  });
  return res.result.lines;
}

export async function getAccountInfo(address) {
  const client = await getClient();
  try {
    const res = await client.request({
      command: "account_info",
      account: address,
      ledger_index: "validated",
    });
    return res.result.account_data;
  } catch (err) {
    if (err?.data?.error === "actNotFound") return null;
    throw err;
  }
}
