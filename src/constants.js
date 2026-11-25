export const TZ = "Europe/Stockholm";

export const XP_TASK = 25;
export const XP_WORKOUT = 40;

export const CRYSTAL_LEVEL = 6;
export const CRYSTAL_FULL = 3;
export const CRYSTAL_STREAK_DAY = 1;
export const CRYSTAL_MILESTONES = { 7: 4, 14: 6, 30: 10 };

/** Total XP required to arrive at each level. Index 0 is level 1. */
export const LEVEL_START = [0, 50, 150, 300, 500, 750, 1100, 1550, 2100, 2800];

export const SLOTS = ["morning", "afternoon", "evening"];

export const SLOT_LABEL = {
  morning: "Morning",
  afternoon: "Afternoon",
  evening: "Evening",
};

export const THEMES = [
  { id: "ember", name: "Ember", price: 0, blurb: "Warm dark. The original flame." },
  { id: "frost", name: "Frost", price: 0, blurb: "Flagship System window — cold glass and ice." },
  { id: "pine", name: "Pine", price: 10, blurb: "Deep green grove. Quiet hunter nights." },
  { id: "ink", name: "Ink", price: 14, blurb: "Black vault with gold seams." },
  { id: "aurora", name: "Aurora", price: 18, blurb: "Teal-violet sky shimmer." },
  { id: "blood", name: "Blood", price: 22, blurb: "Crimson penalty glow. Hard mode vibes." },
  { id: "dusk", name: "Dusk", price: 16, blurb: "Violet sky with a sunset edge.", art: "theme-ember", hue: 290 },
  { id: "ocean", name: "Ocean", price: 20, blurb: "Deep navy, cyan foam.", art: "theme-frost", hue: 340 },
  { id: "sakura", name: "Sakura", price: 24, blurb: "Night bloom, soft pink.", art: "theme-blood", hue: 320 },
  { id: "toxic", name: "Toxic", price: 26, blurb: "Acid green terminal glow.", art: "theme-pine", hue: 30 },
  { id: "royal", name: "Royal", price: 30, blurb: "Monarch purple and gold.", art: "theme-ink", hue: 230 },
];

export const GEMINI_MODELS = ["gemini-4-neon", "gemini-2.5-flash", "gemini-flash-latest"];

/** In-app coach and rival chat. Neon is paid-tier; the fallback stays on the free models. */
export const CHAT_GEMINI_MODEL = "gemini-4-neon";
export const CHAT_GEMINI_FALLBACK_MODEL = "gemini-3.5-flash-lite";

export const DEFAULT_GOALS =
  "Get better at programming, train three times a week, sleep before 23:00, and feel more comfortable talking to people.";

export const WEEKDAY_QUESTS = [
  {
    slot: "morning",
    title: "Get outside for 10 minutes",
    why: "Light and cold air wake you up faster than your phone.",
    time: "07:20",
  },
  {
    slot: "morning",
    title: "Make your bed",
    why: "One finished thing before the day starts.",
    time: "07:35",
  },
  {
    slot: "afternoon",
    title: "45 minutes of focused coding",
    why: "Skill grows in one unbroken block, not in tabs.",
    time: "16:00",
  },
  {
    slot: "evening",
    title: "Train or walk for 20 minutes",
    why: "A day feels finished when your body has worked.",
    time: "18:30",
  },
  {
    slot: "evening",
    title: "Plan tomorrow in five lines",
    why: "Morning-you shouldn't have to decide from scratch.",
    time: "21:15",
  },
];

export const WEEKEND_QUESTS = [
  {
    slot: "morning",
    title: "Easy start, then a walk",
    why: "Daylight first, phone second.",
    time: "09:30",
  },
  {
    slot: "afternoon",
    title: "Build something for an hour",
    why: "One real thing, not a tour of apps.",
    time: "14:00",
  },
  {
    slot: "evening",
    title: "Be with people, or actually rest",
    why: "Both count. Doomscrolling doesn't.",
    time: "19:00",
  },
];

/** Quick-pick chips for a session's split. Lifts are tracked in Hevy; Ember only logs the day. */
export const SPLIT_CHIPS = {
  strength: ["Push", "Pull", "Legs", "Upper", "Lower", "Full body"],
  cardio: ["Run", "Bike", "Walk", "Swim", "Intervals"],
};
