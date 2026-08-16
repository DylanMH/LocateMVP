import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { OpsService } from "../../services/opsService";
import { AuthService } from "../../services/authService";
import { TerritoryService } from "../../services/territoryService";
import { useRange } from "../../hooks/useRange";
import { useAuth } from "../../hooks/useAuth";
import {
  DataTable,
  type DataTableColumn,
  PageHeader,
  RangeToggle,
  StatusBadge,
  formatDuration,
} from "../../components/ui";
import { CreateUserModal, EditUserModal } from "../../components/users";
import type { TechRow, User, TerritoryNode } from "../../types";

const STATUS_OPTIONS = ["CLOCKED_IN", "ON_LUNCH", "ON_PERSONAL", "CLOCKED_OUT"];

function flattenTerritories(nodes: TerritoryNode[]): TerritoryNode[] {
  const flattened: TerritoryNode[] = [];
  const visit = (node: TerritoryNode) => {
    flattened.push(node);
    node.children.forEach(visit);
  };
  nodes.forEach(visit);
  return flattened;
}

export function TechsPage() {
  const { state: range, setRange, toQuery, queryKey } = useRange("day");
  const [params, setParams] = useSearchParams();
  const queryClient = useQueryClient();
  const { user: currentUser } = useAuth();
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);

  const search = params.get("search") || "";
  const area = params.get("area") || "";
  const status = params.get("status") || "";

  const updateParam = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  const techsQuery = useQuery({
    queryKey: ["ops", "techs", "list", queryKey, search, area, status],
    queryFn: () =>
      OpsService.getTechs({
        ...toQuery(),
        search: search || undefined,
        area: area || undefined,
        status: status || undefined,
      }),
    refetchInterval: 30000,
    refetchOnWindowFocus: true,
  });

  const usersQuery = useQuery({
    queryKey: ["ops", "users", "list"],
    queryFn: () => AuthService.getUsers({ includeInactive: false }),
    refetchInterval: 60000,
  });

  const territoryTreeQuery = useQuery({
    queryKey: ["ops", "territories", "tree", "techs-page"],
    queryFn: () => TerritoryService.getTree(),
  });

  const createUserMutation = useMutation({
    mutationFn: (userData: Parameters<typeof AuthService.createUser>[0]) => AuthService.createUser(userData),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ops", "techs"] });
      queryClient.invalidateQueries({ queryKey: ["ops", "users"] });
      queryClient.invalidateQueries({ queryKey: ["ops", "territories"] });
    },
  });

  const updateUserMutation = useMutation({
    mutationFn: ({ id, updates }: { id: string; updates: Parameters<typeof AuthService.updateUser>[1] }) =>
      AuthService.updateUser(id, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ops", "techs"] });
      queryClient.invalidateQueries({ queryKey: ["ops", "users"] });
      queryClient.invalidateQueries({ queryKey: ["ops", "territories"] });
    },
  });

  const resetPasswordMutation = useMutation({
    mutationFn: ({ id, newPassword }: { id: string; newPassword: string }) =>
      AuthService.resetPassword(id, { newPassword }),
  });

  const deactivateUserMutation = useMutation({
    mutationFn: (userId: string) => AuthService.deactivateUser(userId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ops", "techs"] });
      queryClient.invalidateQueries({ queryKey: ["ops", "users"] });
      queryClient.invalidateQueries({ queryKey: ["ops", "territories"] });
    },
  });

  const flattenedTerritories = useMemo(
    () => flattenTerritories(territoryTreeQuery.data?.tree || []),
    [territoryTreeQuery.data],
  );

  const areaManagers = useMemo(() => {
    const seen = new Map<string, { id: string; name: string }>();
    flattenedTerritories
      .filter((territory) => territory.type === "AREA")
      .forEach((territory) => {
        territory.owners?.forEach((owner) => {
          if (!seen.has(owner.id)) {
            seen.set(owner.id, { id: owner.id, name: owner.name });
          }
        });
      });
    return Array.from(seen.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [flattenedTerritories]);

  const supervisors = useMemo(() => {
    const seen = new Map<string, { id: string; name: string }>();
    flattenedTerritories
      .filter((territory) => territory.type === "SUPERVISOR_TERRITORY")
      .forEach((territory) => {
        territory.owners
          ?.filter((owner) => owner.role === "SUPERVISOR")
          .forEach((owner) => {
            if (!seen.has(owner.id)) {
              seen.set(owner.id, { id: owner.id, name: owner.name });
            }
          });
      });
    return Array.from(seen.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [flattenedTerritories]);

  const territoryOptions = useMemo(
    () =>
      flattenedTerritories
        .filter((territory) => territory.type !== "DISTRICT")
        .map((territory) => ({
          id: territory.id,
          name: territory.name,
          type: territory.type,
          parentTerritoryId: territory.parentTerritoryId,
          ownerUserIds: (territory.owners || []).map((owner) => owner.id),
        })),
    [flattenedTerritories],
  );

  const territoryNameById = useMemo(
    () =>
      territoryOptions.reduce<Record<string, string>>((acc, territory) => {
        acc[territory.id] = territory.name;
        return acc;
      }, {}),
    [territoryOptions],
  );

  const areaFilterOptions = useMemo(
    () =>
      territoryOptions
        .map((territory) => ({ id: territory.id, name: territory.name }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [territoryOptions],
  );

  const editSupervisorOptions = useMemo(() => {
    const seen = new Map<string, { id: string; name: string }>();
    [...supervisors, ...areaManagers].forEach((person) => {
      if (!seen.has(person.id)) {
        seen.set(person.id, person);
      }
    });
    return Array.from(seen.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [supervisors, areaManagers]);

  const handleArchiveUser = async (userId: string) => {
    if (!confirm("Are you sure you want to archive this user? They will no longer be able to log in.")) {
      return;
    }
    try {
      await deactivateUserMutation.mutateAsync(userId);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to archive user");
    }
  };

  const handleEditUser = (tech: TechRow) => {
    const user = usersQuery.data?.users.find((u) => u.id === tech.id);
    if (user) {
      setEditingUser(user);
      setIsEditModalOpen(true);
    } else {
      alert("User data not loaded yet. Please try again in a moment.");
    }
  };

  const columns = useMemo<DataTableColumn<TechRow>[]>(
    () => [
      {
        key: "name",
        header: "Employee",
        render: (t) => (
          <div className="flex items-center gap-2">
            <div>
              <Link
                to={`/techs/${t.id}`}
                className="font-medium text-gray-900 hover:text-blue-600"
              >
                {t.name}
              </Link>
              <div className="text-xs text-gray-500">{t.email}</div>
              <div className="text-xs text-gray-400">{t.role}</div>
            </div>
            {currentUser?.role !== "TECH" && (
              <button
                onClick={() => handleEditUser(t)}
                className="text-xs text-blue-600 hover:text-blue-800 ml-2"
              >
                Edit
              </button>
            )}
          </div>
        ),
      },
      {
        key: "area",
        header: "Area",
        render: (t) => (
          <span className="text-sm text-gray-700">
            {t.areaId ? territoryNameById[t.areaId] || t.areaId : "—"}
          </span>
        ),
      },
      {
        key: "clock",
        header: "Clock",
        render: (t) => (
          <div className="flex flex-col items-start gap-1">
            <div className="flex items-center gap-1.5">
              <StatusBadge value={t.clockStatus} />
              {t.currentSession?.allocationType && (
                <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-blue-50 text-blue-700">
                  {t.currentSession.allocationType.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
                </span>
              )}
            </div>
            {t.currentSession && (
              <span className="text-xs text-gray-500 tabular-nums">
                {formatDuration(t.currentSession.elapsedMs)}
              </span>
            )}
          </div>
        ),
      },
      {
        key: "current",
        header: "Current Ticket",
        render: (t) => {
          const activeTicket = t.currentSession?.currentTicket || t.currentTicket;
          const clockOutTicket = t.currentSession?.clockOutTicket;
          if (activeTicket) {
            return (
              <div>
                <div className="text-sm font-medium text-gray-900">
                  {activeTicket.ticketNumber}
                </div>
                <StatusBadge value={activeTicket.locatorStatus} />
              </div>
            );
          }
          if (t.clockStatus === "CLOCKED_OUT" && clockOutTicket) {
            return (
              <div className="text-xs text-gray-500">
                <span className="text-gray-400">Clocked out on </span>
                <span className="font-medium text-gray-600">{clockOutTicket.ticketNumber}</span>
              </div>
            );
          }
          if (t.clockStatus === "CLOCKED_OUT") {
            return <span className="text-xs text-gray-400 italic">Non assigned</span>;
          }
          return <span className="text-xs text-gray-400">—</span>;
        },
      },
      {
        key: "board",
        header: "On Board",
        align: "right",
        render: (t) => <span className="tabular-nums">{t.ticketsOnBoard}</span>,
      },
      {
        key: "closed",
        header: "Closed (range)",
        align: "right",
        render: (t) => <span className="tabular-nums">{t.ticketsClosedInRange}</span>,
      },
      {
        key: "locates",
        header: "Locates",
        align: "right",
        render: (t) => <span className="tabular-nums">{t.locatesClosed}</span>,
      },
      {
        key: "footage",
        header: "Footage",
        align: "right",
        render: (t) => (
          <span className="tabular-nums">{t.footage.toLocaleString()}</span>
        ),
      },
      {
        key: "lph",
        header: "LPH",
        align: "right",
        render: (t) => <span className="tabular-nums">{t.lph.toFixed(1)}</span>,
      },
      {
        key: "fph",
        header: "FPH",
        align: "right",
        render: (t) => (
          <span className="tabular-nums">{Math.round(t.fph)}</span>
        ),
      },
      {
        key: "worked",
        header: "Worked",
        align: "right",
        render: (t) => (
          <span className="tabular-nums">{formatDuration(t.productiveMs)}</span>
        ),
      },
      {
        key: "actions",
        header: "",
        align: "right",
        render: (t) => (
          currentUser?.role !== "TECH" && currentUser?.id !== t.id ? (
            <button
              onClick={() => handleArchiveUser(t.id)}
              disabled={deactivateUserMutation.isPending}
              className="text-xs text-red-600 hover:text-red-800 disabled:opacity-50"
              title="Archive user"
            >
              {deactivateUserMutation.isPending ? "Archiving..." : "Archive"}
            </button>
          ) : null
        ),
      },
    ],
    [currentUser, deactivateUserMutation.isPending, territoryNameById],
  );

  return (
    <div className="space-y-4">
      <PageHeader
        title="Field Employees"
        subtitle={techsQuery.data?.range.label ?? ""}
        actions={
          <div className="flex items-center gap-3">
            {currentUser?.role !== "TECH" && (
              <button
                onClick={() => setIsCreateModalOpen(true)}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md"
              >
                Add Employee
              </button>
            )}
            <RangeToggle value={range} onChange={setRange} />
          </div>
        }
      />

      <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-4 flex flex-wrap gap-3">
        <input
          type="search"
          placeholder="Search name or email"
          value={search}
          onChange={(e) => updateParam("search", e.target.value)}
          className="flex-1 min-w-[240px] px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <select
          value={area}
          onChange={(e) => updateParam("area", e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-md text-sm"
        >
          <option value="">All Areas</option>
          {areaFilterOptions.map((option) => (
            <option key={option.id} value={option.id}>
              {option.name}
            </option>
          ))}
        </select>
        <select
          value={status}
          onChange={(e) => updateParam("status", e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-md text-sm"
        >
          <option value="">All Clock States</option>
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s.replace(/_/g, " ")}
            </option>
          ))}
        </select>
      </div>

      <DataTable
        columns={columns}
        rows={techsQuery.data?.techs}
        rowKey={(t) => t.id}
        loading={techsQuery.isLoading}
        empty={{ title: "No technicians match your filters" }}
      />

      <CreateUserModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        onCreate={createUserMutation.mutateAsync}
        territories={territoryOptions}
        supervisors={supervisors}
        areaManagers={areaManagers}
        currentUserRole={currentUser?.role || "TECH"}
      />

      <EditUserModal
        isOpen={isEditModalOpen}
        onClose={() => {
          setIsEditModalOpen(false);
          setEditingUser(null);
        }}
        onSave={updateUserMutation.mutateAsync}
        onResetPassword={resetPasswordMutation.mutateAsync}
        onDeactivate={deactivateUserMutation.mutateAsync}
        user={editingUser}
        areas={territoryOptions.map((territory) => ({ id: territory.id, name: territory.name }))}
        supervisors={editSupervisorOptions}
        currentUserRole={currentUser?.role || "TECH"}
        isLoading={updateUserMutation.isPending}
      />
    </div>
  );
}
