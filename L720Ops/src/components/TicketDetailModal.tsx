import { useEffect, useState } from "react";
import type { TicketChainRow, TicketDetail } from "../types/ticket";
import { formatTicketType, ticketTypeBadgeClass } from "../types/ticket";
import { TicketsService } from "../services/ticketsService";
import { getDueUrgencyBucket, getDueUrgencyTailwind, DUE_URGENCY_LABELS } from "../utils/dueUrgency";
import { RescheduleModal } from "./RescheduleModal";

interface TicketDetailModalProps {
  ticket: TicketDetail | null;
  isOpen: boolean;
  onClose: () => void;
}

type TicketPayloadCustomer = {
  id: string;
  name?: string;
  utility?: string;
  accountNumber?: string;
  memberCode?: string;
  companyName?: string;
};

type TicketPayloadMarking = {
  status?: string;
  result?: string;
  minutes?: string | number;
  footage?: string | number;
  completed?: boolean;
  notes?: string;
};

type TicketPayloadScope = {
  shape?: string;
  centerLat?: number;
  centerLng?: number;
  latMin?: number;
  latMax?: number;
  lngMin?: number;
  lngMax?: number;
  widthFeet?: number;
  heightFeet?: number;
};

type TicketPayload = {
  externalSource?: string;
  workType?: string;
  contractor?: string;
  contractorPhone?: string;
  contactName?: string;
  contactEmail?: string;
  markingInstructions?: string;
  scope?: TicketPayloadScope;
  enrouteStartedAt?: number;
  enrouteEndedAt?: number;
  onsiteStartedAt?: number;
  onsiteEndedAt?: number;
  closedAt?: number;
  closedByName?: string;
  closedByUserId?: string;
  customers?: TicketPayloadCustomer[];
  customerMarking?: Record<string, TicketPayloadMarking>;
  customerMarkings?: Record<string, TicketPayloadMarking>;
  rootTicketId?: string;
  parentTicketId?: string | null;
  sequenceNumber?: number;
  externalRootNumber?: string;
};

const formatDuration = (millis: number): string => {
  const totalMinutes = Math.floor(millis / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }

  return `${minutes}m`;
};

const formatDateTime = (value?: number | null) => {
  if (!value) return "N/A";
  return new Date(value).toLocaleString();
};

const parseNumber = (value: string | number | undefined) => {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
};

const parsePayload = (payloadJson: string): TicketPayload => {
  try {
    return JSON.parse(payloadJson || "{}");
  } catch {
    return {};
  }
};

/**
 * Lineage / chain panel. Each row is still an independent operational
 * ticket \u2014 the totals here are per-ticket and never aggregated across the
 * chain (see docs/linked-tickets-architecture.md).
 */
function TicketChainPanel({ ticketId }: { ticketId: string }) {
  const [rows, setRows] = useState<TicketChainRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setRows(null);
    setError(null);
    TicketsService.getTicketChain(ticketId)
      .then((data) => {
        if (!cancelled) setRows(data);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [ticketId]);

  if (error) {
    return <div className="text-sm text-red-600">Failed to load chain: {error}</div>;
  }
  if (!rows) {
    return <div className="text-sm text-gray-500">Loading chain...</div>;
  }
  if (rows.length <= 1) {
    return (
      <div className="text-sm text-gray-500">
        This ticket has no linked history.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-gray-200 text-sm">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-3 py-2 text-left font-medium text-gray-500">#</th>
            <th className="px-3 py-2 text-left font-medium text-gray-500">Type</th>
            <th className="px-3 py-2 text-left font-medium text-gray-500">Ticket</th>
            <th className="px-3 py-2 text-left font-medium text-gray-500">Tech</th>
            <th className="px-3 py-2 text-left font-medium text-gray-500">Status</th>
            <th className="px-3 py-2 text-right font-medium text-gray-500">Minutes</th>
            <th className="px-3 py-2 text-right font-medium text-gray-500">Footage</th>
          </tr>
        </thead>
        <tbody className="bg-white divide-y divide-gray-200">
          {rows.map((r) => (
            <tr key={r.id} className={r.id === ticketId ? "bg-primary-50" : ""}>
              <td className="px-3 py-2 text-gray-900">{r.sequenceNumber}</td>
              <td className="px-3 py-2 text-gray-900">{r.ticketType}</td>
              <td className="px-3 py-2 font-mono text-gray-900">{r.ticketNumber}</td>
              <td className="px-3 py-2 text-gray-900">
                {r.assignedTech?.name || "Unassigned"}
              </td>
              <td className="px-3 py-2 text-gray-900">{r.locatorStatus}</td>
              <td className="px-3 py-2 text-right text-gray-900">{r.minutes}</td>
              <td className="px-3 py-2 text-right text-gray-900">{r.footage}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-xs text-gray-500 italic">
        Each row is an independent operational ticket. Minutes and footage stay
        with the ticket where the tech captured them \u2014 never summed across the chain.
      </p>
    </div>
  );
}

export function TicketDetailModal({ ticket, isOpen, onClose }: TicketDetailModalProps) {
  const [showReschedule, setShowReschedule] = useState(false);

  if (!ticket || !isOpen) return null;

  const payload = parsePayload(ticket.payloadJson);
  const customerMarking = payload.customerMarking || payload.customerMarkings || {};
  const customers = payload.customers || [];
  const effectiveEndTime = payload.closedAt || payload.onsiteEndedAt || Date.now();
  const enrouteMillis = payload.enrouteStartedAt
    ? Math.max(0, (payload.enrouteEndedAt || effectiveEndTime) - payload.enrouteStartedAt)
    : 0;
  const onsiteMillis = payload.onsiteStartedAt
    ? Math.max(0, effectiveEndTime - payload.onsiteStartedAt)
    : 0;
  const totalAllocatedMinutes = Object.values(customerMarking).reduce(
    (sum, marking) => sum + parseNumber(marking.minutes),
    0,
  );
  const totalFootage = Object.values(customerMarking).reduce(
    (sum, marking) => sum + parseNumber(marking.footage),
    0,
  );
  const completedUtilities = Object.values(customerMarking).filter(
    (marking) => Boolean(marking.completed),
  ).length;

  return (
    <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50">
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-y-auto">
          {/* Header */}
          <div className="bg-white px-6 py-4 border-b border-gray-200 sm:px-6">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-medium text-gray-900">
                Ticket Details: {ticket.ticketNumber}
              </h3>
              <button
                onClick={onClose}
                className="text-gray-400 hover:text-gray-500 focus:outline-none"
              >
                <span className="sr-only">Close</span>
                <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          <div className="px-6 py-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-4">
                <div>
                  <h4 className="text-sm font-medium text-gray-900">Basic Information</h4>
                  <dl className="mt-2 space-y-2">
                    <div className="flex justify-between">
                      <dt className="text-sm text-gray-500">Ticket Number:</dt>
                      <dd className="text-sm font-medium text-gray-900">{ticket.ticketNumber}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-sm text-gray-500">Type:</dt>
                      <dd className="text-sm font-medium text-gray-900">
                        <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${ticketTypeBadgeClass(ticket.ticketType)}`}>
                          {formatTicketType(ticket.ticketType)}
                        </span>
                      </dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-sm text-gray-500">Status:</dt>
                      <dd className="text-sm font-medium text-gray-900">
                        <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                          ticket.status === "OPEN"
                            ? "bg-yellow-100 text-yellow-800"
                            : ticket.status === "ASSIGNED"
                              ? "bg-blue-100 text-blue-800"
                              : ticket.status === "EN_ROUTE"
                                ? "bg-purple-100 text-purple-800"
                                : ticket.status === "ONSITE"
                                  ? "bg-green-100 text-green-800"
                                  : ticket.status === "CLOSED"
                                    ? "bg-gray-100 text-gray-800"
                                    : "bg-red-100 text-red-800"
                        }`}>
                          {ticket.status}
                        </span>
                      </dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-sm text-gray-500">Locator Status:</dt>
                      <dd className="text-sm font-medium text-gray-900">
                        <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                          ticket.locatorStatus === "ASSIGNED"
                            ? "bg-blue-100 text-blue-800"
                            : ticket.locatorStatus === "ENROUTE"
                              ? "bg-purple-100 text-purple-800"
                              : ticket.locatorStatus === "ONSITE"
                                ? "bg-green-100 text-green-800"
                                : ticket.locatorStatus === "CLOSED"
                                  ? "bg-gray-100 text-gray-800"
                                  : "bg-red-100 text-red-800"
                        }`}>
                          {ticket.locatorStatus}
                        </span>
                      </dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-sm text-gray-500">Address:</dt>
                      <dd className="text-sm font-medium text-gray-900">{ticket.address}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-sm text-gray-500">Assigned Tech:</dt>
                      <dd className="text-sm font-medium text-gray-900">
                        {ticket.assignedTech?.name || "Unassigned"}
                      </dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-sm text-gray-500">Area:</dt>
                      <dd className="text-sm font-medium text-gray-900">
                        {ticket.areaId || ticket.assignedTech?.areaId || "N/A"}
                      </dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-sm text-gray-500">Source:</dt>
                      <dd className="text-sm font-medium text-gray-900">{ticket.source}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-sm text-gray-500">Priority:</dt>
                      <dd className="text-sm font-medium text-gray-900">{ticket.priority}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-sm text-gray-500">Version:</dt>
                      <dd className="text-sm font-medium text-gray-900">{ticket.version}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-sm text-gray-500">External 811 ID:</dt>
                      <dd className="text-sm font-medium text-gray-900">{ticket.externalTicketId || "N/A"}</dd>
                    </div>
                  </dl>
                </div>

                <div>
                  <h4 className="text-sm font-medium text-gray-900">Ticket Timing</h4>
                  <dl className="mt-2 space-y-2">
                    <div className="flex justify-between">
                      <dt className="text-sm text-gray-500">Enroute Time:</dt>
                      <dd className="text-sm font-medium text-gray-900">{formatDuration(enrouteMillis)}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-sm text-gray-500">Onsite Time:</dt>
                      <dd className="text-sm font-medium text-gray-900">{formatDuration(onsiteMillis)}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-sm text-gray-500">Allocatable Minutes:</dt>
                      <dd className="text-sm font-medium text-gray-900">{Math.floor(onsiteMillis / 60000)} minutes</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-sm text-gray-500">Enroute Started:</dt>
                      <dd className="text-sm font-medium text-gray-900">{formatDateTime(payload.enrouteStartedAt)}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-sm text-gray-500">Onsite Started:</dt>
                      <dd className="text-sm font-medium text-gray-900">{formatDateTime(payload.onsiteStartedAt)}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-sm text-gray-500">Closed:</dt>
                      <dd className="text-sm font-medium text-gray-900">{formatDateTime(payload.closedAt)}</dd>
                    </div>
                  </dl>
                </div>

                <div>
                  <h4 className="text-sm font-medium text-gray-900">Mobile App Status</h4>
                  <dl className="mt-2 space-y-2">
                    <div className="flex justify-between">
                      <dt className="text-sm text-gray-500">Utilities Completed:</dt>
                      <dd className="text-sm font-medium text-gray-900">{completedUtilities} / {customers.length || Object.keys(customerMarking).length}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-sm text-gray-500">Total Time Allocated:</dt>
                      <dd className="text-sm font-medium text-gray-900">{totalAllocatedMinutes} minutes</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-sm text-gray-500">Total Footage Allocated:</dt>
                      <dd className="text-sm font-medium text-gray-900">{totalFootage.toFixed(1)} ft</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-sm text-gray-500">Closed By:</dt>
                      <dd className="text-sm font-medium text-gray-900">{payload.closedByName || "N/A"}</dd>
                    </div>
                  </dl>
                </div>

                <div>
                  <h4 className="text-sm font-medium text-gray-900">Timestamps</h4>
                  <dl className="mt-2 space-y-2">
                    <div className="flex justify-between">
                      <dt className="text-sm text-gray-500">Created:</dt>
                      <dd className="text-sm font-medium text-gray-900">
                        {formatDateTime(ticket.createdAt)}
                      </dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-sm text-gray-500">Last Updated:</dt>
                      <dd className="text-sm font-medium text-gray-900">
                        {formatDateTime(ticket.updatedAt)}
                      </dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-sm text-gray-500">Due Date:</dt>
                      <dd className="flex items-center gap-2 text-sm font-medium text-gray-900">
                        {formatDateTime(ticket.dueAt)}
                        {ticket.dueAt && (
                          <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${getDueUrgencyTailwind(ticket.dueAt)}`}>
                            {DUE_URGENCY_LABELS[getDueUrgencyBucket(ticket.dueAt)]}
                          </span>
                        )}
                      </dd>
                    </div>
                  </dl>
                </div>
              </div>

              <div className="space-y-4">
                <div>
                  <h4 className="text-sm font-medium text-gray-900">Location</h4>
                  <dl className="mt-2 space-y-2">
                    <div className="flex justify-between">
                      <dt className="text-sm text-gray-500">Coordinates:</dt>
                      <dd className="text-sm font-medium text-gray-900">
                        {ticket.lat && ticket.lng ? `${ticket.lat.toFixed(6)}, ${ticket.lng.toFixed(6)}` : "N/A"}
                      </dd>
                    </div>
                  </dl>
                </div>

                <div>
                  <h4 className="text-sm font-medium text-gray-900">Work Area Scope</h4>
                  <dl className="mt-2 space-y-2">
                    {payload.scope ? (
                      <>
                        <div className="flex justify-between">
                          <dt className="text-sm text-gray-500">Shape:</dt>
                          <dd className="text-sm font-medium text-gray-900">{payload.scope.shape || "N/A"}</dd>
                        </div>
                        <div className="flex justify-between">
                          <dt className="text-sm text-gray-500">Center:</dt>
                          <dd className="text-sm font-medium text-gray-900">
                            {payload.scope.centerLat != null && payload.scope.centerLng != null
                              ? `${payload.scope.centerLat.toFixed(6)}, ${payload.scope.centerLng.toFixed(6)}`
                              : "N/A"}
                          </dd>
                        </div>
                        <div className="flex justify-between">
                          <dt className="text-sm text-gray-500">Bounds (N/S/E/W):</dt>
                          <dd className="text-sm font-medium text-gray-900">
                            {payload.scope.latMax != null
                              ? `${payload.scope.latMax.toFixed(6)}, ${payload.scope.latMin?.toFixed(6)}, ${payload.scope.lngMax?.toFixed(6)}, ${payload.scope.lngMin?.toFixed(6)}`
                              : "N/A"}
                          </dd>
                        </div>
                        <div className="flex justify-between">
                          <dt className="text-sm text-gray-500">Width:</dt>
                          <dd className="text-sm font-medium text-gray-900">{payload.scope.widthFeet != null ? `${payload.scope.widthFeet} ft` : "N/A"}</dd>
                        </div>
                        <div className="flex justify-between">
                          <dt className="text-sm text-gray-500">Height:</dt>
                          <dd className="text-sm font-medium text-gray-900">{payload.scope.heightFeet != null ? `${payload.scope.heightFeet} ft` : "N/A"}</dd>
                        </div>
                      </>
                    ) : (
                      <div className="text-sm text-gray-500">No scope data available.</div>
                    )}
                  </dl>
                </div>

                <div>
                  <h4 className="text-sm font-medium text-gray-900">811 Lineage</h4>
                  <dl className="mt-2 space-y-2">
                    <div className="flex justify-between">
                      <dt className="text-sm text-gray-500">External Source:</dt>
                      <dd className="text-sm font-medium text-gray-900">{payload.externalSource || ticket.source || "N/A"}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-sm text-gray-500">External Root #:</dt>
                      <dd className="text-sm font-medium text-gray-900">{ticket.externalRootNumber || payload.externalRootNumber || "N/A"}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-sm text-gray-500">Sequence #:</dt>
                      <dd className="text-sm font-medium text-gray-900">{ticket.sequenceNumber ?? payload.sequenceNumber ?? "N/A"}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-sm text-gray-500">Root Ticket ID:</dt>
                      <dd className="text-sm font-mono text-gray-900 text-xs">{ticket.rootTicketId || payload.rootTicketId || "N/A"}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-sm text-gray-500">Parent Ticket ID:</dt>
                      <dd className="text-sm font-mono text-gray-900 text-xs">{ticket.parentTicketId || payload.parentTicketId || "N/A"}</dd>
                    </div>
                  </dl>
                </div>

                <div>
                  <h4 className="text-sm font-medium text-gray-900">Contractor & Work Details</h4>
                  <dl className="mt-2 space-y-2">
                    <div className="flex justify-between">
                      <dt className="text-sm text-gray-500">Work Type:</dt>
                      <dd className="text-sm font-medium text-gray-900">{payload.workType || "N/A"}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-sm text-gray-500">Contractor:</dt>
                      <dd className="text-sm font-medium text-gray-900">{payload.contractor || "N/A"}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-sm text-gray-500">Contractor Phone:</dt>
                      <dd className="text-sm font-medium text-gray-900">{payload.contractorPhone || "N/A"}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-sm text-gray-500">Contact Name:</dt>
                      <dd className="text-sm font-medium text-gray-900">{payload.contactName || "N/A"}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-sm text-gray-500">Contact Email:</dt>
                      <dd className="text-sm font-medium text-gray-900">{payload.contactEmail || "N/A"}</dd>
                    </div>
                    <div>
                      <dt className="text-sm text-gray-500">Marking Instructions:</dt>
                      <dd className="text-sm font-medium text-gray-900 mt-1">{payload.markingInstructions || "N/A"}</dd>
                    </div>
                  </dl>
                </div>

                <div>
                  <h4 className="text-sm font-medium text-gray-900">Utilities on Ticket</h4>
                  <div className="mt-2 space-y-3">
                    {customers.length === 0 ? (
                      <div className="text-sm text-gray-500">No utilities found on this ticket.</div>
                    ) : (
                      customers.map((customer) => {
                        const marking = customerMarking[customer.id] || {};
                        const minutes = parseNumber(marking.minutes);
                        const footage = parseNumber(marking.footage);

                        return (
                          <div key={customer.id} className="border border-gray-200 rounded-lg p-3 bg-gray-50">
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                              <div>
                                <div className="text-xs text-gray-500">Utility Company</div>
                                <div className="text-sm font-medium text-gray-900">{customer.name || "N/A"}</div>
                              </div>
                              <div>
                                <div className="text-xs text-gray-500">Utility Type</div>
                                <div className="text-sm font-medium text-gray-900">{customer.utility || "N/A"}</div>
                              </div>
                              <div>
                                <div className="text-xs text-gray-500">Member Code</div>
                                <div className="text-sm font-medium text-gray-900">{customer.memberCode || "N/A"}</div>
                              </div>
                              <div>
                                <div className="text-xs text-gray-500">Company Name</div>
                                <div className="text-sm font-medium text-gray-900">{customer.companyName || "N/A"}</div>
                              </div>
                              <div>
                                <div className="text-xs text-gray-500">Account</div>
                                <div className="text-sm font-medium text-gray-900">{customer.accountNumber || "N/A"}</div>
                              </div>
                              <div>
                                <div className="text-xs text-gray-500">Mobile Status</div>
                                <div className="text-sm font-medium text-gray-900">
                                  <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                                    marking.status === "MARKED"
                                      ? "bg-green-100 text-green-800"
                                      : marking.status === "NOT_MARKED"
                                        ? "bg-red-100 text-red-800"
                                        : marking.status === "NOT_YET_MARKED"
                                          ? "bg-yellow-100 text-yellow-800"
                                          : "bg-gray-100 text-gray-800"
                                  }`}>
                                    {marking.status || "NOT_STARTED"}
                                  </span>
                                </div>
                              </div>
                              <div>
                                <div className="text-xs text-gray-500">Time Allocated</div>
                                <div className="text-sm font-medium text-gray-900">{minutes} minutes{minutes > 0 ? ` (${formatDuration(minutes * 60000)})` : ""}</div>
                              </div>
                              <div>
                                <div className="text-xs text-gray-500">Footage Allocated</div>
                                <div className="text-sm font-medium text-gray-900">{footage.toFixed(1)} ft</div>
                              </div>
                              <div>
                                <div className="text-xs text-gray-500">Closed</div>
                                <div className="text-sm font-medium text-gray-900">{marking.completed ? "Yes" : "No"}</div>
                              </div>
                              <div>
                                <div className="text-xs text-gray-500">Result</div>
                                <div className="text-sm font-medium text-gray-900">{marking.result ? marking.result.replace(/_/g, " ") : "N/A"}</div>
                              </div>
                            </div>
                            {marking.notes && (
                              <div className="mt-3 pt-3 border-t border-gray-200">
                                <div className="text-xs text-gray-500">Notes</div>
                                <div className="text-sm font-medium text-gray-900">{marking.notes}</div>
                              </div>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="px-6 pb-4">
            <h4 className="text-sm font-medium text-gray-900 mb-2">
              Ticket Chain{ticket.externalRootNumber ? ` \u2014 ${ticket.externalRootNumber}` : ""}
            </h4>
            <TicketChainPanel ticketId={ticket.id} />
          </div>

          <div className="bg-gray-50 px-6 py-3 sm:flex sm:flex-row-reverse sm:px-6">
            <button
              type="button"
              className="w-full inline-flex justify-center rounded-md border border-transparent shadow-sm px-4 py-2 bg-primary-600 text-base font-medium text-white hover:bg-primary-700 focus:outline-none sm:ml-0 sm:w-auto sm:text-sm"
              onClick={onClose}
            >
              Close
            </button>
            <button
              type="button"
              className="mt-3 w-full inline-flex justify-center rounded-md border border-gray-300 shadow-sm px-4 py-2 bg-white text-base font-medium text-gray-700 hover:bg-gray-50 focus:outline-none sm:mt-0 sm:mr-3 sm:w-auto sm:text-sm"
              onClick={() => setShowReschedule(true)}
            >
              Reschedule
            </button>
          </div>
        </div>
      </div>

      <RescheduleModal
        isOpen={showReschedule}
        onClose={() => setShowReschedule(false)}
        ticketId={ticket.id}
        ticketNumber={ticket.ticketNumber}
        currentDueAt={ticket.dueAt}
        contractorName={payload.contractor || payload.contractorName}
        contractorEmail={payload.contactEmail || payload.contact_email}
        address={ticket.address}
      />
    </div>
  );
}
