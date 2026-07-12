import type { FastifyInstance } from "fastify";
import {
  PairStartRequest,
  PairStartResponse,
  PairStatusQuery,
  type PairStatus,
  type PairStatusResponse,
} from "@nightqueue/protocol";
import type { AppContext } from "../context";
import { displayCode, pkcePair, randomToken, sha256, uuid } from "../crypto";

const PAIRING_TTL_MS = 10 * 60 * 1000;

const SPOTIFY_AUTHORIZE = "https://accounts.spotify.com/authorize";
const SPOTIFY_TOKEN = "https://accounts.spotify.com/api/token";
const SPOTIFY_ME = "https://api.spotify.com/v1/me";

function page(title: string, body: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>body{font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem;line-height:1.5}code{font-size:1.4rem;background:#eee;padding:.2rem .5rem;border-radius:.3rem}a.button{display:inline-block;margin-top:1rem;padding:.6rem 1.2rem;background:#1db954;color:#fff;border-radius:2rem;text-decoration:none}</style></head><body>${body}</body></html>`;
}

export function registerPairing(app: FastifyInstance, ctx: AppContext): void {
  const redirectUri = `${ctx.config.PUBLIC_BASE_URL}/pair/callback`;

  app.post("/pair/start", async (request, reply) => {
    const parsed = PairStartRequest.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ code: "bad_request", message: "Invalid body." });
    const pairingId = uuid();
    const code = displayCode();
    const expiresAt = new Date(Date.now() + PAIRING_TTL_MS).toISOString();
    ctx.store.createPairing({ pairingId, secretHash: parsed.data.secretHash, displayCode: code, expiresAt });
    ctx.logger.info({ pairingId }, "pairing started");
    const response: PairStartResponse = { pairingId, displayCode: code, expiresAt };
    return reply.send(response);
  });

  app.get("/pair/status", async (request, reply) => {
    const parsed = PairStatusQuery.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ code: "bad_request", message: "Invalid query." });
    const session = ctx.store.getPairing(parsed.data.pairingId);
    if (!session) return reply.code(404).send({ code: "not_found", message: "Unknown pairing." });

    const linked = Boolean(session.discord_user_id && session.spotify_account_id);
    const claimed = session.token_claimed === 1;
    const expired = !linked && !claimed && Date.parse(session.expires_at) < Date.now();
    const status: PairStatus = claimed || linked ? "linked" : expired ? "expired" : "pending";

    const secret = request.headers["x-pair-secret"];
    if (
      linked &&
      !claimed &&
      typeof secret === "string" &&
      sha256(secret) === session.secret_hash &&
      session.discord_user_id &&
      session.spotify_account_id
    ) {
      const deviceToken = randomToken();
      ctx.store.createToken(session.discord_user_id, deviceToken);
      ctx.store.linkAccount(session.discord_user_id, session.spotify_account_id);
      ctx.store.claimDeviceToken(session.pairing_id);
      ctx.logger.info({ pairingId: session.pairing_id }, "device token issued");
      const response: PairStatusResponse = { status: "linked", deviceToken };
      return reply.send(response);
    }
    const response: PairStatusResponse = { status };
    return reply.send(response);
  });

  app.get("/pair/callback", async (request, reply) => {
    const query = request.query as { code?: string; state?: string };
    if (!query.code || !query.state)
      return reply.type("text/html").send(page("Pairing", "<p>Missing authorization parameters.</p>"));
    const session = ctx.store.getPairingByState(query.state);
    if (!session?.pkce_verifier)
      return reply.type("text/html").send(page("Pairing", "<p>Pairing session not found or expired.</p>"));

    const tokenRes = await fetch(SPOTIFY_TOKEN, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: query.code,
        redirect_uri: redirectUri,
        client_id: ctx.config.SPOTIFY_CLIENT_ID,
        code_verifier: session.pkce_verifier,
      }),
    });
    if (!tokenRes.ok) {
      ctx.logger.warn({ pairingId: session.pairing_id, status: tokenRes.status }, "spotify token exchange failed");
      return reply.type("text/html").send(page("Pairing", "<p>Spotify authorization failed.</p>"));
    }
    const { access_token: accessToken } = (await tokenRes.json()) as { access_token?: string };
    const meRes = accessToken
      ? await fetch(SPOTIFY_ME, { headers: { authorization: `Bearer ${accessToken}` } })
      : null;
    if (!meRes?.ok)
      return reply.type("text/html").send(page("Pairing", "<p>Could not read your Spotify profile.</p>"));
    const me = (await meRes.json()) as { id: string };

    ctx.store.completePairingSpotify(session.pairing_id, me.id);
    ctx.logger.info({ pairingId: session.pairing_id }, "spotify linked");
    return reply
      .type("text/html")
      .send(page("Paired", "<h1>All set</h1><p>You can close this window and return to Spotify.</p>"));
  });

  app.get("/pair/:pairingId", async (request, reply) => {
    const { pairingId } = request.params as { pairingId: string };
    const session = ctx.store.getPairing(pairingId);
    if (!session || Date.parse(session.expires_at) < Date.now())
      return reply.type("text/html").send(page("Pairing", "<p>This pairing link is invalid or expired.</p>"));

    const { verifier, challenge } = pkcePair();
    const state = uuid();
    ctx.store.setPairingPkce(pairingId, verifier, state);
    const authorize = `${SPOTIFY_AUTHORIZE}?${new URLSearchParams({
      response_type: "code",
      client_id: ctx.config.SPOTIFY_CLIENT_ID,
      redirect_uri: redirectUri,
      state,
      code_challenge_method: "S256",
      code_challenge: challenge,
    })}`;

    return reply.type("text/html").send(
      page(
        "Pair NightQueue",
        `<h1>Link your account</h1>
         <p>In Discord, run:</p>
         <p><code>/link ${session.display_code}</code></p>
         <p>Then connect Spotify to finish:</p>
         <a class="button" href="${authorize}">Connect Spotify</a>`,
      ),
    );
  });
}
