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
if (production && (!process.env.CORS_ORIGIN || !process.env.RESEND_API_KEY || !process.env.EMAIL_FROM || !process.env.GOOGLE_CLIENT_ID || !process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET || !process.env.RAZORPAY_WEBHOOK_SECRET || !s3 || !bucket)) throw new Error('Production requires exact CORS origin, email delivery, Google OAuth, Razorpay and private object storage credentials.');
if (production && allowedOrigins.some(function (origin) { return origin === '*' || new URL(origin).protocol !== 'https:'; })) throw new Error('Production CORS origins must be exact HTTPS origins.');
const storageOrigin = process.env.S3_ENDPOINT ? new URL(process.env.S3_ENDPOINT).origin : '';

app.disable('x-powered-by');
app.set('trust proxy', process.env.TRUST_PROXY === 'true' ? 1 : false);
app.use(helmet.crossOriginOpenerPolicy({ policy: 'same-origin-allow-popups' }));
app.use(helmet({ contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], scriptSrc: ["'self'", 'https://checkout.razorpay.com', 'https://accounts.google.com'], styleSrc: ["'self'"], fontSrc: ["'self'"], imgSrc: ["'self'", 'data:', 'blob:', storageOrigin, 'https://*.googleusercontent.com'].filter(Boolean), connectSrc: ["'self'", 'https://api.razorpay.com', 'https://accounts.google.com', 'https://oauth2.googleapis.com', storageOrigin].filter(Boolean), frameSrc: ["'self'", 'https://api.razorpay.com', 'https://checkout.razorpay.com', 'https://accounts.google.com'], objectSrc: ["'none'"], baseUri: ["'self'"] } } }));
if (allowedOrigins.length) app.use(cors({ origin: allowedOrigins, credentials: true }));
app.use('/api/v1/payments/razorpay/webhook', express.raw({ type: 'application/json', limit: '2mb' }));
app.use(express.json({ limit: '1mb' }));

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
const admin = authenticated([Role.ADMIN]);
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 5, standardHeaders: true, legacyHeaders: false });
const apiLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 600, standardHeaders: true, legacyHeaders: false });
app.use('/api/v1', apiLimiter);

app.get('/health', async function (_req, res) {
  try { await db.$queryRaw`SELECT 1`; res.json({ status: 'ok', checks: { database: 'ok' } }); }
  catch { res.status(503).json({ status: 'error', checks: { database: 'unavailable' } }); }
});
app.get('/api/v1', function (_req, res) { res.json({ name: 'QuickWashHub Car & Bike Wash API', version: 'v1' }); });
app.get('/api/v1/auth/config', function (_req, res) { res.json({ googleClientId: process.env.GOOGLE_CLIENT_ID || null }); });

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
async function sendEmail(to: string, subject: string, text: string) {
  if (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM) throw new Error('Email delivery is not configured.');
  const response = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: 'Bearer ' + process.env.RESEND_API_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ from: process.env.EMAIL_FROM, to: [to], subject, text }) });
  if (!response.ok) throw new Error('Email delivery failed.');
}
async function startSession(user: { id: string; email: string | null; phone: string | null; name: string | null; role: Role; isActive: boolean }, res: Response) {
  if (!user.isActive) throw new Error('ACCOUNT_DISABLED');
  const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000);
  const session = await db.authSession.create({ data: { userId: user.id, expiresAt } });
  const token = issueToken({ sub: user.id, sid: session.id, exp: Math.floor(expiresAt.getTime() / 1000) });
  res.cookie(sessionCookie, token, { httpOnly: true, secure: production, sameSite: 'strict', path: '/', maxAge: 8 * 60 * 60 * 1000 });
  res.json({ user: { id: user.id, name: user.name, email: user.email, role: user.role } });
}
const challengeLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 5, standardHeaders: true, legacyHeaders: false });
app.post('/api/v1/auth/register', challengeLimiter, async function (req, res) {
  const p = z.object({ email: emailBody, name: z.string().trim().min(1).max(100), password: passwordBody }).safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: 'Enter a valid email, name and password with at least 10 characters.' });
  try {
    let user = await db.user.findUnique({ where: { email: p.data.email } });
    if (user?.passwordHash && user.emailVerifiedAt) return res.status(409).json({ error: 'An account already exists. Sign in or reset its password.' });
    const hash = await passwordHash(p.data.password);
    user = user ? await db.user.update({ where: { id: user.id }, data: { name: p.data.name, passwordHash: hash } }) : await db.user.create({ data: { email: p.data.email, name: p.data.name, passwordHash: hash, role: Role.CUSTOMER } });
    const code = String(randomInt(0, 1000000)).padStart(6, '0');
    await db.authChallenge.deleteMany({ where: { email: p.data.email, type: 'VERIFY_EMAIL' } });
    await db.authChallenge.create({ data: { email: p.data.email, userId: user.id, type: 'VERIFY_EMAIL', codeHash: challengeHash(p.data.email, 'VERIFY_EMAIL', code), expiresAt: new Date(Date.now() + 15 * 60 * 1000) } });
    await sendEmail(p.data.email, 'Verify your QuickWashHub account', 'Your QuickWashHub verification code is ' + code + '. It expires in 15 minutes.');
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
  try { await startSession(user, res); } catch { return res.status(403).json({ error: 'This account is disabled.' }); }
});
app.post('/api/v1/auth/login', challengeLimiter, async function (req, res) {
  const p = z.object({ email: emailBody, password: passwordBody }).safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: 'Email or password is invalid.' });
  const user = await db.user.findUnique({ where: { email: p.data.email } });
  if (!user?.passwordHash || !await passwordMatches(p.data.password, user.passwordHash)) return res.status(401).json({ error: 'Email or password is incorrect.' });
  if (!user.emailVerifiedAt) return res.status(403).json({ error: 'Verify your email before signing in.' });
  try { await startSession(user, res); } catch { return res.status(403).json({ error: 'This account is disabled.' }); }
});
app.post('/api/v1/auth/password-reset/request', challengeLimiter, async function (req, res) {
  const p = z.object({ email: emailBody }).safeParse(req.body);
  if (!p.success) return res.status(202).json({ message: 'If the account exists, reset instructions will be emailed.' });
  const user = await db.user.findUnique({ where: { email: p.data.email } });
  if (user) try {
    const code = String(randomInt(0, 1000000)).padStart(6, '0');
    await db.authChallenge.deleteMany({ where: { email: p.data.email, type: 'PASSWORD_RESET' } });
    await db.authChallenge.create({ data: { email: p.data.email, userId: user.id, type: 'PASSWORD_RESET', codeHash: challengeHash(p.data.email, 'PASSWORD_RESET', code), expiresAt: new Date(Date.now() + 15 * 60 * 1000) } });
    await sendEmail(p.data.email, 'Reset your QuickWashHub password', 'Your password reset code is ' + code + '. It expires in 15 minutes.');
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
    await startSession(user, res);
  } catch (error) { if (res.headersSent) return; console.error('Google credential validation failed', error); res.status(401).json({ error: 'Google sign-in failed. Try again.' }); }
});
app.post('/api/v1/auth/logout', async function (req, res) {
  const token = getCookie(req);
  if (token) try { await db.authSession.deleteMany({ where: { id: decodeToken(token).sid } }); } catch { /* already expired */ }
  res.clearCookie(sessionCookie, { httpOnly: true, secure: production, sameSite: 'strict', path: '/' });
  res.status(204).end();
});
app.get('/api/v1/me', authenticated(), function (_req, res) { const u = res.locals.user; res.json({ id: u.id, name: u.name, email: u.email, role: u.role }); });
app.get('/api/v1/bootstrap', authenticated([Role.CUSTOMER]), async function (_req, res) {
  const userId = res.locals.user.id;
  const [vehicles, addresses, prices] = await Promise.all([
    db.vehicle.findMany({ where: { customerId: userId }, orderBy: { model: 'asc' } }),
    db.address.findMany({ where: { customerId: userId }, include: { zone: true }, orderBy: { label: 'asc' } }),
    db.zonePrice.findMany({ where: { zone: { isActive: true }, service: { isActive: true } }, include: { service: true, zone: true }, orderBy: { price: 'asc' } })
  ]);
  res.json({ user: { id: userId, name: res.locals.user.name, role: res.locals.user.role }, vehicles, addresses, services: prices.map(function (p) { return { id: p.serviceId, name: p.service.name, vehicleType: p.vehicleType, durationMin: p.service.durationMin, price: p.price, zoneId: p.zoneId, zoneName: p.zone.name }; }) });
});

app.get('/api/v1/services', authenticated(), async function (req, res) {
  const zoneId = typeof req.query.zoneId === 'string' ? req.query.zoneId : undefined;
  const vehicleType = z.nativeEnum(VehicleType).safeParse(req.query.vehicleType);
  if (!vehicleType.success) return res.status(400).json({ error: 'vehicleType must be CAR or BIKE.' });
  const items = await db.zonePrice.findMany({ where: { ...(zoneId ? { zoneId } : {}), vehicleType: vehicleType.data, zone: { isActive: true }, service: { isActive: true } }, include: { service: true, zone: true }, orderBy: { price: 'asc' } });
  res.json(items.map(function (p) { return { id: p.serviceId, name: p.service.name, vehicleType: p.vehicleType, durationMin: p.service.durationMin, price: p.price, zoneId: p.zoneId, zoneName: p.zone.name }; }));
});
app.get('/api/v1/vehicles', customer, async function (_req, res) { res.json(await db.vehicle.findMany({ where: { customerId: res.locals.user.id } })); });
const vehicleInput = z.object({ type: z.nativeEnum(VehicleType), model: z.string().trim().min(1).max(80), number: z.string().trim().min(2).max(20).transform(function (x) { return x.toUpperCase(); }) });
app.post('/api/v1/vehicles', customer, async function (req, res) { const p = vehicleInput.safeParse(req.body); if (!p.success) return res.status(400).json({ error: 'Enter valid vehicle details.' }); res.status(201).json(await db.vehicle.create({ data: { ...p.data, customerId: res.locals.user.id } })); });
app.delete('/api/v1/vehicles/:id', customer, async function (req, res) { const result = await db.vehicle.deleteMany({ where: { id: String(req.params.id), customerId: res.locals.user.id, bookings: { none: { status: { notIn: [BookingStatus.COMPLETED, BookingStatus.CANCELLED, BookingStatus.REFUNDED] } } } } }); if (!result.count) return res.status(409).json({ error: 'Vehicle not found or linked to an active booking.' }); res.status(204).end(); });

function contains(lng: number, lat: number, ring: number[][]) { let inside = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const a = ring[i], b = ring[j]; if ((a[1] > lat) !== (b[1] > lat) && lng < (b[0] - a[0]) * (lat - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside; } return inside; }
async function zoneAt(lng: number, lat: number) { const zones = await db.zone.findMany({ where: { isActive: true } }); return zones.find(function (zone) { const g = zone.polygon as any; const polygons: number[][][][] = g?.type === 'Polygon' ? [g.coordinates] : g?.type === 'MultiPolygon' ? g.coordinates : []; return polygons.some(function (rings) { return !!rings[0] && contains(lng, lat, rings[0]) && !rings.slice(1).some(function (hole) { return contains(lng, lat, hole); }); }); }); }
const addressInput = z.object({ label: z.string().trim().min(1).max(50), lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180), fullAddress: z.string().trim().min(5).max(300) });
app.get('/api/v1/addresses', customer, async function (_req, res) { res.json(await db.address.findMany({ where: { customerId: res.locals.user.id }, include: { zone: true } })); });
app.post('/api/v1/addresses', customer, async function (req, res) { const p = addressInput.safeParse(req.body); if (!p.success) return res.status(400).json({ error: 'Enter a valid address and map location.' }); const zone = await zoneAt(p.data.lng, p.data.lat); if (!zone) return res.status(422).json({ error: 'Service is unavailable at this location.' }); res.status(201).json(await db.address.create({ data: { ...p.data, customerId: res.locals.user.id, zoneId: zone.id }, include: { zone: true } })); });
app.delete('/api/v1/addresses/:id', customer, async function (req, res) { const result = await db.address.deleteMany({ where: { id: String(req.params.id), customerId: res.locals.user.id, bookings: { none: { status: { notIn: [BookingStatus.COMPLETED, BookingStatus.CANCELLED, BookingStatus.REFUNDED] } } } } }); if (!result.count) return res.status(409).json({ error: 'Address not found or linked to an active booking.' }); res.status(204).end(); });

const bookingInput = z.object({ vehicleId: z.string().min(1), addressId: z.string().min(1), serviceId: z.string().min(1), scheduledAt: z.string().datetime() });
app.get('/api/v1/bookings', customer, async function (req, res) { const status = typeof req.query.status === 'string' && Object.values(BookingStatus).includes(req.query.status as BookingStatus) ? req.query.status as BookingStatus : undefined; const rows = await db.booking.findMany({ where: { customerId: res.locals.user.id, ...(status ? { status } : {}) }, include: { service: true, vehicle: true, worker: { include: { user: true } }, zone: true, rating: true, photos: { select: { id: true, type: true, status: true } } }, orderBy: { createdAt: 'desc' } }); res.json(rows.map(function (b) { return { id: b.id, status: b.status, service: b.service.name, vehicle: b.vehicle.model + ' · ' + b.vehicle.number, scheduledAt: b.scheduledAt, price: b.price, worker: b.worker?.user.name || null, zone: b.zone.name, photos: b.photos, rating: b.rating }; })); });
app.post('/api/v1/bookings', customer, async function (req, res) {
  const p = bookingInput.safeParse(req.body); if (!p.success) return res.status(400).json({ error: 'Check booking details.' }); const userId = res.locals.user.id;
  const [vehicle, address] = await Promise.all([db.vehicle.findFirst({ where: { id: p.data.vehicleId, customerId: userId } }), db.address.findFirst({ where: { id: p.data.addressId, customerId: userId, zone: { isActive: true } } })]);
  if (!vehicle || !address?.zoneId) return res.status(400).json({ error: 'Selected vehicle or service address is invalid.' });
  if (new Date(p.data.scheduledAt).getTime() < Date.now() + 60 * 60 * 1000) return res.status(400).json({ error: 'Choose a time at least one hour from now.' });
  const price = await db.zonePrice.findFirst({ where: { serviceId: p.data.serviceId, vehicleType: vehicle.type, zoneId: address.zoneId, zone: { isActive: true }, service: { isActive: true } }, include: { zone: true } });
  if (!price) return res.status(422).json({ error: 'Service is unavailable for this vehicle and area.' });
  const commission = Math.round(price.price * price.zone.baseCommissionPct / 100);
  const booking = await db.booking.create({ data: { customerId: userId, zoneId: address.zoneId, vehicleId: vehicle.id, addressId: address.id, serviceId: price.serviceId, scheduledAt: new Date(p.data.scheduledAt), status: BookingStatus.CREATED, price: price.price, commissionAmt: commission, workerEarning: price.price - commission }, include: { service: true, zone: true } });
  res.status(201).json({ id: booking.id, status: booking.status, service: booking.service.name, scheduledAt: booking.scheduledAt, price: booking.price, zone: booking.zone.name });
});
app.post('/api/v1/bookings/:id/cancel', customer, async function (req, res) { const b = await db.booking.findFirst({ where: { id: String(req.params.id), customerId: res.locals.user.id } }); if (!b) return res.status(404).json({ error: 'Booking not found.' }); if (b.status !== BookingStatus.CREATED) return res.status(409).json({ error: 'Online cancellation is available only before payment starts. Contact support for changes after payment begins.' }); const result = await db.booking.updateMany({ where: { id: b.id, status: BookingStatus.CREATED }, data: { status: BookingStatus.CANCELLED } }); if (!result.count) return res.status(409).json({ error: 'Booking changed. Refresh and try again.' }); res.json({ id: b.id, status: BookingStatus.CANCELLED }); });
app.post('/api/v1/bookings/:id/rating', customer, async function (req, res) { const p = z.object({ stars: z.number().int().min(1).max(5), comment: z.string().trim().max(1000).optional() }).safeParse(req.body); if (!p.success) return res.status(400).json({ error: 'Choose a rating from one to five stars.' }); const booking = await db.booking.findFirst({ where: { id: String(req.params.id), customerId: res.locals.user.id }, include: { worker: true } }); if (!booking || booking.status !== BookingStatus.COMPLETED) return res.status(409).json({ error: 'Only completed bookings can be rated.' }); try { const rating = await db.rating.create({ data: { bookingId: booking.id, stars: p.data.stars, comment: p.data.comment } }); if (booking.workerId) { const ratings = await db.rating.findMany({ where: { booking: { workerId: booking.workerId } }, select: { stars: true } }); await db.worker.update({ where: { id: booking.workerId }, data: { rating: ratings.reduce(function (n, x) { return n + x.stars; }, 0) / ratings.length } }); } res.status(201).json(rating); } catch { res.status(409).json({ error: 'A rating already exists for this booking.' }); } });

app.post('/api/v1/bookings/:id/payment-order', customer, async function (req, res) {
  const b = await db.booking.findFirst({ where: { id: String(req.params.id), customerId: res.locals.user.id } });
  if (!b) return res.status(404).json({ error: 'Booking not found.' });
  if (b.status !== BookingStatus.CREATED && b.status !== BookingStatus.PAYMENT_PENDING) return res.status(409).json({ error: 'Booking is not payable.' });
  const key = process.env.RAZORPAY_KEY_ID, secret = process.env.RAZORPAY_KEY_SECRET;
  if (!key || !secret) return res.status(503).json({ error: 'Online payments are not configured.' });
  try {
    const previous = await db.payment.findUnique({ where: { bookingId: b.id } });
    if (previous?.status === PaymentStatus.PENDING && previous.gatewayRef) return res.json({ orderId: previous.gatewayRef, amount: previous.amount, currency: 'INR', keyId: key });
    const response = await fetch('https://api.razorpay.com/v1/orders', { method: 'POST', headers: { Authorization: 'Basic ' + Buffer.from(key + ':' + secret).toString('base64'), 'Content-Type': 'application/json' }, body: JSON.stringify({ amount: b.price, currency: 'INR', receipt: b.id, notes: { bookingId: b.id } }) });
    if (!response.ok) throw new Error('Payment gateway rejected the order.');
    const order = await response.json() as { id: string; amount: number; currency: string };
    await db.$transaction([
      db.payment.upsert({ where: { bookingId: b.id }, create: { bookingId: b.id, amount: b.price, method: 'razorpay', gatewayRef: order.id, status: PaymentStatus.PENDING }, update: { amount: b.price, method: 'razorpay', gatewayRef: order.id, status: PaymentStatus.PENDING } }),
      db.booking.update({ where: { id: b.id }, data: { status: BookingStatus.PAYMENT_PENDING } })
    ]);
    res.json({ orderId: order.id, amount: order.amount, currency: order.currency, keyId: key });
  } catch (error) { console.error('Payment order creation failed', error); res.status(502).json({ error: 'Could not start payment. Retry shortly.' }); }
});
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
  const zoneIds = profile.zones.map(function (x) { return x.zoneId; });
  res.json(await db.booking.findMany({ where: { status: BookingStatus.PAID, workerId: null, zoneId: { in: zoneIds } }, include: { service: true, vehicle: true, address: true, zone: true }, orderBy: { scheduledAt: 'asc' } }));
});
app.get('/api/v1/worker/profile', worker, async function (_req, res) { const profile = await db.worker.findUnique({ where: { userId: res.locals.user.id }, include: { zones: { include: { zone: true } } } }); if (!profile) return res.status(404).json({ error: 'Worker profile is not provisioned.' }); res.json(profile); });
app.get('/api/v1/worker/bookings', worker, async function (_req, res) { const profile = await db.worker.findUnique({ where: { userId: res.locals.user.id } }); if (!profile) return res.status(404).json({ error: 'Worker profile is not provisioned.' }); res.json(await db.booking.findMany({ where: { workerId: profile.id }, include: { service: true, vehicle: true, address: true, zone: true }, orderBy: { scheduledAt: 'desc' } })); });
app.get('/api/v1/worker/wallet', worker, async function (_req, res) { const profile = await db.worker.findUnique({ where: { userId: res.locals.user.id } }); if (!profile) return res.status(404).json({ error: 'Worker profile is not provisioned.' }); const ledger = await db.walletLedger.findMany({ where: { workerId: profile.id }, orderBy: { createdAt: 'desc' } }); res.json({ balance: ledger.reduce(function (sum, x) { return sum + (x.type === LedgerType.CREDIT ? x.amount : -x.amount); }, 0), ledger }); });
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
  const ids = profile.zones.map(function (x) { return x.zoneId; });
  const result = await db.booking.updateMany({ where: { id: String(req.params.id), zoneId: { in: ids }, status: BookingStatus.PAID, workerId: null }, data: { workerId: profile.id, status: BookingStatus.ASSIGNED } });
  if (!result.count) return res.status(409).json({ error: 'Job is no longer available.' });
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
        const exists = await tx.walletLedger.findFirst({ where: { workerId, bookingId: photo.bookingId, type: LedgerType.CREDIT } });
        if (!exists) {
          const ledger = await tx.walletLedger.findMany({ where: { workerId } });
          const balance = ledger.reduce(function (n, x) { return n + (x.type === LedgerType.CREDIT ? x.amount : -x.amount); }, 0);
          await tx.walletLedger.create({ data: { workerId, bookingId: photo.bookingId, type: LedgerType.CREDIT, amount: photo.booking.workerEarning, balanceAfter: balance + photo.booking.workerEarning } });
        }
        await tx.booking.update({ where: { id: photo.bookingId }, data: { status: BookingStatus.COMPLETED } });
      }, { isolationLevel: 'Serializable' });
    }
  }
  await db.auditLog.create({ data: { adminId: res.locals.user.id, action: 'REVIEW_PHOTO', entity: 'BookingPhoto', entityId: photo.id, after: { status: p.data.status } } });
  res.json({ id: photo.id, status: p.data.status });
});

app.post('/api/v1/admin/bookings/:id/assign', admin, async function (req, res) {
  const p = z.object({ workerId: z.string().min(1) }).safeParse(req.body); if (!p.success) return res.status(400).json({ error: 'Choose a worker.' });
  const booking = await db.booking.findUnique({ where: { id: String(req.params.id) } }); if (!booking) return res.status(404).json({ error: 'Booking not found.' });
  const eligible = await db.workerZone.findFirst({ where: { workerId: p.data.workerId, zoneId: booking.zoneId, worker: { isOnline: true, kycStatus: KycStatus.APPROVED, user: { isActive: true } } } });
  if (!eligible) return res.status(409).json({ error: 'Worker must be approved, online and assigned to this zone.' });
  const changed = await db.booking.updateMany({ where: { id: booking.id, workerId: null, status: BookingStatus.PAID }, data: { workerId: p.data.workerId, status: BookingStatus.ASSIGNED } });
  if (!changed.count) return res.status(409).json({ error: 'Booking is not available for assignment.' });
  await db.auditLog.create({ data: { adminId: res.locals.user.id, action: 'ASSIGN_BOOKING', entity: 'Booking', entityId: booking.id, after: { workerId: p.data.workerId } } });
  res.json({ id: booking.id, status: BookingStatus.ASSIGNED, workerId: p.data.workerId });
});
app.get('/api/v1/admin/bookings', admin, async function (req, res) {
  const state = typeof req.query.status === 'string' && Object.values(BookingStatus).includes(req.query.status as BookingStatus) ? req.query.status as BookingStatus : undefined;
  res.json(await db.booking.findMany({ where: state ? { status: state } : {}, include: { customer: { select: { id: true, email: true, name: true, phone: true } }, worker: { include: { user: { select: { id: true, email: true, name: true, phone: true } } } }, vehicle: true, service: true, zone: true }, orderBy: { createdAt: 'desc' }, take: 500 }));
});
app.get('/api/v1/admin/workers', admin, async function (_req, res) { res.json(await db.worker.findMany({ include: { user: { select: { id: true, email: true, name: true, role: true, isActive: true } }, zones: { include: { zone: true } } }, orderBy: { user: { name: 'asc' } } })); });
app.post('/api/v1/admin/workers', admin, async function (req, res) {
  const p = z.object({ email: emailBody, name: z.string().trim().min(1).max(100), type: z.nativeEnum(WorkerType) }).safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: 'Worker email, name or type is invalid.' });
  try { const user = await db.user.upsert({ where: { email: p.data.email }, update: { name: p.data.name, role: Role.WORKER, isActive: true }, create: { email: p.data.email, name: p.data.name, role: Role.WORKER } }); const profile = await db.worker.upsert({ where: { userId: user.id }, update: { type: p.data.type }, create: { userId: user.id, type: p.data.type } }); res.status(201).json({ ...profile, user: { id: user.id, email: user.email, name: user.name, role: user.role } }); }
  catch (error) { console.error(error); res.status(409).json({ error: 'Could not add worker.' }); }
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
const campaignInput = z.object({ name: z.string().trim().min(2).max(100), zoneId: z.string().min(1), startDate: z.string().datetime(), endDate: z.string().datetime(), surgePct: z.number().min(0).max(500), tempWorkersNeeded: z.number().int().min(0).max(10000) });
app.post('/api/v1/admin/campaigns', admin, async function (req, res) { const p = campaignInput.safeParse(req.body); if (!p.success || (p.success && new Date(p.data.endDate) <= new Date(p.data.startDate))) return res.status(400).json({ error: 'Campaign details and date range are invalid.' }); try { const campaign = await db.campaign.create({ data: { ...p.data, startDate: new Date(p.data.startDate), endDate: new Date(p.data.endDate) }, include: { zone: true } }); await db.auditLog.create({ data: { adminId: res.locals.user.id, action: 'CREATE', entity: 'Campaign', entityId: campaign.id, after: p.data } }); res.status(201).json(campaign); } catch { res.status(404).json({ error: 'Campaign zone not found.' }); } });
app.patch('/api/v1/admin/campaigns/:id', admin, async function (req, res) { const p = campaignInput.partial().safeParse(req.body); if (!p.success) return res.status(400).json({ error: 'Campaign update is invalid.' }); const data = { ...p.data, ...(p.data.startDate ? { startDate: new Date(p.data.startDate) } : {}), ...(p.data.endDate ? { endDate: new Date(p.data.endDate) } : {}) }; const current = await db.campaign.findUnique({ where: { id: String(req.params.id) } }); if (!current) return res.status(404).json({ error: 'Campaign not found.' }); const updated = await db.campaign.update({ where: { id: current.id }, data }); await db.auditLog.create({ data: { adminId: res.locals.user.id, action: 'UPDATE', entity: 'Campaign', entityId: current.id, before: { name: current.name, startDate: current.startDate, endDate: current.endDate }, after: p.data } }); res.json(updated); });
app.get('/api/v1/admin/reports/summary', admin, async function (req, res) { const from = typeof req.query.from === 'string' ? new Date(req.query.from) : new Date(Date.now() - 30 * 86400000); const to = typeof req.query.to === 'string' ? new Date(req.query.to) : new Date(); if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || to < from) return res.status(400).json({ error: 'Date range is invalid.' }); const rows = await db.booking.groupBy({ by: ['status'], where: { createdAt: { gte: from, lte: to } }, _count: { _all: true }, _sum: { price: true } }); res.json({ from, to, bookings: rows.reduce(function (n, x) { return n + x._count._all; }, 0), revenuePaise: rows.filter(function (x) { return x.status !== BookingStatus.CANCELLED && x.status !== BookingStatus.REFUNDED; }).reduce(function (n, x) { return n + (x._sum.price || 0); }, 0), byStatus: rows.map(function (x) { return { status: x.status, count: x._count._all, amountPaise: x._sum.price || 0 }; }) }); });

app.get('/api/v1/admin/zones', admin, async function (_req, res) { res.json(await db.zone.findMany({ include: { prices: { include: { service: true } }, workers: { include: { worker: { include: { user: { select: { id: true, email: true, name: true } } } } } } }, orderBy: { name: 'asc' } })); });
const ringSchema = z.array(z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)])).min(4);
const polygonSchema = z.union([z.object({ type: z.literal('Polygon'), coordinates: z.array(ringSchema).min(1) }), z.object({ type: z.literal('MultiPolygon'), coordinates: z.array(z.array(ringSchema).min(1)).min(1) })]);
const zoneInput = z.object({ name: z.string().trim().min(2).max(100), baseCommissionPct: z.number().min(0).max(100), polygon: polygonSchema });
app.post('/api/v1/admin/zones', admin, async function (req, res) { const p = zoneInput.safeParse(req.body); if (!p.success) return res.status(400).json({ error: 'Zone geometry, name or commission is invalid.' }); const zone = await db.zone.create({ data: p.data }); await db.auditLog.create({ data: { adminId: res.locals.user.id, action: 'CREATE', entity: 'Zone', entityId: zone.id, after: p.data } }); res.status(201).json(zone); });
app.patch('/api/v1/admin/zones/:id', admin, async function (req, res) { const p = z.object({ name: z.string().trim().min(2).max(100).optional(), baseCommissionPct: z.number().min(0).max(100).optional(), polygon: polygonSchema.optional(), isActive: z.boolean().optional() }).strict().safeParse(req.body); if (!p.success) return res.status(400).json({ error: 'Invalid zone update.' }); const before = await db.zone.findUnique({ where: { id: String(req.params.id) } }); if (!before) return res.status(404).json({ error: 'Zone not found.' }); const zone = await db.zone.update({ where: { id: before.id }, data: p.data }); await db.auditLog.create({ data: { adminId: res.locals.user.id, action: 'UPDATE', entity: 'Zone', entityId: zone.id, before: { name: before.name, isActive: before.isActive, baseCommissionPct: before.baseCommissionPct }, after: p.data } }); res.json(zone); });

app.get('/api/v1/admin/services', admin, async function (_req, res) { res.json(await db.service.findMany({ include: { prices: { include: { zone: true } } }, orderBy: { name: 'asc' } })); });
const serviceInput = z.object({ name: z.string().trim().min(2).max(100), vehicleType: z.nativeEnum(VehicleType), durationMin: z.number().int().min(5).max(600), isActive: z.boolean().default(true) });
app.post('/api/v1/admin/services', admin, async function (req, res) { const p = serviceInput.safeParse(req.body); if (!p.success) return res.status(400).json({ error: 'Invalid service.' }); res.status(201).json(await db.service.create({ data: p.data })); });
app.put('/api/v1/admin/zones/:zoneId/prices/:serviceId', admin, async function (req, res) { const p = z.object({ price: z.number().int().positive().max(100000000), vehicleType: z.nativeEnum(VehicleType), festivalMultiplier: z.number().min(0.1).max(10).default(1) }).safeParse(req.body); if (!p.success) return res.status(400).json({ error: 'Price must be a positive amount in paise.' }); const result = await db.zonePrice.upsert({ where: { zoneId_serviceId_vehicleType: { zoneId: String(req.params.zoneId), serviceId: String(req.params.serviceId), vehicleType: p.data.vehicleType } }, create: { zoneId: String(req.params.zoneId), serviceId: String(req.params.serviceId), ...p.data }, update: p.data }); await db.auditLog.create({ data: { adminId: res.locals.user.id, action: 'UPSERT_PRICE', entity: 'ZonePrice', entityId: result.id, after: p.data } }); res.json(result); });

app.get('/api/v1/admin/payouts', admin, async function (_req, res) { res.json(await db.payout.findMany({ include: { worker: { include: { user: { select: { id: true, email: true, name: true } } } } }, orderBy: { id: 'desc' } })); });
app.post('/api/v1/admin/payouts', admin, async function (req, res) {
  const p = z.object({ workerId: z.string().min(1), amount: z.number().int().positive() }).safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: 'Specify worker and amount in paise.' });
  try {
    const payout = await db.$transaction(async function (tx) {
      const profile = await tx.worker.findUnique({ where: { id: p.data.workerId } }); if (!profile) throw new Error('worker_not_found');
      const [entries, pending] = await Promise.all([tx.walletLedger.findMany({ where: { workerId: profile.id } }), tx.payout.findMany({ where: { workerId: profile.id, status: 'PENDING' } })]);
      const balance = entries.reduce(function (n, x) { return n + (x.type === LedgerType.CREDIT ? x.amount : -x.amount); }, 0) - pending.reduce(function (n, x) { return n + x.amount; }, 0);
      if (p.data.amount > balance) throw new Error('insufficient_balance');
      return tx.payout.create({ data: { workerId: profile.id, amount: p.data.amount } });
    }, { isolationLevel: 'Serializable' });
    res.status(201).json(payout);
  } catch (e) { if (e instanceof Error && e.message === 'worker_not_found') return res.status(404).json({ error: 'Worker not found.' }); if (e instanceof Error && e.message === 'insufficient_balance') return res.status(409).json({ error: 'Payout exceeds available wallet balance.' }); throw e; }
});
app.post('/api/v1/admin/payouts/:id/mark-paid', admin, async function (req, res) {
  const p = z.object({ utr: z.string().trim().min(8).max(50) }).safeParse(req.body); if (!p.success) return res.status(400).json({ error: 'Enter a valid transfer reference.' });
  try {
    const updated = await db.$transaction(async function (tx) {
      const payout = await tx.payout.findUnique({ where: { id: String(req.params.id) } }); if (!payout || payout.status !== 'PENDING') throw new Error('payout_not_pending');
      const entries = await tx.walletLedger.findMany({ where: { workerId: payout.workerId } });
      const available = entries.reduce(function (n, x) { return n + (x.type === LedgerType.CREDIT ? x.amount : -x.amount); }, 0);
      if (payout.amount > available) throw new Error('balance_changed');
      const changed = await tx.payout.updateMany({ where: { id: payout.id, status: 'PENDING' }, data: { status: 'PAID', utr: p.data.utr, paidAt: new Date() } });
      if (!changed.count) throw new Error('payout_not_pending');
      await tx.walletLedger.create({ data: { workerId: payout.workerId, type: LedgerType.PAYOUT, amount: payout.amount, balanceAfter: available - payout.amount } });
      return tx.payout.findUniqueOrThrow({ where: { id: payout.id } });
    }, { isolationLevel: 'Serializable' });
    await db.auditLog.create({ data: { adminId: res.locals.user.id, action: 'MARK_PAYOUT_PAID', entity: 'Payout', entityId: updated.id, after: { utr: p.data.utr, amount: updated.amount } } }); res.json(updated);
  } catch (e) { if (e instanceof Error && e.message === 'payout_not_pending') return res.status(409).json({ error: 'Pending payout not found.' }); if (e instanceof Error && e.message === 'balance_changed') return res.status(409).json({ error: 'Worker balance changed; refresh the payout list.' }); throw e; }
});

app.use('/api', function (_req, res) { res.status(404).json({ error: 'API route not found.' }); });
app.use(express.static(path.join(process.cwd(), 'public')));

app.use(express.static(path.join(process.cwd(), 'public')));
app.get('*path', function (_req, res) { res.sendFile(path.join(process.cwd(), 'public', 'index.html')); });
app.use(function (_req, res) { res.status(404).json({ error: 'Not found.' }); });
const server = app.listen(port, '0.0.0.0', function () { console.log('QuickWashHub website and API listening on port ' + port); });
async function shutdown() { server.close(); await db.$disconnect(); process.exit(0); }
process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);


