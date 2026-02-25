const toastEl = document.getElementById("toast");
let stockTimelineChart;
let expiredTimelineChart;
let temperatureRefreshTimer = null;
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
    throw new Error(data.error || "Erro na requisicao");
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

const loadDashboard = async () => {
  const data = await request("/api/dashboard");
  const kpis = [
    ["Produtos cadastrados", data.totalProducts, "Catalogo"],
    ["Estoque baixo", data.lowStock, "Atencao"],
    ["Movimentacoes", data.totalMovements, "Fluxo"],
    ["Alertas de temperatura", data.tempAlerts, "Seguranca"]
  ];

  const kpisEl = document.getElementById("kpis");
  kpisEl.innerHTML = kpis
    .map(
      ([label, value, chip]) =>
        `<article class="kpi"><small>${label}</small><strong>${value}</strong><span class="chip">${chip}</span></article>`
    )
    .join("");
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
        <td>${p.currentStock} ${p.unit}</td>
        <td>${p.minStock} ${p.unit}</td>
        <td>${p.expirationDate || "-"}</td>
      </tr>`
    )
    .join("");

  const optionsHtml = products
    .map((p) => `<option value="${p.id}">${p.name} (${p.currentStock} ${p.unit})</option>`)
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
    showToast("Biblioteca de graficos nao carregada.");
    return;
  }
  const data = await request("/api/analytics/products?days=60");
  const labels = data.labels.map((value) => {
    const [year, month, day] = value.split("-");
    return `${day}/${month}`;
  });

  const stockCtx = document.getElementById("stock-timeline-chart");
  const expiredCtx = document.getElementById("expired-timeline-chart");
  if (!stockCtx || !expiredCtx) return;

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
};

const loadMovements = async () => {
  const movements = await request("/api/movements");
  const body = document.querySelector("#movements-table tbody");
  body.innerHTML = movements
    .map(
      (m) => `<tr>
        <td>${new Date(m.createdAt).toLocaleString("pt-BR")}</td>
        <td>${m.productName}</td>
        <td>${m.type === "IN" ? "Entrada" : "Saida"}</td>
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
  const payload = {
    productId: Number(form.get("productId")),
    type: form.get("type"),
    quantity: Number(form.get("quantity")),
    notes: form.get("notes")
  };

  try {
    await request("/api/movements", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    movementForm.reset();
    showToast("Movimentacao registrada.");
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
