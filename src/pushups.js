/** Elbow angle in degrees. 180 is a straight arm, smaller is a bent push-up. */
export const PUSHUP_DOWN_ANGLE = 110;
export const PUSHUP_UP_ANGLE = 150;
export const PUSHUP_MIN_LIKELIHOOD = 0.3;
/** Weight of the newest frame in the smoother. */
export const PUSHUP_EMA = 0.7;
/** Shoulder drop below the plank baseline, in shoulder-widths. */
export const PUSHUP_DROP_DOWN = 0.35;
export const PUSHUP_DROP_UP = 0.12;
export const PUSHUP_CALIBRATION_MS = 2000;
export const PUSHUP_REP_GAP_MS = 500;
export const DEFAULT_UNLOCK_MINUTES = 15;
export const DEFAULT_PUSHUP_MAX = 10;
/** Heads-up this long before an unlock window ends. */
export const UNLOCK_WARN_MS = 60 * 1000;

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

/**
 * Shoulder-line height above the wrists, in units of shoulder width.
 * Larger means the shoulders are higher above the wrists. Camera distance cancels out.
 */
export function shoulderHeight(leftShoulder, rightShoulder, leftWrist, rightWrist) {
  if (!leftShoulder || !rightShoulder) return null;
  const width = dist(leftShoulder, rightShoulder);
  if (!(width > 1e-3)) return null;
  const midY = (leftShoulder.y + rightShoulder.y) / 2;
  const wrists = [leftWrist, rightWrist].filter((wrist) => wrist && Number.isFinite(wrist.y));
  if (!wrists.length) return null;
  let wristY;
  if (
    wrists.length === 2 &&
    Number.isFinite(leftWrist.likelihood) &&
    Number.isFinite(rightWrist.likelihood)
  ) {
    if (Math.abs(leftWrist.likelihood - rightWrist.likelihood) <= 0.2) wristY = (leftWrist.y + rightWrist.y) / 2;
    else wristY = leftWrist.likelihood >= rightWrist.likelihood ? leftWrist.y : rightWrist.y;
  } else {
    wristY = wrists[0].y;
  }
  return (wristY - midY) / width;
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

function finite(value) {
  return Number.isFinite(value) ? value : null;
}

function armReading(arm) {
  if (!arm || !(arm.likelihood >= PUSHUP_MIN_LIKELIHOOD)) return null;
  const angle = elbowAngle(arm.shoulder, arm.elbow, arm.wrist);
  if (angle == null) return null;
  return { angle, likelihood: arm.likelihood };
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
    return { angle: average(left.angle, right.angle), seen: true };
  }
  const pick = !left ? right : !right ? left : left.likelihood >= right.likelihood ? left : right;
  return { angle: pick.angle, seen: true };
}

export function bestElbowAngle(arms) {
  return combineArms(arms).angle;
}

export function createRepCounter() {
  return {
    phase: "up",
    reps: 0,
    angle: null,
    height: null,
    baseline: null,
    calibrating: true,
    calibSamples: [],
    calibStartedAt: null,
    lastRepAt: null,
  };
}

function ema(prev, sample) {
  if (sample == null) return prev;
  if (prev == null) return sample;
  return PUSHUP_EMA * sample + (1 - PUSHUP_EMA) * prev;
}

function sampleOf(input) {
  const fromArms = input && (input.left || input.right) ? combineArms(input) : null;
  const angle = finite(input?.angle) ?? fromArms?.angle ?? null;
  let height = finite(input?.height);
  if (height == null && input?.leftShoulder && input?.rightShoulder) {
    height = shoulderHeight(input.leftShoulder, input.rightShoulder, input.leftWrist, input.rightWrist);
  }
  return { angle, height };
}

/**
 * Main signal: shoulder-line height versus the wrists, compared with a plank baseline.
 * Elbow angle can also complete the same rep. Two signals inside 0.5s count once.
 */
export function stepRepCounter(counter, input) {
  const next = {
    phase: counter?.phase === "down" ? "down" : "up",
    reps: Math.max(0, Math.round(Number(counter?.reps) || 0)),
    angle: finite(counter?.angle),
    height: finite(counter?.height),
    baseline: finite(counter?.baseline),
    calibrating: counter?.calibrating !== false,
    calibSamples: Array.isArray(counter?.calibSamples) ? counter.calibSamples.slice() : [],
    calibStartedAt: finite(counter?.calibStartedAt),
    lastRepAt: finite(counter?.lastRepAt),
  };
  const t = finite(input?.t) ?? (next.lastRepAt == null ? 0 : next.lastRepAt + PUSHUP_REP_GAP_MS);
  if (input?.manual) {
    next.reps += 1;
    next.phase = "up";
    next.calibrating = false;
    next.lastRepAt = t;
    return next;
  }
  const sample = sampleOf(input || {});
  if (sample.angle == null && sample.height == null) return next;
  next.angle = ema(next.angle, sample.angle);
  next.height = ema(next.height, sample.height);
  if (sample.height != null && next.calibrating) {
    if (next.calibStartedAt == null) next.calibStartedAt = t;
    next.calibSamples.push(sample.height);
    if (t - next.calibStartedAt >= PUSHUP_CALIBRATION_MS && next.calibSamples.length >= 4) {
      next.baseline = median(next.calibSamples);
      next.calibrating = false;
    } else {
      return next;
    }
  }
  const travel = next.baseline != null && next.height != null ? next.baseline - next.height : null;
  const shoulderDown = travel != null && travel >= PUSHUP_DROP_DOWN;
  const shoulderUp = travel != null && travel <= PUSHUP_DROP_UP;
  const angleDown = next.angle != null && next.angle <= PUSHUP_DOWN_ANGLE;
  const angleUp = next.angle != null && next.angle >= PUSHUP_UP_ANGLE;
  const down = shoulderDown || angleDown;
  const up = shoulderUp || angleUp;
  if (next.phase === "up" && down) next.phase = "down";
  else if (next.phase === "down" && up && !down) {
    next.phase = "up";
    if (next.lastRepAt == null || t - next.lastRepAt >= PUSHUP_REP_GAP_MS) {
      next.reps += 1;
      next.lastRepAt = t;
    }
  }
  return next;
}

export function raisePushupMax(current, reps) {
  const done = Math.max(0, Math.round(Number(reps) || 0));
  const max = clampPushupMax(current);
  return done > max ? clampPushupMax(done) : max;
}

/**
 * Push-up mode blocks until an unlock timestamp. Quest mode blocks until the day
 * is done. A running unlock (push-ups or a redeemed reward) opens the app in both modes.
 */
export function shouldGatePackage({ blockMode, locked, packages, packageName, unlockUntil = 0, now = 0 }) {
  if (!Array.isArray(packages) || !packages.includes(packageName)) return false;
  if (Number(unlockUntil) > Number(now)) return false;
  if (blockMode === "quests") return Boolean(locked);
  return true;
}

/**
 * Unlock windows loop. `unlocks` maps a package to the epoch ms it stays open.
 * Entries at or before `now` are due to relock. The soonest future entry is the
 * next exact alarm, with a warning one minute before that moment when it is
 * still ahead.
 */
export function planUnlockLoop(unlocks, now = 0, warnMs = UNLOCK_WARN_MS) {
  const due = [];
  let nextExpiry = null;
  let nextPackage = null;
  const entries = unlocks && typeof unlocks === "object" ? Object.entries(unlocks) : [];
  for (const [pkg, untilRaw] of entries) {
    if (!pkg) continue;
    const until = Number(untilRaw);
    if (!Number.isFinite(until) || until <= 0) continue;
    if (until <= now) {
      due.push(pkg);
      continue;
    }
    if (nextExpiry == null || until < nextExpiry || (until === nextExpiry && pkg < nextPackage)) {
      nextExpiry = until;
      nextPackage = pkg;
    }
  }
  due.sort();
  const warnAt = nextExpiry != null && nextExpiry - warnMs > now ? nextExpiry - warnMs : null;
  return { due, nextPackage, nextExpiry, warnAt };
}
