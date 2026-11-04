import { auditTarget, presentCheck } from "core";
import { detectNetwork, type NetworkName } from "../../../lib/network";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  let body: { target?: unknown; network?: unknown };
  try {
    body = (await request.json()) as { target?: unknown; network?: unknown };
  } catch {
    return Response.json({ error: "Send JSON with a target string." }, { status: 400 });
  }
  if (typeof body.target !== "string" || body.target.trim().length === 0) {
    return Response.json({ error: "target must be a NEAR account or JSON text." }, { status: 400 });
  }
  const network = body.network === "testnet" || body.network === "mainnet" ? body.network : infer(body.target);
  try {
    const report = await auditTarget(body.target, network ? { network } : {});
    return Response.json(presentCheck(report));
  } catch (error) {
    const message = error instanceof Error ? error.message : "The audit failed.";
    return Response.json({ error: message }, { status: 400 });
  }
}

function infer(target: string): NetworkName | undefined {
  const trimmed = target.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return undefined;
  return detectNetwork(trimmed) ?? undefined;
}
