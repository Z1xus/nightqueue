import { z } from "zod";

export const PairStartRequest = z.object({
  secretHash: z.string().regex(/^[a-f0-9]{64}$/, "expected sha-256 hex digest"),
});

export const PairStartResponse = z.object({
  pairingId: z.uuid(),
  displayCode: z.string(),
  expiresAt: z.iso.datetime(),
});

export const PairStatusQuery = z.object({
  pairingId: z.uuid(),
});

export const PairStatus = z.enum(["pending", "linked", "expired"]);

export const PairStatusResponse = z.object({
  status: PairStatus,
  deviceToken: z.string().optional(),
});

export type PairStartRequest = z.infer<typeof PairStartRequest>;
export type PairStartResponse = z.infer<typeof PairStartResponse>;
export type PairStatusQuery = z.infer<typeof PairStatusQuery>;
export type PairStatus = z.infer<typeof PairStatus>;
export type PairStatusResponse = z.infer<typeof PairStatusResponse>;
