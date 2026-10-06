import "server-only";
import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  GOOGLE_CLIENT_ID: z.string().min(1, "GOOGLE_CLIENT_ID is required"),
  GOOGLE_CLIENT_SECRET: z.string().min(1, "GOOGLE_CLIENT_SECRET is required"),
  GOOGLE_REDIRECT_URI: z
    .string()
    .url("GOOGLE_REDIRECT_URI must be a full URL")
    .default("http://localhost:3000/api/auth/google/callback"),
  TOKEN_ENCRYPTION_KEY: z
    .string()
    .refine(
      (v) => Buffer.from(v, "base64").length === 32,
      "TOKEN_ENCRYPTION_KEY must be 32 bytes, base64-encoded (run `npm run gen:key`)",
    ),
});

export type Env = z.infer<typeof envSchema>;

export class ConfigError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Invalid configuration: ${issues.join("; ")}`);
    this.name = "ConfigError";
  }
}

let cached: Env | null = null;

/** Validated environment. Throws ConfigError listing every problem at once. */
export function getEnv(): Env {
  if (cached) return cached;
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    throw new ConfigError(result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`));
  }
  cached = result.data;
  return cached;
}

export function getConfigStatus(): { ok: true } | { ok: false; issues: string[] } {
  try {
    getEnv();
    return { ok: true };
  } catch (e) {
    if (e instanceof ConfigError) return { ok: false, issues: e.issues };
    throw e;
  }
}

/** Origin of the app as registered with Google (e.g. http://localhost:3000). */
export function getAppOrigin(): string {
  return new URL(getEnv().GOOGLE_REDIRECT_URI).origin;
}
