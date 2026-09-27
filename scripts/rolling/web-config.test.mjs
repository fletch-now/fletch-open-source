import assert from "node:assert/strict";
import { test } from "node:test";
import {
  validateRelease,
  releaseUnit,
  upstreamConfig,
  switchProxyConfig,
  isRegistryChangesPage,
} from "./web-config.mjs";

test("candidate check requires the Registry page structure without depending on activity-board copy", () => {
  assert.equal(isRegistryChangesPage('<main><h1>Registry changelog</h1><section aria-label="Filter registry changes">No events</section></main>'), true);
  assert.equal(isRegistryChangesPage('<main><h1>Something went wrong</h1></main>'), false);
  assert.equal(isRegistryChangesPage('<html>Activity board</html>'), false);
  assert.equal(isRegistryChangesPage('<main><p>aria-label="Filter registry changes"</p></main>'), false);
});
const release = {
  id: "registry-live-20260913",
  root: "/opt/fletch/web-releases/registry-live-20260913",
  port: 3001,
};
test("rolling configuration preserves prior version routing and never owns build workers", () => {
  const old = { ...release, id: "previous-release", port: 3002 };
  const map = upstreamConfig(release, [old]);
  assert.match(map, /default 127.0.0.1:3001/);
  assert.ok(map.includes("~\\|previous-release$ 127.0.0.1:3002"));
  assert.ok(map.includes("~^/api/ 127.0.0.1:3001"));
  assert.ok(map.indexOf("~^/api/") < map.indexOf("~\\|previous-release$"), "API requests must use the current security rules even with an old deployment header");
  const adminRule = "~^/(trafalgar|admin)(/|\\|) 127.0.0.1:3001";
  assert.ok(map.includes(adminRule));
  assert.ok(map.indexOf(adminRule) < map.indexOf("~\\|previous-release$"), "Operator passwords and gates must use the current release after rotation");
  const unit = releaseUnit(release);
  assert.match(unit, /FORGE_BUILD_EXECUTION=worker/);
  assert.match(unit, /PORT=3001/);
  assert.doesNotMatch(unit, /workers\/build|ExecStop|systemctl/);
});
test("all web locations switch together while static assets use retained immutable files", () => {
  const source =
    "server {\n  location = /api/builds {\nproxy_pass http://127.0.0.1:3000;\n}\nlocation / { proxy_pass http://127.0.0.1:3000; }\n}";
  const next = switchProxyConfig(source, true);
  assert.equal(
    (next.match(/proxy_pass http:\/\/\$fletch_web_backend;/g) ?? []).length,
    2,
  );
  assert.ok(next.includes("alias $fletch_web_static/;"));
  assert.equal(switchProxyConfig(next, true), next);
  assert.throws(() => switchProxyConfig("unexpected config", true));
});
test("release paths, IDs and ports reject traversal and configuration injection", () => {
  for (const patch of [
    { id: "bad;value" },
    { root: "/opt/fletch/../etc" },
    { root: "/tmp/web" },
    { port: 3000 },
    { port: 3902 },
  ])
    assert.throws(() => validateRelease({ ...release, ...patch }));
});


test("static requests select a retained deployment directory without interpolating user paths", () => {
  const old = { ...release, id: "previous-release", port: 3002 };
  const config = upstreamConfig(release, [old]);
  assert.ok(config.includes('map $arg_dpl $fletch_web_static'));
  assert.ok(config.includes('"previous-release" /var/lib/fletch/web-static-versions/previous-release;'));
  assert.ok(config.includes('"registry-live-20260913" /var/lib/fletch/web-static-versions/registry-live-20260913;'));
  assert.ok(config.includes('default /var/lib/fletch/web-static;'));
  assert.ok(!config.includes('/$arg_dpl'));
  const oldConfig = 'server { location ^~ /_next/static/ { alias /var/lib/fletch/web-static/; } location / { proxy_pass http://$fletch_web_backend; } }';
  const updated = switchProxyConfig(oldConfig, true);
  assert.ok(updated.includes('alias $fletch_web_static/;'));
  assert.equal(switchProxyConfig(updated, true), updated);
});
