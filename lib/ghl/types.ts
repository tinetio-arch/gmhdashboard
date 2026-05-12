/**
 * GoHighLevel API Type Definitions
 * Single source of truth for GHL types
 */

export type GHLConfig = {
  apiKey: string;
  locationId?: string;
  baseUrl?: string;
};

export type GHLContact = {
  id: string;
  firstName?: string;
  lastName?: string;
  name?: string;
  locationId?: string;
  email?: string;
  phone?: string;
  address1?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
  tags?: string[];
  source?: string;
  assignedTo?: string;
  status?: string;
  customFields?: Array<{
    key?: string;
    id?: string;
    field?: string;
    value: string;
  }>;
  createdAt?: string;
  updatedAt?: string;
};

export type GHLTag = {
  id: string;
  name: string;
  color?: string;
};

export type GHLOpportunity = {
  id: string;
  title: string;
  pipelineId?: string;
  pipelineStageId?: string;
  status?: string;
  monetaryValue?: number;
  assignedTo?: string;
  contactId?: string;
  createdAt?: string;
  updatedAt?: string;
};

export type GHLConversation = {
  id: string;
  locationId: string;
  contactId: string;
  contactName?: string;
  fullName?: string;
  phone?: string;
  lastMessageDate?: number;
  lastMessageType?: string;
  lastMessageBody?: string;
  lastMessageDirection?: 'inbound' | 'outbound';
  lastOutboundMessageAction?: string;
  unreadCount?: number;
  inbox?: boolean;
  type?: string;
  tags?: string[];
  assignedTo?: string;
  dateAdded?: number;
  dateUpdated?: number;
};

export type GHLContactFilter = {
  field: string;
  operator:
  | 'eq'
  | 'not_eq'
  | 'contains'
  | 'not_contains'
  | 'wildcard'
  | 'not_wildcard'
  | 'match'
  | 'not_match'
  | 'exists'
  | 'not_exists'
  | 'range'
  | 'contains_set'
  | 'contains_not_set'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'nested'
  | 'nested_not'
  | 'has_child'
  | 'has_parent';
  value?: unknown;
};

export type GHLContactSearchResponse = {
  contacts?: GHLContact[];
  total?: number;
};
