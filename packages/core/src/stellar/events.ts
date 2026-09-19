import { humanizeEvents, scValToNative, type xdr } from "@stellar/stellar-sdk";
import type { Api } from "@stellar/stellar-sdk/rpc";
import { contractsOf, type SquareContractName, type SquareDeployment, type TokenName } from "./deployments.js";

/**
 * A Soroban contract event from one of the contracts the deployment names,
 * decoded to native values: `topics` and `data` through `scValToNative`,
 * `name` the first topic when it is the symbol every Square event leads
 * with. The typed schema per event (which topic is the job id, what the data
 * struct holds) is `contracts/common`'s (#8) and arrives with the bindings;
 * this is the shape both an indexer and a transaction result read today.
 *
 * Where the event sits depends on where it was read from: `getEvents` gives
 * a ledger and an id (a TOID plus an index, ordered within the ledger, the
 * indexer's cursor); a transaction gives its own ledger and hash and the
 * event's place among the transaction's events.
 */
export interface SquareEvent {
  contract: SquareContractName | TokenName;
  contractId: string;
  name: string;
  topics: unknown[];
  data: unknown;
  ledger: number | undefined;
  id: string | undefined;
  txHash: string | undefined;
  /** Operation and event index inside the transaction, when read from one. */
  position: { operation: number; index: number } | undefined;
  /** False for an event a failed call emitted; `getEvents` reports it, a successful transaction never carries one. */
  inSuccessfulContractCall: boolean;
}

type EventSource = Api.GetTransactionResponse | Api.GetEventsResponse | readonly Api.EventResponse[] | readonly xdr.ContractEvent[];

function nameOf(topics: unknown[]): string {
  const first = topics[0];
  return typeof first === "string" ? first : "";
}

function fromContractEvent(event: xdr.ContractEvent): { contractId: string | undefined; topics: unknown[]; data: unknown } {
  const [decoded] = humanizeEvents([event]);
  return { contractId: decoded?.contractId, topics: decoded?.topics ?? [], data: decoded?.data };
}

function isTransactionResponse(source: EventSource): source is Api.GetTransactionResponse {
  return !Array.isArray(source) && "status" in source;
}

function isEventsResponse(source: EventSource): source is Api.GetEventsResponse {
  return !Array.isArray(source) && "events" in source && Array.isArray((source as Api.GetEventsResponse).events);
}

function isEventResponse(value: unknown): value is Api.EventResponse {
  return typeof value === "object" && value !== null && "topic" in value && "id" in value;
}

/**
 * The events of the deployment's contracts in `source`, in the order they
 * happened. `source` is a `getTransaction` response (its contract events,
 * per operation), a `getEvents` response or its `events`, or raw
 * `xdr.ContractEvent`s. Events from any other contract are left out; the
 * payment token's own events (`transfer`) are kept as `token`, and among
 * them, when the token is XLM, the fee events its SAC emits around a
 * transaction.
 */
export function decodeSquareEvents(source: EventSource, deployment: SquareDeployment): SquareEvent[] {
  const known = contractsOf(deployment);
  const events: SquareEvent[] = [];
  const keep = (contractId: string | undefined, rest: Omit<SquareEvent, "contract" | "contractId">): void => {
    if (contractId === undefined) return;
    const contract = known.get(contractId);
    if (contract === undefined) return;
    events.push({ contract, contractId, ...rest });
  };

  if (isTransactionResponse(source)) {
    if (source.status === "NOT_FOUND") return [];
    const ledger = source.ledger;
    source.events.contractEventsXdr.forEach((operation, operationIndex) => {
      operation.forEach((event, index) => {
        const { contractId, topics, data } = fromContractEvent(event);
        keep(contractId, {
          name: nameOf(topics),
          topics,
          data,
          ledger,
          id: undefined,
          txHash: source.txHash,
          position: { operation: operationIndex, index },
          inSuccessfulContractCall: source.status === "SUCCESS",
        });
      });
    });
    return events;
  }

  const list: readonly (Api.EventResponse | xdr.ContractEvent)[] = isEventsResponse(source) ? source.events : source;
  for (const [index, entry] of list.entries()) {
    if (isEventResponse(entry)) {
      const topics = entry.topic.map((topic) => scValToNativeSafe(topic));
      keep(entry.contractId?.contractId(), {
        name: nameOf(topics),
        topics,
        data: scValToNativeSafe(entry.value),
        ledger: entry.ledger,
        id: entry.id,
        txHash: entry.txHash,
        position: undefined,
        inSuccessfulContractCall: entry.inSuccessfulContractCall,
      });
    } else {
      const { contractId, topics, data } = fromContractEvent(entry);
      keep(contractId, {
        name: nameOf(topics),
        topics,
        data,
        ledger: undefined,
        id: undefined,
        txHash: undefined,
        position: { operation: 0, index },
        inSuccessfulContractCall: true,
      });
    }
  }
  return events.sort(byPosition);
}

function byPosition(a: SquareEvent, b: SquareEvent): number {
  if (a.ledger !== undefined && b.ledger !== undefined && a.ledger !== b.ledger) return a.ledger - b.ledger;
  if (a.id !== undefined && b.id !== undefined) return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  if (a.position && b.position) return a.position.operation - b.position.operation || a.position.index - b.position.index;
  return 0;
}

export function eventsNamed(events: readonly SquareEvent[], name: string): SquareEvent[] {
  return events.filter((event) => event.name === name);
}

/** The id `getEvents` gives an event, split: the ledger it is in comes first in the TOID. */
export function ledgerOfEventId(id: string): number {
  const toid = id.split("-")[0];
  if (!toid || !/^\d+$/.test(toid)) throw new RangeError(`${JSON.stringify(id)} is not an event id`);
  // A TOID packs the ledger sequence into its top 32 bits (SEP-35).
  return Number(BigInt(toid) >> 32n);
}

/** `scValToNative`, with a value it cannot render left as the XDR object rather than a throw. */
function scValToNativeSafe(value: xdr.ScVal): unknown {
  try {
    return scValToNative(value);
  } catch {
    return value;
  }
}
