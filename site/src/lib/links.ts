// Where the app is served; set at build time. Without it the links point at the app on its local dev port.
export const APP_URL = process.env["NEXT_PUBLIC_APP_URL"] ?? "http://localhost:3000";
export const REPO_URL = "https://github.com/Square-StellarNetwork/square-stellar";
export const DOCS_URL = "https://github.com/Square-StellarNetwork/square-stellar/tree/main/docs/design";
export const CONTRACTS_URL = "https://github.com/Square-StellarNetwork/square-stellar/tree/main/contracts";
export const SDK_URL = "https://github.com/Square-StellarNetwork/square-stellar/tree/main/packages/core";
export const EXPLORER_URL = "https://stellar.expert/explorer/testnet";
export const STELLAR_URL = "https://stellar.org";
export const RPC_URL = "https://soroban-testnet.stellar.org";
export const NETWORK_LABEL = "Stellar Testnet";
/** CAIP-2 identifier of the network the app settles on. */
export const NETWORK_ID = "stellar:testnet";
