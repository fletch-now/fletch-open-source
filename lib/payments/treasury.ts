import "server-only";
import { parseTreasury } from "@/lib/payments/usdg";

// The wallet that receives USDG for credits. Read here and nowhere else, and
// deliberately not in lib/config.ts: that module is imported by client
// components, where a server-only variable is silently an empty string. A typo
// in this address would send real money to nobody, so it is validated and
// checksummed once at boot (instrumentation.ts) and again on every read.

export function treasuryAddress(): string | null {
  return parseTreasury(process.env.FLETCH_TREASURY_ADDRESS);
}

export function purchasesEnabled(): boolean {
  return treasuryAddress() !== null;
}
