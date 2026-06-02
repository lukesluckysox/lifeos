/* ─────────────────────────────────────────────────────────────────────────
   Card Benefits Database — top 25 US cards
   Each card has: annualFee, categories of benefits, and an estimatedValue
   (realistic annual value if you use every benefit)
   ───────────────────────────────────────────────────────────────────────── */

export interface CardBenefit {
  id: string;
  name: string;
  category: "travel" | "dining" | "shopping" | "lounge" | "credits" | "insurance" | "rewards";
  description: string;
  annualValue: number; // estimated $ value per year
  howToUse?: string;
  recurring?: "monthly" | "annual" | "once";
}

export interface CardDefinition {
  id: string;
  name: string;
  issuer: string;
  network: "visa" | "mastercard" | "amex" | "discover";
  annualFee: number;
  estimatedAnnualValue: number; // total if all benefits used
  color: string; // tailwind bg for card display
  benefits: CardBenefit[];
}

export const CARD_DATABASE: CardDefinition[] = [
  {
    id: "amex-platinum",
    name: "Platinum Card",
    issuer: "American Express",
    network: "amex",
    annualFee: 695,
    estimatedAnnualValue: 1540,
    color: "from-slate-400 to-slate-600",
    benefits: [
      { id: "amex-plat-travel-credit", name: "$200 Airline Fee Credit", category: "travel", description: "Up to $200 in credits for incidental airline fees per calendar year.", annualValue: 200, howToUse: "Select an airline and use your card for seat upgrades, bags, etc.", recurring: "annual" },
      { id: "amex-plat-hotel-credit", name: "$200 Hotel Credit", category: "travel", description: "$200 back in statement credits each year on prepaid bookings at Fine Hotels + Resorts or The Hotel Collection.", annualValue: 200, howToUse: "Book through AmexTravel.com.", recurring: "annual" },
      { id: "amex-plat-uber-credit", name: "$200 Uber Cash", category: "travel", description: "$15/month in Uber Cash for rides and Uber Eats, plus a $20 bonus in December.", annualValue: 200, howToUse: "Add Platinum card to your Uber account.", recurring: "monthly" },
      { id: "amex-plat-dining-credit", name: "$240 Digital Entertainment Credit", category: "dining", description: "$20/month back on Disney+, ESPN+, Hulu, Peacock, NYT, WSJ, and others.", annualValue: 240, howToUse: "Pay with your Platinum card for eligible subscriptions.", recurring: "monthly" },
      { id: "amex-plat-saks", name: "$100 Saks Credit", category: "shopping", description: "$50 in statement credits from Jan–Jun and another $50 Jul–Dec.", annualValue: 100, howToUse: "Shop at Saks Fifth Avenue in-store or online.", recurring: "annual" },
      { id: "amex-plat-lounge", name: "Global Lounge Collection", category: "lounge", description: "Access to 1,400+ airport lounges including Centurion, Priority Pass, Delta Sky Club (when flying Delta), and more.", annualValue: 400, howToUse: "Show your Platinum card and a same-day boarding pass." },
      { id: "amex-plat-global-entry", name: "Global Entry / TSA PreCheck Credit", category: "travel", description: "Up to $120 credit for Global Entry ($100) or TSA PreCheck ($85) application fee.", annualValue: 25, howToUse: "Charge the fee to your Platinum card.", recurring: "annual" },
      { id: "amex-plat-clear", name: "CLEAR Plus Credit", category: "travel", description: "Up to $189 per year in CLEAR Plus membership credits.", annualValue: 189, howToUse: "Pay for CLEAR with your Platinum card.", recurring: "annual" },
    ],
  },
  {
    id: "amex-gold",
    name: "Gold Card",
    issuer: "American Express",
    network: "amex",
    annualFee: 250,
    estimatedAnnualValue: 620,
    color: "from-yellow-500 to-yellow-700",
    benefits: [
      { id: "amex-gold-dining", name: "$120 Dining Credit", category: "dining", description: "$10/month at Grubhub, The Cheesecake Factory, Goldbelly, Wine.com, and Milk Bar.", annualValue: 120, howToUse: "Pay with your Gold card at participating restaurants.", recurring: "monthly" },
      { id: "amex-gold-uber", name: "$120 Uber Cash", category: "travel", description: "$10/month in Uber Cash for Uber Eats orders in the US.", annualValue: 120, howToUse: "Add Gold card to your Uber account.", recurring: "monthly" },
      { id: "amex-gold-resy", name: "$100 Resy Credit", category: "dining", description: "$50 semi-annually at US Resy restaurants.", annualValue: 100, howToUse: "Book via Resy app or website, pay with Gold card.", recurring: "annual" },
      { id: "amex-gold-dunkin", name: "$84 Dunkin' Credit", category: "dining", description: "$7/month credit at Dunkin'.", annualValue: 84, howToUse: "Pay with your Gold card at Dunkin'.", recurring: "monthly" },
      { id: "amex-gold-4x-dining", name: "4x Points on Dining", category: "rewards", description: "4 Membership Rewards points per $1 at restaurants worldwide.", annualValue: 120, howToUse: "Use your Gold card whenever you dine out." },
      { id: "amex-gold-4x-grocery", name: "4x Points on US Supermarkets", category: "rewards", description: "4 Membership Rewards points per $1 at US supermarkets (up to $25k/year).", annualValue: 160, howToUse: "Use your Gold card for grocery shopping." },
    ],
  },
  {
    id: "chase-sapphire-reserve",
    name: "Sapphire Reserve",
    issuer: "Chase",
    network: "visa",
    annualFee: 550,
    estimatedAnnualValue: 920,
    color: "from-slate-700 to-slate-900",
    benefits: [
      { id: "csr-travel-credit", name: "$300 Annual Travel Credit", category: "travel", description: "$300 in statement credits each account anniversary year for travel purchases.", annualValue: 300, howToUse: "Use your card for any travel — flights, hotels, Uber, parking, tolls.", recurring: "annual" },
      { id: "csr-lounge", name: "Priority Pass Select", category: "lounge", description: "Unlimited access to 1,300+ airport lounges worldwide for you and 2 guests.", annualValue: 300, howToUse: "Show your Priority Pass card at participating lounges.", recurring: "annual" },
      { id: "csr-global-entry", name: "Global Entry / TSA PreCheck", category: "travel", description: "Up to $120 for Global Entry or TSA PreCheck application fee, every 4 years.", annualValue: 30, howToUse: "Charge the application fee to your Reserve card.", recurring: "annual" },
      { id: "csr-3x-travel", name: "3x Points on Travel", category: "rewards", description: "3 Ultimate Rewards points per $1 on travel (after the $300 credit).", annualValue: 120, howToUse: "Use your Reserve card for all travel spending." },
      { id: "csr-3x-dining", name: "3x Points on Dining", category: "rewards", description: "3 Ultimate Rewards points per $1 at restaurants, takeout, and eligible food delivery.", annualValue: 90, howToUse: "Use your Reserve card whenever you dine." },
      { id: "csr-doordash", name: "DashPass Membership", category: "dining", description: "Complimentary DashPass (free delivery on $12+ orders) through 2027.", annualValue: 96, howToUse: "Activate through the DoorDash or Caviar app.", recurring: "annual" },
    ],
  },
  {
    id: "chase-sapphire-preferred",
    name: "Sapphire Preferred",
    issuer: "Chase",
    network: "visa",
    annualFee: 95,
    estimatedAnnualValue: 380,
    color: "from-blue-700 to-blue-900",
    benefits: [
      { id: "csp-hotel-credit", name: "$50 Annual Hotel Credit", category: "travel", description: "$50 in statement credits each account anniversary for hotel stays booked through Chase Travel.", annualValue: 50, howToUse: "Book hotel through Chase Travel portal.", recurring: "annual" },
      { id: "csp-travel-points", name: "5x on Chase Travel", category: "rewards", description: "5x Ultimate Rewards points on travel purchased through Chase Travel.", annualValue: 100, howToUse: "Book travel through Chase Ultimate Rewards portal." },
      { id: "csp-3x-dining", name: "3x on Dining & Streaming", category: "rewards", description: "3x points on dining, select streaming, and online groceries.", annualValue: 90, howToUse: "Use Sapphire Preferred for dining and subscriptions." },
      { id: "csp-doordash", name: "DashPass Membership", category: "dining", description: "Complimentary DashPass through 2027.", annualValue: 96, howToUse: "Activate DashPass through DoorDash or Caviar app.", recurring: "annual" },
    ],
  },
  {
    id: "chase-freedom-unlimited",
    name: "Freedom Unlimited",
    issuer: "Chase",
    network: "visa",
    annualFee: 0,
    estimatedAnnualValue: 240,
    color: "from-blue-500 to-blue-700",
    benefits: [
      { id: "cfu-15-back", name: "1.5% Cash Back on Everything", category: "rewards", description: "Unlimited 1.5% cash back on all purchases.", annualValue: 150, howToUse: "Use as your everyday non-bonus card." },
      { id: "cfu-3x-dining", name: "3% on Dining & Drugstores", category: "rewards", description: "3% cash back at restaurants and drugstores.", annualValue: 60, howToUse: "Use for dining and CVS/Walgreens purchases." },
      { id: "cfu-5x-travel", name: "5% on Chase Travel", category: "rewards", description: "5% on travel booked through Chase Ultimate Rewards.", annualValue: 30, howToUse: "Book travel through Chase portal." },
    ],
  },
  {
    id: "citi-double-cash",
    name: "Double Cash",
    issuer: "Citi",
    network: "mastercard",
    annualFee: 0,
    estimatedAnnualValue: 200,
    color: "from-blue-400 to-blue-600",
    benefits: [
      { id: "cdc-2pct", name: "2% Cash Back", category: "rewards", description: "1% when you buy + 1% when you pay — effectively 2% on everything.", annualValue: 200, howToUse: "Use as your flat-rate everyday card, pay balance monthly." },
    ],
  },
  {
    id: "amex-blue-cash-preferred",
    name: "Blue Cash Preferred",
    issuer: "American Express",
    network: "amex",
    annualFee: 95,
    estimatedAnnualValue: 420,
    color: "from-blue-600 to-indigo-700",
    benefits: [
      { id: "bcp-6x-grocery", name: "6% at US Supermarkets", category: "rewards", description: "6% cash back at US supermarkets up to $6,000/year, then 1%.", annualValue: 260, howToUse: "Use Blue Cash Preferred for all grocery shopping." },
      { id: "bcp-6x-streaming", name: "6% on Streaming", category: "rewards", description: "6% back on select US streaming subscriptions.", annualValue: 50, howToUse: "Pay for Netflix, Disney+, Hulu, etc. with this card." },
      { id: "bcp-3x-transit", name: "3% on Transit & Gas", category: "rewards", description: "3% cash back at US gas stations and on transit (Uber, Lyft, trains, buses).", annualValue: 110, howToUse: "Use for all commuting and gas purchases." },
    ],
  },
  {
    id: "capital-one-venture-x",
    name: "Venture X",
    issuer: "Capital One",
    network: "visa",
    annualFee: 395,
    estimatedAnnualValue: 760,
    color: "from-red-700 to-red-900",
    benefits: [
      { id: "vx-travel-credit", name: "$300 Travel Credit", category: "travel", description: "$300 annual credit for bookings through Capital One Travel.", annualValue: 300, howToUse: "Book flights, hotels, or rental cars through Capital One Travel.", recurring: "annual" },
      { id: "vx-10k-bonus", name: "10,000 Anniversary Bonus Miles", category: "rewards", description: "10,000 bonus miles every year on your account anniversary (~$100 value).", annualValue: 100, howToUse: "Automatically credited each year.", recurring: "annual" },
      { id: "vx-lounge", name: "Capital One & Priority Pass Lounges", category: "lounge", description: "Unlimited access to Capital One Lounges + Priority Pass for you and 2 guests.", annualValue: 300, howToUse: "Show your card at Capital One or Priority Pass lounges." },
      { id: "vx-2x-all", name: "2x Miles on Everything", category: "rewards", description: "2 miles per $1 on all purchases.", annualValue: 160, howToUse: "Use as a daily driver card." },
    ],
  },
  {
    id: "capital-one-venture",
    name: "Venture Rewards",
    issuer: "Capital One",
    network: "visa",
    annualFee: 95,
    estimatedAnnualValue: 260,
    color: "from-red-500 to-red-700",
    benefits: [
      { id: "venture-global-entry", name: "Global Entry / TSA PreCheck", category: "travel", description: "Up to $120 credit for Global Entry or TSA PreCheck.", annualValue: 30, howToUse: "Charge the application fee to your Venture card.", recurring: "annual" },
      { id: "venture-2x", name: "2x Miles on Everything", category: "rewards", description: "2 miles per $1 on every purchase.", annualValue: 200, howToUse: "Use as your everyday card." },
    ],
  },
  {
    id: "discover-it",
    name: "Discover it Cash Back",
    issuer: "Discover",
    network: "discover",
    annualFee: 0,
    estimatedAnnualValue: 200,
    color: "from-orange-400 to-orange-600",
    benefits: [
      { id: "discover-5x-rotate", name: "5% Rotating Categories", category: "rewards", description: "5% cash back on up to $1,500 in rotating quarterly categories (gas, grocery, Amazon, restaurants, etc.).", annualValue: 150, howToUse: "Activate each quarter and max out the bonus category.", recurring: "annual" },
      { id: "discover-1x", name: "1% on Everything Else", category: "rewards", description: "Unlimited 1% cash back on all other purchases.", annualValue: 50, howToUse: "Use as a backup card for non-bonus spending." },
    ],
  },
  {
    id: "wells-fargo-autograph",
    name: "Autograph Card",
    issuer: "Wells Fargo",
    network: "visa",
    annualFee: 0,
    estimatedAnnualValue: 250,
    color: "from-red-600 to-yellow-600",
    benefits: [
      { id: "wfa-3x-travel", name: "3x on Travel, Dining & Streaming", category: "rewards", description: "3x points on restaurants, travel, gas, transit, streaming, and phone plans.", annualValue: 250, howToUse: "Use for all major bonus categories." },
    ],
  },
  {
    id: "bilt-mastercard",
    name: "Bilt Mastercard",
    issuer: "Wells Fargo",
    network: "mastercard",
    annualFee: 0,
    estimatedAnnualValue: 300,
    color: "from-gray-700 to-gray-900",
    benefits: [
      { id: "bilt-rent", name: "Points on Rent (No Fee)", category: "rewards", description: "Earn 1x points on rent with no transaction fee — potentially the most valuable no-fee benefit on any card.", annualValue: 180, howToUse: "Pay rent through the Bilt app." },
      { id: "bilt-2x-travel", name: "2x on Travel, 3x on Dining", category: "rewards", description: "2x on travel and 3x on dining.", annualValue: 120, howToUse: "Use for travel and restaurant purchases." },
    ],
  },
  {
    id: "apple-card",
    name: "Apple Card",
    issuer: "Goldman Sachs",
    network: "mastercard",
    annualFee: 0,
    estimatedAnnualValue: 180,
    color: "from-gray-300 to-gray-500",
    benefits: [
      { id: "apple-3pct", name: "3% Daily Cash on Apple Purchases", category: "rewards", description: "3% Daily Cash on everything Apple — App Store, Apple Pay merchants, Apple products.", annualValue: 100, howToUse: "Use Apple Card (via Apple Pay) at Apple and partner merchants." },
      { id: "apple-2pct", name: "2% Daily Cash via Apple Pay", category: "rewards", description: "2% Daily Cash on all purchases made with Apple Pay.", annualValue: 80, howToUse: "Pay with Face ID / Touch ID instead of tapping a physical card." },
    ],
  },
  {
    id: "bank-of-america-premium-rewards",
    name: "Premium Rewards",
    issuer: "Bank of America",
    network: "visa",
    annualFee: 95,
    estimatedAnnualValue: 275,
    color: "from-red-700 to-red-900",
    benefits: [
      { id: "boa-pr-travel-credit", name: "$100 Airline Incidental Credit", category: "travel", description: "Up to $100 in credits for airline incidental fees per year.", annualValue: 100, howToUse: "Charge bags, seat upgrades, etc. to your card.", recurring: "annual" },
      { id: "boa-pr-global-entry", name: "Global Entry / TSA PreCheck", category: "travel", description: "Up to $100 credit for Global Entry or TSA PreCheck.", annualValue: 25, howToUse: "Pay the application fee with your card.", recurring: "annual" },
      { id: "boa-pr-2x-travel", name: "2x on Travel & Dining", category: "rewards", description: "2x points on travel and dining purchases.", annualValue: 150, howToUse: "Use for flights, hotels, and restaurants." },
    ],
  },
  {
    id: "us-bank-altitude-reserve",
    name: "Altitude Reserve",
    issuer: "US Bank",
    network: "visa",
    annualFee: 400,
    estimatedAnnualValue: 625,
    color: "from-blue-800 to-blue-950",
    benefits: [
      { id: "usb-ar-travel-credit", name: "$325 Annual Travel Credit", category: "travel", description: "$325 in credits annually for travel and dining purchases.", annualValue: 325, howToUse: "Use your card for travel or dining — credits apply automatically.", recurring: "annual" },
      { id: "usb-ar-lounge", name: "Priority Pass Select", category: "lounge", description: "12 free lounge visits per year via Priority Pass.", annualValue: 150, howToUse: "Use Priority Pass membership at participating airport lounges." },
      { id: "usb-ar-3x-mobile", name: "3x on Mobile Wallet Purchases", category: "rewards", description: "3x points on eligible travel, Apple Pay, and Google Pay purchases.", annualValue: 150, howToUse: "Use Apple Pay or Google Pay whenever accepted." },
    ],
  },
  {
    id: "marriott-bonvoy-brilliant",
    name: "Bonvoy Brilliant",
    issuer: "American Express",
    network: "amex",
    annualFee: 650,
    estimatedAnnualValue: 920,
    color: "from-amber-700 to-amber-900",
    benefits: [
      { id: "bonvoy-brilliant-dining", name: "$300 Brilliant Dining Credit", category: "dining", description: "Up to $25/month in credits at restaurants worldwide.", annualValue: 300, howToUse: "Charge dining purchases to your Brilliant card.", recurring: "monthly" },
      { id: "bonvoy-brilliant-free-night", name: "Free Night Award", category: "travel", description: "One free night award annually (up to 85,000 points).", annualValue: 250, howToUse: "Book an eligible Marriott property through the app.", recurring: "annual" },
      { id: "bonvoy-brilliant-global-entry", name: "Global Entry / TSA PreCheck", category: "travel", description: "Fee credit every 4.5 years.", annualValue: 25, howToUse: "Pay the application fee with your card.", recurring: "annual" },
      { id: "bonvoy-brilliant-lounge", name: "Priority Pass Select", category: "lounge", description: "Unlimited Priority Pass lounge access.", annualValue: 300, howToUse: "Use Priority Pass card at participating lounges." },
    ],
  },
  {
    id: "hilton-honors-aspire",
    name: "Hilton Honors Aspire",
    issuer: "American Express",
    network: "amex",
    annualFee: 550,
    estimatedAnnualValue: 900,
    color: "from-blue-600 to-blue-900",
    benefits: [
      { id: "hilton-aspire-resort-credit", name: "$400 Hilton Resort Credit", category: "travel", description: "$200 semi-annually in statement credits at participating Hilton resorts.", annualValue: 400, howToUse: "Pay for eligible resort charges with your Aspire card.", recurring: "annual" },
      { id: "hilton-aspire-flight-credit", name: "$200 Flight Credit", category: "travel", description: "$50/quarter in credits for flights booked via Amex Travel or directly with airlines.", annualValue: 200, howToUse: "Book flights with your card through AmexTravel.com.", recurring: "annual" },
      { id: "hilton-aspire-free-night", name: "Free Night Reward (×2)", category: "travel", description: "One free night reward upon approval and again each year.", annualValue: 250, howToUse: "Redeem at any Hilton property.", recurring: "annual" },
      { id: "hilton-aspire-lounge", name: "Priority Pass Select", category: "lounge", description: "Unlimited Priority Pass lounge access.", annualValue: 300, howToUse: "Use Priority Pass card at participating lounges." },
    ],
  },
  {
    id: "southwest-rapid-rewards-priority",
    name: "Rapid Rewards Priority",
    issuer: "Chase",
    network: "visa",
    annualFee: 149,
    estimatedAnnualValue: 345,
    color: "from-orange-500 to-red-600",
    benefits: [
      { id: "sw-priority-travel-credit", name: "$75 Southwest Travel Credit", category: "travel", description: "$75 in Southwest travel credits each card anniversary year.", annualValue: 75, howToUse: "Charge Southwest purchases to your card.", recurring: "annual" },
      { id: "sw-priority-upgraded-boardings", name: "4 Upgraded Boardings/Year", category: "travel", description: "4 upgraded boardings per year when available.", annualValue: 80, howToUse: "Request at the gate; charged to card and credited back.", recurring: "annual" },
      { id: "sw-priority-tier-points", name: "1,500 Tier Qualifying Points", category: "rewards", description: "1,500 TQPs each year toward A-List status.", annualValue: 50, howToUse: "Automatically credited on your card anniversary.", recurring: "annual" },
      { id: "sw-priority-3x", name: "3x on Southwest Purchases", category: "rewards", description: "3 Rapid Rewards points per $1 on Southwest purchases.", annualValue: 140, howToUse: "Book all Southwest flights with this card." },
    ],
  },
  {
    id: "united-explorer",
    name: "Explorer Card",
    issuer: "Chase",
    network: "visa",
    annualFee: 95,
    estimatedAnnualValue: 275,
    color: "from-blue-800 to-blue-600",
    benefits: [
      { id: "united-exp-free-bag", name: "First Checked Bag Free", category: "travel", description: "Free first checked bag for you and one companion on United-operated flights.", annualValue: 120, howToUse: "Purchase United tickets with your Explorer card.", recurring: "annual" },
      { id: "united-exp-priority-boarding", name: "Priority Boarding", category: "travel", description: "Priority boarding for you and companions on the same reservation.", annualValue: 40, howToUse: "Board in Group 2 on United flights." },
      { id: "united-exp-global-entry", name: "Global Entry / TSA PreCheck", category: "travel", description: "Up to $120 credit for Global Entry or TSA PreCheck every 4 years.", annualValue: 30, howToUse: "Pay the application fee with your Explorer card.", recurring: "annual" },
      { id: "united-exp-lounge-passes", name: "2 United Club Passes/Year", category: "lounge", description: "Two United Club one-time passes per year.", annualValue: 100, howToUse: "Use passes at United Club locations.", recurring: "annual" },
    ],
  },
  {
    id: "delta-skymiles-reserve",
    name: "SkyMiles Reserve",
    issuer: "American Express",
    network: "amex",
    annualFee: 650,
    estimatedAnnualValue: 890,
    color: "from-red-700 to-red-900",
    benefits: [
      { id: "delta-reserve-companion", name: "Companion Certificate", category: "travel", description: "Annual domestic companion certificate (Main Cabin) upon card renewal.", annualValue: 300, howToUse: "Book a qualifying Delta flight; certificate issued post-renewal.", recurring: "annual" },
      { id: "delta-reserve-lounge", name: "Delta Sky Club Access", category: "lounge", description: "Unlimited Delta Sky Club access when flying Delta; 15 guest passes/year.", annualValue: 400, howToUse: "Show your Reserve card and same-day Delta boarding pass." },
      { id: "delta-reserve-free-bag", name: "First Checked Bag Free", category: "travel", description: "First checked bag free for you and up to 8 companions on your reservation.", annualValue: 100, howToUse: "Book Delta flights with your Reserve card.", recurring: "annual" },
      { id: "delta-reserve-global-entry", name: "Global Entry / TSA PreCheck", category: "travel", description: "Fee credit every 4.5 years.", annualValue: 25, howToUse: "Pay the application fee with your card.", recurring: "annual" },
    ],
  },
  {
    id: "amazon-prime-visa",
    name: "Prime Visa",
    issuer: "Chase",
    network: "visa",
    annualFee: 0,
    estimatedAnnualValue: 220,
    color: "from-yellow-500 to-orange-600",
    benefits: [
      { id: "amazon-5x", name: "5% at Amazon & Whole Foods", category: "rewards", description: "5% back at Amazon.com and Whole Foods Market with an eligible Prime membership.", annualValue: 180, howToUse: "Use Prime Visa for all Amazon and Whole Foods purchases." },
      { id: "amazon-2x-dining", name: "2% at Restaurants, Gas & Drugstores", category: "rewards", description: "2% cash back at restaurants, gas stations, and drugstores.", annualValue: 40, howToUse: "Use as backup card for these categories." },
    ],
  },
  {
    id: "citi-premier",
    name: "Citi Strata Premier",
    issuer: "Citi",
    network: "mastercard",
    annualFee: 95,
    estimatedAnnualValue: 350,
    color: "from-blue-500 to-blue-700",
    benefits: [
      { id: "citi-premier-hotel-credit", name: "$100 Hotel Annual Benefit", category: "travel", description: "$100 off a single hotel stay of $500+ per calendar year through CitiTravel.com.", annualValue: 100, howToUse: "Book a hotel through CitiTravel.com using your Strata Premier card.", recurring: "annual" },
      { id: "citi-premier-3x", name: "3x on Hotels, Air & Restaurants", category: "rewards", description: "3 ThankYou points per $1 on hotels, flights, restaurants, supermarkets, and gas.", annualValue: 250, howToUse: "Use for travel, dining, and grocery purchases." },
    ],
  },
  {
    id: "ink-business-preferred",
    name: "Ink Business Preferred",
    issuer: "Chase",
    network: "visa",
    annualFee: 95,
    estimatedAnnualValue: 400,
    color: "from-indigo-700 to-indigo-900",
    benefits: [
      { id: "ink-pref-3x-travel", name: "3x on Travel & Shipping", category: "rewards", description: "3x points on travel, shipping, internet, cable, phone, and advertising (up to $150k/year).", annualValue: 300, howToUse: "Use for business travel, ads, and utilities." },
      { id: "ink-pref-cell-protection", name: "Cell Phone Protection", category: "insurance", description: "Up to $1,000 per claim ($600 max/year) for cell phone damage or theft when you pay your bill with this card.", annualValue: 100, howToUse: "Pay your monthly phone bill with Ink Preferred.", recurring: "monthly" },
    ],
  },
  {
    id: "amex-everyday-preferred",
    name: "EveryDay Preferred",
    issuer: "American Express",
    network: "amex",
    annualFee: 95,
    estimatedAnnualValue: 280,
    color: "from-teal-600 to-teal-800",
    benefits: [
      { id: "amex-ep-3x-grocery", name: "3x at US Supermarkets", category: "rewards", description: "3 Membership Rewards points per $1 at US supermarkets (up to $6,000/year).", annualValue: 180, howToUse: "Use for all grocery shopping." },
      { id: "amex-ep-bonus", name: "50% Bonus Points (30+ uses/month)", category: "rewards", description: "Earn 50% extra points when you use the card 30+ times per billing period.", annualValue: 100, howToUse: "Spread everyday spending across the card to hit 30 uses." },
    ],
  },
];

export const CARD_CATEGORIES = ["travel", "dining", "shopping", "lounge", "credits", "insurance", "rewards"] as const;
export type CardCategory = typeof CARD_CATEGORIES[number];
