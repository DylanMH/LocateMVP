import { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { TerritoryService } from "../../services/territoryService";
import { AuthService } from "../../services/authService";
import { TerritoryMap, MapLegend } from "../../components/territories/TerritoryMap";
import type {
  TerritoryNode,
  TerritoryType,
  TerritoryDetails,
  CreateTerritoryRequest,
  AssignmentType,
  UserRole,
  User,
} from "../../types";

const TYPE_LABEL: Record<TerritoryType, string> = {
  DISTRICT: "District",
  AREA: "Area",
  SUPERVISOR_TERRITORY: "Supervisor Territory",
  TECH_TERRITORY: "Tech Territory",
};

const TYPE_COLOR: Record<TerritoryType, string> = {
  DISTRICT: "bg-slate-700 text-white",
  AREA: "bg-indigo-600 text-white",
  SUPERVISOR_TERRITORY: "bg-emerald-600 text-white",
  TECH_TERRITORY: "bg-amber-500 text-white",
};

// Which territory type a node's direct child should be
const CHILD_TYPE: Record<TerritoryType, TerritoryType | null> = {
  DISTRICT: "AREA",
  AREA: "SUPERVISOR_TERRITORY",
  SUPERVISOR_TERRITORY: "TECH_TERRITORY",
  TECH_TERRITORY: null,
};

// Which role to create for a given territory type (default)
const DEFAULT_ROLE_FOR_TYPE: Record<TerritoryType, UserRole> = {
  DISTRICT: "DISTRICT_MANAGER",
  AREA: "AREA_MANAGER",
  SUPERVISOR_TERRITORY: "SUPERVISOR",
  TECH_TERRITORY: "TECH",
};

const TECH_ASSIGNABLE_ROLES: UserRole[] = ["TECH", "TRAINER", "TRAINEE"];

type TabId = "tree" | "supervisors";

export function TerritoriesPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<TabId>("tree");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [dialog, setDialog] = useState<
    | { kind: "create-child"; parent: TerritoryNode }
    | { kind: "create-user"; territory: TerritoryNode }
    | { kind: "assign-existing"; territory: TerritoryNode }
    | { kind: "rename"; territory: TerritoryNode }
    | { kind: "define-coverage"; territory: TerritoryNode }
    | { kind: "assign-tech-territories"; supervisorTerritory: TerritoryNode }
    | null
  >(null);

  const treeQuery = useQuery({
    queryKey: ["territories", "tree"],
    queryFn: () => TerritoryService.getTree(),
  });

  const detailsQuery = useQuery<TerritoryDetails>({
    queryKey: ["territories", "details", selectedId],
    queryFn: () => TerritoryService.get(selectedId!),
    enabled: !!selectedId,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => TerritoryService.remove(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["territories"] });
      setSelectedId(null);
    },
  });

  const unassignMutation = useMutation({
    mutationFn: (v: { territoryId: string; userId: string; type: AssignmentType }) =>
      TerritoryService.unassignUser(v.territoryId, v.userId, v.type),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["territories"] }),
  });

  function toggle(id: string) {
    setExpanded((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  function renderNode(node: TerritoryNode, depth = 0) {
    const hasChildren = node.children.length > 0;
    const isOpen = expanded.has(node.id);
    const isSelected = selectedId === node.id;
    return (
      <div key={node.id}>
        <div
          className={`flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer hover:bg-gray-100 ${
            isSelected ? "bg-blue-50 border border-blue-300" : ""
          }`}
          style={{ paddingLeft: 8 + depth * 18 }}
          onClick={() => setSelectedId(node.id)}
        >
          <button
            onClick={(e) => {
              e.stopPropagation();
              if (hasChildren) toggle(node.id);
            }}
            className="w-4 text-gray-500 select-none"
          >
            {hasChildren ? (isOpen ? "▾" : "▸") : ""}
          </button>
          <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${TYPE_COLOR[node.type]}`}>
            {node.type === "SUPERVISOR_TERRITORY" ? "SUP" : node.type[0]}
          </span>
          <span className="font-mono text-xs text-gray-500">{node.code}</span>
          <span className="font-medium">{node.name}</span>
          {!!node.owners?.length && (
            <span className="text-xs text-gray-600 ml-2">
              · {node.owners.map((o) => o.name).join(", ")}
            </span>
          )}
          {typeof node.assigneeCount === "number" && node.assigneeCount > 0 && (
            <span className="ml-auto text-xs text-gray-500">{node.assigneeCount} assigned</span>
          )}
        </div>
        {isOpen && hasChildren && (
          <div>{node.children.map((c) => renderNode(c, depth + 1))}</div>
        )}
      </div>
    );
  }

  const tree = treeQuery.data?.tree || [];
  // Auto-expand top two levels on first load
  useEffect(() => {
    if (tree.length === 0) return;
    if (expanded.size > 0) return;
    const toOpen = new Set<string>();
    for (const d of tree) {
      toOpen.add(d.id);
      for (const a of d.children) toOpen.add(a.id);
    }
    setExpanded(toOpen);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tree.length]);

  const selectedNode = detailsQuery.data;

  return (
    <div className="p-6">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Territories</h1>
          <p className="text-sm text-gray-600 mt-1">
            Manage supervisor assignments and geographic territory hierarchy.
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-4 border-b border-gray-200">
        {(["tree", "supervisors"] as TabId[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors ${
              tab === t
                ? "bg-white text-blue-600 border border-b-white border-gray-200 -mb-px"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            {t === "tree" ? "Tree View" : "Supervisor Assignments"}
          </button>
        ))}
      </div>

      {tab === "supervisors" ? (
        <SupervisorAssignmentsPanel />
      ) : (
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        {/* Tree */}
        <div className="lg:col-span-2 bg-white rounded-lg border border-gray-200 p-3">
          {treeQuery.isLoading && <div className="text-sm text-gray-500">Loading…</div>}
          {treeQuery.error && <div className="text-sm text-red-600">Failed to load tree</div>}
          {tree.length === 0 && !treeQuery.isLoading && (
            <div className="text-sm text-gray-500">No territories yet.</div>
          )}
          {tree.map((n) => renderNode(n))}
        </div>

        {/* Details */}
        <div className="lg:col-span-3">
          {!selectedId && (
            <div className="bg-white rounded-lg border border-gray-200 p-8 text-center text-gray-500">
              Select a territory to see details.
            </div>
          )}
          {selectedId && selectedNode && (
            <DetailsPanel
              details={selectedNode}
              onCreateChild={(t) => setDialog({ kind: "create-child", parent: t })}
              onCreateUser={(t) => setDialog({ kind: "create-user", territory: t })}
              onAssignExisting={(t) => setDialog({ kind: "assign-existing", territory: t })}
              onRename={(t) => setDialog({ kind: "rename", territory: t })}
              onDelete={(t) => {
                if (confirm(`Delete "${t.name}" and every child territory under it? This cannot be undone.`)) {
                  deleteMutation.mutate(t.id);
                }
              }}
              onUnassign={(userId, type) =>
                unassignMutation.mutate({ territoryId: selectedId, userId, type })
              }
              onDefineCoverage={(t) => setDialog({ kind: "define-coverage", territory: t })}
              onAssignTechTerritories={(t) => setDialog({ kind: "assign-tech-territories", supervisorTerritory: t })}
            />
          )}
        </div>
      </div>
      )}

      {dialog?.kind === "create-child" && (
        <CreateTerritoryDialog
          parent={dialog.parent}
          onClose={() => setDialog(null)}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ["territories"] });
            setDialog(null);
          }}
        />
      )}
      {dialog?.kind === "create-user" && (
        <CreateUserDialog
          territory={dialog.territory as TerritoryNode}
          onClose={() => setDialog(null)}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ["territories"] });
            setDialog(null);
          }}
        />
      )}
      {dialog?.kind === "assign-existing" && (
        <AssignExistingDialog
          territory={dialog.territory as TerritoryNode}
          onClose={() => setDialog(null)}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ["territories"] });
            setDialog(null);
          }}
        />
      )}
      {dialog?.kind === "rename" && (
        <RenameDialog
          territory={dialog.territory as TerritoryNode}
          onClose={() => setDialog(null)}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ["territories"] });
            setDialog(null);
          }}
        />
      )}
      {dialog?.kind === "define-coverage" && (
        <DefineCoverageDialog
          territory={dialog.territory as TerritoryNode}
          onClose={() => setDialog(null)}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ["territories"] });
            setDialog(null);
          }}
        />
      )}
      {dialog?.kind === "assign-tech-territories" && (
        <AssignTechTerritoriesDialog
          supervisorTerritory={dialog.supervisorTerritory as TerritoryNode}
          onClose={() => setDialog(null)}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ["territories"] });
            setDialog(null);
          }}
        />
      )}
    </div>
  );
}

function DetailsPanel({
  details,
  onCreateChild,
  onCreateUser,
  onAssignExisting,
  onRename,
  onDelete,
  onUnassign,
  onDefineCoverage,
  onAssignTechTerritories,
}: {
  details: TerritoryDetails;
  onCreateChild: (t: TerritoryNode) => void;
  onCreateUser: (t: TerritoryNode) => void;
  onAssignExisting: (t: TerritoryNode) => void;
  onRename: (t: TerritoryNode) => void;
  onDelete: (t: TerritoryNode) => void;
  onUnassign: (userId: string, type: AssignmentType) => void;
  onDefineCoverage?: (t: TerritoryNode) => void;
  onAssignTechTerritories?: (t: TerritoryNode) => void;
}) {
  const t = details.territory as TerritoryNode;
  const childType = CHILD_TYPE[t.type];
  const hasCoverage = !!t.coverageJson?.counties?.length || !!t.coverageJson?.cities?.length;
  return (
    <div className="bg-white rounded-lg border border-gray-200">
      <div className="p-4 border-b border-gray-200 flex items-center gap-3 flex-wrap">
        <span className={`text-xs font-mono px-2 py-0.5 rounded ${TYPE_COLOR[t.type]}`}>
          {TYPE_LABEL[t.type]}
        </span>
        <h2 className="text-xl font-bold text-gray-900">{t.name}</h2>
        <span className="text-xs font-mono text-gray-500">{t.code}</span>
        {hasCoverage && (
          <span className="text-xs bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded">
            {t.coverageJson?.counties?.length || 0} counties, {t.coverageJson?.cities?.length || 0} cities
          </span>
        )}
        <div className="ml-auto flex gap-2">
          {t.type !== "DISTRICT" && (
            <button
              onClick={() => onDefineCoverage?.(t)}
              className="text-sm bg-emerald-600 text-white px-3 py-1 rounded hover:bg-emerald-700"
            >
              {hasCoverage ? "Edit Coverage" : "Define Coverage"}
            </button>
          )}
          <button
            onClick={() => onRename(t)}
            className="text-sm text-gray-700 hover:text-gray-900 px-2 py-1"
          >
            Rename
          </button>
          <button
            onClick={() => onDelete(t)}
            className="text-sm text-red-600 hover:text-red-800 px-2 py-1"
          >
            Deactivate
          </button>
        </div>
      </div>

      {details.parentChain.length > 0 && (
        <div className="px-4 py-2 border-b border-gray-100 text-xs text-gray-500">
          Parent chain:{" "}
          {details.parentChain
            .slice()
            .reverse()
            .map((p) => (
              <span key={p.id} className="ml-1">
                {p.name} ›
              </span>
            ))}{" "}
          <span className="text-gray-800 font-medium">{t.name}</span>
        </div>
      )}

      <div className="p-4 border-b border-gray-200">
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-semibold text-sm text-gray-800">People assigned here</h3>
          <div className="flex gap-2">
            <button
              onClick={() => onCreateUser(t)}
              className="text-sm bg-blue-600 text-white px-3 py-1 rounded hover:bg-blue-700"
            >
              + Create user
            </button>
            <button
              onClick={() => onAssignExisting(t)}
              className="text-sm bg-white border border-gray-300 text-gray-700 px-3 py-1 rounded hover:bg-gray-50"
            >
              + Assign existing
            </button>
          </div>
        </div>
        {details.assignments.length === 0 ? (
          <p className="text-sm text-gray-500">No one assigned yet.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {details.assignments.map((a) => (
              <li key={a.assignmentId} className="py-2 flex items-center gap-3">
                <div className="flex-1">
                  <div className="font-medium text-gray-900">{a.name}</div>
                  <div className="text-xs text-gray-500">
                    {a.email} · {a.role} · {a.assignmentType}
                  </div>
                </div>
                <button
                  onClick={() => onUnassign(a.userId, a.assignmentType)}
                  className="text-xs text-red-600 hover:text-red-800"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="p-4">
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-semibold text-sm text-gray-800">
            Children {childType && <span className="text-gray-500 font-normal">({TYPE_LABEL[childType]})</span>}
          </h3>
          <div className="flex gap-2">
            {t.type === "SUPERVISOR_TERRITORY" && (
              <button
                onClick={() => onAssignTechTerritories?.(t)}
                className="text-sm bg-indigo-600 text-white px-3 py-1 rounded hover:bg-indigo-700"
              >
                + Bulk Create Tech Territories
              </button>
            )}
            {childType && (
              <button
                onClick={() => onCreateChild(t)}
                className="text-sm bg-blue-600 text-white px-3 py-1 rounded hover:bg-blue-700"
              >
                + Add {TYPE_LABEL[childType]}
              </button>
            )}
          </div>
        </div>
        {details.children.length === 0 ? (
          <p className="text-sm text-gray-500">None yet.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {details.children.map((c) => (
              <li key={c.id} className="py-2 flex items-center gap-3">
                <span className="font-mono text-xs text-gray-500 w-20">{c.code}</span>
                <span className="font-medium">{c.name}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// --------- Dialogs ---------

function ModalShell({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md">
        <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
          <h2 className="font-semibold">{title}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            ✕
          </button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}

function CreateTerritoryDialog({
  parent,
  onClose,
  onSaved,
}: {
  parent: TerritoryNode;
  onClose: () => void;
  onSaved: () => void;
}) {
  const childType = CHILD_TYPE[parent.type];
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (req: CreateTerritoryRequest) => TerritoryService.create(req),
    onSuccess: onSaved,
    onError: (e: Error) => setError(e.message),
  });

  if (!childType) return null;
  return (
    <ModalShell title={`New ${TYPE_LABEL[childType]} under ${parent.name}`} onClose={onClose}>
      <div className="space-y-3">
        <Field label="Code" value={code} onChange={setCode} placeholder="e.g. ETX5301" />
        <Field label="Name" value={name} onChange={setName} placeholder="Display name" />
        {error && <div className="text-sm text-red-600">{error}</div>}
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="px-3 py-1.5 text-sm border border-gray-300 rounded">
            Cancel
          </button>
          <button
            disabled={!code || !name || mutation.isPending}
            onClick={() =>
              mutation.mutate({ code, name, type: childType, parentTerritoryId: parent.id })
            }
            className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded disabled:opacity-50"
          >
            Create
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

function RenameDialog({
  territory,
  onClose,
  onSaved,
}: {
  territory: TerritoryNode;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(territory.name);
  const mutation = useMutation({
    mutationFn: (n: string) => TerritoryService.update(territory.id, { name: n }),
    onSuccess: onSaved,
  });
  return (
    <ModalShell title={`Rename ${territory.name}`} onClose={onClose}>
      <Field label="Name" value={name} onChange={setName} />
      <div className="flex justify-end gap-2 pt-3">
        <button onClick={onClose} className="px-3 py-1.5 text-sm border border-gray-300 rounded">
          Cancel
        </button>
        <button
          onClick={() => mutation.mutate(name)}
          disabled={!name || mutation.isPending}
          className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded disabled:opacity-50"
        >
          Save
        </button>
      </div>
    </ModalShell>
  );
}

function CreateUserDialog({
  territory,
  onClose,
  onSaved,
}: {
  territory: TerritoryNode;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("temp123!");
  const [role, setRole] = useState<UserRole>(DEFAULT_ROLE_FOR_TYPE[territory.type]);
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () =>
      AuthService.createUser({
        name,
        email,
        password,
        role,
        phone: phone || undefined,
        territoryId: territory.id,
      }),
    onSuccess: onSaved,
    onError: (e: Error) => setError(e.message),
  });

  return (
    <ModalShell title={`Create user in ${territory.name}`} onClose={onClose}>
      <div className="space-y-3">
        <Field label="Full name" value={name} onChange={setName} />
        <Field label="Email" value={email} onChange={setEmail} placeholder="you@company.com" />
        <Field label="Temp password" value={password} onChange={setPassword} />
        <Field label="Phone (optional)" value={phone} onChange={setPhone} />
        <label className="block text-sm">
          <span className="text-gray-700">Role</span>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as UserRole)}
            className="mt-1 block w-full rounded border border-gray-300 px-2 py-1.5"
          >
            {rolesForTerritoryType(territory.type).map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </label>
        <p className="text-xs text-gray-500">
          This user will be assigned to <b>{territory.name}</b> as the appropriate assignment type
          for their role. They'll need to change their password on first login.
        </p>
        {error && <div className="text-sm text-red-600">{error}</div>}
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="px-3 py-1.5 text-sm border border-gray-300 rounded">
            Cancel
          </button>
          <button
            disabled={!name || !email || !password || mutation.isPending}
            onClick={() => mutation.mutate()}
            className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded disabled:opacity-50"
          >
            Create user
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

function AssignExistingDialog({
  territory,
  onClose,
  onSaved,
}: {
  territory: TerritoryNode;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [selectedUserId, setSelectedUserId] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  const usersQuery = useQuery({
    queryKey: ["ops", "users", "all"],
    queryFn: () => AuthService.getUsers(),
  });

  const mutation = useMutation({
    mutationFn: () => TerritoryService.assignUser(territory.id, selectedUserId),
    onSuccess: onSaved,
    onError: (e: Error) => setError(e.message),
  });

  const eligibleRoles = rolesForTerritoryType(territory.type);
  const users: User[] = (usersQuery.data?.users || []).filter((u) =>
    eligibleRoles.includes(u.role),
  );

  return (
    <ModalShell title={`Assign user to ${territory.name}`} onClose={onClose}>
      <div className="space-y-3">
        <label className="block text-sm">
          <span className="text-gray-700">User (filtered to eligible roles)</span>
          <select
            value={selectedUserId}
            onChange={(e) => setSelectedUserId(e.target.value)}
            className="mt-1 block w-full rounded border border-gray-300 px-2 py-1.5"
          >
            <option value="">— select —</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name} ({u.role}) · {u.email}
              </option>
            ))}
          </select>
        </label>
        {error && <div className="text-sm text-red-600">{error}</div>}
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="px-3 py-1.5 text-sm border border-gray-300 rounded">
            Cancel
          </button>
          <button
            disabled={!selectedUserId || mutation.isPending}
            onClick={() => mutation.mutate()}
            className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded disabled:opacity-50"
          >
            Assign
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="block text-sm">
      <span className="text-gray-700">{label}</span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="mt-1 block w-full rounded border border-gray-300 px-2 py-1.5"
      />
    </label>
  );
}

function rolesForTerritoryType(t: TerritoryType): UserRole[] {
  switch (t) {
    case "DISTRICT":
      return ["DISTRICT_MANAGER", "MANAGER"];
    case "AREA":
      return ["AREA_MANAGER"];
    case "SUPERVISOR_TERRITORY":
      return ["SUPERVISOR"];
    case "TECH_TERRITORY":
      return ["TECH", "TRAINER", "TRAINEE"];
  }
}

// --------- Map-based Coverage Dialog (uses Boundary Units) ---------

function DefineCoverageDialog({
  territory,
  onClose,
  onSaved,
}: {
  territory: TerritoryNode;
  onClose: () => void;
  onSaved: () => void;
}) {
  const qc = useQueryClient();
  const [selectedUnitIds, setSelectedUnitIds] = useState<string[]>([]);
  const [boxSelectEnabled, setBoxSelectEnabled] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isParentScoped = territory.type !== "AREA" && !!territory.parentTerritoryId;

  // Load existing boundary units for this territory
  const existingUnitsQuery = useQuery({
    queryKey: ["territories", territory.id, "boundary-units"],
    queryFn: () => TerritoryService.getTerritoryBoundaryUnits(territory.id),
    enabled: !!territory.id,
  });

  // Initialize selected units from existing
  useEffect(() => {
    if (existingUnitsQuery.data?.units) {
      setSelectedUnitIds(existingUnitsQuery.data.units.map((u) => u.id));
    }
  }, [existingUnitsQuery.data]);

  const parentUnitsQuery = useQuery({
    queryKey: ["territories", territory.parentTerritoryId, "boundary-units", "scope"],
    queryFn: () => TerritoryService.getTerritoryBoundaryUnits(territory.parentTerritoryId!),
    enabled: isParentScoped,
  });

  const parentDetailsQuery = useQuery({
    queryKey: ["territories", "details", territory.parentTerritoryId, "siblings"],
    queryFn: () => TerritoryService.get(territory.parentTerritoryId!),
    enabled: !!territory.parentTerritoryId,
  });

  const siblingTerritories = useMemo(
    () =>
      (parentDetailsQuery.data?.children || []).filter(
        (child) => child.id !== territory.id && child.type === territory.type,
      ),
    [parentDetailsQuery.data?.children, territory.id, territory.type],
  );

  const siblingUnitsQuery = useQuery({
    queryKey: ["territories", territory.id, "sibling-boundary-units", siblingTerritories.map((s) => s.id).join(",")],
    queryFn: async () => {
      const results = await Promise.all(
        siblingTerritories.map(async (sibling) => ({
          territoryId: sibling.id,
          territoryName: sibling.name,
          units: (await TerritoryService.getTerritoryBoundaryUnits(sibling.id)).units,
        })),
      );
      return results;
    },
    enabled: siblingTerritories.length > 0,
  });

  // Determine bbox for fetching nearby boundary units
  // Use parent territory bbox as the view window, or Texas default
  const parentBbox = useMemo(() => {
    if (territory.bboxNorth != null && territory.bboxSouth != null) {
      return {
        north: territory.bboxNorth,
        south: territory.bboxSouth,
        east: territory.bboxEast!,
        west: territory.bboxWest!,
      };
    }

    const scopedUnits = parentUnitsQuery.data?.units || [];
    if (scopedUnits.length > 0) {
      return scopedUnits.reduce(
        (acc, unit) => ({
          north: Math.max(acc.north, unit.bbox.north),
          south: Math.min(acc.south, unit.bbox.south),
          east: Math.max(acc.east, unit.bbox.east),
          west: Math.min(acc.west, unit.bbox.west),
        }),
        { north: -90, south: 90, east: -180, west: 180 },
      );
    }

    return { north: 36.5, south: 25.8, east: -93.5, west: -106.6 };
  }, [
    parentUnitsQuery.data?.units,
    territory.bboxEast,
    territory.bboxNorth,
    territory.bboxSouth,
    territory.bboxWest,
  ]);

  // Load boundary units within view
  const unitsQuery = useQuery({
    queryKey: ["boundary-units", parentBbox],
    queryFn: () =>
      TerritoryService.getBoundaryUnits({
        type: "city",
        north: parentBbox.north,
        south: parentBbox.south,
        east: parentBbox.east,
        west: parentBbox.west,
        limit: 2500,
      }),
    enabled: !!parentBbox && !isParentScoped,
  });

  const allowedUnitIdSet = useMemo(() => {
    if (!isParentScoped) return null;
    return new Set((parentUnitsQuery.data?.units || []).map((unit) => unit.id));
  }, [isParentScoped, parentUnitsQuery.data?.units]);

  const claimedSiblingUnitMap = useMemo(() => {
    const entries = new Map<string, string>();
    for (const sibling of siblingUnitsQuery.data || []) {
      for (const unit of sibling.units) {
        entries.set(unit.id, sibling.territoryName);
      }
    }
    return entries;
  }, [siblingUnitsQuery.data]);

  const claimedSiblingUnitIds = useMemo(
    () => [...claimedSiblingUnitMap.keys()],
    [claimedSiblingUnitMap],
  );

  useEffect(() => {
    if (!allowedUnitIdSet) return;
    setSelectedUnitIds((prev) => prev.filter((id) => allowedUnitIdSet.has(id)));
  }, [allowedUnitIdSet]);

  useEffect(() => {
    if (claimedSiblingUnitMap.size === 0) return;
    setSelectedUnitIds((prev) => prev.filter((id) => !claimedSiblingUnitMap.has(id)));
  }, [claimedSiblingUnitMap]);

  // Save mutation - assign boundary units to territory
  const saveMutation = useMutation({
    mutationFn: () =>
      TerritoryService.assignBoundaryUnits(territory.id, selectedUnitIds, "replace"),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["territories"] });
      onSaved();
    },
    onError: (e: Error) => setError(e.message),
  });

  const toggleUnit = (unitId: string) => {
    if (claimedSiblingUnitMap.has(unitId)) return;
    setSelectedUnitIds((prev) =>
      prev.includes(unitId) ? prev.filter((id) => id !== unitId) : [...prev, unitId]
    );
  };

  const boundaryUnits = useMemo(() => {
    const fetched = isParentScoped ? parentUnitsQuery.data?.units || [] : unitsQuery.data?.units || [];
    const existing = existingUnitsQuery.data?.units || [];
    const merged = new Map<string, typeof fetched[number]>();

    for (const unit of fetched) merged.set(unit.id, unit);
    for (const unit of existing) {
      if (!merged.has(unit.id)) {
        merged.set(unit.id, unit);
      }
    }

    return [...merged.values()]
      .filter((unit) => !allowedUnitIdSet || allowedUnitIdSet.has(unit.id))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [
    allowedUnitIdSet,
    existingUnitsQuery.data?.units,
    isParentScoped,
    parentUnitsQuery.data?.units,
    unitsQuery.data?.units,
  ]);

  // Convert boundary units to the format TerritoryMap expects
  const mapUnits = boundaryUnits.map((u) => ({
    id: u.id,
    sourceId: u.sourceId,
    name: u.name,
    type: u.type,
    centroid: u.centroid,
    bbox: u.bbox,
  }));

  // Get parent bbox as numbers (with fallbacks)
  const safeParentBbox = parentBbox ? {
    north: parentBbox.north ?? 37,
    south: parentBbox.south ?? 25,
    east: parentBbox.east ?? -93,
    west: parentBbox.west ?? -107,
  } : null;

  const handleBoxSelect = (unitIds: string[]) => {
    setSelectedUnitIds((prev) => {
      const next = new Set(prev);
      for (const unitId of unitIds) {
        if ((!allowedUnitIdSet || allowedUnitIdSet.has(unitId)) && !claimedSiblingUnitMap.has(unitId)) {
          next.add(unitId);
        }
      }
      return [...next];
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
          <div>
            <h2 className="font-semibold">Define Coverage: {territory.name}</h2>
            <p className="text-xs text-gray-500">
              {isParentScoped
                ? "Drag-select or click cities from the parent territory coverage only."
                : "Drag-select or click cities to build this coverage area from the Texas city dataset."}
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">✕</button>
        </div>

        <div className="flex-1 overflow-hidden flex flex-col lg:flex-row">
          {/* Sidebar */}
          <div className="w-full lg:w-64 border-r border-gray-200 p-4 overflow-y-auto">
            <div className="mb-4">
              <span className="text-sm font-medium text-gray-700">
                Selected: {selectedUnitIds.length} cities
              </span>
            </div>

            <div className="mb-4 space-y-2">
              <button
                type="button"
                onClick={() => setBoxSelectEnabled((prev) => !prev)}
                className={`w-full rounded border px-3 py-2 text-sm ${
                  boxSelectEnabled
                    ? "border-blue-600 bg-blue-600 text-white"
                    : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
                }`}
              >
                {boxSelectEnabled ? "Exit Drag Select" : "Drag Select Cities"}
              </button>
              <button
                type="button"
                onClick={() => setSelectedUnitIds([])}
                className="w-full rounded border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
              >
                Clear Selection
              </button>
              <p className="text-xs text-gray-500">
                {isParentScoped
                  ? "This territory can only use cities already included in its parent territory."
                  : "Draw a rectangle on the map to grab a large section quickly."}
              </p>
            </div>

            <div className="space-y-1 max-h-64 overflow-y-auto">
              {boundaryUnits
                .filter((u) => selectedUnitIds.includes(u.id))
                .map((u) => (
                  <label key={u.id} className="flex items-center gap-2 text-sm py-1">
                    <input
                      type="checkbox"
                      checked={true}
                      onChange={() => toggleUnit(u.id)}
                      className="rounded"
                    />
                    <span className="font-medium text-emerald-700">{u.name}</span>
                  </label>
                ))}
            </div>

            {selectedUnitIds.length === 0 && (
              <p className="text-sm text-gray-500 italic mt-2">
                No cities selected yet.
              </p>
            )}

            {(unitsQuery.isLoading || parentUnitsQuery.isLoading) && (
              <p className="text-sm text-gray-500 mt-2">Loading cities...</p>
            )}
            {claimedSiblingUnitIds.length > 0 && (
              <p className="text-xs text-red-600 mt-2">
                {claimedSiblingUnitIds.length} cities are already assigned to sibling territories and cannot be selected here.
              </p>
            )}
          </div>

          {/* Map */}
          <div className="flex-1 p-4">
            <TerritoryMap
              height="400px"
              parentBbox={safeParentBbox}
              boundaryUnits={mapUnits}
              selectedUnitIds={selectedUnitIds}
              disabledUnitIds={claimedSiblingUnitIds}
              disabledUnitLabels={Object.fromEntries(claimedSiblingUnitMap.entries())}
              onToggleUnit={toggleUnit}
              sizeByArea={true}
              enableBoxSelect={boxSelectEnabled}
              onBoxSelect={handleBoxSelect}
            />
            <MapLegend />
          </div>
        </div>

        <div className="px-4 py-3 border-t border-gray-200 flex justify-between items-center">
          <div className="text-sm text-gray-600">
            {selectedUnitIds.length} boundary units selected
            {existingUnitsQuery.data && (
              <span className="text-gray-400 ml-2">
                (was {existingUnitsQuery.data.count})
              </span>
            )}
          </div>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-4 py-2 text-sm border border-gray-300 rounded">
              Cancel
            </button>
            {error && <span className="text-sm text-red-600 mr-2">{error}</span>}
            <button
              disabled={saveMutation.isPending}
              onClick={() => saveMutation.mutate()}
              className="px-4 py-2 text-sm bg-emerald-600 text-white rounded hover:bg-emerald-700 disabled:opacity-50"
            >
              Save Coverage
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// --------- Assign Tech Territories Dialog ---------

function AssignTechTerritoriesDialog({
  supervisorTerritory,
  onClose,
  onSaved,
}: {
  supervisorTerritory: TerritoryNode;
  onClose: () => void;
  onSaved: () => void;
}) {
  const qc = useQueryClient();
  const [selectedUnitIds, setSelectedUnitIds] = useState<string[]>([]);
  const [assignedTechByUnitId, setAssignedTechByUnitId] = useState<Record<string, string>>({});
  const [namePrefix, setNamePrefix] = useState("");
  const [error, setError] = useState<string | null>(null);

  const unitsQuery = useQuery({
    queryKey: ["territories", supervisorTerritory.id, "boundary-units", "tech-create"],
    queryFn: () => TerritoryService.getTerritoryBoundaryUnits(supervisorTerritory.id),
  });

  const supervisorDetailsQuery = useQuery({
    queryKey: ["territories", "details", supervisorTerritory.id, "assignable-techs"],
    queryFn: () => TerritoryService.get(supervisorTerritory.id),
  });

  // Get existing children to avoid duplicates
  const childrenQuery = useQuery({
    queryKey: ["territories", "children", supervisorTerritory.id],
    queryFn: () => TerritoryService.get(supervisorTerritory.id).then((d) => d.children),
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const selectedUnits = availableCities.filter((unit) =>
        selectedUnitIds.includes(unit.id),
      );

      for (const unit of selectedUnits) {
        const code = `${supervisorTerritory.code}-${unit.sourceId}`;
        const created = await TerritoryService.create({
          code,
          name: `${namePrefix ? namePrefix + " " : ""}${unit.name}`,
          type: "TECH_TERRITORY",
          parentTerritoryId: supervisorTerritory.id,
        });

        await TerritoryService.assignBoundaryUnits(created.territory.id, [unit.id], "replace");

        const assignedTechId = assignedTechByUnitId[unit.id];
        if (assignedTechId) {
          await TerritoryService.assignUser(created.territory.id, assignedTechId);
        }
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["territories"] });
      onSaved();
    },
    onError: (e: Error) => setError(e.message),
  });

  const cities = unitsQuery.data?.units || [];
  const existingChildren = childrenQuery.data || [];
  const existingNames = new Set(existingChildren.map((c) => c.name.toLowerCase()));
  const assignableTechs = (supervisorDetailsQuery.data?.assignments || []).filter((assignment) =>
    TECH_ASSIGNABLE_ROLES.includes(assignment.role),
  );

  const availableCities = cities.filter((c) => !existingNames.has(c.name.toLowerCase()));

  const toggleCity = (unitId: string) => {
    setSelectedUnitIds((prev) =>
      prev.includes(unitId) ? prev.filter((id) => id !== unitId) : [...prev, unitId]
    );
  };

  const setAssignedTech = (unitId: string, userId: string) => {
    setAssignedTechByUnitId((prev) => {
      if (!userId) {
        const next = { ...prev };
        delete next[unitId];
        return next;
      }
      return { ...prev, [unitId]: userId };
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
          <div>
            <h2 className="font-semibold">Create Tech Territories: {supervisorTerritory.name}</h2>
            <p className="text-xs text-gray-500">
              Select cities from the supervisor coverage and optionally assign a tech while you create them
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">✕</button>
        </div>

        <div className="p-4 space-y-4 overflow-y-auto">
          <Field
            label="Name prefix (optional)"
            value={namePrefix}
            onChange={setNamePrefix}
            placeholder="e.g. North, South, Zone A"
          />

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Available Cities ({availableCities.length})
            </label>
            <p className="text-xs text-gray-500 mb-2">
              Only cities already selected in {supervisorTerritory.name} are available here.
            </p>
            <div className="max-h-64 overflow-y-auto border border-gray-200 rounded p-2 space-y-1">
              {availableCities.slice(0, 50).map((city) => (
                <label key={city.id} className="flex items-center gap-2 text-sm py-1">
                  <input
                    type="checkbox"
                    checked={selectedUnitIds.includes(city.id)}
                    onChange={() => toggleCity(city.id)}
                    className="rounded"
                  />
                  <span className={selectedUnitIds.includes(city.id) ? "font-medium text-blue-700" : ""}>
                    {city.name}
                  </span>
                  <span className="text-xs text-gray-400 ml-auto">
                    {city.sourceId}
                  </span>
                </label>
              ))}
            </div>
          </div>

          {selectedUnitIds.length > 0 && (
            <div className="bg-blue-50 p-3 rounded text-sm">
              Will create {selectedUnitIds.length} tech territories:
              <div className="mt-2 space-y-2">
                {availableCities
                  .filter((city) => selectedUnitIds.includes(city.id))
                  .map((city) => (
                    <div
                      key={city.id}
                      className="grid gap-2 rounded border border-blue-100 bg-white/70 px-3 py-2 md:grid-cols-[1fr_220px]"
                    >
                      <div className="font-medium text-gray-800">
                        {namePrefix ? `${namePrefix} ${city.name}` : city.name}
                      </div>
                      <select
                        value={assignedTechByUnitId[city.id] || ""}
                        onChange={(e) => setAssignedTech(city.id, e.target.value)}
                        className="rounded border border-gray-300 px-2 py-1 text-sm"
                      >
                        <option value="">No tech assigned yet</option>
                        {assignableTechs.map((tech) => (
                          <option key={tech.userId} value={tech.userId}>
                            {tech.name} ({tech.role})
                          </option>
                        ))}
                      </select>
                    </div>
                ))}
              </div>
              {assignableTechs.length === 0 && (
                <p className="mt-2 text-xs text-amber-700">
                  No techs are assigned directly to this supervisor territory yet, so these will be created unassigned.
                </p>
              )}
            </div>
          )}

          {error && <div className="text-sm text-red-600">{error}</div>}
        </div>

        <div className="px-4 py-3 border-t border-gray-200 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm border border-gray-300 rounded">
            Cancel
          </button>
          <button
            disabled={selectedUnitIds.length === 0 || createMutation.isPending}
            onClick={() => createMutation.mutate()}
            className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
          >
            Create {selectedUnitIds.length} Territory{selectedUnitIds.length !== 1 ? "ies" : "y"}
          </button>
        </div>
      </div>
    </div>
  );
}

{/* ── Supervisor Assignments Panel ────────────────────────── */}
function SupervisorAssignmentsPanel() {
  const qc = useQueryClient();
  const [assignDialog, setAssignDialog] = useState<{ supeId: string; supeName: string } | null>(null);
  const [selectedTerritoryId, setSelectedTerritoryId] = useState("");
  const [techAssignDialog, setTechAssignDialog] = useState<{ techTerritoryId: string; techTerritoryName: string } | null>(null);
  const [selectedTechUserId, setSelectedTechUserId] = useState("");
  const [expandedSupeTerritories, setExpandedSupeTerritories] = useState<Set<string>>(new Set());

  const treeQuery = useQuery({
    queryKey: ["territories", "tree"],
    queryFn: () => TerritoryService.getTree(),
  });

  const usersQuery = useQuery({
    queryKey: ["ops", "users", "list"],
    queryFn: () => AuthService.getUsers({ includeInactive: false }),
  });

  const assignMutation = useMutation({
    mutationFn: (v: { territoryId: string; userId: string }) =>
      TerritoryService.assignUser(v.territoryId, v.userId, "OWNER"),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["territories"] });
      setAssignDialog(null);
    },
  });

  const unassignMutation = useMutation({
    mutationFn: (v: { territoryId: string; userId: string }) =>
      TerritoryService.unassignUser(v.territoryId, v.userId, "OWNER"),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["territories"] }),
  });

  const assignTechMutation = useMutation({
    mutationFn: (v: { territoryId: string; userId: string }) =>
      TerritoryService.assignUser(v.territoryId, v.userId, "TECH_ASSIGNMENT"),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["territories"] });
      setTechAssignDialog(null);
      setSelectedTechUserId("");
    },
  });

  const unassignTechMutation = useMutation({
    mutationFn: (v: { territoryId: string; userId: string }) =>
      TerritoryService.unassignUser(v.territoryId, v.userId, "TECH_ASSIGNMENT"),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["territories"] }),
  });

  const tree = treeQuery.data?.tree || [];
  const allUsers = usersQuery.data?.users || [];
  const techUsers = allUsers.filter((u) => ["TECH", "TRAINER", "TRAINEE"].includes(u.role));

  const supeMap = useMemo(() => {
    const map = new Map<string, { id: string; name: string; territories: TerritoryNode[] }>();
    const walk = (nodes: TerritoryNode[]) => {
      for (const n of nodes) {
        if (n.type === "SUPERVISOR_TERRITORY" && n.owners?.length) {
          for (const owner of n.owners) {
            if (!map.has(owner.id)) map.set(owner.id, { id: owner.id, name: owner.name, territories: [] });
            map.get(owner.id)!.territories.push(n);
          }
        }
        if (n.children) walk(n.children);
      }
    };
    walk(tree);
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [tree]);

  const allSupeTerritories = useMemo(() => {
    const result: TerritoryNode[] = [];
    const walk = (nodes: TerritoryNode[]) => {
      for (const n of nodes) {
        if (n.type === "SUPERVISOR_TERRITORY") result.push(n);
        if (n.children) walk(n.children);
      }
    };
    walk(tree);
    return result;
  }, [tree]);

  // Build a map of tech territoryId → assigned tech user IDs, derived from
  // user territory assignments. We get this by looking at each tech user's
  // assignments in the users list.
  // The tree nodes have `assigneeCount` but not the actual assignees. We
  // need to fetch details for tech territories to get the actual techs.
  // To keep it simple, we'll fetch details for expanded tech territories.
  const techTerritoryDetailsQuery = useQuery({
    queryKey: ["territories", "tech-details", Array.from(expandedSupeTerritories)],
    queryFn: async () => {
      // For each expanded supervisor territory, fetch its details to get
      // children with assignments.
      const results = await Promise.all(
        Array.from(expandedSupeTerritories).map((id) => TerritoryService.get(id)),
      );
      const map = new Map<string, { id: string; name: string; role: string; assignmentType: string }[]>();
      for (const detail of results) {
        // detail.children are tech territories; detail.assignments are for the supe territory itself
        // We need assignments for each child tech territory — but the details
        // endpoint only returns assignments for the requested territory, not children.
        // So we need to fetch each child's details.
        for (const child of detail.children) {
          if (child.type !== "TECH_TERRITORY") continue;
          const childDetail = await TerritoryService.get(child.id);
          const techs = childDetail.assignments
            .filter((a) => ["TECH", "TRAINER", "TRAINEE"].includes(a.role))
            .map((a) => ({ id: a.userId, name: a.name, role: a.role, assignmentType: a.assignmentType }));
          map.set(child.id, techs);
        }
      }
      return map;
    },
    enabled: expandedSupeTerritories.size > 0,
  });

  function toggleSupeTerritory(id: string) {
    setExpandedSupeTerritories((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  if (treeQuery.isLoading || usersQuery.isLoading) {
    return <div className="text-sm text-gray-500 p-8 text-center">Loading...</div>;
  }

  return (
    <div className="space-y-4">
      {supeMap.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 p-8 text-center text-gray-500">
          No supervisors assigned to any territories yet.
          <br />
          Use the Tree View to create supervisor territories and assign supervisors.
        </div>
      ) : (
        supeMap.map((supe) => (
          <div key={supe.id} className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            {/* Supervisor header */}
            <div className="px-4 py-3 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
                <span className="font-semibold text-gray-900">{supe.name}</span>
                <span className="text-xs text-gray-500">Supervisor</span>
              </div>
              <button
                onClick={() => setAssignDialog({ supeId: supe.id, supeName: supe.name })}
                className="text-xs text-blue-600 hover:text-blue-800 font-medium"
              >
                + Add Territory
              </button>
            </div>

            {/* Supervisor territories with expandable tech territories */}
            <div className="divide-y divide-gray-100">
              {supe.territories.map((t) => {
                const isExpanded = expandedSupeTerritories.has(t.id);
                const techTerritories = t.children?.filter((c) => c.type === "TECH_TERRITORY") || [];
                return (
                  <div key={t.id}>
                    <div
                      className="px-4 py-2.5 flex items-center gap-2 cursor-pointer hover:bg-gray-50"
                      onClick={() => toggleSupeTerritory(t.id)}
                    >
                      <span className="text-gray-400 select-none w-4">
                        {techTerritories.length > 0 ? (isExpanded ? "▾" : "▸") : ""}
                      </span>
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-emerald-50 text-emerald-700 border border-emerald-200">
                        {t.name}
                      </span>
                      <span className="text-xs text-gray-500">
                        {techTerritories.length} tech {techTerritories.length === 1 ? "area" : "areas"}
                      </span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (confirm(`Remove ${supe.name} from ${t.name}?`)) {
                            unassignMutation.mutate({ territoryId: t.id, userId: supe.id });
                          }
                        }}
                        className="ml-auto text-xs text-red-500 hover:text-red-700"
                      >
                        Remove
                      </button>
                    </div>

                    {/* Tech territories under this supervisor territory */}
                    {isExpanded && techTerritories.length > 0 && (
                      <div className="pl-10 pr-4 py-2 bg-gray-50/50 space-y-1.5">
                        {techTerritories.map((techTerr) => {
                          const assignedTechs = techTerritoryDetailsQuery.data?.get(techTerr.id) || [];
                          return (
                            <div key={techTerr.id} className="flex items-center gap-2 py-1.5 px-2 bg-white rounded border border-gray-100">
                              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] bg-amber-50 text-amber-700 border border-amber-200">
                                {techTerr.name}
                              </span>
                              <div className="flex flex-wrap gap-1 flex-1">
                                {assignedTechs.length === 0 ? (
                                  <span className="text-xs text-gray-400 italic">No tech assigned</span>
                                ) : (
                                  assignedTechs.map((tech) => (
                                    <span
                                      key={tech.id}
                                      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] bg-blue-50 text-blue-700 border border-blue-200"
                                    >
                                      {tech.name}
                                      <button
                                        onClick={() => {
                                          if (confirm(`Remove ${tech.name} from ${techTerr.name}?`)) {
                                            unassignTechMutation.mutate({ territoryId: techTerr.id, userId: tech.id });
                                          }
                                        }}
                                        className="ml-0.5 hover:text-red-600"
                                        title="Remove tech"
                                      >
                                        ×
                                      </button>
                                    </span>
                                  ))
                                )}
                              </div>
                              <button
                                onClick={() => setTechAssignDialog({ techTerritoryId: techTerr.id, techTerritoryName: techTerr.name })}
                                className="text-xs text-blue-600 hover:text-blue-800 font-medium whitespace-nowrap"
                              >
                                + Assign Tech
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {isExpanded && techTerritories.length === 0 && (
                      <div className="pl-10 pr-4 py-2 text-xs text-gray-400 italic">
                        No tech territories under this supervisor territory.
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))
      )}

      {/* Dialog: Assign supervisor territory to a supervisor */}
      {assignDialog && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-md">
            <h3 className="text-lg font-semibold mb-4">
              Assign territory to {assignDialog.supeName}
            </h3>
            <select
              value={selectedTerritoryId}
              onChange={(e) => setSelectedTerritoryId(e.target.value)}
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm mb-4"
            >
              <option value="">Select a supervisor territory...</option>
              {allSupeTerritories.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t.code})
                </option>
              ))}
            </select>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => { setAssignDialog(null); setSelectedTerritoryId(""); }}
                className="px-4 py-2 text-sm border border-gray-300 rounded"
              >
                Cancel
              </button>
              <button
                disabled={!selectedTerritoryId || assignMutation.isPending}
                onClick={() =>
                  assignMutation.mutate({ territoryId: selectedTerritoryId, userId: assignDialog.supeId })
                }
                className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
              >
                Assign
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Dialog: Assign tech to a tech territory */}
      {techAssignDialog && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-md">
            <h3 className="text-lg font-semibold mb-4">
              Assign tech to {techAssignDialog.techTerritoryName}
            </h3>
            <select
              value={selectedTechUserId}
              onChange={(e) => setSelectedTechUserId(e.target.value)}
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm mb-4"
            >
              <option value="">Select a tech...</option>
              {techUsers.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} ({u.role})
                </option>
              ))}
            </select>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => { setTechAssignDialog(null); setSelectedTechUserId(""); }}
                className="px-4 py-2 text-sm border border-gray-300 rounded"
              >
                Cancel
              </button>
              <button
                disabled={!selectedTechUserId || assignTechMutation.isPending}
                onClick={() =>
                  assignTechMutation.mutate({
                    territoryId: techAssignDialog.techTerritoryId,
                    userId: selectedTechUserId,
                  })
                }
                className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
              >
                Assign Tech
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
