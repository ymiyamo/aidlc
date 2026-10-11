import { handle } from '@/api/router';
import { getDeps } from '@/server/deps';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function route(req: Request): Promise<Response> {
  return handle(req, await getDeps());
}

export { route as GET, route as POST, route as PUT, route as DELETE };
