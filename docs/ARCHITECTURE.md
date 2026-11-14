# Architecture

QuickWashHub is a TypeScript/Express web application. Static customer, worker,
and admin interfaces are served from `public/`; JSON APIs are under
`/api/v1`. Prisma ORM with the MariaDB driver connects to MySQL protocol TiDB.
Authentication uses verified email/password or Google credentials, opaque
server-side sessions in the database, secure HTTP-only cookies, and role guards.
Cashfree handles new payment checkout; signed webhooks are the payment source
of truth. Private booking photos use S3-compatible object storage.

Important production boundaries:

- Only explicitly configured `PILOT_ZONE_IDS` are exposed to production.
- Paid booking activation is gated on Cashfree, Easy Split, legal contact,
  private storage, pilot zones, and policy-review configuration.
- Workers receive exact service location only after assignment.
- Marketing messages require recorded opt-in; push also requires browser
  permission.
- Personal data and booking APIs send `Cache-Control: private, no-store`.

The MySQL/TiDB schema and deploy migrations live in `prisma/migrations_mysql`.
The older PostgreSQL migration history is retained only for migration lineage;
it must not be deployed against the MySQL-protocol application database.

