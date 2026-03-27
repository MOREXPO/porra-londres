const express = require('express');
const Database = require('better-sqlite3');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 8787;

app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

const db = new Database(path.join(__dirname, '..', 'data.db'));

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

// Compatibilidad con versiones previas de la base de datos
const betColumns = db.prepare('PRAGMA table_info(bets)').all().map((c) => c.name);
if (!betColumns.includes('euros')) {
  db.exec('ALTER TABLE bets ADD COLUMN euros REAL NOT NULL DEFAULT 1');
}
if (betColumns.includes('week_label')) {
  db.exec('UPDATE bets SET predicted_count = COALESCE(predicted_count, 0) WHERE predicted_count IS NULL');
}

const createUser = db.prepare('INSERT OR IGNORE INTO users(name) VALUES (?)');
const getUser = db.prepare('SELECT * FROM users WHERE name = ?');

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

const upsertBet = db.prepare(`
  INSERT INTO bets (user_id, predicted_count)
  VALUES (?, ?)
  ON CONFLICT(user_id)
  DO UPDATE SET predicted_count = excluded.predicted_count, created_at = CURRENT_TIMESTAMP
`);

const deleteBetByUserName = db.prepare(`
  DELETE FROM bets
  WHERE user_id = (SELECT id FROM users WHERE name = ?)
`);

const getResult = db.prepare('SELECT real_count FROM result WHERE id = 1');
const upsertResult = db.prepare(`
  INSERT INTO result (id, real_count)
  VALUES (1, ?)
  ON CONFLICT(id)
  DO UPDATE SET real_count = excluded.real_count, updated_at = CURRENT_TIMESTAMP
`);

const getBoard = db.prepare(`
  SELECT
    u.name,
    b.predicted_count,
    b.created_at,
    r.real_count
  FROM bets b
  JOIN users u ON u.id = b.user_id
  LEFT JOIN result r ON r.id = 1
`);

app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.get('/api/leaderboard', (_req, res) => {
  const rows = getBoard.all();
  const real = getResult.get();

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

  res.json({
    result: real ? real.real_count : null,
    winner: entries.length && entries[0].error !== null ? entries[0].user : null,
    entries,
  });
});

app.post('/api/bet', (req, res) => {
  const { name, predictedCount } = req.body;

  if (!name || Number.isNaN(Number(predictedCount))) {
    return res.status(400).json({ error: 'Datos incompletos' });
  }

  createUser.run(name.trim());
  const user = getUser.get(name.trim());
  upsertBet.run(user.id, Number(predictedCount));

  return res.json({ ok: true });
});

app.delete('/api/bet/:name', (req, res) => {
  const name = (req.params.name || '').trim();

  if (!name) {
    return res.status(400).json({ error: 'Nombre inválido' });
  }

  const result = deleteBetByUserName.run(name);
  if (!result.changes) {
    return res.status(404).json({ error: 'No se encontró apuesta para ese nombre' });
  }

  return res.json({ ok: true, deleted: name });
});

app.post('/api/result', (req, res) => {
  const { realCount } = req.body;
  const adminKey = req.header('x-admin-key');

  if (adminKey !== (process.env.ADMIN_KEY || 'cambia-esta-clave')) {
    return res.status(401).json({ error: 'No autorizado' });
  }

  if (Number.isNaN(Number(realCount))) {
    return res.status(400).json({ error: 'Dato inválido' });
  }

  upsertResult.run(Number(realCount));
  return res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`Porra activa en http://localhost:${PORT}`);
});
