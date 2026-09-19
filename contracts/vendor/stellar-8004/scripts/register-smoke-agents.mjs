#!/usr/bin/env node
// Registers Square's two permanent smoke agents (#35) on the testnet 8004
// identity registry that docs/decisions/8004-registries-on-stellar.md binds
// (#33). They are the same pair as on Arc (docs/smoke/README.md): one whose
// agent URI is the smoke card as a compact `data:` URI, and one registered
// with no URI.
//
//   cd contracts/vendor/stellar-8004/scripts && npm ci
//   SMOKE_AGENT_1_SECRET=… SMOKE_AGENT_2_SECRET=… \
//     node register-smoke-agents.mjs --card <the smoke card's JSON file>
//
// Agent 1 (the card) is owned by the account of SMOKE_AGENT_1_SECRET, agent 2
// by that of SMOKE_AGENT_2_SECRET. Each secret is read from its environment
// variable and from nowhere else. It is never printed, logged or written: only
// public keys appear in the output. An owner account that does not exist yet
// is funded by the network's Friendbot.
//
// Running it again is safe. An owner that already holds an agent with the
// intended URI is reported as it is, not registered a second time; an owner
// that holds one with another URI is refused, since a card is changed with
// `set_agent_uri`. So a retry after a partial failure cannot mint a second
// permanent identity. Once a registration lands, its transaction is reported
// even when a later read fails (as `readBackError`, with a non-zero exit).
//
// The registry, RPC, passphrase and explorer come from ../interface.json
// (`header`). The result is one JSON document on stdout, with what
// docs/smoke/agents.json records: owner, agent id, transaction, ledger, fees.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  Account,
  Address,
  BASE_FEE,
  Keypair,
  Operation,
  StrKey,
  TransactionBuilder,
  nativeToScVal,
  rpc,
  scValToNative,
} from '@stellar/stellar-sdk';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const { header } = JSON.parse(fs.readFileSync(path.join(HERE, '..', 'interface.json'), 'utf8'));
const NETWORK = header.network;
const REGISTRY = header.registries.identity.contract_id;
const server = new rpc.Server(NETWORK.rpc_url);
const POLL_ATTEMPTS = 30;
const SCAN_BATCH = 8;
const READ_ATTEMPTS = 4;

// Reads are retried: one dropped request to a public RPC should not end a run.
// Writes are not, so a transaction is never submitted twice by a retry.
async function retrying(label, read) {
  let last;
  for (let attempt = 1; attempt <= READ_ATTEMPTS; attempt += 1) {
    try {
      return await read();
    } catch (err) {
      last = err;
      if (attempt < READ_ATTEMPTS) await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
    }
  }
  throw new Error(`${label}: ${last?.message ?? last}`);
}

const AGENTS = [
  { label: 'card', secretVariable: 'SMOKE_AGENT_1_SECRET', withCard: true },
  { label: 'no-card', secretVariable: 'SMOKE_AGENT_2_SECRET', withCard: false },
];

const u32 = (n) => nativeToScVal(n, { type: 'u32' });
const str = (s) => nativeToScVal(s, { type: 'string' });
const address = (a) => new Address(a).toScVal();

function parseArgs(argv) {
  const at = argv.indexOf('--card');
  if (at < 0 || !argv[at + 1] || argv.length !== 2) {
    throw new Error('usage: register-smoke-agents.mjs --card <the smoke card JSON file>');
  }
  return { card: argv[at + 1] };
}

// The card compacted, as docs/smoke/README.md prescribes: JSON.stringify of the
// parsed file, so the URI does not depend on the file's indentation.
function cardUri(file) {
  const compact = JSON.stringify(JSON.parse(fs.readFileSync(file, 'utf8')));
  return `data:application/json;base64,${Buffer.from(compact).toString('base64')}`;
}

function loadOwner(variable) {
  const secret = process.env[variable];
  delete process.env[variable];
  if (!secret) throw new Error(`${variable} is not set`);
  if (!StrKey.isValidEd25519SecretSeed(secret)) throw new Error(`${variable} does not hold a Stellar secret key (S…)`);
  return Keypair.fromSecret(secret);
}

async function assertNetwork() {
  const network = await retrying('getNetwork', () => server.getNetwork());
  if (network.passphrase !== NETWORK.network_passphrase) {
    throw new Error(`${NETWORK.rpc_url} is "${network.passphrase}", interface.json says "${NETWORK.network_passphrase}"`);
  }
  return network;
}

const isMissingAccount = (err) => /not found/i.test(String(err?.message));

async function accountExists(publicKey) {
  return retrying(`getAccount ${publicKey}`, async () => {
    try {
      await server.getAccount(publicKey);
      return true;
    } catch (err) {
      if (isMissingAccount(err)) return false;
      throw err;
    }
  });
}

async function ensureFunded(publicKey, friendbotUrl) {
  if (await accountExists(publicKey)) return false;
  if (!friendbotUrl) throw new Error(`${publicKey} does not exist and ${NETWORK.name} has no Friendbot`);
  const url = new URL(friendbotUrl);
  url.searchParams.set('addr', publicKey);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Friendbot refused ${publicKey}: HTTP ${response.status}`);
  for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt += 1) {
    if (await accountExists(publicKey)) return true;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`${publicKey} was funded but did not appear`);
}

// A read: simulated from a random source that is never loaded, signed or charged.
async function view(fn, args) {
  const source = new Account(Keypair.random().publicKey(), '0');
  const tx = new TransactionBuilder(source, { fee: BASE_FEE, networkPassphrase: NETWORK.network_passphrase })
    .addOperation(Operation.invokeContractFunction({ contract: REGISTRY, function: fn, args }))
    .setTimeout(60)
    .build();
  const sim = await retrying(`simulate ${fn}`, () => server.simulateTransaction(tx));
  if (rpc.Api.isSimulationError(sim)) throw new Error(`${fn} failed in simulation: ${sim.error.split('\n')[0]}`);
  return scValToNative(sim.result.retval);
}

// The agents `owner` holds, newest first, with their URIs. `balance` bounds the
// scan, which walks down from the newest id and stops once all are found.
async function agentsOf(owner) {
  const held = await view('balance', [address(owner)]);
  const found = [];
  if (held === 0) return found;
  for (let top = (await view('total_agents', [])) - 1; top >= 0 && found.length < held; top -= SCAN_BATCH) {
    const ids = Array.from({ length: Math.min(SCAN_BATCH, top + 1) }, (_, i) => top - i);
    const owners = await Promise.all(ids.map((id) => view('find_owner', [u32(id)])));
    for (const [i, id] of ids.entries()) {
      if (owners[i] === owner) found.push({ agentId: id, uri: await view('token_uri', [u32(id)]) });
    }
  }
  return found;
}

async function send(owner, fn, args) {
  const source = await server.getAccount(owner.publicKey());
  const tx = new TransactionBuilder(source, { fee: BASE_FEE, networkPassphrase: NETWORK.network_passphrase })
    .addOperation(Operation.invokeContractFunction({ contract: REGISTRY, function: fn, args }))
    .setTimeout(60)
    .build();
  const prepared = await server.prepareTransaction(tx);
  prepared.sign(owner);
  const sent = await server.sendTransaction(prepared);
  if (sent.status !== 'PENDING') throw new Error(`${fn} was not accepted: ${sent.status}`);
  const result = await server.pollTransaction(sent.hash, { attempts: POLL_ATTEMPTS });
  if (result.status !== 'SUCCESS') throw new Error(`${fn} in ${sent.hash}: ${result.status}`);
  return { hash: sent.hash, result };
}

// An ScVal with its type kept, so the output shows how each value is encoded.
function describe(value) {
  const type = value.switch().name.replace(/^scv/, '').toLowerCase();
  if (type === 'map') return { map: Object.fromEntries(value.map().map((e) => [scValToNative(e.key()), describe(e.val())])) };
  if (type === 'vec') return { vec: value.vec().map(describe) };
  if (type === 'bytes') return { bytes: value.bytes().toString('hex') };
  const native = scValToNative(value);
  return { [type]: typeof native === 'bigint' ? native.toString() : native };
}

function eventsOf(result) {
  return (result.events?.contractEventsXdr?.[0] ?? []).map((event) => {
    const body = event.body().v0();
    return {
      contract: StrKey.encodeContract(Buffer.from(event.contractId())),
      topics: body.topics().map(describe),
      data: describe(body.data()),
    };
  });
}

function feesOf(result) {
  const meta = result.resultMetaXdr;
  const soroban = meta.switch() === 4 ? meta.v4().sorobanMeta() : meta.v3().sorobanMeta();
  const charged = { total: result.resultXdr.feeCharged().toString() };
  if (soroban?.ext().switch() !== 1) return charged;
  const v1 = soroban.ext().v1();
  return {
    ...charged,
    nonRefundableResource: v1.totalNonRefundableResourceFeeCharged().toString(),
    refundableResource: v1.totalRefundableResourceFeeCharged().toString(),
    rent: v1.rentFeeCharged().toString(),
  };
}

// What the registry reports for the new agent, compared with what was sent.
async function verify(agentId, owner, uri) {
  const read = {
    owner_of: await view('owner_of', [u32(agentId)]),
    get_agent_wallet: await view('get_agent_wallet', [u32(agentId)]),
    get_metadata_agentWallet: Buffer.from(await view('get_metadata', [u32(agentId), str('agentWallet')])).toString('ascii'),
    token_uri: await view('token_uri', [u32(agentId)]),
  };
  const expected = { owner_of: owner, get_agent_wallet: owner, get_metadata_agentWallet: owner, token_uri: uri };
  const wrong = Object.keys(expected).filter((k) => read[k] !== expected[k]);
  if (wrong.length) throw new Error(`agent ${agentId} reads back wrong: ${wrong.join(', ')}`);
  return { ...read, token_uri: uri === '' ? '' : `${uri.length} characters, equal to the card URI` };
}

async function registerAgent(agent, owner, uri) {
  const ownerKey = owner.publicKey();
  const held = await agentsOf(ownerKey);
  const summary = { label: agent.label, owner: ownerKey, agentUriScheme: uri === '' ? 'none' : 'data', agentUriLength: uri.length };
  const existing = held.find((a) => a.uri === uri);
  if (existing) {
    return { ...summary, agentId: existing.agentId, created: false, readBack: await verify(existing.agentId, ownerKey, uri) };
  }
  // A permanent identity is minted once. An owner that already holds an agent
  // with another URI is refused rather than given a second one: the card of
  // the one it holds is changed with `set_agent_uri`, not by registering again.
  if (held.length > 0) {
    throw new Error(
      `${ownerKey} already holds agent ${held.map((a) => a.agentId).join(', ')} with a different URI; ` +
        'update it with set_agent_uri instead of registering another permanent identity',
    );
  }
  const fn = uri === '' ? 'register' : 'register_with_uri';
  const args = uri === '' ? [address(ownerKey)] : [address(ownerKey), str(uri)];
  const { hash, result } = await send(owner, fn, args);
  // From here the registration exists on chain whatever happens next, so its
  // evidence is recorded before anything else is read.
  const record = {
    ...summary,
    agentId: scValToNative(result.returnValue),
    created: true,
    function: fn,
    transactionHash: hash,
    ledger: result.ledger,
    explorer: `${NETWORK.explorer_url}/tx/${hash}`,
  };
  try {
    const events = eventsOf(result);
    const registered = events.find((e) => e.topics[0].symbol === 'registered');
    if (registered?.topics[1].u32 !== record.agentId) {
      throw new Error(`${hash}: the registered event does not carry the returned id ${record.agentId}`);
    }
    return { ...record, feesStroops: feesOf(result), events, readBack: await verify(record.agentId, ownerKey, uri) };
  } catch (err) {
    process.exitCode = 1;
    return { ...record, readBackError: err.message };
  }
}

async function main() {
  const { card } = parseArgs(process.argv.slice(2));
  const uris = { card: cardUri(card), 'no-card': '' };
  const owners = AGENTS.map((agent) => loadOwner(agent.secretVariable));
  const network = await assertNetwork();
  const output = {
    network: { name: NETWORK.name, passphrase: NETWORK.network_passphrase, rpc: NETWORK.rpc_url, protocol: network.protocolVersion },
    identityRegistry: REGISTRY,
    fundedByFriendbot: [],
    agents: [],
  };
  // A permanent registration that succeeded is reported even when a later step
  // fails, so its transaction is never known only to the chain.
  try {
    for (const owner of owners) {
      if (await ensureFunded(owner.publicKey(), network.friendbotUrl)) output.fundedByFriendbot.push(owner.publicKey());
    }
    for (const [i, agent] of AGENTS.entries()) {
      const registered = await registerAgent(agent, owners[i], uris[agent.label]);
      output.agents.push({ ...registered, ...(agent.withCard ? { cardFile: card } : {}) });
    }
  } catch (err) {
    output.error = err.message;
    process.exitCode = 1;
  }
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
