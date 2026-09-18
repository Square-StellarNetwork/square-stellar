// Where the app is served; set at build time. Without it the links point at the app on its local dev port.
export const APP_URL = process.env["NEXT_PUBLIC_APP_URL"] ?? "http://localhost:3000";
export const REPO_URL = "https://github.com/Square-StellarNetwork/square";
export const DOCS_URL = "https://github.com/Square-StellarNetwork/square/tree/main/docs/design";
export const CONTRACTS_URL = "https://github.com/Square-StellarNetwork/square/tree/main/contracts";
export const SDK_URL = "https://github.com/Square-StellarNetwork/square/tree/main/packages/core";
export const EXPLORER_URL = "https://testnet.arcscan.app";
export const ARC_URL = "https://www.arc.io";
export const RPC_URL = "https://rpc.testnet.arc.io";
export const CHAIN_ID = 5042002;
export const SQUARE_JOB = "0x76E8690cEa9d94df810eE6b1F453866f0ee68c7B";
