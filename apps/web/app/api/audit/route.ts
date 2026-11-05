import { auditAccount, auditValue, presentCheck } from "core";
import { classifyWebTarget, type NetworkName } from "../../../lib/network";
import { takeAuditSlot } from "../../../lib/limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 2_000_000 + 2048;

export async function POST(request: Request): Promise<Response> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return Response.json({ error: "Request body is too large." }, { status: 413 });
  }
  let body: { target?: unknown; network?: unknown };
  try {
    body = (await request.json()) as { target?: unknown; network?: unknown };
  } catch {
    return Response.json({ error: "Send JSON with a target string." }, { status: 400 });
  }
  if (typeof body.target !== "string") {
    return Response.json({ error: "target must be a NEAR account id or a JSON document." }, { status: 400 });
  }
  const classified = classifyWebTarget(body.target);
  if (classified.kind === "reject") {
    return Response.json({ error: classified.reason }, { status: 400 });
  }
  if (!takeAuditSlot()) {
    return Response.json(
      { error: "Too many audits from this server. Wait a minute and retry." },
      { status: 429, headers: { "retry-after": "60" } },
    );
  }
  const network: NetworkName | undefined =
    body.network === "testnet" || body.network === "mainnet" ? body.network : undefined;
  try {
    const report =
      classified.kind === "json"
        ? await auditJson(body.target, network)
        : await auditAccount(classified.accountId, network ? { network } : {});
    return Response.json(presentCheck(report));
  } catch (error) {
    return Response.json({ error: publicError(error) }, { status: 400 });
  }
}

async function auditJson(target: string, network?: NetworkName) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(target.trim()) as unknown;
  } catch {
    throw new Error("Pasted JSON could not be parsed.");
  }
  return auditValue(parsed, { network, label: "pasted-json" });
}

function publicError(error: unknown): string {
  const message = error instanceof Error ? error.message : "The audit failed.";
  if (/EACCES|EPERM|ENOENT|EISDIR|ENOTDIR/.test(message)) return "The audit failed.";
  const cleaned = message.replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  return cleaned.slice(0, 300) || "The audit failed.";
}
