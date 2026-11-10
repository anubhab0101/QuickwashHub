# QuickWashHub car and bike wash platform

A responsive booking and operations website with PostgreSQL-backed accounts and bookings. There are no demo accounts or browser-only booking records. Sign in with verified email/password or Google. Twilio is not used.

## Run locally

Requirements: Node.js 22.12+, PostgreSQL 16+, a Resend account for verification/reset emails, and a Google OAuth web client for Google sign-in.

1. Copy `.env.example` to `.env` and fill `DATABASE_URL` and `AUTH_TOKEN_SECRET`.
2. Configure Resend sender details (`RESEND_API_KEY`, `EMAIL_FROM`) and Google OAuth (`GOOGLE_CLIENT_ID`). For Google Cloud, create a Web application OAuth client and add the local site URL `http://localhost:4000` to its authorized JavaScript origins.
3. Start local dependencies using `docker compose up -d` if Docker is installed. Otherwise point `DATABASE_URL` at your PostgreSQL instance and configure S3-compatible storage for photo uploads.
4. Run `npm install`, `npm run db:generate`, and `npm run db:migrate`.
5. Set `INITIAL_ADMIN_EMAIL` to your operator email and run `npm run db:bootstrap-admin` once. That account can activate using email registration/verification or Google sign-in with the same address.
6. Run `npm run dev` and open `http://localhost:4000`.

QuickWashHub is installable as a Progressive Web App in browsers that support the native install prompt. The app shell is cached for offline loading; account data, bookings, and payments still require a network connection. On a customer's first signed-in visit, the app shows a one-time install invitation. Safari on iPhone does not expose the same native install prompt, so the UI does not display manual installation steps there.

The first admin creates zones, services, prices and worker accounts. Customers register, verify their email, add a vehicle/address, book a wash and pay. Workers use their provisioned email, set a password through registration, or use Google Sign-In with that email. Email accounts support verification and password reset codes. Google credentials are verified by the API before issuing a session.

## Environment

- `DATABASE_URL`, `DB_POOL_MAX`: PostgreSQL connection and pool size.
- `AUTH_TOKEN_SECRET`: unique random secret with at least 32 characters.
- `CORS_ORIGIN`: exact website origin(s); HTTPS in production.
- `RESEND_API_KEY`, `EMAIL_FROM`: Resend API key and verified sender for verification/reset messages.
- `GOOGLE_CLIENT_ID`: Google OAuth Web client ID. Add every deployed HTTPS origin to its authorized JavaScript origins in Google Cloud Console.
- `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`: merchant credentials; configure `payment.captured` webhook at `/api/v1/payments/razorpay/webhook`.
- `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`: private S3/R2-compatible image storage. Allow website-origin PUT uploads with `Content-Type`, block public access, and set retention.
- `INITIAL_ADMIN_EMAIL`: only needed for one-time admin bootstrap.
- `TRUST_PROXY=true`: only behind one trusted reverse proxy.

After deployment, monitor `https://YOUR_API_HOST/health` (database readiness). Build with `npm run build`, run `npm run db:migrate` as a migration step, then start with `npm start`. Configure TLS, domain, backups, monitoring and restore drills on the host.

## Implemented workflows

- Email/password registration, emailed verification, sign-in, password reset, Google sign-in, revocable database sessions and role guards.
- Customer vehicles/addresses, service-zone pricing, bookings/history/cancellation and Razorpay webhook-confirmed payment.
- Worker job feed and acceptance, job status, private before/after image uploads with GPS/time data, wallet ledger.
- Admin worker provisioning/KYC status, zones and prices, booking assignment, photo reviews, campaigns, reports, payouts/UTR and audit records.

Money uses integer paise. The browser payment response alone does not confirm a booking; the signed Razorpay webhook does.

## Before accepting real customers

This is an MVP foundation, not a launch-certified service. Finish a staging run-through of registration, email delivery, Google OAuth, payment/webhook, booking, photo upload, cancellation and payouts. Remaining product/operations work includes map/geocoding, KYC document collection and review, refunds and settlement reconciliation, customer disputes, automated dispatch and notifications, shared rate limiting for multiple API instances, terms/privacy/cancellation policies, support, incident handling, security review and data retention. Payouts are currently recorded manually with a UTR. Existing phone-only accounts need an email assigned before they can use email or Google sign-in.
