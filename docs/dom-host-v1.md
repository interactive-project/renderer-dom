# Vanilla DOM host contract v1

## Registration and mount ownership

`registerDomRenderers(registry)` registers independent `host: "dom"` manifests for Quiz and Flashcards at Protocol/domain schema v1.0.0. It returns unregister handles; it does not register or load engines. `createDomHost` requires a Registry, an injected UUID source and optionally a synchronous validator. `mountActivity` first validates, then independently calls `lookupEngine` and `lookupRenderer` with exact activity type, Protocol version, domain schema version and DOM host. Engine creation receives the host-owned session/attempt identity, cancellation signal and services. Renderer creation receives the same session and injected mount.

The host owns the EngineSession and disposes it after its renderer. Renderer ports own only view resources. A DOM renderer can transfer child mount ownership with `context.services[DOM_RENDERER_SERVICES].ownChild(handle)`; the parent unmounts children in reverse registration order before disposing its engine. A returned release function relinquishes an individual child handle. Unregistering either plugin affects future lookups only.

`update()` queues view updates, and engines with `subscribe` are observed automatically. `unmount()` is idempotent, aborts pending host work, detaches the state subscription, waits for renderer/content-driver cleanup, unmounts owned children, then disposes the session. ContentNode driver disposal waits for active renders; asset resolvers receive the driver's cancellation signal. A host resolver must honor cancellation, redirect allowlists, MIME and size limits. This package does not fetch media itself.

## States and semantics

The mount element receives `data-interactive-project-state` with `loading`, `mounted`, `unsupported`, `validation-error`, `runtime-error` or `unmounted`. Loading uses `role=status` and polite announcements; failures use `role=alert`. Error text is intentionally generic and never includes exception messages or stack traces. The host's validator should include both Protocol ActivitySpec and domain-schema validation; engine factory rejections are runtime failures because the host cannot safely infer their meaning.

Quiz answer, navigation, submission and completion controls dispatch Protocol v1 semantic actions. Flashcard reveal, rating, acknowledge and next controls do the same; study start/resume/complete use the RuntimeSession lifecycle ports. UI state, listeners, renderer values, credentials and driver instances never enter activity data or snapshots. The initial renderer supports choice, multiple choice and true/false questions; unsupported quiz kinds have a visible fallback. Flashcard faces are rendered through ContentNode drivers, with alternatives retained when no driver handles a kind.

The default text driver creates text nodes, not markup. Markdown HTML parsing, remote media, vendor component trees, styling, child-activity composition and non-DOM framework adapters are opt-in host work. This package has no React, Vue, Svelte, CSS framework, `window` or top-level `document` dependency. Creating the package or engine sessions remains possible in headless Node; only mounting invokes the injected document methods.

## Compatibility and verification

This package adds no Protocol payload, ActivitySpec schema, engine state, snapshot or event fields. It consumes Protocol 1.0.0, Registry renderer contract 1.0.0 and ContentNode v1. A schema-version mismatch resolves as unsupported; no migration is attempted. `fixtures/host-conformance.v1.json` records the golden semantic traces. `npm test` drives the real Quiz and Flashcards engines through this host, verifies isolated mounts, accessible states, text-driver fallbacks, abort/disposal and a parent-owned child mount. These tests are headless DOM-contract evidence, not certification against every browser or assistive technology.
