import { useState } from "react";
import { Dialog, DialogPanel, DialogTitle } from "@headlessui/react";
import { TicketsService } from "../services/ticketsService";

interface RescheduleModalProps {
  isOpen: boolean;
  onClose: () => void;
  ticketId: string;
  ticketNumber: string;
  currentDueAt: number;
  onRescheduled?: () => void;
}

const PRESET_OFFSETS = [
  { label: "+24 hours", ms: 24 * 60 * 60 * 1000 },
  { label: "+48 hours", ms: 48 * 60 * 60 * 1000 },
  { label: "+72 hours", ms: 72 * 60 * 60 * 1000 },
];

export function RescheduleModal({
  isOpen,
  onClose,
  ticketId,
  ticketNumber,
  currentDueAt,
  onRescheduled,
}: RescheduleModalProps) {
  const [newDueAt, setNewDueAt] = useState<number | null>(null);
  const [reason, setReason] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const handlePreset = (offsetMs: number) => {
    setNewDueAt(currentDueAt + offsetMs);
    setError(null);
  };

  const handleSubmit = async () => {
    if (!newDueAt) {
      setError("Please select a new due date");
      return;
    }
    setIsSubmitting(true);
    setError(null);
    setSuccess(null);
    try {
      const requestId = `reschedule-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const result = await TicketsService.rescheduleTicket(
        ticketId,
        newDueAt,
        reason,
        requestId,
      );
      setSuccess(
        `Rescheduled from ${new Date(result.previousDueAt).toLocaleString()} to ${new Date(result.newDueAt).toLocaleString()}`,
      );
      onRescheduled?.();
      setTimeout(() => {
        onClose();
        setNewDueAt(null);
        setReason("");
        setSuccess(null);
      }, 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reschedule failed");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    onClose();
    setNewDueAt(null);
    setReason("");
    setError(null);
    setSuccess(null);
  };

  return (
    <Dialog open={isOpen} onClose={handleClose} className="relative z-50">
      <div className="fixed inset-0 bg-black/30" aria-hidden="true" />
      <div className="fixed inset-0 flex items-center justify-center p-4">
        <DialogPanel className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
          <DialogTitle className="text-lg font-semibold text-gray-900">
            Reschedule Ticket {ticketNumber}
          </DialogTitle>

          <div className="mt-4 space-y-4">
            <div>
              <label className="text-sm font-medium text-gray-700">
                Current Due: {new Date(currentDueAt).toLocaleString()}
              </label>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                New Due Date
              </label>
              <div className="flex flex-wrap gap-2">
                {PRESET_OFFSETS.map((preset) => (
                  <button
                    key={preset.label}
                    onClick={() => handlePreset(preset.ms)}
                    className={`rounded-lg border px-3 py-1.5 text-sm font-medium ${
                      newDueAt === currentDueAt + preset.ms
                        ? "border-blue-500 bg-blue-50 text-blue-700"
                        : "border-gray-300 text-gray-700 hover:bg-gray-50"
                    }`}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
              <input
                type="datetime-local"
                className="mt-2 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                value={
                  newDueAt
                    ? new Date(newDueAt - new Date().getTimezoneOffset() * 60000)
                        .toISOString()
                        .slice(0, 16)
                    : ""
                }
                onChange={(e) => {
                  const val = new Date(e.target.value).getTime();
                  if (!isNaN(val)) {
                    setNewDueAt(val);
                    setError(null);
                  }
                }}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Reason (optional)
              </label>
              <textarea
                className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                rows={2}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Reason for rescheduling..."
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
                disabled={isSubmitting || !newDueAt}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {isSubmitting ? "Rescheduling..." : "Reschedule"}
              </button>
            </div>
          </div>
        </DialogPanel>
      </div>
    </Dialog>
  );
}
