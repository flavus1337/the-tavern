import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import type { KeyboardEvent } from '../packages/client/node_modules/@types/react';
import { moveTabFocus, Tabs, TabsList, TabsTrigger, TabsContent } from '../packages/client/src/components/ui/tabs';
import { clampPanel } from '../packages/client/src/lib/panel';
import { stepToken, tokenControl } from '../packages/client/src/lib/tokenControl';
import { useStore } from '../packages/client/src/store';
import type { TokenView } from '../packages/shared/src/index';

async function main() {
  let focused = '', prevented = 0;
  const list = { querySelectorAll: () => tabs };
  const nested = {};
  const tab = (name: string, owner: object = list, disabled = false) => ({
    disabled, closest: () => owner, focus: () => { focused = name; },
  });
  const first = tab('first'), second = tab('second'), third = tab('third');
  const tabs = [first, tab('nested', nested), second, tab('disabled', list, true), third];
  const press = (key: string, current = first) => moveTabFocus({ key, currentTarget: current,
    preventDefault: () => { prevented++; } } as unknown as KeyboardEvent<HTMLButtonElement>);
  press('ArrowRight'); assert.equal(focused, 'second');
  press('ArrowLeft'); assert.equal(focused, 'third');
  press('Home', third); assert.equal(focused, 'first');
  press('End', second); assert.equal(focused, 'third');
  assert.equal(press('ArrowDown'), false); assert.equal(prevented, 4);
  console.log('PASS Left/Right wrap, Home/End jump, nested and disabled tabs are excluded, vertical arrows retain scrolling.');

  const React = await import(new URL('../packages/client/node_modules/react/index.js', import.meta.url).href) as typeof import('../packages/client/node_modules/@types/react');
  const { renderToStaticMarkup } = await import(new URL('../packages/client/node_modules/react-dom/server.node.js', import.meta.url).href) as typeof import('../packages/client/node_modules/@types/react-dom/server');
  // Standalone tsx uses classic JSX; the production Vite build uses the automatic runtime.
  Object.assign(globalThis, { React });
  const el = React.createElement;
  const nestedTabs = el(Tabs, { value: 'inner', onValueChange() {}, children: [
    el(TabsList, { key: 'list', children: el(TabsTrigger, { value: 'inner', children: 'Inner' }) }),
    el(TabsContent, { key: 'panel', value: 'inner', children: 'Inner content' }),
  ] });
  const html = renderToStaticMarkup(el(Tabs, { value: 'one', onValueChange() {}, children: [
    el(TabsList, { key: 'list', children: [el(TabsTrigger, { key: 'one', value: 'one', children: 'One' }), el(TabsTrigger, { key: 'two', value: 'two', children: 'Two' })] }),
    el(TabsContent, { key: 'one', value: 'one', children: nestedTabs }),
    el(TabsContent, { key: 'two', value: 'two', children: 'Unmounted content' }),
  ] }));
  const ids = [...html.matchAll(/ id="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(ids).size, ids.length);
  for (const match of html.matchAll(/aria-(?:controls|labelledby)="([^"]+)"/g)) assert.ok(ids.includes(match[1]));
  assert.ok(html.includes('hidden=""')); assert.ok(!html.includes('Unmounted content'));
  assert.equal((html.match(/role="tabpanel"/g) ?? []).length, 3);
  console.log('PASS rendered nested tabs have unique linked tab/panel IDs and inactive target shells do not mount content.');

  const token: TokenView = { id: 'token', revision: 1, name: 'Token', shape: 'round', allegiance: 'ally', ownerUserId: 'owner',
    size: 'M', x: 101, y: 109, z: 1, imageUrl: null, fill: '#abc', hp: 10, maxHp: 10, dmOnly: false,
    sharing: { scope: 'users', userIds: ['friend'] }, conditions: [], statBlock: null };
  assert.deepEqual(tokenControl(token, 'friend', false), { mine: false, edit: false, move: true });
  assert.deepEqual(tokenControl(token, 'stranger', false), { mine: false, edit: false, move: false });
  assert.equal(tokenControl(token, 'owner', false).edit, true);
  assert.equal(tokenControl(token, 'dm', true).edit, true);
  const grid = { ...useStore.getState().grid, cell: 44, offsetX: 13, offsetY: 21, snap: true };
  assert.deepEqual(stepToken(token, grid, 1, 0), { x: 145, y: 109 });
  assert.deepEqual(stepToken(token, grid, 0, -1), { x: 101, y: 65 });
  const edge = stepToken({ ...token, x: 0, y: 0 }, grid, -1, -1);
  assert.ok(edge.x >= 0 && edge.y >= 0);
  console.log('PASS keyboard token movement uses the canvas authorization, 44px grid with offsets13/21, and board boundaries.');

  for (const bounds of [{ width: 390, height: 744 }, { width: 768, height: 320 }, { width: 940, height: 664 }, { width: 640, height: 304 }]) {
    for (const width of [380, 520, 620]) {
      const panel = { width: Math.min(width, bounds.width - 16), height: bounds.height - 16 };
      for (const initial of [{ x: -100, y: -100 }, { x: 5000, y: 9000 }]) {
        const next = clampPanel(initial, panel, bounds);
        assert.ok(next.x >= 0 && next.y >= 0);
        assert.ok(next.x + panel.width <= bounds.width && next.y + panel.height <= bounds.height);
      }
    }
  }
  console.log('PASS document/token/note dimensions clamp to board bounds at phone, tablet, desktop and 200% effective viewport sizes.');

  const css = await fs.readFile(new URL('../packages/client/src/index.css', import.meta.url), 'utf8');
  const root = css.slice(css.indexOf(':root {'));
  const color = (name: string) => root.match(new RegExp(`--${name}: (#[0-9a-f]{6});`))![1]!;
  const rgb = (hex: string) => [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16));
  const luminance = (channels: number[]) => channels.map((v) => v / 255).map((v) => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
    .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index]!, 0);
  const contrast = (a: number[], b: number[]) => { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const raised = rgb(color('raised'));
  const backgrounds = ['bg', 'surface', 'surface2', 'raised'].map((name) => rgb(color(name)));
  backgrounds.push(raised.map((channel) => channel * 0.94 + 255 * 0.06)); // translucent hover over the brightest dark surface
  for (const name of ['faint', 'low', 'mid', 'garnet']) {
    const minimum = Math.min(...backgrounds.map((background) => contrast(rgb(color(name)), background)));
    assert.ok(minimum >= 4.5, `${name} contrast ${minimum}`);
    console.log(`PASS ${name} minimum contrast ${minimum.toFixed(2)}:1, including the 6% white hover composite.`);
  }
  assert.ok(contrast(rgb(color('hi')), rgb(color('danger'))) >= 4.5);
  assert.ok(css.includes('[role="tabpanel"][hidden] { display: none; }'));
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
