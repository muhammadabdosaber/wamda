---
name: 'Serene Cognitive Architecture: Forest Edition'
colors:
  surface: '#f9faf8'
  surface-dim: '#d9dad8'
  surface-bright: '#f9faf8'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f3f4f2'
  surface-container: '#edeeec'
  surface-container-high: '#e7e8e6'
  surface-container-highest: '#e1e3e1'
  on-surface: '#191c1b'
  on-surface-variant: '#434843'
  inverse-surface: '#2e3130'
  inverse-on-surface: '#f0f1ef'
  outline: '#737973'
  outline-variant: '#c3c8c1'
  surface-tint: '#4d6453'
  primary: '#061b0e'
  on-primary: '#ffffff'
  primary-container: '#1b3022'
  on-primary-container: '#819986'
  inverse-primary: '#b4cdb8'
  secondary: '#56642b'
  on-secondary: '#ffffff'
  secondary-container: '#d6e7a1'
  on-secondary-container: '#5a682f'
  tertiary: '#0d1a08'
  on-tertiary: '#ffffff'
  tertiary-container: '#212f1a'
  on-tertiary-container: '#87987c'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#d0e9d4'
  primary-fixed-dim: '#b4cdb8'
  on-primary-fixed: '#0b2013'
  on-primary-fixed-variant: '#364c3c'
  secondary-fixed: '#d9eaa3'
  secondary-fixed-dim: '#bdce89'
  on-secondary-fixed: '#161f00'
  on-secondary-fixed-variant: '#3e4c16'
  tertiary-fixed: '#d6e8c9'
  tertiary-fixed-dim: '#bbccae'
  on-tertiary-fixed: '#121f0c'
  on-tertiary-fixed-variant: '#3c4b34'
  background: '#f9faf8'
  on-background: '#191c1b'
  surface-variant: '#e1e3e1'
typography:
  display-lg:
    fontFamily: Plus Jakarta Sans
    fontSize: 48px
    fontWeight: '700'
    lineHeight: 56px
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Plus Jakarta Sans
    fontSize: 32px
    fontWeight: '600'
    lineHeight: 40px
  headline-lg-mobile:
    fontFamily: Plus Jakarta Sans
    fontSize: 28px
    fontWeight: '600'
    lineHeight: 36px
  headline-md:
    fontFamily: Plus Jakarta Sans
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
  body-lg:
    fontFamily: Inter
    fontSize: 18px
    fontWeight: '400'
    lineHeight: 28px
  body-md:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  label-md:
    fontFamily: JetBrains Mono
    fontSize: 14px
    fontWeight: '500'
    lineHeight: 20px
    letterSpacing: 0.02em
  label-sm:
    fontFamily: JetBrains Mono
    fontSize: 12px
    fontWeight: '500'
    lineHeight: 16px
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  unit: 8px
  container-max: 1200px
  gutter: 24px
  margin-mobile: 16px
  margin-desktop: 40px
  stack-sm: 12px
  stack-md: 24px
  stack-lg: 48px
---

## Brand & Style

The design system adopts a **Modern Minimalist** aesthetic with a focus on **biophilic** calming principles. It is specifically engineered for cognitive accessibility, prioritizing low visual noise and high legibility to support users with ADHD or sensory processing sensitivities. 

The atmosphere is professional, grounded, and restorative. By moving away from artificial purples toward a "Deep Forest & Sage" palette, the UI leverages natural color psychology to reduce cortisol levels and encourage deep focus. The style utilizes heavy whitespace, crisp systematic layouts, and a "Tonal Layering" approach to create clear visual hierarchies without relying on overstimulating shadows or complex gradients.

## Colors

The palette is anchored by **Deep Forest (#1B3022)**, used primarily for high-contrast text and essential structural elements. **Muted Sage (#8A9A5B)** serves as the primary action color, providing a clear but non-aggressive focal point for interactive elements. **Soft Moss (#A9BA9D)** is utilized for secondary UI components and subtle highlights.

The background uses a tinted neutral (#F8F9F7) to reduce the "dazzle" effect of pure white, which can be taxing for neurodivergent readers. High-contrast ratios (minimum 7:1 for body text) are maintained throughout to ensure effortless readability.

## Typography

This design system employs a multi-font strategy to differentiate information types clearly. **Plus Jakarta Sans** provides a friendly, open geometric feel for headlines, aiding in quick scanning. **Inter** is used for body copy due to its exceptional legibility and neutral character, which minimizes "word crowding" for ADHD users. 

**JetBrains Mono** is used for labels and secondary data to provide a distinct visual "texture" for technical or metadata information, helping the user categorize information types at a glance. For Arabic support, these fonts are paired with system-standard humanist sans-serifs that maintain matching x-heights and stroke weights to ensure a seamless bilingual experience.

## Layout & Spacing

The layout philosophy follows a **Rigid Tonal Grid**. Content is housed in clearly defined containers to provide "anchors" for the eye. A 12-column fluid grid is used for desktop, collapsing to a single column for mobile.

To support cognitive ease, the spacing rhythm is generous. Increased vertical spacing ("stack") between sections prevents visual overwhelm. Content is grouped logically using the `stack-md` unit, while unrelated sections are separated by `stack-lg` to provide a clear mental break.

## Elevation & Depth

To keep cognitive load low, the design system avoids complex drop shadows. Instead, it uses **Tonal Layering** and **Low-Contrast Outlines**. 

- **Surface Level 0:** The base background (#F8F9F7).
- **Surface Level 1:** Raised cards or containers use a white background with a 1px border in Soft Moss (#A9BA9D) at 30% opacity.
- **Surface Level 2:** Active or focused elements use a subtle 2px solid border in Muted Sage (#8A9A5B).

Depth is communicated through color density rather than light source simulation. Higher-priority items have darker, more "weighted" backgrounds (e.g., Deep Forest), while background elements are lighter and more desaturated.

## Shapes

The shape language uses **Rounded (0.5rem)** corners as the standard. This approach strikes a balance between the clinical precision of sharp corners and the overly-playful nature of pill shapes. This "soft-square" geometry provides a professional, architectural feel that is easy for the eye to follow along a grid.

## Components

### Buttons
- **Primary:** Deep Forest (#1B3022) background with white text. High contrast for immediate identification.
- **Secondary:** Muted Sage (#8A9A5B) ghost button with a 1.5px border.
- **Tertiary:** Text-only in Muted Sage with a JetBrains Mono label style.

### Input Fields
Inputs use a white background with a 1px border in Soft Moss. Upon focus, the border thickens to 2px in Muted Sage, and a very soft 4px outer glow of Sage (at 10% opacity) is applied to provide a clear "active state" without being distracting.

### Chips
Used for filtering and categorization. They utilize the `label-sm` typography and the Soft Moss (#A9BA9D) color at 20% opacity for the background, ensuring they are visible but subordinate to primary actions.

### Cards
Cards must always have a defined border rather than a shadow. Use a 1px border (#A9BA9D) and a 24px internal padding to ensure content within the card has plenty of breathing room (the "Focus Zone").

### Lists
Lists are separated by thin horizontal rules in Soft Moss (15% opacity). For ADHD-friendly scanning, list items should have a minimum height of 56px to ensure a large hit-target and clear visual separation.