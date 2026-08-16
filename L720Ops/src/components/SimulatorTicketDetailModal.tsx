import type { SimulatorTicketDetail } from "../types/simulator";
import { formatTicketType, ticketTypeBadgeClass } from "./../types/ticket";

interface SimulatorTicketDetailModalProps {
  ticket: SimulatorTicketDetail | null;
  isOpen: boolean;
  onClose: () => void;
}

export function SimulatorTicketDetailModal({ ticket, isOpen, onClose }: SimulatorTicketDetailModalProps) {
  if (!ticket || !isOpen) return null;

  // Parse payload for additional data
  let payloadData: any = {};
  try {
    payloadData = JSON.parse(ticket.payloadJson || "{}");
  } catch (e) {
    console.error('[SimulatorTicketDetailModal] Failed to parse payload:', e);
  }

  // The 811 API returns work details and contractor info directly on the ticket object
  // not in the payload, so we need to extract them from the ticket itself
  const workType = (ticket as any).workType || payloadData.workType;
  const markingInstructions = (ticket as any).markingInstructions || payloadData.markingInstructions;
  const contractor = (ticket as any).contractor?.name || payloadData.contractor;
  const contractorPhone = (ticket as any).contractor?.phone || payloadData.contractorPhone;
  const contactName = (ticket as any).contractor?.contact?.name || payloadData.contactName;
  const contactEmail = (ticket as any).contractor?.contact?.email || payloadData.contactEmail;

  return (
    <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50">
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="bg-white rounded-lg shadow-xl max-w-6xl w-full max-h-[90vh] overflow-y-auto">
          {/* Header */}
          <div className="bg-white px-6 py-4 border-b border-gray-200 sm:px-6">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-medium text-gray-900">
                811 Ticket Details: {ticket.ticketNumber}
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

          {/* Content */}
          <div className="px-6 py-4">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {/* Basic Information */}
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
                          ticket.status === "NEW"
                            ? "bg-yellow-100 text-yellow-800"
                            : ticket.status === "SENT_TO_MEMBER"
                              ? "bg-blue-100 text-blue-800"
                              : ticket.status === "RESPONDED"
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
                      <dt className="text-sm text-gray-500">Area:</dt>
                      <dd className="text-sm font-medium text-gray-900">{ticket.areaId}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-sm text-gray-500">Version:</dt>
                      <dd className="text-sm font-medium text-gray-900">{ticket.version}</dd>
                    </div>
                  </dl>
                </div>

                <div>
                  <h4 className="text-sm font-medium text-gray-900">Location</h4>
                  <dl className="mt-2 space-y-2">
                    <div>
                      <dt className="text-sm text-gray-500">Address:</dt>
                      <dd className="text-sm font-medium text-gray-900">{ticket.address}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-sm text-gray-500">Coordinates:</dt>
                      <dd className="text-sm font-medium text-gray-900">
                        {ticket.lat && ticket.lng ? `${ticket.lat.toFixed(6)}, ${ticket.lng.toFixed(6)}` : "N/A"}
                      </dd>
                    </div>
                  </dl>
                </div>
              </div>

              {/* Work Details */}
              <div className="space-y-4">
                <div>
                  <h4 className="text-sm font-medium text-gray-900">Work Details</h4>
                  <dl className="mt-2 space-y-2">
                    <div>
                      <dt className="text-sm text-gray-500">Work Type:</dt>
                      <dd className="text-sm font-medium text-gray-900">{workType || "N/A"}</dd>
                    </div>
                    <div>
                      <dt className="text-sm text-gray-500">Marking Instructions:</dt>
                      <dd className="text-sm font-medium text-gray-900">
                        {markingInstructions || "None specified"}
                      </dd>
                    </div>
                  </dl>
                </div>

                <div>
                  <h4 className="text-sm font-medium text-gray-900">Contractor</h4>
                  <dl className="mt-2 space-y-2">
                    <div>
                      <dt className="text-sm text-gray-500">Company:</dt>
                      <dd className="text-sm font-medium text-gray-900">
                        {contractor || "N/A"}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-sm text-gray-500">Phone:</dt>
                      <dd className="text-sm font-medium text-gray-900">
                        {contractorPhone || "N/A"}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-sm text-gray-500">Contact:</dt>
                      <dd className="text-sm font-medium text-gray-900">
                        {contactName || "N/A"}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-sm text-gray-500">Contact Email:</dt>
                      <dd className="text-sm font-medium text-gray-900">
                        {contactEmail || "N/A"}
                      </dd>
                    </div>
                  </dl>
                </div>
              </div>

              {/* Customer Members */}
              <div className="space-y-4 lg:col-span-3">
                <div>
                  <h4 className="text-sm font-medium text-gray-900">Customer Members ({ticket.members?.length || 0})</h4>
                  <div className="mt-2 space-y-3">
                    {ticket.members?.map((member: any, index: number) => (
                      <div key={member.id || index} className="border border-gray-200 rounded-lg p-4">
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                          <div>
                            <dt className="text-xs text-gray-500">Customer Name</dt>
                            <dd className="text-sm font-medium text-gray-900">{member.customerName || member.companyName}</dd>
                          </div>
                          <div>
                            <dt className="text-xs text-gray-500">Utility</dt>
                            <dd className="text-sm font-medium text-gray-900">{member.utility || member.utilityType}</dd>
                          </div>
                          <div>
                            <dt className="text-xs text-gray-500">Member Code</dt>
                            <dd className="text-sm font-medium text-gray-900">{member.memberCode}</dd>
                          </div>
                          <div>
                            <dt className="text-xs text-gray-500">Status</dt>
                            <dd className="text-sm font-medium text-gray-900">
                              <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                                member.status === "RESPONDED"
                                  ? "bg-green-100 text-green-800"
                                  : member.status === "PENDING"
                                    ? "bg-yellow-100 text-yellow-800"
                                    : "bg-gray-100 text-gray-800"
                              }`}>
                                {member.status}
                              </span>
                            </dd>
                          </div>
                          {member.responseCode && (
                            <div>
                              <dt className="text-xs text-gray-500">Response Code</dt>
                              <dd className="text-sm font-medium text-gray-900">{member.responseCode}</dd>
                            </div>
                          )}
                          {member.respondedAt && (
                            <div>
                              <dt className="text-xs text-gray-500">Responded At</dt>
                              <dd className="text-sm font-medium text-gray-900">
                                {new Date(member.respondedAt).toLocaleString()}
                              </dd>
                            </div>
                          )}
                          {member.notes && (
                            <div className="md:col-span-2 lg:col-span-4">
                              <dt className="text-xs text-gray-500">Notes</dt>
                              <dd className="text-sm font-medium text-gray-900">{member.notes}</dd>
                            </div>
                          )}
                        </div>
                      </div>
                    )) || (
                      <div className="text-sm text-gray-500">No customer members found</div>
                    )}
                  </div>
                </div>
              </div>

              {/* Timestamps */}
              <div className="space-y-4">
                <div>
                  <h4 className="text-sm font-medium text-gray-900">Timestamps</h4>
                  <dl className="mt-2 space-y-2">
                    <div className="flex justify-between">
                      <dt className="text-sm text-gray-500">Created:</dt>
                      <dd className="text-sm font-medium text-gray-900">
                        {ticket.createdAt ? new Date(ticket.createdAt).toLocaleString() : "N/A"}
                      </dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-sm text-gray-500">Last Updated:</dt>
                      <dd className="text-sm font-medium text-gray-900">
                        {ticket.updatedAt ? new Date(ticket.updatedAt).toLocaleString() : "N/A"}
                      </dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-sm text-gray-500">Due Date:</dt>
                      <dd className="text-sm font-medium text-gray-900">
                        {ticket.dueAt ? new Date(ticket.dueAt).toLocaleString() : "N/A"}
                      </dd>
                    </div>
                  </dl>
                </div>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="bg-gray-50 px-6 py-3 sm:flex sm:flex-row-reverse sm:px-6">
            <button
              type="button"
              className="w-full inline-flex justify-center rounded-md border border-transparent shadow-sm px-4 py-2 bg-primary-600 text-base font-medium text-white hover:bg-primary-700 focus:outline-none sm:ml-0 sm:w-auto sm:text-sm"
              onClick={onClose}
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
