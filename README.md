# QuickWashHub car and bike wash platform

A responsive booking and operations website with PostgreSQL-backed accounts and bookings. There are no demo accounts or browser-only booking records. Sign in with verified email/password or Google. Twilio is not used.

## Run locally

Requirements: Node.js 22.12+, PostgreSQL 16+, a Resend account for verification/reset emails, and a Google OAuth web client for Google sign-in.

1. Copy `.env.example` to `.env` and set `DATABASE_URL` and a private `AUTH_TOKEN_SECRET` of at least 32 random characters.
2. Configure Resend sender details (`RESEND_API_KEY`, `EMAIL_FROM`) and Google OAuth (`GOOGLE_CLIENT_ID`). For Google Cloud, create a Web application OAuth client and add the local site URL `http://localhost:4000` to its authorized JavaScript origins.
3. Start local dependencies using `docker compose up -d` if Docker is installed. Otherwise point `DATABASE_URL` at PostgreSQL and use private S3-compatible storage for photo uploads.
4. Run `npm install`, `npm run db:generate`, and `npm run db:migrate`.
5. Set `INITIAL_ADMIN_EMAIL` to your operator email and run `npm run db:bootstrap-admin` once. That account can activate using email registration/verification or Google sign-in with the same address.
6. Run `npm run dev` and open `http://localhost:4000`.

QuickWashHub is installable as a Progressive Web App in browsers that support the native install prompt. The app shell is cached for offline loading; account data, bookings, and payments still require a network connection. On a customer's first signed-in visit, the app shows a one-time install invitation. Safari on iPhone does not expose the same native install prompt, so the UI does not display manual installation steps there.

The first admin uses the map to set circular service zones, then creates services, prices and worker accounts. Customers can book a car/bike wash or request a residential/commercial Solar Wash quote. Solar requests are inspected and quoted by an admin before the customer can pay. Workers need an approved zone; solar work also requires the admin to mark them solar-qualified. Home Wash stays inactive in the beta.

## Environment

- `DATABASE_URL`, `DB_POOL_MAX`: PostgreSQL connection and pool size.
- `AUTH_TOKEN_SECRET`: unique random secret with at least 32 characters.
- `CORS_ORIGIN`: exact website origin(s); HTTPS in production.
- `RESEND_API_KEY`, `EMAIL_FROM`: Resend API key and verified sender for verification/reset messages.
- `GOOGLE_CLIENT_ID`: Google OAuth Web client ID. Add every deployed HTTPS origin to its authorized JavaScript origins in Google Cloud Console.
- `GOOGLE_MAPS_API_KEY`: browser key for the admin zone map and customer address map. Enable Maps JavaScript API and Geocoding API; restrict the key to your website referrers and those APIs.
- `CASHFREE_CLIENT_ID`, `CASHFREE_CLIENT_SECRET`, `CASHFREE_ENV`, `CASHFREE_API_VERSION`: Cashfree PG credentials and environment. Set the Cashfree webhook URL to `/api/v1/payments/cashfree/webhook`.
- `CASHFREE_EASY_SPLIT_ENABLED=true`: set only after Cashfree confirms Easy Split activation for the merchant. Vendor accounts must be onboarded in Cashfree and their verified vendor ID added to the worker record.
- `PILOT_ZONE_IDS`: comma-separated database IDs for the map zones approved for the 42 Mouza beta. Production will not start without this list.
- `BUSINESS_LEGAL_NAME`, `BUSINESS_ADDRESS`, `GRIEVANCE_OFFICER`, `GRIEVANCE_EMAIL`, `GRIEVANCE_PHONE`, `LEGAL_REVIEW_APPROVED=true`: public business/policy contact details and the explicit legal review gate. Set the approval flag only after the published policies are reviewed.
- `HOME_WASH_ENABLED=false`: keep Home Wash disabled for this beta.
- `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`: private S3/R2-compatible image storage. Allow website-origin PUT uploads with `Content-Type`, block public access, and set retention.
- `INITIAL_ADMIN_EMAIL`: only needed for one-time admin bootstrap.
- `TRUST_PROXY=true`: only behind one trusted reverse proxy.

After deployment, monitor `https://YOUR_API_HOST/health` (database readiness). Build with `npm run build`, run `npm run db:migrate` as a migration step, then start with `npm start`. Configure TLS, domain, backups, monitoring and restore drills on the host.

## Implemented workflows

- Email/password registration, emailed verification, sign-in, password reset, Google sign-in, revocable database sessions and role guards.
- Guided bookings with customer contact, vehicle and address capture, vehicle service prices, solar quote requests, Cashfree webhook-confirmed payments and post-assignment Easy Split queue.
- Worker job feed and acceptance, job status, private before/after image uploads with GPS/time data, wallet ledger.
- Admin map-radius service zones, worker provisioning/KYC and solar qualification, solar quote review, photo reviews, campaigns, reports, payouts/UTR, support tickets and audit records.

Money uses integer paise. The browser payment response alone does not confirm a booking; the signed Cashfree webhook does. Solar requests cannot be paid until an administrator provides a final quote.

## Before accepting real customers

This is an MVP foundation, not launch certification. Before paid public bookings, verify the exact 42 Mouza circles, complete Cashfree PG and Easy Split approval/vendor onboarding, obtain CA/legal/tax review, publish correct business/grievance details, and complete the end-to-end staging checks. Refund execution and settlement reconciliation still need operator validation in the Cashfree merchant account; manual UTR payouts remain for historical/non-split flows. Production startup fails closed when pilot, payment, map, private-storage, or legal-contact gates are missing.
