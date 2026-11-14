# Deployment

## Render and TiDB

Use a dedicated MySQL-protocol TiDB application database (for example
`quickwashhub`), not `/sys` or another system database. Set Render `DATABASE_URL` to that
database's TLS connection URL. Keep all credentials in Render's secret
environment settings. Do not paste credentials into GitHub, issues, logs, or
screenshots. Rotate any credentials that have been exposed.

The production start command runs `prisma migrate deploy` before starting the
HTTP server. The migration CLI and `prisma.config.ts` are included in the
runtime image. A failed migration prevents the app from serving traffic. Ensure
Render uses the Dockerfile deployment path or the `npm start` command; do not
override it with `node dist/src/server.js`.

After deploy, check `/health`. It verifies both a database query and the
presence of core auth, booking, and notification tables. An incomplete schema
returns HTTP 503. Do not mark the service healthy or delete the source database
until row counts, login, booking, payment webhook, backup, and rollback checks
have passed.

## Release controls

CI runs on pull requests and pushes to `main`. In GitHub repository settings,
protect `main`: require pull requests, require the `verify` status check, block
force pushes and deletion, and dismiss stale approvals. Repository branch rules
cannot be enabled by an application deployment; an owner must configure them
in GitHub settings.

Set the custom domain and TLS in Render, configure daily managed database
backups and test a restore, and configure uptime/error alerts before public
launch. Use separate staging and production credentials. Restrict the Google
OAuth origins, CORS origins, Maps browser key, Cashfree webhook, and object
storage CORS policy to the deployed domains.

