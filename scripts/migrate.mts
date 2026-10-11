// 移行（db/migrations/*.sql）を手動で適用する。アプリは起動時にも自動で適用する。
import { openDbFromEnv } from '../src/db';

const db = await openDbFromEnv(); // 開くときに移行を適用する
await db.close();
console.log('移行を適用しました');
