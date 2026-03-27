const express = require('express');
const Database = require('better-sqlite3');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 8787;
const DEFAULT_POOL_NAME = 'Porra: ¿cuántas veces roban a Manu en Londres?';
const DEFAULT_POOL_SLUG = 'manu-londres';
const DEFAULT_ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'iagomoreda1910@gmail.com';
const DEFAULT_ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Jisei0no0ku';
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 días

app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

const db = new Database(path.join(__dirname, '..', 'data.db'));
db.pragma('foreign_keys = ON');

// Tablas antiguas (compatibilidad/migración)
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS bets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    predicted_count INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS result (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    real_count INTEGER NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

const betColumns = db.prepare('PRAGMA table_info(bets)').all().map((c) => c.name);
if (!betColumns.includes('euros')) {
  db.exec('ALTER TABLE bets ADD COLUMN euros REAL NOT NULL DEFAULT 1');
}
if (betColumns.includes('week_label')) {
  db.exec('UPDATE bets SET predicted_count = COALESCE(predicted_count, 0) WHERE predicted_count IS NULL');
}

const ensureUniqueIndex = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='bets_user_unique'").get();
if (!ensureUniqueIndex) {
  db.exec(`
    DELETE FROM bets
    WHERE id NOT IN (
      SELECT MAX(id)
      FROM bets
      GROUP BY user_id
    );
  `);
  db.exec('CREATE UNIQUE INDEX bets_user_unique ON bets(user_id)');
}

// Nuevo modelo multi-porras
db.exec(`
  CREATE TABLE IF NOT EXISTS pools (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    slug TEXT UNIQUE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS pool_bets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pool_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    predicted_count INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(pool_id, user_id),
    FOREIGN KEY(pool_id) REFERENCES pools(id) ON DELETE CASCADE,
    FOREIGN KEY(user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS pool_results (
    pool_id INTEGER PRIMARY KEY,
    real_count INTEGER NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(pool_id) REFERENCES pools(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS admin_users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password_salt TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS admin_sessions (
    token TEXT PRIMARY KEY,
    admin_id INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(admin_id) REFERENCES admin_users(id) ON DELETE CASCADE
  );
`);

const poolColumns = db.prepare('PRAGMA table_info(pools)').all().map((c) => c.name);
if (!poolColumns.includes('slug')) {
  db.exec('ALTER TABLE pools ADD COLUMN slug TEXT');
}

function slugify(text) {
  return String(text)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'porra';
}

function generateUniqueSlug(name) {
  const base = slugify(name);
  let candidate = base;
  let i = 2;
  while (db.prepare('SELECT 1 FROM pools WHERE slug = ?').get(candidate)) {
    candidate = `${base}-${i}`;
    i += 1;
  }
  return candidate;
}

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

function timingSafeEqualHex(a, b) {
  const aa = Buffer.from(String(a), 'hex');
  const bb = Buffer.from(String(b), 'hex');
  if (aa.length !== bb.length) return false;
  return crypto.timingSafeEqual(aa, bb);
}

const getAdminByEmail = db.prepare('SELECT * FROM admin_users WHERE email = ?');
const insertAdminUser = db.prepare('INSERT INTO admin_users(email, password_salt, password_hash) VALUES (?, ?, ?)');
const updateAdminPassword = db.prepare('UPDATE admin_users SET password_salt = ?, password_hash = ? WHERE id = ?');

function ensureDefaultAdmin() {
  const email = DEFAULT_ADMIN_EMAIL.trim().toLowerCase();
  const password = DEFAULT_ADMIN_PASSWORD;
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = hashPassword(password, salt);

  const existing = getAdminByEmail.get(email);
  if (!existing) {
    insertAdminUser.run(email, salt, hash);
    return;
  }

  // Garantiza que el usuario pedido por ti exista con esa clave actual
  updateAdminPassword.run(salt, hash, existing.id);
}

function getDefaultPool() {
  let pool = db.prepare('SELECT id, name, slug FROM pools WHERE slug = ?').get(DEFAULT_POOL_SLUG);

  if (!pool) {
    db.prepare('INSERT OR IGNORE INTO pools(name, slug) VALUES (?, ?)').run(DEFAULT_POOL_NAME, DEFAULT_POOL_SLUG);
    pool = db.prepare('SELECT id, name, slug FROM pools WHERE slug = ?').get(DEFAULT_POOL_SLUG);
  }

  if (!pool) {
    pool = db.prepare('SELECT id, name, slug FROM pools ORDER BY id ASC LIMIT 1').get();
  }

  if (pool && !pool.slug) {
    const newSlug = generateUniqueSlug(pool.name || DEFAULT_POOL_NAME);
    db.prepare('UPDATE pools SET slug = ? WHERE id = ?').run(newSlug, pool.id);
    pool.slug = newSlug;
  }

  return pool;
}

function migrateLegacyDataToDefaultPool(defaultPoolId) {
  const poolBetCount = db.prepare('SELECT COUNT(*) AS c FROM pool_bets').get().c;
  if (poolBetCount > 0) return;

  db.prepare(`
    INSERT OR IGNORE INTO pool_bets (pool_id, user_id, predicted_count, created_at)
    SELECT ?, b.user_id, COALESCE(b.predicted_count, 0), b.created_at
    FROM bets b
    JOIN (
      SELECT user_id, MAX(id) AS max_id
      FROM bets
      WHERE user_id IS NOT NULL
      GROUP BY user_id
    ) latest ON latest.max_id = b.id
  `).run(defaultPoolId);

  const oldResult = db.prepare('SELECT real_count FROM result WHERE id = 1').get();
  if (oldResult) {
    db.prepare(`
      INSERT INTO pool_results (pool_id, real_count)
      VALUES (?, ?)
      ON CONFLICT(pool_id)
      DO UPDATE SET real_count = excluded.real_count, updated_at = CURRENT_TIMESTAMP
    `).run(defaultPoolId, oldResult.real_count);
  }
}

ensureDefaultAdmin();
const defaultPool = getDefaultPool();
const defaultPoolId = defaultPool.id;
migrateLegacyDataToDefaultPool(defaultPoolId);

// Queries de negocio
const createUser = db.prepare('INSERT OR IGNORE INTO users(name) VALUES (?)');
const getUser = db.prepare('SELECT * FROM users WHERE name = ?');
const getPoolById = db.prepare('SELECT id, name, slug, created_at FROM pools WHERE id = ?');

const listPools = db.prepare(`
  SELECT
    p.id,
    p.name,
    p.slug,
    p.created_at,
    COALESCE((SELECT COUNT(*) FROM pool_bets pb WHERE pb.pool_id = p.id), 0) AS betCount,
    (SELECT real_count FROM pool_results pr WHERE pr.pool_id = p.id) AS result
  FROM pools p
  ORDER BY p.created_at ASC, p.id ASC
`);

const createPoolStmt = db.prepare('INSERT INTO pools(name, slug) VALUES (?, ?)');
const updatePoolNameStmt = db.prepare('UPDATE pools SET name = ? WHERE id = ?');

const upsertPoolBet = db.prepare(`
  INSERT INTO pool_bets (pool_id, user_id, predicted_count)
  VALUES (?, ?, ?)
  ON CONFLICT(pool_id, user_id)
  DO UPDATE SET predicted_count = excluded.predicted_count, created_at = CURRENT_TIMESTAMP
`);

const deletePoolBetByUserName = db.prepare(`
  DELETE FROM pool_bets
  WHERE pool_id = ?
    AND user_id = (SELECT id FROM users WHERE name = ?)
`);

const getPoolResult = db.prepare('SELECT real_count FROM pool_results WHERE pool_id = ?');
const upsertPoolResult = db.prepare(`
  INSERT INTO pool_results (pool_id, real_count)
  VALUES (?, ?)
  ON CONFLICT(pool_id)
  DO UPDATE SET real_count = excluded.real_count, updated_at = CURRENT_TIMESTAMP
`);

const getPoolBoard = db.prepare(`
  SELECT
    u.name,
    pb.predicted_count,
    pb.created_at,
    pr.real_count
  FROM pool_bets pb
  JOIN users u ON u.id = pb.user_id
  LEFT JOIN pool_results pr ON pr.pool_id = pb.pool_id
  WHERE pb.pool_id = ?
`);

const deletePoolCascadeTx = db.transaction((poolId) => {
  db.prepare('DELETE FROM pool_results WHERE pool_id = ?').run(poolId);
  db.prepare('DELETE FROM pool_bets WHERE pool_id = ?').run(poolId);
  db.prepare('DELETE FROM pools WHERE id = ?').run(poolId);
});

// Queries de auth admin
const cleanupExpiredSessions = db.prepare('DELETE FROM admin_sessions WHERE expires_at <= ?');
const createAdminSession = db.prepare('INSERT INTO admin_sessions(token, admin_id, expires_at) VALUES (?, ?, ?)');
const getAdminSessionByToken = db.prepare(`
  SELECT s.token, s.admin_id, s.expires_at, a.email
  FROM admin_sessions s
  JOIN admin_users a ON a.id = s.admin_id
  WHERE s.token = ? AND s.expires_at > ?
`);
const deleteAdminSessionByToken = db.prepare('DELETE FROM admin_sessions WHERE token = ?');

function parsePoolId(raw) {
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
}

function extractToken(req) {
  const authHeader = req.header('authorization') || '';
  if (authHeader.toLowerCase().startsWith('bearer ')) {
    return authHeader.slice(7).trim();
  }
  const fallback = req.header('x-admin-token');
  return fallback ? String(fallback).trim() : null;
}

function requireAdmin(req, res, next) {
  cleanupExpiredSessions.run(Date.now());

  const token = extractToken(req);
  if (!token) {
    return res.status(401).json({ error: 'No autorizado' });
  }

  const session = getAdminSessionByToken.get(token, Date.now());
  if (!session) {
    return res.status(401).json({ error: 'Sesión inválida o expirada' });
  }

  req.admin = {
    id: session.admin_id,
    email: session.email,
    token: session.token,
  };

  return next();
}

function buildLeaderboard(poolId) {
  const rows = getPoolBoard.all(poolId);
  const real = getPoolResult.get(poolId);

  const entries = rows
    .map((r) => ({
      user: r.name,
      prediction: r.predicted_count,
      createdAt: r.created_at,
      error: real ? Math.abs(r.predicted_count - real.real_count) : null,
    }))
    .sort((a, b) => {
      if (a.error === null && b.error === null) return a.createdAt.localeCompare(b.createdAt);
      if (a.error === null) return 1;
      if (b.error === null) return -1;
      return a.error - b.error || a.createdAt.localeCompare(b.createdAt);
    });

  return {
    result: real ? real.real_count : null,
    winner: entries.length && entries[0].error !== null ? entries[0].user : null,
    entries,
  };
}

// Auth admin
app.post('/api/admin/login', (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');

  if (!email || !password) {
    return res.status(400).json({ error: 'Email y contraseña requeridos' });
  }

  const admin = getAdminByEmail.get(email);
  if (!admin) {
    return res.status(401).json({ error: 'Credenciales inválidas' });
  }

  const candidateHash = hashPassword(password, admin.password_salt);
  const valid = timingSafeEqualHex(candidateHash, admin.password_hash);

  if (!valid) {
    return res.status(401).json({ error: 'Credenciales inválidas' });
  }

  cleanupExpiredSessions.run(Date.now());
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = Date.now() + SESSION_TTL_MS;
  createAdminSession.run(token, admin.id, expiresAt);

  return res.json({
    ok: true,
    token,
    expiresAt,
    admin: { email: admin.email },
  });
});

app.get('/api/admin/me', requireAdmin, (req, res) => {
  return res.json({ ok: true, admin: { email: req.admin.email } });
});

app.post('/api/admin/logout', requireAdmin, (req, res) => {
  deleteAdminSessionByToken.run(req.admin.token);
  return res.json({ ok: true });
});

// API pública
app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.get('/api/pools', (_req, res) => {
  const pools = listPools.all().map((p) => ({
    id: p.id,
    name: p.name,
    slug: p.slug,
    createdAt: p.created_at,
    betCount: p.betCount,
    result: p.result,
  }));

  res.json({
    defaultPoolId,
    pools,
  });
});

app.get('/api/pools/:poolId/leaderboard', (req, res) => {
  const poolId = parsePoolId(req.params.poolId);
  if (!poolId) {
    return res.status(400).json({ error: 'poolId inválido' });
  }

  const pool = getPoolById.get(poolId);
  if (!pool) {
    return res.status(404).json({ error: 'Porra no encontrada' });
  }

  return res.json({ pool, ...buildLeaderboard(poolId) });
});

app.post('/api/pools/:poolId/bet', (req, res) => {
  const poolId = parsePoolId(req.params.poolId);
  if (!poolId) {
    return res.status(400).json({ error: 'poolId inválido' });
  }

  if (!getPoolById.get(poolId)) {
    return res.status(404).json({ error: 'Porra no encontrada' });
  }

  const name = String(req.body?.name || '').trim();
  const predictedCount = Number(req.body?.predictedCount);

  if (!name || Number.isNaN(predictedCount)) {
    return res.status(400).json({ error: 'Datos incompletos' });
  }

  createUser.run(name);
  const user = getUser.get(name);
  upsertPoolBet.run(poolId, user.id, predictedCount);

  return res.json({ ok: true });
});

app.delete('/api/pools/:poolId/bet/:name', (req, res) => {
  const poolId = parsePoolId(req.params.poolId);
  if (!poolId) {
    return res.status(400).json({ error: 'poolId inválido' });
  }

  if (!getPoolById.get(poolId)) {
    return res.status(404).json({ error: 'Porra no encontrada' });
  }

  const name = String(req.params.name || '').trim();
  if (!name) {
    return res.status(400).json({ error: 'Nombre inválido' });
  }

  const result = deletePoolBetByUserName.run(poolId, name);
  if (!result.changes) {
    return res.status(404).json({ error: 'No se encontró apuesta para ese nombre' });
  }

  return res.json({ ok: true, deleted: name });
});

// Admin: crear/editar/eliminar porras + resultados
app.post('/api/pools', requireAdmin, (req, res) => {
  const name = String(req.body?.name || '').trim();
  if (!name) {
    return res.status(400).json({ error: 'Nombre de porra requerido' });
  }

  if (name.length > 120) {
    return res.status(400).json({ error: 'Nombre demasiado largo' });
  }

  const slug = generateUniqueSlug(name);
  const result = createPoolStmt.run(name, slug);
  const pool = getPoolById.get(result.lastInsertRowid);

  return res.json({ ok: true, pool });
});

app.patch('/api/pools/:poolId', requireAdmin, (req, res) => {
  const poolId = parsePoolId(req.params.poolId);
  if (!poolId) {
    return res.status(400).json({ error: 'poolId inválido' });
  }

  const pool = getPoolById.get(poolId);
  if (!pool) {
    return res.status(404).json({ error: 'Porra no encontrada' });
  }

  const name = String(req.body?.name || '').trim();
  if (!name) {
    return res.status(400).json({ error: 'Nombre requerido' });
  }

  if (name.length > 120) {
    return res.status(400).json({ error: 'Nombre demasiado largo' });
  }

  updatePoolNameStmt.run(name, poolId);
  return res.json({ ok: true, pool: getPoolById.get(poolId) });
});

app.delete('/api/pools/:poolId', requireAdmin, (req, res) => {
  const poolId = parsePoolId(req.params.poolId);
  if (!poolId) {
    return res.status(400).json({ error: 'poolId inválido' });
  }

  if (poolId === defaultPoolId) {
    return res.status(400).json({ error: 'No se puede borrar la porra principal' });
  }

  const pool = getPoolById.get(poolId);
  if (!pool) {
    return res.status(404).json({ error: 'Porra no encontrada' });
  }

  deletePoolCascadeTx(poolId);
  return res.json({ ok: true, deletedPoolId: poolId });
});

app.post('/api/pools/:poolId/result', requireAdmin, (req, res) => {
  const poolId = parsePoolId(req.params.poolId);
  if (!poolId) {
    return res.status(400).json({ error: 'poolId inválido' });
  }

  if (!getPoolById.get(poolId)) {
    return res.status(404).json({ error: 'Porra no encontrada' });
  }

  const realCount = Number(req.body?.realCount);
  if (Number.isNaN(realCount)) {
    return res.status(400).json({ error: 'Dato inválido' });
  }

  upsertPoolResult.run(poolId, realCount);
  return res.json({ ok: true });
});

// Legacy para no romper flujos existentes: apuntan a la porra principal
app.get('/api/leaderboard', (_req, res) => res.json(buildLeaderboard(defaultPoolId)));

app.post('/api/bet', (req, res) => {
  const name = String(req.body?.name || '').trim();
  const predictedCount = Number(req.body?.predictedCount);

  if (!name || Number.isNaN(predictedCount)) {
    return res.status(400).json({ error: 'Datos incompletos' });
  }

  createUser.run(name);
  const user = getUser.get(name);
  upsertPoolBet.run(defaultPoolId, user.id, predictedCount);

  return res.json({ ok: true });
});

app.delete('/api/bet/:name', (req, res) => {
  const name = String(req.params.name || '').trim();
  if (!name) {
    return res.status(400).json({ error: 'Nombre inválido' });
  }

  const result = deletePoolBetByUserName.run(defaultPoolId, name);
  if (!result.changes) {
    return res.status(404).json({ error: 'No se encontró apuesta para ese nombre' });
  }

  return res.json({ ok: true, deleted: name });
});

app.post('/api/result', requireAdmin, (req, res) => {
  const realCount = Number(req.body?.realCount);
  if (Number.isNaN(realCount)) {
    return res.status(400).json({ error: 'Dato inválido' });
  }

  upsertPoolResult.run(defaultPoolId, realCount);
  return res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`Porra activa en http://localhost:${PORT}`);
});
