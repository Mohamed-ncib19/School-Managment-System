import type { DriverId, StorageDriver } from "./storage-driver";
import { S3Driver, S3Config } from "./s3.driver";
import { WebDavDriver, WebDavConfig } from "./webdav.driver";
import { GDriveDriver, GDriveConfig } from "./gdrive.driver";
import { FolderDriver, FolderConfig } from "./folder.driver";
import { DropboxDriver, DropboxConfig } from "./dropbox.driver";
import { hasAppGoogleOAuth, withAppGoogleOAuth } from "./google-oauth-app";
import { hasAppDropbox, withAppDropbox } from "./dropbox-app";
import { S3_PRESETS } from "./s3-presets";

/** One field in a driver's setup form. Types mirror the frontend's input set. */
export type DriverFieldType = "url" | "text" | "password" | "number" | "select" | "folder" | "oauth";

export interface DriverField {
  name: keyof Record<string, string> | string;
  type: DriverFieldType;
  label: string;
  placeholder?: string;
  help?: string;
  required?: boolean;
  secret?: boolean;
  /** Developer-level credential, hidden when the app supplies its own. */
  advanced?: boolean;
  options?: Array<{ value: string; label: string }>;
}

export interface DriverDefinition {
  id: DriverId;
  displayName: string;
  /** One-line description shown on the picker card. */
  description: string;
  /** Ordered form fields. */
  fields: DriverField[];
  /**
   * Plain-language instructions shown above the form: where to click in the
   * provider's own site to obtain these values. The single most useful thing
   * on the screen for someone who has never created a bucket.
   */
  setupHelp?: string;
  /**
   * Shown on the first screen, without the administrator opening anything.
   *
   * Exactly two destinations qualify: free, no payment card, and set up in
   * under a minute by someone who has never heard of a bucket. Everything
   * else is real but lives behind "Autres options" — a school that has a
   * Nextcloud or a Backblaze account will go looking; a school that does not
   * should never be asked to choose between six providers.
   */
  recommended?: boolean;
  /** Free of charge for a school's data volume, with no card required. */
  freeTier?: string;
  /** True when setup requires a two-step OAuth handshake instead of a form. */
  requiresOAuth?: boolean;
  /**
   * False for retired destinations: hidden from every setup picker and
   * refused by POST /targets, but kept registered so existing targets keep
   * syncing and restores keep reading. Deleting the definition instead would
   * strand schools whose backups already live there.
   */
  selectable?: boolean;
  create(config: unknown): StorageDriver;
}

/** JSON stored per target (inside the credential store; never plaintext). */
export interface DriverConfigRecord {
  driver: DriverId;
  config: unknown;
}

/**
 * One card per S3 provider, instead of one card asking for an endpoint URL.
 *
 * The driver underneath is identical — only the questions change. An
 * administrator picks "Backblaze B2" and pastes the two values Backblaze gave
 * them; the endpoint, region format and addressing style are the app's
 * problem, not theirs.
 */
const PRESET_DEFINITIONS: DriverDefinition[] = S3_PRESETS.map((preset) => ({
  id: `s3:${preset.id}` as DriverId,
  displayName: preset.displayName,
  description: preset.description,
  freeTier: preset.freeTier,
  recommended: preset.recommended,
  fields: [
    { name: "bucket", type: "text", label: "Nom du bucket", placeholder: "sauvegardes-ecole", required: true },
    { name: "accessKeyId", type: "text", label: "Clé d'accès (Access Key ID)", required: true, secret: true },
    { name: "secretAccessKey", type: "password", label: "Clé secrète", required: true, secret: true },
    ...preset.extraFields.map((f) => ({
      name: f.name,
      type: (f.options ? "select" : "text") as DriverFieldType,
      label: f.label,
      placeholder: f.placeholder,
      help: f.help,
      required: true,
      options: f.options,
    })),
  ],
  setupHelp: preset.help,
  create: (config) => new S3Driver(preset.toConfig(config as Record<string, string>)),
}));

export const DRIVER_DEFINITIONS: DriverDefinition[] = [
  {
    id: "folder",
    displayName: "Disque externe ou dossier réseau",
    description: "Aucun compte, aucun identifiant. Indiquez un emplacement, c'est tout.",
    recommended: true,
    freeTier: "Gratuit",
    fields: [
      {
        name: "basePath",
        type: "folder",
        label: "Emplacement de la sauvegarde",
        placeholder: "D:\\Sauvegardes-Ecole",
        required: true,
        help:
          "Un disque externe ou un dossier réseau (\\\\serveur\\partage\\sauvegardes). " +
          "Le dossier est créé s'il n'existe pas. Les fichiers y sont chiffrés : un disque perdu reste illisible.",
      },
    ],
    setupHelp:
      "Le plus simple contre la panne la plus fréquente (le disque du poste). " +
      "Ajoutez ensuite Dropbox : le cloud protège aussi contre le vol et l'incendie.",
    create: (config) => new FolderDriver(config as FolderConfig),
  },
  {
    id: "gdrive",
    displayName: "Google Drive",
    description: "Votre compte Google suffit — 15 Go gratuits, un dossier dédié est créé automatiquement.",
    recommended: true,
    freeTier: "15 Go gratuits",
    requiresOAuth: true,
    // Retired from new setups: Google gates unreviewed apps behind test
    // users, so the consent page refuses with access_denied for most
    // schools. Existing Drive targets keep syncing and restores keep
    // reading — only the setup choice is gone.
    selectable: false,
    // setupHelp is resolved per request by driverSetupHelp(); it depends on
    // env that is not reliably loaded when this module is first evaluated.
    fields: [
      // These two are developer credentials, not customer input. They are
      // filtered out of the form whenever the app ships its own OAuth client
      // (see driverFields below), which is the normal case — an administrator
      // should only ever see the "Se connecter avec Google" button.
      {
        name: "clientId",
        type: "text",
        label: "Client ID OAuth (Console Google Cloud)",
        required: true,
        advanced: true,
        help: "Uniquement si vous utilisez votre propre client OAuth : Google Cloud Console → Identifiants → ID client OAuth → Application de bureau.",
      },
      { name: "clientSecret", type: "password", label: "Client Secret", required: true, secret: true, advanced: true },
      {
        name: "refreshToken",
        type: "oauth",
        label: "Compte Google",
        required: true,
        help: "Connectez-vous via le bouton, ou via « Sur un autre poste ? » avec le code.",
      },
    ],
    create: (config) => new GDriveDriver(withAppGoogleOAuth(config as Record<string, string>) as unknown as GDriveConfig),
  },
  {
    id: "dropbox",
    displayName: "Dropbox",
    description: "Votre compte suffit — 2 Go gratuits, connexion en un clic, sans validation.",
    recommended: true,
    freeTier: "2 Go gratuits",
    requiresOAuth: true,
    fields: [
      // App credentials, not customer input: filtered out whenever the app
      // ships its own (see driverFields), which is the normal case.
      { name: "appKey", type: "text", label: "App key Dropbox", required: true, advanced: true,
        help: "Uniquement si vous utilisez votre propre application Dropbox." },
      { name: "appSecret", type: "password", label: "App secret", required: true, secret: true, advanced: true },
      { name: "refreshToken", type: "oauth", label: "Compte Dropbox", required: true,
        help: "Connectez-vous via le bouton, ou via « Sur un autre poste ? » avec le code." },
    ],
    create: (config) =>
      new DropboxDriver(withAppDropbox(config as Record<string, string>) as unknown as DropboxConfig),
  },
  ...PRESET_DEFINITIONS,
  {
    id: "s3",
    displayName: "Autre service S3",
    description:
      "Pour un service déjà en place : MinIO, AWS S3, Wasabi, ou tout autre stockage compatible S3. Demande une URL de endpoint.",
    fields: [
      { name: "endpoint", type: "url", label: "Endpoint URL", placeholder: "https://s3.example.com", required: true, help: "L'adresse du service. Pour AWS S3 : https://s3.<région>.amazonaws.com" },
      { name: "region", type: "text", label: "Région", placeholder: "us-east-1", required: true, help: "Région du bucket (peut être us-east-1 pour MinIO/R2/B2)." },
      { name: "accessKeyId", type: "text", label: "Access Key ID", required: true, secret: true },
      { name: "secretAccessKey", type: "password", label: "Secret Access Key", required: true, secret: true },
      { name: "bucket", type: "text", label: "Bucket", placeholder: "mon-ecole-sauvegardes", required: true, help: "Le bucket doit exister et être vide ou réservé à cette école." },
      {
        name: "addressing",
        type: "select",
        label: "Style d'adressage",
        required: true,
        options: [
          { value: "path", label: "Chemin (path-style) — MinIO et la plupart des serveurs privés" },
          { value: "virtual", label: "Virtuel (virtual-host-style) — AWS S3 par défaut" },
        ],
      },
    ],
    create: (config) => new S3Driver(config as S3Config),
  },
  {
    id: "webdav",
    displayName: "Nextcloud / WebDAV",
    description: "Nextcloud, ownCloud ou tout serveur WebDAV — l'URL du point WebDAV et un mot de passe d'application.",
    fields: [
      { name: "baseUrl", type: "url", label: "URL WebDAV", placeholder: "https://cloud.exemple.fr/remote.php/dav/files/utilisateur", required: true, help: "Sur Nextcloud : …/remote.php/dav/files/<nom d'utilisateur>. Sur ownCloud : …/remote.php/webdav." },
      { name: "username", type: "text", label: "Nom d'utilisateur", required: true },
      { name: "password", type: "password", label: "Mot de passe d'application", required: true, secret: true, help: "Sur Nextcloud, créez un mot de passe d'application dans Paramètres → Sécurité plutôt que d'utiliser votre mot de passe principal." },
      { name: "folder", type: "folder", label: "Dossier distant", placeholder: "/Sauvegardes", required: true, help: "Un dossier dans votre stockage, créé automatiquement si absent." },
    ],
    create: (config) => new WebDavDriver(config as WebDavConfig),
  },
];

/**
 * The fields a customer should actually be shown for a driver.
 *
 * Fields marked `advanced` exist only for a self-hoster using their own OAuth
 * client; when the app has its own they are supplied server-side and must
 * never appear in the UI.
 */
export function driverFields(def: DriverDefinition): DriverField[] {
  const appProvides =
    (def.id === "gdrive" && hasAppGoogleOAuth()) || (def.id === "dropbox" && hasAppDropbox());
  return appProvides ? def.fields.filter((f) => !f.advanced) : def.fields;
}

/**
 * Whether a destination belongs on the first screen, decided at request time.
 *
 * Google Drive is only a one-click option when the operator has registered an
 * OAuth client and set GOOGLE_OAUTH_CLIENT_ID / _SECRET. Without them the
 * consent endpoint can only return an error, so presenting it as a headline
 * choice — with two developer credential fields under it — offers the
 * administrator a door that does not open. It drops to "Autres options"
 * instead, where its setup note explains what is missing.
 */
export function isRecommended(def: DriverDefinition): boolean {
  if (!def.recommended) return false;
  // An OAuth destination is only a one-click option when this server actually
  // has an app registered; otherwise its button can only return an error.
  if (def.id === "gdrive") return hasAppGoogleOAuth();
  if (def.id === "dropbox") return hasAppDropbox();
  return true;
}

/**
 * What to tell whoever is looking at the Google Drive card.
 *
 * Two very different audiences: an administrator on a configured install (who
 * needs nothing but the button), and whoever is setting the product up on a
 * server that has no OAuth client yet (who needs to know that, and why the
 * button returns an error otherwise).
 */
export function driverSetupHelp(def: DriverDefinition): string | null {
  return def.id === "gdrive" ? googleSetupHelp() : (def.setupHelp ?? null);
}

function googleSetupHelp(): string {
  if (hasAppGoogleOAuth()) {
    return (
      "Cliquez sur « Se connecter avec Google » et choisissez le compte. " +
      "L'application ne voit que ses propres fichiers."
    );
  }
  return (
    "Google Drive n'est pas encore activé sur ce serveur.\n\n" +
    "Google impose qu'une application soit enregistrée avant d'autoriser un compte : cette étape est " +
    "à faire UNE SEULE FOIS par l'éditeur du logiciel, pas par l'école. Tant qu'elle n'est pas faite, " +
    "le bouton de connexion renvoie une erreur.\n\n" +
    "En attendant, Backblaze B2 (10 Go gratuits) et le disque externe fonctionnent immédiatement, " +
    "sans aucune configuration préalable."
  );
}

const BY_ID = new Map(DRIVER_DEFINITIONS.map((d) => [d.id, d]));

export function driverDefinition(id: DriverId): DriverDefinition {
  const def = BY_ID.get(id);
  if (!def) throw new Error(`Unknown storage driver: ${id}`);
  return def;
}

/** Instantiates a driver from a stored credential record. */
export function createDriver(record: DriverConfigRecord): StorageDriver {
  return driverDefinition(record.driver).create(record.config);
}