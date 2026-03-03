# Togather Design System v2

This style guide documents the visual identity for Togather's web presence. Use these guidelines consistently across all UI components.

---

## Color Palette

### Primary Colors (Warm Brown/Tan)

| Token | Hex | Usage |
|-------|-----|-------|
| `primary-50` | `#faf7f4` | Lightest backgrounds |
| `primary-100` | `#f5ede5` | Light backgrounds, mobile menu |
| `primary-200` | `#ecddd0` | Subtle backgrounds |
| `primary-300` | `#dfc6b0` | Borders, dividers |
| `primary-400` | `#d4a574` | Muted accents |
| `primary-500` | `#c8935f` | Default primary |
| `primary-600` | `#b87d4a` | Hover states |
| `primary-700` | `#9a6640` | Active states |
| `primary-800` | `#7d5339` | Dark accents |
| `primary-900` | `#664531` | Darkest primary |

### Neutral Colors (Warm Grays)

| Token | Hex | Usage |
|-------|-----|-------|
| `neutral-50` | `#fafaf9` | Feature card backgrounds |
| `neutral-100` | `#f5f5f4` | Page backgrounds |
| `neutral-200` | `#e7e5e4` | Borders, dividers |
| `neutral-300` | `#d6d3d1` | Active tab borders |
| `neutral-400` | `#a8a29e` | Muted text, placeholders |
| `neutral-500` | `#78716c` | Secondary text |
| `neutral-600` | `#57534e` | Body text |
| `neutral-700` | `#44403c` | Icon colors |
| `neutral-800` | `#292524` | Default text color |
| `neutral-900` | `#1c1917` | Headings, primary buttons |

### Accent Colors

| Token | Hex | Usage |
|-------|-----|-------|
| `accent-400` | `#4ade80` | Success (light) |
| `accent-500` | `#22c55e` | Success checkmarks |
| `accent-600` | `#16a34a` | Success (dark) |

### Semantic Colors

| Purpose | Color | Class |
|---------|-------|-------|
| Page background | White | `bg-white` |
| Footer background | Dark charcoal | `bg-neutral-900` |
| Primary button | Near-black | `bg-neutral-900` |
| Body text | Warm gray | `text-neutral-600` |
| Heading text | Dark charcoal | `text-neutral-900` |
| Muted/placeholder | Medium gray | `text-neutral-400` |

---

## Typography

### Font Family

**Plus Jakarta Sans** - A modern geometric sans-serif with warmth and personality.

```css
font-family: 'Plus Jakarta Sans', system-ui, -apple-system, sans-serif;
```

### Headings

| Element | Size | Weight | Color | Line Height |
|---------|------|--------|-------|-------------|
| Hero H1 | `text-5xl` to `text-7xl` | `font-bold` | `text-neutral-900` | `leading-[1.1]` |
| Section H2 | `text-4xl` to `text-5xl` | `font-bold` | `text-neutral-900` | Default |
| Card H3 | `text-2xl` to `text-[1.75rem]` | `font-medium` | `text-neutral-800` | `leading-snug` |
| Feature H4 | `text-lg` | `font-bold` | `text-neutral-900` | Default |

### Body Text

| Element | Size | Weight | Color |
|---------|------|--------|-------|
| Hero description | `text-base` to `text-lg` | Normal | `text-neutral-600` |
| Section description | `text-lg` | Normal | `text-neutral-600` |
| Feature description | `text-[0.95rem]` | Normal | `text-neutral-600` |
| Small/caption | `text-sm` | Normal | `text-neutral-400` |

### Text Styling

- Use `text-wrap: balance` for headings
- Enable antialiasing: `-webkit-font-smoothing: antialiased`
- Use `leading-relaxed` for body copy

---

## Spacing

### Section Spacing

| Section | Padding |
|---------|---------|
| Hero | `min-h-screen`, `p-3 md:p-4` |
| Features | `pt-6 md:pt-10 pb-16 md:pb-20` |
| FAQ | `py-12 md:py-10` |
| CTA | `pt-12 md:pt-24 pb-16 md:pb-32` |
| Footer | `pt-16 pb-8` |

### Component Spacing

| Component | Padding | Margin |
|-----------|---------|--------|
| Navigation | `px-6 md:px-10 py-5` | - |
| Large feature card | `p-10 md:p-12` | - |
| Small feature card | `p-7` | - |
| FAQ item | `px-6 py-4` | `space-y-4` between |
| Buttons | `px-5 py-2.5` to `px-7 py-3` | - |

### Container Widths

| Element | Max Width |
|---------|-----------|
| Main content | `max-w-[1400px]` |
| Features section | `max-w-7xl` |
| FAQ section | `max-w-3xl` |
| CTA section | `max-w-5xl` |
| Footer | `max-w-6xl` |

---

## Components

### Buttons

**Primary Button**
```html
<a class="px-5 py-2.5 text-sm font-medium text-white bg-neutral-900 hover:bg-neutral-800 rounded-xl">
  Download
</a>
```

**Secondary/Ghost Button**
```html
<a class="px-5 py-2.5 text-sm font-medium text-neutral-700 hover:text-neutral-900">
  Sign in
</a>
```

**Tab Button (Active)**
```html
<button class="px-7 py-3 rounded-2xl text-lg bg-white text-neutral-900 font-semibold shadow-sm border border-neutral-300">
  Groups
</button>
```

**Tab Button (Inactive)**
```html
<button class="px-7 py-3 rounded-2xl text-lg text-neutral-400 font-medium hover:text-neutral-700">
  Messaging
</button>
```

### Cards

**Feature Card (Large)**
```html
<div class="rounded-3xl p-10 md:p-12" style="background: linear-gradient(180deg, #e5d2c0 0%, #f0e5db 40%, #f8f2ec 70%, #f0e5db 100%)">
  <!-- Content -->
</div>
```

**Feature Card (Small)**
```html
<div class="bg-neutral-50 rounded-2xl p-7 border border-neutral-200">
  <!-- Content -->
</div>
```

**FAQ Card**
```html
<div class="bg-white rounded-xl border border-neutral-200">
  <!-- Content -->
</div>
```

### Icon Containers

```html
<div class="w-10 h-10 bg-white rounded-xl flex items-center justify-center text-neutral-700 border border-neutral-200">
  <!-- Icon -->
</div>
```

### Badges/Pills

**Integration Badge**
```html
<div class="inline-flex items-center gap-3 px-5 py-3 bg-neutral-900 rounded-full">
  <img src="..." class="h-6 w-6" />
  <span class="text-white/90 text-sm">
    <strong class="text-white font-semibold">Planning Center integration</strong> available to sync your member data.
  </span>
</div>
```

---

## Backgrounds & Gradients

### Hero Background

The hero uses a multi-layer background effect:

1. **Base gradient** (warm tan, darker at edges):
```css
background: linear-gradient(180deg, #e5d2c0 0%, #f0e5db 25%, #f8f2ec 50%, #f0e5db 75%, #e5d2c0 100%);
```

2. **Radial white glow** (center focus):
```css
background: radial-gradient(ellipse 80% 50% at 50% 45%, rgba(255,255,255,0.7) 0%, rgba(255,255,255,0) 70%);
```

3. **Noise texture overlay** (subtle grain):
```css
opacity: 0.1;
mix-blend-mode: overlay;
```

### Feature Section Gradient

```css
background: linear-gradient(180deg, #e5d2c0 0%, #f0e5db 40%, #f8f2ec 70%, #f0e5db 100%);
```

### CTA Overlay

```css
background: linear-gradient(to bottom, rgba(0,0,0,0.2) 0%, rgba(0,0,0,0.45) 50%, rgba(0,0,0,0.75) 100%);
```

---

## Border Radius

| Size | Value | Usage |
|------|-------|-------|
| `rounded-xl` | `0.75rem` | Small buttons, FAQ items |
| `rounded-2xl` | `1rem` | Tabs, small cards, images |
| `rounded-3xl` | `1.5rem` | Large feature cards |
| `rounded-[1.5rem]` | `1.5rem` | Hero container (mobile) |
| `rounded-[1.75rem]` | `1.75rem` | Hero container (desktop) |
| `rounded-[2rem]` | `2rem` | CTA section |
| `rounded-full` | `9999px` | Pills, badges |

### Page-Level Rounding

- Main content area: `rounded-b-[2.5rem] md:rounded-b-[3rem]`
- Creates "squircle" container effect

---

## Shadows

Keep shadows minimal and subtle:

```css
/* Light shadow for elevated elements */
shadow-sm

/* Larger shadow for images/mockups */
shadow-xl
```

---

## Animations

### Subtle Bounce (Hero Phone)

```css
@keyframes bounce-subtle {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-10px); }
}

.animate-bounce-subtle {
  animation: bounce-subtle 3s ease-in-out infinite;
}
```

### Global Transitions

All elements have smooth transitions by default:

```css
transition-property: background-color, border-color, color, fill, stroke, opacity, box-shadow;
transition-duration: 150ms;
transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1);
```

---

## Icons

Use SVG icons with consistent sizing:

| Size | Class | Usage |
|------|-------|-------|
| Small | `w-5 h-5` | Default icons |
| Medium | `w-6 h-6` | Mobile menu |
| Feature placeholder | `w-14 h-14` | Large decorative |

**Icon Styling:**
- Stroke-based (not filled)
- `stroke-width="2"`
- `stroke-linecap="round"`
- `stroke-linejoin="round"`
- Color: `currentColor` (inherits from parent)

---

## Responsive Breakpoints

Following Tailwind defaults:

| Breakpoint | Min Width | Usage |
|------------|-----------|-------|
| `sm` | 640px | Small tablets |
| `md` | 768px | Tablets, desktop nav |
| `lg` | 1024px | Desktop layouts |
| `xl` | 1280px | Wide desktop |
| `2xl` | 1536px | Extra wide |

### Common Patterns

- Text scaling: `text-5xl md:text-6xl xl:text-7xl`
- Layout changes: `flex-col xl:flex-row`
- Padding adjustments: `px-6 md:px-10 lg:px-16`
- Show/hide: `hidden md:flex`

---

## Page Structure

```
<body class="bg-neutral-900">
  <main class="relative z-10 bg-white rounded-b-[2.5rem] md:rounded-b-[3rem]">
    <!-- Hero Section (with squircle container) -->
    <!-- Trusted By Section -->
    <!-- Features Section -->
    <!-- FAQ Section -->
    <!-- CTA Section -->
  </main>
  <footer class="sticky bottom-0 z-0">
    <!-- Footer (reveals as you scroll past main) -->
  </footer>
</body>
```

---

## Logo

The Togather logo is a stylized tree with three "leaves" represented as outlined ellipses:

- SVG viewBox: `0 0 100 120`
- Stroke-based design
- Stroke width: 5
- Color: `currentColor` (usually neutral-800 or white)

---

## Do's and Don'ts

### Do
- Use warm, cream-based backgrounds
- Maintain generous whitespace
- Use rounded corners consistently
- Keep text neutral/warm gray
- Apply subtle animations

### Don't
- Use pure white backgrounds (prefer warm tints)
- Use cold grays or blues
- Use sharp corners on cards
- Use bold colors for body text
- Use harsh shadows
