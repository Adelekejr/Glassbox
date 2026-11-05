import {
  PHALA_PCCS_URL,
  Quote,
  QuoteVerifier,
  getCollateral,
  type Collateral,
  type Report as ParsedQuoteReport,
  type TDReport10,
} from "@phala/dcap-qvl";
import type { Measurements } from "../types.js";

export interface TdxVerification {
  ok: boolean;
  status?: string;
  advisoryIds: string[];
  debug: boolean | null;
  reportData: string | null;
  measurements: Measurements | null;
  error?: string;
}

const MAX_QUOTE_BYTES = 256 * 1024;

export function quoteBytes(quoteHex: string): Buffer {
  const hex = quoteHex.trim().replace(/^0x/, "");
  if (hex.length === 0 || hex.length > MAX_QUOTE_BYTES * 2) {
    throw new Error("Quote hex length is outside the accepted range.");
  }
  if (hex.length % 2 !== 0) throw new Error("Quote hex has an odd length.");
  if (!/^[0-9a-fA-F]+$/.test(hex)) throw new Error("Quote hex has a non-hex character.");
  return Buffer.from(hex, "hex");
}

function rejected(error: string): TdxVerification {
  return { ok: false, advisoryIds: [], debug: null, reportData: null, measurements: null, error };
}

export function verifyQuoteAt(quoteHex: string, collateral: unknown, nowSecs: number): TdxVerification {
  let raw: Buffer;
  let parsed: ReturnType<typeof Quote.parse>;
  try {
    raw = quoteBytes(quoteHex);
    parsed = Quote.parse(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return rejected(message);
  }
  let debug = readDebug(parsed.report);
  const reportData = readReportData(parsed.report);
  const measurements = readMeasurements(parsed.report);
  let normalized: Collateral;
  try {
    normalized = normalizeCollateral(collateral);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return rejected(message);
  }
  const verifiedAt = Number.isFinite(nowSecs) ? nowSecs : 0;
  try {
    const verifier = new QuoteVerifier();
    if (debug) verifier.allowDebug(true);
    const result = verifier.verify(raw, normalized, verifiedAt);
    debug = readDebug(result.report) ?? debug;
    return {
      ok: true,
      status: result.status,
      advisoryIds: result.advisory_ids ?? [],
      debug,
      reportData: readReportData(result.report) ?? reportData,
      measurements: readMeasurements(result.report) ?? measurements,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/debug mode/i.test(message) && debug !== true) {
      try {
        const verifier = new QuoteVerifier().allowDebug(true);
        const result = verifier.verify(raw, normalized, verifiedAt);
        return {
          ok: true,
          status: result.status,
          advisoryIds: result.advisory_ids ?? [],
          debug: true,
          reportData: readReportData(result.report) ?? reportData,
          measurements: readMeasurements(result.report) ?? measurements,
        };
      } catch (retryError) {
        const retryMessage = retryError instanceof Error ? retryError.message : String(retryError);
        return rejected(retryMessage);
      }
    }
    return rejected(message);
  }
}

export async function fetchFreshCollateral(quoteHex: string): Promise<unknown> {
  return getCollateral(PHALA_PCCS_URL, quoteBytes(quoteHex));
}

export function pccsUrl(): string {
  return PHALA_PCCS_URL;
}

function normalizeCollateral(collateral: unknown): Collateral {
  let value = collateral;
  if (typeof value === "string") value = JSON.parse(value) as unknown;
  if (!value || typeof value !== "object") throw new Error("Collateral was not a JSON object.");
  return value as Collateral;
}

function td10Of(report: ParsedQuoteReport): TDReport10 | null {
  return report.asTd10() ?? report.asTd15()?.base ?? report.asTd15Ex()?.base.base ?? null;
}

function readDebug(report: ParsedQuoteReport): boolean | null {
  const sgx = report.asSgx();
  if (sgx) return (sgx.attributes[0] & 0x02) !== 0;
  const td = td10Of(report);
  if (!td) return null;
  // Intel TDX TUD.DEBUG is bit 0 of the first little-endian attributes byte.
  return (td.tdAttributes[0] & 0x01) !== 0;
}

function readReportData(report: ParsedQuoteReport): string | null {
  const bytes = td10Of(report)?.reportData ?? report.asSgx()?.reportData;
  if (!bytes) return null;
  return Buffer.from(bytes).toString("utf8").replace(/\0+$/g, "");
}

function readMeasurements(report: ParsedQuoteReport): Measurements | null {
  const td = td10Of(report);
  if (!td) return null;
  const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString("hex");
  return {
    mrtd: hex(td.mrTd),
    rtmr0: hex(td.rtMr0),
    rtmr1: hex(td.rtMr1),
    rtmr2: hex(td.rtMr2),
    rtmr3: hex(td.rtMr3),
  };
}
