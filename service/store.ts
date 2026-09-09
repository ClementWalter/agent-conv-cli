/** Parameterized, tenant-scoped persistence shared by HTTP requests and durable workers. */
import { PGlite } from "@electric-sql/pglite";
import pg from "pg";
import { mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";

export type Row = Record<string, any>;
export class Store {
  constructor(readonly db: PGlite | pg.Pool) {}
  async query(sql: string, values: any[] = []): Promise<Row[]> {
    const result =
      this.db instanceof PGlite
        ? await this.db.query(sql, values)
        : await this.db.query(sql, values);
    return result.rows as Row[];
  }
  async migrate() {
    // All installations apply additive, idempotent schema creation before accepting traffic.
    const statements = [
      `CREATE TABLE IF NOT EXISTS users (id text PRIMARY KEY, email text NOT NULL, name text NOT NULL, plan text NOT NULL DEFAULT 'free')`,
      `CREATE TABLE IF NOT EXISTS sessions (hash text PRIMARY KEY, user_id text REFERENCES users(id) ON DELETE CASCADE, expires bigint NOT NULL)`,
      `CREATE TABLE IF NOT EXISTS flows (hash text PRIMARY KEY, expires bigint NOT NULL)`,
      `CREATE TABLE IF NOT EXISTS connections (id text PRIMARY KEY, user_id text NOT NULL REFERENCES users(id), provider text NOT NULL, label text NOT NULL, status text NOT NULL, detail text NOT NULL DEFAULT '', credentials text, context_id text, browser_id text, live_url text, generation int NOT NULL DEFAULT 0, last_sync bigint, created bigint NOT NULL)`,
      `CREATE TABLE IF NOT EXISTS conversations (id text PRIMARY KEY, user_id text NOT NULL REFERENCES users(id), connection_id text NOT NULL REFERENCES connections(id) ON DELETE CASCADE, native_id text NOT NULL, product text NOT NULL, title text NOT NULL, account text NOT NULL, updated text NOT NULL, document jsonb NOT NULL, UNIQUE(connection_id, product, native_id))`,
      `CREATE INDEX IF NOT EXISTS conversation_owner ON conversations(user_id, updated DESC)`,
      `CREATE TABLE IF NOT EXISTS jobs (id text PRIMARY KEY, connection_id text NOT NULL REFERENCES connections(id) ON DELETE CASCADE, generation int NOT NULL, state text NOT NULL DEFAULT 'pending', lease_until bigint NOT NULL DEFAULT 0, created bigint NOT NULL)`,
      `CREATE TABLE IF NOT EXISTS grants (id text PRIMARY KEY, user_id text NOT NULL REFERENCES users(id), client_id text NOT NULL, label text NOT NULL, token_hash text UNIQUE, account_ids jsonb NOT NULL, active boolean NOT NULL DEFAULT true, created bigint NOT NULL, last_used bigint, UNIQUE(user_id, client_id))`,
      `CREATE TABLE IF NOT EXISTS contributions (id text PRIMARY KEY, user_id text NOT NULL REFERENCES users(id), conversation_id text NOT NULL REFERENCES conversations(id) ON DELETE CASCADE, purpose text NOT NULL, revision text NOT NULL, notice text NOT NULL, active boolean NOT NULL, created bigint NOT NULL)`,
    ];
    if (this.db instanceof PGlite) {
      for (const statement of statements) await this.query(statement);
    } else {
      const client = await this.db.connect();
      try {
        // Web and worker may boot together; a dedicated connection serializes schema changes.
        await client.query("SELECT pg_advisory_lock(731928)");
        for (const statement of statements) await client.query(statement);
      } finally {
        await client.query("SELECT pg_advisory_unlock(731928)");
        client.release();
      }
    }
  }
  async close() {
    if (this.db instanceof PGlite) await this.db.close();
    else await this.db.end();
  }
  async connections(user: string) {
    return this.query(
      "SELECT id,provider,label,status,detail,last_sync,created FROM connections WHERE user_id=$1 ORDER BY created",
      [user],
    );
  }
  async list(user: string, search = "", limit = 50, allowed?: string[]) {
    return this.query(
      `SELECT id,connection_id,product,title,account,updated,jsonb_array_length(document->'turns') AS turns
      FROM conversations WHERE user_id=$1 AND ($2='' OR title ILIKE $3 OR document->>'turns' ILIKE $3)
      AND ($4::jsonb IS NULL OR $4::jsonb ? connection_id) ORDER BY updated DESC LIMIT $5`,
      [
        user,
        search,
        `%${search.replace(/[\\%_]/g, "\\$&")}%`,
        allowed ? JSON.stringify(allowed) : null,
        limit,
      ],
    );
  }
  async conversation(user: string, id: string, allowed?: string[]) {
    return (
      await this.query(
        `SELECT * FROM conversations WHERE user_id=$1 AND id=$2
      AND ($3::jsonb IS NULL OR $3::jsonb ? connection_id)`,
        [user, id, allowed ? JSON.stringify(allowed) : null],
      )
    )[0];
  }
  async enqueue(user: string, id: string) {
    return this.query(
      `INSERT INTO jobs(id,connection_id,generation,created)
      SELECT $3,id,generation,$4 FROM connections WHERE id=$1 AND user_id=$2 AND credentials IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM jobs WHERE connection_id=$1 AND state IN ('pending','running')) RETURNING id`,
      [id, user, randomUUID(), Date.now()],
    );
  }
}
export async function openStore(url?: string, directory = ".oneconv/database") {
  if (!url) await mkdir(directory, { recursive: true, mode: 0o700 });
  const store = new Store(
    url ? new pg.Pool({ connectionString: url }) : new PGlite(directory),
  );
  await store.migrate();
  return store;
}
