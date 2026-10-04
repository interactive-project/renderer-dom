# Interactive Project DOM host

`@interactive-project/renderer-dom` supplies a framework-independent DOM host for independently registered activity engines and DOM renderers. The package does not import or require a browser global at module load; hosts inject a mount element, UUID source, validators and optional services.

```js
import { createDomHost, registerDomRenderers } from '@interactive-project/renderer-dom';

const registrations = registerDomRenderers(registry);
const host = createDomHost({ registry, createId: secureUuid, validateActivity });
const activity = host.mountActivity({ activitySpec, mount: document.querySelector('#activity'), sessionId, attemptId });
await activity.ready;
// Later, when the view is removed:
await activity.unmount();
registrations.dispose();
```

Mounting shows a polite loading state first. Invalid activity data, absent engine/renderer registrations and runtime failures become distinct accessible states. Engine and DOM renderer lookups use separate Registry queries. The returned mount owns the EngineSession, state subscription, renderer, registered child mounts and their teardown. Unregistering a plugin never disposes an already-mounted activity.

The first built-in renderers cover single-/multiple-choice and true/false quiz questions, plus reveal/rate/acknowledge/next for flashcards. They use native controls, restore focus after actions, localize UI labels (English, Spanish and Arabic built in), support RTL question navigation and expose style-neutral `data-ip-part`/`data-ip-slot` hooks. Hosts may provide `localize`, `renderHooks`, `--ip-*` design tokens, a direction, a reduced-motion preference and `interactionMode: 'nonvisual'` for registered advanced-activity adapters; no styling framework is required. ContentNodes go through `@interactive-project/content-node/rendering`; the default DOM driver emits text nodes only. Other content uses the schema's accessible text fallback. Markdown is never inserted as HTML, and media requires a host-provided, allowlisted asset resolver. Unsupported question kinds and unregistered activity types remain explicit rather than executing authored content.

See [the host contract](docs/dom-host-v1.md) and [accessibility acceptance plan](docs/accessibility-acceptance.md) for lifecycle, cancellation, keyboard behavior and verification boundaries. Headless tests are not browser/assistive-technology certification; no npm publication or universal browser compatibility claim is implied.
