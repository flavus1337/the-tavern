import assert from 'node:assert/strict';
import { campaignFromUrl, enterCampaign, handleCampaignPopState, restoreCampaign, syncCampaignUrl, writeCampaignUrl } from '../packages/client/src/lib/navigation';
import { gridOpacity } from '../packages/client/src/lib/grid';
import { useStore } from '../packages/client/src/store';
import type { CampaignListItem, PublicUser } from '../packages/shared/src/index';

const location = { href: 'http://fixture.invalid/?campaign=table_one' };
const entries = [location.href]; let position = 0;
const windowFixture = Object.assign(new EventTarget(), { location, history: {
  pushState(_state: unknown, _unused: string, url: string | URL) { entries.splice(++position); entries.push(location.href = String(url)); },
  replaceState(_state: unknown, _unused: string, url: string | URL) { entries[position] = location.href = String(url); },
  back() { if (position) { location.href = entries[--position]!; windowFixture.dispatchEvent(new Event('popstate')); } },
} });
Object.assign(globalThis, { window: windowFixture });
windowFixture.addEventListener('popstate', handleCampaignPopState);
const campaigns: CampaignListItem[] = [
  { id: 'table_one', name: 'One', description: '', role: 'dm' },
  { id: 'table_two', name: 'Two', description: '', role: 'player' },
];
const user: PublicUser = { id: 'member', username: 'Member', isAdmin: false };
const state = useStore.getState();
state.setCampaigns(campaigns);
state.setRoute('lobby'); state.setAuthChecked(false); state.setUser(user);
syncCampaignUrl(); handleCampaignPopState();
assert.equal(location.href, entries[0]); assert.equal(state.activeCampaignId, null);
state.setUnauthenticated(); state.setAuthChecked(true); state.setRoute('login'); syncCampaignUrl();
assert.equal(campaignFromUrl(location.href).id, 'table_one');
state.setUser(user); restoreCampaign(campaigns); syncCampaignUrl();
assert.equal(useStore.getState().route, 'table'); assert.equal(useStore.getState().activeCampaignId, 'table_one');
assert.equal(entries.length, 1);
console.log('PASS auth loading and signed-out login retain the requested campaign; successful member login restores it without an extra history entry.');

state.setActiveCampaignId(null); state.setRoute('login'); restoreCampaign(campaigns);
assert.equal(useStore.getState().activeCampaignId, 'table_one'); assert.equal(useStore.getState().route, 'table');
state.resetTable(); state.setActiveCampaignId(null); state.setRoute('lobby'); syncCampaignUrl();
assert.equal(new URL(location.href).searchParams.has('campaign'), false);
windowFixture.history.back(); syncCampaignUrl();
assert.equal(useStore.getState().activeCampaignId, 'table_one'); assert.equal(entries.length, 2);
enterCampaign('table_two'); assert.equal(useStore.getState().activeCampaignId, 'table_two');
windowFixture.history.back(); syncCampaignUrl(); assert.equal(useStore.getState().activeCampaignId, 'table_one');
console.log('PASS reload restores the campaign; Leave pushes lobby and browser Back returns; switching between member campaigns follows history.');

for (const id of ['unknown', 'nonmember']) {
  windowFixture.history.pushState({}, '', `http://fixture.invalid/?campaign=${id}`); restoreCampaign(campaigns);
  assert.equal(useStore.getState().route, 'lobby'); assert.equal(useStore.getState().activeCampaignId, null);
  assert.match(useStore.getState().lastErrorMessage!, /unavailable.*access/);
  assert.equal(new URL(location.href).searchParams.has('campaign'), false);
}
enterCampaign('nonmember'); assert.equal(useStore.getState().route, 'lobby');
console.log('PASS unknown/nonmember links resolve to an explained lobby escape and cannot start a table connection.');

for (const value of ['?campaign=', '?campaign=../secret', '?campaign=%2Fother', '?campaign=a&campaign=b', `?campaign=${'a'.repeat(129)}`]) {
  assert.equal(campaignFromUrl(`http://fixture.invalid/${value}`).invalid, true);
}
assert.equal(campaignFromUrl('not a URL').invalid, true);
assert.deepEqual(campaignFromUrl('http://fixture.invalid/'), { id: null, invalid: false });
windowFixture.history.replaceState({}, '', 'http://fixture.invalid/?campaign=table_one&invite=invite_1&tracking=remove#remove');
restoreCampaign(campaigns, 'table_two');
assert.equal(useStore.getState().activeCampaignId, 'table_two');
assert.equal(new URL(location.href).searchParams.get('invite'), 'invite_1');
assert.equal(new URL(location.href).searchParams.has('tracking'), false); assert.equal(new URL(location.href).hash, '');
state.clearInviteToken(); assert.equal(campaignFromUrl(location.href).id, 'table_two');
writeCampaignUrl('table_two'); assert.equal(new URL(location.href).searchParams.has('invite'), false);
console.log('PASS parsing bounds IDs and rejects malformed/duplicate paths; a confirmed invite target wins and unrelated query/hash data is removed.');

assert.equal(gridOpacity(44, 1), 1); assert.ok(gridOpacity(44, .25) < .5); assert.equal(gridOpacity(44, .05), .12);
assert.ok(gridOpacity(44, .5) > gridOpacity(44, .25));
console.log('PASS dense overview grids fade while normal tactical cells keep full contrast.');
