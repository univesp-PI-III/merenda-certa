const db = require("../src/db");

const productsSeed = [
  { name: "Arroz", unit: "kg", minStock: 20 },
  { name: "Feijao", unit: "kg", minStock: 18 },
  { name: "Macarrao", unit: "kg", minStock: 12 },
  { name: "Molho de tomate", unit: "l", minStock: 10 },
  { name: "Frango congelado", unit: "kg", minStock: 25 },
  { name: "Leite", unit: "l", minStock: 15 },
  { name: "Banana", unit: "kg", minStock: 8 },
  { name: "Batata", unit: "kg", minStock: 14 }
];

const metersSeed = [
  { name: "bandeja arroz", meterCode: "medidor-1", minTemp: 60, maxTemp: 75 },
  { name: "bandeja feijão", meterCode: "medidor-2", minTemp: 58, maxTemp: 74 },
  { name: "bandeja salada", meterCode: "medidor-3", minTemp: 59, maxTemp: 73 },
  { name: "bandeja mistura", meterCode: "medidor-4", minTemp: 60, maxTemp: 76 }
];

const fmtDateTime = (d, hour = 9) => {
  const copy = new Date(d);
  copy.setHours(hour, Math.floor(Math.random() * 40), Math.floor(Math.random() * 55), 0);
  return copy.toISOString().slice(0, 19).replace("T", " ");
};

const addDays = (date, days) => {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
};

const fmtDate = (d) => d.toISOString().slice(0, 10);

const run = db.transaction(() => {
  db.exec(
    "DELETE FROM temperature_readings; DELETE FROM temperature_meters; DELETE FROM product_entries; DELETE FROM temperature_records; DELETE FROM movements; DELETE FROM products; DELETE FROM sqlite_sequence;"
  );

  const insertProduct = db.prepare(
    `INSERT INTO products (name, unit, min_stock, created_at) VALUES (?, ?, ?, ?)`
  );
  const insertEntry = db.prepare(
    `INSERT INTO product_entries (product_id, quantity_total, quantity_available, expiration_date, received_at)
     VALUES (?, ?, ?, ?, ?)`
  );
  const insertMovement = db.prepare(
    `INSERT INTO movements (product_id, type, quantity, notes, created_at) VALUES (?, ?, ?, ?, ?)`
  );
  const insertMeter = db.prepare(
    `INSERT INTO temperature_meters (name, meter_code, min_temp, max_temp, created_at) VALUES (?, ?, ?, ?, ?)`
  );
  const insertReading = db.prepare(
    `INSERT INTO temperature_readings (meter_id, temperature_c, status, source, recorded_at) VALUES (?, ?, ?, ?, ?)`
  );
  const takeFromEntries = db.prepare(
    `SELECT id, quantity_available AS quantityAvailable
     FROM product_entries
     WHERE product_id = ? AND quantity_available > 0
     ORDER BY date(expiration_date), date(received_at), id`
  );
  const updateEntryStock = db.prepare(
    `UPDATE product_entries SET quantity_available = quantity_available - ? WHERE id = ?`
  );

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const start = addDays(today, -89);

  const productIds = [];
  for (const p of productsSeed) {
    const createdAt = fmtDateTime(addDays(start, Math.floor(Math.random() * 6)), 8);
    const result = insertProduct.run(p.name, p.unit, p.minStock, createdAt);
    productIds.push({ id: Number(result.lastInsertRowid), unit: p.unit, name: p.name });
  }

  for (const product of productIds) {
    for (let day = 0; day < 90; day += 1) {
      const date = addDays(start, day);

      if (Math.random() < 0.62) {
        const inQty = Number((6 + Math.random() * 22).toFixed(2));
        const expiresAt = fmtDate(addDays(date, 20 + Math.floor(Math.random() * 40)));
        insertEntry.run(product.id, inQty, inQty, expiresAt, fmtDateTime(date, 8));
      }

      const available = db
        .prepare("SELECT COALESCE(SUM(quantity_available), 0) AS total FROM product_entries WHERE product_id = ?")
        .get(product.id).total;
      if (Number(available) > 0 && Math.random() < 0.7) {
        const maxOut = Math.min(Number(available), 16 + Math.random() * 12);
        const outQty = Number((1 + Math.random() * maxOut).toFixed(2));
        let remaining = outQty;
        const entries = takeFromEntries.all(product.id);
        for (const entry of entries) {
          if (remaining <= 0) break;
          const consume = Math.min(remaining, Number(entry.quantityAvailable));
          remaining -= consume;
          updateEntryStock.run(consume, entry.id);
        }
        insertMovement.run(product.id, "OUT", outQty, "Consumo diario", fmtDateTime(date, 12));
      }
    }
  }

  const meterIds = [];
  for (const meter of metersSeed) {
    const createdAt = fmtDateTime(addDays(start, Math.floor(Math.random() * 3)), 7);
    const result = insertMeter.run(meter.name, meter.meterCode, meter.minTemp, meter.maxTemp, createdAt);
    meterIds.push({
      id: Number(result.lastInsertRowid),
      minTemp: meter.minTemp,
      maxTemp: meter.maxTemp
    });
  }

  for (let day = 0; day < 90; day += 1) {
    const date = addDays(start, day);
    meterIds.forEach((meter, index) => {
      const drift = Math.random() < 0.22 ? (Math.random() < 0.5 ? -5 - Math.random() * 4 : 4 + Math.random() * 5) : -1 + Math.random() * 2;
      const base = meter.minTemp + (meter.maxTemp - meter.minTemp) / 2;
      const temp = Number((base + drift).toFixed(1));
      const status = temp >= meter.minTemp && temp <= meter.maxTemp ? "SAFE" : "ALERT";
      const hour = 9 + index;
      insertReading.run(meter.id, temp, status, "MQTT", fmtDateTime(date, hour));
    });
  }
});

run();

const counts = {
  products: db.prepare("SELECT COUNT(*) AS c FROM products").get().c,
  entries: db.prepare("SELECT COUNT(*) AS c FROM product_entries").get().c,
  movements: db.prepare("SELECT COUNT(*) AS c FROM movements").get().c,
  meters: db.prepare("SELECT COUNT(*) AS c FROM temperature_meters").get().c,
  readings: db.prepare("SELECT COUNT(*) AS c FROM temperature_readings").get().c
};

console.log("Seed concluido:", counts);
