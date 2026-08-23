import { summarizeTicketMetrics } from './ticketMetrics.js';

function parsePayload(ticket) {
  try {
    return JSON.parse(ticket.payload_json || '{}');
  } catch {
    return {};
  }
}

export function projectCustomerTickets(tickets, customer) {
  return tickets.flatMap((ticket) => {
    const payload = parsePayload(ticket);
    const markings = payload.customerMarkings || payload.customerMarking || {};
    const customerRows = Array.isArray(payload.customers) ? payload.customers : [];
    const matching = customerRows.filter((row) => (
      row?.name === customer.display_name
      && (row?.utility || row?.utilityType) === customer.utility_type
    ));

    return matching.map((row) => ({
      ...ticket,
      payload_json: JSON.stringify({
        customers: [{ id: row.id }],
        customerMarkings: { [row.id]: markings[row.id] || {} },
      }),
    }));
  });
}

export function summarizeCustomerMetrics(tickets, customer) {
  const customerTickets = projectCustomerTickets(tickets, customer);
  const metrics = summarizeTicketMetrics(customerTickets);
  const overdueCompletions = customerTickets.filter((ticket) => (
    Number(ticket.due_at) > 0
    && Number(ticket.closed_at) > Number(ticket.due_at)
  )).length;

  return {
    ...metrics,
    ticketCount: customerTickets.length,
    overdueCompletions,
    averageFootagePerMarkedTicket: metrics.markedTickets > 0
      ? metrics.markedFootage / metrics.markedTickets
      : null,
  };
}
