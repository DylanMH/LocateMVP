import { useState } from "react";
import type { UserRole } from "../../types";
import type { TerritoryType } from "../../types";

interface TerritoryOption {
  id: string;
  name: string;
  type: TerritoryType;
  parentTerritoryId: string | null;
  ownerUserIds: string[];
}

interface UserOption {
  id: string;
  name: string;
}

interface CreateUserModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreate: (user: {
    name: string;
    email: string;
    password: string;
    title?: string;
    role: UserRole;
    supervisorId?: string;
    areaId?: string;
    phone?: string;
    territoryId?: string;
    assignmentType?: "OWNER" | "MANAGER" | "TECH_ASSIGNMENT" | "TRAINER_SUPPORT";
  }) => void;
  territories: TerritoryOption[];
  supervisors: UserOption[];
  areaManagers: UserOption[];
  currentUserRole: string;
}

const ROLE_OPTIONS: { value: UserRole; label: string; minRole: string }[] = [
  { value: "TRAINEE", label: "Trainee", minRole: "SUPERVISOR" },
  { value: "TRAINER", label: "Trainer", minRole: "SUPERVISOR" },
  { value: "TECH", label: "Technician", minRole: "SUPERVISOR" },
  { value: "SUPERVISOR", label: "Supervisor", minRole: "AREA_MANAGER" },
  { value: "AREA_MANAGER", label: "Area Manager", minRole: "MANAGER" },
  { value: "MANAGER", label: "Manager", minRole: "MANAGER" },
];

export function CreateUserModal({
  isOpen,
  onClose,
  onCreate,
  territories,
  supervisors,
  areaManagers,
  currentUserRole,
}: CreateUserModalProps) {
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    password: "",
    confirmPassword: "",
    title: "",
    role: "TECH" as UserRole,
    supervisorId: "",
    areaId: "",
    phone: "",
  });
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  if (!isOpen) return null;

  const canCreateRole = (role: UserRole) => {
    const roleOption = ROLE_OPTIONS.find((r) => r.value === role);
    if (!roleOption) return false;

    const hierarchy = ["TRAINEE", "TRAINER", "TECH", "SUPERVISOR", "AREA_MANAGER", "MANAGER"];
    const currentIdx = hierarchy.indexOf(currentUserRole);
    const requiredIdx = hierarchy.indexOf(roleOption.minRole as UserRole);
    return currentIdx >= requiredIdx;
  };

  const availableRoles = ROLE_OPTIONS.filter((r) => canCreateRole(r.value));
  const areaTerritories = territories.filter((territory) => territory.type === "AREA");
  const supervisorTerritories = territories.filter((territory) => territory.type === "SUPERVISOR_TERRITORY");
  const techTerritories = territories.filter((territory) => territory.type === "TECH_TERRITORY");

  const isFieldRole = ["TRAINEE", "TRAINER", "TECH"].includes(formData.role);
  const isSupervisorRole = formData.role === "SUPERVISOR";
  const isAreaManagerRole = formData.role === "AREA_MANAGER";

  let relationLabel = "Supervisor";
  let relationOptions: UserOption[] = supervisors;
  let areaLabel = "Assigned Area";
  let areaOptions: TerritoryOption[] = [];
  let helperText = "Territories come from the territory builder.";

  if (isAreaManagerRole) {
    relationOptions = [];
    areaLabel = "Area Territory";
    areaOptions = areaTerritories;
    helperText = areaOptions.length
      ? "Select the defined area territory this area manager owns."
      : "Define area territories in Territories before creating area managers.";
  } else if (isSupervisorRole) {
    relationLabel = "Area Manager";
    relationOptions = areaManagers;
    areaLabel = "Supervisor Area";
    const ownedAreaIds = formData.supervisorId
      ? areaTerritories
          .filter((territory) => territory.ownerUserIds.includes(formData.supervisorId))
          .map((territory) => territory.id)
      : [];
    areaOptions = formData.supervisorId
      ? supervisorTerritories.filter((territory) => ownedAreaIds.includes(territory.parentTerritoryId || ""))
      : [];
    helperText = formData.supervisorId
      ? areaOptions.length
        ? "Only supervisor territories inside the selected area manager's area are available."
        : "No supervisor territories are defined under that area manager yet."
      : "Pick an area manager to see the supervisor territories available.";
  } else if (isFieldRole) {
    relationLabel = "Supervisor";
    relationOptions = supervisors;
    areaLabel = "Sub Area";
    const ownedSupervisorIds = formData.supervisorId
      ? supervisorTerritories
          .filter((territory) => territory.ownerUserIds.includes(formData.supervisorId))
          .map((territory) => territory.id)
      : [];
    areaOptions = formData.supervisorId
      ? techTerritories.filter((territory) => ownedSupervisorIds.includes(territory.parentTerritoryId || ""))
      : [];
    helperText = formData.supervisorId
      ? areaOptions.length
        ? "These sub areas come from the selected supervisor's territory setup."
        : "No tech sub areas are defined for that supervisor yet."
      : "Pick a supervisor to see that supervisor's defined sub areas.";
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if ((isFieldRole || isSupervisorRole || isAreaManagerRole) && !formData.areaId) {
      setError(`${areaLabel} is required for this role.`);
      return;
    }

    if ((isFieldRole || isSupervisorRole) && !formData.supervisorId) {
      setError(`${relationLabel} is required for this role.`);
      return;
    }

    if (formData.password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }

    if (formData.password !== formData.confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    setIsLoading(true);
    try {
      await onCreate({
        name: formData.name,
        email: formData.email,
        password: formData.password,
        title: formData.title || undefined,
        role: formData.role,
        supervisorId: formData.supervisorId || undefined,
        areaId: formData.areaId || undefined,
        phone: formData.phone || undefined,
        territoryId: formData.areaId || undefined,
        assignmentType: isFieldRole ? "TECH_ASSIGNMENT" : isAreaManagerRole || isSupervisorRole ? "OWNER" : undefined,
      });
      // Reset form
      setFormData({
        name: "",
        email: "",
        password: "",
        confirmPassword: "",
        title: "",
        role: "TECH",
        supervisorId: "",
        areaId: "",
        phone: "",
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create user");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4 max-h-[90vh] overflow-y-auto">
        <div className="p-6">
          <h2 className="text-xl font-semibold text-gray-900 mb-4">
            Add New User
          </h2>

          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md">
              <p className="text-sm text-red-600">{error}</p>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Full Name *
              </label>
              <input
                type="text"
                required
                value={formData.name}
                onChange={(e) =>
                  setFormData({ ...formData, name: e.target.value })
                }
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Enter full name"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Email *
              </label>
              <input
                type="email"
                required
                value={formData.email}
                onChange={(e) =>
                  setFormData({ ...formData, email: e.target.value })
                }
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Enter email address"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Job Title
              </label>
              <input
                type="text"
                value={formData.title}
                onChange={(e) =>
                  setFormData({ ...formData, title: e.target.value })
                }
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="e.g., Locator I, Lead Tech"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Phone
              </label>
              <input
                type="tel"
                value={formData.phone}
                onChange={(e) =>
                  setFormData({ ...formData, phone: e.target.value })
                }
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Enter phone number"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Role *
              </label>
              {availableRoles.length > 0 ? (
                <select
                  required
                  value={formData.role}
                  onChange={(e) =>
                    setFormData({ ...formData, role: e.target.value as UserRole })
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {availableRoles.map((role) => (
                    <option key={role.value} value={role.value}>
                      {role.label}
                    </option>
                  ))}
                </select>
              ) : (
                <div className="text-sm text-red-600">
                  No roles available. Please check your permissions.
                </div>
              )}
            </div>

            {relationOptions.length > 0 ? (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {relationLabel}
                </label>
                <select
                  value={formData.supervisorId}
                  onChange={(e) =>
                    setFormData({ ...formData, supervisorId: e.target.value, areaId: "" })
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">{`No ${relationLabel}`}</option>
                  {relationOptions.map((supervisor) => (
                    <option key={supervisor.id} value={supervisor.id}>
                      {supervisor.name}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              !isAreaManagerRole && (
                <div className="text-sm text-gray-500">
                  No {relationLabel.toLowerCase()}s available yet.
                </div>
              )
            )}

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {areaLabel}
              </label>
              {areaOptions.length > 0 ? (
                <select
                  value={formData.areaId}
                  onChange={(e) =>
                    setFormData({ ...formData, areaId: e.target.value })
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">No Territory Assignment</option>
                  {areaOptions.map((area) => (
                    <option key={area.id} value={area.id}>
                      {area.name}
                    </option>
                  ))}
                </select>
              ) : (
                <div className="text-sm text-gray-500 italic">
                  {helperText}
                </div>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Temporary Password *
              </label>
              <input
                type="password"
                required
                value={formData.password}
                onChange={(e) =>
                  setFormData({ ...formData, password: e.target.value })
                }
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Min 8 characters"
              />
              <p className="text-xs text-gray-500 mt-1">
                User will be required to change this on first login
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Confirm Password *
              </label>
              <input
                type="password"
                required
                value={formData.confirmPassword}
                onChange={(e) =>
                  setFormData({ ...formData, confirmPassword: e.target.value })
                }
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Confirm password"
              />
            </div>

            <div className="flex justify-end gap-3 pt-4">
              <button
                type="button"
                onClick={onClose}
                disabled={isLoading}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-md disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isLoading}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md disabled:opacity-50"
              >
                {isLoading ? "Creating..." : "Create User"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
