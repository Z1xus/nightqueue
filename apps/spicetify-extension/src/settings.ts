const PREFIX = "nightqueue:";
const BACKEND_URL_KEY = PREFIX + "backendUrl";
const TOKEN_KEY = PREFIX + "deviceToken";
const DEFAULT_BACKEND_URL = "http://localhost:3000";

export const settings = {
  backendUrl: () => Spicetify.LocalStorage.get(BACKEND_URL_KEY) ?? DEFAULT_BACKEND_URL,
  setBackendUrl: (url: string) => Spicetify.LocalStorage.set(BACKEND_URL_KEY, url),
  deviceToken: () => Spicetify.LocalStorage.get(TOKEN_KEY),
  setDeviceToken: (token: string) => Spicetify.LocalStorage.set(TOKEN_KEY, token),
};
