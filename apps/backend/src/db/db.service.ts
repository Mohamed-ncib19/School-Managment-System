import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Pool } from "pg";
import { drizzle, NodePgDatabase } from "drizzle-orm/node-postgres";
import { SQL } from "drizzle-orm";
import * as schema from "./schema";
import * as relations from "./relations";

/**
 * Drizzle + node-postgres access layer.
 *
 * The schema in `./schema.ts` was introspected from the live database (the
 * two are byte-identical), so existing installations need no data or schema
 * migration at all.
 *
 * - `client` exposes the full typed API, including `client.query.<table>`
 *   relational queries and `client.transaction(...)`.
 * - Numeric columns arrive as strings (node-postgres default) - route every
 *   monetary value through `money()` (see financial/money.util.ts).
 */
@Injectable()
export class DbService implements OnModuleInit, OnModuleDestroy {
  private readonly pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 10,
    idleTimeoutMillis: 30_000,
  });

  readonly client: NodePgDatabase<typeof schema & typeof relations> = drizzle(this.pool, {
    schema: { ...schema, ...relations },
  });

  async onModuleInit() {
    await this.pool.query("SELECT 1");
  }

  async onModuleDestroy() {
    await this.pool.end();
  }

  /** Typed passthrough for raw SQL - the hierarchy/analytics hot paths. */
  async rawQuery<T = unknown>(query: SQL): Promise<T[]> {
    const result = await this.client.execute(query);
    return (result as unknown as { rows: T[] }).rows;
  }
}

/** The transaction handle handed to `client.transaction(cb)` callbacks. */
export type Tx = Parameters<Parameters<DbService["client"]["transaction"]>[0]>[0];