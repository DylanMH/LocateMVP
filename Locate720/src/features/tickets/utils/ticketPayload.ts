import type {
  Customer,
  OriginalTicketData,
  OriginalTicketMemberLike,
  TicketDisplayData,
  TicketPayload,
  UtilityType,
} from "../types";

function getStableAccountNumber(source: Partial<OriginalTicketMemberLike> = {}) {
  return (
    source.accountNumber ||
    source.account_number ||
    source.memberCode ||
    source.member_code ||
    source.id ||
    ""
  );
}

export function formatTicketType(ticketType?: string): string {
  // 811-standard labels. "Original" is a lineage concept, not a type — unset
  // or legacy NORMAL/ORIGINAL rows render as "Normal".
  if (!ticketType || ticketType === "NORMAL" || ticketType === "ORIGINAL") return "Normal";

  switch (ticketType) {
    case "EMERGENCY":
      return "Emergency";
    case "DIGUP":
      return "Dig Up";
    case "NON_COMPLIANT":
      return "Non Compliant";
    case "UPDATE":
      return "Update";
    case "UPDATE_REMARK":
      return "Update / Remark";
    case "RECALL":
    case "CORRECTION": // legacy — CORRECTION's meaning matches 811 RECALL
      return "Recall";
    case "NO_RESPONSE":
      return "No Response";
    default:
      return ticketType;
  }
}

export function parseTicketPayload(payloadJson?: string): TicketPayload {
  try {
    return JSON.parse(payloadJson || "{}") as TicketPayload;
  } catch {
    return {};
  }
}

export function getNested811Payload(payload: TicketPayload): Record<string, unknown> {
  const originalTicketData = (payload?.originalTicketData || {}) as OriginalTicketData;

  if (originalTicketData.payload && typeof originalTicketData.payload === "object") {
    return originalTicketData.payload;
  }

  if (typeof originalTicketData.payloadJson === "string" && originalTicketData.payloadJson) {
    try {
      return JSON.parse(originalTicketData.payloadJson) as Record<string, unknown>;
    } catch {
      return {};
    }
  }

  return {};
}

export function getTicketPayloadValue(payload: TicketPayload, key: string): string {
  const nestedPayload = getNested811Payload(payload) as Record<string, unknown>;
  const originalTicketData = (payload?.originalTicketData || {}) as OriginalTicketData;

  if (typeof nestedPayload?.[key] === "string" && nestedPayload[key]) return nestedPayload[key] as string;
  if (typeof payload?.[key] === "string" && payload[key]) return payload[key] as string;
  if (typeof originalTicketData?.[key] === "string" && originalTicketData[key]) return originalTicketData[key] as string;

  if (key === "contractor") {
    const contractor = originalTicketData?.contractor;
    if (typeof nestedPayload?.contractor === "string" && nestedPayload.contractor) {
      return nestedPayload.contractor;
    }
    if (typeof contractor === "object" && typeof contractor?.name === "string") {
      return contractor.name;
    }
    if (typeof contractor === "string") {
      return contractor;
    }
  }

  if (key === "contractorPhone") {
    const contractor = originalTicketData?.contractor;
    if (typeof nestedPayload?.contractorPhone === "string" && nestedPayload.contractorPhone) {
      return nestedPayload.contractorPhone;
    }
    if (typeof contractor === "object" && typeof contractor?.phone === "string") {
      return contractor.phone;
    }
  }

  if (key === "contactName") {
    const contractor = originalTicketData?.contractor;
    if (typeof nestedPayload?.contactName === "string" && nestedPayload.contactName) {
      return nestedPayload.contactName;
    }
    if (
      typeof contractor === "object" &&
      typeof contractor?.contact?.name === "string"
    ) {
      return contractor.contact.name;
    }
  }

  if (key === "contactEmail") {
    const contractor = originalTicketData?.contractor;
    if (typeof nestedPayload?.contactEmail === "string" && nestedPayload.contactEmail) {
      return nestedPayload.contactEmail;
    }
    if (
      typeof contractor === "object" &&
      typeof contractor?.contact?.email === "string"
    ) {
      return contractor.contact.email;
    }
  }

  return "";
}

export function getTicketPayloadCustomers(payload: TicketPayload): Customer[] {
  const nestedPayload = getNested811Payload(payload) as { customers?: Partial<Customer>[] };
  const originalMembers = Array.isArray(payload?.originalTicketData?.members)
    ? payload.originalTicketData.members
    : [];

  const mapCustomer = (customer: Partial<Customer> & OriginalTicketMemberLike): Customer => {
    const matchingMember = originalMembers.find((member) => member.id === customer.id);

    return {
      id: customer.id || matchingMember?.id || "unknown-customer",
      name:
        customer.name ||
        customer.customerName ||
        customer.companyName ||
        customer.company_name ||
        customer.utility ||
        customer.utilityType ||
        customer.utility_type ||
        "Unknown Utility",
      utility:
        (customer.utility ||
          customer.utilityType ||
          customer.utility_type ||
          matchingMember?.utility ||
          matchingMember?.utilityType ||
          matchingMember?.utility_type ||
          "UNKNOWN") as UtilityType,
      accountNumber:
        getStableAccountNumber(customer) ||
        getStableAccountNumber(matchingMember),
    };
  };

  if (Array.isArray(nestedPayload?.customers) && nestedPayload.customers.length > 0) {
    return nestedPayload.customers.map((customer) =>
      mapCustomer(customer as Partial<Customer> & OriginalTicketMemberLike),
    );
  }

  if (Array.isArray(payload?.customers) && payload.customers.length > 0) {
    return payload.customers.map((customer) =>
      mapCustomer(customer as Partial<Customer> & OriginalTicketMemberLike),
    );
  }

  if (originalMembers.length > 0) {
    return originalMembers.map((member) =>
      mapCustomer(member as Partial<Customer> & OriginalTicketMemberLike),
    );
  }

  return [];
}

export function getTicketDisplayData(payloadJson?: string): TicketDisplayData {
  const payload = parseTicketPayload(payloadJson);

  return {
    payload,
    customers: getTicketPayloadCustomers(payload),
    contractor: getTicketPayloadValue(payload, "contractor"),
    contractorPhone: getTicketPayloadValue(payload, "contractorPhone"),
    contactName: getTicketPayloadValue(payload, "contactName"),
    contactEmail: getTicketPayloadValue(payload, "contactEmail"),
    markingInstructions: getTicketPayloadValue(payload, "markingInstructions"),
    workType: getTicketPayloadValue(payload, "workType"),
  };
}
