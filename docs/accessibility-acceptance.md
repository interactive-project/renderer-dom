# Accessibility acceptance plan

This is the acceptance procedure for the built-in Quiz and Flashcards DOM renderers. The automated checks exercise the DOM contract in Node; they do not inspect a browser accessibility tree and are not a substitute for the manual checks below. No browser/assistive-technology certification is claimed by this package.

## Implemented contract

- Controls are native `<button type="button">` elements. Browser Tab order, Enter activation and Space activation are retained; no custom key handler overrides those behaviors.
- Quiz question navigation is a labeled `<nav>` with one roving Tab stop. Left/Right moves between questions (direction-aware in RTL); Home/End move to the first/last question and navigation wraps. Question options remain ordinary Tab stops with `aria-pressed` state.
- After a rerender, focus moves to the relevant question, selected option, feedback, card face or next card. Non-interactive focus targets use `tabindex="-1"`.
- Progress and feedback use polite live status regions; failures use assertive alerts. Content fallbacks keep the schema-provided accessible alternative.
- The host sets `lang` and `dir`, using the preferred locale and common RTL language tags by default. English, Spanish and Arabic UI labels are bundled; `localize(messageKey, locale)` can override a label (`renderer-dom.*` for UI strings, `content.*` for ContentNode fallback messages). ContentNode text still follows the ContentNode locale-selection rules.
- `data-ip-part` and `data-ip-slot` provide style-neutral selectors. Optional `--ip-*` custom properties and `renderHooks.onElement` allow decoration without a framework. The built-in renderer adds no styles, animations or transitions; the host reflects reduced-motion preference in `data-motion-preference="reduce"` for host-provided styles.
- Hosts can request `interactionMode: "nonvisual"`; that mode is passed to registered renderer adapters and reflected as `data-interaction-mode`. In this mode the built-in renderer skips visual ContentNode drivers and uses the schema's accessible plain-text alternatives. The reserved renderer service also exposes `dispatchAction(kind, payload)`, which supplies host-owned identity, sequence and cancellation. Built-in Quiz/Flashcards controls remain native text-first controls. Advanced activity renderers must provide their own domain-aware nonvisual controls and use accessible ContentNode alternatives; the host does not invent actions for an unknown activity schema.

## Automated checks

`npm test` checks role/name/state attributes, built-in and host-overridden labels, language/direction, roving tab stops, RTL arrow mapping, Home navigation, focus restoration, style hooks/tokens and accessible content fallback. `fixtures/accessibility-contract.v1.json` is the compact contract fixture used when extending those tests.

For a browser CI layer, run axe-core (or an equivalent rule engine) against mounted Quiz and Flashcards fixtures in Chromium, Firefox and WebKit. Treat automated findings as a triage signal, not proof of usability; include at least one browser/AT pairing in release acceptance.

## Manual keyboard and assistive-technology scenarios

Use a supported browser with NVDA + Firefox or Chrome, VoiceOver + Safari, or the project's chosen equivalent. Repeat with a right-to-left locale and with the operating system's reduced-motion preference enabled.

1. Starting at the document before the activity, Tab through the activity. Confirm each visible action is reachable in reading order, the focused control has a visible host-provided focus indicator, Enter and Space activate buttons once, and focus does not escape the activity unexpectedly.
2. In a multi-question Quiz, Tab to the question navigation. Confirm only the current question is in the Tab sequence; use Left/Right, Home and End and verify the question, current marker, accessible name and focus stay synchronized. Reverse the expected arrow direction in RTL.
3. Start the Quiz, choose an option, submit and finish. Confirm focus moves to the question, remains on the selected answer after its state update, then moves to and announces feedback/completion without losing the activity context.
4. Start a Flashcards session, reveal a back, rate or acknowledge it, advance, and finish. Confirm focus lands on the revealed back or next front as applicable, and progress/completion is announced once and in a useful order.
5. With a content kind that has no driver, confirm its plain-text alternative is announced and no authored markup is executed. With media, confirm the alternative is available while the host-controlled asset operation is pending or unavailable.
6. Under reduced motion, confirm the built-in view has no movement or transition and any host styling responds to the `data-motion-preference="reduce"` attribute. In RTL, confirm reading order, direction, labels and navigation all agree.
7. For an advanced activity with a registered adapter, mount with `interactionMode: "nonvisual"`. Confirm its text-first alternative exposes every meaningful action, current state and feedback without requiring a visual canvas. If the activity has no registered adapter, confirm the host reports it as unsupported rather than implying an interaction path exists.

Record browser, OS, locale, assistive-technology version and any deviations. Do not mark manual acceptance complete based only on the Node test suite.
