import { expect,it } from 'vitest';
import { compareTrackingSnapshots,keywordEvidence,type TrackingSnapshot } from '@xhs/core';
const snapshot=(count:number,total:number,method='same'):TrackingSnapshot=>({capturedAt:'2026-10-20T00:00:00Z',method,evidence:{...keywordEvidence('防晒',[]),noteCount:count,sampleSize:total,authorCount:3}});
it('compares observed shares instead of raw counts, without inventing a previous observation',()=>{
 expect(compareTrackingSnapshots(undefined,snapshot(5,50)).status).toBe('waiting');
 expect(compareTrackingSnapshots(snapshot(10,50),snapshot(10,25)).changePoints).toBe(20);
 expect(compareTrackingSnapshots(snapshot(10,50),snapshot(5,50)).changePoints).toBe(-10);
});
it('rejects insufficient samples and changed collection methods',()=>{
 expect(compareTrackingSnapshots(snapshot(0,50),snapshot(5,50)).changePoints).toBeNull();
 expect(compareTrackingSnapshots(snapshot(3,9),snapshot(5,50)).status).toBe('insufficient');
 expect(compareTrackingSnapshots(snapshot(5,50,'old'),snapshot(5,50,'new')).status).toBe('method_changed');
});
