import { useState, useMemo } from "react";
import { TicketsService } from "../services/ticketsService";

interface RescheduleModalProps {
  isOpen: boolean;
  onClose: () => void;
  ticketId: string;
  ticketNumber: string;
  currentDueAt: number;
  contractorName?: string;
  contractorEmail?: string;
  contractorPhone?: string;
  address?: string;
  onRescheduled?: () => void;
}

type ExtensionType = "24_HOURS" | "48_HOURS" | "CUSTOM";
type ReasonCode = "ACCESS_ISSUE" | "CANNOT_FIND_ADDRESS" | "DAMAGE_INVESTIGATION" | "PROJECT_TICKET" | "WEATHER" | "OTHER";
type ExcavatorResponse = "AGREED_TO_RESCHEDULE" | "DISAGREED" | "PENDING";

const EXTENSION_OPTIONS: { type: ExtensionType; label: string; hours: number }[] = [
  { type: "24_HOURS", label: "Extend 24 hours", hours: 24 },
  { type: "48_HOURS", label: "Extend 48 hours", hours: 48 },
];

const REASON_OPTIONS: { code: ReasonCode; label: string }[] = [
  { code: "ACCESS_ISSUE", label: "Access issue" },
  { code: "CANNOT_FIND_ADDRESS", label: "Can't find address" },
  { code: "DAMAGE_INVESTIGATION", label: "Damage investigation" },
  { code: "PROJECT_TICKET", label: "Project ticket" },
  { code: "WEATHER", label: "Weather" },
  { code: "OTHER", label: "Other" },
];

const EXCAVATOR_RESPONSES: { value: ExcavatorResponse; label: string }[] = [
  { value: "AGREED_TO_RESCHEDULE", label: "Agree to reschedule" },
  { value: "DISAGREED", label: "Disagree" },
  { value: "PENDING", label: "Pending" },
];

export function RescheduleModal({
  isOpen,
  onClose,
  ticketId,
  ticketNumber,
  currentDueAt,
  contractorName,
  contractorEmail,
  contractorPhone,
  address,
  onRescheduled,
}: RescheduleModalProps) {
  const [extensionType, setExtensionType] = useState<ExtensionType | null>(null);
  const [customDueAt, setCustomDueAt] = useState<string>("");
  const [reasonCode, setReasonCode] = useState<ReasonCode | null>(null);
  const [otherReason, setOtherReason] = useState("");
  const [approvalName, setApprovalName] = useState(contractorName || "");
  const [approvalPhone, setApprovalPhone] = useState(contractorPhone || "");
  const [excavatorResponse, setExcavatorResponse] = useState<ExcavatorResponse>("AGREED_TO_RESCHEDULE");
  const [notes, setNotes] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const proposedDueAt = useMemo(() => {
    if (extensionType === "CUSTOM" && customDueAt) {
      const parsed = new Date(customDueAt).getTime();
      if (!isNaN(parsed)) return parsed;
    }
    if (extensionType === "24_HOURS") return currentDueAt + 24 * 60 * 60 * 1000;
    if (extensionType === "48_HOURS") return currentDueAt + 48 * 60 * 60 * 1000;
    return null;
  }, [extensionType, customDueAt, currentDueAt]);

  const generatedNotes = useMemo(() => {
    if (notes) return notes;
    if (!proposedDueAt || !reasonCode) return "";
    const newDateStr = new Date(proposedDueAt).toLocaleString();
    const reasonLabel = REASON_OPTIONS.find((r) => r.code === reasonCode)?.label || reasonCode;
    return `Ticket ${ticketNumber} is being rescheduled due to ${reasonLabel} to ${newDateStr}. The technician will complete the locate as soon as possible.`;
  }, [proposedDueAt, reasonCode, ticketNumber, notes]);

  if (!isOpen) return null;

  const resetState = () => {
    setExtensionType(null);
    setCustomDueAt("");
    setReasonCode(null);
    setOtherReason("");
    setApprovalName(contractorName || "");
    setApprovalPhone(contractorPhone || "");
    setExcavatorResponse("AGREED_TO_RESCHEDULE");
    setNotes("");
    setError(null);
    setSuccess(null);
  };

  const handleClose = () => {
    resetState();
    onClose();
  };

  const handleSubmit = async () => {
    // Prevent rescheduling tickets that are already past due
    if (currentDueAt && currentDueAt < Date.now()) {
      setError("This ticket is already past its due date and cannot be rescheduled.");
      return;
    }
    if (!proposedDueAt) {
      setError("Please select an extension option or custom date");
      return;
    }
    if (!reasonCode) {
      setError("Please select a reason");
      return;
    }
    if (reasonCode === "OTHER" && !otherReason.trim()) {
      setError("Please provide details when selecting 'Other'");
      return;
    }

    setIsSubmitting(true);
    setError(null);
    setSuccess(null);

    try {
      const requestId = `reschedule-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const result = await TicketsService.rescheduleTicket(ticketId, proposedDueAt, requestId, {
        reasonCode,
        extensionType: extensionType || "CUSTOM",
        reason: reasonCode === "OTHER" ? otherReason : undefined,
        approvalName: approvalName.trim() || undefined,
        approvalPhone: approvalPhone.trim() || undefined,
        excavatorResponse,
        notes: generatedNotes,
        source: "L720_INTERNAL",
      });
      setSuccess(
        `Rescheduled from ${new Date(result.previousDueAt).toLocaleString()} to ${new Date(result.newDueAt).toLocaleString()}`,
      );
      onRescheduled?.();
      setTimeout(() => {
        handleClose();
      }, 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reschedule failed");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/30 overflow-y-auto h-full w-full z-[60]"
      onClick={(e) => { if (e.target === e.currentTarget) handleClose(); }}
    >
      <div
        className="flex min-h-full items-center justify-center p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
            <h3 className="text-lg font-semibold text-gray-900">
              Reschedule Ticket {ticketNumber}
            </h3>
            <button
              onClick={handleClose}
              className="text-gray-400 hover:text-gray-500"
            >
              <span className="sr-only">Close</span>
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="px-6 py-4 space-y-5">
            {/* Ticket context info */}
            <div className="rounded-lg bg-gray-50 p-3 space-y-1">
              {address && (
                <div className="text-sm text-gray-700">{address}</div>
              )}
              <div className="text-sm">
                <span className="text-gray-500">Current Due: </span>
                <span className="font-medium text-gray-900">
                  {new Date(currentDueAt).toLocaleString()}
                </span>
              </div>
              {contractorName && (
                <div className="text-sm">
                  <span className="text-gray-500">Contractor: </span>
                  <span className="font-medium text-gray-900">{contractorName}</span>
                </div>
              )}
              {contractorEmail && (
                <div className="text-sm">
                  <span className="text-gray-500">Email: </span>
                  <span className="font-medium text-gray-900">{contractorEmail}</span>
                </div>
              )}
            </div>

            {/* Extension */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Extension
              </label>
              <div className="flex flex-wrap gap-2">
                {EXTENSION_OPTIONS.map((opt) => (
                  <button
                    key={opt.type}
                    onClick={() => setExtensionType(opt.type)}
                    className={`rounded-lg border px-3 py-1.5 text-sm font-medium ${
                      extensionType === opt.type
                        ? "border-blue-500 bg-blue-50 text-blue-700"
                        : "border-gray-300 text-gray-700 hover:bg-gray-50"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
                <button
                  onClick={() => setExtensionType("CUSTOM")}
                  className={`rounded-lg border px-3 py-1.5 text-sm font-medium ${
                    extensionType === "CUSTOM"
                      ? "border-blue-500 bg-blue-50 text-blue-700"
                      : "border-gray-300 text-gray-700 hover:bg-gray-50"
                  }`}
                >
                  Custom
                </button>
              </div>
              {extensionType === "CUSTOM" && (
                <input
                  type="datetime-local"
                  className="mt-2 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                  value={customDueAt}
                  onChange={(e) => setCustomDueAt(e.target.value)}
                />
              )}
              {proposedDueAt && (
                <div className="mt-2 rounded-lg bg-blue-50 px-3 py-2">
                  <span className="text-xs text-gray-500">Proposed new due: </span>
                  <span className="text-sm font-semibold text-gray-900">
                    {new Date(proposedDueAt).toLocaleString()}
                  </span>
                </div>
              )}
            </div>

            {/* Approved By */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Approved By
              </label>
              <div className="grid grid-cols-2 gap-3">
                <input
                  type="text"
                  className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
                  placeholder="Name"
                  value={approvalName}
                  onChange={(e) => setApprovalName(e.target.value)}
                />
                <input
                  type="tel"
                  className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
                  placeholder="Phone"
                  value={approvalPhone}
                  onChange={(e) => setApprovalPhone(e.target.value)}
                />
              </div>
            </div>

            {/* Reason */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Reason
              </label>
              <div className="flex flex-wrap gap-2">
                {REASON_OPTIONS.map((opt) => (
                  <button
                    key={opt.code}
                    onClick={() => setReasonCode(opt.code)}
                    className={`rounded-lg border px-3 py-1.5 text-xs font-medium ${
                      reasonCode === opt.code
                        ? "border-blue-500 bg-blue-50 text-blue-700"
                        : "border-gray-300 text-gray-700 hover:bg-gray-50"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              {reasonCode === "OTHER" && (
                <input
                  type="text"
                  className="mt-2 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                  placeholder="Provide details..."
                  value={otherReason}
                  onChange={(e) => setOtherReason(e.target.value)}
                />
              )}
            </div>

            {/* Excavator Response */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Excavator Response
              </label>
              <div className="flex flex-wrap gap-2">
                {EXCAVATOR_RESPONSES.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setExcavatorResponse(opt.value)}
                    className={`rounded-lg border px-3 py-1.5 text-xs font-medium ${
                      excavatorResponse === opt.value
                        ? "border-blue-500 bg-blue-50 text-blue-700"
                        : "border-gray-300 text-gray-700 hover:bg-gray-50"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Notes */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Notes
              </label>
              <textarea
                className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                rows={3}
                value={notes || generatedNotes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Message to contractor..."
              />
            </div>

            {error && (
              <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
                {error}
              </div>
            )}
            {success && (
              <div className="rounded-lg bg-green-50 p-3 text-sm text-green-700">
                {success}
              </div>
            )}

            <div className="flex justify-end gap-3 pt-2">
              <button
                onClick={handleClose}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                disabled={isSubmitting || !proposedDueAt || !reasonCode}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {isSubmitting ? "Rescheduling..." : "Reschedule"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
