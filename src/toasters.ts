// ─────────────────────────────────────────────────────────
// PRODUCT DATABASE — Edit this file to add/update products.
// All prices are in Indian Rupees (₹).
// ─────────────────────────────────────────────────────────

// ── Toasters ─────────────────────────────────────────────

export interface Toaster {
  name: string;
  slices: number;
  type: string;
  price: number;      // ₹
  bestFor: string;
  features: string[];
}

export const TOASTERS: Toaster[] = [
  {
    name: "Philips HD2582/00",
    slices: 2,
    type: "Pop-up",
    price: 2399,
    bestFor: "Most households",
    features: [
      "8 browning settings",
      "Extra-wide self-centering slots",
      "Defrost and reheat functions",
      "Cancel button",
      "Removable crumb tray",
      "High-lift lever",
    ],
  },
  {
    name: "Bajaj ATX 4",
    slices: 2,
    type: "Pop-up",
    price: 1593,
    bestFor: "Budget buyers",
    features: [
      "750W heating",
      "Variable browning control",
      "Auto pop-up",
      "Mid-cycle cancel",
      "Removable crumb tray",
      "Cord storage",
    ],
  },
  {
    name: "Havells Crisp Plus",
    slices: 2,
    type: "Pop-up",
    price: 2090,
    bestFor: "Daily family use",
    features: [
      "700W operation",
      "6 browning levels",
      "Reheat and cancel functions",
      "Dust cover included",
      "Cool-touch body",
      "Crumb tray",
    ],
  },
  {
    name: "Prestige PPTPKY",
    slices: 2,
    type: "Pop-up",
    price: 1262,
    bestFor: "Students and small kitchens",
    features: [
      "850W fast heating",
      "Auto bread centering",
      "Variable browning",
      "Cancel function",
      "Slide-out crumb tray",
      "Compact design",
    ],
  },
  {
    name: "Kent Crisp Pop-Up Toaster",
    slices: 2,
    type: "Pop-up",
    price: 1098,
    bestFor: "Value-for-money buyers",
    features: [
      "Wide bread slots",
      "7 toast settings",
      "Auto pop-up",
      "Removable crumb tray",
      "Cancel button",
      "Cool-touch exterior",
    ],
  },

  // ── ADD NEW TOASTERS BELOW ─────────────────────────────
];

// ── Washing Machines ──────────────────────────────────────

export interface WashingMachine {
  name: string;
  capacity: string;
  type: string;
  price: number;      // ₹
  bestFor: string;
  features: string[];
}

export const WASHING_MACHINES: WashingMachine[] = [
  {
    name: "LG T80AJMB1Z",
    capacity: "8 kg",
    type: "Fully Automatic Top Load",
    price: 26390,
    bestFor: "Medium-sized families",
    features: [
      "5 Star energy rating",
      "Smart Inverter Motor",
      "TurboDrum wash",
      "Smart Diagnosis",
      "Auto Restart",
      "Soft Closing Lid",
    ],
  },
  {
    name: "Whirlpool 8 kg 5 Star Top Load",
    capacity: "8 kg",
    type: "Fully Automatic Top Load",
    price: 22990,
    bestFor: "Large families",
    features: [
      "Hard Water Wash",
      "ZPF Technology",
      "Spa Wash System",
      "Express Wash",
      "Auto Tub Clean",
      "Child Lock",
    ],
  },
  {
    name: "Samsung 7 kg 5 Star Top Load",
    capacity: "7 kg",
    type: "Fully Automatic Top Load",
    price: 19600,
    bestFor: "Couples and small families",
    features: [
      "Eco Bubble Wash",
      "Diamond Drum",
      "Magic Filter",
      "Child Lock",
      "Delay End",
      "Digital Inverter Technology",
    ],
  },
  {
    name: "LG FHB1207Z2M",
    capacity: "7 kg",
    type: "Fully Automatic Front Load",
    price: 32240,
    bestFor: "Best cleaning performance",
    features: [
      "AI Direct Drive",
      "Steam Wash",
      "Inverter Direct Drive Motor",
      "Smart Diagnosis",
      "Quick 30 Program",
      "Tub Clean",
    ],
  },
  {
    name: "Samsung WT65R2200LL/TL",
    capacity: "6.5 kg",
    type: "Semi Automatic Top Load",
    price: 9990,
    bestFor: "Budget-conscious families",
    features: [
      "Air Turbo Drying",
      "Rust-proof body",
      "Magic Filter",
      "Rat Protection",
      "Powerful Pulsator",
      "Low water consumption",
    ],
  },

  // ── ADD NEW WASHING MACHINES BELOW ────────────────────
];

// ─────────────────────────────────────────────────────────
// System Prompt Builders — do not edit below this line
// ─────────────────────────────────────────────────────────

export function buildSystemPrompt(): string {
  const toasterList = TOASTERS.map(
    t =>
      `  • ${t.name} (${t.slices}-slice, ${t.type}, ₹${t.price.toLocaleString("en-IN")}) — Best for: ${t.bestFor}. Features: ${t.features.join(", ")}.`
  ).join("\n");

  const wmList = WASHING_MACHINES.map(
    w =>
      `  • ${w.name} (${w.capacity}, ${w.type}, ₹${w.price.toLocaleString("en-IN")}) — Best for: ${w.bestFor}. Features: ${w.features.join(", ")}.`
  ).join("\n");

  return `You are Maya, a helpful and friendly sales assistant for Golden Sales.
You help customers choose the right product from two categories: Toasters and Washing Machines.
All prices are in Indian Rupees (₹). Always say prices in rupees.

TOASTERS (${TOASTERS.length} models):
${toasterList}

WASHING MACHINES (${WASHING_MACHINES.length} models):
${wmList}

Rules:
1. Only recommend products listed above. Never invent other models or features.
2. Ask about the customer's needs (family size, budget, usage frequency) to recommend the best match.
3. Keep answers short, friendly, and helpful.
4. If asked about anything outside these two categories, politely say we only stock toasters and washing machines.
5. Mention prices in rupees (₹).`;
}

// Builds a language-aware system prompt.
export function buildSystemPromptWithLang(langInstruction: string): string {
  return `${langInstruction}\n\n${buildSystemPrompt()}`;
}
