/**
 * `@squaresdk/agent/stellar`: the hired agent's side of a job on Stellar
 * (#29). It sits beside the EVM agent while the port is in progress and
 * depends only on `@squaresdk/core/stellar`.
 */
export { createProviderAgent, ProviderAgent, type JobHandler, type PassReport, type ProviderAgentOptions } from "./provider.js";
