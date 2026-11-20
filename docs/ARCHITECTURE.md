# Architecture

QuickWashHub is a TypeScript/Express web application. Static customer, worker,
and admin interfaces are served from `public/`; JSON APIs are under
`/api/v1`. Prisma ORM with the MariaDB driver connects to MySQL protocol TiDB.
Authentication uses verified email/password or Google credentials, opaque
server-side sessions in the database, secure HTTP-only cookies, and role guards.
Cashfree handles new payment checkout; signed webhooks are the payment source
of truth. Private booking photos use S3-compatible object storage.

Important production boundaries:

- Only explicitly configured `ACTIVE_ZONE_IDS` are exposed to production (`PILOT_ZONE_IDS` remains a fallback during transition).
- Paid booking activation is gated on Cashfree, Easy Split, legal contact,
  private storage, pilot zones, and policy-review configuration.
- Workers receive exact service location only after assignment.
- Marketing messages require recorded opt-in; push also requires browser
  permission.
- Personal data and booking APIs send `Cache-Control: private, no-store`.

The MySQL/TiDB schema and deploy migrations live in `prisma/migrations_mysql`.
The older PostgreSQL migration history is retained only for migration lineage;
it must not be deployed against the MySQL-protocol application database.

## Geographic rollout and expansion

Service availability is represented by active map zones. Prices, worker-zone
assignments, customer addresses, and bookings reference zone IDs, so several
neighborhoods or cities can share the same deployment and database. The
production `ACTIVE_ZONE_IDS` allowlist is the release gate: admins may prepare
zones in advance, but only allowlisted zones are returned to customers or
accepted for bookings. The previous `PILOT_ZONE_IDS` name remains supported
for an existing deployment.

`SERVICE_AREA_LABEL` and the `MAP_*` environment settings configure public copy,
the initial map center/zoom, address-search country, and autocomplete bias.
Saved customer pins and the nearest configured zone center take precedence.
The current admin workflow creates circular zones up to 30 km, so a larger
contiguous area is covered by multiple zones, each with its own prices and
worker assignments. Expanding this configuration does not require a schema
migration for a single business using the same currency and provider setup.

This is rollout-ready for a controlled increase in zone count, not verified for
unbounded geographic or traffic scale. `zoneAt` currently reads active zone
geometry and checks candidates in application code. Before a many-city/high-
volume rollout, introduce a market entity, market-scoped activation and
provider/legal settings, indexed spatial candidate selection, and load tests.

