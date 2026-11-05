import { EMPTY_CONTRACT_CODE_HASH, matchShadeTemplate, SHADE_CONTRACT_TEMPLATES } from "../data/shade-templates.js";
import type { AccessKeyView, ApprovalEvent, Ladder, ShadeKind } from "../types.js";

export const CHANGE_METHOD_NAMES = [
  "approve_codehash",
  "remove_codehash",
  "approve_measurements",
  "remove_measurements",
] as const;

export interface ContractRow {
  id: string;
  ladder: Ladder;
  title: string;
  inference: boolean;
  plainEnglish: string;
  evidence: { label: string; detail?: string }[];
}

const APPROVE_METHODS = ["approve_codehash", "approve_measurements"] as const;

export function relevantApproveMethods(shade: ShadeKind): string[] {
  switch (shade) {
    case "shade-v1":
    case "shade-v1-worker":
      return ["approve_codehash"];
    case "shade-v2":
    case "measurements-registry":
      return ["approve_measurements"];
    case "mpc-signer":
      return [];
    default:
      return [...APPROVE_METHODS];
  }
}

export function relevantRemoveMethods(shade: ShadeKind): string[] {
  switch (shade) {
    case "shade-v1":
    case "shade-v1-worker":
      return ["remove_codehash"];
    case "shade-v2":
    case "measurements-registry":
      return ["remove_measurements"];
    case "mpc-signer":
      return [];
    default:
      return ["remove_codehash", "remove_measurements"];
  }
}

export function assessApprover(input: {
  shade: ShadeKind;
  target: string;
  ownerId?: string | null;
  accessKeys?: AccessKeyView[];
  accessKeyError?: string;
  approvalHistory?: ApprovalEvent[];
  historyLoaded: boolean;
}): ContractRow {
  const methods = relevantApproveMethods(input.shade);
  const evidence: ContractRow["evidence"] = [];
  if (input.ownerId) evidence.push({ label: "owner", detail: input.ownerId });
  if (methods.length === 0) {
    return row(
      "contract.approver",
      "NOT_PROVEN",
      "Who can call approve_codehash or approve_measurements was not proven",
      "This account is an MPC docker allowlist. approve_codehash and approve_measurements are not part of that interface, so who can call them was not proven.",
      evidence,
    );
  }
  const methodList = methods.join(" and ");
  const signers = approveSigners(input.approvalHistory, methods);
  if (input.historyLoaded) {
    evidence.push({
      label: "indexed approve signers",
      detail: signers.length > 0 ? signers.join(", ") : "none in the indexed history",
    });
  }
  if (signers.length > 1) {
    return row(
      "contract.approver",
      "RISKY",
      `Indexed ${methodList} calls come from more than one account`,
      `Indexed history shows successful ${methodList} calls signed by ${signers.join(", ")}. That is broader than a single signer in the index. ${ownerSentence(input)} The index can be incomplete. This is history of the registered contract, not a live observation.`,
      evidence,
    );
  }
  if (input.accessKeyError) {
    return row(
      "contract.approver",
      "NOT_PROVEN",
      `Who can call ${methodList} was not proven`,
      `The access-key list could not be read (${input.accessKeyError}). ${ownerSentence(input)} Who can call ${methodList} was not proven.`,
      evidence,
    );
  }
  if (!input.ownerId) {
    const keys = input.accessKeys ? describeKeys(input.accessKeys, input.target, methods) : null;
    const keySentence = keys
      ? `The account has ${keys.fullAccess} full-access key${keys.fullAccess === 1 ? "" : "s"} and ${keys.approveCapable} key${keys.approveCapable === 1 ? "" : "s"} that can call ${methodList}.`
      : "No access-key list was loaded.";
    const history = signers.length === 1 ? ` Indexed history shows ${methodList} signed by ${signers[0]}.` : "";
    return row(
      "contract.approver",
      "NOT_PROVEN",
      `Who can call ${methodList} was not proven`,
      `No owner view was loaded, so the contract's own check for ${methodList} was not proven. ${keySentence}${history} A full-access key can change the contract. This is the registered key set when it was loaded, not a live observation.`,
      evidence,
    );
  }
  if (input.ownerId !== input.target) {
    const same = signers.length === 1 && signers[0] === input.ownerId;
    return row(
      "contract.approver",
      "NOT_PROVEN",
      `Who can call ${methodList} was not proven`,
      `The contract view names owner ${input.ownerId}. That account's keys were not read, so a single key versus a broader set is not proven.${same ? ` Indexed history shows ${methodList} signed by that owner. That does not prove the owner holds a single key.` : ""} This is not a live observation.`,
      evidence,
    );
  }
  if (!input.accessKeys) {
    return row(
      "contract.approver",
      "NOT_PROVEN",
      `Who can call ${methodList} was not proven`,
      `The contract view names this account as owner. No access-key list was loaded, so a single full-access key versus a broader set is not proven.`,
      evidence,
    );
  }
  const keys = describeKeys(input.accessKeys, input.target, methods);
  evidence.push({ label: "full-access keys", detail: String(keys.fullAccess) });
  evidence.push({ label: "approve-capable keys", detail: String(keys.approveCapable) });
  if (keys.fullAccess === 1 && keys.approveCapable === 1 && keys.singleIsFullAccess) {
    return row(
      "contract.approver",
      "PROVEN",
      `One full-access key can call ${methodList}`,
      `The contract view names this account as owner. One full-access key is on the account${keys.fullAccessId ? ` (${keys.fullAccessId})` : ""}. No other key on the account can call ${methodList}. That is a single full-access key, not a broader set. This is the registered key set, not a live observation.`,
      evidence,
    );
  }
  if (keys.approveCapable === 1 && !keys.singleIsFullAccess) {
    return row(
      "contract.approver",
      "PROVEN",
      `One function-call key can call ${methodList}`,
      `The contract view names this account as owner. One function-call key can call ${methodList}. No full-access key is on the account. That is a single key, not a broader set. This is the registered key set, not a live observation.`,
      evidence,
    );
  }
  if (keys.approveCapable > 1 || keys.fullAccess > 1) {
    return row(
      "contract.approver",
      "RISKY",
      `Who can call ${methodList} is broader than a single full-access key`,
      `The contract view names this account as owner. The account has ${keys.fullAccess} full-access key${keys.fullAccess === 1 ? "" : "s"} and ${keys.approveCapable} key${keys.approveCapable === 1 ? "" : "s"} that can call ${methodList}. That is broader than a single full-access key. This is the registered key set, not a live observation.`,
      evidence,
    );
  }
  return row(
    "contract.approver",
    "NOT_PROVEN",
    `Who can call ${methodList} was not proven`,
    `The contract view names this account as owner, and no key in the loaded list can call ${methodList}. A key that is not in this list is not proven absent.`,
    evidence,
  );
}

export function assessRemove(input: {
  shade: ShadeKind;
  changeMethods?: { name: string; exists: boolean }[];
  approvalHistory?: ApprovalEvent[];
  historyLoaded: boolean;
}): ContractRow {
  const methods = relevantRemoveMethods(input.shade);
  if (methods.length === 0) {
    return row(
      "contract.remove",
      "NOT_PROVEN",
      "remove_codehash and remove_measurements were not proven",
      "This account is an MPC docker allowlist. remove_codehash and remove_measurements are not part of that interface, so whether they exist was not proven here.",
    );
  }
  const parts = methods.map((method) => describeRemove(method, input));
  const ladders = parts.map((part) => part.ladder);
  const ladder: Ladder = ladders.includes("RISKY")
    ? "RISKY"
    : ladders.every((item) => item === "PROVEN")
      ? "PROVEN"
      : "NOT_PROVEN";
  const title =
    parts.length === 1
      ? parts[0]?.title ?? "Remove methods were not proven"
      : ladder === "NOT_PROVEN"
        ? "Remove methods were not fully proven"
        : parts.map((part) => part.title).join("; ");
  return row(
    "contract.remove",
    ladder,
    title,
    `${parts.map((part) => part.text).join(" ")} This is history of the registered contract when history was loaded, not a live observation.`,
    parts.flatMap((part) => part.evidence),
  );
}

export function assessContractCode(input: {
  codeHash?: string | null;
  globalContractHash?: string | null;
}): ContractRow {
  const known = SHADE_CONTRACT_TEMPLATES.map((item) => `${item.name} @ ${item.commit}`).join(", ");
  if (!input.codeHash) {
    return row(
      "contract.code",
      "NOT_PROVEN",
      "Contract code hash was not loaded",
      `No code_hash was loaded, so it was not compared with known Shade template hashes (${known}).`,
    );
  }
  if (input.codeHash === EMPTY_CONTRACT_CODE_HASH) {
    return row(
      "contract.code",
      "NOT_PROVEN",
      "Contract code hash is not a known Shade template",
      input.globalContractHash
        ? `The account's code_hash is empty and global_contract_hash is ${input.globalContractHash}. Glassbox does not have a published list of global Shade template hashes, so the match is not proven.`
        : "The account's code_hash is the empty contract hash. It does not match a known Shade template.",
      [{ label: "code_hash", detail: input.codeHash }],
    );
  }
  const match = matchShadeTemplate(input.codeHash);
  if (match) {
    return row(
      "contract.code",
      "PROVEN",
      "Contract code hash matches a known Shade template",
      `code_hash matches ${match.name} from shade-agent-framework commit ${match.commit} (sha256 ${match.sha256}). This is a comparison with that published wasm. It does not identify a guest image.`,
      [
        { label: "code_hash", detail: input.codeHash },
        { label: "template", detail: `${match.name} @ ${match.commit}` },
      ],
    );
  }
  return row(
    "contract.code",
    "NOT_PROVEN",
    "Contract code hash is not a known Shade template",
    `code_hash ${input.codeHash} does not match a known Shade template hash in this build (${known}). Other Shade contracts exist. A miss is not a judgement of the registered configuration.`,
    [{ label: "code_hash", detail: input.codeHash }],
  );
}

function describeRemove(
  method: string,
  input: {
    changeMethods?: { name: string; exists: boolean }[];
    approvalHistory?: ApprovalEvent[];
    historyLoaded: boolean;
  },
): { ladder: Ladder; title: string; text: string; evidence: ContractRow["evidence"] } {
  const probe = input.changeMethods?.find((item) => item.name === method);
  const calls = (input.approvalHistory ?? []).filter((event) => event.method === method && event.kind === "remove" && event.success);
  const evidence: ContractRow["evidence"] = [];
  if (probe) evidence.push({ label: method, detail: probe.exists ? "method name is present" : "MethodNotFound" });
  if (input.historyLoaded) evidence.push({ label: `${method} in indexed history`, detail: String(calls.length) });
  if (!probe && !input.historyLoaded) {
    return {
      ladder: "NOT_PROVEN",
      title: `${method} was not proven`,
      text: `Whether ${method} exists, and whether it appears in history, was not proven. This input did not include a method probe or approval history for it.`,
      evidence,
    };
  }
  if (calls.length > 0) {
    return {
      ladder: "PROVEN",
      title: `${method} appears in the indexed history`,
      text: `Indexed history includes ${calls.length} successful ${method} call${calls.length === 1 ? "" : "s"}.${probe ? (probe.exists ? ` A view probe found ${method}.` : ` A view probe returned MethodNotFound for ${method}.`) : " Whether the method is still on the account was not probed."}`,
      evidence,
    };
  }
  if (probe && !probe.exists && input.historyLoaded) {
    return {
      ladder: "PROVEN",
      title: `${method} is not on this account`,
      text: `A view probe returned MethodNotFound for ${method}. No ${method} calls were in the indexed history. MethodNotFound is the direct check. An empty index is not proof by itself.`,
      evidence,
    };
  }
  if (probe?.exists && input.historyLoaded) {
    return {
      ladder: "NOT_PROVEN",
      title: `${method} was not seen in the indexed history`,
      text: `A view probe found ${method}. No ${method} calls were in the indexed history. The index can be incomplete, so this is not proof the method was never called.`,
      evidence,
    };
  }
  if (probe && !probe.exists) {
    return {
      ladder: "PROVEN",
      title: `${method} is not on this account`,
      text: `A view probe returned MethodNotFound for ${method}. Approval history was not loaded, so whether ${method} appears in history was not proven. The method name itself is absent.`,
      evidence,
    };
  }
  return {
    ladder: "NOT_PROVEN",
    title: `${method} was not seen in the indexed history`,
    text: `No ${method} calls were in the indexed history. The method was not probed, and the index can be incomplete.`,
    evidence,
  };
}

function approveSigners(events: ApprovalEvent[] | undefined, methods: string[]): string[] {
  const names = new Set<string>();
  for (const event of events ?? []) {
    if (!event.success || !methods.includes(event.method) || !event.signer) continue;
    names.add(event.signer);
  }
  return [...names];
}

function describeKeys(keys: AccessKeyView[], contractId: string, methods: string[]): {
  fullAccess: number;
  approveCapable: number;
  singleIsFullAccess: boolean;
  fullAccessId?: string;
} {
  let fullAccess = 0;
  let approveCapable = 0;
  let fullAccessId: string | undefined;
  let onlyFull = true;
  for (const key of keys) {
    const permission = key.access_key?.permission;
    if (permission === "FullAccess") {
      fullAccess += 1;
      approveCapable += 1;
      fullAccessId = key.public_key;
      continue;
    }
    if (permission && typeof permission === "object" && "FunctionCall" in permission) {
      const call = permission.FunctionCall;
      if (call.receiver_id && call.receiver_id !== contractId) continue;
      const names = call.method_names ?? [];
      const can = names.length === 0 || names.some((name) => methods.includes(name));
      if (can) {
        approveCapable += 1;
        onlyFull = false;
      }
    }
  }
  return {
    fullAccess,
    approveCapable,
    singleIsFullAccess: approveCapable === 1 && fullAccess === 1 && onlyFull,
    fullAccessId: fullAccess === 1 ? fullAccessId : undefined,
  };
}

function ownerSentence(input: { ownerId?: string | null; target: string }): string {
  if (!input.ownerId) return "No owner view was loaded.";
  if (input.ownerId === input.target) return "The contract view names this account as owner.";
  return `The contract view names owner ${input.ownerId}.`;
}

function row(
  id: string,
  ladder: Ladder,
  title: string,
  plainEnglish: string,
  evidence: ContractRow["evidence"] = [],
): ContractRow {
  return { id, ladder, title, inference: false, plainEnglish, evidence };
}
