import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const rootEnv = fileURLToPath(new URL('../../../.env', import.meta.url));
const apiRoot = fileURLToPath(new URL('..', import.meta.url));
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const optional = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() !== '' ? v.trim() : undefined));

const EnvSchema = z.object({
  NODE_ENV: z.string().default('development'),
  DATABASE_URL: z.string().default('postgres://postgres:postgres@localhost:5432/wchats'),
  TEST_DATABASE_URL: z.string().default('postgres://postgres:postgres@localhost:5432/wchats_test'),
  PORT: z.coerce.number().int().default(3000),
  BETTER_AUTH_URL: z.string().default('http://localhost:5173'),
  BETTER_AUTH_SECRET: z.string().min(16).default('dev-only-secret-change-me-please'),
  WEB_ORIGIN: z.string().default('http://localhost:5173'),
  GOOGLE_CLIENT_ID: optional,
  GOOGLE_CLIENT_SECRET: optional,
  OPENAI_API_KEY: optional,
  ANTHROPIC_API_KEY: optional,
  GEMINI_API_KEY: optional,
  OPENAI_BASE_URL: optional,
  ANTHROPIC_BASE_URL: optional,
  GEMINI_BASE_URL: optional,
  MARKUP: z
    .string()
    .regex(/^\d+(\.\d{1,4})?$/, 'MARKUP must be a decimal with up to 4 places')
    .default('1.25'),
  SIGNUP_CREDIT_USD: z
    .string()
    .regex(/^\d+(\.\d{1,2})?$/)
    .default('0'),
  /** Local upload storage (relative paths resolve from apps/api). */
  STORAGE_DIR: optional.transform((v) => resolve(apiRoot, v ?? 'storage')),
  /** Dev/demo only: answer with a built-in simulated provider instead of calling real APIs. */
  LLM_SIMULATION: z
    .string()
    .optional()
    .transform((v) => ['1', 'true', 'yes', 'on'].includes((v ?? '').trim().toLowerCase())),
  SIMGEN_URL: z.string().default('https://example.com/simgen'),
  LOG_LEVEL: z.string().default('info'),
});

export type Env = z.infer<typeof EnvSchema>;

export const env: Env = EnvSchema.parse(process.env);
