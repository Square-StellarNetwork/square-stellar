import type { Database } from "../database.js";
import { bytesToHex, hexToBytes, jsonParam, nullableBigIntParam, type Hex, type Json } from "../codec.js";
import type { IndexedContract } from "../contracts.js";

export interface JobEventRecord {
  chainId: number;
  blockNumber: bigint;
  logIndex: number;
  txHash: Hex;
  contract: IndexedContract;
  name: string;
  jobId: bigint | null;
  args: Json;
}

export async function insertIfAbsent(db: Database, event: JobEventRecord): Promise<boolean> {
  const { rowCount } = await db.query(
    `insert into job_events (chain_id, block_number, log_index, tx_hash, contract, name, job_id, args)
     values ($1, $2, $3, $4, $5, $6, $7, $8)
     on conflict (chain_id, block_number, log_index) do nothing`,
    [
      event.chainId,
      event.blockNumber.toString(),
      event.logIndex,
      hexToBytes(event.txHash),
      event.contract,
      event.name,
      nullableBigIntParam(event.jobId),
      jsonParam(event.args),
    ],
  );
  return rowCount === 1;
}

/** One journaled event as a reader sees it: where it was mined and what it carried. */
export interface JobEventView {
  contract: IndexedContract;
  name: string;
  blockNumber: bigint;
  logIndex: number;
  txHash: Hex;
  /** The journal's `args` as written: `{ raw, decoded }` for a log the indexer decoded. */
  args: Json;
}

interface JobEventRow {
  contract: IndexedContract;
  name: string;
  block_number: string;
  log_index: number;
  tx_hash: Uint8Array;
  args: Json;
}

/**
 * Every journaled event of one job, oldest first, in the order the chain
 * emitted them. Read by the indexer's `/jobs/:id/events` for the settlement
 * record: what the hook and the compliance module said about a release is
 * only in these events, since the kernel's job record keeps the money and
 * not the verdict.
 */
export async function listByJob(db: Database, chainId: number, jobId: bigint): Promise<JobEventView[]> {
  const { rows } = await db.query<JobEventRow>(
    `select contract, name, block_number, log_index, tx_hash, args
     from job_events
     where chain_id = $1 and job_id = $2
     order by block_number, log_index`,
    [chainId, jobId.toString()],
  );
  return rows.map((row) => ({
    contract: row.contract,
    name: row.name,
    blockNumber: BigInt(row.block_number),
    logIndex: row.log_index,
    txHash: bytesToHex(row.tx_hash),
    args: row.args,
  }));
}
