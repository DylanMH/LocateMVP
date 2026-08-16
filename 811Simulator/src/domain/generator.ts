import { db } from "../db/db.js";
import crypto from "node:crypto";
import type { AreaId } from "./areas.js";
import { buildTicketScope } from "./scope.js";

// 811-standard ticket type taxonomy. "Original" is NOT a type — it is a
// lineage concept (the first/root ticket in a chain, tracked via
// root_ticket_id + sequence_number === 1). The type describes WHAT kind of
// 811 ticket it is.
//
// Original-eligible (first-call) types: NORMAL, EMERGENCY, DIGUP, NON_COMPLIANT.
//   These can be the head of a chain (self-rooted, sequence 1).
// Linked/derived types: UPDATE, UPDATE_REMARK, RECALL, NO_RESPONSE.
//   These always reference an original via root_ticket_id. Per 811 rules,
//   UPDATE and UPDATE_REMARK may only be generated against a NORMAL original;
//   RECALL and NO_RESPONSE may attach to any original type.
export type TicketType =
  | "NORMAL"
  | "EMERGENCY"
  | "DIGUP"
  | "NON_COMPLIANT"
  | "UPDATE"
  | "UPDATE_REMARK"
  | "RECALL"
  | "NO_RESPONSE";

// Types that can be the first ticket called in (the head of a chain).
export const ORIGINAL_TICKET_TYPES: ReadonlyArray<
  Extract<TicketType, "NORMAL" | "EMERGENCY" | "DIGUP" | "NON_COMPLIANT">
> = ["NORMAL", "EMERGENCY", "DIGUP", "NON_COMPLIANT"];

// Types that are derived from an existing original. These are the only types
// accepted by createLinkedTicket().
export const LINKED_TICKET_TYPES: ReadonlyArray<
  Extract<TicketType, "UPDATE" | "UPDATE_REMARK" | "RECALL" | "NO_RESPONSE">
> = ["UPDATE", "UPDATE_REMARK", "RECALL", "NO_RESPONSE"];

// Linked types that, per 811 rules, may only be generated against a NORMAL
// original. RECALL and NO_RESPONSE may attach to any original type.
export const NORMAL_ROOT_ONLY_LINKED_TYPES: ReadonlyArray<
  Extract<TicketType, "UPDATE" | "UPDATE_REMARK">
> = ["UPDATE", "UPDATE_REMARK"];

type UtilityType = "GAS" | "ELECTRIC" | "FIBER" | "WATER" | "SEWER" | "COPPER";

const UTIL_POOL: UtilityType[] = ["GAS","ELECTRIC","FIBER","WATER","SEWER","COPPER"];

const STREET_BY_CITY: Record<AreaId, string[]> = {
  JOSEPHINE: ["FM 1777", "CR 550", "Main St", "Oak St", "Elm St", "2nd St"],
  MABANK: ["Market St", "3rd St", "Mason St", "Gun Barrel Ln", "CR 3057", "US 175"],
  GUN_BARREL: ["Harbor Point Dr", "Legacy Dr", "Main St", "Cherokee Dr", "Mohawk Dr", "Shoreline Dr"],
  EUSTACE: ["US 175", "FM 316", "CR 2901", "Main St", "Elm St", "Pine St"],
  TOOL: ["Tool Rd", "CR 2324", "CR 2319", "Oak Dr", "Cedar Dr", "Harbor Dr"],
  SEVEN_POINTS: ["Seven Points Dr", "CR 2317", "Lakeside Dr", "Oak Dr", "Shady Ln", "Point View Dr"],
  HEATH: ["Laurence Dr", "Smirl Dr", "Hubbard Dr", "Ridge Rd", "FM 740", "Terrace Dr"],
  MCLENDON_CHISHOLM: ["FM 550", "CR 275", "Pullen Rd", "Meadowcreek Dr", "Oak Hill Dr", "Horizon Rd"],
  KEMP: ["US 175", "FM 1896", "9th St", "Main St", "Elm St", "CR 4021"],
  ENCHANTED_OAKS: ["Enchanted Dr", "Oak Trail", "Cedar Creek Dr", "Lakeview Dr", "Shady Ln", "Forest Ln"],
};

const ZIP_BY_CITY: Record<AreaId, string> = {
  JOSEPHINE: "75173",
  MABANK: "75147",
  GUN_BARREL: "75156",
  EUSTACE: "75124",
  TOOL: "75143",
  SEVEN_POINTS: "75143",
  HEATH: "75032",
  MCLENDON_CHISHOLM: "75032",
  KEMP: "75143",
  ENCHANTED_OAKS: "75156",
};

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randBetween(min: number, max: number) {
  return min + Math.random() * (max - min);
}

function dueAtFor(type: TicketType, now: number) {
  // Emergency: danger to life/health/property — 2 hour response (15m - 2h).
  if (type === "EMERGENCY") return now + randBetween(15 * 60_000, 2 * 60 * 60_000);
  // DigUp: utility line cut/damaged/exposed — high priority, zero hours notice (30m - 2h).
  if (type === "DIGUP") return now + randBetween(30 * 60_000, 2 * 60 * 60_000);
  // Non-Compliant: less than 2 business days notice (2h - 48h).
  if (type === "NON_COMPLIANT") return now + randBetween(2 * 60 * 60_000, 48 * 60 * 60_000);
  // Update / Update & Remark: extend life of an existing ticket (4h - 24h).
  if (type === "UPDATE_REMARK" || type === "UPDATE")
    return now + randBetween(4 * 60 * 60_000, 24 * 60 * 60_000);
  // Recall / No Response: reference a previous ticket (1h - 12h).
  if (type === "RECALL" || type === "NO_RESPONSE")
    return now + randBetween(1 * 60 * 60_000, 12 * 60 * 60_000);
  // Normal: 2+ business days notice (24h - 72h).
  return now + randBetween(24 * 60 * 60_000, 72 * 60 * 60_000);
}

// Weighted pick for bulk-generated originals. Real 811 volume is dominated by
// Normal tickets, with a smaller share of Emergency / Non-Compliant / DigUp.
const ORIGINAL_TYPE_WEIGHTS: Array<{ type: Extract<TicketType, "NORMAL" | "EMERGENCY" | "DIGUP" | "NON_COMPLIANT">; weight: number }> = [
  { type: "NORMAL", weight: 70 },
  { type: "EMERGENCY", weight: 12 },
  { type: "NON_COMPLIANT", weight: 10 },
  { type: "DIGUP", weight: 8 },
];

function pickOriginalType(): Extract<TicketType, "NORMAL" | "EMERGENCY" | "DIGUP" | "NON_COMPLIANT"> {
  const total = ORIGINAL_TYPE_WEIGHTS.reduce((sum, w) => sum + w.weight, 0);
  let roll = Math.random() * total;
  for (const entry of ORIGINAL_TYPE_WEIGHTS) {
    roll -= entry.weight;
    if (roll <= 0) return entry.type;
  }
  return "NORMAL";
}

function makeTicketNumberBase(area: AreaId, now: Date) {
  // Ex: 0826-JOSE-000123
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const yy = String(now.getFullYear()).slice(-2);
  const areaCodes: Record<AreaId, string> = {
    JOSEPHINE: "JOSE", MABANK: "MABA", GUN_BARREL: "GUNB", EUSTACE: "EUST",
    TOOL: "TOOL", SEVEN_POINTS: "7PTS", HEATH: "HEAT",
    MCLENDON_CHISHOLM: "MCLN", KEMP: "KEMP", ENCHANTED_OAKS: "ENCH",
  };
  const areaCode = areaCodes[area] || "UNKN";
  const seq = Math.floor(Math.random() * 999999);
  return `${mm}${yy}-${areaCode}-${String(seq).padStart(6, "0")}`;
}

// Linked ticket numbers share the original base number with a -R{n} suffix,
// where n = sequence_number - 1. E.g. 1126-ROCK-000123 -> ...-R1, ...-R2.
function makeLinkedTicketNumber(baseNumber: string, sequenceNumber: number) {
  return `${baseNumber}-R${sequenceNumber - 1}`;
}

export function getNextSequenceNumber(rootTicketId: string): number {
  const row = db
    .prepare(
      `SELECT COALESCE(MAX(sequence_number), 0) + 1 AS next FROM tickets_811 WHERE root_ticket_id = ?`,
    )
    .get(rootTicketId) as { next: number } | undefined;
  return row?.next ?? 1;
}

function getAreaRow(areaId: AreaId) {
  const row = db.prepare(`SELECT * FROM service_areas WHERE id = ?`).get(areaId) as any;
  if (!row) throw new Error(`Area not found: ${areaId}`);
  return row;
}

interface InsertTicketArgs {
  id: string;
  ticketNumber: string;
  ticketType: TicketType;
  status: string;
  version: number;
  areaId: AreaId;
  createdAt: number;
  updatedAt: number;
  dueAt: number;
  addressLine1: string;
  city: string;
  state: string;
  zip: string;
  lat: number;
  lng: number;
  workType: string;
  markingInstructions: string;
  contractorName: string;
  contractorPhone: string;
  contactName: string;
  contactEmail: string;
  payloadJson: string;
  rootTicketId: string;
  parentTicketId: string | null;
  sequenceNumber: number;
  externalRootNumber: string;
}

const insertTicketStmt = () =>
  db.prepare(`
    INSERT INTO tickets_811 (
      id, ticket_number, ticket_type, status, version, area_id,
      created_at, updated_at, due_at,
      address_line1, city, state, zip, lat, lng,
      work_type, marking_instructions,
      contractor_name, contractor_phone, contact_name, contact_email,
      payload_json,
      root_ticket_id, parent_ticket_id, sequence_number, external_root_number
    ) VALUES (
      @id, @ticket_number, @ticket_type, @status, @version, @area_id,
      @created_at, @updated_at, @due_at,
      @address_line1, @city, @state, @zip, @lat, @lng,
      @work_type, @marking_instructions,
      @contractor_name, @contractor_phone, @contact_name, @contact_email,
      @payload_json,
      @root_ticket_id, @parent_ticket_id, @sequence_number, @external_root_number
    )
  `);

const insertMemberStmt = () =>
  db.prepare(`
    INSERT INTO ticket_members_811 (
      id, ticket_id, member_code, utility_type, company_name, status
    ) VALUES (
      @id, @ticket_id, @member_code, @utility_type, @company_name, @status
    )
  `);

function insertTicketRow(insertTicket: ReturnType<typeof insertTicketStmt>, t: InsertTicketArgs) {
  insertTicket.run({
    id: t.id,
    ticket_number: t.ticketNumber,
    ticket_type: t.ticketType,
    status: t.status,
    version: t.version,
    area_id: t.areaId,
    created_at: t.createdAt,
    updated_at: t.updatedAt,
    due_at: t.dueAt,
    address_line1: t.addressLine1,
    city: t.city,
    state: t.state,
    zip: t.zip,
    lat: t.lat,
    lng: t.lng,
    work_type: t.workType,
    marking_instructions: t.markingInstructions,
    contractor_name: t.contractorName,
    contractor_phone: t.contractorPhone,
    contact_name: t.contactName,
    contact_email: t.contactEmail,
    payload_json: t.payloadJson,
    root_ticket_id: t.rootTicketId,
    parent_ticket_id: t.parentTicketId,
    sequence_number: t.sequenceNumber,
    external_root_number: t.externalRootNumber,
  });
}

function insertEvent(ticketId: string, type: string, payload: any) {
  db.prepare(`
    INSERT INTO ticket_event_log_811 (id, ticket_id, type, occurred_at, payload_json)
    VALUES (@id, @ticket_id, @type, @occurred_at, @payload_json)
  `).run({
    id: crypto.randomUUID(),
    ticket_id: ticketId,
    type,
    occurred_at: Date.now(),
    payload_json: JSON.stringify(payload ?? {}),
  });
}

export function generateTickets(params: { areaId?: AreaId; count: number }) {
  const { areaId, count } = params;
  const nowMs = Date.now();
  const nowDate = new Date(nowMs);

  const areas: AreaId[] = ["JOSEPHINE","MABANK","GUN_BARREL","EUSTACE","TOOL","SEVEN_POINTS","HEATH","MCLENDON_CHISHOLM","KEMP","ENCHANTED_OAKS"];

  const insertTicket = insertTicketStmt();
  const insertMember = insertMemberStmt();

  const createdIds: string[] = [];

  const tx = db.transaction(() => {
    for (let i = 0; i < count; i++) {
      const aId = areaId ?? pick(areas);
      const a = getAreaRow(aId);

      const lat = randBetween(a.lat_min, a.lat_max);
      const lng = randBetween(a.lng_min, a.lng_max);

      const house = Math.floor(randBetween(100, 9999));
      const street = pick(STREET_BY_CITY[aId]);
      const addressLine1 = `${house} ${street}`;
      const cityNames: Record<AreaId, string> = {
        JOSEPHINE: "Josephine", MABANK: "Mabank", GUN_BARREL: "Gun Barrel City",
        EUSTACE: "Eustace", TOOL: "Tool", SEVEN_POINTS: "Seven Points",
        HEATH: "Heath", MCLENDON_CHISHOLM: "McLendon-Chisholm",
        KEMP: "Kemp", ENCHANTED_OAKS: "Enchanted Oaks",
      };
      const city = cityNames[aId] || "Unknown";

      // Bulk-generated tickets are originals (the head of their own chain).
      // The 811 type is picked from the original-eligible set (Normal/Emergency/
      // DigUp/Non-Compliant). Real linked-ticket variety comes from
      // createLinkedTicket(rootTicketId, type, overrides).
      const ticketType: TicketType = pickOriginalType();
      const dueAt = Math.floor(dueAtFor(ticketType, nowMs));

      const contractorName = pick(["ABC Boring", "Metro Fiber", "Lone Star Underground", "Rockwall Plumbing", "TX Utility Co"]);
      const contractorPhone = pick(["(469) 555-1201","(972) 555-8890","(214) 555-3309","(903) 555-4412"]);
      const contactName = pick(["Chris Martin","Taylor Reed","Jordan Miles","Sam Parker","Alex Nguyen"]);
      const contactEmail = contactName.toLowerCase().replace(" ", ".") + "@example.com";

      const workType = pick(["BORE", "TRENCH", "POLE", "REPAIR", "SERVICE_INSTALL"]);
      const markingInstructions = pick([
        "Mark entire work area within ROW. White paint present.",
        "Mark from curb to building. Contractor on-site today.",
        "Private property access needed. Call before marking.",
        "Bore path crosses driveway. Mark both sides."
      ]);

      const ticketId = crypto.randomUUID();
      const ticketNumber = makeTicketNumberBase(aId, nowDate);
      const scope = buildTicketScope({
        seed: `${ticketId}:${ticketNumber}:${workType}:${ticketType}`,
        centerLat: lat,
        centerLng: lng,
        workType,
        ticketType,
        areaBounds: a,
      });

      // customers/utilities on the ticket (this maps well to your L720 payloadJson.customers[])
      const numCustomers = Math.floor(randBetween(1, 6));
      const customers = Array.from({ length: numCustomers }).map((_) => {
        const utility = pick(UTIL_POOL);
        return {
          id: crypto.randomUUID(),
          name: utility === "FIBER" ? "Fiber Network" : utility,
          utility,
          memberCode: "USIC",              // for now, everything routes to “USIC”
          companyName: "USIC SIM MEMBER",  // synthetic operator name
          // the rest (marking/time/footage) will live in L720, not 811
        };
      });

      const payload = {
        externalSource: "SIM_811",
        ticketId,
        ticketNumber,
        ticketType,
        areaId: aId,
        address: `${addressLine1}, ${city}, TX ${ZIP_BY_CITY[aId]}`,
        lat,
        lng,
        scope,
        workType,
        contractor: contractorName,
        contractorPhone,
        contactName,
        contactEmail,
        markingInstructions,
        customers,
        // Lineage echoed into payload so downstream L720 ingestion can map without
        // depending on raw DB columns. Originals self-root: root is self, parent
        // is null, seq=1. "Original" is a lineage concept, not a ticket type.
        rootTicketId: ticketId,
        parentTicketId: null,
        sequenceNumber: 1,
        externalRootNumber: ticketNumber,
      };

      insertTicketRow(insertTicket, {
        id: ticketId,
        ticketNumber,
        ticketType,
        status: "NEW",
        version: 1,
        areaId: aId,
        createdAt: nowMs,
        updatedAt: nowMs,
        dueAt,
        addressLine1,
        city,
        state: "TX",
        zip: ZIP_BY_CITY[aId],
        lat,
        lng,
        workType,
        markingInstructions,
        contractorName,
        contractorPhone,
        contactName,
        contactEmail,
        payloadJson: JSON.stringify(payload),
        rootTicketId: ticketId,
        parentTicketId: null,
        sequenceNumber: 1,
        externalRootNumber: ticketNumber,
      });

      for (const c of customers) {
        insertMember.run({
          id: crypto.randomUUID(),
          ticket_id: ticketId,
          member_code: c.memberCode,
          utility_type: c.utility,
          company_name: c.companyName,
          status: "OPEN",
        });
      }

      insertEvent(ticketId, "CREATED", { ticketType, dueAt, areaId: aId });
      createdIds.push(ticketId);
    }
  });

  tx();
  return createdIds;
}

/**
 * Create a new ticket linked to an existing root ticket.
 *
 * BUSINESS RULE: the linked ticket is a brand-new operational ticket. It
 * inherits static context from the root (address, contractor, customers, work
 * type) but has its own id, ticket_number, sequence_number, status, due_at,
 * and will accrue its own time/footage/notes/photos downstream. Linkage is
 * purely for history/visibility — never for merging productivity or billing.
 *
 * 811 RULE: UPDATE and UPDATE_REMARK may only be generated against a chain
 * whose root is a NORMAL ticket. RECALL and NO_RESPONSE may attach to any
 * original type (NORMAL, EMERGENCY, DIGUP, NON_COMPLIANT).
 *
 * rootTicketId may reference the original OR any linked ticket in the chain;
 * the real root is resolved via tickets_811.root_ticket_id.
 */
export function createLinkedTicket(params: {
  rootTicketId: string;
  type: Exclude<TicketType, "NORMAL" | "EMERGENCY" | "DIGUP" | "NON_COMPLIANT">;
  overrides?: {
    markingInstructions?: string;
    dueAt?: number;
    additionalNotes?: string;
    urgent?: boolean;
  };
}): string {
  const { rootTicketId: requestedRootId, type, overrides = {} } = params;

  const requested = db
    .prepare(`SELECT * FROM tickets_811 WHERE id = ?`)
    .get(requestedRootId) as any;
  if (!requested) {
    throw new Error(`Cannot create linked ticket: root ${requestedRootId} not found`);
  }

  // Resolve actual chain root. If caller passed a linked ticket id, climb to its root.
  const rootId: string = requested.root_ticket_id || requested.id;
  const rootRow = rootId === requested.id
    ? requested
    : (db.prepare(`SELECT * FROM tickets_811 WHERE id = ?`).get(rootId) as any);
  if (!rootRow) {
    throw new Error(`Chain root ${rootId} not found for ticket ${requestedRootId}`);
  }

  // Enforce 811 rule: UPDATE / UPDATE_REMARK require a NORMAL root.
  if (NORMAL_ROOT_ONLY_LINKED_TYPES.includes(type as any)) {
    if (rootRow.ticket_type !== "NORMAL") {
      throw new Error(
        `${type} tickets may only be generated against a NORMAL original (root is ${rootRow.ticket_type})`,
      );
    }
  }

  const nowMs = Date.now();
  const sequenceNumber = getNextSequenceNumber(rootId);
  const externalRootNumber: string = rootRow.external_root_number || rootRow.ticket_number;
  const ticketNumber = makeLinkedTicketNumber(externalRootNumber, sequenceNumber);
  const newTicketId = crypto.randomUUID();

  // Inherit static job context from root.
  const rootPayload = (() => {
    try { return JSON.parse(rootRow.payload_json || "{}"); } catch { return {}; }
  })();

  const aId: AreaId = rootRow.area_id as AreaId;
  const a = getAreaRow(aId);
  const dueAt = Math.floor(overrides.dueAt ?? dueAtFor(type, nowMs));
  const markingInstructions = overrides.markingInstructions ?? rootRow.marking_instructions;

  // Re-use root customers verbatim so operations see the same utilities but scope
  // live under the new ticket id. Fresh utility marking state must be empty —
  // L720 will allocate time/footage against THIS ticket only.
  const rootCustomers: Array<{ id: string; name: string; utility: UtilityType; memberCode: string; companyName: string }> =
    Array.isArray(rootPayload?.customers) ? rootPayload.customers : [];
  const customers = rootCustomers.map((c) => ({
    id: crypto.randomUUID(),
    name: c.name,
    utility: c.utility,
    memberCode: c.memberCode || "USIC",
    companyName: c.companyName || "USIC SIM MEMBER",
  }));

  const scope = buildTicketScope({
    seed: `${newTicketId}:${ticketNumber}:${rootRow.work_type}:${type}`,
    centerLat: rootRow.lat,
    centerLng: rootRow.lng,
    workType: rootRow.work_type,
    ticketType: type,
    areaBounds: a,
  });

  const payload = {
    externalSource: "SIM_811",
    ticketId: newTicketId,
    ticketNumber,
    ticketType: type,
    areaId: aId,
    address: `${rootRow.address_line1}, ${rootRow.city}, ${rootRow.state} ${rootRow.zip}`,
    lat: rootRow.lat,
    lng: rootRow.lng,
    scope,
    workType: rootRow.work_type,
    contractor: rootRow.contractor_name,
    contractorPhone: rootRow.contractor_phone,
    contactName: rootRow.contact_name,
    contactEmail: rootRow.contact_email,
    markingInstructions,
    customers,
    // Lineage — root is always the chain's original (head). parent is the
    // ticket this one was spawned from.
    rootTicketId: rootId,
    parentTicketId: requested.id,
    sequenceNumber,
    externalRootNumber,
    urgent: overrides.urgent === true,
    additionalNotes: overrides.additionalNotes || undefined,
  };

  const insertTicket = insertTicketStmt();
  const insertMember = insertMemberStmt();

  const tx = db.transaction(() => {
    insertTicketRow(insertTicket, {
      id: newTicketId,
      ticketNumber,
      ticketType: type,
      status: "NEW",
      version: 1,
      areaId: aId,
      createdAt: nowMs,
      updatedAt: nowMs,
      dueAt,
      addressLine1: rootRow.address_line1,
      city: rootRow.city,
      state: rootRow.state,
      zip: rootRow.zip,
      lat: rootRow.lat,
      lng: rootRow.lng,
      workType: rootRow.work_type,
      markingInstructions,
      contractorName: rootRow.contractor_name,
      contractorPhone: rootRow.contractor_phone,
      contactName: rootRow.contact_name,
      contactEmail: rootRow.contact_email,
      payloadJson: JSON.stringify(payload),
      rootTicketId: rootId,
      parentTicketId: requested.id,
      sequenceNumber,
      externalRootNumber,
    });

    for (const c of customers) {
      insertMember.run({
        id: crypto.randomUUID(),
        ticket_id: newTicketId,
        member_code: c.memberCode,
        utility_type: c.utility,
        company_name: c.companyName,
        status: "OPEN",
      });
    }

    insertEvent(newTicketId, "CREATED", {
      ticketType: type,
      dueAt,
      areaId: aId,
      rootTicketId: rootId,
      parentTicketId: requested.id,
      sequenceNumber,
    });
    insertEvent(rootId, "LINKED_TICKET_CREATED", {
      childTicketId: newTicketId,
      childTicketNumber: ticketNumber,
      childType: type,
      sequenceNumber,
    });
  });

  tx();
  return newTicketId;
}

/**
 * Return the full ordered chain for a given ticket (original + all linked
 * descendants), sorted by sequence_number, created_at. Safe to call with any
 * member of the chain.
 */
export function getTicketChain(anyTicketId: string): any[] {
  const anchor = db
    .prepare(`SELECT root_ticket_id FROM tickets_811 WHERE id = ?`)
    .get(anyTicketId) as { root_ticket_id?: string } | undefined;
  if (!anchor) return [];
  const rootId = anchor.root_ticket_id || anyTicketId;
  return db
    .prepare(
      `SELECT * FROM tickets_811
       WHERE root_ticket_id = ?
       ORDER BY sequence_number ASC, created_at ASC`,
    )
    .all(rootId) as any[];
}
