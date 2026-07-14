import type { Client } from "discord.js";
import type { Logger } from "pino";
import { Constants } from "shoukaku";
import type { Player, Shoukaku, Track } from "shoukaku";
import type { Resolver, ResolvedTrack, TrackRequest } from "@nightqueue/protocol";
import type { Db } from "./db";

const CONFIDENCE_THRESHOLD = 0.75;
const MAX_RETRIES = 3;

export type EnqueueMode = "append" | "next" | "now";

export interface QueueTrack {
  encoded: string;
  title: string;
  author: string;
  durationMs: number;
  uri?: string;
  requestedBy: string;
  lowConfidence: boolean;
  request?: TrackRequest;
}

interface GuildState {
  guildId: string;
  voiceChannelId: string | null;
  textChannelId: string | null;
  volume: number;
  current: QueueTrack | null;
  queue: QueueTrack[];
  player: Player | null;
  retries: number;
  faulted: boolean;
}

export function trackFromLavalink(track: Track, requestedBy: string): QueueTrack {
  return {
    encoded: track.encoded,
    title: track.info.title,
    author: track.info.author,
    durationMs: track.info.length,
    uri: track.info.uri,
    requestedBy,
    lowConfidence: false,
  };
}

export function trackFromResolved(
  resolved: ResolvedTrack,
  request: TrackRequest | undefined,
  requestedBy: string,
): QueueTrack {
  return {
    encoded: resolved.encoded,
    title: resolved.metadata.title,
    author: resolved.metadata.artists.join(", "),
    durationMs: resolved.metadata.durationMs,
    uri: resolved.metadata.url,
    requestedBy,
    lowConfidence: resolved.confidence < CONFIDENCE_THRESHOLD,
    request,
  };
}

interface Deps {
  shoukaku: Shoukaku;
  db: Db;
  resolver: Resolver;
  client: Client;
  logger: Logger;
}

export class QueueManager {
  private readonly states = new Map<string, GuildState>();

  constructor(private readonly deps: Deps) {}

  get(guildId: string): GuildState | undefined {
    return this.states.get(guildId);
  }

  private getOrCreate(guildId: string): GuildState {
    let state = this.states.get(guildId);
    if (!state) {
      state = {
        guildId,
        voiceChannelId: null,
        textChannelId: null,
        volume: 100,
        current: null,
        queue: [],
        player: null,
        retries: 0,
        faulted: false,
      };
      this.states.set(guildId, state);
    }
    return state;
  }

  private async ensurePlayer(state: GuildState, voiceChannelId: string): Promise<void> {
    const connection = this.deps.shoukaku.connections.get(state.guildId);
    const connected =
      connection?.state === Constants.State.CONNECTED && connection?.channelId === voiceChannelId;
    if (connected && state.player) return;
    state.voiceChannelId = voiceChannelId;
    if (connection) await this.deps.shoukaku.leaveVoiceChannel(state.guildId);
    const player = await this.deps.shoukaku.joinVoiceChannel({
      guildId: state.guildId,
      channelId: voiceChannelId,
      shardId: 0,
      deaf: true, // good bots don't listen in on human convos :p
    });
    state.player = player;
    await player.setGlobalVolume(state.volume);
    this.attach(state, player);
    if (state.current) await this.playTrack(state, state.current);
  }

  private attach(state: GuildState, player: Player): void {
    player.removeAllListeners("end");
    player.removeAllListeners("stuck");
    player.removeAllListeners("exception");
    player.on("end", (event) => {
      if (event.reason === "loadFailed" || (event.reason === "finished" && state.faulted))
        void this.onLoadFailed(state);
      else if (event.reason === "finished") void this.advance(state);
    });
    player.on("stuck", () => void this.advance(state));
    player.on("exception", (event) => {
      state.faulted = true;
      this.deps.logger.warn({ guildId: state.guildId, cause: event.exception.severity }, "track exception");
    });
  }

  private async playTrack(state: GuildState, track: QueueTrack): Promise<void> {
    state.faulted = false;
    state.current = track;
    await state.player?.playTrack({ track: { encoded: track.encoded } });
    this.persist(state);
  }

  private async advance(state: GuildState): Promise<void> {
    state.retries = 0;
    const next = state.queue.shift();
    if (!next) {
      state.current = null;
      await state.player?.stopTrack().catch(() => {});
      this.persist(state);
      return;
    }
    await this.playTrack(state, next);
  }

  private async onLoadFailed(state: GuildState): Promise<void> {
    const current = state.current;
    if (current?.request && state.retries < MAX_RETRIES) {
      state.retries += 1;
      await this.deps.resolver.invalidate(current.request);
      const retried = await this.deps.resolver.resolve(current.request);
      if (retried) {
        await this.playTrack(state, trackFromResolved(retried, current.request, current.requestedBy));
        return;
      }
    }
    this.deps.logger.warn({ guildId: state.guildId, title: current?.title }, "skipping unplayable track");
    await this.advance(state);
  }

  async enqueue(
    guildId: string,
    voiceChannelId: string,
    textChannelId: string | null,
    tracks: QueueTrack[],
    mode: EnqueueMode,
  ): Promise<void> {
    const state = this.getOrCreate(guildId);
    if (textChannelId) state.textChannelId = textChannelId;
    await this.ensurePlayer(state, voiceChannelId);
    if (mode === "append") state.queue.push(...tracks);
    else state.queue.unshift(...tracks);
    if (mode === "now" || !state.current) await this.advance(state);
    else this.persist(state);
  }

  async skip(state: GuildState): Promise<void> {
    await this.advance(state);
  }

  async pause(state: GuildState): Promise<void> {
    await state.player?.setPaused(true);
  }

  async resume(state: GuildState): Promise<void> {
    await state.player?.setPaused(false);
  }

  async stop(state: GuildState): Promise<void> {
    state.queue = [];
    state.current = null;
    await state.player?.stopTrack().catch(() => {});
    this.persist(state);
  }

  remove(state: GuildState, position: number): QueueTrack | null {
    if (position < 1 || position > state.queue.length) return null;
    return state.queue.splice(position - 1, 1)[0] ?? null;
  }

  move(state: GuildState, from: number, to: number): boolean {
    const size = state.queue.length;
    if (from < 1 || from > size || to < 1 || to > size) return false;
    const [item] = state.queue.splice(from - 1, 1);
    if (!item) return false;
    state.queue.splice(to - 1, 0, item);
    this.persist(state);
    return true;
  }

  clear(state: GuildState): void {
    state.queue = [];
    this.persist(state);
  }

  async setVolume(state: GuildState, volume: number): Promise<void> {
    state.volume = volume;
    await state.player?.setGlobalVolume(volume);
    this.persist(state);
  }

  async onExternalDisconnect(guildId: string): Promise<void> {
    const state = this.states.get(guildId);
    if (state) {
      if (state.current) state.queue.unshift(state.current);
      state.current = null;
      state.player = null;
      this.persist(state);
    }
    await this.deps.shoukaku.leaveVoiceChannel(guildId).catch(() => {});
  }

  async disconnect(guildId: string): Promise<void> {
    const state = this.states.get(guildId);
    if (state) {
      state.queue = [];
      state.current = null;
      state.player = null;
      this.persist(state);
    }
    await this.deps.shoukaku.leaveVoiceChannel(guildId).catch(() => {});
  }

  private persist(state: GuildState): void {
    const items = state.current ? [state.current, ...state.queue] : [...state.queue];
    const tx = this.deps.db.transaction(() => {
      this.deps.db
        .query(
          `INSERT INTO guild_settings (guild_id, voice_channel_id, text_channel_id, volume)
           VALUES ($g, $v, $t, $vol)
           ON CONFLICT(guild_id) DO UPDATE SET voice_channel_id = $v, text_channel_id = $t, volume = $vol`,
        )
        .run({
          $g: state.guildId,
          $v: state.voiceChannelId,
          $t: state.textChannelId,
          $vol: state.volume,
        });
      this.deps.db.query(`DELETE FROM queue_items WHERE guild_id = $g`).run({ $g: state.guildId });
      const insert = this.deps.db.query(
        `INSERT INTO queue_items (guild_id, position, encoded, title, author, duration_ms, uri, requested_by, low_confidence, request_json)
         VALUES ($g, $p, $e, $ti, $a, $d, $u, $r, $lc, $rq)`,
      );
      items.forEach((item, index) =>
        insert.run({
          $g: state.guildId,
          $p: index,
          $e: item.encoded,
          $ti: item.title,
          $a: item.author,
          $d: item.durationMs,
          $u: item.uri ?? null,
          $r: item.requestedBy,
          $lc: item.lowConfidence ? 1 : 0,
          $rq: item.request ? JSON.stringify(item.request) : null,
        }),
      );
    });
    tx();
  }

  persistAll(): void {
    for (const state of this.states.values()) this.persist(state);
  }

  async restore(): Promise<void> {
    const settings = this.deps.db
      .query<
        { guild_id: string; voice_channel_id: string | null; text_channel_id: string | null; volume: number },
        []
      >(`SELECT guild_id, voice_channel_id, text_channel_id, volume FROM guild_settings`)
      .all();

    for (const row of settings) {
      const items = this.deps.db
        .query<
          {
            encoded: string;
            title: string;
            author: string;
            duration_ms: number;
            uri: string | null;
            requested_by: string;
            low_confidence: number;
            request_json: string | null;
          },
          { $g: string }
        >(
          `SELECT encoded, title, author, duration_ms, uri, requested_by, low_confidence, request_json
           FROM queue_items WHERE guild_id = $g ORDER BY position ASC`,
        )
        .all({ $g: row.guild_id });

      const tracks: QueueTrack[] = items.map((item) => ({
        encoded: item.encoded,
        title: item.title,
        author: item.author,
        durationMs: item.duration_ms,
        uri: item.uri ?? undefined,
        requestedBy: item.requested_by,
        lowConfidence: item.low_confidence === 1,
        request: item.request_json ? (JSON.parse(item.request_json) as TrackRequest) : undefined,
      }));

      const state = this.getOrCreate(row.guild_id);
      state.voiceChannelId = row.voice_channel_id;
      state.textChannelId = row.text_channel_id;
      state.volume = row.volume;
      state.queue = tracks;

      if (tracks.length === 0 || !row.voice_channel_id) continue;
      if (!this.hasListeners(row.guild_id, row.voice_channel_id)) continue;

      const first = state.queue.shift();
      if (first) {
        await this.ensurePlayer(state, row.voice_channel_id);
        await this.playTrack(state, first);
      }
    }
  }

  private hasListeners(guildId: string, channelId: string): boolean {
    const guild = this.deps.client.guilds.cache.get(guildId);
    const channel = guild?.channels.cache.get(channelId);
    if (!channel || !channel.isVoiceBased()) return false;
    return channel.members.filter((member) => !member.user.bot).size > 0;
  }
}
