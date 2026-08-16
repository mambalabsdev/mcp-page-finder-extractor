import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..");
const pkg = JSON.parse(readFileSync(join(repo, "package.json"), "utf8"));

const TOOL_NAME = "find_company_page";
const ACTOR_ID = "TpurgcOZbVnknlaiC";
// The expected input list is derived from a FIXTURE COPIED FROM THE LIVE ACTOR,
// test/fixtures/live-input-schema.json, produced by scripts/sync-input-schema-fixture.mjs
// straight off the build record. It is deliberately NOT derived from the tool
// definition in src/index.ts.
//
// That distinction is the whole point of this test. On 2026-08-16 this list was
// hand maintained and had last been reconciled against the tool rather than
// against the actor, so when the actor gained `concurrency` and the tool did
// not, the list agreed with the tool and the test passed while asserting
// something false. A parity check built from the thing it is checking is not a
// check. The fixture keeps the test offline, which matters because these tests
// run with APIFY_TOKEN deliberately unset.
const LIVE = JSON.parse(readFileSync(join(repo, "test", "fixtures", "live-input-schema.json"), "utf8"));
const LIVE_PROPS = LIVE.schema.properties;

// `source_tag` is editor: hidden. It is set by Mamba Labs task plumbing, not by
// a caller, so it is excluded from what the tool must expose.
const ACTOR_INPUTS = Object.entries(LIVE_PROPS)
  .filter(([, spec]) => spec.editor !== "hidden")
  .map(([name]) => name);

// Whatever the live actor marks required. This actor declares none: a run with
// no usable input still returns a row saying so, which is R10, so requiring one
// here would be stricter than the actor and would reject a call it accepts.
const ACTOR_REQUIRED = LIVE.schema.required ?? [];

// Speak MCP over stdio to the built server and return the tools/list result.
// No APIFY_TOKEN is set, on purpose: a client must see capabilities before it
// has configured anything.
function listTools() {
  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    delete env.APIFY_TOKEN;
    const child = spawn(process.execPath, [join(repo, "build", "index.js")], {
      stdio: ["pipe", "pipe", "pipe"],
      env,
    });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`timed out. stderr: ${err}`));
    }, 20000);

    child.stdout.on("data", (chunk) => {
      out += chunk.toString();
      for (const line of out.split("\n")) {
        if (!line.trim()) continue;
        let msg;
        try {
          msg = JSON.parse(line);
        } catch {
          continue;
        }
        if (msg.id === 2) {
          clearTimeout(timer);
          child.kill();
          resolve(msg.result);
        }
      }
    });
    child.stderr.on("data", (chunk) => {
      err += chunk.toString();
    });
    child.on("error", reject);

    child.stdin.write(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "wrapper-test", version: "0.0.0" },
        },
      }) + "\n",
    );
    child.stdin.write(
      JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n",
    );
    child.stdin.write(
      JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }) + "\n",
    );
  });
}

test("serves tools/list with no APIFY_TOKEN set", async () => {
  const result = await listTools();
  assert.equal(result.tools.length, 1);
  assert.equal(result.tools[0].name, TOOL_NAME);
  assert.ok(result.tools[0].description.length > 0);
});

test("tool schema exposes every live actor input", async () => {
  const result = await listTools();
  const props = Object.keys(result.tools[0].inputSchema.properties).sort();
  assert.deepEqual(props, [...ACTOR_INPUTS].sort());
});

test("tool schema requires exactly what the live actor requires", async () => {
  const result = await listTools();
  const required = (result.tools[0].inputSchema.required ?? []).slice().sort();
  assert.deepEqual(required, [...ACTOR_REQUIRED].sort());
});

test("source pins the immutable actor id, not a Store slug", () => {
  const src = readFileSync(join(repo, "src", "index.ts"), "utf8");
  assert.ok(src.includes(`"${ACTOR_ID}"`), "actor id missing from source");
});

test("package identity matches the locked naming convention", () => {
  const mcp = JSON.parse(readFileSync(join(repo, ".mcp.json"), "utf8"));
  const key = Object.keys(mcp.mcpServers);
  assert.deepEqual(key, ["mamba-page-finder-extractor"]);
  assert.deepEqual(mcp.mcpServers[key[0]].args, ["-y", pkg.name]);
  assert.equal(pkg.name, "@mambalabsdev/mcp-page-finder-extractor");
  assert.equal(pkg.mcpName, "com.mambabuilt/mcp-page-finder-extractor");
});

test("the package ships only the declared allowlist", () => {
  // The npm tarball is an allowlist, not a denylist: nothing can ship by
  // accident, so no scan of the repo for names that must not leak is what
  // stands between this package and a bad publish.
  assert.deepEqual(pkg.files, ["build", "README.md", "LICENSE", "SECURITY.md"]);
  assert.equal(pkg.bin[Object.keys(pkg.bin)[0]], "./build/index.js");
  assert.deepEqual(Object.keys(pkg.bin), [pkg.name.split("/")[1]]);
});

test("the parity fixture came from this actor, not a sibling", () => {
  // Cheap, and it catches the copy-paste failure mode that a fixture introduces:
  // a fixture pasted from another wrapper would make every parity assertion
  // above agree about the wrong actor.
  assert.equal(LIVE._provenance.actorId, ACTOR_ID);
  assert.match(LIVE._provenance.source, /actor-builds\//);
  assert.ok(LIVE._provenance.buildNumber, "fixture records the build it came from");
});

test("every input the live actor exposes carries a description in the tool", async () => {
  const result = await listTools();
  const props = result.tools[0].inputSchema.properties;
  const missing = ACTOR_INPUTS.filter((name) => !props[name]?.description?.trim());
  assert.deepEqual(missing, [], `inputs with no description: ${missing.join(", ")}`);
});
