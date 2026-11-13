import { formatNum } from "./format.js";

function n(value) {
  return formatNum(value);
}

export function describeSameDay({ todayXp, thenXp, weekdayName }) {
  const name = weekdayName;
  if (thenXp <= 0 && todayXp <= 0) {
    return {
      mode: "empty",
      delta: 0,
      tone: "even",
      kicker: `Last ${name}`,
      headline: `Last ${name}'s you was quiet too.`,
      detail: "The first quest you finish becomes the ghost to beat.",
    };
  }
  if (thenXp <= 0) {
    return {
      mode: "score",
      delta: todayXp,
      tone: "ahead",
      kicker: `Last ${name}`,
      headline: `You're ${n(todayXp)} XP ahead of last ${name}'s you.`,
      detail: "They logged nothing that day. This is a clean lead.",
    };
  }
  const delta = todayXp - thenXp;
  if (delta > 0) {
    return {
      mode: "score",
      delta,
      tone: "ahead",
      kicker: `Last ${name}`,
      headline: `You're ${n(delta)} XP ahead of last ${name}'s you.`,
      detail: "That day is already finished. Yours is still going.",
    };
  }
  if (delta < 0) {
    const gap = -delta;
    let nudge = "The day is still open.";
    if (gap <= 25) nudge = "One quest closes it.";
    else if (gap <= 40) nudge = "A workout would pass it.";
    else nudge = `${Math.ceil(gap / 25)} quests would pass it.`;
    return {
      mode: "score",
      delta,
      tone: "behind",
      kicker: `Last ${name}`,
      headline: `Last ${name}'s you is ${n(gap)} XP ahead.`,
      detail: `They finished on ${n(thenXp)} XP. You're at ${n(todayXp)}. ${nudge}`,
    };
  }
  return {
    mode: "score",
    delta: 0,
    tone: "even",
    kicker: `Last ${name}`,
    headline: `You're level with last ${name}'s you.`,
    detail: "Anything you finish now takes the lead.",
  };
}

export function describeWeekPace({ thisXp, paceXp, hasHistory }) {
  if (!hasHistory && thisXp <= 0) {
    return {
      tone: "even",
      headline: "No ghost for last week yet.",
      detail: "Finish a few quests. Next week, this one shows up as the rival.",
    };
  }
  if (!hasHistory) {
    return {
      tone: "ahead",
      headline: `This week is ${n(thisXp)} XP, with no last week to chase.`,
      detail: "Next Monday, today's pace becomes the ghost.",
    };
  }
  const delta = thisXp - paceXp;
  if (delta > 0) {
    return {
      tone: "ahead",
      headline: `This week is ${n(delta)} XP ahead of last week's pace.`,
      detail: `By this point last week you had ${n(paceXp)} XP.`,
    };
  }
  if (delta < 0) {
    return {
      tone: "behind",
      headline: `Last week's pace is ${n(-delta)} XP ahead.`,
      detail: `By now last week you had ${n(paceXp)} XP. You're at ${n(thisXp)}.`,
    };
  }
  return {
    tone: "even",
    headline: "This week is pacing last week exactly.",
    detail: `${n(thisXp)} XP at the same point.`,
  };
}

export function describeBest({ thisXp, bestXp, bestLabel, isThisWeek }) {
  if (!bestXp) {
    return {
      tone: "even",
      headline: "No best week yet.",
      detail: "Your first week with XP becomes the mark on the wall.",
    };
  }
  if (isThisWeek || thisXp >= bestXp) {
    return {
      tone: "ahead",
      headline: "This is your best week.",
      detail: `${n(thisXp)} XP and counting. Next week it will be the one to beat.`,
    };
  }
  const gap = bestXp - thisXp;
  return {
    tone: "behind",
    headline: `${n(gap)} XP behind your best week.`,
    detail: `${bestLabel} ended on ${n(bestXp)} XP. You're at ${n(thisXp)}.`,
  };
}
