const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function fakeElement() {
  return {
    style: {}, className: '', value: '', checked: false, innerHTML: '', textContent: '',
    classList: { add() {}, remove() {}, toggle() {} },
    addEventListener() {}, focus() {}, setSelectionRange() {}, scrollIntoView() {},
    appendChild() {}, remove() {}, select() {},
    setAttribute() {}, hasAttribute() { return false; }, querySelector() { return null; },
  };
}

const elements = new Map();
global.document = {
  activeElement: null,
  body: fakeElement(),
  getElementById(id) {
    if (!elements.has(id)) elements.set(id, fakeElement());
    return elements.get(id);
  },
  querySelectorAll() { return []; },
  addEventListener() {},
  createElement() { return fakeElement(); },
  execCommand() { return true; },
};
global.window = {
  API_BASE: 'http://example.test',
  location: { search: '', pathname: '/', href: '' },
  history: { replaceState() {} },
  scrollTo() {},
};
global.localStorage = {
  values: new Map(),
  getItem(key) { return this.values.get(key) ?? null; },
  setItem(key, value) { this.values.set(key, String(value)); },
  removeItem(key) { this.values.delete(key); },
};
global.navigator = { clipboard: { async writeText() {} } };
global.alert = () => {};
global.confirm = () => true;

const rootHtml = path.join(__dirname, '..', 'index.html');
const html = fs.readFileSync(fs.existsSync(rootHtml) ? rootHtml : path.join(__dirname, '..', 'frontend', 'index.html'), 'utf8');
const match = html.match(/<script>([\s\S]*)<\/script>/);
assert.ok(match, 'main script exists');

const expose = `
return {
  lifecycleState, isCandidateActive, isWaitingForTreatment, isWaitingForClient,
  effectiveBoardStage, processPatchForOutcome, collapseDuplicates,
  composeCandidateNotes, readCandidateNotes, makeCandidateEvent,
  automaticEventsForChanges, processSnapshot, describeProcessChange, eventsWithBaseline,
  addCandidateEvent, fillEventOutcomes, fillEventReasons, reconcileCandidateProcess,
  EVENT_FLOW, FLOW_OUTCOMES, NEXT_EVENT,
  setTestData(data) { candidates = data.candidates; jobs = data.jobs; editingCandidateSnapshot = data.candidate; editingId = data.candidate.id; editingEvents = eventsWithBaseline(data.candidate, []); },
  getEditingEvents() { return editingEvents; }
};`;
const core = new Function(match[1] + expose)();

const withdrawn = {
  id: '1', personId: '10', jobId: '7', stage: 'cv_to_client', sentToClient: true,
  clientApproved: false, outcomeStatus: 'הסיר/ה מועמדות', notes: '',
};
assert.equal(core.lifecycleState(withdrawn), 'closed');
assert.equal(core.isWaitingForTreatment(withdrawn), false);
assert.equal(core.isWaitingForClient(withdrawn), false);
assert.equal(core.effectiveBoardStage(withdrawn), 'rejected');

const waiting = { id: '2', personId: '20', stage: 'applied', outcomeStatus: '', sentToClient: false };
assert.equal(core.lifecycleState(waiting), 'active');
assert.equal(core.isCandidateActive(waiting), false);
assert.equal(core.isWaitingForTreatment(waiting), true);

const withClient = { id: '3', personId: '30', stage: 'cv_to_client', outcomeStatus: '', sentToClient: true, clientApproved: false };
assert.equal(core.isCandidateActive(withClient), true);
assert.equal(core.isWaitingForClient(withClient), true);

assert.deepEqual(core.processPatchForOutcome(waiting, 'הסיר/ה מועמדות'), {
  outcomeStatus: 'הסיר/ה מועמדות', stage: 'rejected',
});
for (const status of [
  'צ"ש גבוהות', 'לא תואמ/ת פרופיל', 'נפסל איזור ג"ג', 'נשלח מכתב שלילה',
  'לקוח ביטל בקשה', 'לא מחפש/ת עבודה', 'מועמד נטש תהליך',
]) {
  assert.equal(core.processPatchForOutcome(waiting, status).stage, 'rejected');
}
assert.equal(core.processPatchForOutcome(waiting, 'גוייס/ה').stage, 'staffed');
assert.equal(core.processPatchForOutcome(waiting, 'קו"ח הועבר ללקוח').sentToClient, true);

const duplicateActive = { ...waiting, id: '4', personId: '40', jobId: '9', name: 'עומרי' };
const duplicateClosed = { ...duplicateActive, id: '5', outcomeStatus: 'הסיר/ה מועמדות' };
const collapsed = core.collapseDuplicates([duplicateActive, duplicateClosed]);
assert.equal(collapsed.length, 1);
assert.equal(collapsed[0].outcomeStatus, 'הסיר/ה מועמדות');

const oldClosed = { ...duplicateClosed, contactedAt: '2026-03-01' };
const newApplication = { ...duplicateActive, contactedAt: '2026-08-01', stage: 'phone' };
assert.equal(core.collapseDuplicates([oldClosed, newApplication])[0].stage, 'phone');

const event = core.makeCandidateEvent('teams_interview', 'התקיים ראיון', 'נשלח ללקוח', waiting);
const encodedNotes = core.composeCandidateNotes('הערה רגילה', [event]);
const parsedNotes = core.readCandidateNotes(encodedNotes);
assert.equal(parsedNotes.text, 'הערה רגילה');
assert.equal(parsedNotes.events[0].description, 'התקיים ראיון');

const changes = core.automaticEventsForChanges(waiting, {
  ...waiting, outcomeStatus: 'הסיר/ה מועמדות', stage: 'rejected',
  interviewedTeams: false, gotTask: false, sentToClient: false, clientApproved: false,
});
assert.equal(changes.some(e => e.type === 'withdrawal'), true);

console.log('core status and event tests: OK');

const fixture = {...withdrawn, name:'Test Candidate', jobId:'7', rejectionReason:'not enough experience', notes:'old note'};
core.setTestData({candidates:[fixture], jobs:[{id:'7', jobNumber:'7', title:'Role A',clientId:'C1',clientName:'Client A'}],candidate:fixture});
const field = (id,value) => document.getElementById(id).value = value;
field('mJob','7'); field('mEventJob','7'); field('mEventDate', new Date().toISOString().slice(0,10));
field('mEventType','phone_interview'); field('mEventOutcome','teams'); field('mEventDescription','Phone interview summary');
field('mOutcomeStatus','הסיר/ה מועמדות'); field('mStage','rejected');
document.getElementById('mEventApply').checked = true;
assert.equal(core.addCandidateEvent(), true);
assert.equal(document.getElementById('mStage').value, 'phone');
assert.equal(document.getElementById('mEventType').value, 'teams_interview');
assert.equal(core.getEditingEvents().length, 2, 'one recorded interaction and one baseline, not a fabricated future interview');
assert.equal(core.getEditingEvents()[0].clientName, 'Client A');
assert.equal(core.getEditingEvents()[0].before.stage, 'rejected');
assert.equal(core.getEditingEvents()[0].after.stage, 'phone');
assert.equal(core.reconcileCandidateProcess({stage:'phone',outcomeStatus:'נקבע ראיון'}, fixture).stage, 'phone');
field('mEventType','teams_interview'); field('mEventOutcome','send'); field('mEventDescription','Historical meeting');
document.getElementById('mEventApply').checked = false;
assert.equal(core.addCandidateEvent(), true);
assert.equal(document.getElementById('mStage').value, 'phone', 'historical event cannot overwrite current stage');
assert.equal(document.getElementById('mEventType').value, 'sent_to_client');
for (const choices of Object.values(core.EVENT_FLOW)) {
  for (const choice of choices) assert.ok(core.FLOW_OUTCOMES[choice]);
}
assert.equal(core.lifecycleState({...withdrawn,stage:'staffed'}), 'closed');
console.log('workflow branching, prior rejection, historical event and next-step tests: OK');
