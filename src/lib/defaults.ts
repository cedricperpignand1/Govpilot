export const PREFERRED_NAICS = [
  // ── Durable goods wholesale (product resale sweet spot) ──
  "423990", // Other Miscellaneous Durable Goods Merchant Wholesalers
  "423710", // Hardware Merchant Wholesalers
  "423840", // Industrial and Commercial Supplies Merchant Wholesalers
  "423690", // Other Electronic Parts and Equipment Merchant Wholesalers
  "423610", // Electrical Apparatus and Equipment Merchant Wholesalers
  "423390", // Other Construction Material Merchant Wholesalers
  "423330", // Roofing, Siding, and Insulation Material Merchant Wholesalers
  "423320", // Brick, Stone, and Related Construction Material Merchant Wholesalers
  "423720", // Plumbing and Heating Equipment Merchant Wholesalers
  "423730", // HVAC Equipment and Supplies Merchant Wholesalers
  "423830", // Industrial Machinery and Equipment Merchant Wholesalers
  "423850", // Service Establishment Equipment Merchant Wholesalers
  "423430", // Computer and Peripheral Equipment Merchant Wholesalers
  "423420", // Office Equipment Merchant Wholesalers
  "423490", // Other Professional Equipment Merchant Wholesalers
  "423510", // Metal Service Centers and Metal Merchant Wholesalers
  // ── Nondurable goods wholesale ──
  "424120", // Stationery and Office Supplies Merchant Wholesalers
  "424130", // Industrial and Personal Service Paper Merchant Wholesalers
  "424690", // Other Chemical and Allied Products (cleaning supplies)
];

export const DEFAULT_INCLUDE_KEYWORDS = [
  // PPE & safety
  "safety gloves", "nitrile gloves", "work gloves", "PPE",
  "safety glasses", "hard hats", "respirator", "face shield",
  // Fasteners & hardware
  "bolts", "nuts", "washers", "fasteners", "anchors", "wedge anchors",
  "screws", "self-tapping screws", "drywall screws", "roofing screws",
  "concrete screws", "hex bolts", "carriage bolts", "lag screws",
  // Cutting & abrasive tools
  "drill bits", "saw blades", "hole saw", "grinding discs", "cut-off wheels",
  "sandpaper", "abrasives",
  // Electrical & lighting
  "extension cord", "power strip", "surge protector",
  "batteries", "AA batteries", "AAA batteries", "9V batteries", "lithium batteries",
  "electrical supplies", "wire", "cable", "connectors", "conduit", "fittings",
  "LED", "lighting", "lamps", "fluorescent",
  // Janitorial & consumables
  "shop towels", "rags", "disinfectant", "cleaner", "trash bags",
  "paper towels", "toilet paper", "hand soap", "sanitizer", "mop",
  "janitorial supplies", "cleaning supplies",
  // Shipping & packaging
  "boxes", "packing tape", "stretch wrap", "pallets", "bubble wrap", "foam",
  // Tools & equipment
  "hand tools", "sockets", "wrenches", "pliers", "ladders", "step ladder",
  "tool kit", "power tools", "utility knife",
  // Plumbing & HVAC
  "plumbing supplies", "valves", "PVC", "pipe", "fittings", "HVAC",
  "filters", "air filters", "water filters",
  // Building materials
  "lumber", "plywood", "drywall", "insulation", "roofing",
  "sealant", "caulk", "silicone", "adhesive",
  // Paint & coatings
  "paint", "primer", "rollers", "brushes", "drop cloth",
  // Office & IT supplies
  "toner", "ink cartridge", "office supplies", "paper", "notebooks",
  "keyboards", "monitors", "cables", "USB",
  // Safety & signage
  "safety signs", "cones", "barricades", "reflective vest",
  // Misc supplies
  "furniture", "chairs", "desks", "shelving", "storage",
  // Heavy equipment & industrial
  "generator", "compressor", "pump", "motor",
  "filter", "hose", "valve", "container",
  "trailer", "fence", "gate",
  "steel", "aluminum",
  "equipment", "material", "supplies",
].join(", ");

export const DEFAULT_EXCLUDE_KEYWORDS = [
  // Contract structures — not product-friendly
  "IDIQ", "MATOC", "MACC", "design-build",
  // Installation & repair services — products only, no labor
  "installation", "install", "repair", "maintenance", "preventive maintenance",
  "service contract", "service agreement", "warranty service",
  "retrofit", "overhaul", "refurbishment", "calibration",
  "inspection", "testing services", "commissioning",
  // Construction & labor
  "construction", "renovation", "remodel", "demolition",
  "labor", "labor hours", "man-hours",
  // Professional services
  "architecture", "engineering", "A/E services", "cybersecurity",
  "CMMC", "SOC 2", "TS/SCI", "secret clearance",
  "staffing", "consulting", "professional services",
  // Weapons & restricted items
  "weapons", "ammunition", "ordnance", "explosives",
  // Medical/clinical services (not supplies)
  "medical services", "clinical", "healthcare services",
  // Bond requirements (small business barrier)
  "bonding", "performance bond", "surety bond",
  // Software & IT services
  "software", "IT", "cloud", "cyber", "SaaS", "platform",
  // Training & support
  "training", "support services",
  // Staffing & services
  "staffing", "medical staffing",
  // Facility services
  "janitorial services", "grounds maintenance", "HVAC service", "repair service",
  // Cleaning & painting services
  "cleaning", "cleaning services", "tank cleaning", "pressure washing",
  "painting services", "repaint", "repainting", "coating application",
  "surface preparation",
  // Pumping & waste services
  "pumping services", "septic", "vault pumping", "waste removal",
  // General service catch-alls
  "services", "service contract", "mowing", "landscaping",
  "pest control", "extermination", "snow removal", "trash removal",
  "road marking", "line marking", "striping",
].join(", ");

export const SAAS_NAICS = [
  "541511", // Custom Computer Programming Services
  "541512", // Computer Systems Design Services
  "541513", // Computer Facilities Management Services
  "541519", // Other Computer Related Services
  "518210", // Data Processing, Hosting, and Related Services
  "511210", // Software Publishers
  "519130", // Internet Publishing, Broadcasting and Web Search Portals
  "541690", // Other Scientific and Technical Consulting (IT advisory)
];

export const SAAS_INCLUDE_KEYWORDS = [
  "SaaS", "software", "platform", "cloud", "subscription", "license",
  "software license", "cloud services", "managed services", "IT services",
  "enterprise software", "web application", "mobile application",
  "cybersecurity", "data analytics", "analytics platform", "dashboard",
  "portal", "system", "solution", "digital platform", "API",
  "AI", "machine learning", "data processing", "hosting",
  "software as a service", "cloud computing", "infrastructure",
].join(", ");

export const SAAS_EXCLUDE_KEYWORDS = [
  // Physical goods
  "PPE", "gloves", "bolts", "nuts", "fasteners", "anchors",
  "drill bits", "saw blades", "grinding discs", "abrasives",
  "lumber", "plywood", "drywall", "insulation", "roofing",
  "paint", "primer", "rollers", "brushes",
  "pipe", "valve", "fittings", "conduit",
  "furniture", "chairs", "desks", "shelving",
  "generator", "compressor", "pump",
  "trailer", "fence", "gate",
  "steel", "aluminum",
  // Construction & labor
  "construction", "renovation", "demolition", "labor",
  // Facility services
  "janitorial", "grounds maintenance", "mowing", "landscaping",
  "pest control", "snow removal", "trash removal",
  "cleaning", "painting services", "pumping",
  // Weapons
  "weapons", "ammunition", "ordnance",
].join(", ");

/** Returns today's date in MM/dd/yyyy */
export function formatDateForSam(date: Date): string {
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const yyyy = date.getFullYear();
  return `${mm}/${dd}/${yyyy}`;
}

/** Returns a date N days ago in MM/dd/yyyy */
export function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return formatDateForSam(d);
}

export function todayForSam(): string {
  return formatDateForSam(new Date());
}
