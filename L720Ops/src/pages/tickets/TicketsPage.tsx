import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { OpsService } from "../../services/opsService";
import { TicketsService } from "../../services/ticketsService";
import { getDueUrgencyBucket, getDueUrgencyTailwind, getDueUrgencyColor, DUE_URGENCY_LABELS } from "../../utils/dueUrgency";
import { RescheduleModal } from "../../components/RescheduleModal";
import {
  DataTable,
  type DataTableColumn,
  Drawer,
  PageHeader,
  StatusBadge,
  formatDuration,
} from "../../components/ui";
import { AssignTechMenu } from "../../components/features/AssignTechMenu";
import type { TicketDetailResponse, TicketListRow } from "../../types/ops";
import { formatTicketType } from "../../types/ticket";
import { ArrowDownTrayIcon } from "@heroicons/react/24/outline";

const LOCATOR_STATUSES = ["ASSIGNED", "ENROUTE", "ONSITE", "PAUSED", "CLOSED", "UNABLE"];
// 811-standard ticket types (original-eligible + linked/derived).
const TICKET_TYPES = ["NORMAL", "EMERGENCY", "DIGUP", "NON_COMPLIANT", "UPDATE", "UPDATE_REMARK", "RECALL", "NO_RESPONSE"];
const AREAS = ["ROYSE_CITY", "ROCKWALL", "FATE"];

export function TicketsPage() {
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showReschedule, setShowReschedule] = useState(false);

  const filters = {
    search: params.get("search") || "",
    locatorStatus: params.get("locatorStatus") || "",
    ticketType: params.get("ticketType") || "",
    areaId: params.get("areaId") || "",
    unassigned: params.get("unassigned") === "true",
    page: parseInt(params.get("page") || "1", 10),
  };

  const setFilter = (key: string, value: string | number | boolean | null) => {
    const next = new URLSearchParams(params);
    if (value === null || value === "" || value === false) next.delete(key);
    else next.set(key, String(value));
    if (key !== "page") next.delete("page");
    setParams(next, { replace: true });
  };

  const listQuery = useQuery({
    queryKey: ["ops", "tickets", "list", filters],
    queryFn: () =>
      OpsService.getTickets({
        search: filters.search || undefined,
        locatorStatus: filters.locatorStatus || undefined,
        ticketType: filters.ticketType || undefined,
        areaId: filters.areaId || undefined,
        unassigned: filters.unassigned ? "true" : undefined,
        page: filters.page,
        limit: 50,
      }),
    refetchInterval: 30000,
    refetchOnWindowFocus: true,
  });

  const detailQuery = useQuery({
    queryKey: ["ops", "ticket-detail", selectedId],
    queryFn: () => OpsService.getTicket(selectedId!),
    enabled: Boolean(selectedId),
  });

  const assignMutation = useMutation({
    mutationFn: ({ ticketId, techId }: { ticketId: string; techId: string | null }) =>
      OpsService.assignTicket(ticketId, techId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ops", "tickets"] });
      qc.invalidateQueries({ queryKey: ["ops", "ticket-detail", selectedId] });
    },
    onError: (err: Error) => {
      window.alert(`Reassignment failed: ${err.message}`);
    },
  });

  const bulkAssignMutation = useMutation({
    mutationFn: ({ ticketIds, techId }: { ticketIds: string[]; techId: string | null }) =>
      OpsService.bulkAssign(ticketIds, techId),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["ops", "tickets"] });
      const failed = data.results.filter((r) => !r.ok);
      if (failed.length > 0) {
        window.alert(
          `${data.results.length - failed.length} assigned, ${failed.length} skipped:\n\n` +
            failed
              .map((r) => `- ${r.ticketId.slice(0, 8)}: ${r.error}`)
              .join("\n"),
        );
      }
      setSelected(new Set());
    },
    onError: (err: Error) => {
      window.alert(`Bulk assign failed: ${err.message}`);
    },
  });

  const handleExport = async () => {
    const blob = await OpsService.exportTicketsCsv({
      search: filters.search || undefined,
      locatorStatus: filters.locatorStatus || undefined,
      ticketType: filters.ticketType || undefined,
      areaId: filters.areaId || undefined,
      unassigned: filters.unassigned ? "true" : undefined,
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `tickets-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const columns = useMemo<DataTableColumn<TicketListRow>[]>(
    () => [
      {
        key: "sel",
        header: (
          <input
            type="checkbox"
            checked={
              Boolean(listQuery.data?.tickets.length) &&
              listQuery.data!.tickets.every((t) => selected.has(t.id))
            }
            onChange={(e) => {
              const all = listQuery.data?.tickets.map((t) => t.id) || [];
              setSelected(e.target.checked ? new Set(all) : new Set());
            }}
          />
        ),
        render: (t) => (
          <input
            type="checkbox"
            checked={selected.has(t.id)}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => {
              const next = new Set(selected);
              if (e.target.checked) next.add(t.id);
              else next.delete(t.id);
              setSelected(next);
            }}
          />
        ),
      },
      {
        key: "number",
        header: "Ticket",
        render: (t) => (
          <div>
            <div className="font-medium text-gray-900">{t.ticketNumber}</div>
            <div className="text-xs text-gray-500 truncate max-w-xs">
              {t.address}
            </div>
          </div>
        ),
      },
      { key: "type", header: "Type", render: (t) => <StatusBadge value={t.ticketType} label={formatTicketType(t.ticketType)} /> },
      {
        key: "status",
        header: "Status",
        render: (t) => <StatusBadge value={t.locatorStatus} />,
      },
      {
        key: "tech",
        header: "Tech",
        render: (t) =>
          t.assignedTech ? (
            <div>
              <div className="text-sm text-gray-900">{t.assignedTech.name}</div>
              <div className="text-xs text-gray-500">{t.assignedTech.areaId}</div>
            </div>
          ) : (
            <span className="text-xs text-yellow-700 font-medium">Unassigned</span>
          ),
      },
      {
        key: "source",
        header: "Source",
        render: (t) => <StatusBadge value={t.source} />,
      },
      {
        key: "due",
        header: "Due",
        render: (t) =>
          t.dueAt ? (
            <div className="flex items-center gap-2">
              <span
                className="w-2 h-2 rounded-full flex-shrink-0"
                style={{ backgroundColor: getDueUrgencyColor(t.dueAt) }}
              />
              <span className="text-xs text-gray-600">
                {new Date(t.dueAt).toLocaleDateString()}
              </span>
              <span className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${getDueUrgencyTailwind(t.dueAt)}`}>
                {DUE_URGENCY_LABELS[getDueUrgencyBucket(t.dueAt)]}
              </span>
            </div>
          ) : (
            <span className="text-xs text-gray-400">—</span>
          ),
      },
      {
        key: "updated",
        header: "Updated",
        align: "right",
        render: (t) => (
          <span className="text-xs text-gray-500">
            {new Date(t.updatedAt).toLocaleString()}
          </span>
        ),
      },
      {
        key: "actions",
        header: "Actions",
        align: "right",
        render: (t) => (
          <button
            onClick={(e) => {
              e.stopPropagation();
              setSelectedId(t.id);
              setShowReschedule(true);
            }}
            className="text-xs font-medium text-blue-600 hover:text-blue-800"
          >
            Reschedule
          </button>
        ),
      },
    ],
    [listQuery.data, selected],
  );

  const detail = detailQuery.data;
  const [bulkTechId, setBulkTechId] = useState<string | null>(null);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Tickets"
        subtitle={
          listQuery.data
            ? `${listQuery.data.pagination.total.toLocaleString()} total`
            : ""
        }
        actions={
          <button
            onClick={handleExport}
            className="inline-flex items-center gap-2 bg-white border border-gray-200 text-sm px-3 py-2 rounded-md hover:bg-gray-50"
          >
            <ArrowDownTrayIcon className="h-4 w-4" />
            Export CSV
          </button>
        }
      />

      <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-4 flex flex-wrap gap-3">
        <input
          type="search"
          placeholder="Search ticket # or address"
          value={filters.search}
          onChange={(e) => setFilter("search", e.target.value)}
          className="flex-1 min-w-[240px] px-3 py-2 border border-gray-300 rounded-md text-sm"
        />
        <select
          value={filters.locatorStatus}
          onChange={(e) => setFilter("locatorStatus", e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-md text-sm"
        >
          <option value="">All Statuses</option>
          {LOCATOR_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select
          value={filters.ticketType}
          onChange={(e) => setFilter("ticketType", e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-md text-sm"
        >
          <option value="">All Types</option>
          {TICKET_TYPES.map((s) => (
            <option key={s} value={s}>
              {formatTicketType(s)}
            </option>
          ))}
        </select>
        <select
          value={filters.areaId}
          onChange={(e) => setFilter("areaId", e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-md text-sm"
        >
          <option value="">All Areas</option>
          {AREAS.map((s) => (
            <option key={s} value={s}>
              {s.replace("_", " ")}
            </option>
          ))}
        </select>
        <label className="inline-flex items-center gap-2 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={filters.unassigned}
            onChange={(e) => setFilter("unassigned", e.target.checked)}
          />
          Unassigned only
        </label>
      </div>

      {selected.size > 0 && (
        <div className="bg-blue-50 border border-blue-200 rounded-md px-4 py-3 flex items-center gap-3">
          <div className="text-sm text-blue-900 font-medium">
            {selected.size} ticket{selected.size === 1 ? "" : "s"} selected
          </div>
          <div className="flex-1" />
          <div className="w-64">
            <AssignTechMenu
              value={bulkTechId}
              onChange={setBulkTechId}
              placeholder="Select technician…"
            />
          </div>
          <button
            disabled={!bulkTechId || bulkAssignMutation.isPending}
            onClick={() =>
              bulkAssignMutation.mutate({
                ticketIds: Array.from(selected),
                techId: bulkTechId,
              })
            }
            className="bg-blue-600 text-white text-sm px-3 py-2 rounded-md hover:bg-blue-700 disabled:opacity-50"
          >
            {bulkAssignMutation.isPending ? "Assigning…" : "Assign"}
          </button>
          <button
            onClick={() => setSelected(new Set())}
            className="text-sm text-gray-600 hover:text-gray-900"
          >
            Clear
          </button>
        </div>
      )}

      <DataTable
        columns={columns}
        rows={listQuery.data?.tickets}
        rowKey={(t) => t.id}
        loading={listQuery.isLoading}
        onRowClick={(t) => setSelectedId(t.id)}
        empty={{ title: "No tickets match your filters" }}
        rowStyle={(t) =>
          t.dueAt
            ? { borderLeft: `4px solid ${getDueUrgencyColor(t.dueAt)}` }
            : undefined
        }
      />

      {listQuery.data && listQuery.data.pagination.totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-gray-600">
          <div>
            Page {listQuery.data.pagination.page} of{" "}
            {listQuery.data.pagination.totalPages}
          </div>
          <div className="flex gap-2">
            <button
              disabled={filters.page <= 1}
              onClick={() => setFilter("page", Math.max(1, filters.page - 1))}
              className="px-3 py-1 rounded border border-gray-300 disabled:opacity-50"
            >
              Prev
            </button>
            <button
              disabled={filters.page >= listQuery.data.pagination.totalPages}
              onClick={() => setFilter("page", filters.page + 1)}
              className="px-3 py-1 rounded border border-gray-300 disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </div>
      )}

      <Drawer
        open={Boolean(selectedId)}
        onClose={() => setSelectedId(null)}
        title={detail ? detail.ticketNumber : "Ticket"}
        subtitle={detail?.address}
        actions={
          detail && (
            <button
              onClick={() => setShowReschedule(true)}
              className="inline-flex items-center gap-2 bg-white border border-gray-200 text-sm px-3 py-2 rounded-md hover:bg-gray-50"
            >
              Reschedule
            </button>
          )
        }
      >
        {!detail ? (
          <div className="text-sm text-gray-500">Loading…</div>
        ) : (
          <TicketDetailBody
            detail={detail}
            onAssign={(techId) =>
              assignMutation.mutate({ ticketId: detail.id, techId })
            }
          />
        )}
      </Drawer>

      {detail && (
        <RescheduleModal
          isOpen={showReschedule}
          onClose={() => setShowReschedule(false)}
          ticketId={detail.id}
          ticketNumber={detail.ticketNumber}
          currentDueAt={detail.dueAt}
          address={detail.address}
          contractorName={(() => { try { return JSON.parse(detail.payloadJson || "{}").contractor; } catch { return undefined; } })()}
          contractorEmail={(() => { try { return JSON.parse(detail.payloadJson || "{}").contactEmail; } catch { return undefined; } })()}
          contractorPhone={(() => { try { return JSON.parse(detail.payloadJson || "{}").contractorPhone; } catch { return undefined; } })()}
        />
      )}
    </div>
  );
}

function TicketDetailBody({
  detail,
  onAssign,
}: {
  detail: TicketDetailResponse;
  onAssign: (techId: string | null) => void;
}) {
  let p: any = {};
  try { p = JSON.parse(detail.payloadJson || "{}"); } catch { p = {}; }
  const scope = p.scope;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 text-sm">
        <div>
          <div className="text-xs uppercase text-gray-500">Ticket Number</div>
          <div className="font-mono text-sm text-gray-900">{detail.ticketNumber}</div>
        </div>
        <div>
          <div className="text-xs uppercase text-gray-500">Type</div>
          <StatusBadge value={detail.ticketType} label={formatTicketType(detail.ticketType)} />
        </div>
        <div>
          <div className="text-xs uppercase text-gray-500">Status</div>
          <StatusBadge value={detail.locatorStatus} />
        </div>
        <div>
          <div className="text-xs uppercase text-gray-500">Source</div>
          <div>{detail.source}</div>
        </div>
        <div>
          <div className="text-xs uppercase text-gray-500">Created</div>
          <div>{new Date(detail.createdAt).toLocaleString()}</div>
        </div>
        <div>
          <div className="text-xs uppercase text-gray-500">Due</div>
          <div className="flex items-center gap-2">
            <span>{detail.dueAt ? new Date(detail.dueAt).toLocaleString() : "—"}</span>
            {detail.dueAt && (
              <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${getDueUrgencyTailwind(detail.dueAt)}`}>
                {DUE_URGENCY_LABELS[getDueUrgencyBucket(detail.dueAt)]}
              </span>
            )}
          </div>
        </div>
        <div>
          <div className="text-xs uppercase text-gray-500">Closed</div>
          <div>
            {detail.closedAt
              ? new Date(detail.closedAt).toLocaleString()
              : "—"}
          </div>
        </div>
        <div>
          <div className="text-xs uppercase text-gray-500">Version</div>
          <div>{detail.version}</div>
        </div>
      </div>

      <div>
        <div className="text-xs uppercase text-gray-500 mb-1">Address</div>
        <div className="text-sm text-gray-900">{detail.address}</div>
        {detail.lat && detail.lng && (
          <div className="text-xs text-gray-500 mt-1">
            {detail.lat.toFixed(6)}, {detail.lng.toFixed(6)}
          </div>
        )}
      </div>

      <div>
        <div className="text-xs uppercase text-gray-500 mb-1">Assigned Tech</div>
        <AssignTechMenu
          value={detail.assignedTechId}
          onChange={onAssign}
          disabled={
            detail.locatorStatus === "CLOSED" ||
            detail.locatorStatus === "UNABLE"
          }
        />
        {(detail.locatorStatus === "CLOSED" ||
          detail.locatorStatus === "UNABLE") && (
          <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2 mt-2">
            Terminal tickets can't be reassigned. Reopen the ticket first if a
            tech needs to revisit it.
          </div>
        )}
      </div>

      <div>
        <div className="text-sm font-semibold text-gray-900 mb-2">Contractor & Work Details</div>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <div className="text-xs uppercase text-gray-500">Work Type</div>
            <div>{p.workType || "—"}</div>
          </div>
          <div>
            <div className="text-xs uppercase text-gray-500">Contractor</div>
            <div>{p.contractor || "—"}</div>
          </div>
          <div>
            <div className="text-xs uppercase text-gray-500">Contractor Phone</div>
            <div>{p.contractorPhone || "—"}</div>
          </div>
          <div>
            <div className="text-xs uppercase text-gray-500">Contact Name</div>
            <div>{p.contactName || "—"}</div>
          </div>
          <div>
            <div className="text-xs uppercase text-gray-500">Contact Email</div>
            <div>{p.contactEmail || "—"}</div>
          </div>
        </div>
        {p.markingInstructions && (
          <div className="mt-3">
            <div className="text-xs uppercase text-gray-500">Marking Instructions</div>
            <div className="text-sm text-gray-900 mt-1">{p.markingInstructions}</div>
          </div>
        )}
      </div>

      {scope && (
        <div>
          <div className="text-sm font-semibold text-gray-900 mb-2">Work Area Scope</div>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <div className="text-xs uppercase text-gray-500">Shape</div>
              <div>{scope.shape || "—"}</div>
            </div>
            <div>
              <div className="text-xs uppercase text-gray-500">Size</div>
              <div>{scope.widthFeet != null && scope.heightFeet != null ? `${scope.widthFeet} ft × ${scope.heightFeet} ft` : "—"}</div>
            </div>
            <div className="col-span-2">
              <div className="text-xs uppercase text-gray-500">Bounds (N, S, E, W)</div>
              <div className="text-xs font-mono text-gray-900">
                {scope.latMax != null ? `${scope.latMax.toFixed(6)}, ${scope.latMin?.toFixed(6)}, ${scope.lngMax?.toFixed(6)}, ${scope.lngMin?.toFixed(6)}` : "—"}
              </div>
            </div>
          </div>
        </div>
      )}

      <div>
        <div className="text-sm font-semibold text-gray-900 mb-2">811 Lineage</div>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <div className="text-xs uppercase text-gray-500">External Root #</div>
            <div>{p.externalRootNumber || detail.externalTicketId || "—"}</div>
          </div>
          <div>
            <div className="text-xs uppercase text-gray-500">Sequence #</div>
            <div>{p.sequenceNumber ?? "—"}</div>
          </div>
          <div className="col-span-2">
            <div className="text-xs uppercase text-gray-500">Root Ticket ID</div>
            <div className="text-xs font-mono text-gray-900">{p.rootTicketId || "—"}</div>
          </div>
          {p.parentTicketId && (
            <div className="col-span-2">
              <div className="text-xs uppercase text-gray-500">Parent Ticket ID</div>
              <div className="text-xs font-mono text-gray-900">{p.parentTicketId}</div>
            </div>
          )}
        </div>
      </div>

      <div>
        <div className="text-sm font-semibold text-gray-900 mb-2">Time Allocation</div>
        <div className="grid grid-cols-4 gap-3 text-center">
          <TimeBox label="Enroute" ms={detail.timeAllocation.enrouteMs} />
          <TimeBox label="Onsite" ms={detail.timeAllocation.onsiteMs} />
          <TimeBox label="Paused" ms={detail.timeAllocation.pausedMs} />
          <TimeBox label="Total" ms={detail.timeAllocation.totalMs} />
        </div>
      </div>

      <div>
        <div className="text-sm font-semibold text-gray-900 mb-2">Customers</div>
        {detail.customers.length === 0 ? (
          <div className="text-xs text-gray-500">No customer markings yet.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-500 border-b border-gray-100">
                <th className="py-2 pr-2">Customer</th>
                <th className="py-2 pr-2">Utility</th>
                <th className="py-2 pr-2">Status</th>
                <th className="py-2 pr-2">Reason / Result</th>
                <th className="py-2 pr-2 text-right">Min</th>
                <th className="py-2 pr-2 text-right">Ft</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {detail.customers.map((c) => (
                <tr key={c.customerId}>
                  <td className="py-2 pr-2">{c.customerName || "—"}</td>
                  <td className="py-2 pr-2">{c.utilityType || "—"}</td>
                  <td className="py-2 pr-2">
                    <StatusBadge value={c.status} />
                  </td>
                  <td className="py-2 pr-2 text-gray-700 text-xs font-medium">
                    {c.result ? c.result.replace(/_/g, " ") : "—"}
                  </td>
                  <td className="py-2 pr-2 text-right tabular-nums">
                    {c.minutes}
                  </td>
                  <td className="py-2 pr-2 text-right tabular-nums">
                    {c.footage}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div>
        <div className="text-sm font-semibold text-gray-900 mb-2">
          Notes ({detail.notes.length})
        </div>
        <div className="space-y-2">
          {detail.notes.map((n) => (
            <div
              key={n.id}
              className="border border-gray-100 rounded-md p-3 text-sm"
            >
              <div className="flex justify-between text-xs text-gray-500 mb-1">
                <span>
                  {n.author_name || "System"} · {n.note_type}
                </span>
                <span>{new Date(n.created_at).toLocaleString()}</span>
              </div>
              <div className="text-gray-900 whitespace-pre-wrap">{n.body}</div>
            </div>
          ))}
          {detail.notes.length === 0 && (
            <div className="text-xs text-gray-500">No notes yet.</div>
          )}
        </div>
      </div>

      <div>
        <div className="text-sm font-semibold text-gray-900 mb-2">
          Attachments ({detail.attachments.length})
        </div>
        <div className="text-xs text-gray-500">
          {detail.attachments.length === 0
            ? "No attachments."
            : detail.attachments
                .map((a) => a.file_name || a.id)
                .join(", ")}
        </div>
      </div>

      <div>
        <div className="text-sm font-semibold text-gray-900 mb-2">
          Reschedule History
        </div>
        <RescheduleHistoryPanel ticketId={detail.id} />
      </div>

      <div>
        <div className="text-sm font-semibold text-gray-900 mb-2">
          History ({detail.events.length})
        </div>
        <ol className="divide-y divide-gray-100">
          {detail.events.slice().reverse().map((e) => (
            <li key={e.id} className="py-2 text-sm">
              <div className="flex justify-between text-xs text-gray-500">
                <span>{e.type}</span>
                <span>{new Date(e.createdAt).toLocaleString()}</span>
              </div>
              <div className="text-gray-800">
                {e.oldLocatorStatus && e.newLocatorStatus && e.oldLocatorStatus !== e.newLocatorStatus
                  ? `${e.oldLocatorStatus} → ${e.newLocatorStatus}`
                  : e.notes || (e.oldLocatorStatus ? `Status: ${e.oldLocatorStatus}` : "—")}
              </div>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

function TimeBox({ label, ms }: { label: string; ms: number }) {
  return (
    <div className="bg-gray-50 rounded-md p-3">
      <div className="text-xs uppercase tracking-wide text-gray-500">
        {label}
      </div>
      <div className="text-sm font-semibold text-gray-900 tabular-nums mt-1">
        {formatDuration(ms)}
      </div>
    </div>
  );
}

function RescheduleHistoryPanel({ ticketId }: { ticketId: string }) {
  const query = useQuery({
    queryKey: ["ops", "reschedule-history", ticketId],
    queryFn: () => TicketsService.getRescheduleHistory(ticketId),
    enabled: Boolean(ticketId),
  });

  if (query.isLoading) {
    return <div className="text-xs text-gray-500">Loading...</div>;
  }
  if (query.isError || !query.data) {
    return <div className="text-xs text-gray-500">Failed to load reschedule history.</div>;
  }
  if (query.data.length === 0) {
    return <div className="text-xs text-gray-500">No reschedules recorded.</div>;
  }

  return (
    <ol className="divide-y divide-gray-100">
      {query.data.map((r) => (
        <li key={r.id} className="py-3 text-sm space-y-1">
          <div className="flex justify-between text-xs text-gray-500">
            <span className="font-medium text-gray-700">
              Rescheduled · {r.source?.replace(/_/g, " ") || "Internal"}
            </span>
            <span>{new Date(r.created_at).toLocaleString()}</span>
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div>
              <span className="text-gray-500">Previous Due: </span>
              <span className="text-gray-900">{new Date(r.previous_due_at).toLocaleString()}</span>
            </div>
            <div>
              <span className="text-gray-500">New Due: </span>
              <span className="text-gray-900">{new Date(r.new_due_at).toLocaleString()}</span>
            </div>
            {r.reason_code && (
              <div>
                <span className="text-gray-500">Reason: </span>
                <span className="text-gray-900">{r.reason_code.replace(/_/g, " ").toLowerCase()}</span>
              </div>
            )}
            {r.approval_name && (
              <div>
                <span className="text-gray-500">Approved By: </span>
                <span className="text-gray-900">{r.approval_name}</span>
              </div>
            )}
            {r.excavator_response && (
              <div>
                <span className="text-gray-500">Excavator Response: </span>
                <span className="text-gray-900">{r.excavator_response.replace(/_/g, " ").toLowerCase()}</span>
              </div>
            )}
            {r.eight_one_one_revision_state && r.eight_one_one_revision_state !== "N/A" && (
              <div>
                <span className="text-gray-500">811 Revision: </span>
                <span className="text-gray-900">{r.eight_one_one_revision_state}</span>
              </div>
            )}
          </div>
          {r.notes && (
            <div className="text-xs text-gray-700 whitespace-pre-wrap pt-1">{r.notes}</div>
          )}
        </li>
      ))}
    </ol>
  );
}
