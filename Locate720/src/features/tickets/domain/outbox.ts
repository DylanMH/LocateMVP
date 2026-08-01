import 'react-native-get-random-values';
import { v4 as uuidv4 } from 'uuid';
import { getCurrentUserId } from '../../auth/devSession';
import type { ClockEventPayload } from '../../timesheet/types';

let sequenceCounter = 0;

/**
 * Creates a new outbox event for status changes
 * P0 = highest priority, must be sent ASAP
 */
export function createOutboxEvent(params: {
  type: string;
  priority: number;
  payload: Record<string, unknown>;
}): {
  type: string;
  priority: number;
  requestId: string;
  deviceId: string;
  seq: number;
  occurredAt: number;
  payloadJson: string;
  status: 'PENDING';
  retryCount: 0;
  ticketId?: string;
} {
  sequenceCounter++;
  
  return {
    type: params.type,
    priority: params.priority,
    requestId: uuidv4(),
    deviceId: getCurrentUserId(), // Using userId as deviceId for now
    seq: sequenceCounter,
    occurredAt: Date.now(),
    payloadJson: JSON.stringify(params.payload),
    status: 'PENDING',
    retryCount: 0,
    ticketId: typeof params.payload.ticketId === 'string' ? params.payload.ticketId : undefined,
  };
}

/**
 * Create a TICKET_STATUS_SET event (P0 priority)
 */
export function createTicketStatusSetEvent(
  ticketId: string, 
  nextStatus: string, 
  payloadUpdates?: Record<string, unknown>
) {
  return createOutboxEvent({
    type: 'TICKET_STATUS_SET',
    priority: 0, // P0 - highest priority
    payload: {
      ticketId,
      nextStatus,
      userId: getCurrentUserId(),
      ...(payloadUpdates && { payloadUpdates }),
    },
  });
}

/**
 * Create a TICKET_CUSTOMER_MARKING_SET event (P0 priority)
 */
export function createTicketCustomerMarkingSetEvent(
  ticketId: string,
  customerMarking: Record<string, unknown>,
) {
  return createOutboxEvent({
    type: 'TICKET_CUSTOMER_MARKING_SET',
    priority: 0,
    payload: {
      ticketId,
      userId: getCurrentUserId(),
      payloadUpdates: {
        customerMarking,
        customerMarkings: customerMarking,
      },
    },
  });
}

/**
 * Create a TICKET_NOTE_ADDED event (P0 priority)
 */
export function createTicketNoteEvent(params: {
  noteId: string;
  ticketId: string;
  ticketNumber: string;
  body: string;
  noteType: 'INTERNAL' | 'DISPATCH';
  authorId: string;
  authorName: string;
  createdAt: number;
}) {
  return createOutboxEvent({
    type: 'TICKET_NOTE_ADDED',
    priority: 0,
    payload: {
      noteId: params.noteId,
      ticketId: params.ticketId,
      ticketNumber: params.ticketNumber,
      body: params.body,
      noteType: params.noteType,
      authorId: params.authorId,
      authorName: params.authorName,
      createdAt: params.createdAt,
      userId: getCurrentUserId(),
    },
  });
}

/**
 * Create a TICKET_ATTACHMENT_ADDED event (P0 priority)
 * Photos are uploaded as base64. Shares the P0 pipeline so they route to
 * /api/sync/events alongside ticket status/note events.
 */
export function createTicketAttachmentEvent(params: {
  attachmentId: string;
  ticketId: string;
  ticketNumber: string;
  uploaderId: string;
  uploaderName: string;
  kind: 'PHOTO' | 'PDF' | 'OTHER';
  fileName?: string;
  mimeType?: string;
  width?: number;
  height?: number;
  fileSize?: number;
  lat?: number;
  lng?: number;
  dataBase64?: string;
  capturedAt: number;
}) {
  return createOutboxEvent({
    type: 'TICKET_ATTACHMENT_ADDED',
    priority: 0,
    payload: {
      attachmentId: params.attachmentId,
      ticketId: params.ticketId,
      ticketNumber: params.ticketNumber,
      uploaderId: params.uploaderId,
      uploaderName: params.uploaderName,
      kind: params.kind,
      fileName: params.fileName,
      mimeType: params.mimeType,
      width: params.width,
      height: params.height,
      fileSize: params.fileSize,
      lat: params.lat,
      lng: params.lng,
      dataBase64: params.dataBase64,
      capturedAt: params.capturedAt,
      userId: getCurrentUserId(),
    },
  });
}

/**
 * Create a CLOCK_EVENT for timesheet tracking (P1 priority)
 * Lower priority than ticket status changes but still important
 */
export function createClockEvent(params: ClockEventPayload) {
  return createOutboxEvent({
    type: 'CLOCK_EVENT',
    priority: 1, // P1 - important but not as critical as ticket status
    payload: params,
  });
}
