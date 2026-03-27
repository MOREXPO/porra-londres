const betForm = document.getElementById('betForm');
const statusEl = document.getElementById('status');
const boardEl = document.getElementById('leaderboard');
const chartEl = document.getElementById('chart');
const podiumEl = document.getElementById('podium');
const podioHintEl = document.getElementById('podioHint');
const betSubmitBtn = betForm.querySelector('button[type="submit"]');

const tabButtons = document.querySelectorAll('.tab-btn');
const tabPanels = {
  clasificacion: document.getElementById('tab-clasificacion'),
  podio: document.getElementById('tab-podio'),
};

const resultForm = document.getElementById('resultForm');
const resultStatusEl = document.getElementById('resultStatus');
const adminKeyInput = document.getElementById('adminKey');

adminKeyInput.value = localStorage.getItem('porraAdminKey') || '';

tabButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    tabButtons.forEach((b) => b.classList.remove('active'));
    Object.values(tabPanels).forEach((p) => p.classList.remove('active'));

    btn.classList.add('active');
    tabPanels[btn.dataset.tab].classList.add('active');
  });
});

function renderChart(entries) {
  if (!entries.length) {
    chartEl.innerHTML = '<p class="muted">No hay datos para el gráfico.</p>';
    return;
  }

  const maxPrediction = Math.max(...entries.map((e) => e.prediction), 1);

  chartEl.innerHTML = entries
    .map((e) => {
      const pct = Math.max(6, Math.round((e.prediction / maxPrediction) * 100));
      return `
        <div class="bar-row">
          <span>${e.user}</span>
          <div class="bar-track"><div class="bar-fill" style="width:${pct}%"></div></div>
          <span>${e.prediction}</span>
        </div>
      `;
    })
    .join('');
}

function renderPodium(entries, result) {
  if (result === null) {
    podioHintEl.textContent = 'Publica primero el resultado real para calcular quién se acercó más.';
    podiumEl.innerHTML = '';
    return;
  }

  const top = entries
    .filter((e) => e.error !== null)
    .sort((a, b) => a.error - b.error || a.createdAt.localeCompare(b.createdAt))
    .slice(0, 3);

  podioHintEl.textContent = top.length ? 'Top 3 por menor error.' : 'Aún no hay apuestas válidas.';

  const medals = ['🥇', '🥈', '🥉'];
  podiumEl.innerHTML = top
    .map(
      (e, i) => `
        <div class="podium-card">
          <div class="podium-rank">${medals[i]}</div>
          <div class="podium-name">${e.user}</div>
          <div>Predicción: <b>${e.prediction}</b></div>
          <div>Error: <b>${e.error}</b></div>
        </div>
      `
    )
    .join('');
}

async function loadBoard() {
  const res = await fetch('/api/leaderboard');
  const data = await res.json();

  if (!data.entries.length) {
    boardEl.innerHTML = '<p>Aún no hay apuestas.</p>';
    chartEl.innerHTML = '<p class="muted">No hay datos para el gráfico.</p>';
    podiumEl.innerHTML = '';
    podioHintEl.textContent = 'Sin apuestas todavía.';
    betSubmitBtn.textContent = 'Guardar apuesta';
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
              <span class="entry-main">
                <span>${e.prediction} veces ${e.error === null ? '' : `(error: ${e.error})`}</span>
                <button
                  class="mini-btn edit-bet-btn"
                  data-user="${e.user}"
                  data-prediction="${e.prediction}"
                  type="button"
                >
                  Editar
                </button>
                <button
                  class="mini-btn delete-bet-btn"
                  data-user="${e.user}"
                  type="button"
                >
                  Eliminar
                </button>
              </span>
            </div>
          `
        )
        .join('')}
    </div>
  `;

  boardEl.querySelectorAll('.edit-bet-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.getElementById('name').value = btn.dataset.user;
      document.getElementById('count').value = btn.dataset.prediction;
      betSubmitBtn.textContent = 'Actualizar apuesta';
      statusEl.textContent = `✏️ Editando apuesta de ${btn.dataset.user}`;
      document.getElementById('count').focus();
    });
  });

  boardEl.querySelectorAll('.delete-bet-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const user = btn.dataset.user;
      const confirmed = window.confirm(`¿Eliminar la apuesta de ${user}?`);
      if (!confirmed) return;

      const res = await fetch(`/api/bet/${encodeURIComponent(user)}`, { method: 'DELETE' });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        statusEl.textContent = err.error || 'No se pudo eliminar la apuesta.';
        return;
      }

      if (document.getElementById('name').value.trim() === user) {
        betForm.reset();
        betSubmitBtn.textContent = 'Guardar apuesta';
      }

      statusEl.textContent = `🗑️ Apuesta eliminada: ${user}`;
      await loadBoard();
    });
  });

  renderChart(data.entries);
  renderPodium(data.entries, data.result);
}

betForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = document.getElementById('name').value.trim();
  const predictedCount = Number(document.getElementById('count').value);

  const res = await fetch('/api/bet', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, predictedCount }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    statusEl.textContent = err.error || 'No se pudo guardar la apuesta.';
    return;
  }

  statusEl.textContent = '✅ Apuesta guardada.';
  betForm.reset();
  betSubmitBtn.textContent = 'Guardar apuesta';
  await loadBoard();
});

resultForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  const realCount = Number(document.getElementById('realCount').value);
  const adminKey = adminKeyInput.value.trim();

  if (!adminKey) {
    resultStatusEl.textContent = 'Introduce la clave admin.';
    return;
  }

  localStorage.setItem('porraAdminKey', adminKey);

  const res = await fetch('/api/result', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-admin-key': adminKey,
    },
    body: JSON.stringify({ realCount }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    resultStatusEl.textContent = err.error || 'No se pudo guardar el resultado.';
    return;
  }

  resultStatusEl.textContent = '✅ Resultado real actualizado.';
  resultForm.reset();
  adminKeyInput.value = adminKey;
  await loadBoard();
});

loadBoard();
