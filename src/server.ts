import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import path from 'node:path';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { randomUUID, randomBytes, randomInt, createHash, scrypt as scryptCb, timingSafeEqual as safeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import rateLimit from 'express-rate-limit';
import { PrismaClient, BookingStatus, Role, VehicleType, WorkerType, KycStatus, PaymentStatus, LedgerType, PhotoType, PhotoStatus } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { z } from 'zod';
import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { OAuth2Client } from 'google-auth-library';
import { sendNotification, setVapidDetails } from 'web-push';
import { createMfaSecret, decryptMfaSecret, encryptMfaSecret, verifyTotp } from './security/admin-mfa.js';
import { calculateVehicleCouponDiscount } from './domain/coupon-pricing.js';

const app = express();
const connectionString = process.env.DATABASE_URL || '';
if (!connectionString) throw new Error('DATABASE_URL is required.');
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString, max: Math.max(2, Number(process.env.DB_POOL_MAX) || 10), connectionTimeoutMillis: 5000, idleTimeoutMillis: 30000 }) });
const port = Number(process.env.PORT || 4000);
const production = process.env.NODE_ENV === 'production';
const sessionCookie = 'quickwashhub_session';
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
const scrypt = promisify(scryptCb);
const signingSecret = process.env.AUTH_TOKEN_SECRET || '';
const allowedOrigins = process.env.CORS_ORIGIN?.split(',').map(function (x) { return x.trim(); }).filter(Boolean) || [];
const bucket = process.env.S3_BUCKET || '';
const s3 = process.env.S3_ENDPOINT && process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY ? new S3Client({ region: process.env.S3_REGION || 'auto', endpoint: process.env.S3_ENDPOINT, forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true', credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY } }) : null;
if (signingSecret.length < 32 || signingSecret.startsWith('replace_')) throw new Error('Set AUTH_TOKEN_SECRET to a unique random secret with at least 32 characters.');
const cashfreeId = process.env.CASHFREE_CLIENT_ID || '';
const cashfreeSecret = process.env.CASHFREE_CLIENT_SECRET || '';
const cashfreeEnv = process.env.CASHFREE_ENV === 'production' ? 'https://api.cashfree.com/pg' : 'https://sandbox.cashfree.com/pg';
const cashfreeVersion = process.env.CASHFREE_API_VERSION || '2026-01-01';
const easySplitEnabled = process.env.CASHFREE_EASY_SPLIT_ENABLED === 'true';
const pilotZoneIds = (process.env.PILOT_ZONE_IDS || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean);
const pilotZoneWhere = production || pilotZoneIds.length ? { id: { in: pilotZoneIds } } : {};
const publicPaymentsReady = production && process.env.PUBLIC_BOOKINGS_ENABLED === 'true' && process.env.CASHFREE_ENV === 'production' && !!cashfreeId && !!cashfreeSecret && easySplitEnabled && !!s3 && !!bucket && !!process.env.GOOGLE_MAPS_API_KEY && pilotZoneIds.length > 0 && process.env.LEGAL_REVIEW_APPROVED === 'true' && !!process.env.BUSINESS_LEGAL_NAME && !!process.env.BUSINESS_ADDRESS && !!process.env.GRIEVANCE_OFFICER && !!process.env.GRIEVANCE_EMAIL && !!process.env.GRIEVANCE_PHONE;
if (production && (!process.env.CORS_ORIGIN || !process.env.RESEND_API_KEY || !process.env.EMAIL_FROM || !process.env.GOOGLE_CLIENT_ID || !s3 || !bucket)) throw new Error('Production requires exact CORS origin, email delivery, Google OAuth and private object storage credentials. Payments remain disabled until all beta launch gates are completed.');
if (production && allowedOrigins.some(function (origin) { return origin === '*' || new URL(origin).protocol !== 'https:'; })) throw new Error('Production CORS origins must be exact HTTPS origins.');
const storageOrigin = process.env.S3_ENDPOINT ? new URL(process.env.S3_ENDPOINT).origin : '';
const pushReady = !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
if (pushReady) setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:support@quickwashhub.com', process.env.VAPID_PUBLIC_KEY!, process.env.VAPID_PRIVATE_KEY!);

app.disable('x-powered-by');
app.set('trust proxy', process.env.TRUST_PROXY === 'true' ? 1 : false);
app.use(helmet({ crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' }, contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], scriptSrc: ["'self'", 'https://sdk.cashfree.com', 'https://accounts.google.com', 'https://maps.googleapis.com', 'https://maps.gstatic.com'], styleSrc: ["'self'", 'https://fonts.googleapis.com', 'https://accounts.google.com/gsi/style'], fontSrc: ["'self'", 'https://fonts.gstatic.com'], imgSrc: ["'self'", 'data:', 'blob:', storageOrigin, 'https://*.googleusercontent.com', 'https://*.googleapis.com', 'https://*.gstatic.com'].filter(Boolean), connectSrc: ["'self'", 'https://api.cashfree.com', 'https://sandbox.cashfree.com', 'https://accounts.google.com', 'https://oauth2.googleapis.com', 'https://maps.googleapis.com', 'https://maps.gstatic.com', storageOrigin].filter(Boolean), frameSrc: ["'self'", 'https://sdk.cashfree.com', 'https://payments.cashfree.com', 'https://accounts.google.com'], objectSrc: ["'none'"], baseUri: ["'self'"] } } }));
if (allowedOrigins.length) app.use(cors({ origin: allowedOrigins, credentials: true }));
app.use('/api/v1/payments/razorpay/webhook', express.raw({ type: 'application/json', limit: '2mb' }));
app.use('/api/v1/payments/cashfree/webhook', express.raw({ type: 'application/json', limit: '2mb' }));
app.use(express.json({ limit: '1mb' }));
app.use('/api/v1', function (req, res, next) { res.setHeader('Cache-Control', 'private, no-store'); const started = Date.now(); res.on('finish', function () { const safePath = req.path.replace(/\/[a-z0-9_-]{20,}/gi, '/:id'); const durationMs = Date.now() - started; console.info('api.request', JSON.stringify({ method: req.method, path: safePath, status: res.statusCode, durationMs })); }); next(); });

function getCookie(req: Request): string | undefined {
  const item = (req.headers.cookie || '').split(';').map(function (x) { return x.trim(); }).find(function (x) { return x.startsWith(sessionCookie + '='); });
  return item ? item.slice(sessionCookie.length + 1) : undefined;
}
function issueToken(data: object): string {
  const head = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(data)).toString('base64url');
  const sig = createHmac('sha256', signingSecret).update(head + '.' + body).digest('base64url');
  return head + '.' + body + '.' + sig;
}
function decodeToken(token: string): { sub: string; sid: string; exp: number } {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Invalid session');
  const expected = createHmac('sha256', signingSecret).update(parts[0] + '.' + parts[1]).digest();
  const actual = Buffer.from(parts[2], 'base64url');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error('Invalid session');
  const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
  if (claims.exp < Date.now() / 1000) throw new Error('Expired session');
  return claims;
}
function authenticated(roles: Role[] = []) {
  return async function (req: Request, res: Response, next: NextFunction) {
    try {
      const token = getCookie(req);
      if (!token) return res.status(401).json({ error: 'Please sign in.' });
      const claims = decodeToken(token);
      const session = await db.authSession.findUnique({ where: { id: claims.sid }, include: { user: true } });
      if (!session || session.userId !== claims.sub || session.expiresAt < new Date() || !session.user.isActive) return res.status(401).json({ error: 'Session expired. Sign in again.' });
      if (roles.length && !roles.includes(session.user.role)) return res.status(403).json({ error: 'Not allowed for this account.' });
      res.locals.user = session.user;
      res.locals.sessionId = session.id;
      next();
    } catch { res.status(401).json({ error: 'Please sign in.' }); }
  };
}
const customer = authenticated([Role.CUSTOMER]);
const worker = authenticated([Role.WORKER]);
const adminAuth = authenticated([Role.ADMIN]);
const admin = function (req: Request, res: Response, next: NextFunction) {
  return adminAuth(req, res, function () {
    const pathOnly = req.originalUrl.split('?')[0];
    if (production && !res.locals.user.adminMfaSecretEnc && !pathOnly.startsWith('/api/v1/admin/security/mfa')) return res.status(403).json({ error: 'Set up authenticator MFA before using admin operations.' });
    next();
  });
};
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 5, standardHeaders: true, legacyHeaders: false });
const apiLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 600, standardHeaders: true, legacyHeaders: false });
app.use('/api/v1', apiLimiter);

app.get('/health', async function (_req, res) {
  try { await db.$queryRaw`SELECT 1`; res.json({ status: 'ok', checks: { database: 'ok' } }); }
  catch { res.status(503).json({ status: 'error', checks: { database: 'unavailable' } }); }
});
app.get('/api/v1', function (_req, res) { res.json({ name: 'QuickWashHub Car & Bike Wash API', version: 'v1' }); });
app.get('/api/v1/auth/config', function (_req, res) { res.json({ googleClientId: process.env.GOOGLE_CLIENT_ID || null }); });
app.get('/api/v1/public/business-info', function (_req, res) { res.setHeader('Cache-Control', 'public, max-age=300'); res.json({ legalName: process.env.BUSINESS_LEGAL_NAME || 'QuickWashHub', address: process.env.BUSINESS_ADDRESS || 'To be provided before launch', grievanceOfficer: process.env.GRIEVANCE_OFFICER || 'Grievance Officer', grievanceEmail: process.env.GRIEVANCE_EMAIL || '', grievancePhone: process.env.GRIEVANCE_PHONE || '', legalReviewApproved: process.env.LEGAL_REVIEW_APPROVED === 'true', betaArea: '42 Mouza, Cuttack, Odisha' }); });

const emailBody = z.string().trim().email().max(254).transform(function (x) { return x.toLowerCase(); });
const passwordBody = z.string().min(10).max(128);
async function passwordHash(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const hash = await scrypt(password, salt, 64) as Buffer;
  return salt + ':' + hash.toString('hex');
}
async function passwordMatches(password: string, stored: string): Promise<boolean> {
  const [salt, expectedHex] = stored.split(':');
  if (!salt || !expectedHex) return false;
  const expected = Buffer.from(expectedHex, 'hex');
  const actual = await scrypt(password, salt, expected.length) as Buffer;
  return expected.length === actual.length && safeEqual(expected, actual);
}
function challengeHash(email: string, type: string, code: string): string {
  return createHmac('sha256', signingSecret).update(email + ':' + type + ':' + code).digest('hex');
}
function htmlEscape(input: string): string { return input.replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!; }); }
function brandedEmail(title: string, intro: string, content: string, ctaUrl?: string, unsubscribeUrl?: string, marketing = false) {
  const button = ctaUrl ? '<p style="margin:28px 0 8px"><a href="' + htmlEscape(ctaUrl) + '" style="display:inline-block;background:#173d2c;color:#fff;text-decoration:none;padding:14px 22px;border-radius:8px;font-weight:700">Open QuickWashHub</a></p>' : '';
  const footer = marketing ? 'You’re receiving this marketing email because you opted in to QuickWashHub offers.' + (unsubscribeUrl ? ' <a href="' + htmlEscape(unsubscribeUrl) + '" style="color:#26714d">Unsubscribe</a>.' : '') : 'QuickWashHub customer support · Cuttack, Odisha';
  return '<div style="margin:0;background:#f3f5f1;padding:32px 12px;font-family:Arial,Helvetica,sans-serif;color:#17241b"><div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e3e8e1;border-radius:16px;overflow:hidden"><div style="padding:22px 28px;background:#173d2c;color:#fff;font-size:18px;font-weight:700">QuickWashHub <span style="color:#d9f08a">·</span></div><div style="padding:30px 28px"><div style="font-size:11px;letter-spacing:1.5px;color:#26714d;font-weight:700;text-transform:uppercase">CAR &amp; BIKE CARE, AT YOUR DOOR</div><h1 style="margin:10px 0 12px;font-size:26px;line-height:1.2;color:#17241b">' + htmlEscape(title) + '</h1><p style="margin:0;color:#5d6b61;font-size:15px;line-height:1.65">' + htmlEscape(intro) + '</p><div style="margin-top:20px;padding:18px;background:#f5f7f2;border-radius:10px;color:#26362b;font-size:14px;line-height:1.65">' + content + '</div>' + button + '<p style="margin:26px 0 0;color:#879189;font-size:11px;line-height:1.6">' + footer + '</p></div></div></div>';
}
async function sendEmail(to: string, subject: string, text: string, html?: string) {
  if (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM) throw new Error('Email delivery is not configured.');
  const response = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: 'Bearer ' + process.env.RESEND_API_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ from: process.env.EMAIL_FROM, to: [to], subject, text, ...(html ? { html } : {}) }) });
  if (!response.ok) throw new Error('Email delivery failed.');
}
function phoneForWhatsApp(phone: string) { const digits = phone.replace(/\D/g, ''); return digits.length === 10 ? '91' + digits : digits; }
async function enqueueDelivery(input: { userId?: string; bookingId?: string; channel: string; recipient: string; template: string; payload: Record<string, unknown>; dedupeKey: string }) {
  if (!input.recipient) return;
  await db.notificationDelivery.upsert({ where: { dedupeKey: input.dedupeKey }, create: { ...input, payload: input.payload as any }, update: {} });
}
async function queueCouponNotifications(userId: string, code: string, discountPct: number, trigger: string) {
  const user = await db.user.findUnique({ where: { id: userId }, include: { pushSubscriptions: true } });
  if (!user || !user.marketingConsentAt || user.marketingConsentRevokedAt) return;
  const expires = new Date(Date.now() + 7 * 86400000);
  const title = trigger === 'SIGNUP_30D' || trigger === 'WELCOME_VERIFIED' ? 'A welcome offer for your first wash' : 'A fresh offer for your next wash';
  const text = 'Use code ' + code + ': 1 vehicle up to 10%, 2 up to 15%, 3–4 up to 25%, 5+ up to 30%; a mixed car-and-bike order up to 20%. Final discount is capped by the zone margin. Valid for 7 days; terms apply.';
  const coupon = await db.coupon.create({ data: { userId, code, trigger, discountPct, expiresAt: expires } });
  const payload = { subject: title + ' · QuickWashHub', title, intro: text, code, discountPct, expiresAt: expires.toISOString() };
  if (user.email) await enqueueDelivery({ userId, channel: 'EMAIL', recipient: user.email, template: 'COUPON', payload, dedupeKey: 'coupon:' + coupon.id + ':email' });
  if (user.phone && process.env.WHATSAPP_MARKETING_SEND_URL && process.env.WHATSAPP_MARKETING_TOKEN) await enqueueDelivery({ userId, channel: 'WHATSAPP_MARKETING', recipient: phoneForWhatsApp(user.phone), template: process.env.WHATSAPP_MARKETING_TEMPLATE || 'quickwashhub_coupon_offer', payload, dedupeKey: 'coupon:' + coupon.id + ':whatsapp' });
  if (user.phone && !process.env.WHATSAPP_MARKETING_SEND_URL) console.info('marketing.whatsapp_skipped', JSON.stringify({ userId, reason: 'approved_template_provider_not_configured' }));
  for (const subscription of user.pushSubscriptions) await enqueueDelivery({ userId, channel: 'PUSH', recipient: subscription.endpoint, template: 'COUPON', payload: { title, body: text, url: '/', keys: subscription.keys }, dedupeKey: 'coupon:' + coupon.id + ':push:' + createHash('sha256').update(subscription.endpoint).digest('hex').slice(0, 16) });
}
async function queueUnassignedWorkerAlert(bookingId: string) {
  const booking = await db.booking.findUnique({ where: { id: bookingId }, include: { service: true, zone: true, customer: { select: { name: true, phone: true } } } });
  if (!booking || booking.workerId || !([BookingStatus.PAID, BookingStatus.ASSIGNING] as BookingStatus[]).includes(booking.status)) return;
  const solar = booking.service.category === 'SOLAR';
  const candidates = await db.worker.findMany({ where: { isOnline: true, kycStatus: KycStatus.APPROVED, user: { isActive: true }, ...(solar ? { solarQualified: true } : {}) }, select: { currentLat: true, currentLng: true, zones: { select: { zoneId: true } } } });
  if (candidates.some(function (candidate) { return candidate.zones.some(function (link) { return link.zoneId === booking.zoneId; }) || (candidate.currentLat != null && candidate.currentLng != null && zoneContainsPoint(booking.zone, candidate.currentLat, candidate.currentLng)); })) return;
  await db.booking.updateMany({ where: { id: booking.id, workerId: null, status: BookingStatus.PAID }, data: { status: BookingStatus.ASSIGNING } });
  const configuredAdminEmail = process.env.ADMIN_ALERT_EMAIL || process.env.INITIAL_ADMIN_EMAIL;
  const adminEmail = configuredAdminEmail || (await db.user.findFirst({ where: { role: Role.ADMIN, isActive: true, email: { not: null } }, orderBy: { createdAt: 'asc' }, select: { email: true } }))?.email || undefined;
  if (adminEmail) await enqueueDelivery({ bookingId, channel: 'EMAIL', recipient: adminEmail, template: 'NO_ELIGIBLE_WORKER', payload: { subject: 'Action needed: booking has no available worker', bookingId, zone: booking.zone.name, service: booking.service.name, customer: booking.customer.name || 'Customer' }, dedupeKey: 'no-worker:' + bookingId + ':email' });
  const alertNumber = phoneForWhatsApp(process.env.ADMIN_ALERT_WHATSAPP || '8260586748');
  if (process.env.EVOLUTION_GO_BASE_URL && process.env.EVOLUTION_GO_INSTANCE_TOKEN) await enqueueDelivery({ bookingId, channel: 'WHATSAPP_ALERT', recipient: alertNumber, template: 'NO_ELIGIBLE_WORKER', payload: { text: 'QuickWashHub: paid booking ' + bookingId + ' for ' + booking.service.name + ' in ' + booking.zone.name + ' has no eligible online worker. Please assign or resolve.' }, dedupeKey: 'no-worker:' + bookingId + ':whatsapp' });
  console.warn('booking.no_eligible_worker', JSON.stringify({ bookingId, zoneId: booking.zoneId }));
}
async function sendQueuedDelivery(delivery: any) {
  const data = delivery.payload as Record<string, any>;
  if (delivery.channel === 'EMAIL') {
    const content = data.code ? '<div style="font-size:12px;color:#5d6b61">YOUR OFFER CODE</div><div style="margin-top:5px;font-size:26px;font-weight:800;letter-spacing:2px;color:#173d2c">' + htmlEscape(String(data.code)) + '</div><div style="margin-top:7px">1 vehicle up to 10% · 2 up to 15% · 3–4 up to 25% · 5+ up to 30% · mixed car and bike up to 20%. Final discount is capped by zone margin. Valid for 7 days.</div>' : '<strong>Booking:</strong> ' + htmlEscape(String(data.bookingId)) + '<br><strong>Service:</strong> ' + htmlEscape(String(data.service)) + '<br><strong>Zone:</strong> ' + htmlEscape(String(data.zone)) + '<br><strong>Customer:</strong> ' + htmlEscape(String(data.customer));
    const publicBaseUrl = process.env.PUBLIC_APP_URL || allowedOrigins[0] || 'http://localhost:' + port;
    const unsubscribeUrl = delivery.userId ? publicBaseUrl.replace(/\/$/, '') + '/api/v1/marketing/unsubscribe?token=' + encodeURIComponent(issueToken({ sub: delivery.userId, sid: 'marketing-unsubscribe', exp: Math.floor(Date.now() / 1000) + 30 * 86400 })) : undefined;
    const html = brandedEmail(String(data.title || data.subject || 'QuickWashHub update'), String(data.intro || data.text || 'A QuickWashHub update is ready.'), content, data.code ? publicBaseUrl : undefined, unsubscribeUrl, !!data.code);
    await sendEmail(delivery.recipient, String(data.subject || 'QuickWashHub update'), String(data.intro || data.text || JSON.stringify(data)), html);
    return;
  }
  if (delivery.channel === 'WHATSAPP_ALERT') {
    const response = await fetch((process.env.EVOLUTION_GO_BASE_URL || '').replace(/\/$/, '') + '/send/text', { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: process.env.EVOLUTION_GO_INSTANCE_TOKEN || '' }, body: JSON.stringify({ number: delivery.recipient, text: String(data.text || '') }) });
    if (!response.ok) throw new Error('Evolution Go rejected the operational alert.');
    return;
  }
  if (delivery.channel === 'WHATSAPP_MARKETING') {
    const response = await fetch(process.env.WHATSAPP_MARKETING_SEND_URL!, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + process.env.WHATSAPP_MARKETING_TOKEN }, body: JSON.stringify({ to: delivery.recipient, templateName: delivery.template, language: 'en', variables: [String(data.code), '1=10%; 2=15%; 3-4=25%; 5+=30%; mixed=20%', String(data.expiresAt)] }) });
    if (!response.ok) throw new Error('Approved WhatsApp template provider rejected the campaign message.');
    return;
  }
  if (delivery.channel === 'PUSH') {
    if (!pushReady) throw new Error('VAPID push credentials are not configured.');
    try { await sendNotification({ endpoint: delivery.recipient, keys: data.keys as any }, JSON.stringify({ title: data.title, body: data.body, url: data.url })); }
    catch (error: any) { if (error?.statusCode === 404 || error?.statusCode === 410) { await db.pushSubscription.deleteMany({ where: { endpoint: delivery.recipient } }); return; } throw error; }
    return;
  }
}
let deliveryLoopBusy = false;
async function processDeliveryQueue() {
  if (deliveryLoopBusy) return; deliveryLoopBusy = true;
  try {
    const now = new Date();
    const rows = await db.notificationDelivery.findMany({ where: { OR: [{ status: 'PENDING', nextAttemptAt: { lte: now } }, { status: 'SENDING', nextAttemptAt: { lte: now } }] }, orderBy: { createdAt: 'asc' }, take: 25 });
    for (const row of rows) {
      const claim = await db.notificationDelivery.updateMany({ where: { id: row.id, status: row.status, nextAttemptAt: { lte: now } }, data: { status: 'SENDING', attempts: { increment: 1 }, nextAttemptAt: new Date(Date.now() + 5 * 60 * 1000) } });
      if (!claim.count) continue;
      try {
      if (row.userId && ['EMAIL', 'WHATSAPP_MARKETING', 'PUSH'].includes(row.channel)) {
        const consent = await db.user.findUnique({ where: { id: row.userId }, select: { marketingConsentAt: true, marketingConsentRevokedAt: true } });
        if (!consent?.marketingConsentAt || consent.marketingConsentRevokedAt) {
          await db.notificationDelivery.update({ where: { id: row.id }, data: { status: 'CANCELLED', lastError: 'Customer marketing consent is no longer active.' } });
          continue;
        }
      }
      await sendQueuedDelivery(row);
        await db.notificationDelivery.update({ where: { id: row.id }, data: { status: 'SENT', sentAt: new Date(), lastError: null } });
      } catch (error) {
        const attempts = row.attempts + 1, status = attempts >= 8 ? 'FAILED' : 'PENDING';
        const delay = Math.min(6 * 60 * 60 * 1000, 30_000 * (2 ** Math.min(attempts - 1, 9)));
        await db.notificationDelivery.update({ where: { id: row.id }, data: { status, lastError: String(error).slice(0, 500), nextAttemptAt: new Date(Date.now() + delay) } });
      }
    }
  } catch (error) { console.error('notification.queue_failed', error); }
  finally { deliveryLoopBusy = false; }
}
async function processMarketingMilestones() {
  const now = new Date(), signupBefore = new Date(now.getTime() - 30 * 86400000);
  const customers = await db.user.findMany({ where: { role: Role.CUSTOMER, emailVerifiedAt: { not: null }, marketingConsentAt: { not: null }, marketingConsentRevokedAt: null, isActive: true }, select: { id: true, createdAt: true }, orderBy: { createdAt: 'asc' }, take: 1000 });
  for (const customer of customers) {
    if (customer.createdAt <= signupBefore) {
      const hasPaid = await db.booking.findFirst({ where: { customerId: customer.id, payment: { is: { status: PaymentStatus.VERIFIED } } }, select: { id: true } });
      if (!hasPaid && !await db.coupon.findFirst({ where: { userId: customer.id, trigger: 'SIGNUP_30D' }, select: { id: true } })) await queueCouponNotifications(customer.id, 'QWH' + randomBytes(3).toString('hex').toUpperCase(), 10, 'SIGNUP_30D');
    }
    const completed = await db.booking.findFirst({ where: { customerId: customer.id, status: BookingStatus.COMPLETED, completedAt: { not: null } }, orderBy: { completedAt: 'desc' }, select: { id: true, completedAt: true } });
    if (completed?.completedAt && completed.completedAt <= signupBefore) {
      const repeated = await db.booking.findFirst({ where: { customerId: customer.id, payment: { is: { status: PaymentStatus.VERIFIED, paidAt: { gt: completed.completedAt } } } }, select: { id: true } });
      const trigger = 'COMPLETED_30D:' + completed.id;
      if (!repeated && !await db.coupon.findFirst({ where: { userId: customer.id, trigger }, select: { id: true } })) await queueCouponNotifications(customer.id, 'QWH' + randomBytes(3).toString('hex').toUpperCase(), 15, trigger);
    }
  }
}
let milestonesLoopBusy = false;
async function runMarketingMilestones() {
  if (milestonesLoopBusy) return; milestonesLoopBusy = true;
  try { await processMarketingMilestones(); } catch (error) { console.error('marketing.milestones_failed', error); }
  finally { milestonesLoopBusy = false; }
}
async function retryUnassignedAlerts() {
  try { const rows = await db.booking.findMany({ where: { status: BookingStatus.ASSIGNING, workerId: null }, select: { id: true }, take: 50 }); for (const booking of rows) await queueUnassignedWorkerAlert(booking.id); }
  catch (error) { console.error('booking.alert_scan_failed', error); }
}
async function startSession(user: { id: string; email: string | null; phone: string | null; name: string | null; role: Role; isActive: boolean }, res: Response) {
  if (!user.isActive) throw new Error('ACCOUNT_DISABLED');
  const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000);
  const session = await db.authSession.create({ data: { userId: user.id, expiresAt } });
  const token = issueToken({ sub: user.id, sid: session.id, exp: Math.floor(expiresAt.getTime() / 1000) });
  res.cookie(sessionCookie, token, { httpOnly: true, secure: production, sameSite: 'strict', path: '/', maxAge: 8 * 60 * 60 * 1000 });
  res.json({ user: { id: user.id, name: user.name, email: user.email, role: user.role } });
}
function mfaChallengeToken(userId: string) { return issueToken({ sub: userId, sid: 'admin-mfa-challenge', exp: Math.floor(Date.now() / 1000) + 300 }); }
async function finishSignIn(user: { id: string; email: string | null; phone: string | null; name: string | null; role: Role; isActive: boolean; adminMfaSecretEnc?: string | null }, res: Response) {
  if (!user.isActive) throw new Error('ACCOUNT_DISABLED');
  if (user.role === Role.ADMIN && user.adminMfaSecretEnc) return res.json({ requiresMfa: true, challengeToken: mfaChallengeToken(user.id) });
  await startSession(user, res);
}
const challengeLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 5, standardHeaders: true, legacyHeaders: false });
app.post('/api/v1/auth/register', challengeLimiter, async function (req, res) {
  const p = z.object({ email: emailBody, name: z.string().trim().min(1).max(100), password: passwordBody, marketingOptIn: z.boolean().optional().default(false) }).safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: 'Enter a valid email, name and password with at least 10 characters.' });
  try {
    let user = await db.user.findUnique({ where: { email: p.data.email } });
    if (user?.passwordHash && user.emailVerifiedAt) return res.status(409).json({ error: 'An account already exists. Sign in or reset its password.' });
    const hash = await passwordHash(p.data.password);
    user = user ? await db.user.update({ where: { id: user.id }, data: { name: p.data.name, passwordHash: hash, ...(p.data.marketingOptIn ? { marketingConsentAt: new Date(), marketingConsentRevokedAt: null } : {}) } }) : await db.user.create({ data: { email: p.data.email, name: p.data.name, passwordHash: hash, role: Role.CUSTOMER, ...(p.data.marketingOptIn ? { marketingConsentAt: new Date() } : {}) } });
    const code = String(randomInt(0, 1000000)).padStart(6, '0');
    await db.authChallenge.deleteMany({ where: { email: p.data.email, type: 'VERIFY_EMAIL' } });
    await db.authChallenge.create({ data: { email: p.data.email, userId: user.id, type: 'VERIFY_EMAIL', codeHash: challengeHash(p.data.email, 'VERIFY_EMAIL', code), expiresAt: new Date(Date.now() + 15 * 60 * 1000) } });
    await sendEmail(p.data.email, 'Verify your QuickWashHub account', 'Your verification code is ' + code + '. It expires in 15 minutes.', brandedEmail('Verify your email', 'Use this secure verification code to activate your QuickWashHub account.', '<div style="font-size:12px;color:#5d6b61">YOUR VERIFICATION CODE</div><div style="margin-top:6px;font-size:30px;font-weight:800;letter-spacing:8px;color:#173d2c">' + code + '</div><div style="margin-top:8px;color:#5d6b61">This code expires in 15 minutes. If you did not request it, you can ignore this email.</div>'));
    res.status(202).json({ message: 'Check your email for a verification code.' });
  } catch (error) { console.error('Registration email delivery failed', error); res.status(503).json({ error: 'Could not create the account or send verification email. Try again shortly.' }); }
});
app.post('/api/v1/auth/verify-email', challengeLimiter, async function (req, res) {
  const p = z.object({ email: emailBody, code: z.string().regex(/^\d{6}$/) }).safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: 'Enter a valid email and six-digit code.' });
  const challenge = await db.authChallenge.findFirst({ where: { email: p.data.email, type: 'VERIFY_EMAIL', consumedAt: null, expiresAt: { gt: new Date() } }, orderBy: { createdAt: 'desc' } });
  if (!challenge || challenge.attempts >= 5 || challenge.codeHash !== challengeHash(p.data.email, 'VERIFY_EMAIL', p.data.code)) {
    if (challenge) await db.authChallenge.update({ where: { id: challenge.id }, data: { attempts: { increment: 1 } } });
    return res.status(401).json({ error: 'Verification code is invalid or expired.' });
  }
  await db.$transaction([db.authChallenge.update({ where: { id: challenge.id }, data: { consumedAt: new Date() } }), db.user.update({ where: { id: challenge.userId! }, data: { emailVerifiedAt: new Date() } })]);
  const user = await db.user.findUniqueOrThrow({ where: { id: challenge.userId! } });
  if (user.marketingConsentAt && !user.marketingConsentRevokedAt) try { await queueCouponNotifications(user.id, 'QWH' + randomBytes(3).toString('hex').toUpperCase(), 10, 'WELCOME_VERIFIED'); } catch (error) { console.error('welcome.coupon_queue_failed', error); }
  try { await finishSignIn(user, res); } catch { return res.status(403).json({ error: 'This account is disabled.' }); }
});
app.post('/api/v1/auth/login', challengeLimiter, async function (req, res) {
  const p = z.object({ email: emailBody, password: passwordBody }).safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: 'Email or password is invalid.' });
  const user = await db.user.findUnique({ where: { email: p.data.email } });
  if (!user?.passwordHash || !await passwordMatches(p.data.password, user.passwordHash)) return res.status(401).json({ error: 'Email or password is incorrect.' });
  if (!user.emailVerifiedAt) return res.status(403).json({ error: 'Verify your email before signing in.' });
  try { await finishSignIn(user, res); } catch { return res.status(403).json({ error: 'This account is disabled.' }); }
});
app.post('/api/v1/auth/admin/mfa/verify', challengeLimiter, async function (req, res) {
  const p = z.object({ challengeToken: z.string().min(20).max(2000), code: z.string().regex(/^\d{6}$/) }).strict().safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: 'Enter the six-digit authenticator code.' });
  try {
    const claims = decodeToken(p.data.challengeToken);
    if (claims.sid !== 'admin-mfa-challenge') return res.status(401).json({ error: 'The admin sign-in challenge is invalid or expired.' });
    const user = await db.user.findUnique({ where: { id: claims.sub } });
    if (!user || user.role !== Role.ADMIN || !user.isActive || !user.adminMfaSecretEnc || !verifyTotp(decryptMfaSecret(user.adminMfaSecretEnc, signingSecret), p.data.code)) return res.status(401).json({ error: 'Authenticator code is invalid or expired.' });
    await startSession(user, res);
  } catch { if (!res.headersSent) res.status(401).json({ error: 'The admin sign-in challenge is invalid or expired.' }); }
});
app.get('/api/v1/admin/security/mfa', admin, function (_req, res) { res.json({ enabled: !!res.locals.user.adminMfaSecretEnc, required: production }); });
app.post('/api/v1/admin/security/mfa/setup', admin, async function (_req, res) {
  if (res.locals.user.adminMfaSecretEnc) return res.status(409).json({ error: 'Authenticator MFA is already enabled. Verify a code to disable it before setting up a new device.' });
  const secret = createMfaSecret();
  await db.user.update({ where: { id: res.locals.user.id }, data: { adminMfaPendingSecretEnc: encryptMfaSecret(secret, signingSecret), adminMfaPendingExpiresAt: new Date(Date.now() + 10 * 60_000) } });
  const label = encodeURIComponent('QuickWashHub:' + (res.locals.user.email || res.locals.user.id));
  res.json({ secret, otpauthUrl: 'otpauth://totp/' + label + '?secret=' + secret + '&issuer=QuickWashHub&algorithm=SHA1&digits=6&period=30', expiresInSeconds: 600 });
});
app.post('/api/v1/admin/security/mfa/confirm', admin, async function (req, res) {
  const p = z.object({ code: z.string().regex(/^\d{6}$/) }).strict().safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: 'Enter the six-digit authenticator code.' });
  const user = await db.user.findUnique({ where: { id: res.locals.user.id } });
  if (!user?.adminMfaPendingSecretEnc || !user.adminMfaPendingExpiresAt || user.adminMfaPendingExpiresAt <= new Date()) return res.status(409).json({ error: 'MFA setup expired. Start setup again.' });
  if (!verifyTotp(decryptMfaSecret(user.adminMfaPendingSecretEnc, signingSecret), p.data.code)) return res.status(401).json({ error: 'Authenticator code is invalid. Check the device time and try again.' });
  await db.$transaction([
    db.user.update({ where: { id: user.id }, data: { adminMfaSecretEnc: user.adminMfaPendingSecretEnc, adminMfaPendingSecretEnc: null, adminMfaPendingExpiresAt: null } }),
    db.authSession.deleteMany({ where: { userId: user.id, id: { not: res.locals.sessionId } } })
  ]);
  await db.auditLog.create({ data: { adminId: user.id, action: 'ENABLE_ADMIN_MFA', entity: 'User', entityId: user.id } });
  res.json({ enabled: true });
});
app.post('/api/v1/admin/security/mfa/disable', admin, async function (req, res) {
  const p = z.object({ code: z.string().regex(/^\d{6}$/) }).strict().safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: 'Enter the six-digit authenticator code.' });
  const user = await db.user.findUnique({ where: { id: res.locals.user.id } });
  if (!user?.adminMfaSecretEnc || !verifyTotp(decryptMfaSecret(user.adminMfaSecretEnc, signingSecret), p.data.code)) return res.status(401).json({ error: 'Authenticator code is invalid.' });
  await db.$transaction([
    db.user.update({ where: { id: user.id }, data: { adminMfaSecretEnc: null, adminMfaPendingSecretEnc: null, adminMfaPendingExpiresAt: null } }),
    db.authSession.deleteMany({ where: { userId: user.id, id: { not: res.locals.sessionId } } })
  ]);
  await db.auditLog.create({ data: { adminId: user.id, action: 'DISABLE_ADMIN_MFA', entity: 'User', entityId: user.id } });
  res.json({ enabled: false });
});
app.post('/api/v1/auth/password-reset/request', challengeLimiter, async function (req, res) {
  const p = z.object({ email: emailBody }).safeParse(req.body);
  if (!p.success) return res.status(202).json({ message: 'If the account exists, reset instructions will be emailed.' });
  const user = await db.user.findUnique({ where: { email: p.data.email } });
  if (user) try {
    const code = String(randomInt(0, 1000000)).padStart(6, '0');
    await db.authChallenge.deleteMany({ where: { email: p.data.email, type: 'PASSWORD_RESET' } });
    await db.authChallenge.create({ data: { email: p.data.email, userId: user.id, type: 'PASSWORD_RESET', codeHash: challengeHash(p.data.email, 'PASSWORD_RESET', code), expiresAt: new Date(Date.now() + 15 * 60 * 1000) } });
    await sendEmail(p.data.email, 'Reset your QuickWashHub password', 'Your reset code is ' + code + '. It expires in 15 minutes.', brandedEmail('Reset your password', 'Use this secure code to choose a new QuickWashHub password.', '<div style="font-size:12px;color:#5d6b61">YOUR PASSWORD RESET CODE</div><div style="margin-top:6px;font-size:30px;font-weight:800;letter-spacing:8px;color:#173d2c">' + code + '</div><div style="margin-top:8px;color:#5d6b61">This code expires in 15 minutes. If you did not request it, secure your account by changing your password.</div>'));
  } catch (error) { console.error('Password reset email failed', error); }
  res.status(202).json({ message: 'If the account exists, reset instructions will be emailed.' });
});
app.post('/api/v1/auth/password-reset/confirm', challengeLimiter, async function (req, res) {
  const p = z.object({ email: emailBody, code: z.string().regex(/^\d{6}$/), password: passwordBody }).safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: 'Enter a valid email, six-digit code and a password with at least 10 characters.' });
  const challenge = await db.authChallenge.findFirst({ where: { email: p.data.email, type: 'PASSWORD_RESET', consumedAt: null, expiresAt: { gt: new Date() } }, orderBy: { createdAt: 'desc' } });
  if (!challenge || challenge.attempts >= 5 || challenge.codeHash !== challengeHash(p.data.email, 'PASSWORD_RESET', p.data.code)) {
    if (challenge) await db.authChallenge.update({ where: { id: challenge.id }, data: { attempts: { increment: 1 } } });
    return res.status(401).json({ error: 'Reset code is invalid or expired.' });
  }
  const hash = await passwordHash(p.data.password);
  await db.$transaction([db.authChallenge.update({ where: { id: challenge.id }, data: { consumedAt: new Date() } }), db.user.update({ where: { id: challenge.userId! }, data: { passwordHash: hash, emailVerifiedAt: new Date() } }), db.authSession.deleteMany({ where: { userId: challenge.userId! } })]);
  res.json({ message: 'Password updated. You can now sign in.' });
});
app.post('/api/v1/auth/google', challengeLimiter, async function (req, res) {
  const p = z.object({ credential: z.string().min(20).max(5000) }).safeParse(req.body);
  if (!p.success || !process.env.GOOGLE_CLIENT_ID) return res.status(400).json({ error: 'Google sign-in is not configured.' });
  try {
    const ticket = await googleClient.verifyIdToken({ idToken: p.data.credential, audience: process.env.GOOGLE_CLIENT_ID });
    const payload = ticket.getPayload();
    if (!payload?.email || payload.email_verified !== true) return res.status(401).json({ error: 'Google account email is not verified.' });
    const email = payload.email.toLowerCase();
    let user = await db.user.findUnique({ where: { email } });
    if (!user) user = await db.user.create({ data: { email, name: payload.name || null, emailVerifiedAt: new Date(), role: Role.CUSTOMER } });
    else if (!user.emailVerifiedAt) user = await db.user.update({ where: { id: user.id }, data: { emailVerifiedAt: new Date(), name: user.name || payload.name || null } });
    await finishSignIn(user, res);
  } catch (error) { if (res.headersSent) return; console.error('Google credential validation failed', error); res.status(401).json({ error: 'Google sign-in failed. Try again.' }); }
});
app.post('/api/v1/auth/logout', async function (req, res) {
  const token = getCookie(req);
  if (token) try { await db.authSession.deleteMany({ where: { id: decodeToken(token).sid } }); } catch { /* already expired */ }
  res.clearCookie(sessionCookie, { httpOnly: true, secure: production, sameSite: 'strict', path: '/' });
  res.status(204).end();
});
app.get('/api/v1/me', authenticated(), async function (_req, res) {
  const u = res.locals.user;
  const base = { id: u.id, name: u.name, email: u.email, phone: u.phone, role: u.role };
  res.setHeader('Cache-Control', 'private, no-store');
  res.json(base);
});
app.get('/api/v1/bootstrap', authenticated([Role.CUSTOMER]), async function (_req, res) {
  const userId = res.locals.user.id;
  const [vehicles, addresses, prices, additionalServices, zones] = await Promise.all([
    db.vehicle.findMany({ where: { customerId: userId }, orderBy: { model: 'asc' } }),
    db.address.findMany({ where: { customerId: userId }, include: { zone: true }, orderBy: { label: 'asc' } }),
    db.zonePrice.findMany({ where: { zone: { isActive: true, ...pilotZoneWhere }, service: { isActive: true, category: 'VEHICLE' } }, include: { service: true, zone: true }, orderBy: { price: 'asc' } }),
    db.service.findMany({ where: { category: { in: ['SOLAR', 'HOME'] } } }),
    db.zone.findMany({ where: { isActive: true, ...pilotZoneWhere }, select: { id: true, name: true, centerLat: true, centerLng: true, radiusKm: true } })
  ]);
  const solarServices = additionalServices.filter(function (service) { return service.category === 'SOLAR'; });
  const homeServices = additionalServices.filter(function (service) { return service.category === 'HOME'; });
  res.setHeader('Cache-Control', 'private, no-store');
  res.json({ user: { id: userId, name: res.locals.user.name, role: res.locals.user.role }, vehicles, addresses, zones, services: [...prices.map(function (p) { return { id: p.serviceId, name: p.service.name, category: p.service.category, vehicleType: p.vehicleType, solarPanelTier: p.solarPanelTier, durationMin: p.service.durationMin, price: p.price, zoneId: p.zoneId, zoneName: p.zone.name, isActive: p.service.isActive }; }), ...solarServices.flatMap(function (s) { return zones.map(function (z) { return { id: s.id, name: s.name, category: s.category, vehicleType: null, solarPanelTier: null, durationMin: s.durationMin, price: null, zoneId: z.id, zoneName: z.name, isActive: true }; }); }), ...homeServices.flatMap(function (s) { return zones.slice(0, 1).map(function (z) { return { id: s.id, name: s.name, category: s.category, vehicleType: null, solarPanelTier: null, durationMin: s.durationMin, price: null, zoneId: z.id, zoneName: z.name, isActive: false }; }); })], googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY || null });
});
app.get('/api/v1/marketing/preferences', customer, async function (_req, res) {
  const user = await db.user.findUniqueOrThrow({ where: { id: res.locals.user.id }, select: { marketingConsentAt: true, marketingConsentRevokedAt: true, pushSubscriptions: { select: { id: true } } } });
  res.json({ optedIn: !!user.marketingConsentAt && !user.marketingConsentRevokedAt, pushEnabled: user.pushSubscriptions.length > 0, pushReady, vapidPublicKey: pushReady ? process.env.VAPID_PUBLIC_KEY : null });
});
app.put('/api/v1/marketing/preferences', customer, async function (req, res) {
  const p = z.object({ optedIn: z.boolean() }).strict().safeParse(req.body); if (!p.success) return res.status(400).json({ error: 'Choose whether to receive QuickWashHub offers.' });
  const user = await db.user.update({ where: { id: res.locals.user.id }, data: p.data.optedIn ? { marketingConsentAt: new Date(), marketingConsentRevokedAt: null } : { marketingConsentRevokedAt: new Date() } });
  if (!p.data.optedIn) {
    await Promise.all([
      db.pushSubscription.deleteMany({ where: { userId: user.id } }),
      db.notificationDelivery.updateMany({ where: { userId: user.id, channel: { in: ['EMAIL', 'WHATSAPP_MARKETING', 'PUSH'] }, status: { in: ['PENDING', 'FAILED'] } }, data: { status: 'CANCELLED', lastError: 'Customer opted out of marketing messages.' } })
    ]);
  }
  res.json({ optedIn: !!user.marketingConsentAt && !user.marketingConsentRevokedAt });
});
app.post('/api/v1/push/subscribe', customer, async function (req, res) {
  if (!pushReady) return res.status(503).json({ error: 'Push notifications are not configured yet.' });
  const user = await db.user.findUniqueOrThrow({ where: { id: res.locals.user.id }, select: { marketingConsentAt: true, marketingConsentRevokedAt: true } });
  if (!user.marketingConsentAt || user.marketingConsentRevokedAt) return res.status(403).json({ error: 'Opt into marketing offers before enabling offer notifications.' });
  const p = z.object({ endpoint: z.string().url().max(2048), keys: z.object({ p256dh: z.string().min(20).max(256), auth: z.string().min(10).max(128) }).strict() }).strict().safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: 'Browser push subscription is invalid.' });
  const existing = await db.pushSubscription.findUnique({ where: { endpoint: p.data.endpoint } });
  if (existing && existing.userId !== res.locals.user.id) return res.status(409).json({ error: 'This browser subscription is linked to another account.' });
  const subscription = existing ? await db.pushSubscription.update({ where: { id: existing.id }, data: { keys: p.data.keys as any } }) : await db.pushSubscription.create({ data: { userId: res.locals.user.id, endpoint: p.data.endpoint, keys: p.data.keys as any } });
  res.status(201).json({ enabled: true, id: subscription.id });
});
app.delete('/api/v1/push/subscribe', customer, async function (req, res) {
  const endpoint = z.string().url().max(2048).safeParse(req.body?.endpoint); if (!endpoint.success) return res.status(400).json({ error: 'Browser push endpoint is invalid.' });
  await db.pushSubscription.deleteMany({ where: { userId: res.locals.user.id, endpoint: endpoint.data } }); res.status(204).end();
});
app.get('/api/v1/marketing/unsubscribe', function (req, res) {
  try { const token = decodeToken(String(req.query.token || '')); if (token.sid !== 'marketing-unsubscribe') throw new Error('Invalid link');
    res.type('html').send('<!doctype html><html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Email preferences · QuickWashHub</title><body style="font:16px Arial;background:#f3f5f1;padding:40px;color:#17241b"><main style="max-width:480px;margin:auto;background:#fff;padding:28px;border:1px solid #e3e8e1;border-radius:16px"><h1 style="font-size:24px">Unsubscribe from offers</h1><p>Confirm to stop QuickWashHub marketing emails and promotional messages.</p><form method="post" action="/api/v1/marketing/unsubscribe"><input type="hidden" name="token" value="' + htmlEscape(String(req.query.token || '')) + '"><button style="background:#173d2c;color:white;padding:12px 18px;border:0;border-radius:8px">Unsubscribe</button></form></main></body></html>');
  } catch { res.status(400).send('This unsubscribe link is invalid or expired.'); }
});
app.post('/api/v1/marketing/unsubscribe', express.urlencoded({ extended: false, limit: '4kb' }), async function (req, res) {
  try { const token = decodeToken(String(req.body?.token || '')); if (token.sid !== 'marketing-unsubscribe') throw new Error('Invalid link'); await db.user.updateMany({ where: { id: token.sub }, data: { marketingConsentRevokedAt: new Date() } }); await Promise.all([db.pushSubscription.deleteMany({ where: { userId: token.sub } }), db.notificationDelivery.updateMany({ where: { userId: token.sub, channel: { in: ['EMAIL', 'WHATSAPP_MARKETING', 'PUSH'] }, status: { in: ['PENDING', 'FAILED'] } }, data: { status: 'CANCELLED', lastError: 'Customer unsubscribed from marketing messages.' } })]); res.type('html').send('<!doctype html><html><meta charset="utf-8"><title>Unsubscribed · QuickWashHub</title><body style="font:16px Arial;background:#f3f5f1;padding:40px;color:#17241b"><main style="max-width:480px;margin:auto;background:white;padding:28px;border-radius:16px"><h1>You’re unsubscribed</h1><p>QuickWashHub marketing messages are now turned off.</p></main></body></html>'); }
  catch { res.status(400).send('This unsubscribe link is invalid or expired.'); }
});

app.get('/api/v1/services', authenticated(), async function (req, res) {
  const zoneId = typeof req.query.zoneId === 'string' ? req.query.zoneId : undefined;
  const vehicleType = z.nativeEnum(VehicleType).safeParse(req.query.vehicleType);
  if (!vehicleType.success) return res.status(400).json({ error: 'vehicleType must be CAR or BIKE.' });
  const items = await db.zonePrice.findMany({ where: { ...(zoneId ? { zoneId } : pilotZoneWhere), vehicleType: vehicleType.data, zone: { isActive: true, ...pilotZoneWhere }, service: { isActive: true } }, include: { service: true, zone: true }, orderBy: { price: 'asc' } });
  res.json(items.map(function (p) { return { id: p.serviceId, name: p.service.name, vehicleType: p.vehicleType, durationMin: p.service.durationMin, price: p.price, zoneId: p.zoneId, zoneName: p.zone.name }; }));
});
app.get('/api/v1/vehicles', customer, async function (_req, res) { res.json(await db.vehicle.findMany({ where: { customerId: res.locals.user.id } })); });
const vehicleInput = z.object({ type: z.nativeEnum(VehicleType), model: z.string().trim().min(1).max(80), number: z.string().trim().min(2).max(20).transform(function (x) { return x.toUpperCase(); }) });
app.post('/api/v1/vehicles', customer, async function (req, res) { const p = vehicleInput.safeParse(req.body); if (!p.success) return res.status(400).json({ error: 'Enter valid vehicle details.' }); res.status(201).json(await db.vehicle.create({ data: { ...p.data, customerId: res.locals.user.id } })); });
app.delete('/api/v1/vehicles/:id', customer, async function (req, res) { const result = await db.vehicle.deleteMany({ where: { id: String(req.params.id), customerId: res.locals.user.id, bookings: { none: { status: { notIn: [BookingStatus.COMPLETED, BookingStatus.CANCELLED, BookingStatus.REFUNDED] } } } } }); if (!result.count) return res.status(409).json({ error: 'Vehicle not found or linked to an active booking.' }); res.status(204).end(); });

function contains(lng: number, lat: number, ring: number[][]) { let inside = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const a = ring[i], b = ring[j]; if ((a[1] > lat) !== (b[1] > lat) && lng < (b[0] - a[0]) * (lat - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside; } return inside; }
function distanceKm(lat1: number, lng1: number, lat2: number, lng2: number) { const toRad = function (d: number) { return d * Math.PI / 180; }; const dLat = toRad(lat2 - lat1), dLng = toRad(lng2 - lng1); const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2; return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)); }
function zoneContainsPoint(zone: { centerLat: number | null; centerLng: number | null; radiusKm: number | null; polygon: unknown }, lat: number, lng: number) {
  if (zone.centerLat != null && zone.centerLng != null && zone.radiusKm != null) return distanceKm(lat, lng, zone.centerLat, zone.centerLng) <= zone.radiusKm;
  const g = zone.polygon as any, polygons: number[][][][] = g?.type === 'Polygon' ? [g.coordinates] : g?.type === 'MultiPolygon' ? g.coordinates : [];
  return polygons.some(function (rings) { return !!rings[0] && contains(lng, lat, rings[0]) && !rings.slice(1).some(function (hole) { return contains(lng, lat, hole); }); });
}
async function zoneAt(lng: number, lat: number) {
  const zones = await db.zone.findMany({ where: { isActive: true, ...pilotZoneWhere } });
  return zones.find(function (zone) {
    if (zone.centerLat != null && zone.centerLng != null && zone.radiusKm != null) return distanceKm(lat, lng, zone.centerLat, zone.centerLng) <= zone.radiusKm;
    const g = zone.polygon as any; const polygons: number[][][][] = g?.type === 'Polygon' ? [g.coordinates] : g?.type === 'MultiPolygon' ? g.coordinates : [];
    return polygons.some(function (rings) { return !!rings[0] && contains(lng, lat, rings[0]) && !rings.slice(1).some(function (hole) { return contains(lng, lat, hole); }); });
  });
}
const addressInput = z.object({ label: z.string().trim().min(1).max(50), lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180), fullAddress: z.string().trim().min(5).max(300) });
app.get('/api/v1/addresses', customer, async function (_req, res) { res.json(await db.address.findMany({ where: { customerId: res.locals.user.id }, include: { zone: true } })); });
app.post('/api/v1/addresses', customer, async function (req, res) { const p = addressInput.safeParse(req.body); if (!p.success) return res.status(400).json({ error: 'Enter a valid address and map location.' }); const zone = await zoneAt(p.data.lng, p.data.lat); if (!zone) return res.status(422).json({ error: 'Service is unavailable at this location.' }); res.status(201).json(await db.address.create({ data: { ...p.data, customerId: res.locals.user.id, zoneId: zone.id }, include: { zone: true } })); });
app.delete('/api/v1/addresses/:id', customer, async function (req, res) { const result = await db.address.deleteMany({ where: { id: String(req.params.id), customerId: res.locals.user.id, bookings: { none: { status: { notIn: [BookingStatus.COMPLETED, BookingStatus.CANCELLED, BookingStatus.REFUNDED] } } } } }); if (!result.count) return res.status(409).json({ error: 'Address not found or linked to an active booking.' }); res.status(204).end(); });
app.post('/api/v1/support/tickets', customer, async function (req, res) {
  const p = z.object({ bookingId: z.string().optional(), subject: z.string().trim().min(4).max(120), message: z.string().trim().min(10).max(4000) }).strict().safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: 'Enter a subject and a message of at least 10 characters.' });
  if (p.data.bookingId && !await db.booking.findFirst({ where: { id: p.data.bookingId, customerId: res.locals.user.id }, select: { id: true } })) return res.status(404).json({ error: 'Booking not found.' });
  const ticket = await db.supportTicket.create({ data: { reference: 'QWH-' + randomBytes(5).toString('hex').toUpperCase(), customerId: res.locals.user.id, bookingId: p.data.bookingId, subject: p.data.subject, message: p.data.message } });
  res.status(201).json({ reference: ticket.reference, status: ticket.status, createdAt: ticket.createdAt });
});
app.get('/api/v1/support/tickets', customer, async function (_req, res) { res.json(await db.supportTicket.findMany({ where: { customerId: res.locals.user.id }, select: { reference: true, subject: true, status: true, createdAt: true, updatedAt: true }, orderBy: { createdAt: 'desc' } })); });
app.post('/api/v1/account/deletion-request', customer, async function (req, res) {
  const p = z.object({ reason: z.string().trim().max(1000).optional() }).strict().safeParse(req.body || {});
  if (!p.success) return res.status(400).json({ error: 'Request details are too long.' });
  const existing = await db.accountDeletionRequest.findFirst({ where: { userId: res.locals.user.id, status: 'PENDING' } });
  const request = existing || await db.accountDeletionRequest.create({ data: { userId: res.locals.user.id, reason: p.data.reason } });
  await db.authSession.deleteMany({ where: { userId: res.locals.user.id, id: { not: res.locals.sessionId } } });
  res.status(202).json({ status: request.status, requestedAt: request.createdAt, message: 'Your deletion request is recorded. We will contact you if records must be retained by law.' });
});

const bookingInput = z.object({
  serviceId: z.string().min(1), scheduledAt: z.string().datetime(), fullName: z.string().trim().min(2).max(100), phone: z.string().regex(/^[6-9]\d{9}$/),
  addressId: z.string().optional(), newAddress: addressInput.optional(), vehicleId: z.string().optional(), newVehicle: vehicleInput.optional(),
  vehicleItems: z.array(z.object({ vehicleId: z.string().min(1), serviceId: z.string().min(1) }).strict()).min(1).max(5).optional(), couponCode: z.string().trim().toUpperCase().max(24).optional(),
  solarPanelCount: z.number().int().min(1).max(10000).optional(), solarRoofType: z.string().trim().min(2).max(80).optional(), solarAccessNotes: z.string().trim().max(1000).optional(), solarPropertyType: z.enum(['RESIDENTIAL', 'COMMERCIAL']).optional()
}).strict();
app.get('/api/v1/bookings', customer, async function (req, res) { const status = typeof req.query.status === 'string' && Object.values(BookingStatus).includes(req.query.status as BookingStatus) ? req.query.status as BookingStatus : undefined; const rows = await db.booking.findMany({ where: { customerId: res.locals.user.id, ...(status ? { status } : {}) }, include: { service: true, vehicle: true, vehicleItems: { include: { vehicle: true } }, worker: { include: { user: true } }, zone: true, rating: true, photos: { select: { id: true, type: true, status: true } } }, orderBy: { createdAt: 'desc' }, take: 100 }); res.setHeader('Cache-Control', 'private, no-store'); res.json(rows.map(function (b) { return { id: b.id, status: b.status, service: b.service.name, vehicle: b.vehicleItems.length ? b.vehicleItems.map(function (item) { return item.vehicle.model + ' · ' + item.vehicle.number; }).join(', ') : b.vehicle ? b.vehicle.model + ' · ' + b.vehicle.number : b.solarPropertyType + ' solar panels', couponDiscount: b.couponDiscount, solarPropertyType: b.solarPropertyType, solarPanelCount: b.solarPanelCount, solarRoofType: b.solarRoofType, solarAccessNotes: b.solarAccessNotes, quoteNote: b.quoteNote, scheduledAt: b.scheduledAt, price: b.price, worker: b.worker?.user.name || null, zone: b.zone.name, photos: b.photos, rating: b.rating }; })); });
app.post('/api/v1/bookings', customer, async function (req, res) {
  const p = bookingInput.safeParse(req.body); if (!p.success) return res.status(400).json({ error: 'Enter your name, valid mobile number, service address, and requested service details.' }); const userId = res.locals.user.id;
  if (production && !pilotZoneIds.length) return res.status(503).json({ error: 'Bookings are closed until the approved 42 Mouza map zones are configured.' });
  const phoneOwner = await db.user.findUnique({ where: { phone: p.data.phone }, select: { id: true } });
  if (phoneOwner && phoneOwner.id !== userId) return res.status(409).json({ error: 'This mobile number is linked to another account. Sign in with that account or contact support.' });
  const service = await db.service.findFirst({ where: { id: p.data.serviceId, isActive: true } });
  if (!service) return res.status(422).json({ error: 'This service is unavailable.' });
  if (service.category === 'HOME' && process.env.HOME_WASH_ENABLED !== 'true') return res.status(422).json({ error: 'Home Wash is not available in this beta yet.' });
  let vehicle = p.data.vehicleId ? await db.vehicle.findFirst({ where: { id: p.data.vehicleId, customerId: userId } }) : null;
  let address = p.data.addressId ? await db.address.findFirst({ where: { id: p.data.addressId, customerId: userId, zone: { isActive: true } } }) : null;
  if (!vehicle && p.data.newVehicle) vehicle = await db.vehicle.create({ data: { ...p.data.newVehicle, customerId: userId } });
  if (!address && p.data.newAddress) {
    const zone = await zoneAt(p.data.newAddress.lng, p.data.newAddress.lat);
    if (zone) address = await db.address.create({ data: { ...p.data.newAddress, customerId: userId, zoneId: zone.id }, include: { zone: true } });
  }
  if (!address?.zoneId) return res.status(422).json({ error: 'Choose an address inside a mapped QuickWashHub service zone.' });
  if (pilotZoneIds.length && !pilotZoneIds.includes(address.zoneId)) return res.status(422).json({ error: 'This beta currently serves Cuttack 42 Mouza only.' });
  if (new Date(p.data.scheduledAt).getTime() < Date.now() + 60 * 60 * 1000) return res.status(400).json({ error: 'Choose a time at least one hour from now.' });
  if (service.category === 'VEHICLE' && !vehicle && p.data.newVehicle) vehicle = await db.vehicle.create({ data: { ...p.data.newVehicle, customerId: userId } });
  if (service.category === 'VEHICLE' && !vehicle && !p.data.vehicleItems) return res.status(400).json({ error: 'Choose a saved vehicle matching this service, or add its model and registration.' });
  if (service.category === 'SOLAR' && (!p.data.solarRoofType || !p.data.solarPropertyType)) return res.status(400).json({ error: 'Solar quote requests need the property type and roof/access details.' });
  let lineItems: { vehicleId: string; serviceId: string; price: number; type: VehicleType }[] = [];
  if (service.category === 'VEHICLE') {
    const requested = [...(p.data.vehicleItems || [])];
    if (vehicle && !requested.some(function (item) { return item.vehicleId === vehicle!.id; })) requested.unshift({ vehicleId: vehicle.id, serviceId: service.id });
    const uniqueIds = new Set(requested.map(function (item) { return item.vehicleId; }));
    if (requested.length > 5 || uniqueIds.size !== requested.length) return res.status(400).json({ error: 'Choose one to five different vehicles per booking.' });
    const vehicles = await db.vehicle.findMany({ where: { id: { in: Array.from(uniqueIds) }, customerId: userId } });
    if (vehicles.length !== uniqueIds.size) return res.status(400).json({ error: 'One or more selected vehicles are not in your account.' });
    const vehicleMap = new Map(vehicles.map(function (item) { return [item.id, item]; }));
    for (const item of requested) {
      const selected = vehicleMap.get(item.vehicleId)!;
      const itemService = await db.service.findFirst({ where: { id: item.serviceId, isActive: true, category: 'VEHICLE', vehicleType: selected.type } });
      if (!itemService) return res.status(422).json({ error: 'Choose an active service that matches each vehicle type.' });
      const zonePrice = await db.zonePrice.findFirst({ where: { serviceId: itemService.id, vehicleType: selected.type, solarPanelTier: null, zoneId: address.zoneId, zone: { isActive: true }, service: { isActive: true } } });
      if (!zonePrice) return res.status(422).json({ error: 'Service is unavailable for one of the selected vehicles in this area.' });
      lineItems.push({ vehicleId: selected.id, serviceId: itemService.id, price: zonePrice.price, type: selected.type });
    }
  }
  const quoteRequested = service.category === 'SOLAR';
  const grossAmount = lineItems.reduce(function (sum, item) { return sum + item.price; }, 0);
  const zone = await db.zone.findUniqueOrThrow({ where: { id: address.zoneId } });
  const baseCommission = service.category === 'VEHICLE' ? Math.round(grossAmount * zone.baseCommissionPct / 100) : 0;
  let coupon = null as { id: string; code: string; discountPct: number } | null;
  let discount = 0;
  if (p.data.couponCode) {
    coupon = await db.coupon.findFirst({ where: { code: p.data.couponCode, userId, redeemedAt: null, expiresAt: { gt: new Date() } }, select: { id: true, code: true, discountPct: true } });
    if (!coupon) return res.status(422).json({ error: 'This coupon is invalid, expired, or already used.' });
    if (service.category !== 'VEHICLE') return res.status(422).json({ error: 'Coupons are available for vehicle wash bookings only.' });
    const calculation = calculateVehicleCouponDiscount({ grossAmount, baseCommission, vehicleTypes: lineItems.map(function (item) { return item.type; }), couponDiscountPct: coupon.discountPct, paymentFeePct: Number(process.env.CASHFREE_FEE_PCT || 2), minimumContributionPct: zone.couponMinimumContributionPct });
    discount = calculation.discount;
    if (discount < 1) return res.status(422).json({ error: 'This zone has no safe discount margin for the selected service. Please continue without a coupon.' });
  }
  const amount = Math.max(0, grossAmount - discount);
  const commission = Math.max(0, baseCommission - discount);
  const workerEarning = service.category === 'VEHICLE' ? grossAmount - baseCommission : amount - commission;
  const updatedUser = await db.user.update({ where: { id: userId }, data: { name: p.data.fullName, phone: p.data.phone } });
  const booking = await db.$transaction(async function (tx) {
    const created = await tx.booking.create({ data: { customerId: userId, zoneId: address!.zoneId!, vehicleId: lineItems[0]?.vehicleId, addressId: address!.id, serviceId: service.id, scheduledAt: new Date(p.data.scheduledAt), status: quoteRequested ? BookingStatus.QUOTE_REQUESTED : BookingStatus.CREATED, price: amount, commissionAmt: commission, workerEarning, couponCode: coupon?.code, couponDiscount: discount, solarPanelCount: p.data.solarPanelCount, solarRoofType: p.data.solarRoofType, solarAccessNotes: p.data.solarAccessNotes, solarPropertyType: p.data.solarPropertyType, vehicleItems: { create: lineItems.map(function (item) { return { vehicleId: item.vehicleId, serviceId: item.serviceId, price: item.price }; }) } }, include: { service: true, zone: true } });
    if (coupon) { const claimed = await tx.coupon.updateMany({ where: { id: coupon.id, redeemedAt: null, expiresAt: { gt: new Date() } }, data: { redeemedAt: new Date(), bookingId: created.id } }); if (!claimed.count) throw new Error('COUPON_ALREADY_USED'); }
    return created;
  });
  res.status(201).json({ id: booking.id, status: booking.status, service: booking.service.name, scheduledAt: booking.scheduledAt, price: booking.price, couponDiscount: discount, zone: booking.zone.name, customerName: updatedUser.name });
});
app.post('/api/v1/bookings/:id/cancel', customer, async function (req, res) { const b = await db.booking.findFirst({ where: { id: String(req.params.id), customerId: res.locals.user.id } }); if (!b) return res.status(404).json({ error: 'Booking not found.' }); const unpaid = [BookingStatus.CREATED, BookingStatus.QUOTE_REQUESTED, BookingStatus.QUOTE_PROVIDED] as BookingStatus[]; if (!unpaid.includes(b.status)) return res.status(409).json({ error: 'Contact support for cancellation after payment begins.' }); const result = await db.booking.updateMany({ where: { id: b.id, status: b.status }, data: { status: BookingStatus.CANCELLED } }); if (!result.count) return res.status(409).json({ error: 'Booking changed. Refresh and try again.' }); if (b.couponCode) await db.coupon.updateMany({ where: { bookingId: b.id, redeemedAt: { not: null } }, data: { bookingId: null, redeemedAt: null } }); res.json({ id: b.id, status: BookingStatus.CANCELLED }); });
app.post('/api/v1/bookings/:id/rating', customer, async function (req, res) { const p = z.object({ stars: z.number().int().min(1).max(5), comment: z.string().trim().max(1000).optional() }).safeParse(req.body); if (!p.success) return res.status(400).json({ error: 'Choose a rating from one to five stars.' }); const booking = await db.booking.findFirst({ where: { id: String(req.params.id), customerId: res.locals.user.id }, include: { worker: true } }); if (!booking || booking.status !== BookingStatus.COMPLETED) return res.status(409).json({ error: 'Only completed bookings can be rated.' }); try { const rating = await db.rating.create({ data: { bookingId: booking.id, stars: p.data.stars, comment: p.data.comment } }); if (booking.workerId) { const ratings = await db.rating.findMany({ where: { booking: { workerId: booking.workerId } }, select: { stars: true } }); await db.worker.update({ where: { id: booking.workerId }, data: { rating: ratings.reduce(function (n, x) { return n + x.stars; }, 0) / ratings.length } }); } res.status(201).json(rating); } catch { res.status(409).json({ error: 'A rating already exists for this booking.' }); } });

app.post('/api/v1/bookings/:id/payment-order', customer, async function (req, res) {
  const b = await db.booking.findFirst({ where: { id: String(req.params.id), customerId: res.locals.user.id } });
  if (!b) return res.status(404).json({ error: 'Booking not found.' });
  if (!([BookingStatus.CREATED, BookingStatus.QUOTE_PROVIDED, BookingStatus.PAYMENT_PENDING] as BookingStatus[]).includes(b.status)) return res.status(409).json({ error: 'Booking must be quoted or ready for payment before checkout.' });
  if (b.price < 100) return res.status(409).json({ error: 'The final quote is not available yet.' });
  if (!cashfreeId || !cashfreeSecret || (production && !publicPaymentsReady)) return res.status(503).json({ error: 'Paid bookings are not open yet. Cashfree, Easy Split, 42 Mouza, and legal launch gates must be completed.' });
  try {
    const previous = await db.payment.findUnique({ where: { bookingId: b.id } });
    if (previous?.method === 'cashfree' && previous.status === PaymentStatus.PENDING && previous.gatewayRef && previous.paymentSessionId) return res.json({ orderId: previous.gatewayRef, paymentSessionId: previous.paymentSessionId, mode: process.env.CASHFREE_ENV === 'production' ? 'production' : 'sandbox' });
    const customer = await db.user.findUnique({ where: { id: b.customerId }, select: { id: true, name: true, email: true, phone: true } });
    const cashfreePhone = customer?.phone?.replace(/\D/g, '').replace(/^91(?=[6-9]\d{9}$)/, '');
    if (!customer?.name || !cashfreePhone || !/^[6-9]\d{9}$/.test(cashfreePhone)) return res.status(409).json({ error: 'Update your name and 10-digit mobile number before paying.' });
    const idem = createHash('sha256').update('quickwashhub-order:' + b.id).digest('hex');
    const response = await fetch(cashfreeEnv + '/orders', { method: 'POST', headers: { 'x-client-id': cashfreeId, 'x-client-secret': cashfreeSecret, 'x-api-version': cashfreeVersion, 'x-idempotency-key': idem.slice(0, 8) + '-' + idem.slice(8, 12) + '-4' + idem.slice(13, 16) + '-a' + idem.slice(17, 20) + '-' + idem.slice(20, 32), 'Content-Type': 'application/json' }, body: JSON.stringify({ order_id: 'qwh_' + b.id, order_amount: Number((b.price / 100).toFixed(2)), order_currency: 'INR', customer_details: { customer_id: customer.id, customer_name: customer.name, ...(customer.email ? { customer_email: customer.email } : {}), customer_phone: cashfreePhone }, order_meta: { return_url: (allowedOrigins[0] || 'http://localhost:' + port) + '/?payment=return&order_id={order_id}' }, order_note: 'QuickWashHub wash booking' }) });
    if (!response.ok) throw new Error('Payment gateway rejected the order.');
    const order = await response.json() as { order_id: string; payment_session_id: string };
    if (!order.order_id || !order.payment_session_id) throw new Error('Cashfree returned an incomplete checkout session.');
    await db.$transaction([
      db.payment.upsert({ where: { bookingId: b.id }, create: { bookingId: b.id, amount: b.price, method: 'cashfree', gatewayRef: order.order_id, paymentSessionId: order.payment_session_id, status: PaymentStatus.PENDING }, update: { amount: b.price, method: 'cashfree', gatewayRef: order.order_id, paymentSessionId: order.payment_session_id, status: PaymentStatus.PENDING, splitStatus: 'NOT_READY' } }),
      db.booking.update({ where: { id: b.id }, data: { status: BookingStatus.PAYMENT_PENDING } })
    ]);
    res.json({ orderId: order.order_id, paymentSessionId: order.payment_session_id, mode: process.env.CASHFREE_ENV === 'production' ? 'production' : 'sandbox' });
  } catch (error) { console.error('Payment order creation failed', error); res.status(502).json({ error: 'Could not start payment. Retry shortly.' }); }
});
app.post('/api/v1/payments/cashfree/webhook', async function (req, res) {
  const secret = cashfreeSecret, signature = req.header('x-webhook-signature'), timestamp = req.header('x-webhook-timestamp');
  if (!secret || !signature || !timestamp || !Buffer.isBuffer(req.body)) return res.status(503).end();
  const expected = createHmac('sha256', secret).update(timestamp + req.body.toString()).digest('base64');
  const received = Buffer.from(signature), wanted = Buffer.from(expected);
  if (received.length !== wanted.length || !timingSafeEqual(received, wanted)) return res.status(400).json({ error: 'Invalid webhook signature.' });
  try {
    const event = JSON.parse(req.body.toString());
    if (event.type === 'PAYMENT_SUCCESS_WEBHOOK') {
      const paid = event.data?.payment;
      const order = event.data?.order;
      const payment = order?.order_id ? await db.payment.findFirst({ where: { gatewayRef: order.order_id, method: 'cashfree' } }) : null;
      if (payment && Number(paid?.payment_amount) === Number((payment.amount / 100).toFixed(2)) && paid?.payment_status === 'SUCCESS') {
        const newlyPaid = await db.$transaction(async function (tx) {
          const changed = await tx.payment.updateMany({ where: { id: payment.id, status: PaymentStatus.PENDING }, data: { status: PaymentStatus.VERIFIED, paidAt: new Date(), splitStatus: 'WAITING_FOR_ASSIGNMENT' } });
          if (changed.count) await tx.booking.updateMany({ where: { id: payment.bookingId, status: BookingStatus.PAYMENT_PENDING }, data: { status: BookingStatus.PAID } });
          return changed.count > 0;
        });
        if (newlyPaid) await queueUnassignedWorkerAlert(payment.bookingId).catch(function (error) { console.error('booking.alert_queue_failed', error); });
      }
    }
    res.json({ received: true });
  } catch (error) { console.error('Cashfree webhook processing failed', error); res.status(500).end(); }
});

async function processCashfreeSplits() {
  if (!easySplitEnabled || !cashfreeId || !cashfreeSecret) return;
  const now = Date.now();
  const candidates = await db.payment.findMany({ where: { method: 'cashfree', status: PaymentStatus.VERIFIED, paidAt: { lte: new Date(now - 120_000) }, OR: [{ splitStatus: 'PENDING' }, { splitStatus: { in: ['RETRY', 'PROCESSING'] }, splitUpdatedAt: { lte: new Date(now - 300_000) } }], booking: { workerId: { not: null }, status: { in: [BookingStatus.ASSIGNED, BookingStatus.WORKER_ON_THE_WAY, BookingStatus.IN_PROGRESS, BookingStatus.PHOTOS_UPLOADED, BookingStatus.APPROVED, BookingStatus.COMPLETED] } } }, include: { booking: { include: { worker: true } } }, take: 20 });
  for (const payment of candidates) {
    const vendorId = payment.booking.worker?.cashfreeVendorId;
    if (!vendorId || !payment.gatewayRef) { await db.payment.update({ where: { id: payment.id }, data: { splitStatus: 'WAITING_FOR_VENDOR' } }); continue; }
    const claim = await db.payment.updateMany({ where: { id: payment.id, OR: [{ splitStatus: 'PENDING' }, { splitStatus: { in: ['RETRY', 'PROCESSING'] }, splitUpdatedAt: { lte: new Date(Date.now() - 300_000) } }] }, data: { splitStatus: 'PROCESSING', splitUpdatedAt: new Date() } });
    if (!claim.count) continue;
    try {
      const splitKey = createHash('sha256').update('quickwashhub-split:' + payment.id).digest('hex');
      const splitResponse = await fetch(cashfreeEnv + '/easy-split/orders/' + encodeURIComponent(payment.gatewayRef) + '/split', { method: 'POST', headers: { 'x-client-id': cashfreeId, 'x-client-secret': cashfreeSecret, 'x-api-version': cashfreeVersion, 'x-idempotency-key': splitKey.slice(0, 8) + '-' + splitKey.slice(8, 12) + '-4' + splitKey.slice(13, 16) + '-a' + splitKey.slice(17, 20) + '-' + splitKey.slice(20, 32), 'Content-Type': 'application/json' }, body: JSON.stringify({ split: [{ vendor_id: vendorId, percentage: Number((payment.booking.workerEarning * 100 / payment.amount).toFixed(2)) }], disable_split: true }) });
      if (!splitResponse.ok) throw new Error('Cashfree split request failed with ' + splitResponse.status);
      await db.payment.update({ where: { id: payment.id }, data: { splitStatus: 'SUBMITTED', splitUpdatedAt: new Date() } });
    } catch (error) {
      console.error('Cashfree Easy Split submission failed', { paymentId: payment.id, error });
      await db.payment.update({ where: { id: payment.id }, data: { splitStatus: 'RETRY', splitUpdatedAt: new Date() } });
    }
  }
}
setInterval(function () { processCashfreeSplits().catch(function (error) { console.error('Cashfree split queue failed', error); }); }, 30_000).unref();
function normalizedCashfreeRefundStatus(status: unknown): string {
  const value = String(status || '').toUpperCase();
  if (['SUCCESS', 'PROCESSED', 'COMPLETED'].includes(value)) return 'SUCCESS';
  if (['FAILED', 'CANCELLED', 'REJECTED'].includes(value)) return 'FAILED';
  if (['PENDING', 'ACTIVE', 'INITIATED', 'PROCESSING'].includes(value)) return 'PENDING';
  return 'UNKNOWN';
}
async function applyCashfreeRefundStatus(refundId: string, providerRefund: any) {
  const refund = await db.cashfreeRefund.findUnique({ where: { refundId }, include: { payment: { include: { booking: true } } } });
  if (!refund) return;
  const nextStatus = normalizedCashfreeRefundStatus(providerRefund.refund_status);
  const description = typeof providerRefund.status_description === 'string' ? providerRefund.status_description.slice(0, 500) : null;
  await db.$transaction(async function (tx) {
    const current = await tx.cashfreeRefund.findUnique({ where: { id: refund.id } }); if (!current) return;
    await tx.cashfreeRefund.update({ where: { id: current.id }, data: { status: nextStatus, cashfreeRefundId: providerRefund.cf_refund_id || current.cashfreeRefundId, statusDescription: description } });
    if (nextStatus === 'FAILED' && current.status !== 'FAILED') await tx.payment.update({ where: { id: current.paymentId }, data: { refundedAmount: { decrement: current.amount } } });
    const settled = await tx.cashfreeRefund.aggregate({ where: { paymentId: current.paymentId, status: 'SUCCESS' }, _sum: { amount: true } });
    if ((settled._sum.amount || 0) >= refund.payment.amount) {
      await tx.payment.update({ where: { id: current.paymentId }, data: { status: PaymentStatus.REFUNDED } });
      await tx.booking.update({ where: { id: refund.payment.bookingId }, data: { status: BookingStatus.REFUNDED } });
    }
  });
}
app.post('/api/v1/admin/bookings/:id/refunds', admin, async function (req, res) {
  const p = z.object({ amount: z.number().int().positive(), reason: z.string().trim().min(4).max(200), idempotencyKey: z.string().uuid() }).strict().safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: 'Enter a positive refund amount in paise, a reason, and an idempotency key.' });
  const booking = await db.booking.findUnique({ where: { id: String(req.params.id) }, include: { payment: { include: { refunds: true } }, worker: true } });
  if (!booking?.payment || booking.payment.method !== 'cashfree' || booking.payment.status !== PaymentStatus.VERIFIED || !booking.payment.gatewayRef) return res.status(409).json({ error: 'Only successfully paid Cashfree bookings can be refunded here.' });
  if (booking.payment.splitStatus === 'PROCESSING') return res.status(409).json({ error: 'The Cashfree vendor split is still processing. Retry the refund after reconciliation completes.' });
  const prior = await db.cashfreeRefund.findUnique({ where: { idempotencyKey: p.data.idempotencyKey } });
  if (prior) { if (prior.paymentId !== booking.payment.id || prior.amount !== p.data.amount) return res.status(409).json({ error: 'This refund request key was already used for different details.' }); return res.status(202).json({ id: prior.id, refundId: prior.refundId, status: prior.status, message: 'This refund request was already recorded.' }); }
  if (!cashfreeId || !cashfreeSecret) return res.status(503).json({ error: 'Cashfree credentials are not configured.' });
  const refundId = 'qwh' + p.data.idempotencyKey.replace(/-/g, '');
  let refund;
  try {
    refund = await db.$transaction(async function (tx) {
      const reserved = await tx.payment.updateMany({ where: { id: booking.payment!.id, status: PaymentStatus.VERIFIED, refundedAmount: { lte: booking.payment!.amount - p.data.amount } }, data: { refundedAmount: { increment: p.data.amount } } });
      if (!reserved.count) throw new Error('REFUND_EXCEEDS_REMAINING');
      return tx.cashfreeRefund.create({ data: { paymentId: booking.payment!.id, idempotencyKey: p.data.idempotencyKey, refundId, amount: p.data.amount, reason: p.data.reason } });
    });
  } catch (error) { if ((error as Error).message === 'REFUND_EXCEEDS_REMAINING') return res.status(422).json({ error: 'Refund amount exceeds the remaining paid balance.' }); throw error; }
  const vendorId = booking.worker?.cashfreeVendorId;
  const splitWasSubmitted = booking.payment.splitStatus === 'SUBMITTED' && vendorId;
  const vendorRefund = splitWasSubmitted ? Math.min(p.data.amount, Math.round(booking.workerEarning * p.data.amount / booking.payment.amount)) : 0;
  await db.cashfreeRefund.update({ where: { id: refund.id }, data: { workerAdjustment: vendorRefund } });
  const refundKey = p.data.idempotencyKey;
  const body = { refund_id: refundId, refund_amount: Number((p.data.amount / 100).toFixed(2)), refund_note: p.data.reason, ...(vendorRefund ? { refund_splits: [{ vendor_id: vendorId, amount: Number((vendorRefund / 100).toFixed(2)) }] } : {}) };
  try {
    const response = await fetch(cashfreeEnv + '/orders/' + encodeURIComponent(booking.payment.gatewayRef) + '/refunds', { method: 'POST', headers: { 'x-client-id': cashfreeId, 'x-client-secret': cashfreeSecret, 'x-api-version': cashfreeVersion, 'x-idempotency-key': refundKey, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(15_000) });
    const result = await response.json().catch(function () { return {}; });
    if (!response.ok) {
      const status = response.status >= 500 ? 'UNKNOWN' : 'FAILED';
      if (status === 'FAILED') await db.$transaction([db.cashfreeRefund.update({ where: { id: refund.id }, data: { status, statusDescription: String(result.message || result.type || 'Cashfree rejected the refund request.').slice(0, 500) } }), db.payment.update({ where: { id: booking.payment.id }, data: { refundedAmount: { decrement: p.data.amount } } })]);
      else await db.cashfreeRefund.update({ where: { id: refund.id }, data: { status, statusDescription: 'Cashfree response was ambiguous (' + response.status + '); reconcile before retrying.' } });
      return res.status(status === 'FAILED' ? 502 : 202).json({ id: refund.id, refundId, status, message: status === 'FAILED' ? 'Cashfree did not accept the refund.' : 'Refund outcome is unclear; reconcile this payment before retrying.' });
    }
    await applyCashfreeRefundStatus(refundId, result);
    await db.auditLog.create({ data: { adminId: res.locals.user.id, action: 'CREATE_CASHFREE_REFUND', entity: 'CashfreeRefund', entityId: refund.id, after: { bookingId: booking.id, amount: p.data.amount, refundId } } });
    return res.status(202).json({ id: refund.id, refundId, status: normalizedCashfreeRefundStatus(result.refund_status), amount: p.data.amount, message: 'Refund request recorded. Refresh reconciliation for Cashfree status.' });
  } catch (error) {
    await db.cashfreeRefund.update({ where: { id: refund.id }, data: { status: 'UNKNOWN', statusDescription: 'The request timed out or the connection failed; reconcile before retrying.' } });
    console.error('Cashfree refund outcome is unknown', { refundId, error });
    return res.status(202).json({ id: refund.id, refundId, status: 'UNKNOWN', message: 'Refund outcome is unclear; reconcile this payment before retrying.' });
  }
});
app.get('/api/v1/admin/bookings/:id/payment-reconciliation', admin, async function (req, res) {
  const booking = await db.booking.findUnique({ where: { id: String(req.params.id) }, include: { payment: { include: { refunds: true } } } });
  if (!booking?.payment || booking.payment.method !== 'cashfree' || !booking.payment.gatewayRef) return res.status(404).json({ error: 'Cashfree payment not found.' });
  if (!cashfreeId || !cashfreeSecret) return res.status(503).json({ error: 'Cashfree credentials are not configured.' });
  const headers = { 'x-client-id': cashfreeId, 'x-client-secret': cashfreeSecret, 'x-api-version': cashfreeVersion };
  const refundResponse = await fetch(cashfreeEnv + '/orders/' + encodeURIComponent(booking.payment.gatewayRef) + '/refunds', { headers, signal: AbortSignal.timeout(15_000) });
  if (!refundResponse.ok) return res.status(502).json({ error: 'Cashfree refund reconciliation failed with ' + refundResponse.status + '.' });
  const refundList = await refundResponse.json() as any[];
  if (!Array.isArray(refundList)) return res.status(502).json({ error: 'Cashfree returned an invalid refund list.' });
  for (const providerRefund of refundList) if (providerRefund.refund_id) {
    const providerRefundId = String(providerRefund.refund_id);
    const existingRefund = await db.cashfreeRefund.findUnique({ where: { refundId: providerRefundId }, select: { id: true } });
    if (!existingRefund) {
      const amount = Math.max(0, Math.round(Number(providerRefund.refund_amount || 0) * 100));
      const status = normalizedCashfreeRefundStatus(providerRefund.refund_status);
      if (amount) {
        await db.$transaction(async function (tx) {
          await tx.cashfreeRefund.create({ data: { paymentId: booking.payment!.id, idempotencyKey: randomUUID(), refundId: providerRefundId, amount, reason: String(providerRefund.refund_note || 'Refund initiated in Cashfree Dashboard').slice(0, 200), workerAdjustment: Array.isArray(providerRefund.refund_splits) ? Math.round(providerRefund.refund_splits.reduce(function (sum: number, split: any) { return sum + Number(split.amount || 0); }, 0) * 100) : 0, status } });
          if (status !== 'FAILED') await tx.payment.update({ where: { id: booking.payment!.id }, data: { refundedAmount: { increment: amount } } });
        });
      }
    }
    await applyCashfreeRefundStatus(providerRefundId, providerRefund);
  }
  let splitDetails: any = null;
  if (easySplitEnabled) {
    const splitResponse = await fetch(cashfreeEnv + '/easy-split/orders/' + encodeURIComponent(booking.payment.gatewayRef), { headers, signal: AbortSignal.timeout(15_000) });
    if (!splitResponse.ok) return res.status(502).json({ error: 'Cashfree split reconciliation failed with ' + splitResponse.status + '.' });
    splitDetails = await splitResponse.json();
  }
  const snapshot = { checkedAt: new Date().toISOString(), split: splitDetails, refunds: refundList };
  await db.payment.update({ where: { id: booking.payment.id }, data: { reconciliationSnapshot: snapshot, reconciledAt: new Date() } });
  await db.auditLog.create({ data: { adminId: res.locals.user.id, action: 'RECONCILE_CASHFREE_PAYMENT', entity: 'Payment', entityId: booking.payment.id, after: { orderId: booking.payment.gatewayRef, refunds: refundList.length, splitChecked: easySplitEnabled } } });
  const updated = await db.payment.findUnique({ where: { id: booking.payment.id }, include: { refunds: { orderBy: { createdAt: 'asc' } } } });
  res.json({ split: splitDetails, refunds: updated?.refunds, refundedAmount: updated?.refundedAmount, reconciledAt: updated?.reconciledAt });
});
async function processCashfreeRefundStatuses() {
  if (!cashfreeId || !cashfreeSecret) return;
  const pending = await db.cashfreeRefund.findMany({ where: { status: { in: ['PENDING', 'UNKNOWN'] } }, include: { payment: { select: { gatewayRef: true } } }, orderBy: { updatedAt: 'asc' }, take: 50 });
  const orderIds = Array.from(new Set(pending.map(function (refund) { return refund.payment.gatewayRef; }).filter((id): id is string => !!id)));
  for (const orderId of orderIds) {
    try {
      const response = await fetch(cashfreeEnv + '/orders/' + encodeURIComponent(orderId) + '/refunds', { headers: { 'x-client-id': cashfreeId, 'x-client-secret': cashfreeSecret, 'x-api-version': cashfreeVersion }, signal: AbortSignal.timeout(15_000) });
      if (!response.ok) continue;
      const refunds = await response.json() as any[];
      if (Array.isArray(refunds)) for (const providerRefund of refunds) if (providerRefund.refund_id) await applyCashfreeRefundStatus(String(providerRefund.refund_id), providerRefund);
    } catch (error) { console.error('Cashfree refund status check failed', { orderId, error }); }
  }
}
setInterval(function () { processCashfreeRefundStatuses().catch(function (error) { console.error('Cashfree refund polling failed', error); }); }, 5 * 60_000).unref();
app.post('/api/v1/payments/razorpay/webhook', async function (req, res) {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET, signature = req.header('x-razorpay-signature');
  if (!secret || !signature || !Buffer.isBuffer(req.body)) return res.status(503).end();
  const expected = createHmac('sha256', secret).update(req.body).digest();
  const received = Buffer.from(signature, 'hex');
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) return res.status(400).json({ error: 'Invalid webhook signature.' });
  try {
    const event = JSON.parse(req.body.toString());
    if (event.event === 'payment.captured') {
      const paid = event.payload?.payment?.entity;
      const payment = paid?.order_id ? await db.payment.findFirst({ where: { gatewayRef: paid.order_id } }) : null;
      if (payment && paid.amount === payment.amount) await db.$transaction([
        db.payment.update({ where: { id: payment.id }, data: { status: PaymentStatus.VERIFIED } }),
        db.booking.updateMany({ where: { id: payment.bookingId, status: BookingStatus.PAYMENT_PENDING }, data: { status: BookingStatus.PAID } })
      ]);
    }
    res.json({ received: true });
  } catch (error) { console.error('Payment webhook processing failed', error); res.status(500).end(); }
});

app.get('/api/v1/worker/jobs', worker, async function (_req, res) {
  const profile = await db.worker.findUnique({ where: { userId: res.locals.user.id }, include: { zones: true } });
  if (!profile || profile.kycStatus !== KycStatus.APPROVED) return res.status(403).json({ error: 'Worker account is not approved.' });
  if (!profile.isOnline) return res.json([]);
  const zones = await db.zone.findMany({ where: { isActive: true, ...pilotZoneWhere }, select: { id: true, name: true, centerLat: true, centerLng: true, radiusKm: true, polygon: true } });
  const zoneIds = new Set(profile.zones.map(function (x) { return x.zoneId; }));
  if (profile.currentLat != null && profile.currentLng != null) zones.filter(function (zone) { return zoneContainsPoint(zone, profile.currentLat!, profile.currentLng!); }).forEach(function (zone) { zoneIds.add(zone.id); });
  const categories = profile.solarQualified ? ['VEHICLE', 'SOLAR'] : ['VEHICLE'];
  res.json(await db.booking.findMany({ where: { status: { in: [BookingStatus.PAID, BookingStatus.ASSIGNING] }, workerId: null, zoneId: { in: Array.from(zoneIds) }, service: { category: { in: categories as any } } }, include: { service: true, vehicle: { select: { model: true, type: true } }, vehicleItems: { include: { vehicle: { select: { model: true, type: true } }, service: { select: { name: true } } } }, zone: true }, orderBy: { scheduledAt: 'asc' } }));
});
app.get('/api/v1/worker/profile', worker, async function (_req, res) { const profile = await db.worker.findUnique({ where: { userId: res.locals.user.id }, include: { zones: { include: { zone: true } } } }); if (!profile) return res.status(404).json({ error: 'Worker profile is not provisioned.' }); res.json(profile); });
app.get('/api/v1/worker/bookings', worker, async function (_req, res) { const profile = await db.worker.findUnique({ where: { userId: res.locals.user.id } }); if (!profile) return res.status(404).json({ error: 'Worker profile is not provisioned.' }); res.json(await db.booking.findMany({ where: { workerId: profile.id }, include: { service: true, vehicle: true, vehicleItems: { include: { vehicle: true, service: { select: { name: true } } } }, address: true, zone: true }, orderBy: { scheduledAt: 'desc' } })); });
app.get('/api/v1/worker/wallet', worker, async function (_req, res) {
  const profile = await db.worker.findUnique({ where: { userId: res.locals.user.id } }); if (!profile) return res.status(404).json({ error: 'Worker profile is not provisioned.' });
  const [ledger, rows] = await Promise.all([
    db.walletLedger.findMany({ where: { workerId: profile.id }, orderBy: { createdAt: 'desc' } }),
    db.booking.findMany({ where: { workerId: profile.id, payment: { is: { method: 'cashfree', status: PaymentStatus.VERIFIED } } }, include: { service: { select: { name: true } }, payment: { select: { splitStatus: true, reconciliationSnapshot: true, paidAt: true } } }, orderBy: { scheduledAt: 'desc' }, take: 100 })
  ]);
  const cashfreeBookings = rows.map(function (booking) {
    const snapshot = booking.payment?.reconciliationSnapshot as any;
    const vendors = Array.isArray(snapshot?.split?.vendors) ? snapshot.split.vendors : [];
    const settlement = vendors.find(function (vendor: any) { return vendor.vendor_id === profile.cashfreeVendorId; });
    return { bookingId: booking.id, service: booking.service.name, scheduledAt: booking.scheduledAt, workerEarning: booking.workerEarning, splitStatus: booking.payment?.splitStatus || 'WAITING_FOR_ASSIGNMENT', paidAt: booking.payment?.paidAt, settlement: settlement ? { settlementId: settlement.settlement_id, amount: Number(settlement.settlement_amount || 0), eligibleAt: settlement.settlement_eligibility_date, utr: settlement.transfer_utr || null } : null };
  });
  res.json({ balance: ledger.reduce(function (sum, x) { return sum + (x.type === LedgerType.CREDIT ? x.amount : -x.amount); }, 0), ledger, cashfreeBookings });
});
app.patch('/api/v1/worker/online', worker, async function (req, res) {
  const p = z.object({ online: z.boolean() }).safeParse(req.body); if (!p.success) return res.status(400).json({ error: 'online must be true or false.' });
  const profile = await db.worker.findUnique({ where: { userId: res.locals.user.id } });
  if (!profile || profile.kycStatus !== KycStatus.APPROVED) return res.status(403).json({ error: 'Worker account is not approved.' });
  const updated = await db.worker.update({ where: { id: profile.id }, data: { isOnline: p.data.online } }); res.json({ online: updated.isOnline });
});
app.patch('/api/v1/worker/location', worker, async function (req, res) { const p = z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }).safeParse(req.body); if (!p.success) return res.status(400).json({ error: 'Location coordinates are invalid.' }); const profile = await db.worker.findUnique({ where: { userId: res.locals.user.id } }); if (!profile || !profile.isOnline || profile.kycStatus !== KycStatus.APPROVED) return res.status(403).json({ error: 'Approved online workers only.' }); await db.worker.update({ where: { id: profile.id }, data: { currentLat: p.data.lat, currentLng: p.data.lng } }); res.status(204).end(); });
app.post('/api/v1/worker/jobs/:id/accept', worker, async function (req, res) {
  const profile = await db.worker.findUnique({ where: { userId: res.locals.user.id }, include: { zones: true } });
  if (!profile || !profile.isOnline || profile.kycStatus !== KycStatus.APPROVED) return res.status(403).json({ error: 'Go online after your account is approved.' });
  const booking = await db.booking.findUnique({ where: { id: String(req.params.id) }, include: { zone: true, service: true } });
  const explicitlyAssigned = profile.zones.some(function (link) { return link.zoneId === booking?.zoneId; });
  const physicallyInZone = !!(booking && profile.currentLat != null && profile.currentLng != null && zoneContainsPoint(booking.zone, profile.currentLat, profile.currentLng));
  if (!booking || (!explicitlyAssigned && !physicallyInZone) || (booking.service.category === 'SOLAR' && !profile.solarQualified)) return res.status(403).json({ error: 'Go online within this service zone or ask an admin to assign you to it.' });
  const eligibleCategories = profile.solarQualified ? ['VEHICLE', 'SOLAR'] : ['VEHICLE'];
  const result = await db.booking.updateMany({ where: { id: booking.id, zoneId: booking.zoneId, status: { in: [BookingStatus.PAID, BookingStatus.ASSIGNING] }, workerId: null, service: { category: { in: eligibleCategories as any } } }, data: { workerId: profile.id, status: BookingStatus.ASSIGNED } });
  if (!result.count) return res.status(409).json({ error: 'Job is no longer available.' });
  await db.payment.updateMany({ where: { bookingId: String(req.params.id), method: 'cashfree', status: PaymentStatus.VERIFIED }, data: { splitStatus: 'PENDING' } });
  res.json({ id: String(req.params.id), status: BookingStatus.ASSIGNED });
});
app.patch('/api/v1/worker/bookings/:id/status', worker, async function (req, res) {
  const target = z.enum(['WORKER_ON_THE_WAY', 'IN_PROGRESS']).safeParse(req.body.status);
  if (!target.success) return res.status(400).json({ error: 'Unsupported worker status.' });
  const profile = await db.worker.findUnique({ where: { userId: res.locals.user.id } }); if (!profile) return res.status(403).json({ error: 'Worker profile not found.' });
  const expected = target.data === 'WORKER_ON_THE_WAY' ? [BookingStatus.ASSIGNED] : [BookingStatus.WORKER_ON_THE_WAY, BookingStatus.REJECTED_PHOTOS];
  const result = await db.booking.updateMany({ where: { id: String(req.params.id), workerId: profile.id, status: { in: expected } }, data: { status: target.data } });
  if (!result.count) return res.status(409).json({ error: 'Booking is not in the expected state.' }); res.json({ id: String(req.params.id), status: target.data });
});
app.post('/api/v1/worker/bookings/:id/photos/presign', worker, async function (req, res) {
  if (!s3 || !bucket) return res.status(503).json({ error: 'Private photo storage is not configured.' });
  const p = z.object({ type: z.nativeEnum(PhotoType), contentType: z.enum(['image/jpeg', 'image/png', 'image/webp']) }).safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: 'Choose an allowed photo type and image format.' });
  const profile = await db.worker.findUnique({ where: { userId: res.locals.user.id } });
  const booking = await db.booking.findFirst({ where: { id: String(req.params.id), workerId: profile?.id, status: BookingStatus.IN_PROGRESS } });
  if (!booking) return res.status(403).json({ error: 'Photo upload is allowed only for your active job.' });
  const ext = p.data.contentType === 'image/jpeg' ? 'jpg' : p.data.contentType.split('/')[1];
  const key = 'bookings/' + booking.id + '/' + p.data.type.toLowerCase() + '/' + randomUUID() + '.' + ext;
  const uploadUrl = await getSignedUrl(s3, new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: p.data.contentType }), { expiresIn: 300 });
  res.json({ uploadUrl, objectKey: key, expiresIn: 300 });
});
app.post('/api/v1/worker/bookings/:id/photos', worker, async function (req, res) {
  if (!s3 || !bucket) return res.status(503).json({ error: 'Private photo storage is not configured.' });
  const p = z.object({ type: z.nativeEnum(PhotoType), objectKey: z.string().min(10), capturedAt: z.string().datetime(), lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }).safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: 'Photo metadata is invalid.' });
  const profile = await db.worker.findUnique({ where: { userId: res.locals.user.id } });
  const booking = await db.booking.findFirst({ where: { id: String(req.params.id), workerId: profile?.id, status: BookingStatus.IN_PROGRESS } });
  if (!booking || !p.data.objectKey.startsWith('bookings/' + booking.id + '/' + p.data.type.toLowerCase() + '/')) return res.status(403).json({ error: 'This photo does not belong to your active job.' });
  try {
    const object = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: p.data.objectKey }));
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(object.ContentType || '') || (object.ContentLength || 0) > 10 * 1024 * 1024) return res.status(400).json({ error: 'Photo must be JPEG, PNG or WebP up to 10 MB.' });
    const photo = await db.bookingPhoto.create({ data: { bookingId: booking.id, type: p.data.type, url: p.data.objectKey, capturedAt: new Date(p.data.capturedAt), lat: p.data.lat, lng: p.data.lng } });
    const counts = await db.bookingPhoto.groupBy({ by: ['type'], where: { bookingId: booking.id, status: { not: PhotoStatus.REJECTED } }, _count: { _all: true } });
    if (counts.some(function (c) { return c.type === PhotoType.BEFORE && c._count._all >= 2; }) && counts.some(function (c) { return c.type === PhotoType.AFTER && c._count._all >= 2; })) await db.booking.update({ where: { id: booking.id }, data: { status: BookingStatus.PHOTOS_UPLOADED } });
    res.status(201).json({ id: photo.id, status: photo.status });
  } catch (error) { console.error('Photo upload confirmation failed', error); res.status(400).json({ error: 'Uploaded object could not be verified in storage.' }); }
});
app.get('/api/v1/photos/:id/view', authenticated([Role.CUSTOMER, Role.WORKER, Role.ADMIN]), async function (req, res) {
  if (!s3 || !bucket) return res.status(503).json({ error: 'Private photo storage is not configured.' });
  const photo = await db.bookingPhoto.findUnique({ where: { id: String(req.params.id) }, include: { booking: true } }); if (!photo) return res.status(404).json({ error: 'Photo not found.' });
  const user = res.locals.user;
  const allowed = user.role === Role.ADMIN || (user.role === Role.CUSTOMER && photo.booking.customerId === user.id) || (user.role === Role.WORKER && (await db.worker.findUnique({ where: { userId: user.id } }))?.id === photo.booking.workerId);
  if (!allowed || (photo.status !== PhotoStatus.APPROVED && user.role === Role.CUSTOMER)) return res.status(403).json({ error: 'You cannot view this photo.' });
  res.json({ url: await getSignedUrl(s3, new GetObjectCommand({ Bucket: bucket, Key: photo.url }), { expiresIn: 300 }), expiresIn: 300 });
});
app.get('/api/v1/admin/photos', admin, async function (_req, res) { res.json(await db.bookingPhoto.findMany({ where: { status: PhotoStatus.PENDING }, include: { booking: { include: { service: true, customer: { select: { id: true, email: true, name: true, phone: true } }, worker: { include: { user: { select: { id: true, email: true, name: true, phone: true } } } } } } }, orderBy: { capturedAt: 'asc' } })); });
app.patch('/api/v1/admin/photos/:id', admin, async function (req, res) {
  const p = z.object({ status: z.enum(['APPROVED', 'REJECTED']) }).safeParse(req.body); if (!p.success) return res.status(400).json({ error: 'status must be APPROVED or REJECTED.' });
  const photo = await db.bookingPhoto.findUnique({ where: { id: String(req.params.id) }, include: { booking: true } }); if (!photo) return res.status(404).json({ error: 'Photo not found.' });
  await db.bookingPhoto.update({ where: { id: photo.id }, data: { status: p.data.status } });
  if (p.data.status === 'REJECTED') await db.booking.update({ where: { id: photo.bookingId }, data: { status: BookingStatus.REJECTED_PHOTOS } });
  if (p.data.status === 'APPROVED') {
    const all = await db.bookingPhoto.findMany({ where: { bookingId: photo.bookingId, status: { not: PhotoStatus.REJECTED } } });
    const enough = [PhotoType.BEFORE, PhotoType.AFTER].every(function (type) { return all.filter(function (x) { return x.type === type; }).length >= 2; });
    if (enough && all.every(function (x) { return x.status === PhotoStatus.APPROVED || x.id === photo.id; }) && photo.booking.workerId) {
      const workerId = photo.booking.workerId;
      await db.$transaction(async function (tx) {
        const payment = await tx.payment.findUnique({ where: { bookingId: photo.bookingId }, select: { method: true } });
        const usesCashfreeVendorSettlement = payment?.method === 'cashfree';
        if (!usesCashfreeVendorSettlement) await tx.$queryRaw`SELECT "id" FROM "Worker" WHERE "id" = ${workerId} FOR UPDATE`;
        const exists = usesCashfreeVendorSettlement ? null : await tx.walletLedger.findFirst({ where: { workerId, bookingId: photo.bookingId, type: LedgerType.CREDIT } });
        if (!exists && !usesCashfreeVendorSettlement) {
          const ledger = await tx.walletLedger.findMany({ where: { workerId } });
          const balance = ledger.reduce(function (n, x) { return n + (x.type === LedgerType.CREDIT ? x.amount : -x.amount); }, 0);
          await tx.walletLedger.create({ data: { workerId, bookingId: photo.bookingId, type: LedgerType.CREDIT, amount: photo.booking.workerEarning, balanceAfter: balance + photo.booking.workerEarning } });
        }
        await tx.booking.update({ where: { id: photo.bookingId }, data: { status: BookingStatus.COMPLETED, completedAt: new Date() } });
      }, { isolationLevel: 'ReadCommitted' });
    }
  }
  await db.auditLog.create({ data: { adminId: res.locals.user.id, action: 'REVIEW_PHOTO', entity: 'BookingPhoto', entityId: photo.id, after: { status: p.data.status } } });
  res.json({ id: photo.id, status: p.data.status });
});

app.get('/api/v1/admin/bookings/:id/eligible-workers', admin, async function (req, res) {
  const booking = await db.booking.findUnique({ where: { id: String(req.params.id) }, include: { zone: true, service: true } }); if (!booking) return res.status(404).json({ error: 'Booking not found.' });
  const workers = await db.worker.findMany({ where: { isOnline: true, kycStatus: KycStatus.APPROVED, user: { isActive: true }, ...(booking.service.category === 'SOLAR' ? { solarQualified: true } : {}) }, include: { user: { select: { name: true, email: true } }, zones: { select: { zoneId: true } } } });
  res.json(workers.filter(function (candidate) { return candidate.zones.some(function (link) { return link.zoneId === booking.zoneId; }) || (candidate.currentLat != null && candidate.currentLng != null && zoneContainsPoint(booking.zone, candidate.currentLat, candidate.currentLng)); }).map(function (candidate) { return { id: candidate.id, user: candidate.user, isOnline: candidate.isOnline, kycStatus: candidate.kycStatus, solarQualified: candidate.solarQualified }; }));
});
app.post('/api/v1/admin/bookings/:id/assign', admin, async function (req, res) {
  const p = z.object({ workerId: z.string().min(1) }).safeParse(req.body); if (!p.success) return res.status(400).json({ error: 'Choose a worker.' });
  const booking = await db.booking.findUnique({ where: { id: String(req.params.id), }, include: { service: true, zone: true } }); if (!booking) return res.status(404).json({ error: 'Booking not found.' });
  const [candidate, zoneLink] = await Promise.all([
    db.worker.findUnique({ where: { id: p.data.workerId }, select: { id: true, isOnline: true, kycStatus: true, solarQualified: true, currentLat: true, currentLng: true, user: { select: { isActive: true } } } }),
    db.workerZone.findUnique({ where: { workerId_zoneId: { workerId: p.data.workerId, zoneId: booking.zoneId } }, select: { workerId: true } })
  ]);
  if (!candidate) return res.status(404).json({ error: 'Worker not found.' });
  const blockers: string[] = [];
  if (!candidate.user.isActive) blockers.push('account is blocked');
  if (candidate.kycStatus !== KycStatus.APPROVED) blockers.push('KYC is not approved');
  if (!candidate.isOnline) blockers.push('worker is offline');
  if (!zoneLink && !(candidate.currentLat != null && candidate.currentLng != null && zoneContainsPoint(booking.zone, candidate.currentLat, candidate.currentLng))) blockers.push('worker is not assigned to this service zone and their live location is outside it');
  if (booking.service.category === 'SOLAR' && !candidate.solarQualified) blockers.push('worker is not marked Solar-qualified');
  if (blockers.length) return res.status(409).json({ error: 'Cannot assign this booking: ' + blockers.join('; ') + '.' });
  const changed = await db.booking.updateMany({ where: { id: booking.id, workerId: null, status: { in: [BookingStatus.PAID, BookingStatus.ASSIGNING] } }, data: { workerId: p.data.workerId, status: BookingStatus.ASSIGNED } });
  if (!changed.count) return res.status(409).json({ error: 'Booking is not available for assignment.' });
  await db.payment.updateMany({ where: { bookingId: booking.id, method: 'cashfree', status: PaymentStatus.VERIFIED }, data: { splitStatus: 'PENDING' } });
  await db.auditLog.create({ data: { adminId: res.locals.user.id, action: 'ASSIGN_BOOKING', entity: 'Booking', entityId: booking.id, after: { workerId: p.data.workerId } } });
  res.json({ id: booking.id, status: BookingStatus.ASSIGNED, workerId: p.data.workerId });
});
app.post('/api/v1/admin/bookings/:id/quote', admin, async function (req, res) {
  const p = z.object({ amount: z.number().int().min(100).max(100000000), note: z.string().trim().min(5).max(1000) }).strict().safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: 'Enter a final quote in paise and an inspection note.' });
  const booking = await db.booking.findUnique({ where: { id: String(req.params.id) }, include: { service: true, zone: true } });
  if (!booking || booking.service.category !== 'SOLAR') return res.status(404).json({ error: 'Solar quote request not found.' });
  if (booking.status !== BookingStatus.QUOTE_REQUESTED) return res.status(409).json({ error: 'This quote request has already been priced or canceled.' });
  const commissionAmt = Math.round(p.data.amount * booking.zone.baseCommissionPct / 100);
  const updated = await db.booking.update({ where: { id: booking.id }, data: { price: p.data.amount, commissionAmt, workerEarning: p.data.amount - commissionAmt, quoteNote: p.data.note, status: BookingStatus.QUOTE_PROVIDED } });
  await db.auditLog.create({ data: { adminId: res.locals.user.id, action: 'PROVIDE_SOLAR_QUOTE', entity: 'Booking', entityId: booking.id, before: { status: booking.status }, after: { amount: updated.price, note: updated.quoteNote, status: updated.status } } });
  res.json({ id: updated.id, status: updated.status, price: updated.price, note: updated.quoteNote });
});
app.get('/api/v1/admin/bookings', admin, async function (req, res) {
  const state = typeof req.query.status === 'string' && Object.values(BookingStatus).includes(req.query.status as BookingStatus) ? req.query.status as BookingStatus : undefined;
  res.setHeader('Cache-Control', 'private, no-store');
  res.json(await db.booking.findMany({ where: state ? { status: state } : {}, include: { customer: { select: { id: true, email: true, name: true, phone: true } }, worker: { include: { user: { select: { id: true, email: true, name: true, phone: true } } } }, vehicle: true, vehicleItems: { include: { vehicle: true, service: { select: { name: true } } } }, address: true, service: true, zone: true, payment: { include: { refunds: { orderBy: { createdAt: 'desc' } } } } }, orderBy: { createdAt: 'desc' }, take: 1000 }));
});
app.get('/api/v1/admin/workers', admin, async function (_req, res) { res.json(await db.worker.findMany({ include: { user: { select: { id: true, email: true, name: true, role: true, isActive: true } }, zones: { include: { zone: true } } }, orderBy: { user: { name: 'asc' } } })); });
app.post('/api/v1/admin/workers', admin, async function (req, res) {
  const p = z.object({ email: emailBody, name: z.string().trim().min(1).max(100), type: z.nativeEnum(WorkerType) }).safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: 'Worker email, name or type is invalid.' });
  try { const user = await db.user.upsert({ where: { email: p.data.email }, update: { name: p.data.name, role: Role.WORKER, isActive: true }, create: { email: p.data.email, name: p.data.name, role: Role.WORKER } }); const profile = await db.worker.upsert({ where: { userId: user.id }, update: { type: p.data.type }, create: { userId: user.id, type: p.data.type } }); res.status(201).json({ ...profile, user: { id: user.id, email: user.email, name: user.name, role: user.role } }); }
  catch (error) { console.error(error); res.status(409).json({ error: 'Could not add worker.' }); }
});
app.patch('/api/v1/admin/workers/:id/cashfree-vendor', admin, async function (req, res) {
  const p = z.object({ vendorId: z.string().trim().min(1).max(100) }).strict().safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: 'Enter the verified Cashfree Easy Split vendor ID.' });
  const before = await db.worker.findUnique({ where: { id: String(req.params.id) }, select: { id: true, cashfreeVendorId: true } });
  if (!before) return res.status(404).json({ error: 'Worker not found.' });
  const updated = await db.worker.update({ where: { id: before.id }, data: { cashfreeVendorId: p.data.vendorId } });
  await db.payment.updateMany({ where: { method: 'cashfree', status: PaymentStatus.VERIFIED, splitStatus: 'WAITING_FOR_VENDOR', booking: { workerId: before.id } }, data: { splitStatus: 'PENDING' } });
  await db.auditLog.create({ data: { adminId: res.locals.user.id, action: 'SET_CASHFREE_VENDOR', entity: 'Worker', entityId: before.id, before: { cashfreeVendorId: before.cashfreeVendorId }, after: { cashfreeVendorId: p.data.vendorId } } });
  res.json({ id: updated.id, cashfreeVendorId: updated.cashfreeVendorId });
});
app.patch('/api/v1/admin/workers/:id/solar-qualification', admin, async function (req, res) {
  const p = z.object({ qualified: z.boolean() }).strict().safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: 'qualified must be true or false.' });
  const updated = await db.worker.updateMany({ where: { id: String(req.params.id) }, data: { solarQualified: p.data.qualified } });
  if (!updated.count) return res.status(404).json({ error: 'Worker not found.' });
  await db.auditLog.create({ data: { adminId: res.locals.user.id, action: 'SET_SOLAR_QUALIFICATION', entity: 'Worker', entityId: String(req.params.id), after: p.data } });
  res.json({ id: String(req.params.id), solarQualified: p.data.qualified });
});
app.patch('/api/v1/admin/workers/:id/kyc', admin, async function (req, res) {
  const p = z.object({ status: z.enum(['APPROVED', 'REJECTED']) }).safeParse(req.body); if (!p.success) return res.status(400).json({ error: 'status must be APPROVED or REJECTED.' });
  const result = await db.worker.updateMany({ where: { id: String(req.params.id) }, data: { kycStatus: p.data.status } }); if (!result.count) return res.status(404).json({ error: 'Worker not found.' }); res.json({ id: String(req.params.id), kycStatus: p.data.status });
});
app.put('/api/v1/admin/workers/:workerId/zones/:zoneId', admin, async function (req, res) { const workerId = String(req.params.workerId), zoneId = String(req.params.zoneId); if (!await db.worker.findUnique({ where: { id: workerId } }) || !await db.zone.findUnique({ where: { id: zoneId } })) return res.status(404).json({ error: 'Worker or zone not found.' }); const link = await db.workerZone.upsert({ where: { workerId_zoneId: { workerId, zoneId } }, create: { workerId, zoneId }, update: {} }); await db.auditLog.create({ data: { adminId: res.locals.user.id, action: 'ASSIGN_WORKER_ZONE', entity: 'WorkerZone', entityId: workerId + ':' + zoneId, after: { workerId, zoneId } } }); res.json(link); });
app.delete('/api/v1/admin/workers/:workerId/zones/:zoneId', admin, async function (req, res) { const workerId = String(req.params.workerId), zoneId = String(req.params.zoneId); await db.workerZone.deleteMany({ where: { workerId, zoneId } }); await db.auditLog.create({ data: { adminId: res.locals.user.id, action: 'REMOVE_WORKER_ZONE', entity: 'WorkerZone', entityId: workerId + ':' + zoneId } }); res.status(204).end(); });
app.patch('/api/v1/admin/workers/:id/block', admin, async function (req, res) { const profile = await db.worker.findUnique({ where: { id: String(req.params.id) } }); if (!profile) return res.status(404).json({ error: 'Worker not found.' }); await db.$transaction([db.worker.update({ where: { id: profile.id }, data: { isOnline: false } }), db.user.update({ where: { id: profile.userId }, data: { isActive: false } })]); res.json({ blocked: true }); });
app.get('/api/v1/admin/audit-logs', admin, async function (req, res) { const take = Math.max(1, Math.min(100, Number(req.query.limit) || 50)); res.json(await db.auditLog.findMany({ include: { admin: { select: { name: true, phone: true } } }, orderBy: { createdAt: 'desc' }, take })); });
app.get('/api/v1/admin/campaigns', admin, async function (_req, res) { res.json(await db.campaign.findMany({ include: { zone: true }, orderBy: { startDate: 'desc' } })); });
app.get('/api/v1/admin/notifications/health', admin, async function (_req, res) {
  const [queued, failed, sentToday, coupons] = await Promise.all([
    db.notificationDelivery.count({ where: { status: { in: ['PENDING', 'SENDING'] } } }),
    db.notificationDelivery.count({ where: { status: 'FAILED' } }),
    db.notificationDelivery.count({ where: { status: 'SENT', sentAt: { gte: new Date(Date.now() - 86400000) } } }),
    db.coupon.count({ where: { expiresAt: { gt: new Date() }, redeemedAt: null } })
  ]);
  res.json({ queued, failed, sentToday, activeCoupons: coupons, pushConfigured: pushReady, whatsappAlertsConfigured: !!(process.env.EVOLUTION_GO_BASE_URL && process.env.EVOLUTION_GO_INSTANCE_TOKEN), whatsappMarketingConfigured: !!(process.env.WHATSAPP_MARKETING_SEND_URL && process.env.WHATSAPP_MARKETING_TOKEN) });
});
app.get('/api/v1/admin/notifications/deliveries', admin, async function (_req, res) {
  const rows = await db.notificationDelivery.findMany({ select: { id: true, channel: true, recipient: true, template: true, status: true, attempts: true, lastError: true, createdAt: true, sentAt: true }, orderBy: { createdAt: 'desc' }, take: 40 });
  res.json(rows.map(function (row) { const recipient = row.recipient; return { ...row, recipient: recipient.includes('@') ? recipient.replace(/^(.).+(@.*)$/, '$1•••$2') : recipient.length > 6 ? recipient.slice(0, 3) + '••••' + recipient.slice(-3) : recipient }; }));
});
app.post('/api/v1/admin/notifications/:id/retry', admin, async function (req, res) {
  const delivery = await db.notificationDelivery.findUnique({ where: { id: String(req.params.id) }, select: { id: true, status: true, channel: true } });
  if (!delivery) return res.status(404).json({ error: 'Notification delivery not found.' });
  if (delivery.status !== 'FAILED') return res.status(409).json({ error: 'Only failed deliveries can be retried.' });
  await db.notificationDelivery.update({ where: { id: delivery.id }, data: { status: 'PENDING', attempts: 0, lastError: null, nextAttemptAt: new Date() } });
  await db.auditLog.create({ data: { adminId: res.locals.user.id, action: 'RETRY_NOTIFICATION', entity: 'NotificationDelivery', entityId: delivery.id, after: { channel: delivery.channel } } });
  res.json({ queued: true });
});
const campaignInput = z.object({ name: z.string().trim().min(2).max(100), zoneId: z.string().min(1), startDate: z.string().datetime(), endDate: z.string().datetime(), surgePct: z.number().min(0).max(500), tempWorkersNeeded: z.number().int().min(0).max(10000) });
app.post('/api/v1/admin/campaigns', admin, async function (req, res) { const p = campaignInput.safeParse(req.body); if (!p.success || (p.success && new Date(p.data.endDate) <= new Date(p.data.startDate))) return res.status(400).json({ error: 'Campaign details and date range are invalid.' }); try { const campaign = await db.campaign.create({ data: { ...p.data, startDate: new Date(p.data.startDate), endDate: new Date(p.data.endDate) }, include: { zone: true } }); await db.auditLog.create({ data: { adminId: res.locals.user.id, action: 'CREATE', entity: 'Campaign', entityId: campaign.id, after: p.data } }); res.status(201).json(campaign); } catch { res.status(404).json({ error: 'Campaign zone not found.' }); } });
app.patch('/api/v1/admin/campaigns/:id', admin, async function (req, res) { const p = campaignInput.partial().safeParse(req.body); if (!p.success) return res.status(400).json({ error: 'Campaign update is invalid.' }); const data = { ...p.data, ...(p.data.startDate ? { startDate: new Date(p.data.startDate) } : {}), ...(p.data.endDate ? { endDate: new Date(p.data.endDate) } : {}) }; const current = await db.campaign.findUnique({ where: { id: String(req.params.id) } }); if (!current) return res.status(404).json({ error: 'Campaign not found.' }); const updated = await db.campaign.update({ where: { id: current.id }, data }); await db.auditLog.create({ data: { adminId: res.locals.user.id, action: 'UPDATE', entity: 'Campaign', entityId: current.id, before: { name: current.name, startDate: current.startDate, endDate: current.endDate }, after: p.data } }); res.json(updated); });
app.get('/api/v1/admin/reports/summary', admin, async function (req, res) { const from = typeof req.query.from === 'string' ? new Date(req.query.from) : new Date(Date.now() - 30 * 86400000); const to = typeof req.query.to === 'string' ? new Date(req.query.to) : new Date(); if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || to < from) return res.status(400).json({ error: 'Date range is invalid.' }); const rows = await db.booking.groupBy({ by: ['status'], where: { createdAt: { gte: from, lte: to } }, _count: { _all: true }, _sum: { price: true } }); res.json({ from, to, bookings: rows.reduce(function (n, x) { return n + x._count._all; }, 0), revenuePaise: rows.filter(function (x) { return x.status !== BookingStatus.CANCELLED && x.status !== BookingStatus.REFUNDED; }).reduce(function (n, x) { return n + (x._sum.price || 0); }, 0), byStatus: rows.map(function (x) { return { status: x.status, count: x._count._all, amountPaise: x._sum.price || 0 }; }) }); });

app.get('/api/v1/admin/zones/config', admin, function (_req, res) { res.setHeader('Cache-Control', 'private, no-store'); res.json({ googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY || null }); });
app.get('/api/v1/admin/zones', admin, async function (_req, res) { res.json(await db.zone.findMany({ include: { prices: { include: { service: true } }, workers: { include: { worker: { include: { user: { select: { id: true, email: true, name: true } } } } } } }, orderBy: { name: 'asc' } })); });
const zoneInput = z.object({ name: z.string().trim().min(2).max(100), baseCommissionPct: z.number().min(0).max(100), couponMinimumContributionPct: z.number().min(0).max(20).default(1), centerLat: z.number().min(-90).max(90), centerLng: z.number().min(-180).max(180), radiusKm: z.number().min(0.25).max(30) }).strict();
app.post('/api/v1/admin/zones', admin, async function (req, res) { const p = zoneInput.safeParse(req.body); if (!p.success) return res.status(400).json({ error: 'Choose a map center and radius between 0.25 and 30 km.' }); const zone = await db.zone.create({ data: p.data }); await db.auditLog.create({ data: { adminId: res.locals.user.id, action: 'CREATE', entity: 'Zone', entityId: zone.id, after: p.data } }); res.status(201).json(zone); });
app.patch('/api/v1/admin/zones/:id', admin, async function (req, res) {
  const p = z.object({ name: z.string().trim().min(2).max(100).optional(), baseCommissionPct: z.number().min(0).max(100).optional(), couponMinimumContributionPct: z.number().min(0).max(20).optional(), centerLat: z.number().min(-90).max(90).optional(), centerLng: z.number().min(-180).max(180).optional(), radiusKm: z.number().min(0.25).max(30).optional(), isActive: z.boolean().optional() }).strict().safeParse(req.body);
  if (!p.success || (p.success && (p.data.centerLat !== undefined || p.data.centerLng !== undefined || p.data.radiusKm !== undefined) && (p.data.centerLat === undefined || p.data.centerLng === undefined || p.data.radiusKm === undefined))) return res.status(400).json({ error: 'Provide the map center and radius together.' });
  const before = await db.zone.findUnique({ where: { id: String(req.params.id) } }); if (!before) return res.status(404).json({ error: 'Zone not found.' });
  const zone = await db.zone.update({ where: { id: before.id }, data: p.data });
  await db.auditLog.create({ data: { adminId: res.locals.user.id, action: 'UPDATE', entity: 'Zone', entityId: zone.id, before: { name: before.name, isActive: before.isActive, baseCommissionPct: before.baseCommissionPct, centerLat: before.centerLat, centerLng: before.centerLng, radiusKm: before.radiusKm }, after: p.data } }); res.json(zone);
});

app.get('/api/v1/admin/services', admin, async function (_req, res) { res.json(await db.service.findMany({ include: { prices: { include: { zone: true } } }, orderBy: { name: 'asc' } })); });
app.patch('/api/v1/admin/services/:id', admin, async function (req, res) { const p = z.object({ isActive: z.boolean() }).strict().safeParse(req.body); if (!p.success) return res.status(400).json({ error: 'Provide a service activation setting.' }); const before = await db.service.findUnique({ where: { id: String(req.params.id) } }); if (!before) return res.status(404).json({ error: 'Service not found.' }); const active = before.category === 'HOME' && process.env.HOME_WASH_ENABLED !== 'true' ? false : p.data.isActive; const service = await db.service.update({ where: { id: before.id }, data: { isActive: active } }); await db.auditLog.create({ data: { adminId: res.locals.user.id, action: 'SET_SERVICE_ACTIVE', entity: 'Service', entityId: before.id, before: { isActive: before.isActive }, after: { isActive: active } } }); res.json(service); });
const serviceInput = z.object({ name: z.string().trim().min(2).max(100), category: z.enum(['VEHICLE', 'SOLAR', 'HOME']).default('VEHICLE'), vehicleType: z.nativeEnum(VehicleType).optional(), durationMin: z.number().int().min(5).max(600), isActive: z.boolean().optional() }).strict().refine(function (x) { return x.category !== 'VEHICLE' || !!x.vehicleType; }, { message: 'Vehicle type required for vehicle services.' });
app.post('/api/v1/admin/services', admin, async function (req, res) { const p = serviceInput.safeParse(req.body); if (!p.success) return res.status(400).json({ error: 'Choose a category and the matching details for this service.' }); const data = { ...p.data, isActive: p.data.category === 'HOME' ? p.data.isActive === true && process.env.HOME_WASH_ENABLED === 'true' : p.data.isActive ?? true }; res.status(201).json(await db.service.create({ data })); });
app.put('/api/v1/admin/zones/:zoneId/prices/:serviceId', admin, async function (req, res) {
  const p = z.object({ price: z.number().int().positive().max(100000000), vehicleType: z.nativeEnum(VehicleType), festivalMultiplier: z.number().min(0.1).max(10).default(1) }).strict().safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: 'Price must be a positive amount in paise.' });
  const service = await db.service.findUnique({ where: { id: String(req.params.serviceId) } });
  if (!service || service.category !== 'VEHICLE' || service.vehicleType !== p.data.vehicleType) return res.status(422).json({ error: 'Only matching vehicle services can have an immediate zone price. Solar quotes are set after inspection.' });
  const where = { zoneId: String(req.params.zoneId), serviceId: service.id, vehicleType: p.data.vehicleType, solarPanelTier: null };
  const existing = await db.zonePrice.findFirst({ where });
  const result = existing ? await db.zonePrice.update({ where: { id: existing.id }, data: { ...p.data } }) : await db.zonePrice.create({ data: { ...where, ...p.data } });
  await db.auditLog.create({ data: { adminId: res.locals.user.id, action: 'UPSERT_PRICE', entity: 'ZonePrice', entityId: result.id, after: p.data } }); res.json(result);
});

app.get('/api/v1/admin/support/tickets', admin, async function (_req, res) { res.json(await db.supportTicket.findMany({ include: { customer: { select: { name: true, email: true, phone: true } }, booking: { select: { id: true, status: true } } }, orderBy: { createdAt: 'desc' }, take: 200 })); });
app.patch('/api/v1/admin/support/tickets/:id', admin, async function (req, res) { const p = z.object({ status: z.enum(['OPEN', 'IN_REVIEW', 'RESOLVED']) }).strict().safeParse(req.body); if (!p.success) return res.status(400).json({ error: 'Invalid ticket status.' }); const before = await db.supportTicket.findUnique({ where: { id: String(req.params.id) } }); if (!before) return res.status(404).json({ error: 'Ticket not found.' }); const row = await db.supportTicket.update({ where: { id: before.id }, data: { status: p.data.status } }); await db.auditLog.create({ data: { adminId: res.locals.user.id, action: 'UPDATE_SUPPORT_TICKET', entity: 'SupportTicket', entityId: row.id, before: { status: before.status }, after: { status: row.status } } }); res.json({ reference: row.reference, status: row.status }); });
app.get('/api/v1/admin/account-deletion-requests', admin, async function (_req, res) { res.json(await db.accountDeletionRequest.findMany({ include: { user: { select: { id: true, name: true, email: true, phone: true } } }, orderBy: { createdAt: 'asc' }, take: 200 })); });

app.get('/api/v1/admin/payouts', admin, async function (_req, res) { res.json(await db.payout.findMany({ include: { worker: { include: { user: { select: { id: true, email: true, name: true } } } } }, orderBy: { id: 'desc' } })); });
app.post('/api/v1/admin/payouts', admin, async function (req, res) {
  const p = z.object({ workerId: z.string().min(1), amount: z.number().int().positive() }).safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: 'Specify worker and amount in paise.' });
  try {
    const payout = await db.$transaction(async function (tx) {
      await tx.$queryRaw`SELECT "id" FROM "Worker" WHERE "id" = ${p.data.workerId} FOR UPDATE`;
      const profile = await tx.worker.findUnique({ where: { id: p.data.workerId } }); if (!profile) throw new Error('worker_not_found');
      const [entries, pending] = await Promise.all([tx.walletLedger.findMany({ where: { workerId: profile.id } }), tx.payout.findMany({ where: { workerId: profile.id, status: 'PENDING' } })]);
      const balance = entries.reduce(function (n, x) { return n + (x.type === LedgerType.CREDIT ? x.amount : -x.amount); }, 0) - pending.reduce(function (n, x) { return n + x.amount; }, 0);
      if (p.data.amount > balance) throw new Error('insufficient_balance');
      return tx.payout.create({ data: { workerId: profile.id, amount: p.data.amount } });
    }, { isolationLevel: 'ReadCommitted' });
    res.status(201).json(payout);
  } catch (e) { if (e instanceof Error && e.message === 'worker_not_found') return res.status(404).json({ error: 'Worker not found.' }); if (e instanceof Error && e.message === 'insufficient_balance') return res.status(409).json({ error: 'Payout exceeds available wallet balance.' }); throw e; }
});
app.post('/api/v1/admin/payouts/:id/mark-paid', admin, async function (req, res) {
  const p = z.object({ utr: z.string().trim().min(8).max(50) }).safeParse(req.body); if (!p.success) return res.status(400).json({ error: 'Enter a valid transfer reference.' });
  try {
    const updated = await db.$transaction(async function (tx) {
      const payout = await tx.payout.findUnique({ where: { id: String(req.params.id) } }); if (!payout || payout.status !== 'PENDING') throw new Error('payout_not_pending');
      await tx.$queryRaw`SELECT "id" FROM "Worker" WHERE "id" = ${payout.workerId} FOR UPDATE`;
      const entries = await tx.walletLedger.findMany({ where: { workerId: payout.workerId } });
      const available = entries.reduce(function (n, x) { return n + (x.type === LedgerType.CREDIT ? x.amount : -x.amount); }, 0);
      if (payout.amount > available) throw new Error('balance_changed');
      const changed = await tx.payout.updateMany({ where: { id: payout.id, status: 'PENDING' }, data: { status: 'PAID', utr: p.data.utr, paidAt: new Date() } });
      if (!changed.count) throw new Error('payout_not_pending');
      await tx.walletLedger.create({ data: { workerId: payout.workerId, type: LedgerType.PAYOUT, amount: payout.amount, balanceAfter: available - payout.amount } });
      return tx.payout.findUniqueOrThrow({ where: { id: payout.id } });
    }, { isolationLevel: 'ReadCommitted' });
    await db.auditLog.create({ data: { adminId: res.locals.user.id, action: 'MARK_PAYOUT_PAID', entity: 'Payout', entityId: updated.id, after: { utr: p.data.utr, amount: updated.amount } } }); res.json(updated);
  } catch (e) { if (e instanceof Error && e.message === 'payout_not_pending') return res.status(409).json({ error: 'Pending payout not found.' }); if (e instanceof Error && e.message === 'balance_changed') return res.status(409).json({ error: 'Worker balance changed; refresh the payout list.' }); throw e; }
});

app.use('/api', function (_req, res) { res.status(404).json({ error: 'API route not found.' }); });
app.use(express.static(path.join(process.cwd(), 'public')));

app.use(express.static(path.join(process.cwd(), 'public')));
app.get('*path', function (_req, res) { res.sendFile(path.join(process.cwd(), 'public', 'index.html')); });
app.use(function (_req, res) { res.status(404).json({ error: 'Not found.' }); });
const server = app.listen(port, '0.0.0.0', function () { console.log('QuickWashHub website and API listening on port ' + port); });
setInterval(function () { processDeliveryQueue().catch(function (error) { console.error('notification.queue_crash', error); }); }, 5000).unref();
setInterval(function () { runMarketingMilestones().catch(function (error) { console.error('marketing.scheduler_crash', error); }); }, 60 * 60 * 1000).unref();
setInterval(function () { retryUnassignedAlerts().catch(function (error) { console.error('booking.alert_scheduler_crash', error); }); }, 30 * 1000).unref();
setTimeout(function () { runMarketingMilestones(); retryUnassignedAlerts(); processDeliveryQueue(); }, 10_000).unref();
async function shutdown() { server.close(); await db.$disconnect(); process.exit(0); }
process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);


