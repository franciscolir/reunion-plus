export interface BasePayload {
  action: string;
  source?: string;
  timestamp?: string;
}

export interface AttendanceData {
  publishers: number;
  auxiliary: number;
  hours: number;
  visitors?: number;
  notes?: string;
}

export interface AttendancePayload extends BasePayload {
  action: 'attendance';
  month: string;
  week: string;
  data: AttendanceData;
}

export interface PersonData {
  name: string;
  genero?: string;
  calificacion?: string;
  labores?: string[];
  grupoId?: string | number;
  nacimiento?: string;
  bautismo?: string;
  email?: string;
  telefono?: string;
  notas?: string;
}

export interface PersonPayload extends BasePayload {
  action: 'person';
  data: PersonData;
}

export interface AssignmentPayload extends BasePayload {
  action: 'assignment';
  month: string;
  week: string;
  assignments: Record<string, string>;
}

export type WebhookPayload = AttendancePayload | PersonPayload | AssignmentPayload;
