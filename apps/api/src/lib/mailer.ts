import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export interface Mail {
  readonly to: string
  readonly subject: string
  readonly text: string
}

// Header values are single lines: a CR or LF in a subject (for example a tenant name) cannot add headers.
const headerValue = (value: string): string => value.replace(/[\r\n]+/g, ' ')

/**
 * Delivers one plain-text mail into the mail drop (config.mailDir) as an RFC 5322 .eml file readable only by
 * the API's OS user. File names sort by delivery time.
 */
export async function sendMail(mailDir: string, mail: Mail): Promise<void> {
  await mkdir(mailDir, { recursive: true, mode: 0o700 })
  const message = [
    `To: ${headerValue(mail.to)}`,
    `Subject: ${headerValue(mail.subject)}`,
    `Date: ${new Date().toUTCString()}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    '',
    mail.text,
  ].join('\r\n')
  await writeFile(join(mailDir, `${Date.now()}-${randomUUID()}.eml`), message, { mode: 0o600, flag: 'wx' })
}
