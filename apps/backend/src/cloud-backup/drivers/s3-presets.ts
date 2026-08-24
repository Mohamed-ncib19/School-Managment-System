import type { S3Config } from "./s3.driver";

/**
 * Ready-made S3 providers.
 *
 * The generic S3 form asks for an endpoint URL, a region, and an "addressing
 * style". Those are three questions a school administrator cannot answer and
 * should never be asked — getting any of them wrong produces a connection
 * error that reads like a network fault. Every one of them is a constant per
 * provider, so the app knows them and the administrator pastes only the two
 * values their provider actually gave them.
 *
 * Path-style addressing throughout: it is what Cloudflare R2 documents, it is
 * what MinIO and most self-hosted gateways need, and it avoids the TLS
 * certificate surprises virtual-host style hits when a bucket name contains a
 * dot. Every provider here supports it.
 *
 * Adding a provider is one entry in this file — no driver code, no UI change.
 */

export interface S3Preset {
  id: string;
  displayName: string;
  description: string;
  /** Short, concrete instructions for getting the two keys. */
  help: string;
  /** What the school actually gets for nothing, stated plainly. */
  freeTier?: string;
  /** Shown on the first screen rather than behind "Autres options". */
  recommended?: boolean;
  /** Extra fields this provider needs beyond keys + bucket. */
  extraFields: Array<{
    name: string;
    label: string;
    placeholder?: string;
    help?: string;
    options?: Array<{ value: string; label: string }>;
  }>;
  /** Builds the full driver config from what the administrator typed. */
  toConfig(input: Record<string, string>): S3Config;
}

const BACKBLAZE_REGIONS = [
  { value: "us-west-000", label: "us-west-000" },
  { value: "us-west-001", label: "us-west-001" },
  { value: "us-west-002", label: "us-west-002" },
  { value: "us-west-004", label: "us-west-004" },
  { value: "us-east-005", label: "us-east-005" },
  { value: "eu-central-003", label: "eu-central-003 (Europe)" },
];

/**
 * Wasabi was here and has been removed on purpose: it has no free tier, only
 * a 30-day trial, and this subsystem offers schools free options only. The
 * generic "Autre service S3" entry still reaches it for anyone who pays for
 * it deliberately.
 */
export const S3_PRESETS: S3Preset[] = [
  {
    id: "backblaze",
    displayName: "Backblaze B2",
    description: "Sauvegarde en ligne, 10 Go gratuits. Environ 3 minutes, sans carte bancaire.",
    freeTier: "10 Go gratuits",
    help:
      "1. Créez un compte gratuit sur backblaze.com (aucune carte bancaire demandée).\n" +
      "2. Menu B2 Cloud Storage → Buckets → Create a Bucket. Donnez-lui un nom et choisissez « Private ».\n" +
      "3. Notez la région affichée sous « Endpoint » : par exemple s3.eu-central-003.backblazeb2.com → la région est eu-central-003.\n" +
      "4. Menu App Keys → Add a New Application Key. Limitez-la à ce bucket, avec l'accès « Read and Write ».\n" +
      "5. Copiez le keyID et l'applicationKey dans les champs ci-dessous.\n" +
      "Attention : l'applicationKey ne s'affiche qu'une seule fois. Si vous la perdez, créez simplement une nouvelle clé.",
    extraFields: [
      {
        name: "region",
        label: "Région",
        help: "Visible dans « Endpoint » sur la page de votre bucket.",
        options: BACKBLAZE_REGIONS,
      },
    ],
    toConfig: (input) => ({
      endpoint: `https://s3.${input.region || "eu-central-003"}.backblazeb2.com`,
      region: input.region || "eu-central-003",
      accessKeyId: input.accessKeyId,
      secretAccessKey: input.secretAccessKey,
      bucket: input.bucket,
      addressing: "path",
    }),
  },
  {
    id: "r2",
    displayName: "Cloudflare R2",
    description: "10 Go gratuits, mais Cloudflare exige une carte bancaire pour activer R2.",
    freeTier: "10 Go gratuits (carte requise)",
    help:
      "Dans le tableau de bord Cloudflare : R2 → Create bucket, puis Manage R2 API Tokens → Create API token " +
      "avec la permission « Object Read & Write ». L'identifiant de compte (Account ID) est affiché sur la page R2.",
    extraFields: [
      {
        name: "accountId",
        label: "Account ID Cloudflare",
        placeholder: "a1b2c3d4e5f6…",
        help: "Affiché en haut de la page R2 de votre tableau de bord.",
      },
    ],
    toConfig: (input) => ({
      endpoint: `https://${input.accountId}.r2.cloudflarestorage.com`,
      region: "auto",
      accessKeyId: input.accessKeyId,
      secretAccessKey: input.secretAccessKey,
      bucket: input.bucket,
      addressing: "path",
    }),
  },
];

export function s3Preset(id: string): S3Preset | undefined {
  return S3_PRESETS.find((p) => p.id === id);
}
