# OneConv web design

Design specification, 2026-09-09. Implementation and visual verification remain
pending. The goal is a polished, responsive product for people who do not use
terminals or manage machines.

## Visual direction

Use precise typography, generous but useful spacing, quiet neutral surfaces,
fine borders and a single restrained accent. Provide complete light and dark
themes. Use translucent material selectively in navigation and floating
controls; keep transcript text, forms and account lists on readable surfaces.
Glass is a hierarchy cue, not decoration on every card.

This is a web interface informed by platform design principles. CSS blur is not
Apple's native Liquid Glass, and the product must work across browsers and OSes.
Opaque fallbacks must remain attractive and fully usable. Avoid full-page blur,
continuous decorative animation, nested glass surfaces and low-contrast text.

Build a coherent token system for typography, semantic colors, spacing, radii,
elevation and motion. Use a system font stack initially with a comfortable
reading measure around 65 characters. Layout should use available width while
keeping text readable; a wide window must not become a giant empty two-column
status table. Avoid framework-default dashboard styling.

## Product structure

The entry screen leads through Account -> AI connections -> Assistant setup.
One primary action per step. Contribution choices are optional and separate.
Preserve progress across reloads and interrupted provider authentication.

The signed-in application has Connections, Conversations and Assistant access,
with account/privacy controls in Settings. Infrastructure, Box names, workers
and provider API details do not appear in the ordinary setup journey.

Connections show compact provider rows with recognizable identities, account
names and one primary status. Multiple personal/work accounts expand underneath
the provider. Full-row hover and keyboard focus make the active item obvious.
An ordinary click opens details; context menus are optional shortcuts, never
the only path to an action. Phone layouts preserve status and actions inline.

Assistant access shows the stable MCP URL, a copy action, installation guidance
and an actual first-request status. Keep authorized assistants and revocation
visible. Copying a URL and completing OAuth do not count as a verified tool call.

Conversations use a searchable list and readable detail pane on wide screens;
smaller screens navigate between them. Preserve search, selection and scroll
position on back navigation. Source, account, timestamps and freshness remain
visible alongside content.

## Honest interaction states

Every async action has an immediate visible response and a finite outcome:
opening login, waiting for login, verifying, importing, ready, reconnect or error.
Show counts only when measured, and never fabricate percentage completion.
Provide meaningful cancellation/retry where supported and preserve useful data
when refresh fails. Do not replace an expired login with an endless spinner.

Connection summaries aggregate eligible accounts: any failure is red, incomplete
work is pending, and green requires every selected account to be verified.
Pairing-required is a distinct state only where an actual device pairing exists.
Icons and text accompany color. Show last successful sync and distinguish
partial history coverage from current authentication validity.

Errors explain the next useful action in plain language. Offer technical details
on demand with secrets and transcripts excluded from diagnostics. Optimistic
feedback is appropriate for copying a URL, not for successful authentication.

## Implementation

Use React, TypeScript, Vite and React Aria Components. Style with custom CSS
tokens and Tailwind utilities if useful. React Aria owns accessible interaction
behavior; the design system owns visual appearance. Keep Effect in domain and
network services, exposing explicit UI state through ordinary React boundaries.

Use CSS transitions for small state changes and progressively enhanced View
Transitions for navigation. Start with roughly 150–220 ms interaction motion,
then evaluate it in context. Honor reduced motion; essential status feedback
must work with animations disabled. Avoid adding an animation runtime until a
specific interaction needs it.

## Acceptance

- Verify Chrome, Safari and Firefox, plus narrow touch layouts and 200% zoom.
- No clipped status columns, accidental horizontal scrolling or nested scroll
  traps at supported sizes. Long names and translated text must wrap safely.
- Keyboard completion of onboarding, visible focus, labelled controls,
  screen-reader status announcements and no focus loss after async updates.
- WCAG 2.2 AA contrast and interaction requirements; test real rendered colors
  in light, dark, forced-color and reduced-motion configurations.
- Verify hover, focus, pressed, disabled, pending, empty, error and success states
  using visual regression and browser tests against a production build.
- Test slow networks, disconnect during login, session expiry and retry. A fake
  connector success screen is not a passing onboarding test.
- Measure interaction responsiveness and layout stability on representative
  devices; target INP <=200 ms, CLS <=0.1 and LCP <=2.5 s at the 75th percentile.

## References

- [Apple materials guidance](https://developer.apple.com/design/human-interface-guidelines/materials)
- [React Aria quality and accessibility](https://react-aria.adobe.com/quality)
- [Web motion accessibility](https://web.dev/learn/accessibility/motion)
- [View Transitions](https://web.dev/learn/css/view-transitions-spas)
- [WCAG 2.2](https://www.w3.org/TR/WCAG22/)
- [Core Web Vitals](https://web.dev/articles/vitals)
- [Effect error and dependency model](https://effect.website/docs/getting-started/why-effect/)
