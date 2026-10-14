import { safeVideoStreamUrl } from '@xhs/security';
import type { Ctx } from './context.ts';

/** Only the detail player reads this field; do not include it in discovery or AI payloads. */
export async function noteVideoStream(ctx: Ctx, id: string): Promise<string | null> {
  const row=(await ctx.db.query(`select e.video_stream_url from notes n
    join note_enrichments e on e.note_id=n.id and e.org_id=n.org_id
    where n.id=$1 and n.org_id=$2 and n.data_mode=$3
    and (n.expires_at is null or n.expires_at>now())
    and e.note_type='video' and app.can_read_note_enrichment(e.org_id,e.permission_id,e.expires_at)`,[id,ctx.orgId,ctx.mode])).rows[0];
  return safeVideoStreamUrl(row?.video_stream_url);
}
