const HONORIFIC_PATTERN = /^(mr|mrs|ms|miss|dr|prof|sir|madam|rev|fr)\.?\s+/i;

export function stripHonorifics(value: string): string {
  if (!value) {
    return '';
  }
  let result = value.trim();
  while (HONORIFIC_PATTERN.test(result)) {
    result = result.replace(HONORIFIC_PATTERN, '').trim();
  }
  return result.replace(/\s+/g, ' ').trim();
}

export function normalizeName(value: string): string {
  return stripHonorifics(value).toLowerCase();
}

