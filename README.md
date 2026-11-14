# QuickWashHub car and bike wash platform

A responsive booking and operations website with MySQL/TiDB-backed accounts and bookings. There are no demo accounts or browser-only booking records. Sign in with verified email/password or Google. Twilio is not used.

## Run locally

Requirements: Node.js 22.12+, a MySQL-compatible database (TiDB Cloud MySQL protocol is supported), a Resend account for verification/reset emails, and a Google OAuth web client for Google sign-in.

1. Copy `.env.example` to `.env` and set `DATABASE_URL` and a private `AUTH_TOKEN_SECRET` of at least 32 random characters.
2. Configure Resend sender details (`RESEND_API_KEY`, `EMAIL_FROM`) and Google OAuth (`GOOGLE_CLIENT_ID`). For Google Cloud, create a Web application OAuth client and add the local site URL `http://localhost:4000` to its authorized JavaScript origins.
3. Point `DATABASE_URL` at a dedicated MySQL/TiDB database with TLS enabled and use private S3-compatible storage for photo uploads.
4. Run `npm install`, `npm run db:generate`, and `npm run db:migrate`.
5. Set `INITIAL_ADMIN_EMAIL` to your operator email and run `npm run db:bootstrap-admin` once. That account can activate using email registration/verification or Google sign-in with the same address.
6. Run `npm run dev` and open `http://localhost:4000`.

Run `npm test` for the local authenticator/MFA unit checks. The payment, email, map, push and database migration flows still need staging credentials for end-to-end verification.

Production admin operations require authenticator-app MFA. Sign in, open **Security**, add the displayed setup key to an authenticator, and confirm its six-digit code. The TOTP secret is encrypted in the database using a key derived from `AUTH_TOKEN_SECRET`; changing that secret later requires admins to enroll MFA again. Keep your authenticator app's account recovery options available before changing devices.

QuickWashHub is installable as a Progressive Web App in browsers that support the native install prompt. The app shell is cached for offline loading; account data, bookings, and payments still require a network connection. On a customer's first signed-in visit, the app shows a one-time install invitation. Safari on iPhone does not expose the same native install prompt, so the UI does not display manual installation steps there.

Customer navigation and the main booking, address, offers, and support screens offer English and Odia. The selection is stored in that browser on that device.

The first admin uses the map to set circular service zones, then creates services, prices and worker accounts. Customers can book a car/bike wash or request a residential/commercial Solar Wash quote. Solar requests are inspected and quoted by an admin before the customer can pay. Workers need an approved zone; solar work also requires the admin to mark them solar-qualified. Home Wash stays inactive in the beta.

## Environment

- `DATABASE_URL`, `DB_POOL_MAX`: MySQL/TiDB TLS connection and pool size. The URL must use `mysql://` and name an application database (for example `quickwashhub`), never a system schema such as `sys`.
- `AUTH_TOKEN_SECRET`: unique random secret with at least 32 characters.
- `CORS_ORIGIN`: exact website origin(s); HTTPS in production.
- `RESEND_API_KEY`, `EMAIL_FROM`: Resend API key and verified sender for verification/reset messages.
- `GOOGLE_CLIENT_ID`: Google OAuth Web client ID. Add every deployed HTTPS origin to its authorized JavaScript origins in Google Cloud Console.
- `GOOGLE_MAPS_API_KEY`: browser key for the admin zone map and customer address map. Enable Maps JavaScript API and Geocoding API; restrict the key to your website referrers and those APIs.
- `CASHFREE_CLIENT_ID`, `CASHFREE_CLIENT_SECRET`, `CASHFREE_ENV`, `CASHFREE_API_VERSION`: Cashfree PG credentials and environment. Set the Cashfree webhook URL to `/api/v1/payments/cashfree/webhook`.
- `CASHFREE_EASY_SPLIT_ENABLED=true`: set only after Cashfree confirms Easy Split activation for the merchant. Vendor accounts must be onboarded in Cashfree and their verified vendor ID added to the worker record.
- `PUBLIC_BOOKINGS_ENABLED=true`: keep false until the live Cashfree account and Easy Split, approved 42 Mouza zones, required legal/business details, and customer policies are ready. Cashfree sandbox remains the default.
- New Cashfree orders use Easy Split as the vendor payout path; they are excluded from the manual worker wallet credit to prevent paying the same job twice. Historical Razorpay/manual-settlement records keep their existing flow.
- Admins can initiate idempotent full or partial Cashfree refunds from a paid booking. If the order was split, the refund request includes a proportional vendor refund amount so Cashfree can adjust that vendor settlement. Pending refund statuses are polled every five minutes and can also be refreshed from the booking. A booking is marked fully refunded only when Cashfree confirms successful refunds covering the full captured amount. The admin reconciliation action stores Cashfree split/settlement data and refund history.
- `PILOT_ZONE_IDS`: comma-separated database IDs for the map zones approved for the 42 Mouza beta. Production catalog and paid-booking access stay unavailable until this list is configured.
- `BUSINESS_LEGAL_NAME`, `BUSINESS_ADDRESS`, `GRIEVANCE_OFFICER`, `GRIEVANCE_EMAIL`, `GRIEVANCE_PHONE`, `LEGAL_REVIEW_APPROVED=true`: public business/policy contact details and the explicit legal review gate. Set the approval flag only after the published policies are reviewed.
- `HOME_WASH_ENABLED=false`: keep Home Wash disabled for this beta.
- `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`: private S3/R2-compatible image storage. Allow website-origin PUT uploads with `Content-Type`, block public access, and set retention.
- `INITIAL_ADMIN_EMAIL`: only needed for one-time admin bootstrap.
- `TRUST_PROXY=true`: only behind one trusted reverse proxy.

After deployment, monitor `https://YOUR_API_HOST/health` (database readiness). Build with `npm run build`, run `npm run db:migrate` as a migration step, then start with `npm start`. Configure TLS, domain, backups, monitoring and restore drills on the host.

## Offers, push and WhatsApp

- Registration marketing consent is unchecked by default. Email and WhatsApp offers share the saved opt-in; browser push also requires the user to grant browser permission. The customer can change consent under **Offers & alerts** or use the unsubscribe link in a marketing email.
- Verified signups receive a 10% welcome coupon. The hourly lifecycle worker sends a fresh coupon 30 days after signup without a paid booking, and 30 days after the latest completed wash without a later paid booking. Coupon codes are single-use and expire after seven days.
- Vehicle coupon offers use the eligible basket: 1 vehicle up to 10%, 2 up to 15%, 3–4 up to 25%, 5 up to 30%; a mixed car/bike basket gets up to 20%. Only the highest eligible discount applies. It is capped to zone commission after `CASHFREE_FEE_PCT` and each zone’s minimum contribution setting. The worker earning is calculated from the undiscounted service total.
- Set `VAPID_SUBJECT`, `VAPID_PUBLIC_KEY`, and `VAPID_PRIVATE_KEY` for web push. Keep the private key in the hosting secret store. A local key pair can be generated with `node -e "console.log(require('web-push').generateVAPIDKeys())"`.
- Set `EVOLUTION_GO_BASE_URL` and the instance token in `EVOLUTION_GO_INSTANCE_TOKEN` to deliver operational no-worker alerts. The admin number defaults to `8260586748`; set `ADMIN_ALERT_EMAIL` or use `INITIAL_ADMIN_EMAIL` for email delivery. Evolution Go uses the instance API key in the `apikey` header and `/send/text` for this operational alert. [Evolution Go message API](https://github.com/evolution-foundation/evolution-go/blob/main/docs/wiki/guias-api/api-messages.md)
- Promotional WhatsApp messages require a business messaging provider and an approved template. Configure `WHATSAPP_MARKETING_SEND_URL`, `WHATSAPP_MARKETING_TOKEN`, and `WHATSAPP_MARKETING_TEMPLATE` for that provider. This endpoint receives JSON `{to, templateName, language, variables}` with a bearer token. Do not send customer promotions through a personal/session WhatsApp connection.
- Resend emails now use a branded HTML template. Keep `EMAIL_FROM` on a verified sender domain and set `PUBLIC_APP_URL` so buttons and unsubscribe links use the deployed website.

## PostgreSQL to TiDB MySQL migration

The app now uses the MySQL protocol with TiDB. Keep the old PostgreSQL source in the ignored `.env` as `SOURCE_DATABASE_URL`; set both `DATABASE_URL` and `TIDB_DATABASE_URL` to a TiDB URL with a dedicated application database, such as `/quickwashhub`. Do not point the app at `/sys` or another system schema. Rotate any password shared in chat before production use.

For a new empty target, run `npm run db:migrate` to apply the MySQL baseline, then `npm run db:tidb:backup`, `npm run db:tidb:migrate`, and `npm run db:tidb:verify`. The transfer checks source/target columns, row counts, and key booking/payment/worker-zone relationships. The source remains available for rollback; this is a point-in-time copy, so pause writes or repeat a verified copy immediately before production cutover if the PostgreSQL app kept accepting changes.

The imported database has been verified locally. Production cutover still requires deploying this MySQL-compatible app build and changing Render's `DATABASE_URL` to the rotated TiDB URL. Do not delete the old Render database until the new deployment passes health, login, booking, payment-webhook, and rollback checks. Production payments remain gated by the separate legal/Cashfree requirements.

## Implemented workflows

- Email/password registration, emailed verification, sign-in, password reset, Google sign-in, revocable database sessions and role guards.
- Guided bookings with customer contact, vehicle and address capture, vehicle service prices, solar quote requests, Cashfree webhook-confirmed payments and post-assignment Easy Split queue.
- Worker job feed and acceptance, job status, private before/after image uploads with GPS/time data, wallet ledger.
- Admin map-radius service zones, worker provisioning/KYC and solar qualification, solar quote review, photo reviews, campaigns, reports, payouts/UTR, support tickets and audit records.

Money uses integer paise. The browser payment response alone does not confirm a booking; the signed Cashfree webhook does. Solar requests cannot be paid until an administrator provides a final quote.

## Before accepting real customers

This is an MVP foundation, not launch certification. Before paid public bookings, verify the exact 42 Mouza circles, complete Cashfree PG and Easy Split approval/vendor onboarding, obtain CA/legal/tax review, publish correct business/grievance details, and complete the end-to-end staging checks. Refund execution and settlement reconciliation still need operator validation in the Cashfree merchant account; manual UTR payouts remain for historical/non-split flows. Production startup fails closed when pilot, payment, map, private-storage, or legal-contact gates are missing.
