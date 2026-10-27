# APIKey License Server

A Node.js/Express license API using SQLite. This branch replaces the original JSON-file implementation, fixes first-activation/expiry and device-limit bugs, and removes credentials from URL query strings.

## Requirements

- Node.js 20+
- npm

## Setup

```sh
npm install
cp .env.example .env
```

Set `ADMIN_TOKEN` in `.env` to a cryptographically random secret of at least 32 characters. For example, generate one locally with:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

Never commit `.env`, the database, or real license keys. The server refuses to start if `ADMIN_TOKEN` is missing or too short.

```sh
npm test
npm start
```

SQLite is created at `./data/licenses.sqlite` by default. Set `DATABASE_PATH` to change the location. Back up the database securely.

## API

All endpoints use JSON. Use HTTPS in production.

### Create a license (admin)

```sh
curl -X POST http://localhost:3000/api/v1/admin/licenses \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"days":30,"deviceLimit":2,"type":"free"}'
``

The plaintext `key` is returned **once**. Store it securely. The database stores only its SHA-256 hash.

### Validate / activate a license

```sh
curl -X POST http://localhost:3000/api/v1/licenses/validate \
  -H "Content-Type: application/json" \
  -d '{"key":"ak_REPLACE_WITH_ISSUED_KEY","deviceId":"device-id-generated-by-your-app"}'
``

The first successful validation activates a license and starts its validity period. Revalidating from the same device is allowed. A new device is rejected once `deviceLimit` is reached.

A client-generated device ID is a licensing identifier, not strong proof of hardware identity; users can potentially reset or spoof it. For stronger binding, use platform-specific attestation or a signed enrollment flow appropriate to your application.

### List licenses (admin)

```sh
curl http://localhost:3000/api/v1/admin/licenses \
  -H "Authorization: Bearer $ADMIN_TOKEN"
``

The list includes a key prefix, never the plaintext key or hash.

### Revoke a license (admin)

```sh
curl -X POST http://localhost:3000/api/v1/admin/licenses/1/revoke \
  -H "Authorization: Bearer $ADMIN_TOKEN"
``

### Reset registered devices (admin)

```sh
curl -X POST http://localhost:3000/api/v1/admin/licenses/1/reset-devices \
  -H "Authorization: Bearer $ADMIN_TOKEN"
``

### Health check

`GET /health` returns a minimal status response.

## Legacy migration

If you have an old `key.json`, make a secure backup first. Then set the same `DATABASE_PATH` and run:

```sh
npm run migrate:legacy
``

The migration hashes imported keys and does not import old IP addresses as device IDs. Expired legacy keys remain expired. Do not migrate keys from a public/test `key.json` into production without reviewing them. After a verified migration, remove `key.json` from the deployed environment and revoke any keys that may have been exposed. This script is idempotent for keys already imported.

The legacy `GET /?key=...` endpoint now returns HTTP 410 because query-string credentials can leak through logs, browser history, analytics, and referrer headers. Update clients to use the POST endpoint.

## Security notes

- Admin endpoints require a bearer token; use a unique high-entropy secret and rotate it if exposed.
- Validation and admin endpoints have rate limits; responses do not expose stack traces or SQL details.
- Helmet sets common security headers. Terminate TLS at the app or a trusted reverse proxy.
- License key material is generated using Node's cryptographic random generator and only the hash is persisted.
- SQLite uses foreign keys, WAL mode, a busy timeout, parameterized statements, and transactions for device registration/activation.
- This is a licensing service, not a general user login system. It does not issue JWTs, sessions, refresh tokens, or OAuth credentials.
- Before production use, test backups/restore, configure HTTPS and monitoring, and consider a durable database server if deploying multiple app instances or requiring high write concurrency.
