import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import { createDomHost, DOM_RENDERER_SERVICES, registerDomRenderers } from '../index.js';
import { validateActivitySpec } from '@interactive-project/protocol/validation';
import { validateAction, validateResult, validateSnapshot } from '@interactive-project/protocol/validation/interoperability';
import { validateEvent } from '@interactive-project/events/validation';
import { createRegistry } from '@interactive-project/registry';
import { validateEngineManifest, validateRendererManifest } from '@interactive-project/registry/validation';
import { createQuizEngine } from '@interactive-project/quiz/engine';
import { createLocalEvaluator } from '@interactive-project/quiz/evaluation';
import { validateAuthorQuiz, validateLearnerQuiz, validateQuizResponse } from '@interactive-project/quiz/validation';
import { createStudySession } from '@interactive-project/flashcards/session';
import { validateDeck } from '@interactive-project/flashcards/validation';

const read = path => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'));
const quizActivityFixture = read('fixtures/quiz.single-choice.activity.json');
const flashcardsActivityFixture = read('fixtures/flashcards.single-card.activity.json');
const golden = read('fixtures/host-conformance.v1.json');
const accessibilityContract = read('fixtures/accessibility-contract.v1.json');
assert.equal(accessibilityContract.contractVersion, '1.0.0');
let idCounter = 1000;
let subscriptionRemovals = 0;
const uuid = () => `00000000-0000-4000-8000-${String(idCounter++).padStart(12, '0')}`;

class FakeNode {
  constructor(document, nodeType, name, text = '') {
    this.ownerDocument = document;
    this.nodeType = nodeType;
    this.tagName = nodeType === 1 ? name.toUpperCase() : undefined;
    this.nodeName = nodeType === 3 ? '#text' : this.tagName;
    this.data = text;
    this.children = [];
    this.parentNode = null;
    this.attributes = new Map();
    this.listeners = new Map();
    this.style = { properties: new Map(), setProperty: (name, value) => this.style.properties.set(name, String(value)) };
  }
  get firstChild() { return this.children[0] ?? null; }
  get textContent() { return this.nodeType === 3 ? this.data : this.children.map(child => child.textContent).join(''); }
  set textContent(value) {
    if (this.nodeType === 3) { this.data = String(value); return; }
    for (const child of [...this.children]) this.removeChild(child);
    if (value !== undefined && value !== null && String(value) !== '') this.appendChild(this.ownerDocument.createTextNode(String(value)));
  }
  appendChild(child) {
    if (child.parentNode) child.parentNode.removeChild(child);
    this.children.push(child);
    child.parentNode = this;
    return child;
  }
  removeChild(child) {
    const index = this.children.indexOf(child);
    if (index < 0) throw new Error('Not a child node.');
    this.children.splice(index, 1);
    child.parentNode = null;
    return child;
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(listener);
  }
  removeEventListener(type, listener) { this.listeners.get(type)?.delete(listener); }
  listenerCount(type) { return this.listeners.get(type)?.size ?? 0; }
  focus() { this.ownerDocument.activeElement = this; }
  async keydown(key) {
    let prevented = false;
    const event = { type: 'keydown', key, target: this, preventDefault() { prevented = true; } };
    let current = this;
    while (current) {
      event.currentTarget = current;
      for (const listener of [...(current.listeners.get('keydown') ?? [])]) await listener(event);
      current = current.parentNode;
    }
    return { defaultPrevented: prevented };
  }
  async click() { for (const listener of [...(this.listeners.get('click') ?? [])]) await listener({ type: 'click', target: this }); }
}

class FakeDocument {
  constructor() { this.activeElement = null; }
  createElement(tag) { return new FakeNode(this, 1, tag); }
  createTextNode(text) { return new FakeNode(this, 3, '#text', String(text)); }
}

function mountNode() {
  const document = new FakeDocument();
  return document.createElement('main');
}

function allNodes(root) {
  return [root, ...root.children.flatMap(allNodes)];
}

function button(root, label) {
  return allNodes(root).find(node => node.tagName === 'BUTTON' && node.textContent === label) ?? null;
}

function hasText(root, text) { return root.textContent.includes(text); }

async function waitFor(predicate, message = 'condition did not become true') {
  for (let attempt = 0; attempt < 120; attempt++) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  assert.fail(message);
}

function entry(type, schemaId) {
  return {
    type,
    activitySchemaVersion: '1.0.0',
    schemaId,
    capabilities: {
      interactive: { supported: true },
      evaluable: { supported: type === 'interactive-project/quiz' },
      collaborative: { supported: false },
      offline: { supported: true },
      deterministic: { supported: true },
      resumable: { supported: true },
      aiGeneratable: { supported: false }
    },
    requiredCapabilities: ['interactive'],
    requiredPermissions: []
  };
}

function engineManifest(type, schemaId) {
  return {
    manifestVersion: '1.0.0',
    id: `tests/${type.split('/').at(-1)}-engine`,
    pluginVersion: '0.1.0',
    type,
    protocolVersions: ['1.0.0'],
    entries: [entry(type, schemaId)]
  };
}

function track(session, actions = [], disposed = () => {}) {
  const wrapped = {};
  for (const [key, value] of Object.entries(session)) {
    if (key === 'dispatch') wrapped[key] = (...args) => { actions.push(args[0]); return value(...args); };
    else if (key === 'dispose') wrapped[key] = (...args) => { disposed(); return value(...args); };
    else if (key === 'subscribe') wrapped[key] = (...args) => {
      const unsubscribe = value(...args);
      return () => { subscriptionRemovals++; return unsubscribe(); };
    };
    else wrapped[key] = typeof value === 'function' ? value.bind(session) : value;
  }
  return Object.freeze(wrapped);
}

const quizActivity = structuredClone(quizActivityFixture);
const quizAuthor = {
  schemaVersion: '1.0.0',
  questions: structuredClone(quizActivity.config.questions),
  solutions: { q1: { kind: 'single-choice', answer: 'a' } }
};
const quizValidators = {
  activity: validateActivitySpec,
  learner: validateLearnerQuiz,
  response: validateQuizResponse,
  action: validateAction,
  result: validateResult,
  snapshot: validateSnapshot,
  event: validateEvent
};
const flashcardValidators = {
  activity: validateActivitySpec,
  deck: validateDeck,
  action: validateAction,
  result: validateResult,
  snapshot: validateSnapshot,
  event: validateEvent
};
const domainValidator = activity => {
  if (!validateActivitySpec(activity).valid) return { valid: false };
  if (activity.type === 'interactive-project/quiz') return validateLearnerQuiz(activity.config);
  if (activity.type === 'interactive-project/flashcards') return validateDeck(activity.config);
  return { valid: true };
};

const registry = createRegistry({ validateEngineManifest, validateRendererManifest });
const registrations = registerDomRenderers(registry);
assert(registrations.registrations.every(result => result.registered));
let failNextQuiz = false;
const quizActions = [];
const quizSessions = [];
let quizDisposals = 0;
const quizEngineManifest = engineManifest('interactive-project/quiz', 'https://github.com/interactive-project/quiz/blob/main/schemas/quiz.v1.schema.json#/$defs/learner');
assert(registry.registerEngine(quizEngineManifest, {
  async createEngine(activity, context) {
    if (failNextQuiz) { failNextQuiz = false; throw new Error('internal evaluation detail must not leak'); }
    const evaluator = createLocalEvaluator({ author: quizAuthor, validateAuthor: validateAuthorQuiz, validateResponse: validateQuizResponse });
    const session = await createQuizEngine({
      activity,
      sessionId: context.sessionId,
      attemptId: context.attemptId,
      sourceId: uuid(),
      signal: context.signal,
      validators: quizValidators,
      clock: () => 1234,
      nextId: uuid,
      evaluate: frame => evaluator.evaluate(frame)
    }, webcrypto);
    const instrumented = track(session, quizActions, () => { quizDisposals++; });
    quizSessions.push(instrumented);
    return instrumented;
  },
  evaluate(session) { return session.evaluate(); }
}).registered);

const flashcardActions = [];
const flashcardSessions = [];
let flashcardDisposals = 0;
const flashcardsManifest = engineManifest('interactive-project/flashcards', 'https://github.com/interactive-project/flashcards/blob/main/schemas/deck.v1.schema.json');
assert(registry.registerEngine(flashcardsManifest, {
  async createEngine(activity, context) {
    const session = await createStudySession({
      activity,
      sessionId: context.sessionId,
      attemptId: context.attemptId,
      sourceId: uuid(),
      signal: context.signal,
      validators: flashcardValidators,
      clock: () => 1234,
      nextId: uuid
    }, webcrypto);
    const instrumented = track(session, flashcardActions, () => { flashcardDisposals++; });
    flashcardSessions.push(instrumented);
    return instrumented;
  },
  evaluate(session) { return session.evaluate(); }
}).registered);

const host = createDomHost({ registry, createId: uuid, validateActivity: domainValidator });
assert.throws(() => createDomHost({ registry, createId: uuid, designTokens: { accent: 'red' } }), /designTokens/);
assert.throws(() => createDomHost({ registry, createId: uuid, motionPreference: 'animate' }), /motionPreference/);
assert.equal(typeof globalThis.document, 'undefined');
assert.equal(typeof globalThis.window, 'undefined');

{
  const firstMount = mountNode();
  const secondMount = mountNode();
  const first = host.mountActivity({ activity: quizActivity, mount: firstMount, sessionId: uuid(), attemptId: uuid() });
  const second = host.mountActivity({ activity: quizActivity, mount: secondMount, sessionId: uuid(), attemptId: uuid() });
  assert.equal(first.status, 'loading');
  assert(hasText(firstMount, 'Loading activity'));
  await Promise.all([first.ready, second.ready]);
  assert.equal(first.status, 'mounted');
  assert.equal(second.status, 'mounted');
  assert.equal(firstMount.getAttribute('lang'), 'en');
  assert.equal(firstMount.getAttribute('dir'), 'ltr');
  assert.equal(firstMount.getAttribute('data-motion-preference'), 'no-preference');
  assert.equal(firstMount.getAttribute('data-interaction-mode'), 'standard');
  assert(hasText(firstMount, 'DOM quiz fixture'));

  const staleStart = button(firstMount, 'Start quiz');
  await staleStart.click();
  await waitFor(() => !!button(firstMount, 'Submit answers'));
  assert(hasText(firstMount, 'Select A'));
  assert.equal(staleStart.listenerCount('click'), 0, 'rerender removes old event handlers');
  assert(button(secondMount, 'Start quiz'), 'a separate mount remains in its own ready state');
  await button(firstMount, 'A').click();
  await waitFor(() => quizSessions[0].getState().responses.q1?.answer === 'a');
  await waitFor(() => !!button(firstMount, 'Submit answers'));
  await button(firstMount, 'Submit answers').click();
  await waitFor(() => quizSessions[0].getState().phase === 'feedback');
  await waitFor(() => !!button(firstMount, 'Finish quiz'));
  await button(firstMount, 'Finish quiz').click();
  await waitFor(() => quizSessions[0].getState().phase === 'completed');
  const quizTrace = quizActions.filter(action => action.activityId === quizActivity.id);
  assert.deepEqual(quizTrace.map(action => action.type), golden.traces[0].actions.map(action => action.type));
  assert(quizTrace.every(action => validateAction(action).valid));
  assert.deepEqual(quizTrace[1].payload, golden.traces[0].actions[1].payload);

  const removedButton = button(secondMount, 'Start quiz');
  await first.unmount();
  assert.equal(first.status, 'unmounted');
  assert.equal(firstMount.children.length, 0);
  assert.equal(quizSessions[0].getState().lifecycle, 'disposed');
  assert.equal(removedButton.listenerCount('click'), 1, 'the unrelated mount retains its own listener');
  await second.unmount();
  assert.equal(removedButton.listenerCount('click'), 0);
  assert.equal(quizDisposals, 2);
  assert.equal(subscriptionRemovals, 2);
}

{
  const flashMount = mountNode();
  const flash = host.mountActivity({ activity: flashcardsActivityFixture, mount: flashMount, sessionId: uuid(), attemptId: uuid() });
  await flash.ready;
  assert.equal(flash.status, 'mounted');
  assert(button(flashMount, 'Start study'));
  await button(flashMount, 'Start study').click();
  await waitFor(() => !!button(flashMount, 'Reveal answer'));
  assert.equal(flashMount.ownerDocument.activeElement.getAttribute('data-ip-focus-key'), 'flashcard-front');
  assert(hasText(flashMount, 'Front side'));
  await button(flashMount, 'Reveal answer').click();
  await waitFor(() => !!button(flashMount, 'Rate good'));
  assert.equal(flashMount.ownerDocument.activeElement.getAttribute('data-ip-focus-key'), 'flashcard-back');
  assert(hasText(flashMount, 'Back side'));
  await button(flashMount, 'Rate good').click();
  await waitFor(() => flashcardSessions[0].getProgress().complete);
  await waitFor(() => flashMount.ownerDocument.activeElement?.getAttribute('data-ip-focus-key') === 'flashcard-front');
  assert.equal(flashMount.ownerDocument.activeElement.getAttribute('data-ip-focus-key'), 'flashcard-front');
  assert(allNodes(flashMount).some(node => node.getAttribute('data-ip-part') === 'flashcards-progress' && node.getAttribute('aria-live') === 'polite'));
  await waitFor(() => !!button(flashMount, 'Finish study'));
  await button(flashMount, 'Finish study').click();
  await waitFor(() => flashcardSessions[0].getState().lifecycle === 'completed');
  const flashTrace = flashcardActions.filter(action => action.activityId === flashcardsActivityFixture.id);
  assert.deepEqual(flashTrace.map(action => action.type), golden.traces[1].actions.map(action => action.type));
  assert(flashTrace.every(action => validateAction(action).valid));
  await flash.unmount();
  assert.equal(flashcardDisposals, 1);
  assert.equal(subscriptionRemovals, 3);
}

{
  const fallbackActivity = structuredClone(quizActivity);
  fallbackActivity.config.questions[0].prompt = {
    kind: 'group',
    schemaVersion: '1.0.0',
    children: [{
      kind: 'math',
      schemaVersion: '1.0.0',
      format: 'tex',
      source: '\\frac{1}{2} + \\frac{1}{2}',
      plainText: { kind: 'localized-text', schemaVersion: '1.0.0', defaultLocale: 'en', translations: { en: { text: 'One half plus one half.' } } }
    }]
  };
  const fallbackMount = mountNode();
  const fallbackHandle = host.mountActivity({ activity: fallbackActivity, mount: fallbackMount, sessionId: uuid(), attemptId: uuid() });
  await fallbackHandle.ready;
  await button(fallbackMount, 'Start quiz').click();
  await waitFor(() => hasText(fallbackMount, 'One half plus one half.'));
  assert(hasText(fallbackMount, 'This content is not supported here.'), 'unsupported ContentNodes retain an accessible text fallback');
  await fallbackHandle.unmount();
}

{
  const invalid = structuredClone(quizActivity);
  invalid.config.questions = [];
  const mount = mountNode();
  const handle = host.mountActivity({ activity: invalid, mount, sessionId: uuid() });
  await handle.ready;
  assert.equal(handle.status, 'validation-error');
  assert(allNodes(mount).some(node => node.getAttribute('role') === 'alert'));
  await handle.unmount();

  const unsupportedRegistry = createRegistry({ validateEngineManifest, validateRendererManifest });
  const lookupCounts = { engine: 0, renderer: 0 };
  const independentLookup = {
    lookupEngine(request) { lookupCounts.engine++; return unsupportedRegistry.lookupEngine(request); },
    lookupRenderer(request) { lookupCounts.renderer++; return unsupportedRegistry.lookupRenderer(request); }
  };
  const unsupportedHost = createDomHost({ registry: independentLookup, createId: uuid, validateActivity: domainValidator });
  const noEngineMount = mountNode();
  const noEngine = unsupportedHost.mountActivity({ activity: quizActivity, mount: noEngineMount, sessionId: uuid() });
  await noEngine.ready;
  assert.equal(noEngine.status, 'unsupported');
  assert(hasText(noEngineMount, 'No engine is registered'));
  assert.deepEqual(lookupCounts, { engine: 1, renderer: 1 });
  await noEngine.unmount();
  unsupportedRegistry.dispose();

  const missingRendererRegistry = createRegistry({ validateEngineManifest, validateRendererManifest });
  assert(missingRendererRegistry.registerEngine(quizEngineManifest, {
    createEngine: async () => { throw new Error('must not execute without a renderer'); },
    evaluate: () => ({})
  }).registered);
  const missingRendererHost = createDomHost({ registry: missingRendererRegistry, createId: uuid, validateActivity: domainValidator });
  const noRendererMount = mountNode();
  const noRenderer = missingRendererHost.mountActivity({ activity: quizActivity, mount: noRendererMount, sessionId: uuid() });
  await noRenderer.ready;
  assert.equal(noRenderer.status, 'unsupported');
  assert(hasText(noRendererMount, 'No DOM renderer is registered'));
  await noRenderer.unmount();
  missingRendererRegistry.dispose();

  failNextQuiz = true;
  const errorMount = mountNode();
  const errored = host.mountActivity({ activity: quizActivity, mount: errorMount, sessionId: uuid(), attemptId: uuid() });
  await errored.ready;
  assert.equal(errored.status, 'runtime-error');
  assert(hasText(errorMount, 'The activity could not be started.'));
  assert(!hasText(errorMount, 'internal evaluation detail'));
  await errored.unmount();
}

{
  const codeType = 'interactive-project/code';
  const delayedRegistry = createRegistry({ validateEngineManifest, validateRendererManifest });
  let resolveSession;
  let lateSessionDisposals = 0;
  assert(delayedRegistry.registerEngine(engineManifest(codeType, 'https://example.org/code.schema.json'), {
    createEngine: () => new Promise(resolve => { resolveSession = resolve; }),
    evaluate: () => ({})
  }).registered);
  assert(delayedRegistry.registerRenderer({
    manifestVersion: '1.0.0', id: 'tests/delayed-dom-renderer', pluginVersion: '0.1.0', type: codeType,
    protocolVersions: ['1.0.0'], host: 'dom', activitySchemaVersions: ['1.0.0'], rendererContractVersion: '1.0.0'
  }, { createRenderer: () => ({ update() {}, dispose() {} }) }).registered);
  const delayedHost = createDomHost({ registry: delayedRegistry, createId: uuid });
  const delayed = delayedHost.mountActivity({
    activity: { protocolVersion: '1.0.0', id: uuid(), type: codeType, activitySchemaVersion: '1.0.0', metadata: { title: 'Delayed' }, config: {} },
    mount: mountNode(), sessionId: uuid()
  });
  const unmounting = delayed.unmount();
  resolveSession({ dispatch: async () => ({ status: 'accepted' }), dispose() { lateSessionDisposals++; } });
  await unmounting;
  await delayed.ready;
  assert.equal(lateSessionDisposals, 1, 'a session resolving after unmount is still disposed');
  delayedRegistry.dispose();
}

{
  const codeType = 'interactive-project/code';
  const childRegistry = createRegistry({ validateEngineManifest, validateRendererManifest });
  assert(childRegistry.registerEngine(engineManifest(codeType, 'https://example.org/code.schema.json'), {
    createEngine: async () => ({ dispatch: async () => ({ status: 'accepted' }), dispose() {} }),
    evaluate: () => ({})
  }).registered);
  let childUnmounts = 0;
  let parentDisposals = 0;
  assert(childRegistry.registerRenderer({
    manifestVersion: '1.0.0', id: 'tests/code-dom-renderer', pluginVersion: '0.1.0', type: codeType,
    protocolVersions: ['1.0.0'], host: 'dom', activitySchemaVersions: ['1.0.0'], rendererContractVersion: '1.0.0'
  }, {
    createRenderer(context) {
      context.services[DOM_RENDERER_SERVICES].ownChild({ unmount: async () => { childUnmounts++; } });
      return { update() {}, dispose() { parentDisposals++; } };
    }
  }).registered);
  const childHost = createDomHost({ registry: childRegistry, createId: uuid });
  const codeActivity = {
    protocolVersion: '1.0.0', id: uuid(), type: codeType, activitySchemaVersion: '1.0.0',
    metadata: { title: 'Parent mount' }, config: {}
  };
  const parent = childHost.mountActivity({ activity: codeActivity, mount: mountNode(), sessionId: uuid() });
  await parent.ready;
  await parent.unmount();
  await parent.unmount();
  assert.equal(childUnmounts, 1);
  assert.equal(parentDisposals, 1);
  childRegistry.dispose();
}

{
  const waitingActivity = structuredClone(quizActivity);
  waitingActivity.config.questions[0].prompt = {
    kind: 'image', schemaVersion: '1.0.0',
    asset: { kind: 'asset-ref', schemaVersion: '1.0.0', id: 'urn:asset:pending', mediaType: 'image/png', uri: 'https://assets.example.org/pending.png' },
    alt: { kind: 'localized-text', schemaVersion: '1.0.0', defaultLocale: 'en', translations: { en: { text: 'Pending asset alternative' } } }
  };
  let assetStartedResolve;
  let assetStartedFlag = false;
  let assetAbortObserved = false;
  const assetStarted = new Promise(resolve => { assetStartedResolve = resolve; });
  const mount = mountNode();
  const pending = host.mountActivity({
    activity: waitingActivity,
    mount,
    sessionId: uuid(),
    attemptId: uuid(),
    services: {
      content: {
        policy: { assets: { allowedOrigins: ['https://assets.example.org'] } },
        drivers: [{ id: 'tests/dom-image-driver', capabilities: { kinds: ['image'] }, render: request => ({ value: mount.ownerDocument.createTextNode(request.accessibleText) }) }],
        resolveAsset(_asset, signal) {
          assetStartedFlag = true;
          assetStartedResolve();
          return new Promise(resolve => signal.addEventListener('abort', () => {
            assetAbortObserved = true;
            resolve(null);
          }, { once: true }));
        }
      }
    }
  });
  await pending.ready;
  await button(mount, 'Start quiz').click();
  await waitFor(() => assetStartedFlag, `asset resolver was not reached; mount state: ${pending.status}; phase: ${quizSessions.at(-1).getState().phase}; text: ${mount.textContent}`);
  await assetStarted;
  await pending.unmount();
  assert.equal(assetAbortObserved, true);
  assert.equal(pending.status, 'unmounted');
  assert.equal(subscriptionRemovals, 5);
}

{
  const accessibleActivity = structuredClone(quizActivity);
  accessibleActivity.id = uuid();
  const secondQuestion = structuredClone(accessibleActivity.config.questions[0]);
  secondQuestion.id = 'q2';
  accessibleActivity.config.questions.push(secondQuestion);
  quizAuthor.questions.push(structuredClone(secondQuestion));
  quizAuthor.solutions.q2 = { kind: 'single-choice', answer: 'a' };
  const hookParts = [];
  const accessibleHost = createDomHost({
    registry,
    createId: uuid,
    validateActivity: domainValidator,
    localePreferences: ['ar'],
    motionPreference: 'reduce',
    interactionMode: 'nonvisual',
    designTokens: { '--ip-accent': 'rebeccapurple' },
    localize(key) { return key === 'renderer-dom.quiz.submit' ? 'إرسال مخصص' : ''; },
    renderHooks: {
      onElement(_element, info) {
        hookParts.push(info.part);
        if (info.part === 'quiz-option') throw new Error('Decoration errors are isolated.');
      }
    }
  });
  const mount = mountNode();
  const accessible = accessibleHost.mountActivity({ activity: accessibleActivity, mount, sessionId: uuid(), attemptId: uuid() });
  await accessible.ready;
  assert.equal(mount.getAttribute('lang'), 'ar');
  assert.equal(mount.getAttribute('dir'), 'rtl');
  assert.equal(mount.getAttribute('data-motion-preference'), 'reduce');
  assert.equal(mount.getAttribute('data-interaction-mode'), 'nonvisual');
  assert.equal(mount.getAttribute('data-interactive-project-renderer'), 'dom');
  assert.equal(mount.style.properties.get('--ip-accent'), 'rebeccapurple');
  assert(button(mount, 'بدء الاختبار'), `built-in labels follow the selected locale: ${accessible.status}: ${mount.textContent}`);
  assert(hookParts.includes('activity-root'));
  await button(mount, 'بدء الاختبار').click();
  await waitFor(() => !!button(mount, 'إرسال مخصص'));
  assert.equal(mount.ownerDocument.activeElement.getAttribute('data-ip-focus-key'), 'quiz-question');
  const questionGroup = allNodes(mount).find(node => node.getAttribute('data-ip-part') === 'quiz-question');
  assert.equal(questionGroup.getAttribute('role'), 'group');
  assert.equal(questionGroup.getAttribute('aria-label'), 'السؤال 1 من 2');
  assert(allNodes(mount).some(node => node.getAttribute('data-ip-slot') === 'quiz.prompt'));
  assert(hookParts.includes('quiz-option'), 'hooks receive semantic parts and cannot break rendering');

  const currentNavigation = () => allNodes(mount).find(node => node.tagName === 'NAV');
  const navigation = currentNavigation();
  const firstQuestionButton = navigation.children[0];
  assert.equal(firstQuestionButton.getAttribute('tabindex'), '0');
  assert.equal(navigation.children[1].getAttribute('tabindex'), '-1');
  const nextQuestion = await firstQuestionButton.keydown(accessibilityContract.keyboard.quizQuestionNavigation.rtlNext);
  assert.equal(nextQuestion.defaultPrevented, true);
  await waitFor(() => currentNavigation().children[1].getAttribute('aria-current') === 'step');
  assert.equal(mount.ownerDocument.activeElement.getAttribute('data-ip-focus-key'), 'question-nav-1');
  await currentNavigation().children[1].keydown('Home');
  await waitFor(() => currentNavigation().children[0].getAttribute('aria-current') === 'step');
  assert.equal(mount.ownerDocument.activeElement.getAttribute('data-ip-focus-key'), 'question-nav-0');

  await button(mount, 'B').click();
  await waitFor(() => mount.ownerDocument.activeElement.getAttribute('data-ip-focus-key') === 'quiz-option-1');
  const answerControl = allNodes(mount).find(node => node.getAttribute('data-ip-focus-key') === 'quiz-option-1');
  assert.equal(answerControl.getAttribute('aria-pressed'), 'true');
  assert.equal(answerControl.tagName, 'BUTTON', 'native controls keep browser Tab/Enter/Space behavior');
  await accessible.unmount();

  const nonvisualActivity = structuredClone(accessibleActivity);
  nonvisualActivity.id = uuid();
  nonvisualActivity.config.questions[0].prompt = {
    kind: 'math', schemaVersion: '1.0.0', format: 'tex', source: 'x + 1',
    plainText: {
      kind: 'localized-text', schemaVersion: '1.0.0', defaultLocale: 'en',
      translations: { en: { text: 'Text alternative for the equation.' } }
    }
  };
  let visualDriverCalls = 0;
  const nonvisualMount = mountNode();
  const nonvisualHandle = accessibleHost.mountActivity({
    activity: nonvisualActivity,
    mount: nonvisualMount,
    sessionId: uuid(),
    attemptId: uuid(),
    services: {
      content: {
        drivers: [{
          id: 'tests/visual-math-only', capabilities: { kinds: ['math'] },
          render: () => { visualDriverCalls++; return { value: nonvisualMount.ownerDocument.createElement('canvas') }; }
        }]
      }
    }
  });
  await nonvisualHandle.ready;
  await button(nonvisualMount, 'بدء الاختبار').click();
  await waitFor(() => hasText(nonvisualMount, 'Text alternative for the equation.'));
  assert.equal(visualDriverCalls, 0, 'nonvisual mode uses the content node alternative instead of visual drivers');
  assert(!allNodes(nonvisualMount).some(node => node.tagName === 'CANVAS'));
  await nonvisualHandle.unmount();
}

{
  const advancedType = 'interactive-project/simulation';
  const advancedRegistry = createRegistry({ validateEngineManifest, validateRendererManifest });
  const dispatched = [];
  let dispatchSignal;
  const advancedEngineManifest = engineManifest(advancedType, 'https://example.org/advanced.schema.json');
  const advancedEngineRegistration = advancedRegistry.registerEngine(advancedEngineManifest, {
    async createEngine(_activity, engineContext) {
      return {
        async dispatch(action, options) { dispatched.push(action); dispatchSignal = options.signal; return { status: 'accepted' }; },
        getState() { return { actionSequence: dispatched.length }; },
        getContext() { return { sessionId: engineContext.sessionId, revision: dispatched.length }; },
        dispose() {}
      };
    },
    evaluate() { return {}; }
  });
  assert(advancedEngineRegistration.registered, JSON.stringify(advancedEngineRegistration));
  assert(advancedRegistry.registerRenderer({
    manifestVersion: '1.0.0', id: 'tests/advanced-text-renderer', pluginVersion: '0.1.0', type: advancedType,
    protocolVersions: ['1.0.0'], host: 'dom', activitySchemaVersions: ['1.0.0'], rendererContractVersion: '1.0.0'
  }, {
    createRenderer(context) {
      const adapter = context.services[DOM_RENDERER_SERVICES];
      assert.equal(adapter.interactionMode, 'nonvisual');
      return {
        update() {
          while (context.mount.firstChild) context.mount.removeChild(context.mount.firstChild);
          const instructions = context.mount.ownerDocument.createElement('p');
          instructions.setAttribute('data-ip-part', 'advanced-alternative');
          instructions.setAttribute('role', 'status');
          instructions.textContent = 'Use the following button to continue without the visual board.';
          context.mount.appendChild(instructions);
          const control = context.mount.ownerDocument.createElement('button');
          control.setAttribute('type', 'button');
          control.setAttribute('aria-label', 'Continue without visual board');
          control.textContent = 'Continue';
          control.addEventListener('click', async () => {
            await adapter.dispatchAction('continue', { mode: 'text' });
          });
          context.mount.appendChild(control);
        },
        dispose() {}
      };
    }
  }).registered);
  const advancedHost = createDomHost({ registry: advancedRegistry, createId: uuid, interactionMode: 'nonvisual' });
  const activity = {
    protocolVersion: '1.0.0', id: uuid(), type: advancedType, activitySchemaVersion: '1.0.0',
    metadata: { title: 'Advanced task' }, config: {}
  };
  const mount = mountNode();
  const sessionId = uuid();
  const advanced = advancedHost.mountActivity({ activity, mount, sessionId });
  await advanced.ready;
  const alternative = allNodes(mount).find(node => node.getAttribute('data-ip-part') === 'advanced-alternative');
  const control = allNodes(mount).find(node => node.tagName === 'BUTTON');
  assert.equal(alternative.getAttribute('role'), 'status');
  assert.equal(control.getAttribute('aria-label'), 'Continue without visual board');
  await control.click();
  assert.equal(dispatched[0].type, `${advancedType}.continue`);
  assert.deepEqual(dispatched[0].payload, { mode: 'text' });
  assert.equal(dispatched[0].sessionId, sessionId);
  assert.equal(dispatched[0].sequence, 0);
  assert.match(dispatched[0].id, /^[0-9a-f-]{36}$/);
  assert.equal(dispatchSignal.aborted, false);
  await advanced.unmount();
  assert.equal(dispatchSignal.aborted, true, 'the advanced adapter action receives host-owned cancellation');
  advancedRegistry.dispose();
}

registrations.dispose();
registry.dispose();
console.log('DOM host: real Quiz/Flashcards action traces, localized semantics, RTL keyboard/focus behavior, style hooks, ContentNode fallbacks and lifecycle checks passed.');
