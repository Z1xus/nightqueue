import type { ApiError, EnqueueRequest, EnqueueResponse } from "@nightqueue/protocol";
import { settings } from "./settings";

export type EnqueueAction = EnqueueRequest["action"];

export class ApiFailure extends Error {
  constructor(
    message: string,
    readonly unauthorized: boolean = false,
  ) {
    super(message);
  }
}

export async function enqueue(action: EnqueueAction, uris: string[]): Promise<EnqueueResponse> {
  const token = settings.deviceToken();
  if (!token) throw new ApiFailure("connect your account first", true);

  const body: EnqueueRequest = { action, uris, target: "automatic", requestId: crypto.randomUUID() };
  const res = await fetch(`${settings.backendUrl()}/enqueue`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const error = (await res.json().catch(() => null)) as ApiError | null;
    throw new ApiFailure(error?.message ?? res.statusText, res.status === 401);
  }
  return res.json() as Promise<EnqueueResponse>;
}
