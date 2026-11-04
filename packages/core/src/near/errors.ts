import type { Network } from "../types.js";

export class AccountNotFoundError extends Error {
  readonly accountId: string;
  readonly network: Network;

  constructor(accountId: string, network: Network) {
    super(`No NEAR account "${accountId}" on ${network}.`);
    this.name = "AccountNotFoundError";
    this.accountId = accountId;
    this.network = network;
  }
}
