import { describe, it, expect } from 'vitest';
import { createJobTracker } from '../../docs/progress-modal.js';

// build 405: slot bookkeeping of the central progress modal
const make=()=>{let t=0;const tr=createJobTracker({now:()=>t,delay:400,escapeMs:10000});return{tr,at:v=>{t=v}}};

describe('progress modal tracker', () => {
 it('a job that ends within the delay is never shown', () => {
  const {tr,at}=make();tr.set('three',true,{label:'3D'});at(399);expect(tr.view().visible).toBe(false);
  tr.set('three',false);at(500);expect(tr.view().visible).toBe(false);expect(tr.anyActive()).toBe(false);
 });
 it('shown after the delay with label, detail and bar', () => {
  const {tr,at}=make();tr.set('load',true,{label:'Loading',counted:true});at(400);
  tr.progress(null,3,12,'3 / 12');const v=tr.view();
  expect(v.visible).toBe(true);expect(v.label).toBe('Loading');expect(v.detail).toBe('3 / 12');expect(v.frac).toBeCloseTo(0.25);
 });
 it('counted slots pair nested calls; an unpaired false is ignored', () => {
  const {tr}=make();tr.set('load',false,{counted:true});expect(tr.anyActive()).toBe(false);
  tr.set('load',true,{counted:true});tr.set('load',true,{counted:true});tr.set('load',false,{counted:true});expect(tr.anyActive()).toBe(true);
  tr.set('load',false,{counted:true});expect(tr.anyActive()).toBe(false);
 });
 it('last-wins slots: repeated true updates the label, one false ends it', () => {
  const {tr,at}=make();tr.set('three',true,{label:'a'});tr.set('three',true,{label:'b 1 / 3'});at(500);expect(tr.view().label).toBe('b 1 / 3');
  tr.set('three',false);tr.set('three',false);expect(tr.anyActive()).toBe(false);
 });
 it('two sources: the one started last is shown, the other comes back when it ends', () => {
  const {tr,at}=make();tr.set('load',true,{label:'L',counted:true});at(100);tr.set('three',true,{label:'T'});at(600);
  expect(tr.view().label).toBe('T');tr.set('three',false);
  const v=tr.view();expect(v.visible).toBe(true);expect(v.label).toBe('L');
 });
 it('progress for a named slot that is not running does nothing', () => {
  const {tr,at}=make();tr.progress('processing',1,2,'x');tr.set('processing',true,{label:'P',counted:true});at(500);expect(tr.view().detail).toBe('');
 });
 it('cancel: the button runs the cancel path once', () => {
  const {tr,at}=make();let n=0;tr.set('three',true,{label:'T',cancel:()=>{n++}});at(500);
  expect(tr.view().button).toEqual({kind:'cancel',disabled:false});tr.press();tr.press();expect(n).toBe(1);expect(tr.view().button.disabled).toBe(true);
 });
 it('without a cancel path a close button appears after the escape time and hides only this run', () => {
  const {tr,at}=make();tr.set('vr',true,{label:'VR'});at(9999);expect(tr.view().button).toBe(null);tr.press();expect(tr.view().visible).toBe(true);
  at(10000);expect(tr.view().button.kind).toBe('close');tr.press();expect(tr.view().visible).toBe(false);expect(tr.anyActive()).toBe(true);
  tr.set('vr',false);at(20000);tr.set('vr',true,{label:'VR'});at(20400);expect(tr.view().visible).toBe(true);
 });
 it('a 中断 that does not end the job turns into close after the grace and escape times', () => {
  const {tr,at}=make();tr.set('three',true,{label:'T',cancel:()=>{}});at(1000);tr.press();expect(tr.view().button).toEqual({kind:'cancel',disabled:true});
  at(3999);expect(tr.view().button.kind).toBe('cancel');at(10000);expect(tr.view().button.kind).toBe('close');tr.press();expect(tr.view().visible).toBe(false);
 });
});
