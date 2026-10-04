import { validateActivitySpec } from '@interactive-project/protocol/validation';
import { DOM_RENDERER_HOST, DOM_RENDERER_SERVICES } from './renderers.js';
import { directionForLocale, message, preferredLocale } from './messages.js';

const DOM_SERVICES = 'interactive-project.renderer-dom';

function cancellationSource() {
  let aborted = false;
  const listeners = new Map();
  const signal = Object.freeze({
    get aborted() { return aborted; },
    addEventListener(type, listener, options = {}) {
      if (type !== 'abort' || typeof listener !== 'function') return;
      if (aborted) {
        listener();
        return;
      }
      const wrapped = options.once ? () => {
        listeners.delete(listener);
        listener();
      } : listener;
      listeners.set(listener, wrapped);
    },
    removeEventListener(type, listener) {
      if (type === 'abort') listeners.delete(listener);
    }
  });
  return {
    signal,
    abort() {
      if (aborted) return;
      aborted = true;
      for (const listener of [...listeners.values()]) {
        try { listener(); } catch { /* Abort listeners cannot prevent cleanup. */ }
      }
      listeners.clear();
    }
  };
}

function resolveMount(value) {
  if (!value || typeof value !== 'object') throw new TypeError('mount must be a DOM container.');
  const document = value.ownerDocument;
  if (!document || typeof document.createElement !== 'function' || typeof document.createTextNode !== 'function'
      || typeof value.appendChild !== 'function' || typeof value.removeChild !== 'function') {
    throw new TypeError('mount must belong to a document and support child nodes.');
  }
  return value;
}

function clear(mount) {
  while (mount.firstChild) mount.removeChild(mount.firstChild);
}

function showState(mount, status, text) {
  clear(mount);
  mount.setAttribute?.('data-interactive-project-state', status);
  const node = mount.ownerDocument.createElement('p');
  node.setAttribute('data-ip-part', 'host-status');
  node.setAttribute('role', status === 'loading' ? 'status' : 'alert');
  node.setAttribute('aria-live', status === 'loading' ? 'polite' : 'assertive');
  node.textContent = text;
  mount.appendChild(node);
}

function validationResult(validate, activity) {
  try {
    const result = validate(activity);
    return result && result.valid === true ? { valid: true } : { valid: false };
  } catch {
    return { valid: false };
  }
}

function safeDispose(resource) {
  try { return Promise.resolve(resource?.dispose?.()).catch(() => {}); }
  catch { return Promise.resolve(); }
}

function actionSequence(session) {
  let state = {};
  let context = {};
  try { state = session?.getState?.() ?? {}; } catch { /* Best effort for extension engines. */ }
  try { context = session?.getContext?.() ?? {}; } catch { /* Best effort for extension engines. */ }
  for (const candidate of [context.revision, state.actionSequence, state.revision]) {
    if (Number.isSafeInteger(candidate) && candidate >= 0) return candidate;
  }
  return 0;
}

/** Create a DOM adapter without reading document/window until mountActivity is called. */
export function createDomHost({
  registry,
  createId,
  validateActivity = validateActivitySpec,
  localePreferences = ['en'],
  direction,
  motionPreference = 'no-preference',
  interactionMode = 'standard',
  localize,
  designTokens = {},
  renderHooks
} = {}) {
  if (!registry || typeof registry.lookupEngine !== 'function' || typeof registry.lookupRenderer !== 'function') {
    throw new TypeError('A Registry with independent engine and renderer lookup is required.');
  }
  if (typeof createId !== 'function') throw new TypeError('createId must be supplied by the host.');
  if (typeof validateActivity !== 'function') throw new TypeError('validateActivity must be a function.');
  if (!Array.isArray(localePreferences) || localePreferences.some(locale => typeof locale !== 'string' || !locale)) {
    throw new TypeError('localePreferences must be an array of non-empty locale tags.');
  }
  if (direction !== undefined && !['ltr', 'rtl', 'auto'].includes(direction)) throw new TypeError('direction must be ltr, rtl or auto.');
  if (!['reduce', 'no-preference'].includes(motionPreference)) throw new TypeError('motionPreference must be reduce or no-preference.');
  if (!['standard', 'nonvisual'].includes(interactionMode)) throw new TypeError('interactionMode must be standard or nonvisual.');
  if (localize !== undefined && typeof localize !== 'function') throw new TypeError('localize must be a function.');
  if (!designTokens || typeof designTokens !== 'object' || Array.isArray(designTokens)) throw new TypeError('designTokens must be a record.');
  for (const [name, value] of Object.entries(designTokens)) {
    if (!/^--ip-[a-z][a-z0-9-]{0,63}$/.test(name) || typeof value !== 'string' || value.length > 256) {
      throw new TypeError('designTokens may only contain short --ip-* custom properties with string values.');
    }
  }
  const tokens = Object.freeze({ ...designTokens });
  if (renderHooks !== undefined && (!renderHooks || typeof renderHooks !== 'object' || Array.isArray(renderHooks)
      || (renderHooks.onElement !== undefined && typeof renderHooks.onElement !== 'function'))) {
    throw new TypeError('renderHooks.onElement must be a function when supplied.');
  }
  const locales = Object.freeze([...localePreferences]);
  const locale = preferredLocale(locales);
  const resolvedDirection = direction ?? directionForLocale(locale);
  const keyboardDirection = resolvedDirection === 'auto' ? directionForLocale(locale) : resolvedDirection;

  function notifyElement(element, part, activity) {
    try {
      renderHooks?.onElement?.(element, Object.freeze({
        part,
        activityType: activity?.type ?? '',
        activityId: activity?.id ?? '',
        locale,
        direction: resolvedDirection,
        motionPreference,
        interactionMode
      }));
    } catch { /* A styling hook cannot interrupt rendering or actions. */ }
  }

  function mountActivity({ activity, mount: rawMount, sessionId, attemptId, signal, services = {} } = {}) {
    const mount = resolveMount(rawMount);
    if (!sessionId || typeof sessionId !== 'string') throw new TypeError('sessionId is required.');
    if (services === null || typeof services !== 'object' || Array.isArray(services)) throw new TypeError('services must be a record.');
    let status = 'loading';
    let session = null;
    let renderer = null;
    let rendererDisposal = null;
    let unsubscribe = null;
    const childHandles = new Set();
    let closed = false;
    let cleanupPromise;
    let updateQueue = Promise.resolve();
    const lifetime = cancellationSource();
    const say = (key, values) => message(key, locales, localize, values);
    mount.setAttribute?.('data-interactive-project-renderer', DOM_RENDERER_HOST);
    mount.setAttribute?.('data-interactive-project-activity', activity?.type ?? 'unknown');
    mount.setAttribute?.('lang', locale);
    mount.setAttribute?.('dir', resolvedDirection);
    mount.setAttribute?.('data-motion-preference', motionPreference);
    mount.setAttribute?.('data-interaction-mode', interactionMode);
    for (const [name, value] of Object.entries(tokens)) {
      try { mount.style?.setProperty?.(name, value); } catch { /* A host may supply a minimal DOM without CSSStyleDeclaration. */ }
    }
    notifyElement(mount, 'activity-root', activity);
    const removeExternalAbort = () => {
      try { signal?.removeEventListener?.('abort', externalAbort); } catch { /* Best-effort listener cleanup. */ }
    };

    function setState(next, message) {
      if (closed && next !== 'unmounted') return;
      status = next;
      if (message) showState(mount, next, message);
      else mount.setAttribute?.('data-interactive-project-state', next);
    }

    function cleanup() {
      if (cleanupPromise) return cleanupPromise;
      removeExternalAbort();
      try { unsubscribe?.(); } catch { /* Session teardown still owns the rest. */ }
      unsubscribe = null;
      cleanupPromise = (async () => {
        for (const child of [...childHandles].reverse()) {
          childHandles.delete(child);
          try { await child.unmount(); } catch { /* A child failure cannot retain the parent session. */ }
        }
        const ownedSession = session;
        session = null;
        await disposeRenderer();
        await safeDispose(ownedSession);
      })();
      return cleanupPromise;
    }

    function disposeRenderer() {
      if (rendererDisposal) return rendererDisposal;
      const ownedRenderer = renderer;
      if (!ownedRenderer) return Promise.resolve();
      renderer = null;
      rendererDisposal = safeDispose(ownedRenderer);
      return rendererDisposal;
    }

    async function failRuntime() {
      if (closed) return;
      setState('runtime-error', say('host.runtime-error'));
      closed = true;
      lifetime.abort();
      await cleanup();
    }

    function performUpdate() {
      updateQueue = updateQueue.then(async () => {
        if (closed || !renderer) return;
        await renderer.update();
        if (!closed && status !== 'runtime-error') setState('mounted');
      }).catch(() => failRuntime());
      return updateQueue;
    }

    async function initialize() {
      const checked = validationResult(validateActivity, activity);
      if (!checked.valid) {
        setState('validation-error', say('host.validation-error'));
        return;
      }
      if (lifetime.signal.aborted) return;

      let engineLookup;
      let rendererLookup;
      try {
        const request = {
          type: activity.type,
          protocolVersion: activity.protocolVersion,
          activitySchemaVersion: activity.activitySchemaVersion
        };
        engineLookup = registry.lookupEngine(request);
        rendererLookup = registry.lookupRenderer({ ...request, host: DOM_RENDERER_HOST });
      } catch {
        setState('runtime-error', say('host.runtime-error'));
        return;
      }
      if (!engineLookup?.found || !rendererLookup?.found) {
        setState('unsupported', !engineLookup?.found
          ? say('host.unsupported-engine')
          : say('host.unsupported-renderer'));
        return;
      }

      try {
        session = await engineLookup.registration.createEngine(activity, {
          sessionId,
          ...(attemptId !== undefined ? { attemptId } : {}),
          signal: lifetime.signal,
          services: Object.freeze({ ...services })
        });
        if (lifetime.signal.aborted || closed) {
          await cleanup();
          return;
        }
        if (!session || typeof session.dispatch !== 'function' || typeof session.dispose !== 'function') {
          throw new TypeError('The registered engine did not return an EngineSession.');
        }
        const rendererServices = Object.freeze({
          ...services,
          sessionId,
          ...(attemptId !== undefined ? { attemptId } : {}),
          [DOM_SERVICES]: Object.freeze({
            activity,
            createId,
            localePreferences: locales,
            locale,
            direction: resolvedDirection,
            keyboardDirection,
            motionPreference,
            interactionMode,
            localize,
            renderHooks,
            async dispatchAction(kind, payload = {}) {
              if (closed || lifetime.signal.aborted || !session) return { status: 'rejected' };
              if (typeof kind !== 'string' || !kind || payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
                throw new TypeError('A semantic action requires a kind and record payload.');
              }
              let identity = {};
              try { identity = session.getContext?.() ?? {}; } catch { /* Use the host-owned mount identity. */ }
              const action = {
                protocolVersion: '1.0.0',
                actionVersion: '1.0.0',
                id: createId(),
                activityId: activity.id,
                sessionId: identity.sessionId ?? sessionId,
                ...(identity.attemptId !== undefined ? { attemptId: identity.attemptId }
                  : attemptId !== undefined ? { attemptId } : {}),
                sequence: actionSequence(session),
                type: `${activity.type}.${kind}`,
                payload
              };
              try { return await session.dispatch(action, { signal: lifetime.signal }); }
              catch { return { status: 'rejected' }; }
            },
            ownChild(child) {
              if (!child || typeof child.unmount !== 'function') throw new TypeError('A child activity handle must expose unmount().');
              if (closed) {
                void Promise.resolve(child.unmount()).catch(() => {});
                return () => {};
              }
              childHandles.add(child);
              let owned = true;
              return () => { if (owned) { owned = false; childHandles.delete(child); } };
            }
          })
        });
        renderer = await rendererLookup.registration.createRenderer({ session, mount, services: rendererServices });
        if (lifetime.signal.aborted || closed) {
          await cleanup();
          return;
        }
        if (!renderer || typeof renderer.update !== 'function' || typeof renderer.dispose !== 'function') {
          throw new TypeError('The registered DOM renderer returned an invalid lifecycle.');
        }
        if (typeof session.subscribe === 'function') {
          unsubscribe = session.subscribe(() => { void performUpdate(); });
          if (typeof unsubscribe !== 'function') throw new TypeError('The engine returned an invalid unsubscribe handle.');
        }
        await performUpdate();
      } catch {
        await failRuntime();
      }
    }

    let controller;
    function externalAbort() { void controller.unmount(); }
    if (signal?.aborted) lifetime.abort();
    else {
      try { signal?.addEventListener?.('abort', externalAbort, { once: true }); } catch { /* A malformed signal is ignored. */ }
    }
    showState(mount, status, say('host.loading'));
    let readyPromise = Promise.resolve();
    controller = {
      get status() { return status; },
      get session() { return session; },
      get ready() { return readyPromise; },
      update() { return performUpdate(); },
      async unmount() {
        if (closed && status === 'unmounted') return cleanup();
        closed = true;
        status = 'unmounted';
        lifetime.abort();
        removeExternalAbort();
        clear(mount);
        mount.setAttribute?.('data-interactive-project-state', 'unmounted');
        await disposeRenderer();
        await readyPromise.catch(() => {});
        await updateQueue.catch(() => {});
        await cleanup();
      }
    };
    if (signal?.aborted) void controller.unmount();
    readyPromise = initialize();
    return controller;
  }

  return Object.freeze({ mountActivity });
}
