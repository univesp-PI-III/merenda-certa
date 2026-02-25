const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

const dataDir = path.join(__dirname, "..", "data");
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, "merenda-certa.db");
const db = new Database(dbPath);

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    unit TEXT NOT NULL DEFAULT 'kg',
    current_stock REAL NOT NULL DEFAULT 0,
    min_stock REAL NOT NULL DEFAULT 0,
    expiration_date TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS movements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('IN', 'OUT')),
    quantity REAL NOT NULL CHECK (quantity > 0),
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS product_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL,
    quantity_total REAL NOT NULL CHECK (quantity_total > 0),
    quantity_available REAL NOT NULL CHECK (quantity_available >= 0),
    expiration_date TEXT NOT NULL,
    received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS temperature_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    food_name TEXT NOT NULL,
    temperature_c REAL NOT NULL,
    recorded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    observer TEXT,
    status TEXT NOT NULL CHECK (status IN ('SAFE', 'ALERT'))
  );

  CREATE TABLE IF NOT EXISTS temperature_meters (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    meter_code TEXT NOT NULL UNIQUE,
    min_temp REAL NOT NULL,
    max_temp REAL NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS temperature_readings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    meter_id INTEGER NOT NULL,
    temperature_c REAL NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('SAFE', 'ALERT')),
    source TEXT NOT NULL CHECK (source IN ('MQTT', 'MANUAL')),
    recorded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (meter_id) REFERENCES temperature_meters(id) ON DELETE CASCADE
  );
`);

const upsertDefaultMeter = db.prepare(
  `INSERT INTO temperature_meters (name, meter_code, min_temp, max_temp)
   VALUES (?, ?, ?, ?)
   ON CONFLICT(meter_code) DO NOTHING`
);

db.transaction(() => {
  upsertDefaultMeter.run("Medidor 1", "medidor-1", 60, 75);
  upsertDefaultMeter.run("Medidor 2", "medidor-2", 58, 74);
  upsertDefaultMeter.run("Medidor 3", "medidor-3", 59, 73);
  upsertDefaultMeter.run("Medidor 4", "medidor-4", 60, 76);
})();

module.exports = db;
