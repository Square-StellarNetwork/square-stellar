#!/usr/bin/env node
// The 8004 registries Square binds on testnet are trionlabs/stellar-8004's
// deployment (docs/decisions/8004-registries-on-stellar.md, #33). This tool
// keeps three things equal to what those contracts expose on chain:
//
// - `generated` in contracts/vendor/stellar-8004/interface.json: each
//   registry's Wasm sha256, its owner and its whole contract spec, normalised;
// - the interface table in the decision record, rendered from that and from
//   the rows `header.table` names;
// - the vendored port: its spec must contain every entry of the live spec,
//   unchanged.
//
//   node tools/check-8004-interface.mjs           fetch the live contracts, rewrite both files
//   node tools/check-8004-interface.mjs --check   fail on any difference, on a pending or an
//                                                 executed upgrade, or on an incompatible port
//   node tools/check-8004-interface.mjs --watch   the upgrade watch alone: Wasm hash, owner,
//                                                 pending_upgrade
//
// Contract ids, network, hashes and table rows come from interface.json's
// `header`, the one place they are written. Every chain read goes through the
// pinned stellar-cli (.github/actions/stellar-cli): `contract fetch` for the
// Wasm, `contract info interface` for its spec, `contract invoke --send=no` for
// the views. Nothing is signed or sent. --check also needs the port built:
// `stellar contract build` in contracts/vendor/stellar-8004.

import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const VENDOR = path.join(REPO, 'contracts', 'vendor', 'stellar-8004');
const INTERFACE = path.join(VENDOR, 'interface.json');
// Where `stellar contract build` in the port's workspace writes, as for
// tools/check-no-upgrade.mjs: CARGO_TARGET_DIR when it is set.
const PORT_RELEASE = path.join(process.env.CARGO_TARGET_DIR ?? path.join(VENDOR, 'target'), 'wasm32v1-none', 'release');
const BEGIN = '<!-- BEGIN interface table: rendered by contracts/tools/check-8004-interface.mjs from interface.json; do not edit by hand -->';
const END = '<!-- END interface table -->';
const CALL_TIMEOUT_MS = 120_000;
// A scheduled run against a public RPC should not raise the alarm over one
// dropped request; a real failure fails all attempts.
const ATTEMPTS = 3;
const RETRY_DELAY_MS = 3_000;
const MODES = new Map([[undefined, 'write'], ['--check', 'check'], ['--watch', 'watch']]);
const run = promisify(execFile);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------- stellar-cli

async function retrying(label, attempt) {
  for (let n = 1; ; n += 1) {
    try {
      return await attempt();
    } catch (err) {
      if (n === ATTEMPTS) throw new Error(`${label} failed ${ATTEMPTS} times; last: ${err.message}`);
      await sleep(RETRY_DELAY_MS * n);
    }
  }
}

function stellar(args, label = `stellar ${args.slice(0, 3).join(' ')}`) {
  return retrying(label, async () => {
    try {
      const { stdout } = await run('stellar', args, { encoding: 'utf8', maxBuffer: 64 << 20, timeout: CALL_TIMEOUT_MS });
      return stdout;
    } catch (err) {
      throw new Error(String(err.stderr || err.message).trim().split('\n').slice(-3).join(' | '));
    }
  });
}

const networkArgs = (network) => ['--rpc-url', network.rpc_url, '--network-passphrase', network.network_passphrase];

// The claim is "the contracts on this network", so the endpoint has to be that network.
async function assertNetwork(network) {
  const { result } = await retrying(`getNetwork on ${network.rpc_url}`, async () => {
    const response = await fetch(network.rpc_url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getNetwork' }),
      signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  });
  if (result?.passphrase !== network.network_passphrase) {
    throw new Error(`${network.rpc_url} is "${result?.passphrase}", interface.json says "${network.network_passphrase}"`);
  }
  return result.protocolVersion;
}

// A simulation needs a source account but never loads it or asks it to sign,
// so a fresh random one is used: an ed25519 public key in StrKey form.
function randomAccountId() {
  const { publicKey } = crypto.generateKeyPairSync('ed25519');
  const raw = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
  const body = Buffer.concat([Buffer.from([6 << 3]), raw]);
  const crc = crc16xmodem(body);
  return base32(Buffer.concat([body, Buffer.from([crc & 0xff, crc >> 8])]));
}

function crc16xmodem(bytes) {
  let crc = 0;
  for (const byte of bytes) {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc & 0x8000 ? (crc << 1) ^ 0x1021 : crc << 1) & 0xffff;
  }
  return crc;
}

function base32(bytes) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let out = '';
  let bits = 0;
  let value = 0;
  for (const byte of bytes) {
    value = ((value << 8) | byte) & 0xffff;
    bits += 8;
    while (bits >= 5) {
      out += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  return bits > 0 ? out + alphabet[(value << (5 - bits)) & 31] : out;
}

function parsed(label, stdout) {
  try {
    return JSON.parse(stdout.trim());
  } catch (err) {
    throw new Error(`${label}: stellar-cli did not print JSON (${err.message})`);
  }
}

async function view(network, contractId, fn) {
  const args = ['contract', 'invoke', '--id', contractId, ...networkArgs(network)];
  const label = `${contractId} ${fn}`;
  return parsed(label, await stellar([...args, '--source-account', randomAccountId(), '--send=no', '--', fn], `stellar contract invoke ${label}`));
}

async function fetchWasm(network, contractId, dir) {
  const file = path.join(dir, `${contractId}.wasm`);
  await stellar(['contract', 'fetch', '--id', contractId, ...networkArgs(network), '--out-file', file]);
  return file;
}

const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const specOf = async (wasm) =>
  normalise(parsed(`the spec of ${path.basename(wasm)}`, await stellar(['contract', 'info', 'interface', '--wasm', wasm, '--output', 'json'])));

// ------------------------------------------------------------ spec, normalised

const PRIMITIVES = {
  val: 'Val', bool: 'bool', void: '()', error: 'Error', u32: 'u32', i32: 'i32', u64: 'u64', i64: 'i64',
  timepoint: 'Timepoint', duration: 'Duration', u128: 'u128', i128: 'i128', u256: 'U256', i256: 'I256',
  bytes: 'Bytes', string: 'String', symbol: 'Symbol', address: 'Address', muxed_address: 'MuxedAddress',
};

// Written the way `stellar contract info interface --output rust` writes types.
function typeName(type) {
  if (typeof type === 'string') {
    if (!(type in PRIMITIVES)) throw new Error(`unknown spec type ${type}`);
    return PRIMITIVES[type];
  }
  const [[kind, v]] = Object.entries(type);
  switch (kind) {
    case 'udt': return v.name;
    case 'option': return `Option<${typeName(v.value_type)}>`;
    case 'vec': return `Vec<${typeName(v.element_type)}>`;
    case 'map': return `Map<${typeName(v.key_type)}, ${typeName(v.value_type)}>`;
    case 'result': return `Result<${typeName(v.ok_type)}, ${typeName(v.error_type)}>`;
    case 'tuple': return `(${v.value_types.map(typeName).join(', ')})`;
    case 'bytes_n': return `BytesN<${v.n}>`;
    default: throw new Error(`unknown spec type ${JSON.stringify(type)}`);
  }
}

// Empty doc strings are dropped so the file stays readable; both sides of every
// comparison go through here, so nothing is lost.
const doc = (text) => (text ? { doc: text } : {});

function unionCase(entry) {
  const [[kind, v]] = Object.entries(entry);
  return kind === 'void_v0' ? { name: v.name, ...doc(v.doc) } : { name: v.name, ...doc(v.doc), types: v.type_.map(typeName) };
}

function normaliseEntry(kind, v) {
  const head = { name: v.name, ...(v.lib ? { lib: v.lib } : {}), ...doc(v.doc) };
  switch (kind) {
    case 'function_v0':
      return ['functions', { ...head, inputs: v.inputs.map((i) => ({ name: i.name, type: typeName(i.type_), ...doc(i.doc) })), output: v.outputs.length ? typeName(v.outputs[0]) : '()' }];
    case 'udt_struct_v0':
      return ['types', { kind: 'struct', ...head, fields: v.fields.map((f) => ({ name: f.name, type: typeName(f.type_), ...doc(f.doc) })) }];
    case 'udt_union_v0':
      return ['types', { kind: 'union', ...head, cases: v.cases.map(unionCase) }];
    case 'udt_enum_v0':
    case 'udt_error_enum_v0':
      return ['types', { kind: kind === 'udt_enum_v0' ? 'enum' : 'error', ...head, cases: v.cases.map((c) => ({ name: c.name, value: c.value, ...doc(c.doc) })) }];
    case 'event_v0':
      return ['events', { ...head, prefix_topics: v.prefix_topics, data_format: v.data_format, params: v.params.map((p) => ({ name: p.name, type: typeName(p.type_), location: p.location === 'topic_list' ? 'topic' : p.location, ...doc(p.doc) })) }];
    default:
      throw new Error(`unknown spec entry ${kind}`);
  }
}

function normalise(entries) {
  const spec = { functions: [], types: [], events: [] };
  for (const entry of entries) {
    const [[kind, v]] = Object.entries(entry);
    const [list, item] = normaliseEntry(kind, v);
    spec[list].push(item);
  }
  return spec;
}

// Entry by entry: what `expected` has and `actual` lacks or holds differently.
function missingOrChanged(expected, actual, labels) {
  const problems = [];
  for (const list of ['functions', 'types', 'events']) {
    const have = new Map(actual[list].map((item) => [item.name, JSON.stringify(item)]));
    for (const item of expected[list]) {
      const want = JSON.stringify(item);
      if (!have.has(item.name)) problems.push(`${list} ${item.name}: in ${labels[0]}, not in ${labels[1]}`);
      else if (have.get(item.name) !== want) problems.push(`${list} ${item.name} differs\n      ${labels[0]}: ${want}\n      ${labels[1]}: ${have.get(item.name)}`);
    }
  }
  return problems;
}

function extras(base, other) {
  return ['functions', 'types', 'events'].flatMap((list) => {
    const names = new Set(base[list].map((item) => item.name));
    return other[list].filter((item) => !names.has(item.name)).map((item) => `${list} ${item.name}`);
  });
}

// --------------------------------------------------------------- table render

const code = (text) => `\`${text}\``;
const signature = (f) => `${f.name}(${f.inputs.map((i) => `${i.name}: ${i.type}`).join(', ')}) -> ${f.output}`;
const titled = (name) => `${name[0].toUpperCase()}${name.slice(1)}`;

function definition(type) {
  if (type.kind === 'struct') return `struct { ${type.fields.map((f) => `${f.name}: ${f.type}`).join(', ')} }`;
  if (type.kind === 'union') return `union: ${type.cases.map((c) => (c.types ? `${c.name}(${c.types.join(', ')})` : c.name)).join(', ')}`;
  return `${type.kind}: ${type.cases.map((c) => `${c.name} = ${c.value}`).join(', ')}`;
}

// The types a table row names, and the types those name, in spec order.
function reachableTypes(spec, typeStrings) {
  const byName = new Map(spec.types.map((t) => [t.name, t]));
  const seen = new Set();
  const visit = (text) => {
    for (const token of text.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? []) {
      if (!byName.has(token) || seen.has(token)) continue;
      seen.add(token);
      const t = byName.get(token);
      for (const f of t.fields ?? []) visit(f.type);
      for (const c of t.cases ?? []) for (const inner of c.types ?? []) visit(inner);
    }
  };
  typeStrings.forEach(visit);
  return spec.types.filter((t) => seen.has(t.name));
}

// Hand-written table text, made safe for a GFM table cell.
const cell = (text) => String(text).replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ');

// A row the spec lacks is left out here; tableProblems reports it.
function renderRegistry(name, registry, spec, rows) {
  const functions = Object.entries(rows.functions)
    .map(([fn, row]) => [spec.functions.find((f) => f.name === fn), row])
    .filter(([f]) => f);
  const events = Object.entries(rows.events)
    .map(([ev, row]) => [spec.events.find((e) => e.name === ev), row])
    .filter(([e]) => e);
  const lines = [`#### ${titled(name)} registry, ${code(registry.contract_id)}`, ''];
  lines.push('| Function | Used by | Notes |', '|---|---|---|');
  for (const [f, row] of functions) lines.push(`| ${code(signature(f))} | ${cell(row.used_by)} | ${cell(row.note)} |`);
  lines.push('', '| Event | Topics | Data | Notes |', '|---|---|---|---|');
  for (const [e, row] of events) {
    const topics = [...e.prefix_topics.map((t) => code(`"${t}"`)), ...e.params.filter((p) => p.location === 'topic').map((p) => code(`${p.name}: ${p.type}`))];
    const data = e.params.filter((p) => p.location === 'data').map((p) => code(`${p.name}: ${p.type}`));
    lines.push(`| ${code(e.name)} | ${topics.join(', ')} | ${e.data_format}${data.length ? `: ${data.join(', ')}` : ', empty'} | ${cell(row.note)} |`);
  }
  const used = [...functions.flatMap(([f]) => [...f.inputs.map((i) => i.type), f.output]), ...events.flatMap(([e]) => e.params.map((p) => p.type))];
  const types = reachableTypes(spec, used);
  if (types.length) {
    lines.push('', '| Type | Definition |', '|---|---|');
    for (const t of types) lines.push(`| ${code(t.name)} | ${code(definition(t))} |`);
  }
  return lines;
}

function renderTable(header, generated) {
  const lines = [BEGIN, ''];
  for (const [name, registry] of Object.entries(header.registries)) {
    lines.push(...renderRegistry(name, registry, generated.registries[name], header.table[name]), '');
  }
  lines.push(END);
  return lines.join('\n');
}

function tableRegion(text, file) {
  const start = text.indexOf(BEGIN);
  const end = text.indexOf(END);
  if (start < 0 || end < start) throw new Error(`${file} has no interface-table markers`);
  return { start, end: end + END.length };
}

// ---------------------------------------------------------------- live reads

async function readLive(header, { withSpec }) {
  await assertNetwork(header.network);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-8004-'));
  try {
    const live = {};
    for (const [name, registry] of Object.entries(header.registries)) {
      const wasm = await fetchWasm(header.network, registry.contract_id, dir);
      live[name] = {
        wasm_sha256: sha256(wasm),
        owner: await view(header.network, registry.contract_id, 'get_owner'),
        pending_upgrade: await view(header.network, registry.contract_id, 'pending_upgrade'),
        ...(withSpec ? { spec: await specOf(wasm) } : {}),
      };
      console.log(`${name.padEnd(10)} ${registry.contract_id}  wasm ${live[name].wasm_sha256}  owner ${live[name].owner}  pending_upgrade ${JSON.stringify(live[name].pending_upgrade)}`);
    }
    return live;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// The published hash is the one upstream's reproducible build gives for the
// pinned commit; the live Wasm leaving it means the code Square reads changed.
function hashProblems(header, live) {
  return Object.entries(header.registries)
    .filter(([name, registry]) => live[name].wasm_sha256 !== registry.published_wasm_sha256)
    .map(([name, registry]) => `${name}: live Wasm sha256 is ${live[name].wasm_sha256}, published ${registry.published_wasm_sha256}: the contract was upgraded or replaced`);
}

function watchProblems(header, generated, live) {
  const problems = hashProblems(header, live);
  const timelock = header.upstream.upgrade_timelock_ledgers;
  for (const name of Object.keys(header.registries)) {
    const { pending_upgrade: pending, owner } = live[name];
    if (pending !== null) {
      problems.push(`${name}: upgrade proposed at ledger ${pending.proposed_at} to Wasm ${pending.wasm_hash}; executable from ledger ${pending.proposed_at + timelock}`);
    }
    const recorded = generated.registries[name].owner;
    if (owner !== recorded) problems.push(`${name}: owner is ${owner}, interface.json recorded ${recorded}`);
  }
  return problems;
}

// ------------------------------------------------------------------- checks

function tableProblems(header, specs) {
  const problems = [];
  for (const [name, rows] of Object.entries(header.table)) {
    for (const fn of Object.keys(rows.functions)) {
      if (!specs[name].functions.some((f) => f.name === fn)) problems.push(`${name}: the table names function ${fn}, which the live spec does not have`);
    }
    for (const ev of Object.keys(rows.events)) {
      if (!specs[name].events.some((e) => e.name === ev)) problems.push(`${name}: the table names event ${ev}, which the live spec does not have`);
    }
  }
  return problems;
}

function specProblems(header, generated, live) {
  const problems = [];
  for (const name of Object.keys(header.registries)) {
    const recorded = generated.registries[name];
    const { spec, wasm_sha256: hash } = live[name];
    const recordedSpec = { functions: recorded.functions, types: recorded.types, events: recorded.events };
    if (recorded.wasm_sha256 !== hash) problems.push(`${name}: interface.json was generated from Wasm ${recorded.wasm_sha256}, live is ${hash}`);
    const diff = [...missingOrChanged(recordedSpec, spec, ['interface.json', 'live']), ...extras(recordedSpec, spec).map((e) => `${e}: live, not in interface.json`)];
    if (!diff.length && JSON.stringify(recordedSpec) !== JSON.stringify(spec)) diff.push('same entries in a different order');
    problems.push(...diff.map((d) => `${name}: ${d}`));
  }
  return problems;
}

// Entries only the port has are allowed and listed: soroban-sdk 27 puts the
// error enums raised with panic_with_error! in the spec, and 25.3.0 did not.
async function portProblems(header, live) {
  const problems = [];
  for (const [name, registry] of Object.entries(header.registries)) {
    const wasm = path.join(PORT_RELEASE, registry.port_wasm);
    if (!fs.existsSync(wasm)) {
      problems.push(`${name}: ${path.relative(REPO, wasm)} is missing; run \`stellar contract build\` in contracts/vendor/stellar-8004`);
      continue;
    }
    const port = await specOf(wasm);
    const differences = missingOrChanged(live[name].spec, port, ['live', 'port']);
    problems.push(...differences.map((d) => `${name}: ${d}`));
    const added = extras(live[name].spec, port);
    const verdict = differences.length ? `${differences.length} live entries missing or changed` : 'holds every live entry';
    console.log(`port ${name.padEnd(10)} ${sha256(wasm)}  ${verdict}; only in the port: ${added.length ? added.join(', ') : 'nothing'}`);
  }
  return problems;
}

function docProblems(header, generated) {
  const file = path.join(REPO, header.decision);
  const text = fs.readFileSync(file, 'utf8');
  const { start, end } = tableRegion(text, header.decision);
  return text.slice(start, end) === renderTable(header, generated)
    ? []
    : [`${header.decision}: the interface table is stale; run \`node contracts/tools/check-8004-interface.mjs\``];
}

// --------------------------------------------------------------------- main

function writeFiles(file, live) {
  const generated = {
    $comment: 'Written by contracts/tools/check-8004-interface.mjs from the live contracts named in header.registries. Do not edit.',
    registries: Object.fromEntries(Object.entries(live).map(([name, l]) => [name, { wasm_sha256: l.wasm_sha256, owner: l.owner, ...l.spec }])),
  };
  fs.writeFileSync(INTERFACE, `${JSON.stringify({ header: file.header, generated }, null, 2)}\n`);
  const doc = path.join(REPO, file.header.decision);
  const text = fs.readFileSync(doc, 'utf8');
  const { start, end } = tableRegion(text, file.header.decision);
  fs.writeFileSync(doc, text.slice(0, start) + renderTable(file.header, generated) + text.slice(end));
  console.log(`\nwrote ${path.relative(REPO, INTERFACE)} and the table in ${file.header.decision}`);
}

async function main() {
  const flags = process.argv.slice(2);
  const mode = flags.length <= 1 ? MODES.get(flags[0]) : undefined;
  if (!mode) {
    console.error('usage: check-8004-interface.mjs [--check | --watch]');
    process.exit(2);
  }
  const file = JSON.parse(fs.readFileSync(INTERFACE, 'utf8'));
  const { header, generated } = file;
  if (mode !== 'write' && !generated) throw new Error(`${path.relative(REPO, INTERFACE)} has no generated section; run the tool without flags first`);
  const live = await readLive(header, { withSpec: mode !== 'watch' });
  const specs = Object.fromEntries(Object.entries(live).map(([name, l]) => [name, l.spec]));
  if (mode === 'write') {
    // Generating from a Wasm other than the pinned build, or for a table row the
    // spec lacks, would record something nobody decided on.
    const pending = Object.entries(live)
      .filter(([, l]) => l.pending_upgrade !== null && l.pending_upgrade !== undefined)
      .map(([name]) => `${name}: an upgrade is pending, so this spec is about to be replaced`);
    const refused = [...hashProblems(header, live), ...tableProblems(header, specs), ...pending];
    if (refused.length) throw new Error(`not written:\n  ${refused.join('\n  ')}`);
    writeFiles(file, live);
    return;
  }
  const problems = watchProblems(header, generated, live);
  if (mode === 'check') {
    problems.push(
      ...tableProblems(header, specs),
      ...specProblems(header, generated, live),
      ...docProblems(header, generated),
      ...(await portProblems(header, live)),
    );
  }
  if (problems.length) {
    console.error(`\n${problems.length} problem(s); see ${header.decision}:\n  ${problems.join('\n  ')}`);
    process.exit(1);
  }
  console.log(`\nok: ${mode === 'watch' ? 'no upgrade proposed or executed, owners unchanged' : 'interface.json, the table and the port match the live contracts'}`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
