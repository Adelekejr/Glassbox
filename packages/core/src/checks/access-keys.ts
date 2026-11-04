import type { AccessKeyView, Ladder } from "../types.js";

export interface AccessKeyAssessment {
  ladder: Ladder;
  reasons: string[];
}

export function assessAccessKeys(keys: AccessKeyView[] | undefined, error?: string): AccessKeyAssessment {
  if (error) {
    return { ladder: "NOT_PROVEN", reasons: [`The access-key list could not be read: ${error}`] };
  }
  if (!keys) {
    return { ladder: "NOT_PROVEN", reasons: ["No access-key list was loaded."] };
  }
  if (keys.length === 0) {
    return { ladder: "NOT_PROVEN", reasons: ["The account returned an empty access-key list."] };
  }
  const reasons: string[] = [];
  for (const key of keys) {
    const permission = key.access_key?.permission;
    const id = key.public_key || "(unnamed key)";
    if (permission === "FullAccess") {
      reasons.push(
        `Full-access key ${id}. The holder can redeploy the contract and change what it accepts. The registered policy is not locked against this key.`,
      );
      continue;
    }
    if (permission && typeof permission === "object" && "FunctionCall" in permission) {
      const call = permission.FunctionCall;
      const methods = call.method_names ?? [];
      if (methods.length === 0) {
        reasons.push(
          `Function-call key ${id} allows any method on ${call.receiver_id || "its receiver"} because method_names is empty.`,
        );
      }
      if (call.allowance === null || call.allowance === undefined) {
        reasons.push(`Function-call key ${id} has an unlimited gas allowance.`);
      }
    }
  }
  if (reasons.length > 0) return { ladder: "RISKY", reasons };
  return {
    ladder: "PROVEN",
    reasons: [
      "Every access key is a function-call key with at least one named method and a finite gas allowance.",
    ],
  };
}
