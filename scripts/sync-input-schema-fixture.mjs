/**
 * Regenerate test/fixtures/live-input-schema.json from the actor's LIVE build.
 *
 * Why this script exists. The parity test asserts that the tool exposes every
 * input the live actor exposes. On 2026-08-16 that test was passing while
 * asserting something false: its expected list was hand maintained and had been
 * reconciled against the tool rather than against the actor, so when the actor
 * gained `concurrency` and the tool did not, the list agreed with the tool and
 * the gap stayed hidden. A parity check built from the thing it is checking is
 * not a check.
 *
 * So the expected list is now derived from a fixture, and the fixture is
 * produced BY THIS SCRIPT from the platform, never by hand and never from
 * src/index.ts. Run it after any actor build that changes the input schema:
 *
 *   node scripts/sync-input-schema-fixture.mjs
 *
 * The test itself stays offline and needs no token, which matters because the
 * tests deliberately run with APIFY_TOKEN unset.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const ACTOR_ID = 'TpurgcOZbVnknlaiC';
const TOKEN = process.env.APIFY_TOKEN
  || JSON.parse(readFileSync(join(homedir(), '.apify', 'auth.json'), 'utf8')).token;

async function api(path) {
  const res = await fetch(`https://api.apify.com/v2${path}`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  if (!res.ok) throw new Error(`${path} -> ${res.status}`);
  return (await res.json()).data;
}

const actor = await api(`/acts/${ACTOR_ID}`);
const latest = actor.taggedBuilds?.latest;
if (!latest) throw new Error('actor has no build tagged latest');

const build = await api(`/actor-builds/${latest.buildId}`);
const raw = build.inputSchema;
if (!raw) throw new Error(`build ${build.buildNumber} carries no input schema`);
const schema = typeof raw === 'string' ? JSON.parse(raw) : raw;

const fixture = {
  _provenance: {
    source: `GET https://api.apify.com/v2/actor-builds/${build.id}`,
    actorId: ACTOR_ID,
    buildNumber: build.buildNumber,
    buildId: build.id,
    copiedAt: new Date().toISOString().slice(0, 10),
    note: 'Copied verbatim from the live build record. Regenerate with scripts/sync-input-schema-fixture.mjs. Never hand edit, and never derive it from src/index.ts, which is the thing it exists to check.',
  },
  schema,
};

writeFileSync(join(repo, 'test', 'fixtures', 'live-input-schema.json'), `${JSON.stringify(fixture, null, 2)}\n`);

const visible = Object.entries(schema.properties)
  .filter(([, v]) => v.editor !== 'hidden')
  .map(([k]) => k)
  .sort();
console.log(`build ${build.buildNumber}: ${Object.keys(schema.properties).length} inputs, ${visible.length} visible`);
console.log(visible.join(', '));
