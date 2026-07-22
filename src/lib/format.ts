export const formatILS = (n: number) =>
  new Intl.NumberFormat("he-IL", { style: "currency", currency: "ILS", maximumFractionDigits: 0 }).format(n);

export const formatNum = (n: number) =>
  new Intl.NumberFormat("he-IL", { maximumFractionDigits: 0 }).format(n);

export const formatDateIL = (d: string | Date) => {
  const date = typeof d === "string" ? new Date(d) : d;
  return new Intl.DateTimeFormat("he-IL", { day: "2-digit", month: "2-digit", year: "numeric" }).format(date);
};

export const formatPct = (n: number) => `${Math.round(n)}%`;

export function workdaysRemaining(from = new Date()) {
  const year = from.getFullYear();
  const month = from.getMonth();
  const lastDay = new Date(year, month + 1, 0).getDate();
  let count = 0;
  for (let day = from.getDate(); day <= lastDay; day++) {
    const d = new Date(year, month, day).getDay();
    if (d !== 5 && d !== 6) count++; // Fri=5, Sat=6
  }
  return count;
}

export function workdaysInMonth(from = new Date()) {
  const year = from.getFullYear();
  const month = from.getMonth();
  const lastDay = new Date(year, month + 1, 0).getDate();
  let count = 0;
  for (let day = 1; day <= lastDay; day++) {
    const d = new Date(year, month, day).getDay();
    if (d !== 5 && d !== 6) count++;
  }
  return count;
}

export function workdaysPassed(from = new Date()) {
  return workdaysInMonth(from) - workdaysRemaining(from);
}
