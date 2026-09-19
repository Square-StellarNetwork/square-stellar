#!/usr/bin/env node
// Stellar keys that must outlive a run (#19, #33): generated in this
// process, stored only as GitHub repository secrets, and handed to one command
// through its environment. No secret key is printed, logged or written to a
// file; the only output is each secret's name and public key, then the
// command's own output.
//
//   node script/testnet-keys.mjs --secret NAME [--secret NAME …] -- <command …>
//
// The command runs with every NAME set to its new secret key (S…). A NAME that
// already exists among the repository's secrets is refused: GitHub never gives
// a secret back, so replacing one would orphan whatever its old key owns — a
// permanent agent, a contract's owner. The repository is the `origin` remote's,
// and `gh` must be signed in as an account that can write its secrets.

import { execFileSync, spawnSync } from 'node:child_process';
import { Keypair } from '@stellar/stellar-sdk';

function parse(argv) {
  const at = argv.indexOf('--');
  const own = at < 0 ? argv : argv.slice(0, at);
  const command = at < 0 ? [] : argv.slice(at + 1);
  const names = [];
  for (let i = 0; i < own.length; i += 1) {
    if (own[i] === '--secret' && /^[A-Z][A-Z0-9_]*$/.test(own[i + 1] ?? '')) names.push(own[(i += 1)]);
    else throw new Error(`unexpected argument ${JSON.stringify(own[i])}`);
  }
  if (names.length === 0 || command.length === 0) {
    throw new Error('usage: testnet-keys.mjs --secret NAME [--secret NAME …] -- <command …>');
  }
  if (new Set(names).size !== names.length) throw new Error('a secret name is given twice');
  return { names, command };
}

function repository() {
  const url = execFileSync('git', ['remote', 'get-url', 'origin'], { encoding: 'utf8' }).trim();
  const match = url.match(/github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?$/);
  if (!match) throw new Error(`origin is not a GitHub repository: ${url}`);
  return match[1];
}

function existingSecrets(repo) {
  const out = execFileSync('gh', ['secret', 'list', '--repo', repo, '--json', 'name'], { encoding: 'utf8' });
  return new Set(JSON.parse(out).map((s) => s.name));
}

function storeSecret(repo, name, value) {
  // The value goes through stdin, so it never appears in an argument list.
  execFileSync('gh', ['secret', 'set', name, '--repo', repo], { input: value, stdio: ['pipe', 'ignore', 'inherit'] });
}

function main() {
  const { names, command } = parse(process.argv.slice(2));
  const repo = repository();
  const taken = names.filter((name) => existingSecrets(repo).has(name));
  if (taken.length) throw new Error(`${repo} already has ${taken.join(', ')}; refusing to replace a key that may own permanent state`);
  const keys = names.map((name) => ({ name, pair: Keypair.random() }));
  for (const { name, pair } of keys) {
    storeSecret(repo, name, pair.secret());
    console.error(`${name}  ${pair.publicKey()}  stored in ${repo}'s secrets`);
  }
  const env = { ...process.env };
  for (const { name, pair } of keys) env[name] = pair.secret();
  const run = spawnSync(command[0], command.slice(1), { env, stdio: 'inherit' });
  if (run.error) throw run.error;
  process.exitCode = run.status ?? 1;
}

try {
  main();
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
