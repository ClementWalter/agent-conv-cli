/** Secret material stays server-side; encrypted sessions are bound to an account owner. */
import {
  createHash,
  randomBytes,
  createCipheriv,
  createDecipheriv,
} from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";

export const token = () => randomBytes(32).toString("base64url");
export const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export function encrypt(value: unknown, key: Buffer, owner: string) {
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(owner));
  const data = Buffer.concat([
    cipher.update(JSON.stringify(value)),
    cipher.final(),
  ]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64");
}
export function decrypt(value: string, key: Buffer, owner: string) {
  const bytes = Buffer.from(value, "base64"),
    cipher = createDecipheriv("aes-256-gcm", key, bytes.subarray(0, 12));
  cipher.setAAD(Buffer.from(owner));
  cipher.setAuthTag(bytes.subarray(12, 28));
  return JSON.parse(
    Buffer.concat([
      cipher.update(bytes.subarray(28)),
      cipher.final(),
    ]).toString(),
  );
}
export async function loadKey(local: boolean) {
  if (process.env.SESSION_ENCRYPTION_KEY) {
    const key = Buffer.from(process.env.SESSION_ENCRYPTION_KEY, "base64");
    if (key.length !== 32)
      throw new Error("SESSION_ENCRYPTION_KEY must encode 32 bytes");
    return key;
  }
  if (!local) throw new Error("Hosted mode requires SESSION_ENCRYPTION_KEY");
  await mkdir(".oneconv", { recursive: true, mode: 0o700 });
  try {
    return await readFile(".oneconv/key");
  } catch {
    const key = randomBytes(32);
    await writeFile(".oneconv/key", key, { mode: 0o600, flag: "wx" });
    return key;
  }
}
