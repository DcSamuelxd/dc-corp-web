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

function broadcastToUser(userId, payload) {
  const data = `data: ${JSON.stringify(payload)}\n\n`;
  for (const client of sseClients) {
    if (client.user && Number(client.user.id) === Number(userId)) {
      try {
        client.res.write(data);
      } catch {
        sseClients.delete(client);
      }
    }
  }
}

function broadcastToRole(role, payload) {
  const data = `data: ${JSON.stringify(payload)}\n\n`;
  for (const client of sseClients) {
    if (client.user && client.user.role === role) {
      try {
        client.res.write(data);
      } catch {
        sseClients.delete(client);
      }
    }
  }
}

module.exports = { sseClients, broadcastChatEvent, broadcastToUser, broadcastToRole };
