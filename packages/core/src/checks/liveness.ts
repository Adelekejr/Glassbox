import { randomBytes } from "node:crypto";
import type { LiveObservation } from "../types.js";

const HOST_SUFFIXES = [".phala.network", ".phala.com"];

/**
 * A live guest URL is contacted only when it is https on a Phala host.
 * Anything else is refused without a fetch. Phala blocks public guest-agent
 * routes by default, so a failed attempt stays not proven.
 */
export function liveEndpointAllowed(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") return false;
  if (parsed.username || parsed.password) return false;
  const host = parsed.hostname.toLowerCase();
  if (!host || host === "localhost" || host.endsWith(".localhost")) return false;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":")) return false;
  return HOST_SUFFIXES.some((suffix) => host.endsWith(suffix) && host.length > suffix.length);
}

export function unattemptedLiveObservation(): LiveObservation {
  return {
    attempted: false,
    reachable: false,
    detail:
      "No live guest endpoint was named. Phala blocks public guest-agent routes by default. Glassbox did not send a nonce. A registration is not a live process. Proven at registration only.",
  };
}

export async function probeLiveGuest(
  url: string,
  fetchImpl: typeof fetch = fetch,
): Promise<LiveObservation> {
  if (!liveEndpointAllowed(url)) {
    return {
      attempted: false,
      reachable: false,
      detail:
        "A live URL was offered, and it is not https on a phala.network or phala.com host. Glassbox did not contact it. Live observation is not proven. Proven at registration only.",
    };
  }
  const nonce = randomBytes(16).toString("hex");
  const target = new URL(url);
  target.searchParams.set("nonce", nonce);
  let host = target.hostname;
  try {
    const response = await fetchImpl(target.toString(), {
      method: "GET",
      redirect: "error",
      signal: AbortSignal.timeout(2000),
      headers: { accept: "application/json" },
    });
    host = new URL(response.url || target.toString()).hostname || host;
    if (!response.ok) {
      return {
        attempted: true,
        reachable: false,
        detail: `A nonce was sent to ${host} and the endpoint answered HTTP ${response.status}. Phala often blocks public guest-agent routes. Live observation is not proven. Proven at registration only.`,
      };
    }
    return {
      attempted: true,
      reachable: true,
      detail: `A nonce was sent to ${host} and the endpoint answered. Glassbox did not treat that answer as the registered configuration. Live observation of the guest is not proven. Proven at registration only.`,
    };
  } catch {
    return {
      attempted: true,
      reachable: false,
      detail: `A nonce was sent to ${host} and the endpoint did not answer. Phala often blocks public guest-agent routes. Live observation is not proven. Proven at registration only.`,
    };
  }
}
