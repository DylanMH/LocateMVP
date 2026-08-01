import { useState, useEffect } from "react";
import type { User, UserRole } from "../../types";

interface EditUserModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (params: { id: string; updates: {
    name?: string;
    email?: string;
    title?: string;
    role?: UserRole;
    supervisorId?: string;
    areaId?: string;
    phone?: string;
    isActive?: boolean;
  }}) => void;
  onResetPassword: (params: { id: string; newPassword: string }) => void;
  onDeactivate: (id: string) => void;
  user: User | null;
  areas: { id: string; name: string }[];
  supervisors: { id: string; name: string }[];
  currentUserRole: string;
  isLoading?: boolean;
}

const ROLE_OPTIONS: { value: UserRole; label: string }[] = [
  { value: "TRAINEE", label: "Trainee" },
  { value: "TRAINER", label: "Trainer" },
  { value: "TECH", label: "Technician" },
  { value: "SUPERVISOR", label: "Supervisor" },
  { value: "AREA_MANAGER", label: "Area Manager" },
  { value: "MANAGER", label: "Manager" },
];

export function EditUserModal({
  isOpen,
  onClose,
  onSave,
  onResetPassword,
  onDeactivate,
  user,
  areas,
  supervisors,
  currentUserRole,
  isLoading,
}: EditUserModalProps) {
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    title: "",
    role: "TECH" as UserRole,
    supervisorId: "",
    areaId: "",
    phone: "",
    isActive: true,
  });
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPasswordReset, setShowPasswordReset] = useState(false);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState<"details" | "security">("details");

  useEffect(() => {
    if (user) {
      setFormData({
        name: user.name || "",
        email: user.email || "",
        title: user.title || "",
        role: user.role,
        supervisorId: user.supervisorId || "",
        areaId: user.areaId || "",
        phone: user.phone || "",
        isActive: true,
      });
    }
  }, [user]);

  if (!isOpen || !user) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    const updates: {
      name?: string;
      email?: string;
      title?: string;
      role?: UserRole;
      supervisorId?: string;
      areaId?: string;
      phone?: string;
    } = {};
    if (formData.name !== user.name) updates.name = formData.name;
    if (formData.email !== user.email) updates.email = formData.email;
    if (formData.title !== (user.title || "")) updates.title = formData.title || undefined;
    if (formData.role !== user.role) updates.role = formData.role;
    if (formData.supervisorId !== (user.supervisorId || "")) updates.supervisorId = formData.supervisorId || undefined;
    if (formData.areaId !== (user.areaId || "")) updates.areaId = formData.areaId || undefined;
    if (formData.phone !== (user.phone || "")) updates.phone = formData.phone || undefined;

    try {
      await onSave({ id: user.id, updates });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update user");
    }
  };

  const handlePasswordReset = async () => {
    setError("");

    if (newPassword.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }

    if (newPassword !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    try {
      await onResetPassword({ id: user.id, newPassword });
      setNewPassword("");
      setConfirmPassword("");
      setShowPasswordReset(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reset password");
    }
  };

  const handleDeactivate = async () => {
    if (!confirm("Are you sure you want to deactivate this user? They will no longer be able to log in.")) {
      return;
    }

    try {
      await onDeactivate(user.id);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to deactivate user");
    }
  };

  const canEditRole = () => {
    const hierarchy = ["TRAINEE", "TRAINER", "TECH", "SUPERVISOR", "AREA_MANAGER", "MANAGER"];
    const currentIdx = hierarchy.indexOf(currentUserRole);
    const userIdx = hierarchy.indexOf(user.role);
    return currentIdx > userIdx || currentUserRole === "MANAGER";
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4 max-h-[90vh] overflow-y-auto">
        <div className="p-6">
          <h2 className="text-xl font-semibold text-gray-900 mb-4">
            Edit User
          </h2>

          <div className="flex gap-2 mb-4">
            <button
              type="button"
              onClick={() => setActiveTab("details")}
              className={`px-3 py-1 text-sm font-medium rounded-md ${
                activeTab === "details"
                  ? "bg-blue-100 text-blue-700"
                  : "text-gray-600 hover:bg-gray-100"
              }`}
            >
              Details
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("security")}
              className={`px-3 py-1 text-sm font-medium rounded-md ${
                activeTab === "security"
                  ? "bg-blue-100 text-blue-700"
                  : "text-gray-600 hover:bg-gray-100"
              }`}
            >
              Security
            </button>
          </div>

          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md">
              <p className="text-sm text-red-600">{error}</p>
            </div>
          )}

          {activeTab === "details" ? (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Full Name
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) =>
                    setFormData({ ...formData, name: e.target.value })
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Email
                </label>
                <input
                  type="email"
                  value={formData.email}
                  onChange={(e) =>
                    setFormData({ ...formData, email: e.target.value })
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Role
                </label>
                <select
                  value={formData.role}
                  onChange={(e) =>
                    setFormData({ ...formData, role: e.target.value as UserRole })
                  }
                  disabled={!canEditRole()}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
                >
                  {ROLE_OPTIONS.map((role) => (
                    <option key={role.value} value={role.value}>
                      {role.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Area
                </label>
                <select
                  value={formData.areaId}
                  onChange={(e) =>
                    setFormData({ ...formData, areaId: e.target.value })
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">No Area (Manual Assignment)</option>
                  {areas.map((area) => (
                    <option key={area.id} value={area.id}>
                      {area.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Supervisor
                </label>
                <select
                  value={formData.supervisorId}
                  onChange={(e) =>
                    setFormData({ ...formData, supervisorId: e.target.value })
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">No Supervisor</option>
                  {supervisors.map((supervisor) => (
                    <option key={supervisor.id} value={supervisor.id}>
                      {supervisor.name}
                    </option>
                  ))}
                </select>
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
                  {isLoading ? "Saving..." : "Save Changes"}
                </button>
              </div>
            </form>
          ) : (
            <div className="space-y-4">
              {showPasswordReset ? (
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      New Password
                    </label>
                    <input
                      type="password"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="Min 8 characters"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Confirm Password
                    </label>
                    <input
                      type="password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="Confirm password"
                    />
                  </div>

                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setShowPasswordReset(false)}
                      className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-md"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={handlePasswordReset}
                      className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md"
                    >
                      Reset Password
                    </button>
                  </div>

                  <p className="text-xs text-gray-500">
                    User will be required to change this password on next login.
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  <button
                    type="button"
                    onClick={() => setShowPasswordReset(true)}
                    className="w-full px-4 py-2 text-sm font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-md text-left"
                  >
                    Reset Password
                  </button>

                  <div className="border-t pt-4">
                    <button
                      type="button"
                      onClick={handleDeactivate}
                      className="w-full px-4 py-2 text-sm font-medium text-red-700 bg-red-50 hover:bg-red-100 rounded-md text-left"
                    >
                      Deactivate User
                    </button>
                    <p className="text-xs text-gray-500 mt-2">
                      Deactivating will prevent this user from logging in. This action can be reversed by an administrator.
                    </p>
                  </div>
                </div>
              )}

              <div className="flex justify-end pt-4">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-md"
                >
                  Close
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
