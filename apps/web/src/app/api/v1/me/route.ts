import { publicCapabilities } from '@xhs/domain';
import { api } from '@/server/api';
import { withApiCtx } from '@/server/ctx';
import { env } from '@/server/env';

export const GET = api(async () => withApiCtx(async (ctx) => ({
  userId: ctx.uid, organizationId: ctx.orgId, role: ctx.role, capabilities: publicCapabilities(env()),
})));
