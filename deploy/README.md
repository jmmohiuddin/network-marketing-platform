# Staging deployment (shared Hostinger VPS)

Push to `main` → GitHub Actions typechecks, builds `ghcr.io/<owner>/<repo>:<sha>` and SSHes to the VPS with a key that
can only run `deploy/deploy.sh <sha>`. That script pulls, migrates, restarts and rolls back if `/v1/me` does not answer 401. The deployed tag is also written to `.env`, so plain `docker compose` works on the server.

The VPS's shared Caddy (`/opt/voltix/infra/production/Caddyfile`) terminates HTTPS and proxies the domain to
`172.16.1.1:6600`. This stack has no proxy of its own.

## One-time server setup (done 2026-11-17)
1. `/opt/nmp`: `docker-compose.yml` and `deploy/` from this repo (copy again when they change; the deploy key cannot).
2. `sh deploy/bootstrap.sh <domain> ghcr.io/<owner>/<repo>` writes `.env` with random secrets (mode 600, never overwritten).
3. The GHCR package is public; `deploy.sh` pulls it anonymously (`DOCKER_CONFIG=.docker-anon`), not with the host's ghcr.io login.
4. `~root/.ssh/authorized_keys`: `command="/opt/nmp/deploy/deploy.sh",restrict <public key> nmp-github-actions`.
5. Repo secrets `VPS_HOST`, `VPS_USER` (root), `VPS_SSH_KEY` (the private half).
6. Caddy site block for the domain → `reverse_proxy 172.16.1.1:6600`; validate, then `docker exec voltix-prod-caddy-1 caddy reload --config /etc/caddy/Caddyfile`.

## Landing pages (phoyev.com, network.phoyev.com)
`site/` holds two static Stitch pages served by the `site` compose service on `172.16.1.1:6601` (not part of `deploy.sh`; start once with `docker compose up -d site`). Copy `site/` and `docker-compose.yml` to `/opt/nmp/` by hand (the CI key cannot). Edit a page, scp it, no restart needed.
- `phoyev.com`, `www.phoyev.com` → whole host to `172.16.1.1:6601` (agency page).
- `network.phoyev.com` → `/` exactly to `6601` (partner page), everything else to the app on `6600`.
- DNS: A record `network` → the VPS IP at the DNS host. App cut-over: `.env` `DOMAIN=network.phoyev.com` (feeds `WEB_URL`), recreate `api`, add the domain to Firebase authorized domains. Sessions are host-only, so everyone signs in again.

Caddy blocks (validate, then reload the shared Caddy as above):
```
phoyev.com, www.phoyev.com {
	reverse_proxy 172.16.1.1:6601
}
network.phoyev.com {
	@landing path /
	handle @landing {
		reverse_proxy 172.16.1.1:6601
	}
	handle {
		reverse_proxy 172.16.1.1:6600
	}
}
```

## First sign-in
No accounts exist. Create the first vendor operator (prints a one-time password-set link; mails are not sent anywhere):
`docker compose exec -e NMP_ALLOW_VENDOR_BOOTSTRAP=yes api /app/node_modules/.bin/tsx src/scripts/create-vendor-user.ts --email you@example.com --i-understand`
Invitation mails are written as `.eml` files to the `appdata` volume (`/data/mail`), not sent.

## Not production
In-app auth (no external IdP), no SMTP, no backups of the `pgdata` volume yet. Use synthetic data only.
