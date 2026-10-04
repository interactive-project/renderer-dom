import { createDomHost, DOM_RENDERER_HOST, registerDomRenderers } from '../index.js';
import type { ActivitySpec } from '@interactive-project/protocol/types';
import type { Registry } from '@interactive-project/registry';

declare const registry: Registry;
declare const activity: ActivitySpec;
declare const mount: unknown;

const host = createDomHost({ registry, createId: () => '00000000-0000-4000-8000-000000000001' });
const accessibleHost = createDomHost({
  registry,
  createId: () => '00000000-0000-4000-8000-000000000002',
  localePreferences: ['ar'],
  motionPreference: 'reduce',
  interactionMode: 'nonvisual',
  designTokens: { '--ip-accent': 'rebeccapurple' },
  renderHooks: { onElement(element, info) { void element; void info.part; void info.direction; } },
  localize(messageKey, locale) { return `${messageKey}:${locale}`; }
});
void accessibleHost;
const rendererHandles = registerDomRenderers(registry);
const handle = host.mountActivity({ activity, mount, sessionId: 'session-id' });
void handle.ready;
void handle.update();
void handle.unmount();
void rendererHandles.dispose();
const hostKind: 'dom' = DOM_RENDERER_HOST;
void hostKind;

// @ts-expect-error Session identity is required for engine creation.
host.mountActivity({ activity, mount });
