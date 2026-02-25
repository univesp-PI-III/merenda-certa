const toastEl = document.getElementById("toast");
let stockTimelineChart;
let expiredTimelineChart;
let discardMonthlyChart;
let temperatureRefreshTimer = null;
const expiredStockByProduct = new Map();
const TEMPERATURE_REFRESH_MS = 10000;

const showToast = (message, timeout = 2200) => {
  toastEl.textContent = message;
  toastEl.classList.remove("hidden");
  setTimeout(() => toastEl.classList.add("hidden"), timeout);
};

const request = async (url, options = {}) => {
  const response = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...options
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || "Erro na requisição");
  }
  return data;
};

const tabs = document.querySelectorAll(".tabs button");
const sections = document.querySelectorAll(".tab");
const quickLinks = document.querySelectorAll("[data-go-tab]");

const activateTab = (tabId) => {
  tabs.forEach((b) => b.classList.remove("active"));
  sections.forEach((s) => s.classList.remove("active"));

  const targetButton = document.querySelector(`.tabs button[data-tab="${tabId}"]`);
  const targetSection = document.getElementById(tabId);
  if (!targetButton || !targetSection) return;

  targetButton.classList.add("active");
  targetSection.classList.add("active");

  if (tabId === "products") {
    loadProductCharts().catch((error) => showToast(error.message));
    setTimeout(() => {
      if (stockTimelineChart) stockTimelineChart.resize();
      if (expiredTimelineChart) expiredTimelineChart.resize();
      if (discardMonthlyChart) discardMonthlyChart.resize();
    }, 40);
  }

  if (tabId === "temperature") {
    loadTemperatureModule().catch((error) => showToast(error.message));
  }
};

tabs.forEach((button) => {
  button.addEventListener("click", () => {
    activateTab(button.dataset.tab);
  });
});

quickLinks.forEach((link) => {
  link.addEventListener("click", (event) => {
    event.preventDefault();
    activateTab(link.dataset.goTab);
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
});

document.addEventListener("click", (event) => {
  const action = event.target.closest("[data-action-tab]");
  if (!action) return;
  event.preventDefault();
  activateTab(action.dataset.actionTab);
  window.scrollTo({ top: 0, behavior: "smooth" });
});

const loadDashboard = async () => {
  const [data, products, entries, meters, readings] = await Promise.all([
    request("/api/dashboard"),
    request("/api/products"),
    request("/api/product-entries"),
    request("/api/temperature-meters"),
    request("/api/temperature-readings")
  ]);
  const discardTrendLabel =
    data.discardTrendDirection6m === "down"
      ? "Queda"
      : data.discardTrendDirection6m === "up"
        ? "Alta"
        : "Estável";
  const discardTrendChipClass =
    data.discardTrendDirection6m === "down"
      ? "chip-trend-down"
      : data.discardTrendDirection6m === "up"
        ? "chip-trend-up"
        : "chip-trend-stable";
  const discardTrendValue = `${data.discardTrendPercent6m > 0 ? "+" : ""}${Number(data.discardTrendPercent6m || 0).toFixed(1)}%`;
  const tempAlertsValue = Number(data.tempAlerts || 0);
  const tempAlertsChipClass =
    tempAlertsValue <= 10 ? "chip-alert-safe" : tempAlertsValue <= 20 ? "chip-alert-warn" : "chip-alert-danger";
  const tempAlertsChipLabel =
    tempAlertsValue <= 10 ? "Baixo (3d)" : tempAlertsValue <= 20 ? "Atenção (3d)" : "Crítico (3d)";
  const kpis = [
    { label: "Produtos cadastrados", value: data.totalProducts, chip: "Catálogo" },
    { label: "Estoque baixo", value: data.lowStock, chip: "Atenção" },
    { label: "Movimentações", value: data.totalMovements, chip: "Fluxo" },
    {
      label: "Alertas de temperatura (3d)",
      value: tempAlertsValue,
      chip: tempAlertsChipLabel,
      chipClass: tempAlertsChipClass
    },
    { label: "A vencer até 14d", value: data.expiringIn14Days, chip: "Preventivo" },
    { label: "A vencer até 7d", value: data.expiringIn7Days, chip: "Atenção" },
    { label: "A vencer até 3d", value: data.expiringIn3Days, chip: "Prioridade" },
    {
      label: "Tendência descarte 6m",
      value: discardTrendValue,
      chip: discardTrendLabel,
      chipClass: discardTrendChipClass
    }
  ];

  const kpisEl = document.getElementById("kpis");
  kpisEl.innerHTML = kpis
    .map(
      ({ label, value, chip, chipClass = "" }) =>
        `<article class="kpi"><small>${label}</small><strong>${value}</strong><span class="chip ${chipClass}">${chip}</span></article>`
    )
    .join("");

  const decisionsEl = document.getElementById("decision-panels");
  if (!decisionsEl) return;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const expiringByProduct = new Map();
  entries
    .filter((entry) => Number(entry.quantityAvailable) > 0)
    .forEach((entry) => {
      const expiry = new Date(`${entry.expirationDate}T00:00:00`);
      const days = Math.ceil((expiry.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
      if (days < 0 || days > 14) return;

      const key = entry.productId;
      const prev = expiringByProduct.get(key) || {
        productName: entry.productName,
        unit: entry.unit,
        qty: 0,
        nearestDays: days
      };
      prev.qty += Number(entry.quantityAvailable);
      prev.nearestDays = Math.min(prev.nearestDays, days);
      expiringByProduct.set(key, prev);
    });

  const expiringList = Array.from(expiringByProduct.values())
    .sort((a, b) => a.nearestDays - b.nearestDays || b.qty - a.qty)
    .slice(0, 6);

  const lowStockList = products
    .map((p) => ({
      name: p.name,
      unit: p.unit,
      currentStock: Number(p.currentStock),
      minStock: Number(p.minStock),
      deficit: Number(p.minStock) - Number(p.currentStock)
    }))
    .filter((p) => p.deficit >= 0)
    .sort((a, b) => b.deficit - a.deficit)
    .slice(0, 6);

  const recentAlertsByMeter = new Map();
  readings.slice(0, 120).forEach((reading) => {
    const list = recentAlertsByMeter.get(reading.meterId) || [];
    if (list.length < 10) list.push(reading.status);
    recentAlertsByMeter.set(reading.meterId, list);
  });

  const thermalIssues = meters
    .filter((m) => m.lastStatus === "ALERT")
    .map((m) => {
      const recent = recentAlertsByMeter.get(m.id) || [];
      const alertCount = recent.filter((status) => status === "ALERT").length;
      return {
        name: m.name,
        meterCode: m.meterCode,
        lastTemperature: m.lastTemperatureC,
        alertCount
      };
    })
    .sort((a, b) => b.alertCount - a.alertCount)
    .slice(0, 6);

  const renderList = (items, mapFn, emptyText) => {
    if (items.length === 0) return `<p class="decision-empty">${emptyText}</p>`;
    return `<ul>${items.map(mapFn).join("")}</ul>`;
  };

  decisionsEl.innerHTML = `
    <article class="decision-card">
      <h3>Uso prioritário (vencimento)</h3>
      ${renderList(
        expiringList,
        (item) =>
          `<li>${item.productName}: ${item.qty.toFixed(2)} ${item.unit}<span class="decision-chip ${item.nearestDays <= 3 ? "decision-chip-critical" : "decision-chip-warning"}">${item.nearestDays === 0 ? "vence hoje" : `até ${item.nearestDays}d`}</span><button class="decision-action" data-action-tab="products">Ir para Produtos</button></li>`,
        "Sem produtos próximos do vencimento nos próximos 14 dias."
      )}
    </article>

    <article class="decision-card">
      <h3>Reposição necessária</h3>
      ${renderList(
        lowStockList,
        (item) =>
          `<li>${item.name}: saldo ${item.currentStock.toFixed(2)} ${item.unit} / mínimo ${item.minStock.toFixed(2)} ${item.unit}<span class="decision-chip ${item.deficit > 0 ? "decision-chip-critical" : "decision-chip-warning"}">${item.deficit > 0 ? `repor ${item.deficit.toFixed(2)} ${item.unit}` : "no limite"}</span><button class="decision-action" data-action-tab="products">Registrar entrada</button></li>`,
        "Nenhum produto abaixo ou no limite de estoque mínimo."
      )}
    </article>

    <article class="decision-card">
      <h3>Investigação térmica (medidor)</h3>
      ${renderList(
        thermalIssues,
        (item) =>
          `<li>${item.name} (${item.meterCode}): ${Number(item.lastTemperature).toFixed(1)} C<span class="decision-chip decision-chip-critical">${item.alertCount}/10 alertas</span><button class="decision-action" data-action-tab="temperature">Ir para Temperatura</button></li>`,
        "Sem medidores em alerta no momento."
      )}
    </article>
  `;
};

const loadProducts = async () => {
  const products = await request("/api/products");
  const body = document.querySelector("#products-table tbody");
  const select = document.getElementById("movement-product");
  const entrySelect = document.getElementById("entry-product");

  body.innerHTML = products
    .map(
      (p) => `<tr>
        <td>${p.name}</td>
        <td>${Number(p.currentStock).toFixed(2)} ${p.unit}</td>
        <td>${Number(p.minStock).toFixed(2)} ${p.unit}</td>
        <td>${p.expirationDate || "-"}</td>
      </tr>`
    )
    .join("");

  const optionsHtml = products
    .map((p) => `<option value="${p.id}">${p.name} (${Number(p.currentStock).toFixed(2)} ${p.unit})</option>`)
    .join("");

  select.innerHTML = optionsHtml;
  if (entrySelect) entrySelect.innerHTML = optionsHtml;
};

const loadProductEntries = async () => {
  const entries = await request("/api/product-entries");
  const body = document.querySelector("#entries-table tbody");

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const getEntryStatus = (expirationDate) => {
    const expiry = new Date(`${expirationDate}T00:00:00`);
    const diffMs = expiry.getTime() - startOfToday.getTime();
    const daysToExpire = Math.ceil(diffMs / (24 * 60 * 60 * 1000));

    if (daysToExpire < 0) {
      return { rowClass: "entry-row-expired", badgeClass: "entry-status-expired", label: "Vencido" };
    }
    if (daysToExpire <= 7) {
      const label = daysToExpire === 0 ? "Vence hoje" : `Vence em ${daysToExpire}d`;
      return { rowClass: "entry-row-warning", badgeClass: "entry-status-warning", label };
    }
    return { rowClass: "", badgeClass: "entry-status-ok", label: "OK" };
  };

  expiredStockByProduct.clear();
  entries
    .filter((entry) => Number(entry.quantityAvailable) > 0)
    .forEach((entry) => {
      const expiry = new Date(`${entry.expirationDate}T00:00:00`);
      if (expiry.getTime() >= startOfToday.getTime()) return;
      const productId = Number(entry.productId);
      const current = Number(expiredStockByProduct.get(productId) || 0);
      expiredStockByProduct.set(productId, current + Number(entry.quantityAvailable));
    });

  body.innerHTML = entries
    .map((e) => {
      const status = getEntryStatus(e.expirationDate);
      return `<tr class="${status.rowClass}">
        <td>${new Date(e.receivedAt).toLocaleString("pt-BR")}</td>
        <td>${e.productName}</td>
        <td>${Number(e.quantityTotal).toFixed(2)} ${e.unit}</td>
        <td>${Number(e.quantityAvailable).toFixed(2)} ${e.unit}</td>
        <td>${e.expirationDate}</td>
        <td><span class="entry-status ${status.badgeClass}">${status.label}</span></td>
      </tr>`;
    })
    .join("");
};

const renderLineChart = (ctx, currentChart, config) => {
  if (!window.Chart) return currentChart;
  if (currentChart) currentChart.destroy();
  return new window.Chart(ctx, config);
};

const buildTimelineOptions = () => ({
  responsive: true,
  maintainAspectRatio: false,
  scales: {
    x: {
      grid: { display: false },
      ticks: {
        autoSkip: true,
        maxTicksLimit: 8
      }
    },
    y: {
      beginAtZero: true,
      ticks: { precision: 0 }
    }
  },
  plugins: { legend: { display: false } }
});

const loadProductCharts = async () => {
  if (!window.Chart) {
    showToast("Biblioteca de gráficos não carregada.");
    return;
  }
  const [data, discardData] = await Promise.all([
    request("/api/analytics/products?days=60"),
    request("/api/analytics/discards?months=6")
  ]);
  const labels = data.labels.map((value) => {
    const [year, month, day] = value.split("-");
    return `${day}/${month}`;
  });

  const stockCtx = document.getElementById("stock-timeline-chart");
  const expiredCtx = document.getElementById("expired-timeline-chart");
  const discardCtx = document.getElementById("discard-monthly-chart");
  if (!stockCtx || !expiredCtx || !discardCtx) return;

  stockTimelineChart = renderLineChart(stockCtx, stockTimelineChart, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "Estoque total",
          data: data.stockTimeline,
          borderColor: "#1f6d5c",
          backgroundColor: "rgba(31, 109, 92, 0.15)",
          tension: 0.25,
          fill: true,
          pointRadius: 0
        }
      ]
    },
    options: buildTimelineOptions()
  });

  expiredTimelineChart = renderLineChart(expiredCtx, expiredTimelineChart, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "Produtos vencidos",
          data: data.expiredTimeline,
          borderColor: "#cb3f2f",
          backgroundColor: "rgba(203, 63, 47, 0.14)",
          tension: 0.25,
          fill: true,
          pointRadius: 0
        }
      ]
    },
    options: buildTimelineOptions()
  });

  const discardLabels = discardData.labels.map((value) => {
    const [year, month] = value.split("-");
    return `${month}/${year}`;
  });
  discardMonthlyChart = renderLineChart(discardCtx, discardMonthlyChart, {
    type: "bar",
    data: {
      labels: discardLabels,
      datasets: [
        {
          label: "Descarte mensal",
          data: discardData.monthlyTotals,
          borderColor: "#c7631f",
          backgroundColor: "rgba(234, 139, 47, 0.58)",
          borderWidth: 1.5,
          borderRadius: 8
        }
      ]
    },
    options: {
      ...buildTimelineOptions(),
      scales: {
        ...buildTimelineOptions().scales,
        y: {
          beginAtZero: true,
          ticks: { precision: 0 }
        }
      }
    }
  });

  const sentimentLabel =
    discardData.sentiment === "OK"
      ? "OK"
      : discardData.sentiment === "RUIM"
        ? "Ruim"
        : "Sem mudança";
  const sentimentClass =
    discardData.sentiment === "OK"
      ? "sentiment-ok"
      : discardData.sentiment === "RUIM"
        ? "sentiment-bad"
        : "sentiment-stable";
  const trendSummary = document.getElementById("discard-trend-summary");
  if (trendSummary) {
    trendSummary.innerHTML = `
      <span class="sentiment-chip ${sentimentClass}">${sentimentLabel}</span>
      <small>Total 6 meses: <strong>${Number(discardData.totalDiscard).toFixed(2)}</strong></small>
    `;
  }
};

const loadMovements = async () => {
  const movements = await request("/api/movements");
  const body = document.querySelector("#movements-table tbody");
  const movementTypeLabel = (type) => {
    if (type === "IN") return "Entrada";
    if (type === "DISCARD") return "Descarte";
    return "Saída";
  };
  body.innerHTML = movements
    .map(
      (m) => `<tr>
        <td>${new Date(m.createdAt).toLocaleString("pt-BR")}</td>
        <td>${m.productName}</td>
        <td>${movementTypeLabel(m.type)}</td>
        <td>${m.quantity}</td>
      </tr>`
    )
    .join("");
};

const getLiveMeterState = (meter) => {
  if (meter.lastTemperatureC === null || meter.lastTemperatureC === undefined) return "red";

  const current = Number(meter.lastTemperatureC);
  const min = Number(meter.minTemp);
  const max = Number(meter.maxTemp);

  if (current < min || current > max) return "red";

  const range = max - min;
  const band = range * 0.2;
  const lowerGreenLimit = min + band;
  const upperGreenLimit = max - band;

  if (current > lowerGreenLimit && current < upperGreenLimit) return "green";
  return "yellow";
};

const renderTemperatureAlertDashboard = (dashboard) => {
  const kpisEl = document.getElementById("temperature-kpis");
  const metersListEl = document.getElementById("temperature-alert-foods-list");
  if (!kpisEl || !metersListEl) return;

  kpisEl.innerHTML = [
    ["Leituras analisadas", dashboard.totalReadings, "Temperatura"],
    ["Alertas", dashboard.totalAlerts, "Risco"],
    ["Medidores com alerta", dashboard.metersWithAlerts, "Foco"],
    ["Taxa de alerta", `${dashboard.alertRate.toFixed(1)}%`, "Indicador"]
  ]
    .map(
      ([label, value, chip]) =>
        `<article class="kpi"><small>${label}</small><strong>${value}</strong><span class="chip">${chip}</span></article>`
    )
    .join("");

  metersListEl.innerHTML =
    dashboard.topMeters.length > 0
      ? dashboard.topMeters.map((meter) => `<li>${meter.meterName} (${meter.meterCode}): ${meter.alerts} alerta(s)</li>`).join("")
      : "<li>Nenhum alerta de temperatura registrado.</li>";
};

const renderTemperatureLiveMeters = (meters) => {
  const liveMetersEl = document.getElementById("temperature-live-meters");
  if (!liveMetersEl) return;

  liveMetersEl.innerHTML =
    meters.length > 0
      ? meters
          .map((meter) => {
            const state = getLiveMeterState(meter);
            const tempText =
              meter.lastTemperatureC === null || meter.lastTemperatureC === undefined
                ? "Sem leitura"
                : `${Number(meter.lastTemperatureC).toFixed(1)} C`;

            return `<article class="temp-live-card temp-live-${state}">
              <strong>${tempText}</strong>
              <small>${meter.name}</small>
            </article>`;
          })
          .join("")
      : "<small>Nenhum medidor cadastrado.</small>";
};

const loadTemperatureModule = async () => {
  const [meters, readings, dashboard] = await Promise.all([
    request("/api/temperature-meters"),
    request("/api/temperature-readings"),
    request("/api/temperature-dashboard")
  ]);
  const metersBody = document.querySelector("#meters-table tbody");
  const readingsBody = document.querySelector("#temperature-readings-table tbody");

  renderTemperatureAlertDashboard(dashboard);
  renderTemperatureLiveMeters(meters);

  metersBody.innerHTML = meters
    .map(
      (m) => `<tr>
        <td>${m.name}</td>
        <td>${m.meterCode}</td>
        <td>${Number(m.minTemp).toFixed(1)} a ${Number(m.maxTemp).toFixed(1)} C</td>
        <td>${m.lastRecordedAt ? `${new Date(m.lastRecordedAt).toLocaleString("pt-BR")} (${Number(m.lastTemperatureC).toFixed(1)} C)` : "-"}</td>
        <td class="${m.lastStatus === "SAFE" ? "status-safe" : m.lastStatus === "ALERT" ? "status-alert" : ""}">${m.lastStatus === "SAFE" ? "SEGURO" : m.lastStatus === "ALERT" ? "ALERTA" : "-"}</td>
      </tr>`
    )
    .join("");

  readingsBody.innerHTML = readings
    .slice(0, 10)
    .map(
      (r) => `<tr>
        <td>${new Date(r.recordedAt).toLocaleString("pt-BR")}</td>
        <td>${r.meterName} (${r.meterCode})</td>
        <td>${r.temperatureC.toFixed(1)} C</td>
        <td class="${r.status === "SAFE" ? "status-safe" : "status-alert"}">${r.status === "SAFE" ? "SEGURO" : "ALERTA"}</td>
        <td>${r.source}</td>
      </tr>`
    )
    .join("");
};

const startTemperatureAutoRefresh = () => {
  if (temperatureRefreshTimer) return;
  temperatureRefreshTimer = setInterval(() => {
    const temperatureTab = document.getElementById("temperature");
    if (!temperatureTab || !temperatureTab.classList.contains("active")) return;
    loadTemperatureModule().catch((error) => showToast(error.message));
  }, TEMPERATURE_REFRESH_MS);
};

const productForm = document.getElementById("product-form");
productForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(productForm);
  const payload = {
    name: form.get("name"),
    unit: form.get("unit"),
    minStock: Number(form.get("minStock")) || 0
  };

  try {
    await request("/api/products", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    productForm.reset();
    showToast("Produto salvo.");
    await Promise.all([loadProducts(), loadDashboard(), loadProductCharts(), loadProductEntries()]);
  } catch (error) {
    showToast(error.message);
  }
});

const entryForm = document.getElementById("entry-form");
entryForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(entryForm);
  const receivedAtValue = form.get("receivedAt");
  const payload = {
    productId: Number(form.get("productId")),
    quantity: Number(form.get("quantity")),
    expirationDate: form.get("expirationDate"),
    receivedAt: receivedAtValue ? new Date(receivedAtValue).toISOString() : null
  };

  try {
    await request("/api/product-entries", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    entryForm.reset();
    showToast("Entrada de lote registrada.");
    await Promise.all([loadProducts(), loadProductEntries(), loadDashboard(), loadProductCharts()]);
  } catch (error) {
    showToast(error.message);
  }
});

const movementForm = document.getElementById("movement-form");
movementForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(movementForm);
  const productId = Number(form.get("productId"));
  const movementType = String(form.get("type") || "").toUpperCase();
  const movementQty = Number(form.get("quantity"));

  if (movementType === "DISCARD") {
    const expiredStock = Number(expiredStockByProduct.get(productId) || 0);
    if (!(expiredStock > 0)) {
      showToast("Descarte permitido apenas para produtos com lote vencido.");
      return;
    }
    if (!(movementQty > 0) || movementQty > expiredStock) {
      showToast(`Quantidade de descarte excede o saldo vencido (${expiredStock.toFixed(2)}).`);
      return;
    }
  }

  const payload = {
    productId,
    type: movementType,
    quantity: movementQty,
    notes: form.get("notes")
  };

  try {
    await request("/api/movements", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    movementForm.reset();
    showToast("Movimentação registrada.");
    await Promise.all([loadProducts(), loadMovements(), loadProductEntries(), loadDashboard(), loadProductCharts()]);
  } catch (error) {
    showToast(error.message);
  }
});

const meterForm = document.getElementById("meter-form");
meterForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(meterForm);
  const payload = {
    name: form.get("name"),
    meterCode: String(form.get("meterCode") || "").trim().toLowerCase(),
    minTemp: Number(form.get("minTemp")),
    maxTemp: Number(form.get("maxTemp"))
  };

  try {
    await request("/api/temperature-meters", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    meterForm.reset();
    showToast("Medidor cadastrado.");
    await Promise.all([loadTemperatureModule(), loadDashboard()]);
  } catch (error) {
    showToast(error.message);
  }
});

const boot = async () => {
  try {
    await Promise.all([loadDashboard(), loadProducts(), loadMovements(), loadProductEntries(), loadTemperatureModule()]);
    startTemperatureAutoRefresh();
  } catch (error) {
    showToast(error.message);
  }
};

boot();
