import { enqueue, ApiFailure, type EnqueueAction } from "./api";
import { connectAccount } from "./pairing";
import { settings } from "./settings";

const ACTIONS: [string, EnqueueAction][] = [
  ["Play now", "play"],
  ["Play next", "playNext"],
  ["Add to queue", "enqueue"],
];

const SELECTABLE = /^spotify:(track|album|playlist):[A-Za-z0-9]+$/;

const notifyError = (err: unknown) =>
  Spicetify.showNotification(`nightqueue: ${(err as Error).message}`, true);

async function runAction(action: EnqueueAction, uris: string[]): Promise<void> {
  try {
    const res = await enqueue(action, uris);
    Spicetify.showNotification(`nightqueue: queued ${res.accepted} track(s)`);
  } catch (err) {
    if (err instanceof ApiFailure && err.unauthorized) {
      Spicetify.showNotification("nightqueue: reconnect your account", true);
      return;
    }
    notifyError(err);
  }
}

function promptBackendUrl(): void {
  const url = window.prompt("nightqueue backend URL", settings.backendUrl());
  if (url) settings.setBackendUrl(url.trim());
}

export function register(): void {
  const items = ACTIONS.map(
    ([label, action]) =>
      new Spicetify.ContextMenu.Item(label, (uris) => void runAction(action, uris)),
  );
  items.push(
    new Spicetify.ContextMenu.Item("Connect account", () => connectAccount().catch(notifyError)),
    new Spicetify.ContextMenu.Item("Set backend URL", promptBackendUrl),
  );

  const shouldAdd = (uris: string[]) => uris.length > 0 && uris.every((u) => SELECTABLE.test(u));
  new Spicetify.ContextMenu.SubMenu("Play in Discord", items, shouldAdd).register();
}
