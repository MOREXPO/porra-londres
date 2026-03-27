const betForm = document.getElementById('betForm');
const statusEl = document.getElementById('status');
const boardEl = document.getElementById('leaderboard');

async function loadBoard() {
  const res = await fetch('/api/leaderboard');
  const data = await res.json();

  if (!data.length) {
    boardEl.innerHTML = '<p>Aún no hay apuestas.</p>';
    return;
  }

  boardEl.innerHTML = data
    .map(
      (w) => `
      <div class="week">
        <h3>${w.week}</h3>
        <p>Resultado real: <b>${w.result ?? 'pendiente'}</b> ${w.winner ? `· Ganador: <b>${w.winner}</b>` : ''}</p>
        ${w.entries
          .map(
            (e) => `
              <div class="entry">
                <span>${e.user}</span>
                <span>${e.prediction} ${e.error === null ? '' : `(error: ${e.error})`}</span>
              </div>
            `
          )
          .join('')}
      </div>
    `
    )
    .join('');
}

betForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = document.getElementById('name').value.trim();
  const weekLabel = document.getElementById('week').value.trim();
  const predictedCount = Number(document.getElementById('count').value);

  const res = await fetch('/api/bet', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, weekLabel, predictedCount }),
  });

  if (!res.ok) {
    statusEl.textContent = 'No se pudo guardar la apuesta.';
    return;
  }

  statusEl.textContent = '✅ Apuesta guardada.';
  betForm.reset();
  await loadBoard();
});

loadBoard();
