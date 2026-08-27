import React from "react";

const DEVNET_EXPLORER = "https://devnet.xrpl.org";

export function PersonaColumn({
  title,
  subtitle,
  wallet,
  balances,
  accent,
  actions,
  details,
}) {
  return (
    <section className="persona" style={{ "--accent": accent }}>
      <header>
        <h2>{title}</h2>
        <p className="persona-sub">{subtitle}</p>
      </header>

      <div className="wallet">
        {wallet ? (
          <>
            <div className="wallet-addr">
              <a
                href={`${DEVNET_EXPLORER}/accounts/${wallet.address}`}
                target="_blank"
                rel="noreferrer"
                title="Open on devnet explorer"
              >
                {wallet.address}
              </a>
            </div>
            {balances && (
              <div className="balances">
                <div>
                  XRP: {balances.xrpDrops ? (Number(balances.xrpDrops) / 1_000_000).toFixed(4) : "—"}
                </div>
                {(balances.lines || []).map((l) => (
                  <div key={`${l.currency}-${l.issuer}`}>
                    {decodeCurrency(l.currency)}: {l.balance}
                  </div>
                ))}
              </div>
            )}
          </>
        ) : (
          <div className="wallet-empty">No wallet — fund first</div>
        )}
      </div>

      <ol className="actions">
        {actions.map((a, i) => (
          <li key={i}>
            <button
              disabled={a.disabled || a.done}
              onClick={a.run}
              className={a.done ? "done" : ""}
            >
              {a.done ? "✓ " : ""}{a.label}
            </button>
            {a.hint && <div className="hint">{a.hint}</div>}
          </li>
        ))}
      </ol>

      {details && details.length > 0 && (
        <div className="details">
          {details.map((d, i) => (
            <div key={i} className="detail-row">
              <div className="detail-label">{d.label}</div>
              <div className={`detail-value ${d.mono ? "mono" : ""}`}>
                {d.link ? (
                  <a href={d.link} target="_blank" rel="noreferrer">
                    {truncate(d.value)}
                  </a>
                ) : (
                  truncate(d.value)
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function truncate(s) {
  if (!s) return "";
  if (s.length <= 24) return s;
  return `${s.slice(0, 10)}…${s.slice(-8)}`;
}

function decodeCurrency(code) {
  if (code.length === 40) {
    try {
      const bytes = code.match(/.{2}/g).map((h) => parseInt(h, 16));
      return String.fromCharCode(...bytes).replace(/\0+$/, "");
    } catch {
      return code;
    }
  }
  return code;
}
