import { z } from "zod";

export const ApiErrorCode = z.enum([
  "bad_request",
  "unauthorized",
  "forbidden",
  "not_found",
  "rate_limited",
  "conflict",
  "resolver_failed",
  "internal",
]);

export const ApiError = z.object({
  code: ApiErrorCode,
  message: z.string(),
  details: z.unknown().optional(),
});

export type ApiErrorCode = z.infer<typeof ApiErrorCode>;
export type ApiError = z.infer<typeof ApiError>;
