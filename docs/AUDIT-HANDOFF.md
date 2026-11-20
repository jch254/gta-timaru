# Gameplay audit handoff — 21 November 2026

**Both audit PRs are live. Next: test the shipped game in Safari on a physical iPhone.**

## What shipped

| Change | Evidence |
| --- | --- |
| [#18](https://github.com/jch254/the-03/pull/18) — complete saves and validated Continue; bounded catch-up and streaming; phone texture tiers; vehicle recovery; pause/input fixes; publisher permissions; shadow cleanup and a browser release gate | Merged as `cb65da1`. [Chrome and Firefox passed on main](https://github.com/jch254/the-03/actions/runs/44752480848). |
| [#19](https://github.com/jch254/the-03/pull/19) — mouse capture no longer fires; police use actual crash contacts; AI uses the tyres’ steering limit; junction lookup respects each location hint | Merged as `d6e738a`. 1,565 local tests passed, and [Chrome and Firefox passed on main](https://github.com/jch254/the-03/actions/runs/44757358076). |

At handoff, [the live version manifest](https://03.quest/version.json) reported `c4e66a4f7fe320267fef24b70a09513a4220ea65`. Both merge commits are ancestors of that revision. Its [production browser gate](https://github.com/jch254/the-03/actions/runs/44805353408) passed, and CodeBuild `timmaz-hard:dd956c6e-1fe7-4c88-9a16-1e08fb69a93d` succeeded for the same SHA. Earlier builds had stopped at the `SITE_BUCKET` / `DISTRIBUTION_ID` guard; **no retry of those builds is needed**. For a future publisher failure, see the [infrastructure runbook](../infrastructure/README.md).

## Open: physical iPhone Safari smoke test

The paired iPhone required a passcode, so none of the checks below were run on hardware. Desktop Chrome/Firefox and Chrome phone emulation do not cover iOS Safari. Use a fresh Safari profile or a separate test origin so a test save cannot replace real progress. Keep the same profile and origin through Continue.

- [ ] **Cold start:** With the game uncached, start a new game on the default phone quality. Record start tap → first controllable frame, then walk and drive. Watch for a reload, blank canvas or unresponsive controls.
- [ ] **Rotate with a dialog:** Open a shop or job choice in landscape, rotate to portrait, rotate back, dismiss the choice and walk. Movement should resume. Repeat from the explicit pause menu: it should stay paused until Resume.
- [ ] **Save → Continue:** Note cash and a recognisable location away from the starting point. Save, reload the page and choose Continue. Check cash and location, then move to confirm the simulation is running. Restoring on foot is expected.

Record device model, iOS version, tested build SHA (from the manifest), network/cache conditions, and pass/fail for each check. If one fails, capture the shortest reproduction before changing code.
