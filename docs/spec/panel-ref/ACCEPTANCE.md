# Score panel: acceptance checklist

`panel-reference.html` is the source of truth for the score panel in BOTH the extension and the web app. Port its markup, CSS and `renderPanel(el, state)` logic. Do not redesign, restyle, reorder or rename anything. If your framework needs a component, wrap this code; don't reinterpret it.

The grader and local checks produce a `PanelState` (typedef in the file). The panel only renders that state.

## Changes since the reference (requested later; each is tested)
- **Developer Trust filter** replaces the objective rubric as the score that gates Post (config/grader-prompt.md has the filter verbatim). The three rubric bars become one bucket bar, Kill (0) | Low (<4) | Middle (4-7) | Sweet (8-10), with a marker at the score and the one-line why under it. A kill is a red block naming the category and quoting the span; "Post anyway" needs a typed reason and is logged. The Serving select stays as context; it never locks or caps anything.
- **Steps:** at most 2, each worth 1.0+, each kept only if it wins a pairwise "which would this reader rather read?" check without changing the tone. Questions are optional ("Skip, I don't have this", never changes the score); numbers Supertweet already has are filled in, never asked for; every step has "👎 Bad advice". If none qualify, the card says "Ready as written" and why, in one line.
- **X algorithm row:** "X algorithm N (advisory)" with **Tune for X** (one validated pass, both scores shown before anything changes, Accept/Undo; dropped if it would lower the trust score; "Already in good shape for X" if it can't add 1.0) and **Details** (at most 3 draft-specific fixes, each with a rewritten line and a Fix button, plus "N checks pass.").
- **Grading** runs when you press Grade (or ⌘/Ctrl+Enter): three grades, gated on the median, cached by draft; more than 1.0 apart shows "Unstable score" and doesn't lock you out.

## The gate
The gate is **score >= 8.0** (the pill says "needs 8+", so 8.0 passes). A draft that completes its "Get to 8" steps and lands on exactly 8.0 is Ready. Same rule in the extension, the web app and the server.

## Must be true (each is a test)
1. Top to bottom, in this order: header, "Serving" objective select, big score + pill, the trust bucket bar + why, flags (only if any), "Get to 8" card (only when locked), safety line (only when no flags), X algorithm row (X only), footer with Post button.
2. The objective appears exactly once: in the "Serving" select. No separate "Auto-detect objective" control and no objective sentence.
3. The score appears as one big number with "/10" and a pill reading "Locked · needs 8+" or "Ready". It is not repeated anywhere else on the page.
4. "Get to 8" lists at most 2 steps (each 1.0+), each with a title, a points value ("+2.0"), one sentence of why, and exactly one action. Header shows "N steps, +X".
5. Missing proof is an `attach_proof` step with an "Attach screenshot" button that opens the native media picker. It is never a banner, never a placeholder, never the Post button label "Fill in [...]".
6. The string "[" followed by uppercase placeholder text (e.g. "[LINK TO REPO") never appears anywhere in the panel, the draft, or the Post button. Grep test.
7. `ask_fact` steps show a labeled input and a before/after of exactly one line; Apply is disabled until there's an answer, and disabled if the result would exceed the character limit.
8. Applying any step edits only that one line. All other lines and all line breaks in the draft are byte-identical before and after. Test with the fixture draft.
9. A step is never shown unless applying it raises the score.
10. The algorithm appears as one row, "X algorithm N (advisory)", with Tune for X and Details. No meter. It never gates Post.
11. The Post button is the only Post control on the page. Remove the bottom status bar ("Agent builder · 5.0" plus a second button) from the web app.
12. Disabled Post label = the top blocker: "Answer N privacy questions", "Kill: <category>", "Add proof to post", or "5.0 / 10, needs 8+". Enabled label = "Post to X" or "Post to LinkedIn".

## Web app layout
Composer on the left, the panel on the right at max-width 440px, sticky to the top of the viewport. Below 900px wide, the panel stacks under the composer. The composer's own Image button and the panel's "Attach screenshot" trigger the same picker.

## Visual check
Render the panel with the two fixtures in the reference file, screenshot both in dark mode, and compare against `panel-v2-locked.png` and `panel-v2-ready.png`. Iterate until they match in order, spacing and hierarchy, then show me the screenshots.
