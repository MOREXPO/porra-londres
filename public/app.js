const betForm = document.getElementById('betForm');
const betSubmitBtn = betForm.querySelector('button[type="submit"]');
const statusEl = document.getElementById('status');
const boardEl = document.getElementById('leaderboard');
const chartEl = document.getElementById('chart');
const podiumEl = document.getElementById('podium');
const podioHintEl = document.getElementById('podioHint');

const poolTitleEl = document.getElementById('poolTitle');
const poolSelectEl = document.getElementById('poolSelect');
const reloadPoolsBtn = document.getElementById('reloadPoolsBtn');
const poolStatusEl = document.getElementById('poolStatus');

const tabButtons = document.querySelectorAll('.tab-btn');
const tabPanels = {
  clasificacion: document.getElementById('tab-clasificacion'),
  podio: document.getElementById('tab-podio'),
};

const adminLoginBox = document.getElementById('adminLoginBox');
const adminPanel = document.getElementById('adminPanel');
const adminLoginForm = document.getElementById('adminLoginForm');
const adminEmailInput = document.getElementById('adminEmail');
const adminPasswordInput = document.getElementById('adminPassword');
const adminLoginStatusEl = document.getElementById('adminLoginStatus');
const adminWhoEl = document.getElementById('adminWho');
const adminLogoutBtn = document.getElementById('adminLogoutBtn');
const adminStatusEl = document.getElementById('adminStatus');

const createPoolForm = document.getElementById('createPoolForm');
const newPoolNameInput = document.getElementById('newPoolName');
const editPoolForm = document.getElementById('editPoolForm');
const editPoolNameInput = document.getElementById('editPoolName');
const deletePoolBtn = document.getElementById('deletePoolBtn');
const resultForm = document.getElementById('resultForm');
const realCountInput = document.getElementById('realCount');

const state = {
  pools: [],
  currentPoolId: null,
  adminToken: localStorage.getItem('adminToken') || '',
  adminEmail: localStorage.getItem('adminEmail') || '',
};

if (!adminEmailInput.value) {
  adminEmailInput.value = state.adminEmail || 'iagomoreda1910@gmail.com';
}

function setAdminSession(token, email) {
  state.adminToken = token || '';
  state.adminEmail = email || '';

  if (state.adminToken) {
    localStorage.setItem('adminToken', state.adminToken);
    localStorage.setItem('adminEmail', state.adminEmail);
  } else {
    localStorage.removeItem('adminToken');
    localStorage.removeItem('adminEmail');
  }

  const logged = Boolean(state.adminToken);
  adminLoginBox.classList.toggle('hidden', logged);
  adminPanel.classList.toggle('hidden', !logged);
  adminWhoEl.textContent = state.adminEmail || '';

  if (!logged) {
    adminStatusEl.textContent = 'Inicia sesión para crear/editar porras y publicar resultados.';
  }
}

async function api(url, options = {}) {
  const { method = 'GET', body, auth = false } = options;
  const headers = {};

  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  if (auth && state.adminToken) {
    headers.Authorization = `Bearer ${state.adminToken}`;
  }

  const res = await fetch(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const data = await res.json().catch(() => ({}));

  if (res.status === 401 && auth) {
    setAdminSession('', '');
    throw new Error(data.error || 'Sesión de administrador expirada.');
  }

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
  const id = Number(poolId);
  if (!Number.isInteger(id)) return;

  state.currentPoolId = id;
  localStorage.setItem('selectedPoolId', String(id));
  poolSelectEl.value = String(id);

  const pool = currentPool();
  if (pool) {
    poolTitleEl.textContent = pool.name;
    poolStatusEl.textContent = `Apuestas: ${pool.betCount} · Resultado: ${pool.result ?? 'pendiente'}`;
    editPoolNameInput.value = pool.name;
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

  const data = await api(`/api/pools/${state.currentPoolId}/leaderboard`);

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
                <button class="mini-btn edit-bet-btn" data-user="${e.user}" data-prediction="${e.prediction}" type="button">Editar</button>
                <button class="mini-btn delete-bet-btn" data-user="${e.user}" type="button">Eliminar</button>
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
        await api(`/api/pools/${state.currentPoolId}/bet/${encodeURIComponent(user)}`, { method: 'DELETE' });
        statusEl.textContent = `🗑️ Apuesta eliminada: ${user}`;
        await loadPools(state.currentPoolId);
      } catch (err) {
        statusEl.textContent = err.message;
      }
    });
  });

  renderChart(data.entries);
  renderPodium(data.entries, data.result);
}

async function loadPools(preferredPoolId) {
  try {
    const data = await api('/api/pools');
    state.pools = data.pools || [];

    if (!state.pools.length) {
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
    const candidate = Number(preferredPoolId) || stored || data.defaultPoolId || state.pools[0].id;
    const exists = state.pools.some((p) => p.id === candidate);
    setCurrentPool(exists ? candidate : state.pools[0].id);

    await loadBoard();
  } catch (err) {
    poolStatusEl.textContent = err.message;
  }
}

async function validateAdminSession() {
  if (!state.adminToken) {
    setAdminSession('', '');
    return;
  }

  try {
    const data = await api('/api/admin/me', { auth: true });
    setAdminSession(state.adminToken, data.admin.email);
  } catch {
    setAdminSession('', '');
  }
}

poolSelectEl.addEventListener('change', async () => {
  setCurrentPool(poolSelectEl.value);
  await loadBoard();
});

reloadPoolsBtn.addEventListener('click', async () => {
  await loadPools(state.currentPoolId);
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
    await api(`/api/pools/${state.currentPoolId}/bet`, {
      method: 'POST',
      body: { name, predictedCount },
    });

    statusEl.textContent = '✅ Apuesta guardada.';
    betForm.reset();
    betSubmitBtn.textContent = 'Guardar apuesta';
    await loadPools(state.currentPoolId);
  } catch (err) {
    statusEl.textContent = err.message || 'No se pudo guardar la apuesta.';
  }
});

adminLoginForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  const email = adminEmailInput.value.trim();
  const password = adminPasswordInput.value;

  try {
    const data = await api('/api/admin/login', {
      method: 'POST',
      body: { email, password },
    });

    setAdminSession(data.token, data.admin.email);
    adminPasswordInput.value = '';
    adminLoginStatusEl.textContent = '✅ Sesión de administrador iniciada.';
  } catch (err) {
    adminLoginStatusEl.textContent = err.message;
  }
});

adminLogoutBtn.addEventListener('click', async () => {
  try {
    await api('/api/admin/logout', { method: 'POST', auth: true });
  } catch {
    // noop
  }
  setAdminSession('', '');
});

createPoolForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  const name = newPoolNameInput.value.trim();
  if (!name) {
    adminStatusEl.textContent = 'Escribe un nombre para la porra.';
    return;
  }

  try {
    const data = await api('/api/pools', {
      method: 'POST',
      auth: true,
      body: { name },
    });

    newPoolNameInput.value = '';
    adminStatusEl.textContent = `✅ Porra creada: ${data.pool.name}`;
    await loadPools(data.pool.id);
  } catch (err) {
    adminStatusEl.textContent = err.message;
  }
});

editPoolForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  if (!state.currentPoolId) {
    adminStatusEl.textContent = 'No hay porra seleccionada.';
    return;
  }

  const name = editPoolNameInput.value.trim();
  if (!name) {
    adminStatusEl.textContent = 'El nombre no puede estar vacío.';
    return;
  }

  try {
    await api(`/api/pools/${state.currentPoolId}`, {
      method: 'PATCH',
      auth: true,
      body: { name },
    });

    adminStatusEl.textContent = '✅ Nombre de porra actualizado.';
    await loadPools(state.currentPoolId);
  } catch (err) {
    adminStatusEl.textContent = err.message;
  }
});

deletePoolBtn.addEventListener('click', async () => {
  if (!state.currentPoolId) {
    adminStatusEl.textContent = 'No hay porra seleccionada.';
    return;
  }

  const pool = currentPool();
  const confirmed = window.confirm(`¿Seguro que quieres eliminar la porra "${pool?.name || state.currentPoolId}"?`);
  if (!confirmed) return;

  try {
    await api(`/api/pools/${state.currentPoolId}`, {
      method: 'DELETE',
      auth: true,
    });

    adminStatusEl.textContent = '🗑️ Porra eliminada.';
    await loadPools();
  } catch (err) {
    adminStatusEl.textContent = err.message;
  }
});

resultForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  if (!state.currentPoolId) {
    adminStatusEl.textContent = 'No hay porra seleccionada.';
    return;
  }

  const realCount = Number(realCountInput.value);

  try {
    await api(`/api/pools/${state.currentPoolId}/result`, {
      method: 'POST',
      auth: true,
      body: { realCount },
    });

    adminStatusEl.textContent = '✅ Resultado real actualizado.';
    resultForm.reset();
    await loadPools(state.currentPoolId);
  } catch (err) {
    adminStatusEl.textContent = err.message;
  }
});

(async () => {
  setAdminSession(state.adminToken, state.adminEmail);
  await validateAdminSession();
  await loadPools();
})();
