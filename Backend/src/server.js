import express from "express";
import cors from "cors";
import { initDatabase } from "./db/database-sqlite.js";
import ticketsRouter from "./routes/tickets.js";
import usersRouter from "./routes/users.js";
import authRouter from "./routes/auth.js";
import syncRouter from "./routes/sync.js";
import timesheetRouter from "./routes/timesheet.js";
import inboundRouter from "./routes/inbound.js";
import opsRouter from "./routes/ops.js";
import territoriesRouter from "./routes/territories.js";
import { processOutbound811Events } from "./services/outbound811Service.js";
import { processEmailQueue } from "./services/emailService.js";
import {
  pullTicketsFrom811,
} from "./services/ingestionService.js";
import { assignUnassignedTickets } from "./services/assignmentService.js";
import { initIdempotencyStore } from "./services/idempotencyService.js";
import { emitOpsEvent } from "./utils/opsEventBus.js";

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: "25mb" }));

// Initialize database
export const db = initDatabase();

// Initialize idempotency store (persists to SQLite, survives restarts)
initIdempotencyStore(db);

// Tickets will now be ingested from 811 Simulator

// Routes
app.use("/api/tickets", ticketsRouter);
app.use("/api/users", usersRouter);
app.use("/api/auth", authRouter);
app.use("/api/sync", syncRouter);
app.use("/api/timesheet", timesheetRouter);
app.use("/api/inbound", inboundRouter);
// Territory admin (tree, CRUD, user assignments). MUST be mounted before the
// general /api/ops router so the more-specific prefix wins.
app.use("/api/ops/territories", territoriesRouter);
app.use("/api/ops", opsRouter);

// Health check
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", message: "Locate720 Backend Running" });
});

setInterval(async () => {
  try {
    const pullResults = await pullTicketsFrom811(db, 0, {
      reconcileMissing: true,
    });

    if (
      pullResults.ingested > 0 ||
      pullResults.updated > 0 ||
      pullResults.reconciledRemoved > 0
    ) {
      console.log(
        `[Auto811-Inbound] Ingested ${pullResults.ingested} new, updated ${pullResults.updated} tickets, removed ${pullResults.reconciledRemoved}`,
      );

      // Auto-assign newly ingested tickets
      const assignResults = await assignUnassignedTickets(db);
      if (assignResults.assigned > 0) {
        console.log(
          `[Auto811-Inbound] Auto-assigned ${assignResults.assigned} tickets`,
        );
      }

      emitOpsEvent("simulator.sync", {
        ingested: pullResults.ingested,
        updated: pullResults.updated,
        reconciledRemoved: pullResults.reconciledRemoved,
        assigned: assignResults.assigned || 0,
      });
    }

    if (pullResults.errors.length > 0) {
      console.error(
        `[Auto811-Inbound] ${pullResults.errors.length} errors occurred`,
      );
    }
  } catch (error) {
    console.error("[Auto811-Inbound] Failed to pull tickets:", error.message);
  }
}, 30000); // 30 seconds

// Auto-process outbound 811 events every 30 seconds
setInterval(async () => {
  try {
    const results = await processOutbound811Events(db);
    if (results.processed > 0) {
      console.log(
        `[Auto811-Outbound] Processed ${results.processed} outbound events`,
      );
    }
    if (results.errors.length > 0) {
      console.error(
        `[Auto811-Outbound] ${results.errors.length} errors occurred`,
      );
    }
  } catch (error) {
    console.error(
      "[Auto811-Outbound] Failed to process events:",
      error.message,
    );
  }
}, 30000); // 30 seconds

// Auto-process contractor email queue every 60 seconds
setInterval(async () => {
  try {
    const results = await processEmailQueue(db);
    if (results.processed > 0) {
      console.log(`[AutoEmail] Processed ${results.processed} contractor emails`);
    }
    if (results.errors.length > 0) {
      console.error(`[AutoEmail] ${results.errors.length} errors occurred`);
    }
  } catch (error) {
    console.error("[AutoEmail] Failed to process email queue:", error.message);
  }
}, 60000); // 60 seconds

// Auto-delete tickets older than 4 days to keep the DB from growing unbounded.
// Runs on startup and then every hour. Also cleans up related data
// (production ledger entries, ticket events, notes, attachments).
const MAX_TICKET_AGE_MS = 4 * 24 * 60 * 60 * 1000; // 4 days

function cleanupOldTickets() {
  const cutoff = Date.now() - MAX_TICKET_AGE_MS;
  try {
    const oldTickets = db.prepare(`SELECT id FROM tickets WHERE created_at < ?`).all(cutoff);
    if (oldTickets.length === 0) return;

    const ids = oldTickets.map((t) => t.id);
    const ph = ids.map(() => "?").join(",");

    const tx = db.transaction(() => {
      db.prepare(`DELETE FROM utility_production_ledger WHERE ticket_id IN (${ph})`).run(...ids);
      db.prepare(`DELETE FROM ticket_events WHERE ticket_id IN (${ph})`).run(...ids);
      db.prepare(`DELETE FROM ticket_notes WHERE ticket_id IN (${ph})`).run(...ids);
      db.prepare(`DELETE FROM ticket_attachments WHERE ticket_id IN (${ph})`).run(...ids);
      const result = db.prepare(`DELETE FROM tickets WHERE id IN (${ph})`).run(...ids);
      console.log(`[cleanup] Deleted ${result.changes} tickets older than 4 days (before ${new Date(cutoff).toISOString()})`);
    });
    tx();
  } catch (error) {
    console.error("[cleanup] Failed to delete old tickets:", error.message);
  }
}

cleanupOldTickets();
setInterval(cleanupOldTickets, 60 * 60 * 1000); // every hour

// Start server
app.listen(PORT, "0.0.0.0", () => {
  console.log(`[Server] Locate720 Backend running on http://0.0.0.0:${PORT}`);
  console.log(`[Server] API available at http://0.0.0.0:${PORT}/api`);
  console.log(`[Server] Local access: http://localhost:${PORT}/api`);
});

