import { Pool } from "pg";
import { drizzle, NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "./schema";
import * as relations from "./relations";

/**
 * Standalone drizzle client for the seed scripts (which run outside Nest).
 * Mirrors DbService: `db.query.<table>` relational queries work, and numeric
 * columns round-trip as strings.
 */
export function seedClient(): {
  db: NodePgDatabase<typeof schema & typeof relations>;
  close: () => Promise<void>;
} {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 5,
  });
  const db = drizzle(pool, { schema: { ...schema, ...relations } });
  return { db, close: async () => pool.end() };
}