"use client";

import { useEffect, useState } from "react";
import { TrustBadge } from "@/components/registry/trust-badge";
import type { TrustLevel } from "@/lib/registry/trust-rules";

const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const DEBOUNCE_MS = 350;

interface Verdict {
  trust: TrustLevel;
  detail: string;
  symbol: string | null;
  name: string | null;
  impersonates: { symbol: string; address: string } | null;
}

interface TokenLookupProps {
  value: string;
  onChange: (value: string) => void;
}

// The address box on the watch form. It asks the public token endpoint the
// same question an agent would, and shows the answer before the watcher
// exists: what this token is, and whose ticker it is wearing. The verdict is
// kept against the address it describes, so a slow answer to a previous
// address is never shown beside a new one.
export function TokenLookup({ value, onChange }: TokenLookupProps) {
  const [answered, setAnswered] = useState<{ address: string; verdict: Verdict | null } | null>(null);
  const address = value.trim();
  const valid = ADDRESS_PATTERN.test(address);

  useEffect(
    function resolveAddress() {
      if (!valid) {
        return;
      }
      let live = true;
      const timer = setTimeout(async function ask() {
        const response = await fetch(`/api/v1/tokens/${address}`).catch(function ignore() {
          return null;
        });
        const body = response?.ok
          ? await response.json().catch(function ignore() {
              return null;
            })
          : null;
        if (live) {
          setAnswered({ address, verdict: body === null ? null : { trust: body.trust, detail: body.detail, symbol: body.symbol, name: body.name, impersonates: body.impersonates } });
        }
      }, DEBOUNCE_MS);
      return function cancel() {
        live = false;
        clearTimeout(timer);
      };
    },
    [address, valid],
  );

  const current = answered !== null && answered.address === address ? answered : null;

  return (
    <div className="flex flex-col gap-1.5">
      <label className="flex flex-col gap-1.5">
        <span className="text-[13px] font-medium text-ink">Token address</span>
        <input
          type="text"
          value={value}
          onChange={function onInput(event) {
            onChange(event.target.value);
          }}
          placeholder="0x…"
          spellCheck={false}
          className="h-11 rounded-md border border-line bg-raised px-3 font-mono text-[14px] text-ink outline-none focus:border-line-strong"
        />
      </label>
      {valid && current === null ? <span className="text-[12.5px] text-ink-faint">Reading the contract…</span> : null}
      {current?.verdict ? (
        <div className="flex flex-col gap-1.5 rounded-md border border-line bg-panel/50 px-3 py-2.5">
          <span className="flex items-center gap-2">
            <TrustBadge level={current.verdict.trust} />
            <span className="text-[13px] text-ink">
              {current.verdict.symbol ?? "—"}
              {current.verdict.name ? ` · ${current.verdict.name}` : ""}
            </span>
          </span>
          <span className="text-[12.5px] leading-5 text-ink-soft">{current.verdict.detail}</span>
          {current.verdict.impersonates ? (
            <span className="font-mono text-[11.5px] leading-5 text-red-700">
              verified {current.verdict.impersonates.symbol}: {current.verdict.impersonates.address}
            </span>
          ) : null}
        </div>
      ) : null}
      {current !== null && current.verdict === null ? (
        <span className="text-[12.5px] text-ink-faint">Fletch could not read this address just now. You can still create the watcher.</span>
      ) : null}
      {address !== "" && !valid ? <span className="text-[12.5px] text-ink-faint">Paste the 0x address of the token, 40 hex characters.</span> : null}
    </div>
  );
}
