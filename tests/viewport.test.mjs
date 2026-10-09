import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { installViewportPages } from '../src/core/viewport-pages.js';

test('viewport pages keep all form values and restore the selected page without cloning controls',()=>{
  const dom=new JSDOM('<div id="screen"><form class="edbody"><section class="pnl"><input name="a" value="uno"></section><section class="pnl"><input name="b" value="dos"></section><section class="pnl"><input name="c" value="tres"></section></form></div>');
  globalThis.document=dom.window.document;const doc=dom.window.document,region=doc.querySelector('.edbody'),memory=new Map();
  Object.defineProperty(dom.window.HTMLElement.prototype,'clientHeight',{get(){return this.classList.contains('viewport-stage')?380:500}});
  Object.defineProperty(dom.window.HTMLElement.prototype,'scrollHeight',{get(){return 300}});
  dom.window.HTMLElement.prototype.getBoundingClientRect=function(){return {height:this.classList.contains('pnl')?260:0}};
  installViewportPages(doc.querySelector('#screen'),{key:'parte',remember:memory});
  const sections=[...doc.querySelectorAll('.pnl')];assert.equal(sections.length,3);assert.equal(sections[0].hidden,false);assert.equal(sections[1].hidden,true);
  const nav=doc.querySelector('[aria-label="Páginas de esta sección"]');nav.lastElementChild.click();assert.equal(sections[1].hidden,false);assert.equal(sections[0].hidden,true);assert.equal(memory.get('parte:0'),1);
  assert.deepEqual(Object.fromEntries(new dom.window.FormData(region)),{a:'uno',b:'dos',c:'tres'});assert.equal(doc.querySelectorAll('[name="a"]').length,1);dom.window.close();
});
