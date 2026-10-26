import {it,expect} from 'vitest';
import {SHOOTING_TEMPLATES,ShootingGuide} from '../../packages/core/src/shooting-guides.ts';
it('offers five editable XHS-only drafts with actionable cuts and bilingual captions',()=>{
 expect(SHOOTING_TEMPLATES.map(t=>t.category)).toEqual(['beauty','fashion','cafe','vlog','food']);
 for(const template of SHOOTING_TEMPLATES){const guide=ShootingGuide.parse(template);expect(guide.shots.length).toBeGreaterThanOrEqual(6);expect(new Set(guide.shots.map(s=>s.id)).size).toBe(guide.shots.length);expect(guide.shots.every(s=>s.cameraPosition&&s.action&&s.alternative&&s.subtitleKo)).toBe(true);expect(JSON.stringify(guide)).not.toMatch(/더우인|도우인|douyin/i);}
});
it('rejects duplicate cut IDs and guides without required cuts',()=>{const guide=SHOOTING_TEMPLATES[0]!;expect(ShootingGuide.safeParse({...guide,shots:[guide.shots[0],guide.shots[0]]}).success).toBe(false);expect(ShootingGuide.safeParse({...guide,shots:guide.shots.map(s=>({...s,required:false}))}).success).toBe(false);});
