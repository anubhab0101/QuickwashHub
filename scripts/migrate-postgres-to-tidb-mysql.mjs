import 'dotenv/config';
import pg from 'pg';
import mariadb from 'mariadb';

const { Client } = pg;
const sourceUrl = process.env.SOURCE_DATABASE_URL || process.env.DATABASE_URL;
const targetUrl = process.env.TIDB_DATABASE_URL;
const verifyOnly = process.argv.includes('--verify');
if (!sourceUrl) throw new Error('Set SOURCE_DATABASE_URL or DATABASE_URL to the PostgreSQL source.');
if (!targetUrl) throw new Error('Set TIDB_DATABASE_URL to the TiDB MySQL connection string.');

const parsedTarget = new URL(targetUrl);
if (parsedTarget.protocol !== 'mysql:' || !parsedTarget.pathname.slice(1) || /[<>]/.test(targetUrl)) {
  throw new Error('TIDB_DATABASE_URL must be a MySQL URL with a real dedicated database name.');
}
const targetConfig = {
  host: parsedTarget.hostname,
  port: Number(parsedTarget.port || 3306),
  user: decodeURIComponent(parsedTarget.username),
  password: decodeURIComponent(parsedTarget.password),
  database: decodeURIComponent(parsedTarget.pathname.slice(1)),
  ssl: { rejectUnauthorized: true },
  connectTimeout: 10000,
  connectionLimit: 1,
};
if (targetConfig.database.toLowerCase() === 'sys' || targetConfig.database.toLowerCase() === 'mysql') {
  throw new Error('Refusing to migrate into a TiDB system database. Use the dedicated quickwashhub database.');
}

const source = new Client({ connectionString: sourceUrl, connectionTimeoutMillis: 10000 });
const target = await mariadb.createConnection(targetConfig);
const quotePg = (name) => `"${String(name).replaceAll('"', '""')}"`;
const quoteMysql = (name) => `\`${String(name).replaceAll('`', '``')}\``;

async function countTables() {
  const tables = await target.query("SELECT table_name AS tableName FROM information_schema.tables WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE' ORDER BY table_name");
  const result = new Map();
  for (const { tableName } of tables) {
    const rows = await target.query(`SELECT COUNT(*) AS n FROM ${quoteMysql(tableName)}`);
    result.set(tableName, Number(rows[0].n));
  }
  return result;
}

await source.connect();
try {
  await source.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const { rows: sourceTables } = await source.query("SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations' ORDER BY tablename");
  const targetCountsBefore = await countTables();
  const sourceNames = sourceTables.map(({ tablename }) => tablename);
  const missingTables = sourceNames.filter((name) => !targetCountsBefore.has(name));
  const extraTables = [...targetCountsBefore.keys()].filter((name) => !sourceNames.includes(name) && name !== '_prisma_migrations');
  if (missingTables.length || extraTables.length) {
    throw new Error(`Source/target schema mismatch. Missing target tables: ${missingTables.join(', ') || 'none'}; target-only tables: ${extraTables.join(', ') || 'none'}.`);
  }
  const occupied = [...targetCountsBefore].filter(([name, count]) => name !== '_prisma_migrations' && count > 0);
  if (!verifyOnly && occupied.length) throw new Error(`Refusing to overwrite existing target rows: ${occupied.map(([name, count]) => `${name}=${count}`).join(', ')}.`);

  const columnMap = new Map();
  for (const { tablename } of sourceTables) {
    const { rows } = await source.query('SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 ORDER BY ordinal_position', ['public', tablename]);
    const targetColumns = await target.query('SELECT column_name AS columnName FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? ORDER BY ordinal_position', [tablename]);
    const sourceColumns = rows.map(({ column_name }) => column_name);
    const targetColumnNames = targetColumns.map(({ columnName }) => columnName);
    if (sourceColumns.length !== targetColumnNames.length || sourceColumns.some((column) => !targetColumnNames.includes(column))) {
      throw new Error(`Column mismatch for ${tablename}; no data was written.`);
    }
    columnMap.set(tablename, sourceColumns);
  }

  let totalRows = 0;
  const sourceCounts = new Map();
  if (!verifyOnly) {
    await target.query('SET FOREIGN_KEY_CHECKS = 0');
    await target.beginTransaction();
    for (const { tablename } of sourceTables) {
      const columns = columnMap.get(tablename);
      const { rows } = await source.query(`SELECT * FROM public.${quotePg(tablename)}`);
      sourceCounts.set(tablename, rows.length);
      totalRows += rows.length;
      if (!rows.length) continue;
      const sql = `INSERT INTO ${quoteMysql(tablename)} (${columns.map(quoteMysql).join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`;
      for (const row of rows) {
        const values = columns.map((column) => {
          const value = row[column];
          return value !== null && typeof value === 'object' && !(value instanceof Date) && !Buffer.isBuffer(value)
            ? JSON.stringify(value)
            : value;
        });
        await target.query(sql, values);
      }
    }
    await target.commit();
    await target.query('SET FOREIGN_KEY_CHECKS = 1');
  } else {
    for (const { tablename } of sourceTables) {
      const { rows } = await source.query(`SELECT COUNT(*) AS n FROM public.${quotePg(tablename)}`);
      const count = Number(rows[0].n);
      sourceCounts.set(tablename, count);
      totalRows += count;
    }
  }

  const targetCounts = await countTables();
  const differences = [];
  for (const [table, expected] of sourceCounts) {
    const actual = targetCounts.get(table);
    if (actual !== expected) differences.push(`${table}: source=${expected}, target=${actual ?? 'missing'}`);
  }
  if (differences.length) throw new Error(`Row-count verification failed: ${differences.join('; ')}.`);

  const relationChecks = [
    ['Booking.customerId → User.id', 'SELECT COUNT(*) AS n FROM `Booking` b LEFT JOIN `User` u ON u.`id` = b.`customerId` WHERE u.`id` IS NULL'],
    ['Booking.zoneId → Zone.id', 'SELECT COUNT(*) AS n FROM `Booking` b LEFT JOIN `Zone` z ON z.`id` = b.`zoneId` WHERE z.`id` IS NULL'],
    ['Booking.addressId → Address.id', 'SELECT COUNT(*) AS n FROM `Booking` b LEFT JOIN `Address` a ON a.`id` = b.`addressId` WHERE a.`id` IS NULL'],
    ['Payment.bookingId → Booking.id', 'SELECT COUNT(*) AS n FROM `Payment` p LEFT JOIN `Booking` b ON b.`id` = p.`bookingId` WHERE b.`id` IS NULL'],
    ['WorkerZone.workerId → Worker.id', 'SELECT COUNT(*) AS n FROM `WorkerZone` wz LEFT JOIN `Worker` w ON w.`id` = wz.`workerId` WHERE w.`id` IS NULL'],
    ['WorkerZone.zoneId → Zone.id', 'SELECT COUNT(*) AS n FROM `WorkerZone` wz LEFT JOIN `Zone` z ON z.`id` = wz.`zoneId` WHERE z.`id` IS NULL'],
  ];
  const relationErrors = [];
  for (const [name, sql] of relationChecks) {
    const [row] = await target.query(sql);
    if (Number(row.n)) relationErrors.push(`${name}: ${row.n} orphan rows`);
  }
  if (relationErrors.length) throw new Error(`Relationship verification failed: ${relationErrors.join('; ')}.`);
  console.log(JSON.stringify({ mode: verifyOnly ? 'verification' : 'migration', tables: sourceTables.length, rows: totalRows, rowCountsMatch: true, keyRelationsClean: true }));
} catch (error) {
  try { await target.rollback(); } catch {}
  try { await target.query('SET FOREIGN_KEY_CHECKS = 1'); } catch {}
  throw error;
} finally {
  await source.end();
  await target.end();
}
