# Third-party notices

Fletch-authored source in this repository is distributed under the [MIT license](LICENSE). Preserve its copyright and permission notice in copies or substantial portions. The complete license text controls; see also the [Open Source Initiative's MIT entry](https://opensource.org/license/mit).

The following bundled material retains its own license:

| Material | License / attribution |
|---|---|
| Code-simplifier policy in `lib/agent/code-simplifier-policy.json` | Adapted from Anthropic's code-simplifier agent; Apache-2.0 text in `lib/agent/code-simplifier.LICENSE`. Source commit, URL, hash and adaptation details are retained in the JSON. |
| Instrument Sans font in `public/fonts/` | SIL Open Font License, retained in `public/fonts/OFL-InstrumentSans.txt` |
| Instrument Sans and IBM Plex Mono in `docker/webapp-template/foundation/fonts/` | SIL Open Font License; both OFL notices are retained alongside the fonts |
| MCP and gateway packages | MIT; package license files retained |

Dependencies, compiler tools, CLI tools, container base images and external APIs are not relicensed by the root MIT file. Their package manifests, lockfiles and upstream distributions carry their own licenses and conditions. Review these when redistributing an agent image or adding dependencies. Generated application dependencies likewise retain their licenses.

Names and logos identifying Fletch, Robinhood, model providers or other projects do not imply an affiliation or an endorsement. MIT licensing of the source does not grant trademark rights. Forks should configure their own domains, service accounts and product identity rather than presenting themselves as the hosted Fletch service.
