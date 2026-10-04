import type { ActivitySpec } from '@interactive-project/protocol/types';
import type { CancellationSignal, EngineSession } from '@interactive-project/protocol/interoperability';
import type { Registry, RendererManifest, RegistrationResult } from '@interactive-project/registry';

export type DomHostStatus = 'loading' | 'mounted' | 'unsupported' | 'validation-error' | 'runtime-error' | 'unmounted';
export type ActivityValidation = { valid: true; diagnostics?: readonly unknown[] } | { valid: false; diagnostics?: readonly unknown[] };

export interface DomRenderHookInfo {
  readonly part: string;
  readonly activityType: string;
  readonly activityId: string;
  readonly locale: string;
  readonly direction: 'ltr' | 'rtl' | 'auto';
  readonly motionPreference: 'reduce' | 'no-preference';
  readonly interactionMode: 'standard' | 'nonvisual';
}

export interface DomRenderHooks {
  /** Called for renderer-created elements and the activity root. Hooks may decorate, but must not replace, the supplied node. */
  onElement?(element: unknown, info: DomRenderHookInfo): void;
}

export interface DomHostOptions {
  registry: Pick<Registry, 'lookupEngine' | 'lookupRenderer'>;
  /** Supply cryptographically strong UUIDs. The host never reads browser globals to make IDs. */
  createId(): string;
  validateActivity?(activity: unknown): ActivityValidation;
  localePreferences?: readonly string[];
  /** Overrides locale-derived text direction. Defaults to RTL for common RTL language tags and LTR otherwise. */
  direction?: 'ltr' | 'rtl' | 'auto';
  /** Reflected as a data attribute. The built-in renderers use no animation or transition. */
  motionPreference?: 'reduce' | 'no-preference';
  /** Requests a text-first interaction path from registered advanced-activity renderers. Built-ins are already text-first. */
  interactionMode?: 'standard' | 'nonvisual';
  /** Optional translation lookup. UI keys use `renderer-dom.*`; ContentNode fallback keys use `content.*`. Return empty to use the fallback. */
  localize?(messageKey: string, locale: string): string;
  /** Optional, bounded `--ip-*` custom properties applied to the mount element. */
  designTokens?: Readonly<Record<`--ip-${string}`, string>>;
  /** Framework-neutral element decoration hook. Semantic parts and slots are also exposed as data attributes. */
  renderHooks?: DomRenderHooks;
}

export interface MountActivityOptions {
  activity: ActivitySpec;
  mount: unknown;
  sessionId: string;
  attemptId?: string;
  signal?: CancellationSignal;
  services?: Record<string, unknown>;
}

export interface DomActivityHandle {
  readonly status: DomHostStatus;
  readonly session: EngineSession | null;
  readonly ready: Promise<void>;
  update(): Promise<void>;
  unmount(): Promise<void>;
}

export interface DomRendererServices {
  activity: ActivitySpec;
  createId(): string;
  localePreferences: readonly string[];
  locale: string;
  direction: 'ltr' | 'rtl' | 'auto';
  keyboardDirection: 'ltr' | 'rtl';
  motionPreference: 'reduce' | 'no-preference';
  interactionMode: 'standard' | 'nonvisual';
  localize?: (messageKey: string, locale: string) => string;
  renderHooks?: DomRenderHooks;
  /** Dispatch a domain-specific semantic action using host-owned identity, sequence and cancellation. */
  dispatchAction(kind: string, payload?: Record<string, unknown>): Promise<unknown>;
  /** Transfer a child mount's cleanup to the parent renderer/session. */
  ownChild(child: Pick<DomActivityHandle, 'unmount'>): () => void;
}

export interface DomHost {
  mountActivity(options: MountActivityOptions): DomActivityHandle;
}

export declare function createDomHost(options: DomHostOptions): DomHost;

export declare const DOM_RENDERER_HOST: 'dom';
/** Reserved RendererContext.services key. DOM adapters may use ownChild(handle) to transfer child lifecycle ownership to the parent mount. */
export declare const DOM_RENDERER_SERVICES: 'interactive-project.renderer-dom';
export declare const domRendererManifests: readonly [RendererManifest, RendererManifest];
export declare function registerDomRenderers(registry: Pick<Registry, 'registerRenderer'>): Readonly<{
  registrations: readonly RegistrationResult<unknown>[];
  dispose(): void;
}>;
