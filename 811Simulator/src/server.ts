import Fastify from "fastify";
import cors from "@fastify/cors";
import { ticketsRoutes } from "./routes/tickets.js";
import { responsesRoutes } from "./routes/responses.js";
import { metricsRoutes } from "./routes/metrics.js";
import { opsRoutes } from "./routes/ops.js";

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
