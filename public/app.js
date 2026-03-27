const betForm = document.getElementById('betForm');
const statusEl = document.getElementById('status');
const boardEl = document.getElementById('leaderboard');
const chartEl = document.getElementById('chart');
const podiumEl = document.getElementById('podium');
const podioHintEl = document.getElementById('podioHint');
const betSubmitBtn = betForm.querySelector('button[type="submit"]');

const poolTitleEl = document.getElementById('poolTitle');
const poolSelectEl = document.getElementById('poolSelect');
const poolStatusEl = document.getElementById('poolStatus');
const reloadPoolsBtn = document.getElementById('reloadPoolsBtn');
const createPoolForm = document.getElementById('createPoolForm');
const createPoolAdminKeyInput = document.getElementById('createPoolAdminKey');

const tabButtons = document.querySelectorAll('.tab-btn');
const tabPanels = {
  clasificacion: document.getElementById('tab-clasificacion'),
  podio: document.getElementById('tab-podio'),
};

const resultForm = document.getElementById('resultForm');
const resultStatusEl = document.getElementById('resultStatus');
const adminKeyInput = document.getElementById('adminKey');

const state = {
  pools: [],
  currentPoolId: null,
};

function saveAdminKey(key) {
  localStorage.setItem('porraAdminKey', key);
  adminKeyInput.value = key;
  createPoolAdminKeyInput.value = key;
}

const storedAdminKey = localStorage.getItem('porraAdminKey') || '';
saveAdminKey(storedAdminKey);

tabButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    tabButtons.forEach((b) => b.classList.remove('active'));
    Object.values(tabPanels).forEach((p) => p.classList.remove('active'));

    btn.classList.add('active');
    tabPanels[btn.dataset.tab].classList.add('active');
  });
});

async function fetchJson(url, options = {}) {
  const res = await fetch(url, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Error ${res.status}`);
  }
  return data;
}

function currentPool() {
  return state.pools.find((p) => p.id === state.currentPoolId) || null;
}

function renderPoolOptions() {
  poolSelectEl.innerHTML = state.pools
    .map((p) => `<option value="${p.id}">${p.name}</option>`)
    .join('');
}

function setCurrentPool(poolId) {
  const parsed = Number(poolId);
  if (!Number.isInteger(parsed)) return;

  state.currentPoolId = parsed;
  localStorage.setItem('selectedPoolId', String(parsed));
  poolSelectEl.value = String(parsed);

  const pool = currentPool();
  if (pool) {
    poolTitleEl.textContent = pool.name;
    poolStatusEl.textContent = `Apuestas: ${pool.betCount} · Resultado: ${pool.result ?? 'pendiente'}`;
  }
}

async function loadPools(preferredPoolId) {
  try {
    const data = await fetchJson('/api/pools');
    state.pools = data.pools || [];

    if (!state.pools.length) {
      poolSelectEl.innerHTML = '';
      state.currentPoolId = null;
      poolTitleEl.textContent = 'Sin porras';
      poolStatusEl.textContent = 'No hay porras creadas todavía.';
      boardEl.innerHTML = '<p>No hay porras disponibles.</p>';
      chartEl.innerHTML = '<p class="muted">No hay datos para el gráfico.</p>';
      podiumEl.innerHTML = '';
      podioHintEl.textContent = 'Crea una porra para empezar.';
      return;
    }

    renderPoolOptions();

    const stored = Number(localStorage.getItem('selectedPoolId'));
    const candidate = Number(preferredPoolId) || state.currentPoolId || stored || data.defaultPoolId || state.pools[0].id;

    const exists = state.pools.some((p) => p.id === candidate);
    setCurrentPool(exists ? candidate : state.pools[0].id);

    await loadBoard();
  } catch (err) {
    poolStatusEl.textContent = err.message;
  }
}

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
          <div>${e.error === 0 ? '✅ Acierto total' : `Error: <b>${e.error}</b>`}</div>
        </div>
      `
    )
    .join('');
}

async function loadBoard() {
  if (!state.currentPoolId) return;

  const data = await fetchJson(`/api/pools/${state.currentPoolId}/leaderboard`);
  if (data.pool?.name) {
    poolTitleEl.textContent = data.pool.name;
  }

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
                <span>${e.prediction} veces</span>
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
      const confirmed = window.confirm(`¿Eliminar la apuesta de ${user} en esta porra?`);
      if (!confirmed) return;

      try {
        await fetchJson(`/api/pools/${state.currentPoolId}/bet/${encodeURIComponent(user)}`, { method: 'DELETE' });

        if (document.getElementById('name').value.trim() === user) {
          betForm.reset();
          betSubmitBtn.textContent = 'Guardar apuesta';
        }

        statusEl.textContent = `🗑️ Apuesta eliminada: ${user}`;
        await loadPools(state.currentPoolId);
      } catch (err) {
        statusEl.textContent = err.message || 'No se pudo eliminar la apuesta.';
      }
    });
  });

  renderChart(data.entries);
  renderPodium(data.entries, data.result);
}

poolSelectEl.addEventListener('change', async () => {
  setCurrentPool(poolSelectEl.value);
  await loadBoard();
});

reloadPoolsBtn.addEventListener('click', async () => {
  await loadPools(state.currentPoolId);
});

createPoolForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  const name = String(document.getElementById('newPoolName').value || '').trim();
  const adminKey = String(createPoolAdminKeyInput.value || '').trim();

  if (!name) {
    poolStatusEl.textContent = 'Escribe un nombre para la porra.';
    return;
  }

  if (!adminKey) {
    poolStatusEl.textContent = 'Introduce la clave admin para crear porras.';
    return;
  }

  try {
    const data = await fetchJson('/api/pools', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-key': adminKey,
      },
      body: JSON.stringify({ name }),
    });

    saveAdminKey(adminKey);
    createPoolForm.reset();
    createPoolAdminKeyInput.value = adminKey;
    poolStatusEl.textContent = `✅ Porra creada: ${data.pool.name}`;

    await loadPools(data.pool.id);
  } catch (err) {
    poolStatusEl.textContent = err.message;
  }
});

betForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  if (!state.currentPoolId) {
    statusEl.textContent = 'No hay porra seleccionada.';
    return;
  }

  const name = document.getElementById('name').value.trim();
  const predictedCount = Number(document.getElementById('count').value);

  try {
    await fetchJson(`/api/pools/${state.currentPoolId}/bet`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, predictedCount }),
    });

    statusEl.textContent = '✅ Apuesta guardada.';
    betForm.reset();
    betSubmitBtn.textContent = 'Guardar apuesta';
    await loadPools(state.currentPoolId);
  } catch (err) {
    statusEl.textContent = err.message || 'No se pudo guardar la apuesta.';
  }
});

resultForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  if (!state.currentPoolId) {
    resultStatusEl.textContent = 'No hay porra seleccionada.';
    return;
  }

  const realCount = Number(document.getElementById('realCount').value);
  const adminKey = adminKeyInput.value.trim();

  if (!adminKey) {
    resultStatusEl.textContent = 'Introduce la clave admin.';
    return;
  }

  try {
    await fetchJson(`/api/pools/${state.currentPoolId}/result`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-key': adminKey,
      },
      body: JSON.stringify({ realCount }),
    });

    saveAdminKey(adminKey);
    resultStatusEl.textContent = '✅ Resultado real actualizado.';
    resultForm.reset();
    adminKeyInput.value = adminKey;
    await loadPools(state.currentPoolId);
  } catch (err) {
    resultStatusEl.textContent = err.message || 'No se pudo guardar el resultado.';
  }
});

loadPools();
