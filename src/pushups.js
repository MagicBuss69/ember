/** Elbow angle in degrees. 180 is a straight arm, smaller is a bent push-up. */
export const PUSHUP_DOWN_ANGLE = 95;
export const PUSHUP_UP_ANGLE = 155;
export const PUSHUP_MIN_LIKELIHOOD = 0.55;
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

function armAngle(arm) {
  if (!arm || !(arm.likelihood >= PUSHUP_MIN_LIKELIHOOD)) return null;
  return elbowAngle(arm.shoulder, arm.elbow, arm.wrist);
}

/** Prefer the arm the camera can see. Matches PushupCounter.kt. */
export function bestElbowAngle(arms) {
  const left = armAngle(arms?.left);
  const right = armAngle(arms?.right);
  if (left == null) return right;
  if (right == null) return left;
  const leftSeen = arms.left.likelihood;
  const rightSeen = arms.right.likelihood;
  return rightSeen > leftSeen ? right : left;
}

export function createRepCounter() {
  return { phase: "up", reps: 0 };
}

/**
 * A rep is a down-then-up: the elbow closes to DOWN_ANGLE, then opens to UP_ANGLE.
 * Missing frames do not invent a rep.
 */
export function stepRepCounter(counter, arms) {
  const next = { phase: counter?.phase === "down" ? "down" : "up", reps: Math.max(0, Number(counter?.reps) || 0) };
  const angle = bestElbowAngle(arms);
  if (angle == null) return next;
  if (next.phase === "up" && angle <= PUSHUP_DOWN_ANGLE) next.phase = "down";
  else if (next.phase === "down" && angle >= PUSHUP_UP_ANGLE) {
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
