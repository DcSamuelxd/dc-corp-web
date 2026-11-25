const sseClients = new Set();

function broadcastChatEvent(payload) {
  const data = `data: ${JSON.stringify(payload)}\n\n`;
  for (const client of sseClients) {
    try {
      client.res.write(data);
    } catch {
      sseClients.delete(client);
    }
  }
}

module.exports = { sseClients, broadcastChatEvent };
