# VDS Partes — Design System (DS-01)

Direction approved as decision **D-2**; recorded as contradiction **CC-03** because it
supersedes the "no new visual identity" clause of `15_UX_PRESERVATION.md`. Change-control
class **IMPLEMENTACIÓN** per sheet 73: it does not reopen the functional freeze, because it
changes no domain, cardinality, Parte/UE identity, TipoParte, Interface A/B or rule engine.

## The line this system holds

**Preserved from Juan** — information architecture, per-role navigation, surface hierarchy,
Mi Jornada, Planning (Gantt / resource / month), the work drawer, list–detail inboxes,
plan-vs-real comparison, interaction logic, information density.

**Free to evolve** — palette, typography, scale, spacing, iconography, cards, tables,
panels, state representation, badges, alerts, hierarchy, density, secondary navigation,
touch interaction, offline/sync feedback, risk and readiness representation.

**Not allowed** — copying Juan's skin literally; importing the Blueprint's editorial
aesthetic into field surfaces; arbitrary redesign disconnected from the product; a generic
SaaS template.

> Any **structural** change to navigation or behaviour needs a functional justification.
> Aesthetics are never the reason a screen moves.

## 1. Principles

1. **The state *is* the content.** Operational, Review VDS, Commercial, Habilita and
   Delivery are five independent dimensions (S0 §8). They never collapse into one chip
   without a path to the underlying dimensions. The prototype's single
   `plan|curso|env|obs|apr|cert` is the thing this system exists to undo.
2. **Density serves the task.** Each surface declares a density tier. There is no single
   layout applied to field, planning and analysis alike.
3. **Risk is visible before the action.** Blocks, warnings and missing items are counted
   **separately**, each linking to the datum and explaining the effect. Never one
   undifferentiated "9 pendientes".
4. **Every figure carries source and recency.** A number without `source` + `as_of` is a
   defect, not a design choice.
5. **Truthful language.** "Guardado en el dispositivo" ≠ "Enviado" ≠ "Recibido". The word
   "Sincronizado" is reserved for a durable server receipt and nothing else.
6. **Touch-first where gloves are worn; dense where work is analysed.**
7. **Both themes are first class.** Field crews work in bright sun and at night.

## 2. Visual personality

Real Patagonian operations: industrial, precise, sober, robust. Flat, crisp surfaces with
defined borders and minimal shadow. No gradients for decoration, no illustration, no
rounded-friendly SaaS softness. Modernity is expressed as **clarity and reading speed**,
not as effects. The interface should feel like instrumentation that happens to be
well-made — and should still look current when maps, realtime and analytics arrive.

## 3. Colour — semantics first

The prototype used one red (`#C21F35`) for both brand and every primary action, which left
red unable to mean *critical*. DS-01 separates those roles: red stays the identity and
becomes the **critical signal only**; a steel blue carries action.

### Semantic roles

| Token | Role | Light | Dark |
|---|---|---|---|
| `--vds-brand` | identity only: logo, header signature | `#C21F35` | `#E8495F` |
| `--vds-action` | primary action, focus, selection | `#15608F` | `#58A6DC` |
| `--vds-critical` | hard block, hard gate, error | `#C21F35` | `#F2586C` |
| `--vds-warn` | overrideable warning | `#A05F00` | `#E09B3D` |
| `--vds-ok` | conforming, verified, accepted | `#1C7A52` | `#3DB184` |
| `--vds-pending` | unresolved, pending configuration | `#5E5E5E` | `#9B9B9B` |

**A warning is never shown in the critical colour**, because `RUL-040` and `AP-04` make the
difference consequential: a warning needs an `OverrideGate`, a hard block cannot be
overridden at all. Severity is also encoded in **shape and icon**, never colour alone.

**There is no generic `info` token.** A first draft had one, and it measured ΔE 0.051
against `action` — the same steel blue. That is worse than redundant: informational text in
the action colour reads as clickable. Here "informational" is always *about* something, so
it takes that thing's colour — a state dimension uses its `domain.*` hue, an unresolved
value uses `pending`, plain annotation uses `ink.muted`.

### Domain accents — Juan's hue families, values re-derived

Each dimension keeps its own hue so a reader identifies it without reading the label. A
Parte carries several dimensions at once, so these appear **side by side in one badge row**
and must be distinguishable from *each other*, not merely from the background.

Taking the prototype's `--st-*` / `--t-*` values literally failed that test: `--st-plan` vs
`--st-env` measured ΔE 0.098 and `--st-plan` vs `--st-apr` 0.079, both below the perceptible
floor. Nudging one hue at a time only moved the collision, so the six are solved together in
OKLCH — same hue **families** (blue, green, violet, teal, orange), re-derived values.

| Token | Dimension | Light | Dark | OKLCH hue | Family from |
|---|---|---|---|---|---|
| `--vds-plan` | Planning / intention | `#365DB8` | `#89B0FF` | 264 | `--st-plan` |
| `--vds-exec` | Execution / reality | `#037E3F` | `#69D98D` | 152 | `--t-op` |
| `--vds-review` | Review VDS | `#7B41A1` | `#C88EF1` | 310 | `--st-env` |
| `--vds-commercial` | Commercial / certification | `#118A95` | `#55E1F0` | 205 | `--st-apr` |
| `--vds-habilita` | Habilita / risk | `#AF4803` | `#FF9A6B` | 45 | `--st-obs` |
| `--vds-delivery` | Delivery / sync | `#404952` | `#89939E` | 250, C 0.02 | new |

`delivery` is near-neutral and offset in lightness on purpose: it is not a domain of the
work, it is transport status, and it should not compete with the five that describe the work.

**Measured:** all 15 domain pairs ΔE ≥ 0.112 in both themes; minimum contrast 4.12:1 (light)
and 4.85:1 (dark) against the panel, above the 3:1 a badge needs.

### Surfaces

Basalt and graphite in dark; stone in light. `canvas` → `surface` → `panel` → `raised`,
each with an explicit border token.

### How colour is verified

Two different metrics, because they answer two different questions:

- **WCAG contrast ratio** for *legibility against a background* — target AA (4.5:1 text,
  3:1 UI and graphical objects).
- **OKLab ΔE** for *telling two colours apart*. WCAG contrast compares relative luminance,
  so a blue and a green of similar lightness score ~1.0 while being obviously distinct —
  the wrong question for "can an operator distinguish a warning badge from a block badge".
  Floor ΔE 0.10 (clearly perceptible); 0.13 where confusion has operational consequences
  (`warn` vs `critical`, `plan` vs `exec`, `brand` vs `action`).

Both run in `packages/ui/test/tokens.test.ts` over every token pair — including pairs nobody
remembered to list — so a future token edit that makes two roles look alike fails the build.
This is a necessary condition only: colour is never the sole channel, which is asserted at
component level (`GateBanner`, `StateBadge`).

## 4. Typography

The Barlow family stays: it is industrial, reads well at density, and is already part of
the product's character. What changes is the scale and the discipline of use.

| Family | Use |
|---|---|
| **Barlow** | body, labels, buttons, most UI |
| **Barlow Condensed** | table headers, high-density labels, Gantt row labels |
| **IBM Plex Mono** | **IDs, timestamps, quantities, versions, hashes** — anything that gets compared or aligned |

Scale: `12 · 13 · 14 · 16 · 20 · 24 · 32`, each with a line-height bound to its density
tier. Tabular figures on every quantity. A `PD-0394`, an `07:20` and a `1 200 m²` are
monospace so they line up in a column and can be scanned for difference.

## 5. Density strategy

| Tier | Where | Row height | Touch target | Body |
|---|---|---|---|---|
| `field` | Mi Jornada, Trabajo activo, Flash Report, Start Work | ≥ 56px | ≥ 44×44 CSS px | 16px |
| `operations` | Planning, inboxes, Habilita matrix, config | 36–40px | ≥ 32px | 14px |
| `analysis` | dashboards, trace, lineage, coverage | 28–32px | ≥ 28px | 13px |

A tier is set by `data-density` on a container and inherited. **Field never inherits
`analysis`.** The 44px target is a target to verify on a device, not a claim — the
prototype's scaled frame made controls physically small, and that is a finding to fix, not
to reproduce.

## 6. Patterns per surface

**Field — Mi Jornada / Trabajo activo.** Context card, one large primary action, exception
tray. Readiness and gates appear as a **panel before the action**, with cause and remedy —
never a toast, never a blocking dialog the operator cannot read with gloves on. The Parte is
built progressively; the five steps of the prototype survive as *summary and completeness*,
not as a form to fill at the end of the day.

**Planning.** Dense analytic canvas. Gantt with truncation plus expansion/drawer, bands for
readiness, availability and conflict, and a **keyboard and form alternative to drag**
(today drag is pointer-only). A drag over the future proposes a version; a drag over
dispatched work shows the change and its ACK.

**Habilita.** Signage, not decoration. Blocks / warnings / missing counted apart. Severity
in colour **and** shape. PTW shows window and scope coverage, because "approved" is not
"in force" and an expiry is not a closure.

**Review / Certification.** Adaptive master–detail with **no horizontal scroll**.
Side-by-side plan-vs-real. Evidence, source version and lineage one click away. An
observation states whether it is a clarification, an operational error (→ amendment
request) or a commercial dispute (→ adjustment) — because those three have different
consequences for the field.

**Management / Dashboard.** Synthesis with `source` and `as_of` on every figure, and
drilldown to the facts. Changing a state must never make history disappear.

**Delivery / Sync.** A persistent strip with the five delivery states and a visible failure
path. Full local storage blocks new actions instead of silently discarding them.

## 7. Base components (`packages/ui`)

Tokens (2 themes × 3 density tiers) · `AppShell` + collapsible rail · `Page` / `Section` /
`Panel` · `DataTable` (virtualised, sticky header, keyboard navigable) · adaptive
`MasterDetail` · `Drawer` · `Timeline` · `StateBadge` (multi-dimension, popover to the
underlying dimensions) · `GateBanner` (blocks / warnings / missing, counted separately) ·
field inputs (time, quantity + UM, location, short select) · `EvidenceCapture` ·
`SignaturePad` · `GanttCanvas` · `CalendarResource` / `CalendarMonth` ·
`DeliveryStatusStrip` · `SourceTag` (source + `as_of` + freshness) · `ProvenanceChip` ·
`EmptyState` / `Loading` / `ErrorState` · `ConfirmSheet`.

## 8. Accessibility

The prototype already has labels, ARIA state, visible focus, `role=status` and
`prefers-reduced-motion`: **keep all of it**, and extend to the two places it stops —
clickable `<tr>` rows and the pointer-only Gantt. Focus trapping in modals, return to
trigger, zoom, screen reader and real touch targets are verified on a device before any
claim of conformance. No WCAG claim is made on inspection alone.

## 9. How this is verified

The visual layer of the test map changes meaning under D-2. It no longer checks pixel
equality with Juan. It checks:

1. **Capability equivalence** — a per-role walkthrough against `npm run legacy`: every
   capability in `docs/ux-inventory.md` is still reachable. A lost capability fails.
2. **DS-01 conformance** — tokens only, no literal colours in components; the three density
   tiers behave; both themes render.
3. **Contrast AA** — computed, per token pair.
4. **Keyboard and focus** — every interactive element, including Gantt and table rows.
5. **States** — empty, loading, error and the gate panel for every new surface.
