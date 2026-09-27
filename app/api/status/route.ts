import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { getSession } from "@/lib/dal";
import { db } from "@/lib/db";
import { getBalance } from "@/lib/credits";
import { platformProvider } from "@/lib/agent/provider";
import { readHeartbeat } from "@/lib/watch/heartbeat";
import { usingPublicLogRpc } from "@/lib/chain/rpc";
import { telegramConfigured } from "@/lib/telegram/client";
import { RH_MAINNET_ID } from "@/lib/config";

// Answers the question the sidebar asks: can I prompt right now? Three things must
// be true — the database is reachable, a model runtime is configured, and the
// account has a credit to spend. Anything else and the build button is a trap.
export async function GET(): Promise<Response> {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Sign in" }, { status: 401 });
  }

  // Three reads, together: the sidebar polls this, so its cost is paid by every
  // open tab, and sequential awaits tripled the latency for nothing.
  const [dbUp, credits, heartbeat] = await Promise.all([
    db
      .execute(sql`select 1`)
      .then(function ok() {
        return true;
      })
      .catch(function down() {
        return false;
      }),
    getBalance(session.user.id).catch(function unavailable() {
      return 0;
    }),
    readHeartbeat().catch(function noRow() {
      return null;
    }),
  ]);
  const provider = platformProvider();

  return NextResponse.json({
    db: dbUp,
    runtime: {
      ready: Boolean(provider),
      // Which vendor and model run builds is not part of the product; the
      // dashboard only needs to know an agent is configured.
      model: provider ? "agent" : null,
      // The CLI is the real runtime; a single model call is the fallback.
      mode: process.env.FORGE_AGENT === "cli" ? "agent" : "single-call",
      sandboxed: process.env.FORGE_AGENT_SANDBOX === "docker",
    },
    credits,
    canBuild: dbUp && Boolean(provider) && credits > 0,
    watch: {
      // null until the daemon has ever beaten once — distinct from "beat a long
      // time ago", which is a positive number the dashboard can flag as stale.
      heartbeatAgeSeconds: heartbeat ? (Date.now() - heartbeat.lastBeatAt.getTime()) / 1000 : null,
      headBlock: heartbeat?.headBlock != null ? heartbeat.headBlock.toString() : null,
      rpcConfigured: !usingPublicLogRpc(RH_MAINNET_ID),
      telegramConfigured: telegramConfigured(),
    },
  });
}
