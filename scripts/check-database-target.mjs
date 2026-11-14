const raw = process.env.DATABASE_URL;
if (!raw) throw new Error('DATABASE_URL is required before database migrations can run.');

let url;
try { url = new URL(raw); }
catch { throw new Error('DATABASE_URL is not a valid URL.'); }

if (url.protocol !== 'mysql:') throw new Error('DATABASE_URL must use mysql:// for the TiDB MySQL application.');

const database = decodeURIComponent(url.pathname.replace(/^\//, '')).split('/')[0].toLowerCase();
const systemDatabases = new Set(['', 'sys', 'mysql', 'information_schema', 'performance_schema']);
if (systemDatabases.has(database)) {
  throw new Error('Refusing to migrate a system or empty database. Set DATABASE_URL to a dedicated application database such as /quickwashhub.');
}
