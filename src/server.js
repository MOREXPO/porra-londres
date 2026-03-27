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
    week_label TEXT NOT NULL,
    predicted_count INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, week_label),
    FOREIGN KEY(user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS results (
    week_label TEXT PRIMARY KEY,
    real_count INTEGER NOT NULL,
    published_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

const createUser = db.prepare('INSERT OR IGNORE INTO users(name) VALUES (?)');
const getUser = db.prepare('SELECT * FROM users WHERE name = ?');
const upsertBet = db.prepare(`
  INSERT INTO bets (user_id, week_label, predicted_count)
  VALUES (?, ?, ?)
  ON CONFLICT(user_id, week_label)
  DO UPDATE SET predicted_count = excluded.predicted_count, created_at = CURRENT_TIMESTAMP
`);
const getLeaderboard = db.prepare(`
  SELECT
    u.name,
    b.week_label,
    b.predicted_count,
    r.real_count,
    ABS(b.predicted_count - r.real_count) as error
  FROM bets b
  JOIN users u ON u.id = b.user_id
  LEFT JOIN results r ON r.week_label = b.week_label
  ORDER BY b.week_label DESC, error ASC, b.created_at ASC
`);

const upsertResult = db.prepare(`
  INSERT INTO results (week_label, real_count)
  VALUES (?, ?)
  ON CONFLICT(week_label)
  DO UPDATE SET real_count = excluded.real_count, published_at = CURRENT_TIMESTAMP
`);

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

app.get('/api/leaderboard', (_req, res) => {
  const rows = getLeaderboard.all();

  const byWeek = rows.reduce((acc, row) => {
    if (!acc[row.week_label]) acc[row.week_label] = [];
    acc[row.week_label].push(row);
    return acc;
  }, {});

  const response = Object.entries(byWeek).map(([week, entries]) => {
    const scored = entries
      .filter((e) => e.real_count !== null)
      .sort((a, b) => a.error - b.error || a.predicted_count - b.predicted_count);

    const winner = scored.length ? scored[0].name : null;

    return {
      week,
      result: entries[0].real_count,
      winner,
      entries: entries.map((e) => ({
        user: e.name,
        prediction: e.predicted_count,
        error: e.real_count === null ? null : Math.abs(e.predicted_count - e.real_count),
      })),
    };
  });

  res.json(response);
});

app.post('/api/bet', (req, res) => {
  const { name, weekLabel, predictedCount } = req.body;
  if (!name || !weekLabel || Number.isNaN(Number(predictedCount))) {
    return res.status(400).json({ error: 'Datos incompletos' });
  }

  createUser.run(name.trim());
  const user = getUser.get(name.trim());

  upsertBet.run(user.id, weekLabel.trim(), Number(predictedCount));
  return res.json({ ok: true });
});

app.post('/api/result', (req, res) => {
  const { weekLabel, realCount } = req.body;
  const adminKey = req.header('x-admin-key');

  if (adminKey !== (process.env.ADMIN_KEY || 'cambia-esta-clave')) {
    return res.status(401).json({ error: 'No autorizado' });
  }

  if (!weekLabel || Number.isNaN(Number(realCount))) {
    return res.status(400).json({ error: 'Datos incompletos' });
  }

  upsertResult.run(weekLabel.trim(), Number(realCount));
  return res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`Porra activa en http://localhost:${PORT}`);
});
