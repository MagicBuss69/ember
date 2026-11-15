/** Elbow angle in degrees. 180 is a straight arm, smaller is a bent push-up. */
export const PUSHUP_DOWN_ANGLE = 110;
export const PUSHUP_UP_ANGLE = 150;
export const PUSHUP_MIN_LIKELIHOOD = 0.3;
/** Weight of the newest frame in the elbow/fold smoother. */
export const PUSHUP_EMA = 0.7;
/** Wrist pulled in toward the shoulder (0 straight, higher when folded). */
export const PUSHUP_FOLD_DOWN = 0.28;
export const PUSHUP_FOLD_UP = 0.12;
export const DEFAULT_UNLOCK_MINUTES = 15;
export const DEFAULT_PUSHUP_MAX = 10;

export function clampUnlockMinutes(value) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return DEFAULT_UNLOCK_MINUTES;
  return Math.max(1, Math.min(180, n));
}

export function clampPushupMax(value) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return DEFAULT_PUSHUP_MAX;
  return Math.max(1, Math.min(300, n));
}

export function elbowAngle(shoulder, elbow, wrist) {
  if (!shoulder || !elbow || !wrist) return null;
  const ax = shoulder.x - elbow.x;
  const ay = shoulder.y - elbow.y;
  const bx = wrist.x - elbow.x;
  const by = wrist.y - elbow.y;
  const mag = Math.hypot(ax, ay) * Math.hypot(bx, by);
  if (mag < 1e-3) return null;
  const cos = Math.min(1, Math.max(-1, (ax * bx + ay * by) / mag));
  return (Math.acos(cos) * 180) / Math.PI;
}

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** 0 when the arm is straight, higher when the wrist rises toward the shoulder. */
export function armFold(shoulder, elbow, wrist) {
  if (!shoulder || !elbow || !wrist) return null;
  const segments = dist(shoulder, elbow) + dist(elbow, wrist);
  if (segments < 1e-3) return null;
  const span = dist(shoulder, wrist);
  return Math.max(0, Math.min(1, 1 - span / segments));
}

function finite(value) {
  return Number.isFinite(value) ? value : null;
}

function armReading(arm) {
  if (!arm || !(arm.likelihood >= PUSHUP_MIN_LIKELIHOOD)) return null;
  const angle = elbowAngle(arm.shoulder, arm.elbow, arm.wrist);
  const fold = armFold(arm.shoulder, arm.elbow, arm.wrist);
  if (angle == null && fold == null) return null;
  return { angle, fold, likelihood: arm.likelihood };
}

function average(a, b) {
  if (a == null) return b;
  if (b == null) return a;
  return (a + b) / 2;
}

/**
 * Higher-confidence arm wins. When both are similarly visible, average them
 * so a noisy side cannot hide the rep.
 */
export function combineArms(arms) {
  const left = armReading(arms?.left);
  const right = armReading(arms?.right);
  if (!left && !right) return { angle: null, fold: null, seen: false };
  if (left && right && Math.abs(left.likelihood - right.likelihood) <= 0.2) {
    return { angle: average(left.angle, right.angle), fold: average(left.fold, right.fold), seen: true };
  }
  const pick = !left ? right : !right ? left : left.likelihood >= right.likelihood ? left : right;
  return { angle: pick.angle, fold: pick.fold, seen: true };
}

export function bestElbowAngle(arms) {
  return combineArms(arms).angle;
}

export function createRepCounter() {
  return { phase: "up", reps: 0, angle: null, fold: null };
}

function ema(prev, sample) {
  if (sample == null) return prev;
  if (prev == null) return sample;
  return PUSHUP_EMA * sample + (1 - PUSHUP_EMA) * prev;
}

function sampleOf(input) {
  if (input && (input.left || input.right)) return combineArms(input);
  const angle = finite(input?.angle);
  const fold = finite(input?.fold);
  return { angle, fold, seen: angle != null || fold != null };
}

/**
 * Down below ~110° (or wrists folded up toward the shoulders). Up above ~150°
 * (or arms extended again). A missing frame does not move the count.
 */
export function stepRepCounter(counter, input) {
  const next = {
    phase: counter?.phase === "down" ? "down" : "up",
    reps: Math.max(0, Math.round(Number(counter?.reps) || 0)),
    angle: finite(counter?.angle),
    fold: finite(counter?.fold),
  };
  if (input?.manual) {
    next.reps += 1;
    next.phase = "up";
    return next;
  }
  const sample = sampleOf(input);
  if (sample.angle == null && sample.fold == null) return next;
  next.angle = ema(next.angle, sample.angle);
  next.fold = ema(next.fold, sample.fold);
  const angleDown = next.angle != null && next.angle <= PUSHUP_DOWN_ANGLE;
  const angleUp = next.angle != null && next.angle >= PUSHUP_UP_ANGLE;
  const foldDown = next.fold != null && next.fold >= PUSHUP_FOLD_DOWN;
  const foldUp = next.fold != null && next.fold <= PUSHUP_FOLD_UP;
  const down = angleDown || (next.angle == null && foldDown) || (next.angle != null && next.angle <= 130 && foldDown);
  const up = angleUp || (next.angle == null && foldUp);
  if (next.phase === "up" && down && !up) next.phase = "down";
  else if (next.phase === "down" && up && !down) {
    next.phase = "up";
    next.reps += 1;
  }
  return next;
}

export function raisePushupMax(current, reps) {
  const done = Math.max(0, Math.round(Number(reps) || 0));
  const max = clampPushupMax(current);
  return done > max ? clampPushupMax(done) : max;
}

/** Push-up mode blocks until an unlock timestamp. Quest mode blocks until the day is done. */
export function shouldGatePackage({ blockMode, locked, packages, packageName, unlockUntil = 0, now = 0 }) {
  if (!Array.isArray(packages) || !packages.includes(packageName)) return false;
  if (blockMode === "quests") return Boolean(locked);
  return !(Number(unlockUntil) > Number(now));
}
