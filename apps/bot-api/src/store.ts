import type { Db } from "./db";
import { sha256 } from "./crypto";

const now = () => new Date().toISOString();

export interface PairingSession {
  pairing_id: string;
  secret_hash: string;
  display_code: string;
  expires_at: string;
  discord_user_id: string | null;
  spotify_account_id: string | null;
  pkce_verifier: string | null;
  oauth_state: string | null;
  token_claimed: number;
}

export function createStore(db: Db) {
  return {
    linkAccount(discordUserId: string, spotifyAccountId: string): void {
      db.query(
        `INSERT INTO account_links (discord_user_id, spotify_account_id, created_at)
         VALUES ($u, $s, $t)
         ON CONFLICT(discord_user_id) DO UPDATE SET spotify_account_id = $s`,
      ).run({ $u: discordUserId, $s: spotifyAccountId, $t: now() });
    },

    createToken(discordUserId: string, rawToken: string): void {
      db.query(
        `INSERT INTO device_tokens (token_hash, discord_user_id, created_at) VALUES ($h, $u, $t)`,
      ).run({ $h: sha256(rawToken), $u: discordUserId, $t: now() });
    },

    resolveToken(rawToken: string): string | null {
      const row = db
        .query<{ discord_user_id: string }, { $h: string }>(
          `SELECT discord_user_id FROM device_tokens WHERE token_hash = $h AND revoked = 0`,
        )
        .get({ $h: sha256(rawToken) });
      if (!row) return null;
      db.query(`UPDATE device_tokens SET last_used = $t WHERE token_hash = $h`).run({
        $t: now(),
        $h: sha256(rawToken),
      });
      return row.discord_user_id;
    },

    createPairing(session: {
      pairingId: string;
      secretHash: string;
      displayCode: string;
      expiresAt: string;
    }): void {
      db.query(
        `INSERT INTO pairing_sessions (pairing_id, secret_hash, display_code, expires_at, created_at)
         VALUES ($id, $h, $c, $e, $t)`,
      ).run({
        $id: session.pairingId,
        $h: session.secretHash,
        $c: session.displayCode,
        $e: session.expiresAt,
        $t: now(),
      });
    },

    getPairing(pairingId: string): PairingSession | null {
      return db
        .query<PairingSession, { $id: string }>(
          `SELECT * FROM pairing_sessions WHERE pairing_id = $id`,
        )
        .get({ $id: pairingId });
    },

    getPairingByCode(code: string): PairingSession | null {
      return db
        .query<PairingSession, { $c: string }>(
          `SELECT * FROM pairing_sessions WHERE display_code = $c`,
        )
        .get({ $c: code });
    },

    getPairingByState(state: string): PairingSession | null {
      return db
        .query<PairingSession, { $s: string }>(
          `SELECT * FROM pairing_sessions WHERE oauth_state = $s`,
        )
        .get({ $s: state });
    },

    setPairingDiscord(pairingId: string, discordUserId: string): void {
      db.query(`UPDATE pairing_sessions SET discord_user_id = $u WHERE pairing_id = $id`).run({
        $u: discordUserId,
        $id: pairingId,
      });
    },

    setPairingPkce(pairingId: string, verifier: string, state: string): void {
      db.query(
        `UPDATE pairing_sessions SET pkce_verifier = $v, oauth_state = $s WHERE pairing_id = $id`,
      ).run({ $v: verifier, $s: state, $id: pairingId });
    },

    completePairingSpotify(pairingId: string, spotifyAccountId: string): void {
      db.query(
        `UPDATE pairing_sessions
         SET spotify_account_id = $s, pkce_verifier = NULL, oauth_state = NULL
         WHERE pairing_id = $id`,
      ).run({ $s: spotifyAccountId, $id: pairingId });
    },

    claimDeviceToken(pairingId: string): void {
      db.query(`UPDATE pairing_sessions SET token_claimed = 1 WHERE pairing_id = $id`).run({
        $id: pairingId,
      });
    },

    getIdempotent(requestId: string): string | null {
      const row = db
        .query<{ response_json: string }, { $id: string }>(
          `SELECT response_json FROM enqueue_idempotency WHERE request_id = $id`,
        )
        .get({ $id: requestId });
      return row?.response_json ?? null;
    },

    saveIdempotent(requestId: string, responseJson: string): void {
      db.query(
        `INSERT OR IGNORE INTO enqueue_idempotency (request_id, response_json, seen_at)
         VALUES ($id, $r, $t)`,
      ).run({ $id: requestId, $r: responseJson, $t: now() });
    },
  };
}

export type Store = ReturnType<typeof createStore>;
