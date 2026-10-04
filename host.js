import { validateActivitySpec } from '@interactive-project/protocol/validation';
import { DOM_RENDERER_HOST, DOM_RENDERER_SERVICES } from './renderers.js';

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

function showState(mount, status, message) {
  clear(mount);
  mount.setAttribute?.('data-interactive-project-state', status);
  const node = mount.ownerDocument.createElement('p');
  node.setAttribute('role', status === 'loading' ? 'status' : 'alert');
  node.setAttribute('aria-live', status === 'loading' ? 'polite' : 'assertive');
  node.textContent = message;
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

/** Create a DOM adapter without reading document/window until mountActivity is called. */
export function createDomHost({ registry, createId, validateActivity = validateActivitySpec, localePreferences = ['en'] } = {}) {
  if (!registry || typeof registry.lookupEngine !== 'function' || typeof registry.lookupRenderer !== 'function') {
    throw new TypeError('A Registry with independent engine and renderer lookup is required.');
  }
  if (typeof createId !== 'function') throw new TypeError('createId must be supplied by the host.');
  if (typeof validateActivity !== 'function') throw new TypeError('validateActivity must be a function.');
  const locales = Object.freeze([...localePreferences]);

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
      setState('runtime-error', 'The activity could not be started.');
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
        setState('validation-error', 'This activity is invalid and cannot be displayed.');
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
        setState('runtime-error', 'The activity could not be started.');
        return;
      }
      if (!engineLookup?.found || !rendererLookup?.found) {
        setState('unsupported', !engineLookup?.found
          ? 'No engine is registered for this activity version.'
          : 'No DOM renderer is registered for this activity version.');
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
    showState(mount, status, 'Loading activity…');
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
