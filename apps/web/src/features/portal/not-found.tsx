import { ApiError } from '../../lib/api'
import { Failure } from './blocks'
import { translator } from './i18n'
import { portalSession, requestLocale } from './i18n/server'

/** "Not found or not available to you" in the session's language: a portal id that is not a UUID never reaches the API. */
export async function PortalNotFound() {
  const session = await portalSession()
  const t = session instanceof ApiError ? translator(await requestLocale()) : session.words.t
  return <Failure error={new ApiError(404, 'NOT_FOUND', '')} t={t} />
}
