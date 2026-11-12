import { ApiError } from '../../lib/api'
import { leavePage } from '../../lib/leave-page'
import { authRedirectPath } from '../../lib/navigation'
import { SUPPORT_SESSION_HEADER, supportSessionFor } from '../../lib/support-session'

// shortcut: lib/api.ts (fetch + JSON) can report neither upload progress nor a CSV body, so the upload uses XHR
// and the export a raw fetch, with the same headers and error contract. Move both into lib/api.ts as options
// when another screen needs them.

export interface UploadProgress {
  /** Bytes sent so far, of total. */
  readonly loaded: number
  readonly total: number
}

const NETWORK_FAILURE = () => new ApiError(0, 'NETWORK_ERROR', 'The request did not reach the service.')

/** The API's { error } body as an ApiError; any other answer is SERVICE_UNAVAILABLE, as in lib/api.ts. */
export function errorFrom(status: number, text: string, requestId: string | null): ApiError {
  let body: unknown = null
  try {
    body = JSON.parse(text)
  } catch {
    body = null // not JSON: a proxy or gateway page
  }
  const error = (body as { error?: Record<string, unknown> } | null)?.error
  if (error !== undefined && typeof error.code === 'string' && typeof error.message === 'string') {
    const id = typeof error.request_id === 'string' ? error.request_id : requestId
    return new ApiError(status, error.code, error.message, error.details ?? null, id)
  }
  return new ApiError(status, 'SERVICE_UNAVAILABLE', 'The service did not answer as expected.', null, requestId)
}

/** Auth failures leave the page for sign-in or MFA and never settle (lib/api.ts contract); others reject. */
function fail<T>(error: unknown): Promise<T> {
  const redirect = error instanceof ApiError ? authRedirectPath(error.code, `${window.location.pathname}${window.location.search}`) : null
  if (redirect === null) return Promise.reject(error)
  leavePage(redirect)
  return new Promise<never>(() => undefined)
}

/** A creating multipart POST with byte progress; resolves to the response's data. */
export function uploadForm<T>(path: string, form: FormData, idempotencyKey: string, onProgress: (progress: UploadProgress) => void): Promise<T> {
  const sent = new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', path)
    xhr.setRequestHeader('Accept', 'application/json')
    xhr.setRequestHeader('X-Requested-With', 'fetch')
    xhr.setRequestHeader('Idempotency-Key', idempotencyKey)
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress({ loaded: event.loaded, total: event.total })
    }
    xhr.onerror = () => reject(NETWORK_FAILURE())
    xhr.onload = () => {
      const requestId = xhr.getResponseHeader('x-request-id')
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(errorFrom(xhr.status, xhr.responseText, requestId))
        return
      }
      try {
        resolve((JSON.parse(xhr.responseText) as { data: T }).data)
      } catch {
        reject(errorFrom(xhr.status, '', requestId))
      }
    }
    xhr.send(form)
  })
  return sent.catch((error: unknown) => fail<T>(error))
}

const FILENAME = /filename="([^"]+)"/

/** GET a CSV export; the server logs it. */
export async function downloadCsv(path: string, query: Readonly<Record<string, string>>): Promise<{ readonly blob: Blob; readonly filename: string }> {
  let response: Response
  try {
    const session = supportSessionFor(window.location.pathname)
    const headers = { Accept: 'text/csv', ...(session === null ? {} : { [SUPPORT_SESSION_HEADER]: session }) }
    response = await fetch(`${path}?${new URLSearchParams(query).toString()}`, { headers, credentials: 'same-origin' })
  } catch {
    return fail(NETWORK_FAILURE())
  }
  if (!response.ok) return fail(errorFrom(response.status, await response.text(), response.headers.get('x-request-id')))
  const filename = FILENAME.exec(response.headers.get('content-disposition') ?? '')?.[1] ?? 'export.csv'
  return { blob: await response.blob(), filename }
}

/** Hands a downloaded file to the browser's save dialog. */
export function saveFile(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}
