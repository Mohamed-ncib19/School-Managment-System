/**
 * The application's own Dropbox app credentials.
 *
 * Same principle as the Google client, but the registration behind it is
 * genuinely small: developers.dropbox.com -> Create app -> "Scoped access" ->
 * "App folder" -> name it. About two minutes, three fields, no verification
 * review, no cloud project. That difference is the whole reason Dropbox is
 * the recommended online destination rather than Google Drive.
 *
 * Configure once, in `apps/backend/.env` of the release build:
 *
 *   DROPBOX_APP_KEY=...
 *   DROPBOX_APP_SECRET=...
 *
 * Then grant the app the `files.content.write` and `files.content.read`
 * scopes on its Permissions tab, and add the redirect URI the setup screen
 * shows you. After that a school's entire job is: click, approve, done.
 *
 * The app secret ships inside an installed application, exactly as the Google
 * desktop client secret does — it is not a confidential credential in this
 * flow. What protects the data is the user's own consent, and the fact that
 * an "App folder" app can only ever see the directory it created.
 */
export interface DropboxApp {
  appKey: string;
  appSecret: string;
}

export function appDropbox(): DropboxApp | null {
  const appKey = process.env.DROPBOX_APP_KEY?.trim();
  const appSecret = process.env.DROPBOX_APP_SECRET?.trim();
  if (!appKey || !appSecret) return null;
  return { appKey, appSecret };
}

/** True when the admin can connect in one click and type nothing. */
export function hasAppDropbox(): boolean {
  return appDropbox() !== null;
}

/**
 * Fills in the app credentials where a stored or posted config omits them, so
 * a target saved with only a refresh token keeps working.
 */
export function withAppDropbox(config: Record<string, string>): Record<string, string> {
  const app = appDropbox();
  if (!app) return config;
  return {
    ...config,
    appKey: config.appKey?.trim() || app.appKey,
    appSecret: config.appSecret?.trim() || app.appSecret,
  };
}
