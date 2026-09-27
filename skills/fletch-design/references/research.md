# Design research, 10 September 2026

The runtime skill and directions are original Fletch instructions. No third-party
skill, logo, font, brand asset or code is shipped in generated apps by this change.
Only the selected direction enters the prompt; this research stays outside it.

- [taste-skill](https://github.com/leonxlnx/taste-skill), MIT, revision
  `ccbc15639c97057cbfcf32ecebc38ef716e4bb37`: infer the brief before selecting a
  direction and coordinate layout, density and motion. Its current default skill
  explicitly targets landing pages, portfolios and redesigns. Fletch needs
  transaction tools and game interfaces, so its design directions focus on those
  workflows. Its package preferences and default motion settings are not copied.
- [awesome-design-md](https://github.com/voltagent/awesome-design-md), MIT,
  revision `8147538b4226ae41e2487a9179e3bcc1f68e8554`: named tokens and component
  descriptions make a visual language reproducible. The Stripe and Ollama
  analyses show different density and typography. Brand palettes, proprietary
  fonts and page compositions are not imported into the Fletch catalog.
- [stop-slop-refined](https://github.com/odinfree/stop-slop-refined), MIT,
  revision `cdddcf5a5a43c5f3dab467685cf7e21d1da528de`: preserve source boundaries,
  name the mechanism and review the initial shape before polishing sentences.
  Applied here to actual app workflows, data provenance and concise status copy.
- [Anthropic frontend-design](https://github.com/anthropics/skills/blob/main/skills/frontend-design/SKILL.md),
  read 10 September 2026: start with the audience and a chosen composition, give
  typography a clear hierarchy, and review the implemented interface. It recommends
  screenshots when the environment supports them; this image has no browser stage.
  The Fletch skill separates source review from rendered inspection.
- [WCAG text contrast](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html)
  and [reflow](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html): normal text
  needs 4.5:1 contrast, and layouts must accommodate narrow viewports. The selected
  palettes have tests for text and filled controls on their declared surfaces.
  These tests cover the suggested colors, not every generated app's final CSS.

Selection separates workflow from visual treatment. The prompt and text attachment
contents choose an allowlisted workflow hint. A stable hash of the project slug
selects one of three treatments in its purpose group. Names, such as a file named
raffle.md, do not choose the workflow. The complete brief remains authoritative
when it disagrees with the hint.

The selected ID and optional workflow ID are stored in `.fletch-design.json`.
Initial retries keep that choice; legacy version-1 records remain readable.
Follow-ups preserve the actual source and DESIGN.md before considering any saved
preset. DESIGN.md records the agent's choices and remains ordinary project source.
Only the selected treatment enters the prompt. The catalog, research and external
skills stay outside the model context.

Local tests establish selection, persistence, bounded context and contrast of
the proposed text, muted text, semantic text and accent controls. Model output
still needs rendered inspection and interaction tests. See the
[runtime audit](../../../docs/research/BUILDER-DESIGN-AUDIT-2026-09-10.md) for the
production source trace, gaps found and the scope of the correction.
