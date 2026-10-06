// Subset of the official Gmail API v1 resource shapes used by this app.
// Reference: https://developers.google.com/workspace/gmail/api/reference/rest

export interface GmailHeader {
  name: string;
  value: string;
}

export interface GmailMessageRef {
  id: string;
  threadId: string;
}

export interface GmailMessage extends GmailMessageRef {
  labelIds?: string[];
  snippet?: string;
  historyId?: string;
  internalDate?: string;
  sizeEstimate?: number;
  payload?: {
    mimeType?: string;
    headers?: GmailHeader[];
  };
}

export interface ListMessagesResponse {
  messages?: GmailMessageRef[];
  nextPageToken?: string;
  resultSizeEstimate?: number;
}

export interface GmailProfile {
  emailAddress: string;
  messagesTotal: number;
  threadsTotal: number;
  historyId: string;
}

export interface GmailLabel {
  id: string;
  name: string;
  type?: "system" | "user";
  messagesTotal?: number;
  messagesUnread?: number;
}

export interface HistoryMessageChange {
  message: GmailMessageRef & { labelIds?: string[] };
}

export interface HistoryLabelChange extends HistoryMessageChange {
  labelIds: string[];
}

export interface HistoryRecord {
  id: string;
  messagesAdded?: HistoryMessageChange[];
  messagesDeleted?: HistoryMessageChange[];
  labelsAdded?: HistoryLabelChange[];
  labelsRemoved?: HistoryLabelChange[];
}

export interface ListHistoryResponse {
  history?: HistoryRecord[];
  nextPageToken?: string;
  historyId: string;
}
