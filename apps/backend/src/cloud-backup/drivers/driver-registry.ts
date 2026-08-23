import type { DriverId, StorageDriver } from "./storage-driver";
import { S3Driver, S3Config } from "./s3.driver";
import { WebDavDriver, WebDavConfig } from "./webdav.driver";
import { GDriveDriver, GDriveConfig } from "./gdrive.driver";

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
  options?: Array<{ value: string; label: string }>;
}

export interface DriverDefinition {
  id: DriverId;
  displayName: string;
  /** One-line description shown on the picker card. */
  description: string;
  /** Ordered form fields. */
  fields: DriverField[];
  /** True when setup requires a two-step OAuth handshake instead of a form. */
  requiresOAuth?: boolean;
  create(config: unknown): StorageDriver;
}

/** JSON stored per target (inside the credential store; never plaintext). */
export interface DriverConfigRecord {
  driver: DriverId;
  config: unknown;
}

export const DRIVER_DEFINITIONS: DriverDefinition[] = [
  {
    id: "s3",
    displayName: "S3 compatible",
    description:
      "Cloudflare R2, Backblaze B2, Wasabi, MinIO, AWS S3 — tout service compatible S3 avec une URL de endpoint personnalisée.",
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
  {
    id: "gdrive",
    displayName: "Google Drive",
    description: "Google Drive via OAuth2 — un dossier dédié à cette école est créé automatiquement.",
    requiresOAuth: true,
    fields: [
      { name: "clientId", type: "text", label: "Client ID OAuth (Console Google Cloud)", required: true, help: "Créez un client OAuth de bureau dans Google Cloud Console (Identifiants → Créer des identifiants → ID client OAuth → Application de bureau)." },
      { name: "clientSecret", type: "password", label: "Client Secret", required: true, secret: true },
      { name: "refreshToken", type: "oauth", label: "Autorisation Google", required: true, help: "Après avoir rempli les identifiants, cliquez sur « Autoriser » pour vous connecter à votre compte Google." },
    ],
    create: (config) => new GDriveDriver(config as GDriveConfig),
  },
];

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