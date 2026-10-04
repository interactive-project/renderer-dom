import { createRendererRegistry } from '@interactive-project/content-node/rendering';
import { validateContent } from '@interactive-project/content-node/validation';
import { selectLocalizedText } from '@interactive-project/protocol/content';

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

function createElement(document, tag, text, attributes = {}) {
  const element = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) {
    if (value !== undefined && value !== null) element.setAttribute(name, String(value));
  }
  if (text !== undefined) element.textContent = text;
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
  const abortSource = cancellationSource();
  const listeners = new Set();
  const activeActions = new Set();
  const customDrivers = Array.isArray(integration.drivers) ? integration.drivers : [];
  const contentRenderers = createRendererRegistry({
    drivers: [...customDrivers, contentTextDriver(document)],
    localePreferences: locales,
    localize: integration.localize,
    policy: integration.policy,
    resolveAsset: integration.resolveAsset
  });
  let disposed = false;
  let firstRender = true;
  let renderQueue = Promise.resolve();
  let actionMessage = '';

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
    const element = createElement(document, 'button', label, { type: 'button', ...attributes });
    listen(element, 'click', onClick);
    if (!disposed) parent.appendChild(element);
    return element;
  }

  function note(parent, message, role = 'status') {
    if (!disposed) parent.appendChild(createElement(document, 'p', message, { role, 'aria-live': 'polite' }));
  }

  async function renderContent(parent, node) {
    if (disposed) return;
    const valid = validateContent(node);
    if (!valid.valid) {
      note(parent, 'This content is invalid and cannot be displayed.', 'alert');
      return;
    }
    try {
      const result = await contentRenderers.render(node, { localePreferences: locales, signal: abortSource.signal });
      if (disposed || abortSource.signal.aborted) return;
      const value = result.renderedValue;
      if (result.status === 'rendered' && value && typeof value.nodeType === 'number' && typeof mount.appendChild === 'function') {
        parent.appendChild(value);
        return;
      }
      const fallback = createElement(document, 'span', result.accessibleText, { dir: result.direction });
      parent.appendChild(fallback);
      if (result.message?.text) note(parent, result.message.text);
    } catch {
      if (!disposed) note(parent, 'This content could not be displayed.');
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
      actionMessage = result?.status === 'rejected' ? 'That action is not available in the current activity state.' : '';
      return result;
    } catch {
      actionMessage = 'That action could not be applied.';
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
    button,
    createElement: (tag, text, attributes) => createElement(document, tag, text, attributes),
    dispatch,
    listen,
    note,
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
          loadingNotice = createElement(document, 'p', 'Rendering activity…', { role: 'status', 'aria-live': 'polite' });
          mount.appendChild(loadingNotice);
        }
        await renderView(helpers);
        if (loadingNotice?.parentNode === mount) mount.removeChild(loadingNotice);
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
  const heading = localized(activity.metadata?.title, helpers.locales) || 'Quiz';
  const title = createElement('h1', heading);
  helpers.append(title);

  if (!Array.isArray(questions) || questions.length === 0) {
    note(helpers.mount, 'This quiz has no questions.');
    return;
  }
  if (state.phase === 'ready' || state.lifecycle === 'created') {
    button(helpers.mount, 'Start quiz', () => { void dispatch('start').then(() => helpers.requestUpdate()); });
    return;
  }
  if (state.phase === 'evaluating') {
    note(helpers.mount, 'Checking your answers…');
    return;
  }
  if (['feedback', 'review', 'completed'].includes(state.phase)) {
    note(helpers.mount, state.phase === 'completed' ? 'Quiz complete.' : 'Your answers have been checked.');
    if (state.phase !== 'completed') button(helpers.mount, 'Finish quiz', () => { void dispatch('complete').then(() => helpers.requestUpdate()); });
    return;
  }

  const question = questions[state.index] ?? questions[0];
  const group = createElement('section', undefined, { role: 'group', 'aria-label': `Question ${state.index + 1} of ${questions.length}` });
  const prompt = createElement('div', undefined, { 'data-content-role': 'prompt' });
  group.appendChild(prompt);
  await renderContent(prompt, question.prompt);
  if (question.kind === 'single-choice' || question.kind === 'multiple-choice') {
    const previous = state.responses?.[question.id];
    const selected = new Set(question.kind === 'multiple-choice' ? (previous?.answer ?? []) : previous ? [previous.answer] : []);
    for (const option of question.options ?? []) {
      const optionButton = createElement('button', undefined, { type: 'button', 'aria-pressed': selected.has(option.id) ? 'true' : 'false' });
      const label = createElement('span');
      await renderContent(label, option.content);
      optionButton.appendChild(label);
      helpers.listen(optionButton, 'click', () => {
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
      button(group, answer ? 'True' : 'False', () => {
        void dispatch('answer', { response: { questionId: question.id, kind: 'true-false', answer } }).then(() => helpers.requestUpdate());
      });
    }
  } else {
    note(group, 'This question type is not supported by the vanilla DOM renderer yet.');
  }
  helpers.append(group);
  if (questions.length > 1) {
    const navigation = createElement('nav', undefined, { 'aria-label': 'Quiz questions' });
    questions.forEach((item, index) => button(navigation, `Question ${index + 1}`, () => {
      void dispatch('navigate', { questionId: item.id }).then(() => helpers.requestUpdate());
    }, { 'aria-current': index === state.index ? 'step' : undefined }));
    helpers.append(navigation);
  }
  if (helpers.actionMessage()) note(group, helpers.actionMessage());
  button(group, 'Submit answers', () => { void dispatch('submit').then(() => helpers.requestUpdate()); });
}

async function renderFlashcards(helpers) {
  const { activity, button, createElement, dispatch, note, renderContent, session, sessionState } = helpers;
  const state = sessionState();
  const deck = activity.config;
  const titleText = localized(activity.metadata?.title, helpers.locales) || localized(deck?.metadata?.title, helpers.locales) || 'Flashcards';
  helpers.append(createElement('h1', titleText));
  if (!Array.isArray(deck?.cards)) {
    note(helpers.mount, 'This flashcard deck is invalid.');
    return;
  }
  if (state.lifecycle === 'created') {
    button(helpers.mount, 'Start study', async () => {
      try { await session.start(); await helpers.requestUpdate(); }
      catch { note(helpers.mount, 'The study session could not be started.'); }
    });
    return;
  }
  if (state.lifecycle === 'paused') {
    button(helpers.mount, 'Resume study', async () => {
      try { await session.resume(); await helpers.requestUpdate(); }
      catch { note(helpers.mount, 'The study session could not be resumed.'); }
    });
    return;
  }
  if (state.lifecycle === 'completed') {
    note(helpers.mount, 'Study complete.');
    return;
  }

  const domain = state.state ?? {};
  const study = domain.study ?? domain;
  const order = Array.isArray(study.order) ? study.order : deck.cards.map(card => card.id);
  const cardId = study.position === null ? null : order[study.position];
  const card = deck.cards.find(item => item.id === cardId);
  if (!card) {
    note(helpers.mount, 'There are no cards to study.');
    if (typeof session.complete === 'function') button(helpers.mount, 'Finish study', async () => { await session.complete(); await helpers.requestUpdate(); });
    return;
  }
  const currentReviewed = domain.reviewHistory?.some(review => review.cardId === card.id)
    || study.reviews?.some(review => review.cardId === card.id);
  const front = createElement('section', undefined, { 'aria-label': 'Card front' });
  front.appendChild(createElement('h2', 'Front'));
  await renderContent(front, card.front);
  helpers.append(front);
  if (study.revealed) {
    const back = createElement('section', undefined, { 'aria-label': 'Card back' });
    back.appendChild(createElement('h2', 'Back'));
    await renderContent(back, card.back);
    helpers.append(back);
    if (!currentReviewed) {
      for (const rating of ['again', 'hard', 'good', 'easy']) {
        button(helpers.mount, `Rate ${rating}`, () => { void dispatch('rate', { rating }).then(() => helpers.requestUpdate()); });
      }
      button(helpers.mount, 'Mark reviewed without rating', () => { void dispatch('acknowledge').then(() => helpers.requestUpdate()); });
    }
  } else if (study.lifecycle !== 'completed') {
    button(helpers.mount, 'Reveal answer', () => { void dispatch('reveal').then(() => helpers.requestUpdate()); });
  }
  if (typeof session.getProgress === 'function') {
    const progress = session.getProgress();
    note(helpers.mount, `${progress.reviewed} of ${progress.total} reviewed.`);
    if (progress.complete) button(helpers.mount, 'Finish study', async () => { await session.complete(); await helpers.requestUpdate(); });
  }
  if (study.position < order.length - 1) button(helpers.mount, 'Next card', () => { void dispatch('next').then(() => helpers.requestUpdate()); });
  if (helpers.actionMessage()) note(helpers.mount, helpers.actionMessage());
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
