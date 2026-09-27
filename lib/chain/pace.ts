// One pace for every request the daemon sends to the public RPC. The quota is
// per address and per minute (a burst of ten, then about one request every
// two seconds, measured from the box on 2026-09-05), and it is shared by all
// 31 jobs. One budget, two lanes: every request keeps the same floor from the
// previous one, whichever lane sent it, so the daemon as a whole stays under
// the quota. Head reads (block numbers, multicalls, storage) have priority: a
// log scan, which reads history and can wait, takes a slot only when no head
// read is waiting. A refusal, seen here as HTTP 429 or reported by a caller,
// pauses both lanes, since they draw on the same counter.

const GAP_MS = 2_000;
const PAUSE_MS = 20_000;

interface Lane {
  gate: Promise<void>;
  // Scans yield to head reads; head reads yield to nothing.
  yields: boolean;
}

const scanLane: Lane = { gate: Promise.resolve(), yields: true };
const lightLane: Lane = { gate: Promise.resolve(), yields: false };
let lastRequestAt = 0;
let pausedUntil = 0;
let lightWaiting = 0;
// A scan yields to waiting head reads, but only this many times in a row:
// with head reads arriving every couple of seconds, unbounded yielding left
// the scanners without a single request for hours. One, not three: at three
// the swap scan was getting one to four log requests a minute against
// twenty-five contract reads, which is why the chain's 24h volume has no
// figures. Head reads still go first; they no longer go first six times over.
const MAX_SCAN_YIELDS = 1;
let scanYields = 0;
function sleep(ms: number): Promise<void> {
  return new Promise(function later(resolve) {
    setTimeout(resolve, ms);
  });
}

export function pauseRequests(ms = PAUSE_MS): void {
  pausedUntil = Math.max(pausedUntil, Date.now() + ms);
}

function takeTurnIn<T>(lane: Lane, work: () => Promise<T>): Promise<T> {
  if (!lane.yields) {
    lightWaiting += 1;
  }
  const turn = lane.gate.then(paced, paced);
  lane.gate = turn.then(
    function release() {},
    function releaseAfterFailure() {},
  );
  return turn;

  async function paced(): Promise<T> {
    while (true) {
      const wait = Math.max(pausedUntil, lastRequestAt + GAP_MS) - Date.now();
      if (wait > 0) {
        await sleep(wait);
        continue;
      }
      if (lane.yields && lightWaiting > 0 && scanYields < MAX_SCAN_YIELDS) {
        scanYields += 1;
        await sleep(GAP_MS);
        continue;
      }
      break;
    }
    if (lane.yields) {
      scanYields = 0;
    } else {
      lightWaiting -= 1;
    }
    lastRequestAt = Date.now();
    return work();
  }
}

export function takeTurn<T>(work: () => Promise<T>): Promise<T> {
  return takeTurnIn(scanLane, work);
}

function isLogScan(init?: RequestInit): boolean {
  return typeof init?.body === "string" && init.body.includes("eth_getLogs");
}

// The quota counts JSON-RPC calls, not HTTP requests: a batch of a hundred
// is refused outright (measured 2026-09-05). A batch therefore reserves one
// slot per call it carries.
function callsIn(init?: RequestInit): number {
  if (typeof init?.body !== "string" || !init.body.startsWith("[")) {
    return 1;
  }
  const matches = init.body.match(/"jsonrpc"/g);
  return matches ? Math.max(1, matches.length) : 1;
}

// What the daemon asked for, per minute and per method, written to the log so
// the budget can be balanced on measured demand rather than guesses.
const minuteCounts = new Map<string, number>();
let minuteStartedAt = 0;

function account(init: RequestInit | undefined, calls: number): void {
  const now = Date.now();
  if (now - minuteStartedAt >= 60_000) {
    if (minuteCounts.size > 0) {
      console.log(JSON.stringify({ ts: new Date().toISOString(), scope: "rpc", event: "rpc-calls", minute: new Date(minuteStartedAt).toISOString().slice(11, 16), calls: Object.fromEntries(minuteCounts) }));
    }
    minuteCounts.clear();
    minuteStartedAt = now;
  }
  minuteCounts.set("http_requests", (minuteCounts.get("http_requests") ?? 0) + 1);
  const body = typeof init?.body === "string" ? init.body : "";
  const methods = body.match(/"method":"([a-zA-Z_]+)"/g) ?? [];
  if (methods.length === 0) {
    minuteCounts.set("unknown", (minuteCounts.get("unknown") ?? 0) + calls);
    return;
  }
  for (const entry of methods) {
    const method = entry.slice(10, -1);
    minuteCounts.set(method, (minuteCounts.get(method) ?? 0) + 1);
  }
}

// The fetch the daemon's transport uses: every HTTP request to the RPC takes a
// turn in its lane, and a 429 pauses both lanes before the caller sees it.
// An unnamed client asking a public endpoint thousands of questions an hour is
// exactly what a bot filter is for, and the RPC in front of chain 4663 began
// answering the daemon with Cloudflare's interstitial while the same call from
// curl succeeded. Saying who we are and where to complain is the honest way to
// ask for the traffic to be allowed.
const USER_AGENT = "fletch-registry/1.0 (+https://fletch.now; registry daemon for Robinhood Chain)";

function identified(init?: RequestInit): RequestInit | undefined {
  if (!init) {
    return init;
  }
  const headers = new Headers(init.headers);
  headers.set("user-agent", USER_AGENT);
  headers.set("accept", "application/json");
  return { ...init, headers };
}

export function pacedFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const lane = isLogScan(init) ? scanLane : lightLane;
  const calls = callsIn(init);
  account(init, calls);
  const identifiedInit = identified(init);
  return takeTurnIn(lane, async function request() {
    const response = await fetch(input, identifiedInit);
    // The slots this batch used are charged forward, so the next request
    // waits as if each call had gone out on its own.
    lastRequestAt = Date.now() + GAP_MS * (calls - 1);
    // 403 here is the bot filter's interstitial, not a permission problem, and
    // it clears the same way a rate limit does: by asking less often.
    if (response.status === 429 || response.status === 403) {
      pauseRequests();
    }
    return response;
  });
}

// A dedicated endpoint has a separate quota. Serialize its requests with a
// conservative one-second gap; public history scans cannot hold up its reads.
export function createDedicatedFetch(gapMs = 1_000): typeof fetch {
  let gate = Promise.resolve();
  let nextAt = 0;
  return function fetchInTurn(input, init): Promise<Response> {
    const turn = gate.then(async function request() {
      init?.signal?.throwIfAborted();
      const wait = nextAt - Date.now();
      if (wait > 0) {
        await sleep(wait);
      }
      init?.signal?.throwIfAborted();
      const calls = callsIn(init);
      nextAt = Date.now() + gapMs * calls;
      account(init, calls);
      const response = await fetch(input, identified(init));
      if (response.status === 429) {
        nextAt = Math.max(nextAt, Date.now() + PAUSE_MS);
      }
      return response;
    });
    gate = turn.then(function released() {}, function failed() {});
    return turn;
  };
}
