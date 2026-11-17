import { isIP } from 'node:net'
import { z } from 'zod'

const AES_256_KEY_BYTES = 32
// NIST SP 800-63B AAL2 reauthentication bound; auth_open_session (migration 0041) refuses longer sessions.
const SESSION_MAX_MINUTES = 720

const positiveInt = (fallback: number) => z.coerce.number().int().positive().default(fallback)

// Comma-separated TCP ports, each 1..65535, at least one.
const portList = (fallback: string) =>
  z
    .string()
    .default(fallback)
    .transform((value) => value.split(',').map((part) => Number(part.trim())))
    .pipe(z.array(z.number().int().min(1).max(65_535)).min(1))

// proxy-addr names Fastify's trustProxy accepts besides addresses and CIDRs.
const PROXY_NAMES: ReadonlySet<string> = new Set(['loopback', 'linklocal', 'uniquelocal'])

function isProxyEntry(value: string): boolean {
  if (PROXY_NAMES.has(value)) return true
  const [address = '', prefix, ...rest] = value.split('/')
  const family = isIP(address)
  if (family === 0 || rest.length > 0) return false
  return prefix === undefined || (/^\d{1,3}$/.test(prefix) && Number(prefix) <= (family === 4 ? 32 : 128))
}

/**
 * Unset: no proxy is trusted. Else comma-separated proxy addresses, CIDRs or names; no hop count, which would trust a
 * forwarded address whoever sent it.
 */
const trustProxy = z
  .string()
  .trim()
  .optional()
  .transform((value, ctx): string[] | false => {
    if (value === undefined || value === '') return false
    const entries = value.split(',').map((part) => part.trim())
    const bad = entries.filter((entry) => !isProxyEntry(entry))
    if (bad.length === 0) return entries
    ctx.addIssue({ code: 'custom', message: `not an address, CIDR or loopback|linklocal|uniquelocal: ${bad.join(', ')}` })
    return z.NEVER
  })

const optionalText = z.string().trim().default('')

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
  // Proxies in front of the API (the web app's /v1 rewrite, a load balancer): request.ip, which the sign-in and
  // API-key limiters and key IP allow-lists use, is then the client taken from X-Forwarded-For.
  TRUST_PROXY: trustProxy,
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  SECRET_ENCRYPTION_KEY: secretKey,
  SESSION_ABSOLUTE_MINUTES: z.coerce.number().int().positive().max(SESSION_MAX_MINUTES).default(SESSION_MAX_MINUTES),
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
  // D-B1-16 (PLAN B1): engineering limits of API keys, webhook delivery and evidence uploads, not product values.
  API_KEY_RATE_STANDARD_PER_MINUTE: positiveInt(120),
  API_KEY_RATE_HIGH_PER_MINUTE: positiveInt(1200),
  API_KEY_MAX_GRACE_MINUTES: positiveInt(10_080),
  WEBHOOK_TIMEOUT_MS: positiveInt(10_000),
  WEBHOOK_ALLOWED_PORTS: portList('443'),
  WEBHOOK_RETRY_BASE_SECONDS: positiveInt(60),
  WEBHOOK_RETRY_MAX_SECONDS: positiveInt(21_600),
  WEBHOOK_GIVE_UP_HOURS: positiveInt(72),
  EVIDENCE_MAX_FILE_BYTES: positiveInt(10_485_760),
  // D-B2-19 (PLAN B2): engineering limits of order ingestion and genealogy reads, not plan or compliance values.
  ORDER_FUTURE_TOLERANCE_SECONDS: positiveInt(300),
  GENEALOGY_FALLBACK_MAX_DEPTH: positiveInt(10_000),
  GENEALOGY_PAGE_MAX: positiveInt(200),
  // Firebase Authentication (an additional sign-in method): the web app config, public by design. All four or none.
  FIREBASE_PROJECT_ID: optionalText,
  FIREBASE_WEB_API_KEY: optionalText,
  FIREBASE_AUTH_DOMAIN: optionalText,
  FIREBASE_APP_ID: optionalText,
})

/** The Firebase web app config: public values the browser SDK needs; the API checks tokens against projectId. */
export interface FirebaseSettings {
  readonly projectId: string
  readonly webApiKey: string
  readonly authDomain: string
  readonly appId: string
}

export interface Config {
  readonly env: 'development' | 'test' | 'production'
  readonly databaseUrl: string
  readonly host: string
  readonly port: number
  /** Fastify trustProxy: false (none) or the trusted proxy addresses/CIDRs/names. */
  readonly trustProxy: readonly string[] | false
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
  readonly apiKeyRateStandardPerMinute: number
  readonly apiKeyRateHighPerMinute: number
  readonly apiKeyMaxGraceMinutes: number
  readonly webhookTimeoutMs: number
  readonly webhookAllowedPorts: readonly number[]
  /** First retry delay; each later one doubles, capped at webhookRetryMaxSeconds. */
  readonly webhookRetryBaseSeconds: number
  readonly webhookRetryMaxSeconds: number
  /** A delivery still failing this long after its first attempt is dead. */
  readonly webhookGiveUpHours: number
  readonly evidenceMaxFileBytes: number
  /** An order or event timestamp may lie at most this far after the server clock. */
  readonly orderFutureToleranceSeconds: number
  /** Depth bound of the authorisation walk on the system of record while the path model is stale; deeper = deny. */
  readonly genealogyFallbackMaxDepth: number
  /** Largest page of genealogy children or downline rows. */
  readonly genealogyPageMax: number
  /** null: Firebase sign-in is disabled. */
  readonly firebase: FirebaseSettings | null
}

type Env = z.infer<typeof EnvSchema>

// A partial Firebase config is a deployment mistake, not a way to disable it: refused at start-up.
function firebaseSettings(e: Env): FirebaseSettings | null | string {
  const values = [e.FIREBASE_PROJECT_ID, e.FIREBASE_WEB_API_KEY, e.FIREBASE_AUTH_DOMAIN, e.FIREBASE_APP_ID]
  const set = values.filter((value) => value !== '').length
  if (set === 0) return null
  if (set < values.length) return 'FIREBASE_*: set all four of PROJECT_ID, WEB_API_KEY, AUTH_DOMAIN and APP_ID, or none'
  return { projectId: e.FIREBASE_PROJECT_ID, webApiKey: e.FIREBASE_WEB_API_KEY, authDomain: e.FIREBASE_AUTH_DOMAIN, appId: e.FIREBASE_APP_ID }
}

/** Validates the environment once at start-up and fails fast with every problem listed. */
export function loadConfig(env: NodeJS.ProcessEnv): Config {
  const parsed = EnvSchema.safeParse(env)
  if (!parsed.success) {
    const problems = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`)
    throw new Error(`Invalid configuration:\n${problems.join('\n')}`)
  }
  const e = parsed.data
  const firebase = firebaseSettings(e)
  if (typeof firebase === 'string') throw new Error(`Invalid configuration:\n${firebase}`)
  return {
    env: e.NODE_ENV,
    databaseUrl: e.DATABASE_URL,
    host: e.API_HOST,
    port: e.API_PORT,
    trustProxy: e.TRUST_PROXY,
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
    apiKeyRateStandardPerMinute: e.API_KEY_RATE_STANDARD_PER_MINUTE,
    apiKeyRateHighPerMinute: e.API_KEY_RATE_HIGH_PER_MINUTE,
    apiKeyMaxGraceMinutes: e.API_KEY_MAX_GRACE_MINUTES,
    webhookTimeoutMs: e.WEBHOOK_TIMEOUT_MS,
    webhookAllowedPorts: e.WEBHOOK_ALLOWED_PORTS,
    webhookRetryBaseSeconds: e.WEBHOOK_RETRY_BASE_SECONDS,
    webhookRetryMaxSeconds: e.WEBHOOK_RETRY_MAX_SECONDS,
    webhookGiveUpHours: e.WEBHOOK_GIVE_UP_HOURS,
    evidenceMaxFileBytes: e.EVIDENCE_MAX_FILE_BYTES,
    orderFutureToleranceSeconds: e.ORDER_FUTURE_TOLERANCE_SECONDS,
    genealogyFallbackMaxDepth: e.GENEALOGY_FALLBACK_MAX_DEPTH,
    genealogyPageMax: e.GENEALOGY_PAGE_MAX,
    firebase,
  }
}
