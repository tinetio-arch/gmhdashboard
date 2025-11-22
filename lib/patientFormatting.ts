const STATUS_ROW_COLOR_MAP: Record<string, string> = {
  'active': '#d9ead3',
  'active - pending': '#fff2cc',
  'hold - payment research': '#f4cccc',
  'hold - patient research': '#f4cccc',
  'hold - service change': '#f4cccc',
  'hold - contract renewal': '#f4cccc',
  'inactive': '#f4cccc'
};

const STATUS_ALERT_COLOR_MAP: Record<string, string> = {
  'active': '#b7e1c0',
  'active - pending': '#ffe08a',
  'hold - payment research': '#f4b7b9',
  'hold - patient research': '#f4b7b9',
  'hold - service change': '#b4a7d6',
  'hold - contract renewal': '#c5b3e6',
  'inactive': '#d9d9d9'
};

const PAYMENT_COLOR_MAP: Record<string, string> = {
  'jane': '#b6d7a8',
  'qbo': '#ffe599',
  'quickbooks': '#ffe599',
  'jane & quickbooks': '#a4c2f4',
  'jane and quickbooks': '#a4c2f4',
  'jane_quickbooks': '#a4c2f4',
  'both': '#a4c2f4',
  'pro-bono': '#b6d7a8',
  'pro bono': '#b6d7a8'
};

const TYPE_COLOR_MAP: Record<string, string> = {
  'primecare elite $100/month': '#6fa8dc',
  'primecare premier $50/month': '#8e7cc3',
  'ins. supp. $60/month': '#93c47d',
  'insurance supplemental': '#93c47d',
  'jane tcmh ins sup. $60/month': '#93c47d',
  'jane tcmh $180/month': '#f6b26b',
  'qbo tcmh $180/month': '#f6b26b',
  'jane f&f/fr/veteran $140/month': '#ffd966',
  'qbo f&f/fr/veteran $140/month': '#ffd966',
  'mixed - primecare (jane) | qbo tcmh': '#76a5af',
  'mixed primcare (jane) | qbo tcmh': '#76a5af',
  'mixed_primcare_jane_qbo_tcmh': '#76a5af',
  "men's health (qbo)": '#f6b26b',
  'approved disc / pro-bono pt': '#a64d79'
};

const PRIMARY_CARE_TYPE_KEYS = new Set([
  'primecare elite $100/month',
  'primecare premier $50/month',
  'mixed - primecare (jane) | qbo tcmh',
  'ins. supp. $60/month',
  'insurance supplemental',
  'jane tcmh ins sup. $60/month'
]);

const PRIMARY_CARE_ROW_COLOR = '#c9daf8';

export type LabStatusState = 'no-data' | 'overdue' | 'due-soon' | 'current';

export type LabStatusInfo = {
  label: string;
  color: string;
  state: LabStatusState;
};

function parseFlexibleDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const trimmed = value.toString().trim();
  if (!trimmed) return null;

  const direct = new Date(trimmed);
  if (!Number.isNaN(direct.getTime())) {
    return new Date(direct.getFullYear(), direct.getMonth(), direct.getDate());
  }

  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
    const [year, month, day] = trimmed.split(/[-T]/).map(Number);
    if (!Number.isNaN(year) && !Number.isNaN(month) && !Number.isNaN(day)) {
      return new Date(year, month - 1, day);
    }
  }

  const parts = trimmed.split(/[\/\.\-]/).map((part) => part.trim());
  if (parts.length === 3) {
    const month = Number(parts[0]);
    const day = Number(parts[1]);
    let year = Number(parts[2]);
    if (!Number.isNaN(month) && !Number.isNaN(day) && !Number.isNaN(year)) {
      if (year < 100) {
        year += year < 50 ? 2000 : 1900;
      }
      return new Date(year, month - 1, day);
    }
  }

  const asNumber = Number(trimmed);
  if (!Number.isNaN(asNumber)) {
    const fromNumber = new Date(asNumber);
    if (!Number.isNaN(fromNumber.getTime())) {
      return new Date(fromNumber.getFullYear(), fromNumber.getMonth(), fromNumber.getDate());
    }
  }

  return null;
}

export function computeLabStatus(lastLabValue: string | null, nextLabValue: string | null, today = new Date()): LabStatusInfo {
  const defaultStatus: LabStatusInfo = { label: 'No lab data', color: '#e6e6e6', state: 'no-data' };
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const msPerDay = 24 * 60 * 60 * 1000;

  const nextLabDate = parseFlexibleDate(nextLabValue);
  if (nextLabDate) {
    const daysUntil = Math.floor((nextLabDate.getTime() - todayStart.getTime()) / msPerDay);
    if (!Number.isNaN(daysUntil)) {
      if (daysUntil < 0) {
        return { label: `Overdue by ${Math.abs(daysUntil)} days`, color: '#f4cccc', state: 'overdue' };
      }
      if (daysUntil <= 30) {
        return { label: `Due in ${daysUntil} days`, color: '#fff2cc', state: 'due-soon' };
      }
      return { label: `Current (due in ${daysUntil} days)`, color: '#d9ead3', state: 'current' };
    }
  }

  const lastLabDate = parseFlexibleDate(lastLabValue);
  if (lastLabDate) {
    const daysSince = Math.floor((todayStart.getTime() - lastLabDate.getTime()) / msPerDay);
    if (!Number.isNaN(daysSince)) {
      if (daysSince > 180) {
        return { label: `Overdue (last lab ${daysSince} days ago)`, color: '#f4cccc', state: 'overdue' };
      }
      return { label: `Current (last lab ${daysSince} days ago)`, color: '#d9ead3', state: 'current' };
    }
  }

  return defaultStatus;
}

export type RowColorInfo = {
  rowColor: string;
  statusColor: string;
  paymentColor: string;
  typeColor: string;
};

function normaliseStatusKey(value: string | null): string {
  if (!value) return '';
  const trimmed = value.trim().toLowerCase();
  if (trimmed.startsWith('hold') && !STATUS_ROW_COLOR_MAP[trimmed]) {
    return 'hold - payment research';
  }
  return trimmed;
}

export function deriveRowColors(statusDisplay: string | null, clientTypeDisplay: string | null, paymentMethodDisplay: string | null): RowColorInfo {
  const statusKey = normaliseStatusKey(statusDisplay);
  let rowColor = STATUS_ROW_COLOR_MAP[statusKey] || '#ffffff';

  const clientKey = (clientTypeDisplay ?? '').toLowerCase().trim();
  const paymentKey = (paymentMethodDisplay ?? '').toLowerCase().trim();
  
  // Apply light blue for mixed payment methods (Jane & QuickBooks)
  if (paymentKey.includes('jane') && paymentKey.includes('quickbooks')) {
    rowColor = '#e6f3ff'; // Light blue for mixed payment patients
  } else if (PRIMARY_CARE_TYPE_KEYS.has(clientKey) && (statusKey === 'active' || statusKey === 'active - pending')) {
    rowColor = PRIMARY_CARE_ROW_COLOR;
  }

  const statusColor = STATUS_ALERT_COLOR_MAP[statusKey] || rowColor;
  const paymentColor = PAYMENT_COLOR_MAP[paymentKey] || rowColor;
  const typeColor = TYPE_COLOR_MAP[clientKey] || rowColor;

  return { rowColor, statusColor, paymentColor, typeColor };
}

export const patientFormattingMaps = {
  STATUS_ROW_COLOR_MAP,
  STATUS_ALERT_COLOR_MAP,
  PAYMENT_COLOR_MAP,
  TYPE_COLOR_MAP,
  PRIMARY_CARE_ROW_COLOR,
  PRIMARY_CARE_TYPE_KEYS
};
