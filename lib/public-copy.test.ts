import assert from "node:assert/strict";
import { test } from "node:test";
import { publicDiagnostic } from "./public-copy";

test("displayed explorer diagnostics retain the failure and suppress the provider brand", function diagnostics() {
  assert.equal(publicDiagnostic("Blockscout denied API access (HTTP 402); previous observations retained"),
    "chain explorer denied API access (HTTP 402); previous observations retained");
  assert.equal(publicDiagnostic("Source https://robinhoodchain.blockscout.com/token/0x123 returned HTTP 500"),
    "Source [explorer endpoint] returned HTTP 500");
  assert.equal(publicDiagnostic("Pinned RPC read at block 123"), "Pinned RPC read at block 123");
});
