import { FastifyInstance } from "fastify";
import { db } from "../db/db.js";

export async function metricsRoutes(app: FastifyInstance) {
  app.get("/api/811/metrics", async (_req, reply) => {
    const counts = db.prepare(`
      SELECT status, COUNT(*) as c FROM tickets_811 GROUP BY status
    `).all() as { status: string; c: number }[];

    const overdue = db.prepare(`
      SELECT COUNT(*) as c
      FROM tickets_811
      WHERE due_at < ? AND status NOT IN ('CLOSED','RESPONDED_ALL')
    `).get(Date.now()) as { c: number };

    return reply.send({
      byStatus: counts,
      overdue: overdue.c,
      now: Date.now()
    });
  });
}
