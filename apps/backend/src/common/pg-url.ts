/**
 * Parses `DATABASE_URL` for the pg_dump / psql child processes.
 *
 * The previous regex — `^postgresql://([^:]+):([^@]+)@([^:]+):(\d+)/(.+)` —
 * rejected the `postgres://` scheme, required an explicit port, broke on a
 * password containing '@', and never percent-decoded. The setup wizard
 * generates random passwords, so the encoding case is not hypothetical.
 * `new URL()` handles all of it.
 */
export interface PgConnection {
  user: string;
  password: string;
  host: string;
  port: number;
  database: string;
}

export function parsePgUrl(raw: string): PgConnection {
  if (!raw) throw new Error("DATABASE_URL n'est pas défini.");
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("DATABASE_URL n'est pas une chaîne de connexion PostgreSQL valide");
  }
  if (url.protocol !== "postgresql:" && url.protocol !== "postgres:") {
    throw new Error("DATABASE_URL n'est pas une chaîne de connexion PostgreSQL valide");
  }
  const database = url.pathname.replace(/^\//, "").split("?")[0];
  if (!database) throw new Error("DATABASE_URL ne nomme aucune base de données.");
  return {
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    host: url.hostname,
    port: url.port ? Number(url.port) : 5432,
    database,
  };
}
