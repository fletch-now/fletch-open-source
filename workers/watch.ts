// Fletch Watch daemon (docs/MVP.md, ticket 6). A second, long-lived Node process
// on the same VPS, independent of the Next.js web process — a web deploy never
// stops it. Three loops, each self-rescheduling with setTimeout so a slow run
// never overlaps the next: poll (scan for large transfers), deliver (send
// queued Telegram alerts), and sweep (credit USDG payments to the treasury).
//
// Run in production under systemd (fletch-watch.service) with
// EnvironmentFile=/etc/fletch/fletch.env — that populates process.env before
// this process even starts, the same way the Next.js unit does. The dotenv load
// below exists only for running this file directly (`npx tsx workers/watch.ts`)
// outside systemd, where nothing else would load .env.local first.

import { existsSync } from "node:fs";
import { config as loadEnvFile } from "dotenv";

// This MUST happen before any of this project's own modules are imported —
// lib/db reads DATABASE_URL, lib/chain/rpc reads RPC_URL_*, at module-evaluation
// time. A static `import` at the top of this file would be hoisted and
// evaluated (pulling in lib/db and opening a pool with an empty connection
// string) before a call sitting between two imports ever ran, so everything
// that depends on env is loaded with `await import(...)` inside main() instead,
// after this loop has run.
for (const file of ["/etc/fletch/fletch.env", ".env.local"]) {
  if (existsSync(file)) {
    loadEnvFile({ path: file });
  }
}

const SWEEP_INTERVAL_MS = 60_000;

function sleep(ms: number): Promise<void> {
  return new Promise(function schedule(resolve) {
    setTimeout(resolve, ms);
  });
}

// Both loop catches and the heartbeat catch need this same fallback — Error
// objects carry a message, anything else thrown (a string, a plain object) does
// not, so String() is the only thing guaranteed not to throw itself.
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function main(): Promise<void> {
  const { RH_MAINNET_ID, RH_TESTNET_ID } = await import("@/lib/config");
  const { pollOnce } = await import("@/lib/watch/poll");
  const { deliverOnce } = await import("@/lib/watch/deliver");
  const { sweepTreasuryPayments } = await import("@/lib/payments/sweep");
  const { parseTreasury } = await import("@/lib/payments/usdg");
  const { beat } = await import("@/lib/watch/heartbeat");
  const { getHead, usingPublicRpc } = await import("@/lib/chain/rpc");
  const { telegramConfigured } = await import("@/lib/telegram/client");
  const { logEvent } = await import("@/lib/log");
  const { WATCH_LIMITS } = await import("@/lib/watch/types");
  const { close } = await import("@/lib/db");

  const chainIds = [RH_MAINNET_ID];
  if (process.env.RPC_URL_46630) {
    chainIds.push(RH_TESTNET_ID);
  }

  logEvent("watch", {
    event: "start",
    chains: chainIds.map(function describe(chainId) {
      return { chainId, publicRpc: usingPublicRpc(chainId) };
    }),
    telegramConfigured: telegramConfigured(),
    treasury: parseTreasury(process.env.FLETCH_TREASURY_ADDRESS),
    pollIntervalMs: WATCH_LIMITS.pollIntervalMs,
    deliverIntervalMs: WATCH_LIMITS.deliverIntervalMs,
    sweepIntervalMs: SWEEP_INTERVAL_MS,
  });

  let stopping = false;
  let pollRunning = false;
  let deliverRunning = false;
  let sweepRunning = false;
  let pollTimer: ReturnType<typeof setTimeout> | null = null;
  let deliverTimer: ReturnType<typeof setTimeout> | null = null;
  let sweepTimer: ReturnType<typeof setTimeout> | null = null;

  async function runPollIteration(): Promise<void> {
    const detail: Record<string, unknown> = {};
    let heartbeatHead: bigint | null = null;

    for (const chainId of chainIds) {
      try {
        await pollOnce(chainId);
        const head = await getHead(chainId);
        detail[String(chainId)] = { ok: true, headBlock: head.number.toString() };
        if (chainId === RH_MAINNET_ID) {
          heartbeatHead = head.number;
        }
      } catch (error) {
        const message = errorMessage(error);
        detail[String(chainId)] = { ok: false, error: message };
        logEvent("watch", { event: "poll-chain-failed", chainId, error: message });
      }
    }

    try {
      await beat(heartbeatHead, detail);
    } catch (error) {
      // A heartbeat write is not itself the poll — losing one beat (e.g. the
      // database blipped) must not be what takes the daemon down.
      logEvent("watch", { event: "heartbeat-failed", error: errorMessage(error) });
    }
  }

  async function pollLoop(): Promise<void> {
    if (stopping) {
      return;
    }
    pollRunning = true;
    try {
      await runPollIteration();
    } catch (error) {
      // pollOnce catches per-watcher and per-address-group errors itself; this
      // is the backstop for anything that still escapes (e.g. the initial
      // watchers query, or getHead, failing outright) — the loop logs and
      // reschedules rather than the whole process dying on one bad iteration.
      logEvent("watch", { event: "poll-loop-failed", error: errorMessage(error) });
    } finally {
      pollRunning = false;
    }
    if (!stopping) {
      pollTimer = setTimeout(function reschedule() {
        void pollLoop();
      }, WATCH_LIMITS.pollIntervalMs);
    }
  }

  async function deliverLoop(): Promise<void> {
    if (stopping) {
      return;
    }
    deliverRunning = true;
    try {
      await deliverOnce();
    } catch (error) {
      logEvent("watch", { event: "deliver-loop-failed", error: errorMessage(error) });
    } finally {
      deliverRunning = false;
    }
    if (!stopping) {
      deliverTimer = setTimeout(function reschedule() {
        void deliverLoop();
      }, WATCH_LIMITS.deliverIntervalMs);
    }
  }

  // Payments are money, so a failed sweep is logged loudly and retried on the
  // next tick; a sweep can never be skipped silently because of one bad RPC read.
  async function sweepLoop(): Promise<void> {
    if (stopping) {
      return;
    }
    sweepRunning = true;
    try {
      const result = await sweepTreasuryPayments();
      if (result.scanned) {
        logEvent("payments", { event: "sweep", ...result });
      }
    } catch (error) {
      logEvent("payments", { event: "sweep-failed", error: errorMessage(error) });
    } finally {
      sweepRunning = false;
    }
    if (!stopping) {
      sweepTimer = setTimeout(function reschedule() {
        void sweepLoop();
      }, SWEEP_INTERVAL_MS);
    }
  }

  async function shutdown(signal: string): Promise<void> {
    if (stopping) {
      return;
    }
    stopping = true;
    logEvent("watch", { event: "shutdown", signal });
    if (pollTimer) {
      clearTimeout(pollTimer);
    }
    if (deliverTimer) {
      clearTimeout(deliverTimer);
    }
    if (sweepTimer) {
      clearTimeout(sweepTimer);
    }
    // Let whichever iteration is mid-flight finish on its own rather than
    // cutting it off — a killed poll can leave a checkpoint update half-applied
    // outside its transaction's scope, and a killed deliver can leave a message
    // sent with the outbox row never marked.
    while (pollRunning || deliverRunning || sweepRunning) {
      await sleep(50);
    }
    await close();
    logEvent("watch", { event: "shutdown-complete" });
    process.exit(0);
  }

  process.on("SIGTERM", function onSigterm() {
    void shutdown("SIGTERM");
  });
  process.on("SIGINT", function onSigint() {
    void shutdown("SIGINT");
  });

  void pollLoop();
  void deliverLoop();
  void sweepLoop();
}

main().catch(function onFatal(error) {
  console.error(JSON.stringify({ ts: new Date().toISOString(), scope: "watch", event: "fatal", error: String(error) }));
  process.exit(1);
});
