const net = require("net");
const { Aedes } = require("aedes");
const mqtt = require("mqtt");
const db = require("./db");

const MQTT_PORT = Number(process.env.MQTT_PORT) || 1883;
const MQTT_HOST = process.env.MQTT_HOST || "127.0.0.1";
const MQTT_TOPIC_PATTERN = "merenda/temperatura/+/leitura";

let brokerServer;
let mqttClient;

const toReadingStatus = (temperatureC, minTemp, maxTemp) =>
  temperatureC >= Number(minTemp) && temperatureC <= Number(maxTemp) ? "SAFE" : "ALERT";

const insertReading = db.prepare(
  `INSERT INTO temperature_readings (meter_id, temperature_c, status, source, recorded_at)
   VALUES (?, ?, ?, 'MQTT', COALESCE(?, CURRENT_TIMESTAMP))`
);

const findMeterByCode = db.prepare(
  `SELECT id, name, meter_code AS meterCode, min_temp AS minTemp, max_temp AS maxTemp
   FROM temperature_meters
   WHERE meter_code = ?`
);

const handleMqttMessage = (topic, payloadBuffer) => {
  const match = topic.match(/^merenda\/temperatura\/([^/]+)\/leitura$/);
  if (!match) return;

  const meterCode = match[1];
  const meter = findMeterByCode.get(meterCode);
  if (!meter) return;

  let payload;
  try {
    payload = JSON.parse(payloadBuffer.toString("utf8"));
  } catch (_error) {
    return;
  }

  const value = Number(payload.temperatureC);
  if (Number.isNaN(value)) return;

  const status = toReadingStatus(value, meter.minTemp, meter.maxTemp);
  const recordedAt = payload.recordedAt ? new Date(payload.recordedAt).toISOString() : null;
  insertReading.run(meter.id, value, status, recordedAt);
};

const startTemperatureMqtt = async () => {
  const broker = await Aedes.createBroker();
  brokerServer = net.createServer(broker.handle);
  brokerServer.listen(MQTT_PORT, MQTT_HOST);

  mqttClient = mqtt.connect(`mqtt://${MQTT_HOST}:${MQTT_PORT}`);
  mqttClient.on("connect", () => {
    mqttClient.subscribe(MQTT_TOPIC_PATTERN);
  });

  mqttClient.on("message", (topic, payload) => {
    try {
      handleMqttMessage(topic, payload);
    } catch (_error) {
      // Keep subscriber alive even if one message fails.
    }
  });
};

module.exports = {
  startTemperatureMqtt,
  toReadingStatus
};
