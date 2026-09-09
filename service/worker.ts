/** Durable jobs fence completion by connection generation so deletion defeats in-flight work. */
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import type { Store, Row } from "./store";
import { decrypt } from "./security";

export function runPython(input: unknown): Promise<any> {
  return new Promise((resolveResult, reject) => {
    const child = spawn(
      "uv",
      ["run", "--script", resolve("bin/one-conv-worker")],
      {
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env, PYTHONOPTIMIZE: "1" },
      },
    );
    let output = "",
      failure = "",
      overflow = false;
    const timer = setTimeout(() => child.kill("SIGKILL"), 240000);
    child.stdout.on("data", (data) => {
      output += data;
      if (output.length > 32 * 1024 * 1024) {
        overflow = true;
        child.kill("SIGKILL");
      }
    });
    child.stderr.on("data", (data) => {
      failure = (failure + data).slice(-500);
    });
    child.on("error", () => {
      clearTimeout(timer);
      reject(new Error("The Python worker could not start."));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0 || overflow) {
        reject(
          new Error("Sync did not complete. Retry or reconnect the account."),
        );
        return;
      }
      try {
        resolveResult(JSON.parse(output));
      } catch {
        reject(new Error("The provider worker returned an invalid response."));
      }
    });
    // Credentials travel through a private pipe, never command arguments or logs.
    child.stdin.end(JSON.stringify(input));
  });
}
export async function persistDocuments(
  store: Store,
  connection: Row,
  documents: any[],
) {
  for (const document of documents) {
    if (!document.session || !Array.isArray(document.turns)) continue;
    await store.query(
      `INSERT INTO conversations(id,user_id,connection_id,native_id,product,title,account,updated,document)
      SELECT $1,user_id,id,$3,$4,$5,$6,$7,$8 FROM connections WHERE id=$2 AND generation=$9
      ON CONFLICT(connection_id,product,native_id) DO UPDATE SET title=EXCLUDED.title,updated=EXCLUDED.updated,document=EXCLUDED.document`,
      [
        randomUUID(),
        connection.id,
        document.session,
        document.source,
        document.title || "Untitled conversation",
        document.account_label ||
          document.cwd ||
          connection.label ||
          "Connected account",
        document.last || document.observed_at || "",
        JSON.stringify(document),
        connection.generation,
      ],
    );
  }
}
export async function tick(store: Store, key: Buffer) {
  const job = (
    await store.query(
      `UPDATE jobs SET state='running', lease_until=$1 WHERE id=(
    SELECT id FROM jobs WHERE state='pending' OR (state='running' AND lease_until<$2) ORDER BY created LIMIT 1 FOR UPDATE SKIP LOCKED
    ) RETURNING *`,
      [Date.now() + 300000, Date.now()],
    )
  )[0];
  if (!job) return;
  const connection = (
    await store.query(
      "SELECT * FROM connections WHERE id=$1 AND generation=$2",
      [job.connection_id, job.generation],
    )
  )[0];
  if (!connection) {
    await store.query("UPDATE jobs SET state='cancelled' WHERE id=$1", [
      job.id,
    ]);
    return;
  }
  await store.query(
    "UPDATE connections SET status='syncing',detail='Reading conversation history…' WHERE id=$1 AND generation=$2",
    [connection.id, connection.generation],
  );
  try {
    const credentials = decrypt(
      connection.credentials,
      key,
      `${connection.user_id}:${connection.id}`,
    );
    const result = await runPython({ action: "sync", ...credentials });
    await persistDocuments(store, connection, result.documents || []);
    const partial = Boolean(result.errors?.length || result.partial);
    await store.query(
      "UPDATE connections SET status=$1,detail=$2,last_sync=$3 WHERE id=$4 AND generation=$5",
      [
        partial ? "partial" : "ready",
        partial
          ? result.errors?.join(" ") ||
            "More history is available; this import is partial."
          : "History is up to date for this import.",
        Date.now(),
        connection.id,
        connection.generation,
      ],
    );
    await store.query("UPDATE jobs SET state='complete' WHERE id=$1", [job.id]);
  } catch {
    await store.query(
      "UPDATE connections SET status='reconnect',detail='Sync failed. Retry, or reconnect if your session expired.' WHERE id=$1 AND generation=$2",
      [connection.id, connection.generation],
    );
    await store.query("UPDATE jobs SET state='failed' WHERE id=$1", [job.id]);
  }
}
