/** @type {import('tailwindcss').Config} */

/**
 * Smart Marina Connect design tokens (refonte, Oct 2026).
 *
 * Every colour is a CSS variable on :root (src/index.css), stored as RGB
 * channels so opacity modifiers keep working (bg-navy/80, text-primary/70).
 * The shadcn names (primary, secondary, muted, accent, border, ring…) are
 * mapped onto the same tokens, so the admin, account and SM26 screens keep
 * their classes and simply pick up the new palette.
 *
 * Rules of use (design proposal §5):
 *  - gold is for the main action and selected states only, with navy text;
 *    gold TEXT on white is gold-text (#87681b), never gold itself;
 *  - teal marks eyebrow dots, the verified icon and quotes;
 *  - organisation type colours always sit next to the written type label.
 */
const token = (name) => `rgb(var(--${name}) / <alpha-value>)`
// Tailwind's own teal scale stays (bg-teal-50, text-teal-700… are used across the app);
// plain `teal` is the brand teal.
const defaultColors = require('tailwindcss/colors')

export default {
  darkMode: ["class"],
  content: [
    './pages/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './app/**/*.{ts,tsx}',
    './src/**/*.{ts,tsx}',
  ],
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: token('navy'),
          foreground: "#ffffff",
        },
        secondary: {
          DEFAULT: token('gold'),
          // Gold for text on white: 5.2:1 (the old #9a7520 was 4.25:1).
          dark: token('gold-text'),
          foreground: token('navy'),
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        // ── SMC palette ────────────────────────────────────────────────
        navy: {
          DEFAULT: token('navy'),
          deep: token('navy-deep'),
          chip: token('chip'),
        },
        gold: {
          DEFAULT: token('gold'),
          hover: token('gold-hover'),
          text: token('gold-text'),
        },
        // `teal` for icons and marks; `teal-text` (#196a7a) for teal words on foam or white (5.5:1).
        teal: { ...defaultColors.teal, DEFAULT: token('teal'), text: token('teal-text') },
        foam: token('foam'),
        page: token('page'),
        ink: token('ink'),
        meta: token('meta'),
        rule: token('rule'),
        chip: token('chip'),
        checkbox: token('checkbox'),
        org: {
          marina: token('type-marina'),
          provider: token('type-provider'),
          investor: token('type-investor'),
          media: token('type-media'),
        },
      },
      fontFamily: {
        sans: ['"Inter Variable"', 'Inter', 'system-ui', '-apple-system', '"Segoe UI"', 'Roboto', 'sans-serif'],
        // The "Smart Marina Connect" wordmark next to the S symbol, and nothing else.
        wordmark: ['Outfit', '"Inter Variable"', 'system-ui', 'sans-serif'],
        // SMC's second voice, harbour signage: eyebrows, live figures, the departures
        // board, the pontoon tag and the signposts. Inter stays for body and UI.
        signage: ['"Barlow Semi Condensed"', '"Inter Variable"', 'system-ui', 'sans-serif'],
      },
      fontSize: {
        // [size, { lineHeight, letterSpacing, fontWeight }] — desktop / mobile pairs.
        // The 12/16 caps meta line is the .text-meta-caps class (index.css): `text-meta` is the colour.
        // New names must also be listed in src/lib/utils.ts (tailwind-merge), or cn() drops them.
        'display': ['52px', { lineHeight: '58px', letterSpacing: '-0.025em', fontWeight: '600' }],
        'display-sm': ['34px', { lineHeight: '40px', letterSpacing: '-0.02em', fontWeight: '600' }],
        'h1': ['44px', { lineHeight: '50px', letterSpacing: '-0.02em', fontWeight: '600' }],
        'h1-sm': ['30px', { lineHeight: '36px', letterSpacing: '-0.015em', fontWeight: '600' }],
        'h2': ['32px', { lineHeight: '40px', letterSpacing: '-0.015em', fontWeight: '600' }],
        'h2-sm': ['24px', { lineHeight: '30px', letterSpacing: '-0.01em', fontWeight: '600' }],
        'h3': ['22px', { lineHeight: '28px', letterSpacing: '-0.01em', fontWeight: '600' }],
        'card-title': ['18px', { lineHeight: '24px', fontWeight: '600' }],
        'body-lg': ['17px', { lineHeight: '28px' }],
        'body': ['16px', { lineHeight: '26px' }],
        // Live figures: semibold, tabular, in the signage face (FlapFigure draws them as flaps).
        'figure': ['44px', { lineHeight: '48px', letterSpacing: '0', fontWeight: '600' }],
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        // 4 px, as before the refonte: shadcn's 16 px checkbox and menu items use rounded-sm,
        // and 8 px turned the checkbox into a circle that reads as a radio button.
        sm: "calc(var(--radius) - 8px)",
        badge: "6px",
        field: "12px",
        card: "16px",
        pill: "999px",
      },
      boxShadow: {
        // No shadow at rest: hover lifts a card, drawers float.
        hover: "0 6px 20px rgba(11, 38, 83, 0.08)",
        drawer: "0 24px 64px rgba(11, 38, 83, 0.24)",
        // Double ring, 2 px white then 2 px navy: visible on white, navy and photos.
        focus: "0 0 0 2px #ffffff, 0 0 0 4px #0b2653",
      },
      transitionTimingFunction: {
        // Reveals, cards, links.
        'out-smc': 'cubic-bezier(.215, .61, .355, 1)',
        // Compass needle and buoy: a little overshoot.
        'swing': 'cubic-bezier(.34, 1.56, .64, 1)',
        // Rolling CTA buttons and round arrow discs.
        'cta': 'cubic-bezier(.625, .05, 0, 1)',
        // Accordion photo cards.
        'acc': 'cubic-bezier(.38, .005, .215, 1)',
      },
      keyframes: {
        "accordion-down": {
          from: { height: 0 },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: 0 },
        },
        "slide-up": {
          from: { transform: "translateY(100%)" },
          to: { transform: "translateY(0)" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "slide-up": "slide-up 0.3s ease-out",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
}
