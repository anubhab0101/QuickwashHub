import 'dotenv/config';
import { PrismaClient, Role } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const email = process.env.INITIAL_ADMIN_EMAIL?.trim().toLowerCase();
if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Set INITIAL_ADMIN_EMAIL to the administrator email before bootstrapping.');
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is required.');
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
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
