import { z } from 'zod'

const AES_256_KEY_BYTES = 32

const positiveInt = (fallback: number) => z.coerce.number().int().positive().default(fallback)

const secretKey = z
  .string()
  .refine((value) => Buffer.from(value, 'base64').length === AES_256_KEY_BYTES, {
    message: 'must be 32 random bytes, base64 encoded (openssl rand -base64 32)',
  })

// Numeric defaults are E-ADR-10 engineering values for local use; deployments set them explicitly.
// Security-relevant settings fail closed: NODE_ENV has no default, cookies are Secure unless switched off.
const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']),
  COOKIE_SECURE: z.stringbool().default(true),
  DATABASE_URL: z.string().regex(/^postgres(ql)?:\/\//, 'must be a postgres:// URL'),
  API_HOST: z.string().min(1).default('127.0.0.1'),
  API_PORT: z.coerce.number().int().min(1).max(65_535).default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  SECRET_ENCRYPTION_KEY: secretKey,
  SESSION_ABSOLUTE_MINUTES: positiveInt(720),
  SESSION_IDLE_MINUTES: positiveInt(30),
  STEP_UP_MAX_AGE_SECONDS: positiveInt(600),
  LOCKOUT_MAX_FAILURES: positiveInt(5),
  LOCKOUT_WINDOW_MINUTES: positiveInt(15),
  INVITATION_TTL_HOURS: positiveInt(72),
  EXPORT_ROW_CAP: positiveInt(50_000),
  SIGN_IN_RATE_LIMIT_PER_MINUTE: positiveInt(10),
  API_RATE_LIMIT_PER_MINUTE: positiveInt(600),
  JOB_POOL_SIZE: positiveInt(3),
  // shortcut: mail is written as .eml files to MAIL_DIR (local mail drop); add an SMTP transport before any hosted deployment.
  MAIL_DIR: z.string().min(1).default('var/mail'),
  /** Base URL of the web app, for links in emails. */
  WEB_URL: z.url({ protocol: /^https?$/ }).default('http://127.0.0.1:3100'),
})

export interface Config {
  readonly env: 'development' | 'test' | 'production'
  readonly databaseUrl: string
  readonly host: string
  readonly port: number
  readonly logLevel: string
  readonly secretKey: Buffer
  readonly sessionAbsoluteMinutes: number
  readonly sessionIdleMinutes: number
  readonly stepUpMaxAgeSeconds: number
  readonly lockoutMaxFailures: number
  readonly lockoutWindowMinutes: number
  readonly invitationTtlHours: number
  readonly exportRowCap: number
  readonly signInRateLimitPerMinute: number
  readonly apiRateLimitPerMinute: number
  readonly jobPoolSize: number
  readonly cookieSecure: boolean
  readonly mailDir: string
  readonly webUrl: string
}

/** Validates the environment once at start-up and fails fast with every problem listed. */
export function loadConfig(env: NodeJS.ProcessEnv): Config {
  const parsed = EnvSchema.safeParse(env)
  if (!parsed.success) {
    const problems = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`)
    throw new Error(`Invalid configuration:\n${problems.join('\n')}`)
  }
  const e = parsed.data
  return {
    env: e.NODE_ENV,
    databaseUrl: e.DATABASE_URL,
    host: e.API_HOST,
    port: e.API_PORT,
    logLevel: e.LOG_LEVEL,
    secretKey: Buffer.from(e.SECRET_ENCRYPTION_KEY, 'base64'),
    sessionAbsoluteMinutes: e.SESSION_ABSOLUTE_MINUTES,
    sessionIdleMinutes: e.SESSION_IDLE_MINUTES,
    stepUpMaxAgeSeconds: e.STEP_UP_MAX_AGE_SECONDS,
    lockoutMaxFailures: e.LOCKOUT_MAX_FAILURES,
    lockoutWindowMinutes: e.LOCKOUT_WINDOW_MINUTES,
    invitationTtlHours: e.INVITATION_TTL_HOURS,
    exportRowCap: e.EXPORT_ROW_CAP,
    signInRateLimitPerMinute: e.SIGN_IN_RATE_LIMIT_PER_MINUTE,
    apiRateLimitPerMinute: e.API_RATE_LIMIT_PER_MINUTE,
    jobPoolSize: e.JOB_POOL_SIZE,
    cookieSecure: e.COOKIE_SECURE,
    mailDir: e.MAIL_DIR,
    webUrl: e.WEB_URL.replace(/\/+$/, ''),
  }
}
