import assert from "node:assert/strict";
import { test } from "node:test";

// The two rules that keep a pasted file from reaching anywhere it should not:
// the name is one ordinary path segment, and the content is text.
const NAME = /^[\w][\w.\- ]{0,63}$/;
const EXTENSION = /\.(md|markdown|txt|csv|json|yml|yaml)$/i;
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

function nameAllowed(name: string): boolean {
  return NAME.test(name) && EXTENSION.test(name);
}

test("a name cannot climb out of the workspace", function () {
  assert.equal(nameAllowed("../../etc/passwd"), false);
  assert.equal(nameAllowed("../spec.md"), false);
  assert.equal(nameAllowed("brief/../../spec.md"), false);
  assert.equal(nameAllowed("/etc/passwd"), false);
  assert.equal(nameAllowed("..\\windows\\system32"), false);
  assert.equal(nameAllowed(".env"), false);
});

test("a name cannot be an executable", function () {
  assert.equal(nameAllowed("payload.sh"), false);
  assert.equal(nameAllowed("payload.exe"), false);
  assert.equal(nameAllowed("foundry.toml"), false);
});

test("ordinary text file names pass", function () {
  assert.equal(nameAllowed("spec.md"), true);
  assert.equal(nameAllowed("Copy deck v2.txt"), true);
  assert.equal(nameAllowed("holders.csv"), true);
});

test("a binary renamed to .txt is refused by its own bytes", function () {
  assert.equal(CONTROL_CHARACTERS.test("\u007fELF"), true);
  assert.equal(CONTROL_CHARACTERS.test("\u0089PNG\r\n\u001a\n"), true);
  // A null byte matters twice over: Postgres refuses it inside jsonb.
  assert.equal(CONTROL_CHARACTERS.test("harmless\u0000text"), true);
});

test("real prose, tabs and newlines are text", function () {
  assert.equal(CONTROL_CHARACTERS.test("# Spec\n\n- one\ttwo\r\n"), false);
  assert.equal(CONTROL_CHARACTERS.test("emoji and accents are fine"), false);
});
