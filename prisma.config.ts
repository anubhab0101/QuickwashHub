import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

const databaseUrl = new URL(env('DATABASE_URL'));
if (databaseUrl.hostname.endsWith('.tidbcloud.com')) {
  databaseUrl.searchParams.set('sslaccept', 'strict');
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations_mysql' },
  datasource: { url: databaseUrl.toString() }
});
