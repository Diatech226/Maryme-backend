/** Converts a reasonably formatted international number to its canonical E.164 form. */
export function normalizePhoneNumber(value: string): string {
  const compact = value.trim().replace(/[\s().-]/g, '');
  const normalized = compact.startsWith('00') ? `+${compact.slice(2)}` : compact;
  if (!/^\+[1-9]\d{7,14}$/.test(normalized)) {
    throw new Error('Le numéro de téléphone doit être un numéro international valide (E.164).');
  }
  return normalized;
}
