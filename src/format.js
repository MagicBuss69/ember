export function formatNum(n, digits = 0) {
  const value = Number.isFinite(Number(n)) ? Number(n) : 0;
  return value.toLocaleString("sv-SE", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
}

export function formatMaybe(n) {
  const value = Number(n) || 0;
  const digits = Math.abs(value - Math.round(value)) < 0.05 ? 0 : 1;
  return formatNum(value, digits);
}

export function parseNum(v) {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (v == null) return null;
  const n = Number.parseFloat(String(v).trim().replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

export function uid() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return `id-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

export function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[ch]));
}

export function reasonLabel(reason) {
  switch (reason) {
    case "level":
      return "Level up";
    case "full-day":
      return "Full day";
    case "streak":
      return "Streak day";
    case "freeze-refund":
      return "Freeze refund";
    case "penalty":
      return "Penalty";
    default:
      if (typeof reason === "string" && reason.startsWith("shop-")) return "Shop";
      if (typeof reason === "string" && reason.startsWith("life-")) return "Life reward";
      if (typeof reason === "string" && reason.startsWith("streak-")) {
        return `${reason.slice(7)}-day streak`;
      }
      if (typeof reason === "string" && reason.startsWith("theme-")) return "Theme";
      return "Shards";
  }
}

export function ago(ms) {
  const m = Math.max(0, Math.round(ms / 60000));
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return "yesterday";
}
