const path = require("path");
const express = require("express");
const db = require("./db");
const { startTemperatureMqtt, toReadingStatus } = require("./temperature-mqtt");

const app = express();
const PORT = process.env.PORT || 3000;
const MQTT_PORT = Number(process.env.MQTT_PORT) || 1883;

app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "public")));
app.use("/vendor/chart", express.static(path.join(__dirname, "..", "node_modules", "chart.js", "dist")));

const DAY_MS = 24 * 60 * 60 * 1000;

const formatDate = (date) => date.toISOString().slice(0, 10);

const buildDateRange = (days) => {
  const result = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const start = new Date(today.getTime() - (days - 1) * DAY_MS);

  for (let i = 0; i < days; i += 1) {
    result.push(formatDate(new Date(start.getTime() + i * DAY_MS)));
  }

  return result;
};

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", service: "merenda-certa-api" });
});

app.get("/api/dashboard", (_req, res) => {
  const totalProducts = db.prepare("SELECT COUNT(*) AS value FROM products").get().value;
  const lowStock = db
    .prepare(
      `SELECT COUNT(*) AS value
       FROM (
         SELECT p.id,
                p.min_stock,
                COALESCE(SUM(e.quantity_available), 0) AS current_stock
         FROM products p
         LEFT JOIN product_entries e ON e.product_id = p.id
         GROUP BY p.id, p.min_stock
       ) s
       WHERE s.current_stock <= s.min_stock`
    )
    .get().value;
  const totalMovements = db.prepare("SELECT COUNT(*) AS value FROM movements").get().value;
  const tempAlerts = db
    .prepare("SELECT COUNT(*) AS value FROM temperature_readings WHERE status = 'ALERT'")
    .get().value;

  res.json({
    totalProducts,
    lowStock,
    totalMovements,
    tempAlerts
  });
});

app.get("/api/products", (_req, res) => {
  const products = db
    .prepare(
      `SELECT p.id,
              p.name,
              p.unit,
              COALESCE(SUM(e.quantity_available), 0) AS currentStock,
              p.min_stock AS minStock,
              MIN(CASE WHEN e.quantity_available > 0 THEN e.expiration_date END) AS expirationDate,
              p.created_at AS createdAt
       FROM products p
       LEFT JOIN product_entries e ON e.product_id = p.id
       GROUP BY p.id, p.name, p.unit, p.min_stock, p.created_at
       ORDER BY p.name`
    )
    .all();
  res.json(products);
});

app.get("/api/analytics/products", (req, res) => {
  const daysParam = Number(req.query.days);
  const days = Number.isInteger(daysParam) ? Math.min(Math.max(daysParam, 7), 365) : 60;
  const labels = buildDateRange(days);
  const startDate = labels[0];
  const endDate = labels[labels.length - 1];

  const stockBeforeStart = db
    .prepare(
      `SELECT
         COALESCE((SELECT SUM(quantity_total) FROM product_entries WHERE date(received_at) < date(?)), 0)
         + COALESCE((SELECT SUM(quantity) FROM movements WHERE type = 'IN' AND date(created_at) < date(?)), 0)
         - COALESCE((SELECT SUM(quantity) FROM movements WHERE type = 'OUT' AND date(created_at) < date(?)), 0)
         AS value`
    )
    .get(startDate, startDate, startDate).value;

  const stockDeltas = db
    .prepare(
      `SELECT day, SUM(delta) AS delta
       FROM (
         SELECT date(received_at) AS day, SUM(quantity_total) AS delta
         FROM product_entries
         WHERE date(received_at) BETWEEN date(?) AND date(?)
         GROUP BY date(received_at)

         UNION ALL

         SELECT date(created_at) AS day, SUM(CASE WHEN type = 'IN' THEN quantity ELSE -quantity END) AS delta
         FROM movements
         WHERE date(created_at) BETWEEN date(?) AND date(?)
         GROUP BY date(created_at)
       ) t
       GROUP BY day`
    )
    .all(startDate, endDate, startDate, endDate);

  const stockByDay = new Map(stockDeltas.map((row) => [row.day, Number(row.delta)]));
  const stockTimeline = [];
  let runningStock = Number(stockBeforeStart) || 0;

  for (const day of labels) {
    runningStock += stockByDay.get(day) || 0;
    stockTimeline.push(Number(runningStock.toFixed(2)));
  }

  const expiredBeforeStart = db
    .prepare(
      `SELECT COALESCE(SUM(quantity_total), 0) AS value
       FROM product_entries
       WHERE date(expiration_date) < date(?)`
    )
    .get(startDate).value;

  const expiredDeltas = db
    .prepare(
      `SELECT date(expiration_date) AS day, SUM(quantity_total) AS qty
       FROM product_entries
       WHERE date(expiration_date) BETWEEN date(?) AND date(?)
       GROUP BY date(expiration_date)`
    )
    .all(startDate, endDate);

  const expiredByDay = new Map(expiredDeltas.map((row) => [row.day, Number(row.qty)]));
  const expiredTimeline = [];
  let runningExpired = Number(expiredBeforeStart) || 0;

  for (const day of labels) {
    runningExpired += expiredByDay.get(day) || 0;
    expiredTimeline.push(runningExpired);
  }

  res.json({
    from: startDate,
    to: endDate,
    labels,
    stockTimeline,
    expiredTimeline
  });
});

app.post("/api/products", (req, res) => {
  const { name, unit = "kg", minStock = 0 } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ error: "Nome do produto e obrigatorio." });
  }

  const stmt = db.prepare(
    `INSERT INTO products (name, unit, min_stock)
     VALUES (?, ?, ?)`
  );
  const result = stmt.run(name.trim(), unit, Number(minStock) || 0);

  const created = db
    .prepare(
      `SELECT p.id,
              p.name,
              p.unit,
              0 AS currentStock,
              p.min_stock AS minStock,
              NULL AS expirationDate,
              p.created_at AS createdAt
       FROM products WHERE id = ?`
    )
    .get(result.lastInsertRowid);
  return res.status(201).json(created);
});

app.get("/api/product-entries", (_req, res) => {
  const rows = db
    .prepare(
      `SELECT e.id,
              e.product_id AS productId,
              p.name AS productName,
              p.unit,
              e.quantity_total AS quantityTotal,
              e.quantity_available AS quantityAvailable,
              e.expiration_date AS expirationDate,
              e.received_at AS receivedAt
       FROM product_entries e
       JOIN products p ON p.id = e.product_id
       ORDER BY e.received_at DESC
       LIMIT 300`
    )
    .all();
  return res.json(rows);
});

app.post("/api/product-entries", (req, res) => {
  const { productId, quantity, expirationDate, receivedAt = null } = req.body;
  const qty = Number(quantity);
  const normalizedProductId = Number(productId);

  if (!normalizedProductId || !(qty > 0) || !expirationDate) {
    return res.status(400).json({ error: "Dados invalidos para entrada de lote." });
  }

  const product = db.prepare("SELECT id FROM products WHERE id = ?").get(normalizedProductId);
  if (!product) {
    return res.status(404).json({ error: "Produto nao encontrado." });
  }

  const result = db
    .prepare(
      `INSERT INTO product_entries (product_id, quantity_total, quantity_available, expiration_date, received_at)
       VALUES (?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP))`
    )
    .run(normalizedProductId, qty, qty, expirationDate, receivedAt);

  const created = db
    .prepare(
      `SELECT e.id,
              e.product_id AS productId,
              p.name AS productName,
              p.unit,
              e.quantity_total AS quantityTotal,
              e.quantity_available AS quantityAvailable,
              e.expiration_date AS expirationDate,
              e.received_at AS receivedAt
       FROM product_entries e
       JOIN products p ON p.id = e.product_id
       WHERE e.id = ?`
    )
    .get(result.lastInsertRowid);

  return res.status(201).json(created);
});

app.get("/api/movements", (req, res) => {
  const { productId } = req.query;

  let rows;
  if (productId) {
    rows = db
      .prepare(
        `SELECT m.id, m.product_id AS productId, p.name AS productName, m.type, m.quantity, m.notes, m.created_at AS createdAt
         FROM movements m
         JOIN products p ON p.id = m.product_id
         WHERE m.product_id = ?
         ORDER BY m.created_at DESC`
      )
      .all(productId);
  } else {
    rows = db
      .prepare(
        `SELECT m.id, m.product_id AS productId, p.name AS productName, m.type, m.quantity, m.notes, m.created_at AS createdAt
         FROM movements m
         JOIN products p ON p.id = m.product_id
         ORDER BY m.created_at DESC
         LIMIT 100`
      )
      .all();
  }

  return res.json(rows);
});

app.post("/api/movements", (req, res) => {
  const { productId, type, quantity, notes = null } = req.body;
  const normalizedType = String(type || "").toUpperCase();
  const amount = Number(quantity);

  if (!productId || !["IN", "OUT"].includes(normalizedType) || !(amount > 0)) {
    return res.status(400).json({ error: "Dados invalidos para movimentacao." });
  }
  if (normalizedType === "IN") {
    return res.status(400).json({ error: "Entrada deve ser registrada em lotes com validade." });
  }

  const product = db
    .prepare(
      `SELECT p.id,
              COALESCE(SUM(e.quantity_available), 0) AS currentStock
       FROM products p
       LEFT JOIN product_entries e ON e.product_id = p.id
       WHERE p.id = ?
       GROUP BY p.id`
    )
    .get(productId);
  if (!product) {
    return res.status(404).json({ error: "Produto nao encontrado." });
  }

  const nextStock = product.currentStock - amount;
  if (nextStock < 0) {
    return res.status(409).json({ error: "Estoque insuficiente para saida." });
  }

  const transaction = db.transaction(() => {
    let remaining = amount;
    const entries = db
      .prepare(
        `SELECT id, quantity_available AS quantityAvailable
         FROM product_entries
         WHERE product_id = ? AND quantity_available > 0
         ORDER BY date(expiration_date), date(received_at), id`
      )
      .all(productId);

    for (const entry of entries) {
      if (remaining <= 0) break;
      const consume = Math.min(remaining, Number(entry.quantityAvailable));
      remaining -= consume;
      db.prepare("UPDATE product_entries SET quantity_available = quantity_available - ? WHERE id = ?").run(
        consume,
        entry.id
      );
    }

    const moveResult = db
      .prepare(
        `INSERT INTO movements (product_id, type, quantity, notes)
         VALUES (?, ?, ?, ?)`
      )
      .run(productId, normalizedType, amount, notes);

    return db
      .prepare(
        `SELECT m.id, m.product_id AS productId, p.name AS productName, m.type, m.quantity, m.notes, m.created_at AS createdAt
         FROM movements m
         JOIN products p ON p.id = m.product_id
         WHERE m.id = ?`
      )
      .get(moveResult.lastInsertRowid);
  });

  const movement = transaction();
  return res.status(201).json(movement);
});

app.get("/api/temperature-meters", (_req, res) => {
  const rows = db
    .prepare(
      `SELECT m.id,
              m.name,
              m.meter_code AS meterCode,
              m.min_temp AS minTemp,
              m.max_temp AS maxTemp,
              m.created_at AS createdAt,
              (
                SELECT r.temperature_c
                FROM temperature_readings r
                WHERE r.meter_id = m.id
                ORDER BY r.recorded_at DESC
                LIMIT 1
              ) AS lastTemperatureC,
              (
                SELECT r.status
                FROM temperature_readings r
                WHERE r.meter_id = m.id
                ORDER BY r.recorded_at DESC
                LIMIT 1
              ) AS lastStatus,
              (
                SELECT r.recorded_at
                FROM temperature_readings r
                WHERE r.meter_id = m.id
                ORDER BY r.recorded_at DESC
                LIMIT 1
              ) AS lastRecordedAt
       FROM temperature_meters m
       ORDER BY m.name`
    )
    .all();

  return res.json(rows);
});

app.post("/api/temperature-meters", (req, res) => {
  const { name, meterCode, minTemp, maxTemp } = req.body;
  const minValue = Number(minTemp);
  const maxValue = Number(maxTemp);

  if (!name || !name.trim() || !meterCode || !meterCode.trim() || Number.isNaN(minValue) || Number.isNaN(maxValue)) {
    return res.status(400).json({ error: "Dados invalidos para medidor." });
  }

  if (minValue >= maxValue) {
    return res.status(400).json({ error: "A temperatura minima deve ser menor que a maxima." });
  }

  try {
    const result = db
      .prepare(
        `INSERT INTO temperature_meters (name, meter_code, min_temp, max_temp)
         VALUES (?, ?, ?, ?)`
      )
      .run(name.trim(), meterCode.trim(), minValue, maxValue);

    const created = db
      .prepare(
        `SELECT id, name, meter_code AS meterCode, min_temp AS minTemp, max_temp AS maxTemp, created_at AS createdAt
         FROM temperature_meters
         WHERE id = ?`
      )
      .get(result.lastInsertRowid);

    return res.status(201).json(created);
  } catch (error) {
    if (String(error.message).includes("UNIQUE")) {
      return res.status(409).json({ error: "Ja existe um medidor com esse codigo." });
    }
    return res.status(500).json({ error: "Nao foi possivel cadastrar medidor." });
  }
});

app.patch("/api/temperature-meters/:id", (req, res) => {
  const meterId = Number(req.params.id);
  const { minTemp, maxTemp, name } = req.body;
  const minValue = Number(minTemp);
  const maxValue = Number(maxTemp);

  if (!meterId || Number.isNaN(minValue) || Number.isNaN(maxValue) || minValue >= maxValue) {
    return res.status(400).json({ error: "Dados invalidos para atualizacao do medidor." });
  }

  const existing = db.prepare("SELECT id FROM temperature_meters WHERE id = ?").get(meterId);
  if (!existing) {
    return res.status(404).json({ error: "Medidor nao encontrado." });
  }

  db.prepare("UPDATE temperature_meters SET name = ?, min_temp = ?, max_temp = ? WHERE id = ?").run(
    name && name.trim() ? name.trim() : `Medidor ${meterId}`,
    minValue,
    maxValue,
    meterId
  );

  const updated = db
    .prepare(
      `SELECT id, name, meter_code AS meterCode, min_temp AS minTemp, max_temp AS maxTemp, created_at AS createdAt
       FROM temperature_meters WHERE id = ?`
    )
    .get(meterId);

  return res.json(updated);
});

app.get("/api/temperature-readings", (req, res) => {
  const { from, to, meterId } = req.query;
  const params = [];
  const where = [];

  if (from) {
    where.push("date(r.recorded_at) >= date(?)");
    params.push(from);
  }
  if (to) {
    where.push("date(r.recorded_at) <= date(?)");
    params.push(to);
  }
  if (meterId) {
    where.push("r.meter_id = ?");
    params.push(Number(meterId));
  }

  const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
  const rows = db
    .prepare(
      `SELECT r.id,
              r.meter_id AS meterId,
              m.name AS meterName,
              m.meter_code AS meterCode,
              m.min_temp AS minTemp,
              m.max_temp AS maxTemp,
              r.temperature_c AS temperatureC,
              r.status,
              r.source,
              r.recorded_at AS recordedAt
       FROM temperature_readings r
       JOIN temperature_meters m ON m.id = r.meter_id
       ${whereSql}
       ORDER BY r.recorded_at DESC
       LIMIT 300`
    )
    .all(...params);

  return res.json(rows);
});

app.post("/api/temperature-readings", (req, res) => {
  const { meterId, temperatureC, recordedAt = null } = req.body;
  const meter = db
    .prepare("SELECT id, min_temp AS minTemp, max_temp AS maxTemp FROM temperature_meters WHERE id = ?")
    .get(Number(meterId));

  if (!meter) {
    return res.status(404).json({ error: "Medidor nao encontrado." });
  }

  const value = Number(temperatureC);
  if (Number.isNaN(value)) {
    return res.status(400).json({ error: "Temperatura invalida." });
  }

  const status = toReadingStatus(value, meter.minTemp, meter.maxTemp);
  const result = db
    .prepare(
      `INSERT INTO temperature_readings (meter_id, temperature_c, status, source, recorded_at)
       VALUES (?, ?, ?, 'MANUAL', COALESCE(?, CURRENT_TIMESTAMP))`
    )
    .run(meter.id, value, status, recordedAt);

  const created = db
    .prepare(
      `SELECT r.id,
              r.meter_id AS meterId,
              m.name AS meterName,
              m.meter_code AS meterCode,
              m.min_temp AS minTemp,
              m.max_temp AS maxTemp,
              r.temperature_c AS temperatureC,
              r.status,
              r.source,
              r.recorded_at AS recordedAt
       FROM temperature_readings r
       JOIN temperature_meters m ON m.id = r.meter_id
       WHERE r.id = ?`
    )
    .get(result.lastInsertRowid);

  return res.status(201).json(created);
});

app.get("/api/temperature-dashboard", (_req, res) => {
  const summary = db
    .prepare(
      `SELECT COUNT(*) AS totalReadings,
              SUM(CASE WHEN status = 'ALERT' THEN 1 ELSE 0 END) AS totalAlerts,
              COUNT(DISTINCT CASE WHEN status = 'ALERT' THEN meter_id END) AS metersWithAlerts
       FROM temperature_readings`
    )
    .get();

  const topMeters = db
    .prepare(
      `SELECT m.id AS meterId,
              m.name AS meterName,
              m.meter_code AS meterCode,
              COUNT(*) AS alerts
       FROM temperature_readings r
       JOIN temperature_meters m ON m.id = r.meter_id
       WHERE r.status = 'ALERT'
       GROUP BY m.id, m.name, m.meter_code
       ORDER BY alerts DESC, m.name
       LIMIT 6`
    )
    .all();

  const totalReadings = Number(summary.totalReadings || 0);
  const totalAlerts = Number(summary.totalAlerts || 0);
  const alertRate = totalReadings > 0 ? Number(((totalAlerts / totalReadings) * 100).toFixed(1)) : 0;

  return res.json({
    totalReadings,
    totalAlerts,
    metersWithAlerts: Number(summary.metersWithAlerts || 0),
    alertRate,
    topMeters
  });
});

app.listen(PORT, () => {
  startTemperatureMqtt().catch((error) => {
    // eslint-disable-next-line no-console
    console.error("Falha ao iniciar MQTT:", error.message);
  });
  // eslint-disable-next-line no-console
  console.log(`Merenda Certa online em http://localhost:${PORT} (MQTT em mqtt://127.0.0.1:${MQTT_PORT})`);
});
