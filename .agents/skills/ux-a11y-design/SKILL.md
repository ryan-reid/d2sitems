---
name: ux-a11y-design
description: >-
  UX styling, authentic D2R visual fidelity, responsive design, and accessibility runbook
  for d2sitems. Use this skill when modifying styles (CSS), refining panel layouts, ensuring
  mobile 390px compatibility, or auditing keyboard navigation and ARIA attributes.
---

# UX, Visual Fidelity & Accessibility Runbook

This guide defines the design system, responsive standards, and accessibility requirements for `d2sitems`.

## 1. Design System & Visual Tokens
The application adheres to the dark gothic palette of Diablo II: Resurrected and the BT-BK Wiki design system:
- **Backgrounds**: `--bg: #101113`, `--bg-2: #141518`, `--surface: #191b1f`, `--raised: #282b31`
- **Borders & Lines**: `--line: #33363d`
- **Accents**: `--gold: #d9b56c`, `--accent: #d4a359`
- **Quality Colors**:
  - Unique: `#c7b377` (Gold)
  - Set: `#00ff00` (Vibrant Green)
  - Runeword: `#ffd700` (Warm Gold)
  - Rare: `#ffff00` (Yellow)
  - Magic: `#4169e1` (Royal Blue)
  - Crafted: `#ff8c00` (Orange)
  - Rune: `#ff8000` (Orange/Amber)

## 2. Responsive Breakpoints & Standards
Every view (Search, Characters, Armory, Holy Grail, Verifier) must be fully functional across three standard viewport widths:
1. **Desktop (`1400px+`)**: Multi-column armory panels, side-by-side filters, 4-column loot grids.
2. **Tablet (`900px`)**: Single-column collapsible filter details (`<details class="filter-sidebar">`), horizontal-scrolling panel containers with clear overflow hints.
3. **Mobile (`390px` iPhone portrait)**:
   - Zero horizontal page scrolling (`overflow-x: hidden` on body/site-shell).
   - Navigation buttons wrapped into 2-column grids.
   - Masthead controls stack neatly.
   - Filter dropdowns and inputs span 100% width.
   - Item cards format in single-column stacks with readable typography.

## 3. Accessibility (WCAG AA Checklist)
- **Visible Keyboard Focus**: `:focus-visible` must display `outline: 2px solid var(--gold); outline-offset: 3px;`.
- **Navigation Landmark**: `<nav class="mast-nav" aria-label="Primary navigation">` with active tab marked by `aria-current="page"`.
- **Modals**:
  - Container must have `role="dialog"` and `aria-modal="true"`.
  - Heading linked via `aria-labelledby`.
  - Close buttons must have `aria-label="Close dialog"`.
  - Focus must cycle within the modal; hitting `Esc` must close it and restore focus.
- **Item Cards & Cells**: Must be keyboard-activatable (`Enter` or `Space` opens detail modal).

## 4. Headless Screenshot Validation
To verify visual changes without manual browsing, run:
```powershell
powershell -ExecutionPolicy Bypass -File scripts/capture_viewports.ps1 -Url "http://127.0.0.1:5000"
```
Screenshots are saved to the scratch directory at Desktop (`1400x900`), Tablet (`900x800`), and Mobile (`390x844`).
