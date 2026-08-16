import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { SimulatorService } from "../../services/simulatorService";
import { BackendService } from "../../services/backendService";
import type { SimulatorTicket, SimulatorTicketDetail } from "../../types/simulator";
import { formatTicketType, ticketTypeBadgeClass } from "../../types/ticket";
import { SimulatorTicketDetailModal } from "../../components/SimulatorTicketDetailModal";
import { useState } from "react";

export function SimulatorPage() {
  const queryClient = useQueryClient();
  const [selectedTicket, setSelectedTicket] = useState<SimulatorTicketDetail | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const {
    data: simulatorTickets,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ["simulator-tickets"],
    queryFn: () => SimulatorService.getTickets(),
    staleTime: 0, // Disable caching to force fresh data
    refetchOnWindowFocus: true, // Refetch when window gains focus
  });

  const { data: stats } = useQuery({
    queryKey: ["simulator-stats"],
    queryFn: () => SimulatorService.getStats(),
  });

  const generateTicketsMutation = useMutation({
    mutationFn: () => SimulatorService.generateTestTickets(5),
    onSuccess: (data) => {
      console.log("[SimulatorPage] Generated tickets:", data);
      // Refetch both simulator tickets and stats
      refetch();
      queryClient.invalidateQueries({ queryKey: ["simulator-stats"] });
    },
    onError: (error) => {
      console.error("[SimulatorPage] Failed to generate tickets:", error);
      alert("Failed to generate tickets. Please try again.");
    },
  });

  const resetDatabaseMutation = useMutation({
    mutationFn: () => SimulatorService.resetDatabase(),
    onSuccess: () => {
      console.log("[SimulatorPage] Database reset successfully");
      // Refetch both simulator tickets and stats
      refetch();
      queryClient.invalidateQueries({ queryKey: ["simulator-stats"] });
    },
    onError: (error) => {
      console.error("[SimulatorPage] Failed to reset database:", error);
      alert("Failed to reset database. Please try again.");
    },
  });

  const { data: backendStatus } = useQuery({
    queryKey: ["backend-811-status"],
    queryFn: () => BackendService.get811Status(),
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  const pull811TicketsMutation = useMutation({
    mutationFn: () => BackendService.pull811Tickets(),
    onSuccess: (data) => {
      console.log("[SimulatorPage] Pulled 811 tickets:", data);
      alert(`Success: ${data.pull.ingested} new, ${data.pull.updated} updated tickets. ${data.assignment.assigned} tickets assigned.`);
      // Refresh backend status
      queryClient.invalidateQueries({ queryKey: ["backend-811-status"] });
    },
    onError: (error) => {
      console.error("[SimulatorPage] Failed to pull 811 tickets:", error);
      alert("Failed to pull 811 tickets. Please try again.");
    },
  });

  const resetBackendTicketsMutation = useMutation({
    mutationFn: () => BackendService.reset811Tickets(),
    onSuccess: (data) => {
      console.log("[SimulatorPage] Reset backend tickets:", data);
      alert(`Success: Deleted ${data.deleted} tickets from backend.`);
      // Refresh backend status
      queryClient.invalidateQueries({ queryKey: ["backend-811-status"] });
    },
    onError: (error) => {
      console.error("[SimulatorPage] Failed to reset backend tickets:", error);
      alert("Failed to reset backend tickets. Please try again.");
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-600">Loading simulator data...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-md p-4">
        <div className="text-red-800">
          Error loading simulator data. Please try again.
        </div>
      </div>
    );
  }

  const handleViewTicket = async (ticketId: string) => {
    try {
      const ticketDetail = await SimulatorService.getTicket(ticketId);
      setSelectedTicket(ticketDetail);
      setIsModalOpen(true);
    } catch (error) {
      console.error('[SimulatorPage] Failed to fetch ticket details:', error);
      alert('Failed to fetch ticket details. Please try again.');
    }
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setSelectedTicket(null);
  };

  const availableAreas = Array.from(
    new Set((simulatorTickets?.tickets || []).map((ticket) => ticket.areaId).filter(Boolean)),
  ).sort();

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-gray-900">811 Simulator</h2>
        <div className="flex space-x-3">
          <button
            onClick={() => generateTicketsMutation.mutate()}
            disabled={generateTicketsMutation.isPending}
            className="bg-yellow-600 text-white px-4 py-2 rounded-md hover:bg-yellow-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {generateTicketsMutation.isPending
              ? "Generating..."
              : "Generate 5 Tickets"}
          </button>
          <button
            onClick={() => pull811TicketsMutation.mutate()}
            disabled={pull811TicketsMutation.isPending}
            className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {pull811TicketsMutation.isPending
              ? "Pulling..."
              : "Pull to Backend"}
          </button>
          <button
            onClick={() => {
              if (
                confirm(
                  "Are you sure you want to reset the 811 Simulator database? This will delete all tickets.",
                )
              ) {
                resetDatabaseMutation.mutate();
              }
            }}
            disabled={resetDatabaseMutation.isPending}
            className="bg-red-600 text-white px-4 py-2 rounded-md hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {resetDatabaseMutation.isPending
              ? "Resetting..."
              : "Reset 811 DB"}
          </button>
          <button
            onClick={() => {
              if (
                confirm(
                  "Are you sure you want to reset all Backend tickets? This will delete all ingested 811 tickets from the Backend.",
                )
              ) {
                resetBackendTicketsMutation.mutate();
              }
            }}
            disabled={resetBackendTicketsMutation.isPending}
            className="bg-orange-600 text-white px-4 py-2 rounded-md hover:bg-orange-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {resetBackendTicketsMutation.isPending
              ? "Resetting..."
              : "Reset Backend"}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white shadow rounded-lg">
            <div className="p-4 border-b border-gray-200">
              <h3 className="text-lg font-medium text-gray-900">811 Tickets</h3>
              <div className="text-sm text-gray-500 mt-1">
                Found {simulatorTickets?.tickets?.length || 0} tickets
              </div>
            </div>
            <div className="p-4 border-b border-gray-200">
              <div className="flex space-x-4">
                <input
                  type="text"
                  placeholder="Search tickets..."
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-primary-500 focus:border-primary-500"
                />
                <select className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-primary-500 focus:border-primary-500">
                  <option value="">All Status</option>
                  <option value="NEW">New</option>
                  <option value="SENT_TO_MEMBER">Sent to Member</option>
                  <option value="ASSIGNED">Assigned</option>
                  <option value="RESPONDED">Responded</option>
                  <option value="CLOSED">Closed</option>
                </select>
                <select className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-primary-500 focus:border-primary-500">
                  <option value="">All Areas</option>
                  {availableAreas.map((area) => (
                    <option key={area} value={area}>
                      {area}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Ticket #
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Type
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Status
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Area
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Members
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {simulatorTickets?.tickets?.map((ticket: SimulatorTicket) => (
                    <tr key={ticket.id}>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm font-medium text-gray-900">
                          {ticket.ticketNumber}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span
                          className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${ticketTypeBadgeClass(ticket.ticketType)}`}
                        >
                          {formatTicketType(ticket.ticketType)}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span
                          className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                            ticket.status === "NEW"
                              ? "bg-yellow-100 text-yellow-800"
                              : ticket.status === "SENT_TO_MEMBER"
                                ? "bg-cyan-100 text-cyan-800"
                                : ticket.status === "ASSIGNED"
                                  ? "bg-blue-100 text-blue-800"
                                  : ticket.status === "RESPONDED"
                                    ? "bg-green-100 text-green-800"
                                    : ticket.status === "CLOSED"
                                      ? "bg-gray-100 text-gray-800"
                                      : "bg-red-100 text-red-800"
                          }`}
                        >
                          {ticket.status}
                        </span>
                        {ticket.assignedTechName && (
                          <div className="text-xs text-gray-500 mt-1">
                            Tech: {ticket.assignedTechName}
                          </div>
                        )}
                        {ticket.locatorStatus && ticket.locatorStatus !== "PENDING" && (
                          <div className="text-xs text-gray-400 mt-0.5">
                            Locator: {ticket.locatorStatus}
                          </div>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {ticket.areaId}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {ticket.memberCount || 0}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                        <button 
                          onClick={() => handleViewTicket(ticket.id)}
                          className="text-primary-600 hover:text-primary-900 mr-3"
                        >
                          View
                        </button>
                        <button className="text-gray-600 hover:text-gray-900">
                          Edit
                        </button>
                      </td>
                    </tr>
                  )) || (
                    <tr>
                      <td
                        colSpan={6}
                        className="px-6 py-4 text-center text-sm text-gray-500"
                      >
                        No 811 tickets found
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <div className="p-4 border-b border-gray-200">
            <h3 className="text-lg font-medium text-gray-900 mb-4">
              System Statistics
            </h3>
          </div>

          <div className="bg-white shadow rounded-lg p-6">
            <h3 className="text-lg font-medium text-gray-900 mb-4">
              Backend Status
            </h3>
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-600">811 Tickets in Backend:</span>
                <span className="text-lg font-semibold text-gray-900">
                  {backendStatus?.status?.total811Tickets || 0}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-600">Last Sync:</span>
                <span className="text-sm text-gray-900">
                  {backendStatus?.status?.lastSyncTime 
                    ? new Date(backendStatus.status.lastSyncTime).toLocaleString()
                    : "Never"
                  }
                </span>
              </div>
              {backendStatus?.status?.assignmentStats && (
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-600">Assigned Tickets:</span>
                  <span className="text-lg font-semibold text-green-600">
                    {backendStatus.status.assignmentStats.assigned || 0}
                  </span>
                </div>
              )}
            </div>
          </div>

          <div className="bg-white shadow rounded-lg p-6">
            <h3 className="text-lg font-medium text-gray-900 mb-4">
              Area Distribution
            </h3>
            <div className="space-y-4">
              {Object.entries(stats?.byArea || {}).map(([area, count]) => (
                <div key={area} className="flex justify-between items-center">
                  <span className="text-sm text-gray-600">
                    {area.replace("_", " ")}
                  </span>
                  <span className="text-lg font-semibold text-gray-900">
                    {count}
                  </span>
                </div>
              )) || (
                <div className="text-center text-sm text-gray-500">
                  No area data available
                </div>
              )}
            </div>
          </div>

          <div className="bg-white shadow rounded-lg p-6">
            <h3 className="text-lg font-medium text-gray-900 mb-4">
              Quick Actions
            </h3>
            <div className="space-y-3">
              <button className="w-full bg-primary-600 text-white px-4 py-2 rounded-md hover:bg-primary-700">
                Create New Ticket
              </button>
              <button
                onClick={() => generateTicketsMutation.mutate()}
                disabled={generateTicketsMutation.isPending}
                className="w-full bg-yellow-600 text-white px-4 py-2 rounded-md hover:bg-yellow-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {generateTicketsMutation.isPending
                  ? "⏳ Generating..."
                  : "➕ Generate 5 Test Tickets"}
              </button>
              <button className="w-full bg-gray-600 text-white px-4 py-2 rounded-md hover:bg-gray-700">
                Export Data
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Simulator Ticket Detail Modal */}
      <SimulatorTicketDetailModal
        ticket={selectedTicket}
        isOpen={isModalOpen}
        onClose={handleCloseModal}
      />
    </div>
  );
}
