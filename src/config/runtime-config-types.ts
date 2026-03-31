export interface RuntimeConfigEntryRecord {
  key: string;
  value: string;
  sensitive?: boolean;
  updatedAt?: string;
  source?: string;
  sourceOrigin?: string;
}

export interface RuntimeConfigTransport {
  baseUrl: string;
  authToken?: string;
}

export interface RuntimeConfigBootstrapPayload {
  transport: RuntimeConfigTransport;
  entries: RuntimeConfigEntryRecord[];
}

export interface RuntimeConfigWriteOptions {
  sensitive?: boolean;
  source?: string;
  sourceOrigin?: string;
}
