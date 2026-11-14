# Security and privacy operations

- Never commit `.env`, credentials, database URLs, tokens, private keys, or
  customer exports. `.env.example` contains placeholders only.
- Keep production secrets in Render's environment secret store; rotate the
  TiDB password previously exposed outside that store.
- Keep HTTPS enabled, CORS restricted to exact origins, admin MFA enabled,
  and the trusted proxy setting limited to the actual hosting proxy.
- Keep database backups encrypted and access-controlled. Restrict staff access
  by role and remove access when it is no longer needed.
- Personal information includes contact details, service location, vehicle or
  solar-site details, booking and payment references, and service photos.
  Payment card/UPI credentials are handled by Cashfree and must not be stored by
  this app.
- Location permission is requested only when the customer selects the location
  feature. Exact service location is used to fulfil the booking and disclosed
  to the assigned worker and authorized operations staff.
- Marketing consent is optional and must remain separate from service
  fulfillment. Honor withdrawal, unsubscribe links, and push permission
  independently. Do not send promotional WhatsApp messages without applicable
  consent and an approved business template.
- Account deletion requests are recorded for operator handling. Before launch,
  publish and follow a retention schedule for identity, location, photos,
  support, and transaction records; preserve records only where needed for
  stated purposes or legal obligations, and document the basis and duration.
- For a suspected incident, restrict access, preserve relevant security logs,
  assess affected data and people, and follow the applicable statutory
  notification and response requirements. Maintain a named incident owner and
  escalation contacts before launch.

## DPDP readiness

The application provides a privacy notice, optional marketing consent and
withdrawal, push controls, support tickets, and an account-deletion request
path. These are implementation features, not a certification of compliance.
Before launch, the operator must verify the applicable commencement dates,
identify the Data Fiduciary and contact details, state each data purpose and
retention period in the notice, establish verifiable consent and rights-request
handling, vendor contracts, security safeguards, breach assessment/reporting,
and deletion/retention procedures with Indian counsel. Do not claim that every
DPDP Act or Rules obligation is already met.

Report security issues privately to the service operator; do not include live
customer data or credentials in a report.

