# Working on tipping-point

## Design

This app follows the shared design system in
[legofsalmon/design-system](https://github.com/legofsalmon/design-system),
checked out beside this repository as `../design-system`. Before changing
anything a person sees or touches, read its `docs/designing.md` and answer its
questions, then the pages it points to: `principles.md` (who uses these tools
and where, the colour grammar, type, space and the behaviour rules),
`behavioural.md` (how crew behave while getting a job done), `nngroup.md`
(the usability research and the ten heuristics every change is checked
against), `navigation.md`, `states.md`, `components.md` and `motion.md`.

- **Write the reasoning down.** A PR that changes what a person sees or
  touches has a short **Design** section: the one job of the view, the
  behaviour it designs for with the effect named (Default Effect, Loss
  Aversion, Time Scarcity…), any departure from the system and why, and
  any problem the heuristic check rated 3 that it leaves open. A bug fix
  that changes no design says so.
- **Use the system's parts first.** Its roles rather than literal colours,
  and a shared component's states, keys and wording before drawing a new one.
- **Send back what you learn.** A gap in the system, a departure that was
  right, something crew did that the rules did not predict, or a meaning of
  this app's that another app now needs: add it to the design system's
  `docs/learnings.md` in a PR there, or list it under **Learnings** in this
  PR's Design section so it can be carried across.
- **What stays this app's own:** storage and wire names, layout and flow,
  content, and meanings only this app has.

tipping-point takes the whole system: `src/ds/` holds tokens.css, base.css and
components.css as `npm run ds:sync` vendors them (`npm run ds:check`, the
system's own checker in `tools/ds-check.mjs`, runs in CI: a hand edit fails,
behind warns), the fields, buttons, checks, slider, notices and toaster are the
system's components, and the page is `data-theme="auto"
data-density="touch"`. Its own names in `src/styles.css` point at roles. Its
own meaning, `--force` for the applied force, is content: the arrows and
labels on the drawings and the overturning bar, never chrome. Fonts are
vendored in `fonts/` and inlined by the single-file build, which inlines
`src/ds/` too; a new file there goes in `sw.js` and the build.
