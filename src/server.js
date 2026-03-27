const express = require('express');
const Database = require('better-sqlite3');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 8787;
const ADMIN_KEY = process.env.ADMIN_KEY || 'cambia-esta-clave';
const DEFAULT_POOL_NAME = 'Porra: ¿cuántas veces roban a Manu en Londres?';
const DEFAULT_POOL_SLUG = 'manu-londres';

app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

const db = new Database(path.join(__dirname, '..', 'data.db'));

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

// Compatibilidad con versiones previas de "bets"
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
    FOREIGN KEY(pool_id) REFERENCES pools(id),
    FOREIGN KEY(user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS pool_results (
    pool_id INTEGER PRIMARY KEY,
    real_count INTEGER NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(pool_id) REFERENCES pools(id)
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
    .slice(0, 50) || 'porra';
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

const defaultPool = getDefaultPool();
migrateLegacyDataToDefaultPool(defaultPool.id);

// Queries
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

function parsePoolId(raw) {
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
}

function isAdmin(req) {
  return req.header('x-admin-key') === ADMIN_KEY;
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

// API
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
    defaultPoolId: defaultPool.id,
    pools,
  });
});

app.post('/api/pools', (req, res) => {
  if (!isAdmin(req)) {
    return res.status(401).json({ error: 'No autorizado' });
  }

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

app.get('/api/pools/:poolId/leaderboard', (req, res) => {
  const poolId = parsePoolId(req.params.poolId);
  if (!poolId) {
    return res.status(400).json({ error: 'poolId inválido' });
  }

  const pool = getPoolById.get(poolId);
  if (!pool) {
    return res.status(404).json({ error: 'Porra no encontrada' });
  }

  return res.json({
    pool,
    ...buildLeaderboard(poolId),
  });
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

app.post('/api/pools/:poolId/result', (req, res) => {
  const poolId = parsePoolId(req.params.poolId);
  if (!poolId) {
    return res.status(400).json({ error: 'poolId inválido' });
  }

  if (!getPoolById.get(poolId)) {
    return res.status(404).json({ error: 'Porra no encontrada' });
  }

  if (!isAdmin(req)) {
    return res.status(401).json({ error: 'No autorizado' });
  }

  const realCount = Number(req.body?.realCount);
  if (Number.isNaN(realCount)) {
    return res.status(400).json({ error: 'Dato inválido' });
  }

  upsertPoolResult.run(poolId, realCount);
  return res.json({ ok: true });
});

// Endpoints legacy apuntando a la porra por defecto
app.get('/api/leaderboard', (_req, res) => res.json(buildLeaderboard(defaultPool.id)));

app.post('/api/bet', (req, res) => {
  const name = String(req.body?.name || '').trim();
  const predictedCount = Number(req.body?.predictedCount);

  if (!name || Number.isNaN(predictedCount)) {
    return res.status(400).json({ error: 'Datos incompletos' });
  }

  createUser.run(name);
  const user = getUser.get(name);
  upsertPoolBet.run(defaultPool.id, user.id, predictedCount);

  return res.json({ ok: true });
});

app.delete('/api/bet/:name', (req, res) => {
  const name = String(req.params.name || '').trim();
  if (!name) {
    return res.status(400).json({ error: 'Nombre inválido' });
  }

  const result = deletePoolBetByUserName.run(defaultPool.id, name);
  if (!result.changes) {
    return res.status(404).json({ error: 'No se encontró apuesta para ese nombre' });
  }

  return res.json({ ok: true, deleted: name });
});

app.post('/api/result', (req, res) => {
  if (!isAdmin(req)) {
    return res.status(401).json({ error: 'No autorizado' });
  }

  const realCount = Number(req.body?.realCount);
  if (Number.isNaN(realCount)) {
    return res.status(400).json({ error: 'Dato inválido' });
  }

  upsertPoolResult.run(defaultPool.id, realCount);
  return res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`Porra activa en http://localhost:${PORT}`);
});
