# WebTools Phase 6C Capability Backlog

**Status:** Phase 6C architecture is frozen as design only; Phase 6D implementation is NOT STARTED.

Phase 6B implemented and verified the external author workflow around the existing declarative Manifest v1 / Plugin API major 1 contract. The generated basic starter, SDK 1.1.0, inspect command, and external `.tgz` workflow did not identify a concrete missing Host capability that requires expansion.

## Phase 6B finding

The Phase 6B external author workflow did not identify a concrete missing Host capability for the existing declarative contract. That conclusion remains valid for Phase 6B and is not an implementation authorization.

## Phase 6C design-only capability decisions

| Capability or technology | Design status | Boundary |
|---|---|---|
| clipboard.read | Included in the approved design for a one-shot Native Clipboard Context flow | Plugin-wide grant; explicit Native capture gesture; no ambient renderer API; actual Native/Manager peer authentication is mandatory before sensitive transport |
| network.domains | Included as a future, exact-scope capability | Unavailable until connection-level enforcement, DNS/IP pinning and bypass resistance pass; network.mode none Web Plugins are independent |
| package-local WebAssembly | Supported in the sandboxed browser runtime | Browser-side computation with no Host capability; closed package inventory, MIME, CSP, origin and size bounds |

WASM does not justify Host APIs for OCR, PDF, image/media processing, compression, QR, Markdown, JSON, parsing or other business algorithms. Those remain in the Plugin unless a separate future use case demonstrates a need for Host authority.

No Phase 6D implementation is authorized by this backlog. Refer to [the Phase 6C architecture freeze](phase6c-architecture-freeze.md) for the full decision record, implementation order and mandatory gates.

Any future capability proposal must have a separate product/security design, threat model, closed Manifest/API contract, Host-side validation and consent behavior, negative tests, compatibility policy, and independent user approval before implementation. This backlog does not authorize Phase 6C work.
