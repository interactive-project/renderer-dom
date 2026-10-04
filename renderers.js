import { createRendererRegistry } from '@interactive-project/content-node/rendering';
import { validateContent } from '@interactive-project/content-node/validation';
import { selectLocalizedText } from '@interactive-project/protocol/content';
import { message, preferredLocale } from './messages.js';

export const DOM_RENDERER_HOST = 'dom';
export const DOM_RENDERER_SERVICES = 'interactive-project.renderer-dom';
const QUIZ_TYPE = 'interactive-project/quiz';
const FLASHCARDS_TYPE = 'interactive-project/flashcards';

const quizManifest = Object.freeze({
  manifestVersion: '1.0.0',
  id: 'interactive-project/dom-renderer-quiz',
  pluginVersion: '0.1.0',
  type: QUIZ_TYPE,
  protocolVersions: Object.freeze(['1.0.0']),
  host: DOM_RENDERER_HOST,
  activitySchemaVersions: Object.freeze(['1.0.0']),
  rendererContractVersion: '1.0.0'
});
const flashcardsManifest = Object.freeze({
  manifestVersion: '1.0.0',
  id: 'interactive-project/dom-renderer-flashcards',
  pluginVersion: '0.1.0',
  type: FLASHCARDS_TYPE,
  protocolVersions: Object.freeze(['1.0.0']),
  host: DOM_RENDERER_HOST,
  activitySchemaVersions: Object.freeze(['1.0.0']),
  rendererContractVersion: '1.0.0'
});

export const domRendererManifests = Object.freeze([quizManifest, flashcardsManifest]);

function clearChildren(root) {
  while (root.firstChild) root.removeChild(root.firstChild);
}

function createElement(document, tag, text, attributes = {}, onElement) {
  const element = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) {
    if (value !== undefined && value !== null) element.setAttribute(name, String(value));
  }
  if (text !== undefined) element.textContent = text;
  try { onElement?.(element, attributes['data-ip-part'] ?? tag); } catch { /* Hooks are optional decoration only. */ }
  return element;
}

function localized(value, locales) {
  if (typeof value === 'string') return value;
  if (value && value.kind === 'localized-text') {
    try { return selectLocalizedText(value, locales).text; } catch { return ''; }
  }
  return '';
}

function sessionState(session) {
  try { return session.getState?.() ?? {}; } catch { return {}; }
}

function sessionContext(session) {
  try { return session.getContext?.() ?? {}; } catch { return {}; }
}

function actionRevision(session, state, context) {
  for (const candidate of [context.revision, state.actionSequence, state.revision]) {
    if (Number.isSafeInteger(candidate) && candidate >= 0) return candidate;
  }
  return 0;
}

function contentTextDriver(document) {
  return Object.freeze({
    id: 'interactive-project/dom-text-v1',
    priority: -1000,
    capabilities: { kinds: ['text'] },
    render(request) {
      return { value: document.createTextNode(request.accessibleText) };
    }
  });
}

function cancellationSource() {
  let aborted = false;
  const listeners = new Map();
  return {
    signal: Object.freeze({
      get aborted() { return aborted; },
      addEventListener(type, listener, options = {}) {
        if (type !== 'abort' || typeof listener !== 'function') return;
        if (aborted) { listener(); return; }
        const wrapped = options.once ? () => { listeners.delete(listener); listener(); } : listener;
        listeners.set(listener, wrapped);
      },
      removeEventListener(type, listener) { if (type === 'abort') listeners.delete(listener); }
    }),
    abort() {
      if (aborted) return;
      aborted = true;
      for (const listener of [...listeners.values()]) {
        try { listener(); } catch { /* A renderer cannot block teardown. */ }
      }
      listeners.clear();
    }
  };
}

function createRendererLifecycle(context, renderView) {
  const mount = context.mount;
  const document = mount?.ownerDocument;
  const host = context.services?.[DOM_RENDERER_SERVICES];
  if (!mount || !document || typeof document.createElement !== 'function' || typeof document.createTextNode !== 'function' || !host?.activity) {
    throw new TypeError('A DOM mount and host activity context are required.');
  }
  const activity = host.activity;
  const integration = context.services?.content ?? {};
  const locales = integration.localePreferences ?? host.localePreferences;
  const locale = host.locale ?? preferredLocale(locales);
  const say = (key, values) => message(key, locales, host.localize, values);
  const notifyElement = (element, part) => {
    try {
      host.renderHooks?.onElement?.(element, Object.freeze({
        part,
        activityType: activity.type,
        activityId: activity.id,
        locale,
        direction: host.direction,
        motionPreference: host.motionPreference,
        interactionMode: host.interactionMode
      }));
    } catch { /* A styling hook cannot interrupt rendering or actions. */ }
  };
  const element = (tag, text, attributes = {}) => createElement(document, tag, text, attributes, notifyElement);
  const abortSource = cancellationSource();
  const listeners = new Set();
  const activeActions = new Set();
  const customDrivers = Array.isArray(integration.drivers) ? integration.drivers : [];
  const contentRenderers = createRendererRegistry({
    drivers: [...(host.interactionMode === 'nonvisual' ? [] : customDrivers), contentTextDriver(document)],
    localePreferences: locales,
    localize: integration.localize ?? host.localize,
    policy: integration.policy,
    resolveAsset: integration.resolveAsset
  });
  let disposed = false;
  let firstRender = true;
  let renderQueue = Promise.resolve();
  let actionMessage = '';
  let focusKeys = [];

  function clearView() {
    for (const remove of [...listeners]) {
      try { remove(); } catch { /* Continue removing the other listeners. */ }
    }
    listeners.clear();
    clearChildren(mount);
  }

  function listen(target, type, listener) {
    if (disposed) return;
    target.addEventListener(type, listener);
    listeners.add(() => target.removeEventListener(type, listener));
  }

  function button(parent, label, onClick, attributes = {}) {
    const control = element('button', label, { type: 'button', 'data-ip-part': 'control', ...attributes });
    listen(control, 'click', onClick);
    if (!disposed) parent.appendChild(control);
    return control;
  }

  function note(parent, text, role = 'status', attributes = {}) {
    if (!disposed) parent.appendChild(element('p', text, {
      role,
      'aria-live': role === 'alert' ? 'assertive' : 'polite',
      'data-ip-part': 'announcement',
      ...attributes
    }));
  }

  async function renderContent(parent, node) {
    if (disposed) return;
    const valid = validateContent(node);
    if (!valid.valid) {
      note(parent, say('content.invalid'), 'alert', { 'data-ip-part': 'content-error' });
      return;
    }
    try {
      const result = await contentRenderers.render(node, { localePreferences: locales, signal: abortSource.signal });
      if (disposed || abortSource.signal.aborted) return;
      const value = result.renderedValue;
      if (result.status === 'rendered' && value && typeof value.nodeType === 'number' && typeof mount.appendChild === 'function') {
        if (value.nodeType === 1) notifyElement(value, 'content');
        parent.appendChild(value);
        return;
      }
      const fallback = element('span', result.accessibleText, { dir: result.direction, 'data-ip-part': 'content-fallback' });
      parent.appendChild(fallback);
      if (result.message?.text) note(parent, result.message.text, 'status', { 'data-ip-part': 'content-announcement' });
    } catch {
      if (!disposed) note(parent, say('content.unavailable'), 'status', { 'data-ip-part': 'content-error' });
    }
  }

  async function dispatch(kind, payload = {}) {
    if (disposed) return { status: 'rejected' };
    const state = sessionState(context.session);
    const identity = sessionContext(context.session);
    const hostContext = identity.sessionId ? identity : {};
    const action = {
      protocolVersion: '1.0.0',
      actionVersion: '1.0.0',
      id: host.createId(),
      activityId: activity.id,
      sessionId: hostContext.sessionId ?? context.services?.sessionId,
      ...(hostContext.attemptId !== undefined ? { attemptId: hostContext.attemptId }
        : context.services?.attemptId !== undefined ? { attemptId: context.services.attemptId } : {}),
      sequence: actionRevision(context.session, state, identity),
      type: `${activity.type}.${kind}`,
      payload
    };
    try {
      const pending = Promise.resolve(context.session.dispatch(action, { signal: abortSource.signal }));
      activeActions.add(pending);
      let result;
      try { result = await pending; }
      finally { activeActions.delete(pending); }
      actionMessage = result?.status === 'rejected' ? say('action.unavailable') : '';
      return result;
    } catch {
      actionMessage = say('action.failed');
      return { status: 'rejected' };
    }
  }

  const helpers = {
    activity,
    document,
    mount,
    append: node => { if (!disposed) mount.appendChild(node); },
    requestUpdate: () => Promise.resolve(),
    locales,
    direction: host.keyboardDirection ?? host.direction,
    button,
    createElement: (tag, text, attributes) => element(tag, text, attributes),
    dispatch,
    listen,
    note,
    focusAfterUpdate: (...keys) => { focusKeys = keys.filter(key => typeof key === 'string' && key.length > 0); },
    message: say,
    renderContent,
    session: context.session,
    sessionContext: () => sessionContext(context.session),
    sessionState: () => sessionState(context.session),
    actionMessage: () => actionMessage,
    clearActionMessage: () => { actionMessage = ''; }
  };

  return Object.freeze({
    update() {
      const task = renderQueue.catch(() => {}).then(async () => {
        if (disposed) return;
        clearView();
        let loadingNotice = null;
        if (firstRender) {
          loadingNotice = element('p', say('renderer.rendering'), { role: 'status', 'aria-live': 'polite', 'data-ip-part': 'renderer-status' });
          mount.appendChild(loadingNotice);
        }
        await renderView(helpers);
        if (loadingNotice?.parentNode === mount) mount.removeChild(loadingNotice);
        if (focusKeys.length) {
          const pendingKeys = focusKeys;
          focusKeys = [];
          const find = (node, key) => {
            if (node?.getAttribute?.('data-ip-focus-key') === key) return node;
            for (const child of node?.children ?? []) {
              const match = find(child, key);
              if (match) return match;
            }
            return null;
          };
          for (const key of pendingKeys) {
            const target = find(mount, key);
            if (!target) continue;
            try { target.focus?.(); } catch { /* Focus is best-effort in partial DOM implementations. */ }
            break;
          }
        }
        firstRender = false;
      });
      renderQueue = task;
      return task;
    },
    async dispose() {
      if (disposed) return;
      disposed = true;
      abortSource.abort();
      clearView();
      const contentDisposal = contentRenderers.dispose();
      await renderQueue.catch(() => {});
      await Promise.allSettled([...activeActions]);
      await contentDisposal;
    }
  });
}

async function renderQuiz(helpers) {
  const { activity, button, createElement, dispatch, note, renderContent, sessionState } = helpers;
  const state = sessionState();
  const questions = activity.config?.questions;
  const heading = localized(activity.metadata?.title, helpers.locales) || helpers.message('quiz.title');
  const title = createElement('h1', heading, { 'data-ip-part': 'quiz-title' });
  helpers.append(title);

  if (!Array.isArray(questions) || questions.length === 0) {
    note(helpers.mount, helpers.message('quiz.no-questions'), 'status', { 'data-ip-part': 'quiz-empty' });
    return;
  }
  if (state.phase === 'ready' || state.lifecycle === 'created') {
    button(helpers.mount, helpers.message('quiz.start'), () => {
      helpers.focusAfterUpdate('quiz-question', 'quiz-start');
      void dispatch('start').then(() => helpers.requestUpdate());
    }, { 'data-ip-part': 'quiz-start', 'data-ip-focus-key': 'quiz-start' });
    return;
  }
  if (state.phase === 'evaluating') {
    note(helpers.mount, helpers.message('quiz.checking'), 'status', {
      'data-ip-part': 'quiz-feedback', 'data-ip-focus-key': 'quiz-feedback', tabindex: '-1'
    });
    return;
  }
  if (['feedback', 'review', 'completed'].includes(state.phase)) {
    note(helpers.mount, state.phase === 'completed' ? helpers.message('quiz.complete') : helpers.message('quiz.checked'), 'status', {
      'data-ip-part': 'quiz-feedback', 'data-ip-focus-key': 'quiz-feedback', tabindex: '-1'
    });
    if (state.phase !== 'completed') button(helpers.mount, helpers.message('quiz.finish'), () => {
      helpers.focusAfterUpdate('quiz-feedback', 'quiz-finish');
      void dispatch('complete').then(() => helpers.requestUpdate());
    }, { 'data-ip-part': 'quiz-finish', 'data-ip-focus-key': 'quiz-finish' });
    return;
  }

  const question = questions[state.index] ?? questions[0];
  const questionName = helpers.message('quiz.question-position', { current: state.index + 1, total: questions.length });
  const group = createElement('section', undefined, {
    role: 'group', 'aria-label': questionName, tabindex: '-1',
    'data-ip-part': 'quiz-question', 'data-ip-focus-key': 'quiz-question'
  });
  const prompt = createElement('div', undefined, { 'data-content-role': 'prompt', 'data-ip-slot': 'quiz.prompt' });
  group.appendChild(prompt);
  await renderContent(prompt, question.prompt);
  if (question.kind === 'single-choice' || question.kind === 'multiple-choice') {
    const previous = state.responses?.[question.id];
    const selected = new Set(question.kind === 'multiple-choice' ? (previous?.answer ?? []) : previous ? [previous.answer] : []);
    for (const [index, option] of (question.options ?? []).entries()) {
      const optionButton = createElement('button', undefined, {
        type: 'button', 'aria-pressed': selected.has(option.id) ? 'true' : 'false',
        'data-ip-part': 'quiz-option', 'data-ip-focus-key': `quiz-option-${index}`
      });
      const label = createElement('span');
      await renderContent(label, option.content);
      optionButton.appendChild(label);
      helpers.listen(optionButton, 'click', () => {
        helpers.focusAfterUpdate(`quiz-option-${index}`);
        let answer = option.id;
        if (question.kind === 'multiple-choice') {
          const values = new Set(selected);
          if (values.has(option.id)) values.delete(option.id);
          else values.add(option.id);
          answer = [...values];
        }
        void dispatch('answer', { response: { questionId: question.id, kind: question.kind, answer } }).then(() => helpers.requestUpdate());
      });
      group.appendChild(optionButton);
    }
  } else if (question.kind === 'true-false') {
    for (const answer of [true, false]) {
      const focusKey = `quiz-option-${answer ? 'true' : 'false'}`;
      button(group, helpers.message(answer ? 'quiz.true' : 'quiz.false'), () => {
        helpers.focusAfterUpdate(focusKey);
        void dispatch('answer', { response: { questionId: question.id, kind: 'true-false', answer } }).then(() => helpers.requestUpdate());
      }, { 'data-ip-part': 'quiz-option', 'data-ip-focus-key': focusKey, 'aria-pressed': state.responses?.[question.id]?.answer === answer ? 'true' : 'false' });
    }
  } else {
    note(group, helpers.message('quiz.unsupported-question'), 'status', { 'data-ip-part': 'quiz-question-fallback' });
  }
  helpers.append(group);
  if (questions.length > 1) {
    const navigation = createElement('nav', undefined, {
      'aria-label': helpers.message('quiz.navigation'), 'data-ip-part': 'quiz-navigation'
    });
    questions.forEach((item, index) => button(navigation, helpers.message('quiz.question-button', { current: index + 1 }), () => {
      helpers.focusAfterUpdate(`question-nav-${index}`);
      void dispatch('navigate', { questionId: item.id }).then(() => helpers.requestUpdate());
    }, {
      'aria-current': index === state.index ? 'step' : undefined,
      tabindex: index === state.index ? '0' : '-1',
      'data-ip-part': 'quiz-question-navigation-control',
      'data-ip-focus-key': `question-nav-${index}`
    }));
    helpers.listen(navigation, 'keydown', event => {
      const current = Number(String(event?.target?.getAttribute?.('data-ip-focus-key') ?? '').replace('question-nav-', ''));
      if (!Number.isInteger(current) || current < 0 || current >= questions.length) return;
      const forwardKey = helpers.direction === 'rtl' ? 'ArrowLeft' : 'ArrowRight';
      const backwardKey = helpers.direction === 'rtl' ? 'ArrowRight' : 'ArrowLeft';
      let target;
      if (event.key === forwardKey) target = (current + 1) % questions.length;
      else if (event.key === backwardKey) target = (current - 1 + questions.length) % questions.length;
      else if (event.key === 'Home') target = 0;
      else if (event.key === 'End') target = questions.length - 1;
      else return;
      event.preventDefault?.();
      helpers.focusAfterUpdate(`question-nav-${target}`);
      void dispatch('navigate', { questionId: questions[target].id }).then(() => helpers.requestUpdate());
    });
    helpers.append(navigation);
  }
  if (helpers.actionMessage()) note(group, helpers.actionMessage(), 'alert', { 'data-ip-part': 'quiz-action-error' });
  button(group, helpers.message('quiz.submit'), () => {
    helpers.focusAfterUpdate('quiz-feedback', 'quiz-submit');
    void dispatch('submit').then(() => helpers.requestUpdate());
  }, { 'data-ip-part': 'quiz-submit', 'data-ip-focus-key': 'quiz-submit' });
}

async function renderFlashcards(helpers) {
  const { activity, button, createElement, dispatch, note, renderContent, session, sessionState } = helpers;
  const state = sessionState();
  const deck = activity.config;
  const titleText = localized(activity.metadata?.title, helpers.locales) || localized(deck?.metadata?.title, helpers.locales) || helpers.message('flashcards.title');
  helpers.append(createElement('h1', titleText, { 'data-ip-part': 'flashcards-title' }));
  if (!Array.isArray(deck?.cards)) {
    note(helpers.mount, helpers.message('flashcards.invalid-deck'), 'alert', { 'data-ip-part': 'flashcards-error' });
    return;
  }
  if (state.lifecycle === 'created') {
    button(helpers.mount, helpers.message('flashcards.start'), async () => {
      helpers.focusAfterUpdate('flashcard-front', 'flashcards-start');
      try { await session.start(); await helpers.requestUpdate(); }
      catch { note(helpers.mount, helpers.message('flashcards.start-failed'), 'alert'); }
    }, { 'data-ip-part': 'flashcards-start', 'data-ip-focus-key': 'flashcards-start' });
    return;
  }
  if (state.lifecycle === 'paused') {
    button(helpers.mount, helpers.message('flashcards.resume'), async () => {
      helpers.focusAfterUpdate('flashcard-front', 'flashcards-resume');
      try { await session.resume(); await helpers.requestUpdate(); }
      catch { note(helpers.mount, helpers.message('flashcards.resume-failed'), 'alert'); }
    }, { 'data-ip-part': 'flashcards-resume', 'data-ip-focus-key': 'flashcards-resume' });
    return;
  }
  if (state.lifecycle === 'completed') {
    note(helpers.mount, helpers.message('flashcards.complete'), 'status', {
      'data-ip-part': 'flashcards-complete', 'data-ip-focus-key': 'flashcards-complete', tabindex: '-1'
    });
    return;
  }

  const domain = state.state ?? {};
  const study = domain.study ?? domain;
  const order = Array.isArray(study.order) ? study.order : deck.cards.map(card => card.id);
  const cardId = study.position === null ? null : order[study.position];
  const card = deck.cards.find(item => item.id === cardId);
  if (!card) {
    note(helpers.mount, helpers.message('flashcards.no-cards'), 'status', { 'data-ip-part': 'flashcards-empty' });
    if (typeof session.complete === 'function') button(helpers.mount, helpers.message('flashcards.finish'), async () => {
      helpers.focusAfterUpdate('flashcards-complete', 'flashcards-finish');
      await session.complete(); await helpers.requestUpdate();
    }, { 'data-ip-part': 'flashcards-finish', 'data-ip-focus-key': 'flashcards-finish' });
    return;
  }
  const currentReviewed = domain.reviewHistory?.some(review => review.cardId === card.id)
    || study.reviews?.some(review => review.cardId === card.id);
  const front = createElement('section', undefined, {
    'aria-label': helpers.message('flashcards.front'), tabindex: '-1',
    'data-ip-part': 'flashcard-front', 'data-ip-slot': 'flashcards.front', 'data-ip-focus-key': 'flashcard-front'
  });
  front.appendChild(createElement('h2', helpers.message('flashcards.front'), { 'data-ip-part': 'flashcard-front-heading' }));
  await renderContent(front, card.front);
  helpers.append(front);
  if (study.revealed) {
    const back = createElement('section', undefined, {
      'aria-label': helpers.message('flashcards.back'), tabindex: '-1',
      'data-ip-part': 'flashcard-back', 'data-ip-slot': 'flashcards.back', 'data-ip-focus-key': 'flashcard-back'
    });
    back.appendChild(createElement('h2', helpers.message('flashcards.back'), { 'data-ip-part': 'flashcard-back-heading' }));
    await renderContent(back, card.back);
    helpers.append(back);
    if (!currentReviewed) {
      for (const rating of ['again', 'hard', 'good', 'easy']) {
        button(helpers.mount, helpers.message(`flashcards.rate-${rating}`), () => {
          helpers.focusAfterUpdate('flashcard-front', 'flashcards-complete');
          void dispatch('rate', { rating }).then(() => helpers.requestUpdate());
        }, { 'data-ip-part': 'flashcards-rate', 'data-ip-focus-key': `flashcards-rate-${rating}` });
      }
      button(helpers.mount, helpers.message('flashcards.acknowledge'), () => {
        helpers.focusAfterUpdate('flashcard-front', 'flashcards-complete');
        void dispatch('acknowledge').then(() => helpers.requestUpdate());
      }, { 'data-ip-part': 'flashcards-acknowledge' });
    }
  } else if (study.lifecycle !== 'completed') {
    button(helpers.mount, helpers.message('flashcards.reveal'), () => {
      helpers.focusAfterUpdate('flashcard-back', 'flashcards-reveal');
      void dispatch('reveal').then(() => helpers.requestUpdate());
    }, { 'data-ip-part': 'flashcards-reveal', 'data-ip-focus-key': 'flashcards-reveal' });
  }
  if (typeof session.getProgress === 'function') {
    const progress = session.getProgress();
    note(helpers.mount, helpers.message('flashcards.progress', { reviewed: progress.reviewed, total: progress.total }), 'status', {
      'data-ip-part': 'flashcards-progress', 'data-ip-focus-key': 'flashcards-progress'
    });
    if (progress.complete) button(helpers.mount, helpers.message('flashcards.finish'), async () => {
      helpers.focusAfterUpdate('flashcards-complete', 'flashcards-finish');
      await session.complete(); await helpers.requestUpdate();
    }, { 'data-ip-part': 'flashcards-finish', 'data-ip-focus-key': 'flashcards-finish' });
  }
  if (study.position < order.length - 1) button(helpers.mount, helpers.message('flashcards.next'), () => {
    helpers.focusAfterUpdate('flashcard-front');
    void dispatch('next').then(() => helpers.requestUpdate());
  }, { 'data-ip-part': 'flashcards-next' });
  if (helpers.actionMessage()) note(helpers.mount, helpers.actionMessage(), 'alert', { 'data-ip-part': 'flashcards-action-error' });
}

function quizRenderer(context) {
  let lifecycle;
  lifecycle = createRendererLifecycle(context, async helpers => {
    helpers.requestUpdate = () => lifecycle.update();
    await renderQuiz(helpers);
  });
  return lifecycle;
}

function flashcardsRenderer(context) {
  let lifecycle;
  lifecycle = createRendererLifecycle(context, async helpers => {
    helpers.requestUpdate = () => lifecycle.update();
    await renderFlashcards(helpers);
  });
  return lifecycle;
}

export function registerDomRenderers(registry) {
  if (!registry || typeof registry.registerRenderer !== 'function') throw new TypeError('A Registry with registerRenderer is required.');
  const unregister = [];
  const results = [];
  for (const [manifest, createRenderer] of [[quizManifest, quizRenderer], [flashcardsManifest, flashcardsRenderer]]) {
    const result = registry.registerRenderer(manifest, { createRenderer });
    results.push(result);
    if (!result?.registered) {
      for (const dispose of unregister.reverse()) dispose();
      return Object.freeze({ registrations: Object.freeze(results), dispose() {} });
    }
    unregister.push(result.unregister);
  }
  let disposed = false;
  return Object.freeze({
    registrations: Object.freeze(results),
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const remove of unregister.reverse()) remove();
    }
  });
}
