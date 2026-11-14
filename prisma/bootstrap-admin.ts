import 'dotenv/config';
import { PrismaClient, Role } from '@prisma/client';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';

const email = process.env.INITIAL_ADMIN_EMAIL?.trim().toLowerCase();
if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Set INITIAL_ADMIN_EMAIL to the administrator email before bootstrapping.');
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is required.');
const databaseUrl = new URL(connectionString);
if (databaseUrl.protocol !== 'mysql:') throw new Error('DATABASE_URL must use the mysql:// protocol.');
const db = new PrismaClient({ adapter: new PrismaMariaDb({
  host: databaseUrl.hostname,
  port: Number(databaseUrl.port || 3306),
  user: decodeURIComponent(databaseUrl.username),
  password: decodeURIComponent(databaseUrl.password),
  database: decodeURIComponent(databaseUrl.pathname.slice(1)),
  ssl: { rejectUnauthorized: true },
}) });
try {
  const user = await db.user.upsert({
    where: { email },
    update: { role: Role.ADMIN, isActive: true },
    create: { email, role: Role.ADMIN, isActive: true }
  });
  console.log('Administrator account provisioned for ' + user.email + '. Register or use Google sign-in with this email to activate access.');
} finally {
  await db.$disconnect();
}
