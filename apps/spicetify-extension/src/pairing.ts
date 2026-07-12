import type {
  PairStartRequest,
  PairStartResponse,
  PairStatusResponse,
} from "@nightqueue/protocol";
import { settings } from "./settings";

const POLL_INTERVAL_MS = 3000;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const toHex = (bytes: Uint8Array) =>
  [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return toHex(new Uint8Array(digest));
}

export async function connectAccount(): Promise<void> {
  const secret = toHex(crypto.getRandomValues(new Uint8Array(32)));
  const base = settings.backendUrl();

  const startBody: PairStartRequest = { secretHash: await sha256Hex(secret) };
  const startRes = await fetch(`${base}/pair/start`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(startBody),
  });
  if (!startRes.ok) throw new Error("could not start pairing");
  const { pairingId, displayCode, expiresAt } = (await startRes.json()) as PairStartResponse;

  window.open(`${base}/pair/${pairingId}`, "_blank");
  Spicetify.showNotification(`nightqueue: run /link ${displayCode} in Discord`);

  const deadline = new Date(expiresAt).getTime();
  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);
    const res = await fetch(`${base}/pair/status?pairingId=${pairingId}`, {
      headers: { "x-pair-secret": secret },
    });
    if (!res.ok) continue;
    const status = (await res.json()) as PairStatusResponse;
    if (status.status === "linked" && status.deviceToken) {
      settings.setDeviceToken(status.deviceToken);
      Spicetify.showNotification("nightqueue: account connected");
      return;
    }
    if (status.status === "expired") break;
  }
  Spicetify.showNotification("nightqueue: pairing expired", true);
}
