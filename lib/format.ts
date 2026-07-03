/** Locale-aware formatting helpers (dates, hours). */

export function formatHours(locale: string, minutes: number, unit: string): string {
  const value = new Intl.NumberFormat(locale, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(minutes / 60);
  return `${value} ${unit}`;
}

export function formatDate(locale: string, date: Date | string): string {
  return new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(date));
}
