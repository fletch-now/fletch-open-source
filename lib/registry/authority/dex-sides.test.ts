import assert from "node:assert/strict";
import { test } from "node:test";
import { sidesOf, type SideAsset } from "./dex-sides";

const USDG: SideAsset = { id: "usdg", address: "0x5fc5360d0400a0fd4f2af552add042d716f1d168", assetType: "stablecoin", decimals: 6 };
const WETH: SideAsset = { id: "weth", address: "0x0000000000000000000000000000000000000001", assetType: "wrapped_native", decimals: 18 };
const TSLA: SideAsset = { id: "tsla", address: "0x0000000000000000000000000000000000000002", assetType: "stock_token", decimals: 18 };
const byAddress = new Map<string, SideAsset>([USDG, WETH, TSLA].map((asset) => [asset.address, asset]));
const MEME = "0x00000000000000000000000000000000000000aa";

test("a listed asset against a quote is the asset side", function () {
  assert.deepEqual(sidesOf(TSLA.address, USDG.address, byAddress), { asset: TSLA, token: null, quote: USDG });
  assert.deepEqual(sidesOf(USDG.address, TSLA.address, byAddress), { asset: TSLA, token: null, quote: USDG });
});

test("an unlisted token against a quote is a community pool with the token's address", function () {
  assert.deepEqual(sidesOf(MEME, WETH.address, byAddress), { asset: null, token: MEME, quote: WETH });
  assert.deepEqual(sidesOf(USDG.address, MEME, byAddress), { asset: null, token: MEME, quote: USDG });
});

test("two quotes or two unlisted tokens are not kept", function () {
  assert.equal(sidesOf(USDG.address, WETH.address, byAddress), null);
  assert.equal(sidesOf(MEME, "0x00000000000000000000000000000000000000bb", byAddress), null);
});

test("a listed asset against an unlisted token keeps the asset with no quote", function () {
  assert.deepEqual(sidesOf(TSLA.address, MEME, byAddress), { asset: TSLA, token: null, quote: null });
});
