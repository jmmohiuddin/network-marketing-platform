import { ApiError } from './api'

const NOT_AVAILABLE = 'Not found or not available to you.'

// Codes whose server message does not fit the screen, or that the client raises itself. Every other code
// shows the API's own message, which is written for users and never echoes input.
const CLIENT_MESSAGES: Readonly<Record<string, string>> = {
  NETWORK_ERROR: 'Cannot reach the service. Check your connection and try again.',
  SERVICE_UNAVAILABLE: 'The service is not available right now. Try again in a few minutes.',
  STEP_UP_REQUIRED: 'This action needs the code from your authenticator app. Nothing was changed.',
  NOT_FOUND: NOT_AVAILABLE,
  REALM_FORBIDDEN: NOT_AVAILABLE,
}

const SERVER_FAILURE = 'Something went wrong. Try again later.'

/** The sentence to show for a failed request. */
export function errorMessage(error: unknown): string {
  if (!(error instanceof ApiError)) return SERVER_FAILURE
  const known = CLIENT_MESSAGES[error.code]
  if (known !== undefined) return known
  if (error.status >= 500) return error.requestId === null ? SERVER_FAILURE : `${SERVER_FAILURE} Reference: ${error.requestId}`
  return error.message
}

/** VALIDATION_FAILED issues by body path ("password", "scope.permissions"); empty for any other error. */
export function fieldErrors(error: unknown): Readonly<Record<string, string>> {
  if (!(error instanceof ApiError) || error.code !== 'VALIDATION_FAILED') return {}
  const issues = (error.details as { issues?: unknown } | null)?.issues
  if (!Array.isArray(issues)) return {}
  const entries = issues.flatMap((issue: unknown) => {
    const { path, message } = (issue ?? {}) as { path?: unknown; message?: unknown }
    return typeof path === 'string' && typeof message === 'string' ? [[path, message] as const] : []
  })
  return Object.fromEntries(entries)
}

/** The page must say "Not found or not available to you" and never confirm that the object exists. */
export function isNotAvailable(error: unknown): boolean {
  if (!(error instanceof ApiError)) return false
  return error.status === 404 || error.code === 'PERMISSION_DENIED' || error.code === 'REALM_FORBIDDEN'
}
