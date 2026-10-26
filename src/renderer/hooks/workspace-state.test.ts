import {describe,it,expect} from 'vitest';
import {mergeSnapshot} from './workspace-state';
import type {Snapshot} from '../../shared/product';
describe('workspace reconnection snapshots',()=>{
 it('ignores delayed snapshots in the same instance, replaces state after restart with lower seq',()=>{
  const current={serverInstanceId:'old',seq:90} as Snapshot;
  expect(mergeSnapshot(current,{serverInstanceId:'old',seq:2} as Snapshot)).toBe(current);
  const restarted={serverInstanceId:'new',seq:0} as Snapshot;
  expect(mergeSnapshot(current,restarted)).toBe(restarted);
 });
});
