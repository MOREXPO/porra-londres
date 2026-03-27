const betForm = document.getElementById('betForm');
const statusEl = document.getElementById('status');
const boardEl = document.getElementById('leaderboard');

async function loadBoard() {
  const res = await fetch('/api/leaderboard');
  const data = await res.json();

  if (!data.entries.length) {
    boardEl.innerHTML = '<p>Aún no hay apuestas.</p>';
    return;
  }

  boardEl.innerHTML = `
    <div class="week">
      <h3>Resultado real: <b>${data.result ?? 'pendiente'}</b></h3>
      <p>${data.winner ? `🏆 Ganador provisional/final: <b>${data.winner}</b>` : 'Aún sin resultado publicado.'}</p>
      ${data.entries
        .map(
          (e) => `
            <div class="entry">
              <span>${e.user}</span>
              <span>${e.prediction} veces · €${Number(e.euros).toFixed(2)} ${e.error === null ? '' : `(error: ${e.error})`}</span>
            </div>
          `
        )
        .join('')}
    </div>
  `;
}

betForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = document.getElementById('name').value.trim();
  const predictedCount = Number(document.getElementById('count').value);
  const euros = Number(document.getElementById('euros').value);

  const res = await fetch('/api/bet', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, predictedCount, euros }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    statusEl.textContent = err.error || 'No se pudo guardar la apuesta.';
    return;
  }

  statusEl.textContent = '✅ Apuesta guardada.';
  betForm.reset();
  await loadBoard();
});

loadBoard();
