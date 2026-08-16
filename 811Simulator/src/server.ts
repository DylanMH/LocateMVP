import Fastify from "fastify";
import cors from "@fastify/cors";
import { ticketsRoutes } from "./routes/tickets.js";
import { responsesRoutes } from "./routes/responses.js";
import { metricsRoutes } from "./routes/metrics.js";
import { opsRoutes } from "./routes/ops.js";
import { seedAreas } from "./db/seed.js";
import { db } from "./db/db.js";

// Seed service areas on startup (idempotent)
seedAreas();

// Auto-delete tickets older than 4 days to keep the DB from growing unbounded.
// Runs on startup and then every hour.
const MAX_TICKET_AGE_MS = 4 * 24 * 60 * 60 * 1000; // 4 days

function cleanupOldTickets() {
  const cutoff = Date.now() - MAX_TICKET_AGE_MS;
  try {
    const result = db.prepare(`
      DELETE FROM tickets_811 WHERE created_at < ?
    `).run(cutoff);
    if (result.changes > 0) {
      console.log(`[cleanup] Deleted ${result.changes} tickets older than 4 days (created before ${new Date(cutoff).toISOString()})`);
    }
  } catch (err) {
    console.error("[cleanup] Failed to delete old tickets:", err);
  }
}

cleanupOldTickets();
setInterval(cleanupOldTickets, 60 * 60 * 1000); // every hour

const app = Fastify({
  logger: true,
});

// Register CORS
await app.register(cors, {
  origin: true, // Allow all origins in development
});

// Register routes
await app.register(ticketsRoutes);
await app.register(responsesRoutes);
await app.register(metricsRoutes);
await app.register(opsRoutes);

// Start server
const PORT = process.env.PORT || 4100;

try {
  await app.listen({ port: Number(PORT), host: "0.0.0.0" });
  console.log(`[811-center] running on http://localhost:${PORT}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
