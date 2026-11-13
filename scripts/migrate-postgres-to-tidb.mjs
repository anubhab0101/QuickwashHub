import 'dotenv/config';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, readdirSync, statSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import pg from 'pg';

const { Client } = pg;
const source = process.env.SOURCE_DATABASE_URL || process.env.DATABASE_URL;
const target = process.env.TIDB_DATABASE_URL;
const migrate = process.argv.includes('--migrate');
if (!source) throw new Error('Set SOURCE_DATABASE_URL or DATABASE_URL in the environment. Do not pass database credentials as command-line arguments.');
if (migrate && !target) throw new Error('Set TIDB_DATABASE_URL in the environment before importing. Do not pass database credentials as command-line arguments.');
if (target && (target.includes('<') || target.includes('>') || target === source)) throw new Error('TIDB_DATABASE_URL must name a real, separate target database.');
function cliConnection(connectionString) {
  const url = new URL(connectionString);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('Both database URLs must use PostgreSQL protocol.');
  const inherited = Object.fromEntries(Object.entries(process.env).filter(([key]) => ['PATH', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP'].includes(key)));
  const env = { ...inherited, PGPASSWORD: decodeURIComponent(url.password), PGSSLMODE: url.searchParams.get('sslmode') || 'prefer' };
  const rootCert = url.searchParams.get('sslrootcert'); if (rootCert) env.PGSSLROOTCERT = rootCert;
  return { args: ['--host', url.hostname, '--port', url.port || '5432', '--username', decodeURIComponent(url.username), '--dbname', decodeURIComponent(url.pathname.replace(/^\//, ''))], env };
}
function postgresTool(name) {
  const executable = process.platform === 'win32' ? `${name}.exe` : name;
  const folders = (process.env.PATH || '').split(path.delimiter);
  const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
  const installRoot = path.join(programFiles, 'PostgreSQL');
  if (process.platform === 'win32' && existsSync(installRoot)) {
    const versions = readdirSync(installRoot, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    folders.unshift(...versions.map(version => path.join(installRoot, version, 'bin')));
  }
  return folders.map(folder => path.join(folder, executable)).find(candidate => existsSync(candidate)) || executable;
}

const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupDir = path.resolve('backups');
await mkdir(backupDir, { recursive: true });
const backupPath = path.join(backupDir, `quickwashhub-${timestamp}.sql`);
const sourceCli = cliConnection(source);
const dump = spawnSync(postgresTool('pg_dump'), [...sourceCli.args, '--format=plain', '--no-owner', '--no-acl', '--quote-all-identifiers', '--file', backupPath], { stdio: 'inherit', shell: false, env: sourceCli.env });
if (dump.error) throw new Error('pg_dump is required on PATH. Install PostgreSQL client tools first.');
if (dump.status !== 0) throw new Error('Source backup failed; target was not modified.');
if (statSync(backupPath).size === 0) throw new Error('Source backup is empty; target was not modified.');
const digest = await new Promise((resolve, reject) => {
  const hash = createHash('sha256');
  createReadStream(backupPath).on('data', chunk => hash.update(chunk)).on('error', reject).on('end', () => resolve(hash.digest('hex')));
});
console.log(`Verified source dump: ${backupPath}`);
console.log(`SHA-256: ${digest}`);
if (!migrate) { console.log('Backup-only run complete. Add --migrate only after reviewing the dump and confirming the target database is empty.'); process.exit(0); }

const targetClient = new Client({ connectionString: target, connectionTimeoutMillis: 8000 });
await targetClient.connect();
const existingTables = await targetClient.query("SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname = 'public'");
await targetClient.end();
if (existingTables.rows.length) throw new Error('Target public schema is not empty. No data was imported. Use a new empty TiDB database.');

const targetCli = cliConnection(target);
const restore = spawnSync(postgresTool('psql'), [...targetCli.args, '--set=ON_ERROR_STOP=1', '--single-transaction', '--file', backupPath], { stdio: 'inherit', shell: false, env: targetCli.env });
if (restore.error) throw new Error('psql is required on PATH. Target may be empty; inspect it before retrying.');
if (restore.status !== 0) throw new Error('TiDB import failed. Application DATABASE_URL was not changed. Inspect target and restore only after the compatibility failure is understood.');

async function publicTableCounts(connectionString) {
  const client = new Client({ connectionString, connectionTimeoutMillis: 8000 });
  await client.connect();
  try {
    const tables = await client.query("SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname = 'public' ORDER BY tablename");
    const result = new Map();
    for (const { tablename } of tables.rows) {
      const identifier = `"${String(tablename).replaceAll('"', '""')}"`;
      const count = await client.query(`SELECT count(*)::bigint AS n FROM public.${identifier}`);
      result.set(tablename, Number(count.rows[0].n));
    }
    return result;
  } finally { await client.end(); }
}
async function checkRelations(connectionString, tableCounts) {
  const checks = [
    ['Booking.customerId → User.id', ['Booking', 'User'], 'SELECT count(*) AS n FROM public."Booking" b LEFT JOIN public."User" u ON u."id" = b."customerId" WHERE u."id" IS NULL'],
    ['Booking.zoneId → Zone.id', ['Booking', 'Zone'], 'SELECT count(*) AS n FROM public."Booking" b LEFT JOIN public."Zone" z ON z."id" = b."zoneId" WHERE z."id" IS NULL'],
    ['Booking.addressId → Address.id', ['Booking', 'Address'], 'SELECT count(*) AS n FROM public."Booking" b LEFT JOIN public."Address" a ON a."id" = b."addressId" WHERE a."id" IS NULL'],
    ['Payment.bookingId → Booking.id', ['Payment', 'Booking'], 'SELECT count(*) AS n FROM public."Payment" p LEFT JOIN public."Booking" b ON b."id" = p."bookingId" WHERE b."id" IS NULL'],
    ['WorkerZone.workerId → Worker.id', ['WorkerZone', 'Worker'], 'SELECT count(*) AS n FROM public."WorkerZone" wz LEFT JOIN public."Worker" w ON w."id" = wz."workerId" WHERE w."id" IS NULL'],
    ['WorkerZone.zoneId → Zone.id', ['WorkerZone', 'Zone'], 'SELECT count(*) AS n FROM public."WorkerZone" wz LEFT JOIN public."Zone" z ON z."id" = wz."zoneId" WHERE z."id" IS NULL']
  ];
  const client = new Client({ connectionString, connectionTimeoutMillis: 8000 });
  await client.connect();
  try {
    const problems = [];
    for (const [name, tables, sql] of checks) {
      if (!tables.every(table => tableCounts.has(table))) continue;
      const result = await client.query(sql);
      const count = Number(result.rows[0].n);
      if (count) problems.push(`${name}: ${count} orphan rows`);
    }
    return problems;
  } finally { await client.end(); }
}

const [sourceCounts, targetCounts] = await Promise.all([publicTableCounts(source), publicTableCounts(target)]);
const differences = [];
for (const [table, count] of sourceCounts) if (targetCounts.get(table) !== count) differences.push(`${table}: source=${count}, target=${targetCounts.get(table) ?? 'missing'}`);
for (const table of targetCounts.keys()) if (!sourceCounts.has(table)) differences.push(`${table}: target-only table`);
if (differences.length) throw new Error('Row-count verification failed: ' + differences.join('; ') + '. Do not switch the application to TiDB.');
const [sourceRelations, targetRelations] = await Promise.all([checkRelations(source, sourceCounts), checkRelations(target, targetCounts)]);
if (sourceRelations.length || targetRelations.length) throw new Error('Relationship verification failed. Source: ' + (sourceRelations.join('; ') || 'clean') + '. Target: ' + (targetRelations.join('; ') || 'clean') + '. Do not switch the application to TiDB.');
console.log(`Import verified: ${sourceCounts.size} public tables have matching row counts.`);
console.log('Key booking, address, zone, payment and worker-zone relationships verified.');
console.log('After reviewing relationship checks and application compatibility, set the deployment DATABASE_URL to the TiDB URL. Keep the source available for rollback.');
