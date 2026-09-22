# Operation Clearway UI — Phase 2

## Game-feel interaction layer
- Added animated event/stage transitions when the workspace changes.
- Added persistent restoration progress HUD showing Event 1–5 progress.
- Added selection feedback for feature/model/class/tool cards.
- Added selected-state check badges and glow treatment.
- Added click ripples and keyboard-visible focus rings.
- Added subtle ambient grid/energy background to the game workspace.
- Added hover emphasis for ML help text so descriptions become easier to inspect.
- Added pulsing treatment to ready-to-continue primary actions.
- Added reduced-motion support.
- Added theme support files so the Phase 2 package works with both light and dark modes.

No API endpoints, scoring rules, data-processing logic, or game decisions were changed.

## Latest UI bugfix pass
- Fixed light-theme readability by restoring high-contrast text instead of forcing dark-theme white copy in light mode.
- Removed semantic green/red coloring from the correlation matrix and its strongest-pair values; correlations are now presented neutrally through numeric values.
- Enlarged the expanded evidence viewer substantially, including larger headings, tables, matrix cells, and relationship evidence.
- Changed the Feature Hunt analysis controls to a flex layout so the Run button remains visible beside the channel selectors and wraps cleanly on narrower screens.
