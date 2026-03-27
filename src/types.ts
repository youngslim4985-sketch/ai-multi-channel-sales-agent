export type SalesStage = 'INITIAL' | 'QUALIFYING' | 'CONTACT_COLLECTION' | 'SCHEDULING' | 'FOLLOW_UP';
export type LeadScore = 'HOT' | 'WARM' | 'COLD';
export type LeadSource = 'WEB' | 'FB' | 'IG';

export interface Lead {
  id?: string;
  uid: string;
  name?: string;
  email?: string;
  phone?: string;
  status: SalesStage;
  score: LeadScore;
  source: LeadSource;
  intent?: string;
  createdAt: string;
  lastInteraction: string;
}

export interface Appointment {
  id?: string;
  uid: string;
  leadId: string;
  scheduledAt: string;
  type: string;
  notes?: string;
  createdAt: string;
}

export interface Message {
  id?: string;
  leadId: string;
  role: 'user' | 'model';
  content: string;
  timestamp: string;
}

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string;
    email?: string | null;
    emailVerified?: boolean;
    isAnonymous?: boolean;
    tenantId?: string | null;
  }
}
