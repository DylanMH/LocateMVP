const CLEAR_RESULT = 'EXCAVATION_SITE_CLEAR';
const MARKED_RESULTS = new Set(['PAINT_AND_FLAG', 'PAINT_ONLY', 'FLAG_ONLY']);
const MARKED_STATUSES = new Set(['MARKED']);

function parsePayload(ticketOrPayload) {
  if (!ticketOrPayload || typeof ticketOrPayload !== 'object') return {};
  if (typeof ticketOrPayload.payload_json === 'string') {
    try {
      return JSON.parse(ticketOrPayload.payload_json || '{}');
    } catch {
      return {};
    }
  }
  return ticketOrPayload;
}

function getMarkings(payload) {
  return payload.customerMarkings || payload.customerMarking || {};
}

function getCustomers(payload) {
  return Array.isArray(payload.customers) ? payload.customers : [];
}

function getCustomerOutcomes(ticketOrPayload) {
  const payload = parsePayload(ticketOrPayload);
  const customers = getCustomers(payload);
  const markings = getMarkings(payload);

  return customers.map((customer) => ({
    customerId: customer?.id || null,
    completed: markings?.[customer?.id]?.completed === true,
    status: markings?.[customer?.id]?.status || '',
    result: markings?.[customer?.id]?.result || '',
    footage: parseNonNegativeNumber(markings?.[customer?.id]?.footage),
  }));
}

function parseNonNegativeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

export function isMarkedOutcome(outcome) {
  return MARKED_STATUSES.has(outcome?.status) || MARKED_RESULTS.has(outcome?.result);
}

export function isClearOutcome(outcome) {
  return outcome?.result === CLEAR_RESULT;
}

export function classifyTicketOutcome(ticketOrPayload) {
  const outcomes = getCustomerOutcomes(ticketOrPayload);
  if (outcomes.length === 0 || outcomes.some((outcome) => !outcome.completed)) {
    return 'UNCLASSIFIED';
  }

  const clearCount = outcomes.filter(isClearOutcome).length;
  const markedCount = outcomes.filter(isMarkedOutcome).length;

  if (clearCount === outcomes.length) return 'FULLY_CLEAR';
  if (markedCount === outcomes.length) return 'FULLY_MARKED';
  if (clearCount > 0 && markedCount > 0) return 'MIXED';
  return 'UNCLASSIFIED';
}

export function isMarkedTicket(ticketOrPayload) {
  return getCustomerOutcomes(ticketOrPayload).some(isMarkedOutcome);
}

export function calculateMarkedFootage(ticketOrPayload) {
  return getCustomerOutcomes(ticketOrPayload)
    .filter(isMarkedOutcome)
    .reduce((total, outcome) => total + outcome.footage, 0);
}

export function getTicketCompletionAt(ticket) {
  if (!ticket || typeof ticket !== 'object') return null;
  const payload = parsePayload(ticket);
  const value = ticket.closed_at ?? payload.closedAt;
  const completionAt = Number(value);
  return Number.isFinite(completionAt) && completionAt > 0 ? completionAt : null;
}

export function isCompletedOnTime(ticket) {
  const dueAt = Number(ticket?.due_at);
  const completedAt = getTicketCompletionAt(ticket);
  return Number.isFinite(dueAt) && dueAt > 0 && completedAt !== null && completedAt <= dueAt;
}

export function summarizeTicketMetrics(tickets = []) {
  const completed = tickets.filter((ticket) => getTicketCompletionAt(ticket) !== null);
  const outcomes = completed.reduce((summary, ticket) => {
    const classification = classifyTicketOutcome(ticket);
    if (classification === 'FULLY_CLEAR') summary.fullyClear += 1;
    if (classification === 'FULLY_MARKED') summary.fullyMarked += 1;
    if (classification === 'MIXED') summary.mixed += 1;
    if (classification === 'FULLY_MARKED' || classification === 'MIXED') {
      summary.markedTickets += 1;
      summary.markedFootage += calculateMarkedFootage(ticket);
    }
    return summary;
  }, { fullyClear: 0, fullyMarked: 0, mixed: 0, markedTickets: 0, markedFootage: 0 });

  const eligibleForCotp = completed.filter((ticket) => Number.isFinite(Number(ticket.due_at)) && Number(ticket.due_at) > 0);
  const onTime = eligibleForCotp.filter(isCompletedOnTime).length;

  return {
    completed: completed.length,
    ...outcomes,
    cotp: eligibleForCotp.length > 0 ? (onTime / eligibleForCotp.length) * 100 : null,
    cotpNumerator: onTime,
    cotpDenominator: eligibleForCotp.length,
  };
}
