import type { ActivitySpec } from '@interactive-project/protocol/types';
import type { CancellationSignal, EngineSession } from '@interactive-project/protocol/interoperability';
import type { Registry, RendererManifest, RegistrationResult } from '@interactive-project/registry';

export type DomHostStatus = 'loading' | 'mounted' | 'unsupported' | 'validation-error' | 'runtime-error' | 'unmounted';
export type ActivityValidation = { valid: true; diagnostics?: readonly unknown[] } | { valid: false; diagnostics?: readonly unknown[] };

export interface DomHostOptions {
  registry: Pick<Registry, 'lookupEngine' | 'lookupRenderer'>;
  /** Supply cryptographically strong UUIDs. The host never reads browser globals to make IDs. */
  createId(): string;
  validateActivity?(activity: unknown): ActivityValidation;
  localePreferences?: string[];
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
