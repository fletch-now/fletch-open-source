"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { formatEther, parseEther, parseEventLogs, type Abi, type AbiEvent, type AbiFunction } from "viem";
import { useAccount, useConfig, useSwitchChain, useWriteContract } from "wagmi";
import { getBalance, getBlockNumber, getPublicClient, readContract, waitForTransactionReceipt } from "wagmi/actions";
import { toast } from "sonner";
import { friendlyError } from "@/lib/errors";

// The deployed contract, callable from the page: every view function is read
// live and can be re-read with arguments, every write goes through the
// connected wallet on the contract's chain, and the latest events are decoded
// with the stored ABI. Results are what the chain returned, formatted, never
// cached beyond the page. Reads use the public RPC and need no wallet.

interface ContractConsoleIslandProps {
  address: `0x${string}`;
  chainId: number;
  abi: Abi;
  explorerUrl: string;
}

interface ReadState {
  value?: string;
  error?: string;
  pending: boolean;
}

interface WriteState {
  hash?: `0x${string}`;
  error?: string;
  step: "idle" | "switching" | "signing" | "mining" | "done";
}

interface DecodedEvent {
  name: string;
  args: string;
  blockNumber: string;
  txHash: string;
}

// How far back the events list looks. Robinhood Chain lands a block every
// 100 ms, so this is a little under an hour and and a range the public RPC
// answers in one call.
const EVENT_LOOKBACK_BLOCKS = BigInt(30_000);
const EVENT_LIMIT = 25;

function isView(fn: AbiFunction): boolean {
  return fn.stateMutability === "view" || fn.stateMutability === "pure";
}

function functionKey(fn: AbiFunction): string {
  return `${fn.name}(${fn.inputs.map((input) => input.type).join(",")})`;
}

function formatValue(value: unknown): string {
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value, function replacer(_key, inner: unknown) {
    return typeof inner === "bigint" ? inner.toString() : inner;
  });
}

// Solidity types to call arguments. Numbers become bigint, booleans parse the
// word, and arrays or tuples are written as JSON.
function parseArgument(type: string, raw: string): unknown {
  const text = raw.trim();
  if (type.endsWith("]") || type.startsWith("tuple")) {
    return JSON.parse(text, function reviver(_key, value: unknown) {
      return typeof value === "number" ? BigInt(value) : value;
    });
  }
  if (type.startsWith("uint") || type.startsWith("int")) {
    if (!/^-?\d+$/.test(text)) {
      throw new Error(`${type} expects a whole number`);
    }
    return BigInt(text);
  }
  if (type === "bool") {
    return text === "true" || text === "1";
  }
  return text;
}

function parseArguments(fn: AbiFunction, values: Record<string, string>): unknown[] {
  return fn.inputs.map(function parse(input, index) {
    const raw = values[`${index}`] ?? "";
    if (raw.trim() === "") {
      throw new Error(`${input.name || input.type} is required`);
    }
    return parseArgument(input.type, raw);
  });
}

export function ContractConsoleIsland({ address, chainId, abi, explorerUrl }: ContractConsoleIslandProps) {
  const config = useConfig();
  const { address: account, chainId: walletChain, isConnected } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();

  // Derived once per ABI: these arrays feed the effects below, and a fresh
  // array every render would re-run them without end.
  const { views, writes, events } = useMemo(
    function splitAbi() {
      const functions = abi.filter(function onlyFunctions(entry): entry is AbiFunction {
        return entry.type === "function";
      });
      return {
        views: functions.filter(isView),
        writes: functions.filter(function notView(fn) {
          return !isView(fn);
        }),
        events: abi.filter(function onlyEvents(entry): entry is AbiEvent {
          return entry.type === "event";
        }),
      };
    },
    [abi],
  );

  const [args, setArgs] = useState<Record<string, Record<string, string>>>({});
  const [values, setValues] = useState<Record<string, string>>({});
  const [reads, setReads] = useState<Record<string, ReadState>>({});
  const [writesState, setWritesState] = useState<Record<string, WriteState>>({});
  const [balance, setBalance] = useState<string | null>(null);
  const [logs, setLogs] = useState<DecodedEvent[] | null>(null);
  const [logsError, setLogsError] = useState<string | null>(null);

  function setArg(key: string, index: number, value: string): void {
    setArgs(function update(current) {
      return { ...current, [key]: { ...(current[key] ?? {}), [`${index}`]: value } };
    });
  }

  const readOne = useCallback(
    async function readOne(fn: AbiFunction, fnArgs: unknown[]): Promise<void> {
      const key = functionKey(fn);
      setReads(function start(current) {
        return { ...current, [key]: { ...current[key], pending: true, error: undefined } };
      });
      try {
        const result = await readContract(config, { abi, address, chainId, functionName: fn.name, args: fnArgs });
        setReads(function done(current) {
          return { ...current, [key]: { pending: false, value: formatValue(result) } };
        });
      } catch (cause) {
        // The raw error stays in the console: the friendly line hides which
        // RPC or ABI detail failed, and that is what a builder needs to fix it.
        console.error(`read ${key} failed`, cause);
        setReads(function failed(current) {
          return { ...current, [key]: { pending: false, error: friendlyError(cause, "The call reverted.") } };
        });
      }
    },
    [abi, address, chainId, config],
  );

  const refreshChain = useCallback(
    async function refreshChain(): Promise<void> {
      try {
        const wei = await getBalance(config, { address, chainId });
        setBalance(formatEther(wei.value));
      } catch {
        setBalance(null);
      }
      if (events.length === 0) {
        setLogs([]);
        return;
      }
      try {
        const head = await getBlockNumber(config, { chainId });
        const fromBlock = head > EVENT_LOOKBACK_BLOCKS ? head - EVENT_LOOKBACK_BLOCKS : BigInt(0);
        const client = getPublicClient(config, { chainId });
        if (!client) {
          throw new Error("No RPC client for this chain.");
        }
        const raw = await client.getLogs({ address, fromBlock, toBlock: head });
        const decoded = parseEventLogs({ abi, logs: raw });
        setLogs(
          decoded
            .slice(-EVENT_LIMIT)
            .reverse()
            .map(function shape(log) {
              return {
                name: log.eventName,
                args: formatValue(log.args),
                blockNumber: log.blockNumber.toString(),
                txHash: log.transactionHash,
              };
            }),
        );
        setLogsError(null);
      } catch (cause) {
        setLogs([]);
        setLogsError(friendlyError(cause, "Could not read events from the RPC."));
      }
    },
    [abi, address, chainId, config, events.length],
  );

  // Views without arguments are the contract's state; read them as the page
  // opens, then again after every write lands.
  const refreshViews = useCallback(
    async function refreshViews(): Promise<void> {
      await Promise.all(
        views
          .filter(function noArgs(fn) {
            return fn.inputs.length === 0;
          })
          .map(function read(fn) {
            return readOne(fn, []);
          }),
      );
    },
    [readOne, views],
  );

  useEffect(
    function loadOnOpen() {
      void refreshViews();
      void refreshChain();
    },
    [refreshViews, refreshChain],
  );

  async function submitRead(fn: AbiFunction): Promise<void> {
    const key = functionKey(fn);
    try {
      await readOne(fn, parseArguments(fn, args[key] ?? {}));
    } catch (cause) {
      setReads(function failed(current) {
        return { ...current, [key]: { pending: false, error: friendlyError(cause, "Check the arguments.") } };
      });
    }
  }

  async function submitWrite(fn: AbiFunction): Promise<void> {
    const key = functionKey(fn);
    function step(next: WriteState): void {
      setWritesState(function update(current) {
        return { ...current, [key]: next };
      });
    }
    if (!isConnected || !account) {
      toast.error("Connect your wallet first, from the button in the header.");
      return;
    }
    try {
      const fnArgs = parseArguments(fn, args[key] ?? {});
      const value = fn.stateMutability === "payable" && values[key] ? parseEther(values[key]) : undefined;
      if (walletChain !== chainId) {
        step({ step: "switching" });
        await switchChainAsync({ chainId });
      }
      step({ step: "signing" });
      const hash = await writeContractAsync({ abi, address, chainId, functionName: fn.name, args: fnArgs, value });
      step({ step: "mining", hash });
      const receipt = await waitForTransactionReceipt(config, { hash, chainId });
      if (receipt.status !== "success") {
        throw new Error("The transaction reverted on chain.");
      }
      step({ step: "done", hash });
      toast.success(`${fn.name} confirmed`);
      void refreshViews();
      void refreshChain();
    } catch (cause) {
      step({ step: "idle", error: friendlyError(cause, "The transaction did not go through.") });
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 font-mono text-[12px] text-ink-faint">
        <span>
          balance <span className="text-ink">{balance === null ? "…" : `${balance} ETH`}</span>
        </span>
        <span>
          wallet{" "}
          <span className="text-ink">
            {isConnected && account ? `${account.slice(0, 6)}…${account.slice(-4)}` : "not connected"}
          </span>
        </span>
        <button
          type="button"
          onClick={function refresh() {
            void refreshViews();
            void refreshChain();
          }}
          className="ml-auto rounded-full border border-line px-3 py-1 text-[11.5px] text-ink-soft transition-colors hover:border-line-strong hover:text-ink"
        >
          Refresh
        </button>
      </div>

      <section>
        <p className="mono-label mb-2">read · {views.length}</p>
        {views.length === 0 ? <p className="text-[13px] text-ink-soft">This contract exposes no view functions.</p> : null}
        <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line">
          {views.map(function renderView(fn) {
            const key = functionKey(fn);
            const state = reads[key];
            return (
              <li key={key} className="bg-raised px-3.5 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-[12.5px] text-ink">{fn.name}</span>
                  <span className="font-mono text-[10.5px] text-ink-faint">
                    → {fn.outputs.map((output) => output.type).join(", ") || "void"}
                  </span>
                  <button
                    type="button"
                    disabled={state?.pending}
                    onClick={function read() {
                      void submitRead(fn);
                    }}
                    className="ml-auto rounded-full border border-line px-2.5 py-0.5 font-mono text-[11px] text-ink-soft transition-colors hover:border-line-strong hover:text-ink disabled:opacity-50"
                  >
                    {state?.pending ? "reading…" : "read"}
                  </button>
                </div>
                <ArgumentInputs fn={fn} values={args[key] ?? {}} onChange={setArg} />
                {state?.value !== undefined ? (
                  <p className="mt-1.5 break-all font-mono text-[12.5px] text-hood-deep">{state.value}</p>
                ) : null}
                {state?.error ? <p className="mt-1.5 font-mono text-[11.5px] text-red-700">{state.error}</p> : null}
              </li>
            );
          })}
        </ul>
      </section>

      <section>
        <p className="mono-label mb-2">write · {writes.length}</p>
        {writes.length === 0 ? <p className="text-[13px] text-ink-soft">This contract exposes no state-changing functions.</p> : null}
        <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line">
          {writes.map(function renderWrite(fn) {
            const key = functionKey(fn);
            const state = writesState[key] ?? { step: "idle" };
            const busy = state.step !== "idle" && state.step !== "done";
            return (
              <li key={key} className="bg-raised px-3.5 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-[12.5px] text-ink">{fn.name}</span>
                  {fn.stateMutability === "payable" ? (
                    <span className="rounded-full bg-hood-wash px-1.5 py-0.5 font-mono text-[10px] text-hood-deep ring-1 ring-inset ring-hood/30">payable</span>
                  ) : null}
                  <button
                    type="button"
                    disabled={busy}
                    onClick={function write() {
                      void submitWrite(fn);
                    }}
                    className="ml-auto rounded-full bg-ink px-3 py-0.5 font-mono text-[11px] text-paper transition-opacity hover:opacity-90 disabled:opacity-50"
                  >
                    {writeLabel(state.step)}
                  </button>
                </div>
                <ArgumentInputs fn={fn} values={args[key] ?? {}} onChange={setArg} />
                {fn.stateMutability === "payable" ? (
                  <label className="mt-2 flex items-center gap-2 font-mono text-[11.5px] text-ink-faint">
                    value (ETH)
                    <input
                      value={values[key] ?? ""}
                      onChange={function change(event) {
                        const next = event.target.value;
                        setValues(function update(current) {
                          return { ...current, [key]: next };
                        });
                      }}
                      placeholder="0"
                      className="h-8 w-32 rounded-md border border-line bg-paper px-2 text-[12px] text-ink focus:border-hood/60 focus:outline-none"
                    />
                  </label>
                ) : null}
                {state.hash ? (
                  <a
                    href={`${explorerUrl.replace(/\/address\/.*$/, "")}/tx/${state.hash}`}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-1.5 inline-block font-mono text-[11.5px] text-hood-deep underline underline-offset-4"
                  >
                    {state.step === "done" ? "confirmed" : "pending"} · {state.hash.slice(0, 10)}…
                  </a>
                ) : null}
                {state.error ? <p className="mt-1.5 font-mono text-[11.5px] text-red-700">{state.error}</p> : null}
              </li>
            );
          })}
        </ul>
      </section>

      <section>
        <p className="mono-label mb-2">events · last hour</p>
        {logs === null ? <p className="font-mono text-[12px] text-ink-faint">reading…</p> : null}
        {logs !== null && logs.length === 0 && !logsError ? (
          <p className="text-[13px] text-ink-soft">No events in the last {EVENT_LOOKBACK_BLOCKS.toLocaleString()} blocks.</p>
        ) : null}
        {logsError ? <p className="font-mono text-[11.5px] text-red-700">{logsError}</p> : null}
        {logs && logs.length > 0 ? (
          <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line">
            {logs.map(function renderLog(log) {
              return (
                <li key={`${log.txHash}-${log.blockNumber}-${log.args}`} className="bg-raised px-3.5 py-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-[12.5px] text-ink">{log.name}</span>
                    <a
                      href={`${explorerUrl.replace(/\/address\/.*$/, "")}/tx/${log.txHash}`}
                      target="_blank"
                      rel="noreferrer"
                      className="ml-auto font-mono text-[10.5px] text-ink-faint underline underline-offset-4"
                    >
                      block {log.blockNumber}
                    </a>
                  </div>
                  <p className="mt-1 break-all font-mono text-[11.5px] text-ink-soft">{log.args}</p>
                </li>
              );
            })}
          </ul>
        ) : null}
      </section>
    </div>
  );
}

function writeLabel(step: WriteState["step"]): string {
  switch (step) {
    case "switching":
      return "switching chain…";
    case "signing":
      return "confirm in wallet…";
    case "mining":
      return "mining…";
    case "done":
      return "send again";
    default:
      return "send";
  }
}

interface ArgumentInputsProps {
  fn: AbiFunction;
  values: Record<string, string>;
  onChange: (key: string, index: number, value: string) => void;
}

function ArgumentInputs({ fn, values, onChange }: ArgumentInputsProps) {
  if (fn.inputs.length === 0) {
    return null;
  }
  const key = functionKey(fn);
  return (
    <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
      {fn.inputs.map(function renderInput(input, index) {
        return (
          <label key={`${key}-${index}`} className="flex flex-col gap-1 font-mono text-[11px] text-ink-faint">
            {input.name || `arg${index}`} · {input.type}
            <input
              value={values[`${index}`] ?? ""}
              onChange={function change(event) {
                onChange(key, index, event.target.value);
              }}
              placeholder={input.type}
              className="h-8 rounded-md border border-line bg-paper px-2 text-[12px] text-ink focus:border-hood/60 focus:outline-none"
            />
          </label>
        );
      })}
    </div>
  );
}
