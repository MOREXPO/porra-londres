const betForm = document.getElementById('betForm');
const betSubmitBtn = betForm.querySelector('button[type="submit"]');
const statusEl = document.getElementById('status');
const boardEl = document.getElementById('leaderboard');
const chartEl = document.getElementById('chart');
const podiumEl = document.getElementById('podium');
const podioHintEl = document.getElementById('podioHint');
const selectedPoolTitleEl = document.getElementById('selectedPoolTitle');
const selectedPoolMetaEl = document.getElementById('selectedPoolMeta');
const poolsListEl = document.getElementById('poolsList');
const poolStatusEl = document.getElementById('poolStatus');

const menuButtons = document.querySelectorAll('.menu-btn');
const views = {
  porras: document.getElementById('view-porras'),
  admin: document.getElementById('view-admin'),
};

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
const adminPoolSelectEl = document.getElementById('adminPoolSelect');
const adminRefreshBtn = document.getElementById('adminRefreshBtn');
const editPoolForm = document.getElementById('editPoolForm');
const editPoolNameInput = document.getElementById('editPoolName');
const deletePoolBtn = document.getElementById('deletePoolBtn');
const resultForm = document.getElementById('resultForm');
const realCountInput = document.getElementById('realCount');

const state = {
  pools: [],
  currentPoolId: null,
  adminPoolId: null,
  adminToken: localStorage.getItem('adminToken') || '',
  adminEmail: localStorage.getItem('adminEmail') || '',
  activeView: localStorage.getItem('activeView') || 'porras',
};

if (!adminEmailInput.value) {
  adminEmailInput.value = state.adminEmail || 'iagomoreda1910@gmail.com';
}

function setActiveView(viewName) {
  const view = views[viewName] ? viewName : 'porras';
  state.activeView = view;
  localStorage.setItem('activeView', view);

  menuButtons.forEach((btn) => btn.classList.toggle('active', btn.dataset.view === view));
  Object.entries(views).forEach(([name, el]) => {
    el.classList.toggle('active', name === view);
  });
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
    adminStatusEl.textContent = 'Inicia sesión para crear, editar, borrar porras y publicar resultados.';
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

function currentAdminPool() {
  return state.pools.find((p) => p.id === state.adminPoolId) || null;
}

function selectPool(poolId) {
  const id = Number(poolId);
  if (!Number.isInteger(id)) return;

  state.currentPoolId = id;
  localStorage.setItem('selectedPoolId', String(id));

  if (!state.adminPoolId || !state.pools.some((p) => p.id === state.adminPoolId)) {
    state.adminPoolId = id;
  }

  renderPoolsList();
  syncAdminPoolSelect();
}

function renderPoolsList() {
  if (!state.pools.length) {
    poolsListEl.innerHTML = '<p class="muted">No hay porras disponibles.</p>';
    return;
  }

  poolsListEl.innerHTML = state.pools
    .map((pool) => {
      const activeClass = pool.id === state.currentPoolId ? 'pool-pill active' : 'pool-pill';
      return `
        <button class="${activeClass}" type="button" data-pool-id="${pool.id}">
          <span class="pool-pill-title">${pool.name}</span>
          <span class="pool-pill-meta">Apuestas: ${pool.betCount} · Resultado: ${pool.result ?? 'pendiente'}</span>
        </button>
      `;
    })
    .join('');

  poolsListEl.querySelectorAll('[data-pool-id]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      selectPool(btn.dataset.poolId);
      await loadBoard();
    });
  });
}

function syncAdminPoolSelect() {
  adminPoolSelectEl.innerHTML = state.pools
    .map((pool) => `<option value="${pool.id}">${pool.name}</option>`)
    .join('');

  if (!state.adminPoolId && state.currentPoolId) {
    state.adminPoolId = state.currentPoolId;
  }

  if (state.adminPoolId) {
    adminPoolSelectEl.value = String(state.adminPoolId);
    const pool = currentAdminPool();
    if (pool) {
      editPoolNameInput.value = pool.name;
    }
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
    podioHintEl.textContent = 'Aún no hay resultado real publicado para esta porra.';
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
  if (!state.currentPoolId) {
    selectedPoolTitleEl.textContent = 'Sin porra seleccionada';
    selectedPoolMetaEl.textContent = 'Selecciona una porra para ver sus apuestas.';
    boardEl.innerHTML = '<p>No hay porra activa.</p>';
    chartEl.innerHTML = '<p class="muted">No hay datos para el gráfico.</p>';
    podiumEl.innerHTML = '';
    podioHintEl.textContent = '';
    return;
  }

  const data = await api(`/api/pools/${state.currentPoolId}/leaderboard`);
  const pool = data.pool;

  selectedPoolTitleEl.textContent = pool?.name || 'Porra';
  selectedPoolMetaEl.textContent = `Resultado real: ${data.result ?? 'pendiente'} · Apuestas: ${data.entries.length}`;

  if (!data.entries.length) {
    boardEl.innerHTML = '<p>Aún no hay apuestas en esta porra.</p>';
    chartEl.innerHTML = '<p class="muted">No hay datos para el gráfico.</p>';
    podiumEl.innerHTML = '';
    podioHintEl.textContent = 'Sin apuestas todavía.';
    betSubmitBtn.textContent = 'Guardar apuesta';
    return;
  }

  boardEl.innerHTML = `
    <div class="week">
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
      state.currentPoolId = null;
      state.adminPoolId = null;
      poolStatusEl.textContent = 'No hay porras creadas todavía.';
      renderPoolsList();
      syncAdminPoolSelect();
      await loadBoard();
      return;
    }

    const stored = Number(localStorage.getItem('selectedPoolId'));
    const candidate = Number(preferredPoolId) || state.currentPoolId || stored || data.defaultPoolId || state.pools[0].id;
    const exists = state.pools.some((p) => p.id === candidate);

    selectPool(exists ? candidate : state.pools[0].id);

    if (!state.adminPoolId || !state.pools.some((p) => p.id === state.adminPoolId)) {
      state.adminPoolId = state.currentPoolId;
    }

    poolStatusEl.textContent = `Total porras: ${state.pools.length}`;

    renderPoolsList();
    syncAdminPoolSelect();
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

menuButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    setActiveView(btn.dataset.view);
  });
});

tabButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    tabButtons.forEach((b) => b.classList.remove('active'));
    Object.values(tabPanels).forEach((p) => p.classList.remove('active'));

    btn.classList.add('active');
    tabPanels[btn.dataset.tab].classList.add('active');
  });
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

  try {
    const data = await api('/api/admin/login', {
      method: 'POST',
      body: {
        email: adminEmailInput.value.trim(),
        password: adminPasswordInput.value,
      },
    });

    setAdminSession(data.token, data.admin.email);
    adminPasswordInput.value = '';
    adminLoginStatusEl.textContent = '✅ Login correcto.';
  } catch (err) {
    adminLoginStatusEl.textContent = err.message;
  }
});

adminLogoutBtn.addEventListener('click', async () => {
  try {
    await api('/api/admin/logout', { method: 'POST', auth: true });
  } catch {
    // ignore
  }
  setAdminSession('', '');
});

adminPoolSelectEl.addEventListener('change', () => {
  state.adminPoolId = Number(adminPoolSelectEl.value);
  const pool = currentAdminPool();
  if (pool) {
    editPoolNameInput.value = pool.name;
  }
});

adminRefreshBtn.addEventListener('click', async () => {
  await loadPools(state.currentPoolId);
});

createPoolForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  try {
    const data = await api('/api/pools', {
      method: 'POST',
      auth: true,
      body: { name: newPoolNameInput.value.trim() },
    });

    newPoolNameInput.value = '';
    adminStatusEl.textContent = `✅ Porra creada: ${data.pool.name}`;
    state.adminPoolId = data.pool.id;
    await loadPools(data.pool.id);
  } catch (err) {
    adminStatusEl.textContent = err.message;
  }
});

editPoolForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  if (!state.adminPoolId) {
    adminStatusEl.textContent = 'Selecciona una porra a administrar.';
    return;
  }

  try {
    await api(`/api/pools/${state.adminPoolId}`, {
      method: 'PATCH',
      auth: true,
      body: { name: editPoolNameInput.value.trim() },
    });

    adminStatusEl.textContent = '✅ Nombre actualizado.';
    await loadPools(state.adminPoolId);
  } catch (err) {
    adminStatusEl.textContent = err.message;
  }
});

deletePoolBtn.addEventListener('click', async () => {
  if (!state.adminPoolId) {
    adminStatusEl.textContent = 'Selecciona una porra a borrar.';
    return;
  }

  const pool = currentAdminPool();
  const confirmed = window.confirm(`¿Eliminar la porra "${pool?.name || state.adminPoolId}"?`);
  if (!confirmed) return;

  try {
    await api(`/api/pools/${state.adminPoolId}`, { method: 'DELETE', auth: true });
    adminStatusEl.textContent = '🗑️ Porra eliminada.';
    await loadPools();
  } catch (err) {
    adminStatusEl.textContent = err.message;
  }
});

resultForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  if (!state.adminPoolId) {
    adminStatusEl.textContent = 'Selecciona una porra para publicar resultado.';
    return;
  }

  try {
    await api(`/api/pools/${state.adminPoolId}/result`, {
      method: 'POST',
      auth: true,
      body: { realCount: Number(realCountInput.value) },
    });

    adminStatusEl.textContent = '✅ Resultado real publicado.';
    resultForm.reset();
    await loadPools(state.adminPoolId);
  } catch (err) {
    adminStatusEl.textContent = err.message;
  }
});

(async () => {
  setActiveView(state.activeView);
  setAdminSession(state.adminToken, state.adminEmail);
  await validateAdminSession();
  await loadPools();
})();
