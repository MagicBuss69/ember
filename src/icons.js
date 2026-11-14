const stroke = (body) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

const PATHS = {
  sun: `<circle cx="12" cy="12" r="3.2"/><path d="M12 3.5v1.8M12 18.7v1.8M3.5 12h1.8M18.7 12h1.8M6 6l1.3 1.3M16.7 16.7 18 18M18 6l-1.3 1.3M7.3 16.7 6 18"/>`,
  calendar: `<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M8 3.5V7M16 3.5V7M4 10h16"/>`,
  dumbbell: `<path d="M6.5 9v6M17.5 9v6M4 10.5v3M20 10.5v3M6.5 12h11"/>`,
  people: `<circle cx="9" cy="9" r="2.2"/><circle cx="16" cy="9.5" r="1.8"/><path d="M4.8 18.5c.6-2.6 2.4-4 4.2-4s3.6 1.4 4.2 4M13.2 14.6c1.3-.5 2.6-.6 3.6-.2 1.4.5 2.3 1.8 2.6 4.1"/>`,
  user: `<circle cx="12" cy="9" r="2.6"/><path d="M6.2 18.8c.8-3 2.8-4.6 5.8-4.6s5 1.6 5.8 4.6"/>`,
  chevL: `<path d="M14.5 5.5 8.5 12l6 6.5"/>`,
  chevR: `<path d="M9.5 5.5 15.5 12l-6 6.5"/>`,
  close: `<path d="M6 6l12 12M18 6 6 18"/>`,
  plus: `<path d="M12 6v12M6 12h12"/>`,
  bell: `<path d="M6.5 16.5h11l-1.1-1.6V10a4.4 4.4 0 0 0-8.8 0v4.9L6.5 16.5Z"/><path d="M10 16.5a2 2 0 0 0 4 0"/>`,
  download: `<path d="M12 4.5v10M8 11l4 4 4-4M5.5 19h13"/>`,
  upload: `<path d="M12 15.5v-10M8 8.5 12 4.5l4 4M5.5 19h13"/>`,
  trash: `<path d="M5 7.5h14M9.5 7.5V5.8h5V7.5M8 7.5l.7 11h6.6l.7-11"/>`,
  back: `<path d="M15 5.5 8.5 12 15 18.5M9 12h9"/>`,
  flame: `<path d="M12 3.5s4.5 3.2 4.5 7.2c0 2.4-1.6 4-3.2 4.6 1-.8 1.4-2 1.2-3.2C13.8 13.6 12 14.8 12 17c-2.8-.4-5-2.6-5-5.8C7 7.2 12 3.5 12 3.5Z"/>`,
  grip: `<circle cx="9.5" cy="7" r="1" fill="currentColor"/><circle cx="14.5" cy="7" r="1" fill="currentColor"/><circle cx="9.5" cy="12" r="1" fill="currentColor"/><circle cx="14.5" cy="12" r="1" fill="currentColor"/><circle cx="9.5" cy="17" r="1" fill="currentColor"/><circle cx="14.5" cy="17" r="1" fill="currentColor"/>`,
  up: `<path d="M12 18V6M7 11l5-5 5 5"/>`,
  down: `<path d="M12 6v12M7 13l5 5 5-5"/>`,
};

export function icon(name) {
  return stroke(PATHS[name] || "");
}

export function gemIcon() {
  return `<svg class="gem-svg" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 1.7 20.2 7.2v9.6L12 22.3 3.8 16.8V7.2L12 1.7Z"/><path fill="#06342c" fill-opacity=".45" d="m12 1.7 8.2 5.5L12 12 3.8 7.2 12 1.7Z"/><path fill="#d9fff4" fill-opacity=".55" d="M12 1.7 16.2 8.4 12 12 7.8 8.4 12 1.7Z"/></svg>`;
}

const AVATARS = {
  you: `
    <circle cx="32" cy="32" r="32" fill="#ff8a3d"/>
    <circle cx="32" cy="26" r="9" fill="#2a1408"/>
    <path d="M15 54c3.2-10 8.2-14 17-14s13.8 4 17 14" fill="#2a1408"/>`,
  leo: `
    <circle cx="32" cy="32" r="32" fill="#c4623a"/>
    <path d="M16 30c1-12 7-18 16-18s15 6 16 18c-3-4-8-6-16-6s-13 2-16 6Z" fill="#3b2418"/>
    <circle cx="32" cy="30" r="11" fill="#f3c7a6"/>
    <circle cx="28" cy="30" r="1.3" fill="#3b2418"/>
    <circle cx="36.5" cy="30" r="1.3" fill="#3b2418"/>
    <path d="M27 35.2c1.4 1.2 2.6 1.6 5 1.4" stroke="#c4846a" stroke-width="1.2" fill="none" stroke-linecap="round"/>
    <path d="M17 52c3-9 8-13 15-13s12 4 15 13" fill="#f3c7a6"/>`,
  maja: `
    <circle cx="32" cy="32" r="32" fill="#a84b68"/>
    <path d="M14 34c0-16 6-24 18-24s18 8 18 22c-2 6-6 8-8 8-1-8-4-14-10-14s-9 6-10 14c-3-1-8-2-8-6Z" fill="#2a1420"/>
    <circle cx="32" cy="31" r="10.5" fill="#f6d0c0"/>
    <circle cx="28.2" cy="31" r="1.25" fill="#3a2430"/>
    <circle cx="36" cy="31" r="1.25" fill="#3a2430"/>
    <path d="M27.2 36c1.5 1.1 2.8 1.4 4.8 1.2" stroke="#d39286" stroke-width="1.2" fill="none" stroke-linecap="round"/>
    <path d="M18 53c2.6-8 7.4-12 14-12s11.4 4 14 12" fill="#f6d0c0"/>`,
  noah: `
    <circle cx="32" cy="32" r="32" fill="#3c6f90"/>
    <path d="M18 28c1.5-10 7-16 14-16s12.5 6 14 16c-3-3-7-5-14-5s-11 2-14 5Z" fill="#e6c98a"/>
    <circle cx="32" cy="30" r="11" fill="#f6d3b6"/>
    <circle cx="28" cy="30" r="1.3" fill="#3a2a22"/>
    <circle cx="36.4" cy="30" r="1.3" fill="#3a2a22"/>
    <path d="M27 35.4c1.6 1 3 1.3 5 .9" stroke="#d59a7c" stroke-width="1.2" fill="none" stroke-linecap="round"/>
    <path d="M17 52c3-9 8-13 15-13s12 4 15 13" fill="#f6d3b6"/>`,
  amina: `
    <circle cx="32" cy="32" r="32" fill="#1f7a6d"/>
    <circle cx="32" cy="16" r="6" fill="#24160f"/>
    <path d="M16 33c1-11 6-16 16-17 8 0 14 5 16 15-4-2-8-1-10 2-2-6-6-8-10-8-5 0-9 3-12 8Z" fill="#24160f"/>
    <circle cx="32" cy="31" r="10.5" fill="#c68658"/>
    <circle cx="28.2" cy="31" r="1.25" fill="#2a160f"/>
    <circle cx="36" cy="31" r="1.25" fill="#2a160f"/>
    <path d="M27.4 36c1.4 1.2 2.7 1.5 4.7 1.2" stroke="#8d5a3c" stroke-width="1.2" fill="none" stroke-linecap="round"/>
    <path d="M18 53c2.8-8 7.6-12 14-12s11.2 4 14 12" fill="#c68658"/>`,
};

export function avatar(id) {
  return `<svg class="avatar" viewBox="0 0 64 64" aria-hidden="true">${AVATARS[id] || AVATARS.you}</svg>`;
}
