import { register } from "./menu";

async function waitForSpicetify(): Promise<void> {
  while (!(Spicetify?.ContextMenu && Spicetify?.showNotification)) {
    await new Promise((r) => setTimeout(r, 100));
  }
}

void waitForSpicetify().then(register);
