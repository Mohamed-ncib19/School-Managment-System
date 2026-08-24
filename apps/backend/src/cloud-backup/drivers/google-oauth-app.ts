/**
 * The application's own Google OAuth client.
 *
 * A school administrator should click "Se connecter avec Google" and be done.
 * Asking them to open the Google Cloud Console, create a project, create an
 * OAuth client and paste a client id and secret is a developer task wearing a
 * customer's clothes — and it is the single biggest reason a backup never gets
 * configured at all.
 *
 * Google requires *an* OAuth client to exist, so the app ships with one. This
 * is the standard installed-application pattern (rclone, Obsidian, the gcloud
 * CLI all do it): per RFC 8252 §8.5 a client secret embedded in an installed
 * app is not treated as confidential, which is why Google issues "Desktop app"
 * clients that expect exactly this. Security does not rest on the secret — it
 * rests on the user's own consent and on the redirect being a loopback address.
 *
 * Scope note: the driver requests `drive.file`, which only ever grants access
 * to files this app itself created. Google classifies it as non-sensitive, so
 * shipping a client using it does not require the verification review that
 * broader Drive scopes do.
 *
 * Configure once, in `apps/backend/.env` of the release build:
 *
 *   GOOGLE_OAUTH_CLIENT_ID=....apps.googleusercontent.com
 *   GOOGLE_OAUTH_CLIENT_SECRET=....
 *
 * When they are absent the app falls back to asking for per-install
 * credentials, so a self-hoster who wants their own client keeps that option.
 */
export interface GoogleOAuthApp {
  clientId: string;
  clientSecret: string;
}

export function appGoogleOAuth(): GoogleOAuthApp | null {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

/** True when the admin can connect with one click and type nothing. */
export function hasAppGoogleOAuth(): boolean {
  return appGoogleOAuth() !== null;
}

/**
 * Fills in the app's client credentials where a stored/posted config omits
 * them. Applied on every path that builds a Drive driver, so a target saved
 * with only a refresh token keeps working.
 */
export function withAppGoogleOAuth(config: Record<string, string>): Record<string, string> {
  const app = appGoogleOAuth();
  if (!app) return config;
  return {
    ...config,
    clientId: config.clientId?.trim() || app.clientId,
    clientSecret: config.clientSecret?.trim() || app.clientSecret,
  };
}
