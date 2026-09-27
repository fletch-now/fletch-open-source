// Swap timestamps are classified by their actual block boundary. Arbitrum block
// timestamps are nondecreasing; no interpolated event timestamp is stored.
export interface TimedBlock { number: bigint; timestamp: bigint; hash: string }
export interface BlockInterval { from: bigint; through: bigint }

export async function firstBlockAfter(
  read: (number: bigint) => Promise<TimedBlock>,
  through: TimedBlock,
  timestamp: bigint,
  lower = BigInt(0),
  upperHint?: bigint,
): Promise<TimedBlock> {
  let left = await read(lower);
  let right = through;
  if (left.number > right.number || left.timestamp > right.timestamp || right.timestamp <= timestamp) {
    throw new Error("Invalid timestamp search bounds");
  }
  if (left.timestamp > timestamp) return left;
  // A rolling window usually moves by only the blocks added since its last
  // read. Check that hint against actual headers, expanding when it falls
  // short; irregular block production cannot turn it into a timestamp guess.
  if (upperHint !== undefined && upperHint > left.number && upperHint < right.number) {
    let step = upperHint - left.number;
    while (left.number + step < right.number) {
      const probe = await read(left.number + step);
      if (probe.timestamp < left.timestamp || probe.timestamp > right.timestamp) {
        throw new Error("Nonmonotonic block timestamps");
      }
      if (probe.timestamp > timestamp) {
        right = probe;
        break;
      }
      left = probe;
      step *= BigInt(2);
    }
  }
  while (right.number - left.number > BigInt(1)) {
    const middle = await read((left.number + right.number) / BigInt(2));
    if (middle.timestamp < left.timestamp || middle.timestamp > right.timestamp) {
      throw new Error("Nonmonotonic block timestamps");
    }
    if (middle.timestamp <= timestamp) left = middle;
    else right = middle;
  }
  return right;
}

export function intervalsCover(intervals: readonly BlockInterval[], from: bigint, through: bigint): boolean {
  if (from > through) return true;
  let next = from;
  const sorted = [...intervals].sort(function byStart(a, b) {
    if (a.from === b.from) return 0;
    return a.from < b.from ? -1 : 1;
  });
  for (const interval of sorted) {
    if (interval.from > next) return false;
    if (interval.through >= next) next = interval.through + BigInt(1);
    if (next > through) return true;
  }
  return false;
}

export function assertWindowHeaders(start: TimedBlock, end: TimedBlock, now = Date.now()): void {
  if (start.number > end.number || start.timestamp > end.timestamp || Number(end.timestamp) * 1000 > now) {
    throw new Error("Invalid or future swap window");
  }
}
