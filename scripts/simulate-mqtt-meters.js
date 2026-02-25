const mqtt = require("mqtt");

const MQTT_URL = process.env.MQTT_URL || "mqtt://127.0.0.1:1883";
const INTERVAL_MS = Number(process.env.SIM_INTERVAL_MS) || 3000;

const meters = [
  { code: "medidor-1", min: 60, max: 75 },
  { code: "medidor-2", min: 58, max: 74 },
  { code: "medidor-3", min: 59, max: 73 },
  { code: "medidor-4", min: 60, max: 76 }
];

const randomTemperature = (meter) => {
  const midpoint = meter.min + (meter.max - meter.min) / 2;
  const outlier = Math.random() < 0.25;
  const variation = outlier ? (Math.random() < 0.5 ? -7 - Math.random() * 3 : 5 + Math.random() * 4) : -1.5 + Math.random() * 3;
  return Number((midpoint + variation).toFixed(1));
};

const client = mqtt.connect(MQTT_URL, { reconnectPeriod: 1000 });

client.on("connect", () => {
  // eslint-disable-next-line no-console
  console.log(`Simulador conectado em ${MQTT_URL}`);

  setInterval(() => {
    meters.forEach((meter) => {
      const temperatureC = randomTemperature(meter);
      const topic = `merenda/temperatura/${meter.code}/leitura`;
      const payload = JSON.stringify({
        meterCode: meter.code,
        temperatureC,
        recordedAt: new Date().toISOString()
      });

      client.publish(topic, payload, { qos: 0 });
      // eslint-disable-next-line no-console
      console.log(`[MQTT] ${topic} => ${payload}`);
    });
  }, INTERVAL_MS);
});

client.on("error", (error) => {
  // eslint-disable-next-line no-console
  console.error("Erro no simulador MQTT:", error.message);
});
