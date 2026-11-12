/** Full navigation (drops all client state): sign-in, sign-out and MFA redirects. */
export function leavePage(path: string): void {
  window.location.assign(path)
}
