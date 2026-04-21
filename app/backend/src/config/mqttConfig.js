export const mqttConfig = {
  brokerUrl: process.env.MQTT_BROKER_URL || 'mqtt://broker.emqx.io', // Public broker for dev
  clientId: process.env.MQTT_CLIENT_ID || `backend-pc-${Math.random().toString(36).substr(2, 9)}`,
  username: process.env.MQTT_USERNAME,
  password: process.env.MQTT_PASSWORD,
  topicPrefix: process.env.MQTT_TOPIC_PREFIX || 'rongjiahe/erp',
  qos: 1,
  clean: false // Persistent session
};
