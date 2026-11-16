// Self-signed certificate for hooks.test.example (valid to 2126), for the local TLS server of dispatch.test.ts only.
// Generated with: openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes -days 36500
//   -subj /CN=hooks.test.example -addext subjectAltName=DNS:hooks.test.example
export const TEST_TLS_HOST = 'hooks.test.example'

export const TEST_TLS_CERT = `-----BEGIN CERTIFICATE-----
MIIBjzCCATWgAwIBAgIUfMN+rnqwXcVkPwTFrfYqbBdjHc4wCgYIKoZIzj0EAwIw
HTEbMBkGA1UEAwwSaG9va3MudGVzdC5leGFtcGxlMCAXDTI2MTExNjIwMTUzOVoY
DzIxMjYxMDIzMjAxNTM5WjAdMRswGQYDVQQDDBJob29rcy50ZXN0LmV4YW1wbGUw
WTATBgcqhkjOPQIBBggqhkjOPQMBBwNCAATK6qXPGhRsbpRGfcD7tQp3Odm/4hei
/OIDMvvNTlFf0WvNrm2d4v3kbKFBua84kKbqLQrRrfU2BxyqpBxbdt8Xo1EwTzAd
BgNVHQ4EFgQUbop+xwHiiXllSb0dSWt3+IZlI54wDwYDVR0TAQH/BAUwAwEB/zAd
BgNVHREEFjAUghJob29rcy50ZXN0LmV4YW1wbGUwCgYIKoZIzj0EAwIDSAAwRQIh
ALHJIKGu5KTVwVhSNY6bFFncQI0kS/rTYSzv+hTlPCPCAiB/8hKGzyxJLejTWeQZ
oEVRgELMYnQNGZkKDQ8z8OFlbA==
-----END CERTIFICATE-----
`

export const TEST_TLS_KEY = `-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgClsQzRrCd+N5R7Qg
WWCsH7WSpxtFbcc0AMDyO8pSAxKhRANCAATK6qXPGhRsbpRGfcD7tQp3Odm/4hei
/OIDMvvNTlFf0WvNrm2d4v3kbKFBua84kKbqLQrRrfU2BxyqpBxbdt8X
-----END PRIVATE KEY-----
`
