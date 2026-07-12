// google's public youtube-on-tv device-flow client, same constants youtube-source uses
const CLIENT_ID = "861556708454-d6dlm3lh05idd8npek18k6be8ba3oc68.apps.googleusercontent.com";
const CLIENT_SECRET = "SboVhoG9s0rNafixCSGGKXAT";

const post = <T>(url: string, body: Record<string, string>): Promise<T> =>
  fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }).then((r) => r.json() as Promise<T>);

interface DeviceResponse {
  device_code: string;
  user_code: string;
  verification_url: string;
  interval: number;
}

const device = await post<DeviceResponse>("https://www.youtube.com/o/oauth2/device/code", {
  client_id: CLIENT_ID,
  scope: "http://gdata.youtube.com https://www.googleapis.com/auth/youtube-paid-content",
  device_id: crypto.randomUUID().replaceAll("-", ""),
  device_model: "ytlr::",
});
console.log(`authorise at ${device.verification_url} with code ${device.user_code} (use a burner account)`);

let refreshToken: string | undefined;
while (!refreshToken) {
  await Bun.sleep(device.interval * 1000);
  const res = await post<{ error?: string; refresh_token?: string }>("https://www.youtube.com/o/oauth2/token", {
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    code: device.device_code,
    grant_type: "http://oauth.net/grant_type/device/1.0",
  });
  if (res.error && res.error !== "authorization_pending" && res.error !== "slow_down") throw new Error(res.error);
  refreshToken = res.refresh_token;
}

const envFile = Bun.file(`${import.meta.dir}/../.env`);
const kept = (await envFile.text())
  .split("\n")
  .filter((line) => !line.startsWith("YOUTUBE_OAUTH_REFRESH_TOKEN="))
  .join("\n")
  .trimEnd();
await Bun.write(envFile, `${kept}\nYOUTUBE_OAUTH_REFRESH_TOKEN=${refreshToken}\n`);
console.log("saved to .env, restart lavalink to apply");
