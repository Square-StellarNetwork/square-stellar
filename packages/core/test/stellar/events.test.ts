import { Networks, StrKey, rpc, xdr } from "@stellar/stellar-sdk";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { decodeSquareEvents, eventsNamed, ledgerOfEventId, nativeToken, type SquareDeployment } from "../../src/stellar/index.js";
import { fixture, startMockRpc, type MockRpc } from "./rpcMock.js";

/**
 * The transaction docs/decisions/auth-and-token-flow.md records as tree 6:
 * `fund` on the auth probe playing the kernel, signed by the client and paid
 * by another account, moving 1 XLM through the native SAC. The deployment
 * below names the probe as the kernel and native XLM as the payment token,
 * so the one contract event in it, the SAC's `transfer`, is the token's.
 */
const KERNEL = "CCRIALS4QIRS52ZWBP2VAPBIVNKYC23D3IARZKCSNPY6WD5RZHONZIFY";
const XLM_SAC = nativeToken(Networks.TESTNET).contractId;
const CLIENT = "GBGFKN6QTTVHBK6JLS2NAVDBW6VRA74HUPF7HS66HXL7YGEACA4SXOQ3";
const FUND_TX = "0dca3bf887508c0cb5bea31b1d57cd45cf955363024bc606dd3a0dfab4692249";

const other = (n: number) => StrKey.encodeContract(Buffer.alloc(32, n));

const deployment: SquareDeployment = {
  network: "stellar:testnet",
  networkPassphrase: Networks.TESTNET,
  squareJob: KERNEL,
  keeperEvaluator: other(2),
  arbitration: other(3),
  claimMarket: other(4),
  squareHook: other(5),
  policyRegistry: other(6),
  token: nativeToken(Networks.TESTNET),
  identityRegistry: other(7),
  reputationRegistry: other(8),
  validationRegistry: other(9),
};

describe("events of a transaction", () => {
  // The fixture is parsed by the SDK itself, answered by a stand-in RPC, so the shape is the one `Server.getTransaction` hands out.
  let mock: MockRpc;
  let response: rpc.Api.GetTransactionResponse;
  beforeAll(async () => {
    mock = await startMockRpc();
    mock.on("getTransaction", () => fixture("getTransaction.fund.json"));
    response = await new rpc.Server(mock.url, { allowHttp: true }).getTransaction(FUND_TX);
  });
  afterAll(() => mock.close());

  it("are the deployment's contract events, decoded and placed", () => {
    const events = decodeSquareEvents(response, deployment);
    expect(events).toEqual([
      {
        contract: "token",
        contractId: XLM_SAC,
        name: "transfer",
        topics: ["transfer", CLIENT, KERNEL, "native"],
        data: 10_000_000n,
        ledger: 4760307,
        id: undefined,
        txHash: FUND_TX,
        position: { operation: 0, index: 0 },
        inSuccessfulContractCall: true,
      },
    ]);
  });

  it("leave out the fee events the XLM SAC emits around the transaction", () => {
    if (response.status === "NOT_FOUND") throw new Error("fixture");
    expect(response.events.transactionEventsXdr).toHaveLength(2);
    expect(decodeSquareEvents(response, deployment).every((event) => event.name !== "fee")).toBe(true);
  });

  it("leave out events of contracts the deployment does not name", () => {
    expect(decodeSquareEvents(response, { ...deployment, token: { ...deployment.token, contractId: other(10) } })).toEqual([]);
  });

  it("are empty for a transaction the network has not seen", () => {
    const missing: rpc.Api.GetMissingTransactionResponse = { status: rpc.Api.GetTransactionStatus.NOT_FOUND, txHash: FUND_TX, latestLedger: 1, latestLedgerCloseTime: 1, oldestLedger: 1, oldestLedgerCloseTime: 1 };
    expect(decodeSquareEvents(missing, deployment)).toEqual([]);
  });
});

describe("events from getEvents", () => {
  const raw = fixture<rpc.Api.RawGetEventsResponse>("getEvents.fund-transfer.json");
  const response = rpc.parseRawEvents(raw);

  it("carry the ledger, the id and the transaction they came from", () => {
    const events = decodeSquareEvents(response, deployment);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      contract: "token",
      name: "transfer",
      topics: ["transfer", CLIENT, KERNEL, "native"],
      data: 10_000_000n,
      ledger: 4760307,
      id: "0020445362883928064-0000000000",
      txHash: FUND_TX,
      position: undefined,
      inSuccessfulContractCall: true,
    });
  });

  it("decode the same from the events array alone", () => {
    expect(decodeSquareEvents(response.events, deployment)).toEqual(decodeSquareEvents(response, deployment));
  });

  it("sort by ledger, then by id", () => {
    const [one] = response.events;
    const later = { ...one!, ledger: one!.ledger + 1, id: "0020445367178895360-0000000000" };
    const sameLedgerLater = { ...one!, id: "0020445362883928064-0000000001" };
    const events = decodeSquareEvents([later, sameLedgerLater, one!], deployment);
    expect(events.map((event) => event.id)).toEqual([one!.id, sameLedgerLater.id, later.id]);
  });

  it("read the ledger out of an event id", () => {
    expect(ledgerOfEventId("0020445362883928064-0000000000")).toBe(4760307);
    expect(() => ledgerOfEventId("abc")).toThrow(RangeError);
  });
});

describe("raw contract events", () => {
  it("decode from xdr.ContractEvent values in their order", () => {
    const raw = fixture<rpc.Api.RawGetTransactionResponse>("getTransaction.fund.json");
    const events = raw.events!.contractEventsXdr!.flat().map((b64) => xdr.ContractEvent.fromXDR(b64, "base64"));
    const decoded = decodeSquareEvents(events, deployment);
    expect(decoded).toHaveLength(1);
    expect(decoded[0]).toMatchObject({ contract: "token", name: "transfer", position: { operation: 0, index: 0 }, ledger: undefined, txHash: undefined });
    expect(eventsNamed(decoded, "transfer")).toHaveLength(1);
    expect(eventsNamed(decoded, "fund")).toHaveLength(0);
  });
});
