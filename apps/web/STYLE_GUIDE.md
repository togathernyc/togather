# Togather Design System

A comprehensive style guide for maintaining visual consistency across Togather products.

---

## Color Palette

### Primary Colors (Warm Brown/Tan)

Our primary palette uses warm, earthy tones that feel approachable and community-focused.

| Token           | Hex       | Usage                                    |
| --------------- | --------- | ---------------------------------------- |
| `primary-50`    | `#faf7f4` | Very light backgrounds                   |
| `primary-100`   | `#f5ede5` | Light backgrounds, mobile menu           |
| `primary-200`   | `#ecddd0` | Borders, dividers                        |
| `primary-300`   | `#dfc6b0` | Disabled states                          |
| `primary-400`   | `#d4a574` | Accent color (use sparingly)             |
| `primary-500`   | `#c8935f` | Hover accents                            |
| `primary-600`   | `#b87d4a` | Active/pressed accents                   |
| `primary-700`   | `#9a6640` | Dark accents                             |
| `primary-800`   | `#7d5339` | Very dark accents                        |
| `primary-900`   | `#664531` | Text on light backgrounds                |

### Neutral Colors (Warm Grays)

Warm gray tones that complement the primary palette. **These are used most frequently.**

| Token          | Hex       | Usage                                     |
| -------------- | --------- | ----------------------------------------- |
| `neutral-50`   | `#fafaf9` | Feature card backgrounds                  |
| `neutral-100`  | `#f5f5f4` | Alternating rows                          |
| `neutral-200`  | `#e7e5e4` | Card borders, dividers                    |
| `neutral-300`  | `#d6d3d1` | Active tab borders, disabled borders      |
| `neutral-400`  | `#a8a29e` | Placeholder text, subtle text, icons      |
| `neutral-500`  | `#78716c` | Secondary text                            |
| `neutral-600`  | `#57534e` | Body text (secondary), footer text        |
| `neutral-700`  | `#44403c` | Body text, navigation links               |
| `neutral-800`  | `#292524` | **Primary text**, giant wordmark          |
| `neutral-900`  | `#1c1917` | **Headings**, primary buttons, footer bg  |

### Accent Colors

Used sparingly for status indicators.

| Token        | Hex       | Usage                |
| ------------ | --------- | -------------------- |
| `accent-400` | `#4ade80` | Success (light)      |
| `accent-500` | `#22c55e` | Success, active      |
| `accent-600` | `#16a34a` | Success (dark)       |

### Semantic Colors

```css
--color-success: #22c55e
--color-warning: #f59e0b
--color-error: #ef4444
```

---

## Hero Background Gradient

The hero section uses a layered gradient for depth and warmth:

### Base Gradient

```css
background: linear-gradient(
  180deg,
  #e5d2c0 0%,    /* Darker tan at edges */
  #f0e5db 25%,   /* Warm cream */
  #f8f2ec 50%,   /* Lightest in center */
  #f0e5db 75%,   /* Warm cream */
  #e5d2c0 100%   /* Darker tan at edges */
);
```

### Radial White Glow (Overlay)

```css
background: radial-gradient(
  ellipse 80% 50% at 50% 45%,
  rgba(255, 255, 255, 0.7) 0%,
  rgba(255, 255, 255, 0) 70%
);
```

### Feature Card Gradient (Same pattern)

```css
background: linear-gradient(
  180deg,
  #e5d2c0 0%,
  #f0e5db 40%,
  #f8f2ec 70%,
  #f0e5db 100%
);
```

---

## Typography

### Font Family

**Plus Jakarta Sans** — A clean, modern sans-serif with slightly rounded letterforms.

```css
font-family: 'Plus Jakarta Sans', system-ui, -apple-system, sans-serif;
```

**Google Fonts link:**

```html
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
```

### Font Weights

| Weight          | Usage                                    |
| --------------- | ---------------------------------------- |
| 400 (Regular)   | Body text, descriptions                  |
| 500 (Medium)    | Navigation, labels, FAQ questions        |
| 600 (Semibold)  | Subheadings, card titles, tab labels     |
| 700 (Bold)      | Page headings, section titles, emphasis  |

### Type Scale

| Element             | Size                        | Weight | Line Height | Class                              |
| ------------------- | --------------------------- | ------ | ----------- | ---------------------------------- |
| Hero H1             | 3rem → 3.75rem → 4.5rem     | 700    | 1.1         | `text-5xl md:text-6xl xl:text-7xl` |
| Section H2          | 2.25rem → 3rem              | 700    | 1.2         | `text-4xl md:text-5xl`             |
| Feature Headline    | 1.5rem → 1.75rem            | 500    | 1.4         | `text-2xl md:text-[1.75rem]`       |
| Card Title (H4)     | 1.125rem                    | 700    | 1.4         | `text-lg font-bold`                |
| Body Large          | 1.125rem                    | 400    | 1.6         | `text-lg`                          |
| Body                | 1rem                        | 400    | 1.5         | `text-base`                        |
| Small               | 0.875rem                    | 400/500| 1.4         | `text-sm`                          |
| Extra Small         | 0.75rem                     | 400    | 1.4         | `text-xs`                          |

### Text Balance

All headings use `text-wrap: balance` for better line breaks.

---

## Spacing

### Base Unit

Use multiples of 4px (0.25rem) for consistent spacing.

| Token | Value          | Usage                          |
| ----- | -------------- | ------------------------------ |
| `2`   | 0.5rem (8px)   | Icon gaps, tight spacing       |
| `3`   | 0.75rem (12px) | Small padding                  |
| `4`   | 1rem (16px)    | Standard padding               |
| `5`   | 1.25rem (20px) | Button padding, card gaps      |
| `6`   | 1.5rem (24px)  | Card padding, section gaps     |
| `7`   | 1.75rem (28px) | Feature card padding           |
| `8`   | 2rem (32px)    | Section gaps                   |
| `10`  | 2.5rem (40px)  | Large section padding          |
| `12`  | 3rem (48px)    | Section padding                |
| `16`  | 4rem (64px)    | Section padding (mobile)       |
| `20`  | 5rem (80px)    | Section padding (desktop)      |

---

## Border Radius

| Token     | Value            | Usage                                |
| --------- | ---------------- | ------------------------------------ |
| `xl`      | 0.75rem (12px)   | Buttons, small cards                 |
| `2xl`     | 1rem (16px)      | Tabs, feature cards, image cards     |
| `3xl`     | 1.5rem (24px)    | Large feature cards                  |
| `[2rem]`  | 2rem (32px)      | CTA section                          |
| `[2.5rem]`| 2.5rem (40px)    | Main content bottom corners          |
| `[3rem]`  | 3rem (48px)      | Main content (desktop)               |

### Hero Squircle Pattern

```jsx
<div className="rounded-[1.5rem] md:rounded-[1.75rem]">
  {/* Hero container */}
</div>
```

### Main Content Container

```jsx
<main className="rounded-b-[2.5rem] md:rounded-b-[3rem]">
  {/* Page content sits on dark footer */}
</main>
```

---

## Shadows

| Token | Value                                    | Usage                |
| ----- | ---------------------------------------- | -------------------- |
| `sm`  | `0 1px 2px rgb(0 0 0 / 0.05)`            | Active tabs          |
| `lg`  | `0 10px 15px -3px rgb(0 0 0 / 0.08)`     | Modals, dropdowns    |
| `xl`  | `0 20px 25px -5px rgb(0 0 0 / 0.08)`     | Image cards          |

---

## Components

### Primary Button (Dark)

```jsx
<a className="px-5 py-2.5 text-sm font-medium text-white bg-neutral-900 hover:bg-neutral-800 rounded-xl">
  Download
</a>
```

### Secondary Button (Text)

```jsx
<a className="px-5 py-2.5 text-sm font-medium text-neutral-700 hover:text-neutral-900">
  Sign in
</a>
```

### Tab Navigation

```jsx
<div className="inline-flex flex-wrap gap-3">
  {/* Active Tab */}
  <button className="px-7 py-3 rounded-2xl text-lg bg-white text-neutral-900 font-semibold shadow-sm border border-neutral-300">
    Active
  </button>

  {/* Inactive Tab */}
  <button className="px-7 py-3 rounded-2xl text-lg text-neutral-400 font-medium hover:text-neutral-700">
    Inactive
  </button>
</div>
```

### Feature Card (Small)

```jsx
<div className="bg-neutral-50 rounded-2xl p-7 border border-neutral-200">
  <div className="flex items-center gap-3.5 mb-3">
    <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center text-neutral-700 border border-neutral-200">
      {/* Icon */}
    </div>
    <h4 className="text-lg font-bold text-neutral-900">Title</h4>
  </div>
  <p className="text-neutral-600 text-[0.95rem] leading-relaxed">
    Description text
  </p>
</div>
```

### Feature Card (Large/Gradient)

```jsx
<div
  className="rounded-3xl p-10 md:p-12"
  style={{
    background: "linear-gradient(180deg, #e5d2c0 0%, #f0e5db 40%, #f8f2ec 70%, #f0e5db 100%)"
  }}
>
  <h3 className="text-2xl md:text-[1.75rem] font-medium text-neutral-800 leading-snug">
    Headline text
  </h3>
  {/* Content */}
</div>
```

### FAQ Accordion

```jsx
<div className="bg-white rounded-xl border border-neutral-200">
  <button className="w-full px-6 py-4 flex items-center justify-between">
    <span className="font-medium text-neutral-900">Question</span>
    <span className="text-neutral-400 transition-transform rotate-0 data-[open]:rotate-45">
      <IconPlus />
    </span>
  </button>
  <div className="px-6 pb-4">
    <p className="text-neutral-600">Answer</p>
  </div>
</div>
```

### Integration Badge

```jsx
<div className="inline-flex items-center gap-3 px-5 py-3 bg-neutral-900 rounded-full">
  <img src="/images/logo.png" className="h-6 w-6" />
  <span className="text-white/90 text-sm">
    <strong className="text-white font-semibold">Integration name</strong> available.
  </span>
</div>
```

---

## Layout

### Container

```jsx
<div className="max-w-7xl mx-auto px-6 md:px-10">
  {/* Main content */}
</div>

<div className="max-w-6xl mx-auto px-6">
  {/* Footer, narrower content */}
</div>

<div className="max-w-3xl mx-auto px-6">
  {/* FAQ, centered content */}
</div>
```

### Page Structure

```jsx
<div className="bg-neutral-900">
  <main className="relative z-10 bg-white rounded-b-[2.5rem] md:rounded-b-[3rem] pb-8">
    {/* All page sections */}
  </main>
  <footer className="sticky bottom-0 z-0">
    {/* Footer (revealed as you scroll) */}
  </footer>
</div>
```

### Section Spacing

- Mobile: `py-12 md:py-10` to `py-16 md:py-20`
- Features: `pt-6 md:pt-10 pb-16 md:pb-20`
- CTA: `pt-12 md:pt-24 pb-16 md:pb-32`

---

## Footer

### Dark Footer with Wordmark

```jsx
<footer className="sticky bottom-0 z-0 text-white">
  <div className="max-w-6xl mx-auto px-6 pt-16 pb-8">
    {/* Content */}
  </div>

  {/* Giant wordmark */}
  <div className="max-w-6xl mx-auto px-6 -mb-[0.15em]">
    <p className="text-[8rem] md:text-[12rem] lg:text-[16rem] font-bold text-neutral-800">
      Togather
    </p>
  </div>
</footer>
```

### Footer Colors

- Background: `neutral-900` (inherits from page wrapper)
- Links: `neutral-400` → `white` on hover
- Section headers: `neutral-300` (uppercase, tracking-wider)
- Copyright: `neutral-600`
- Wordmark: `neutral-800` (slightly lighter than bg)

---

## Animation

### Bounce Animation

Used for hero phone mockup:

```css
@keyframes bounce-subtle {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-10px); }
}

.animate-bounce-subtle {
  animation: bounce-subtle 3s ease-in-out infinite;
}
```

### Transitions

Global smooth transitions (150ms):

```css
* {
  transition-property: background-color, border-color, color, fill, stroke, opacity, box-shadow;
  transition-duration: 150ms;
  transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1);
}
```

---

## Images & Assets

### Logo Logos

- Partner logos: Grayscale at 60% opacity, full color on hover
- Class: `opacity-60 grayscale hover:opacity-100 hover:grayscale-0`

### App Store Badges

- Hero: `h-[52px]`
- CTA: `h-[40px]`

### CTA Background Image

```jsx
<img
  src="/images/cta-community.webp"
  className="absolute inset-0 w-full h-full object-cover blur-[2px] scale-[1.01]"
  style={{ objectPosition: "center 30%" }}
/>
{/* Gradient overlay */}
<div
  className="absolute inset-0"
  style={{
    background: "linear-gradient(to bottom, rgba(0,0,0,0.2) 0%, rgba(0,0,0,0.45) 50%, rgba(0,0,0,0.75) 100%)"
  }}
/>
```

---

## Accessibility

### Color Contrast

- Primary text (`neutral-800`) on white: 12.6:1 ratio ✓
- Secondary text (`neutral-600`) on white: 7.1:1 ratio ✓
- White text on `neutral-900`: 18.1:1 ratio ✓

### Focus States

```css
focus:outline-none focus:ring-2 focus:ring-neutral-400 focus:ring-offset-2
```

### Touch Targets

Minimum 44x44px for interactive elements on mobile.

---

## Quick Reference

### Most Used Classes

```
Text:        text-neutral-900, text-neutral-700, text-neutral-600, text-neutral-400
Backgrounds: bg-white, bg-neutral-50, bg-neutral-900
Borders:     border-neutral-200, border-neutral-300
Buttons:     bg-neutral-900 hover:bg-neutral-800 text-white rounded-xl
Cards:       bg-neutral-50 rounded-2xl border border-neutral-200 p-7
Tabs:        rounded-2xl text-lg px-7 py-3
Spacing:     px-6 md:px-10 (container), p-7 (cards), gap-3 (buttons)
```

### Key Gradient (Hero/Feature)

```css
linear-gradient(180deg, #e5d2c0 0%, #f0e5db 40%, #f8f2ec 70%, #f0e5db 100%)
```
