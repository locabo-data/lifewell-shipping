/**
 * 一回限りのマイグレーション: address_corrections の既存ドキュメントに
 * expireAt (created_at + 7日) を一括セットする
 *
 * 実行方法:
 *   cd functions
 *   GOOGLE_CLOUD_PROJECT=lifewell-shippingtaskapp node migrate-expire-at.mjs
 */

import { initializeApp, cert, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT || 'lifewell-shippingtaskapp';
const TTL_DAYS = 7;

initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
const db = getFirestore();

const snap = await db.collection('address_corrections').get();

if (snap.empty) {
  console.log('ドキュメントなし。終了。');
  process.exit(0);
}

// expireAt がないドキュメントだけ対象
const targets = snap.docs.filter((d) => !d.data().expireAt);
console.log(`対象: ${targets.length} 件 / 全体: ${snap.size} 件`);

if (targets.length === 0) {
  console.log('すべて設定済み。終了。');
  process.exit(0);
}

// Firestore batch は最大500件なので分割
const CHUNK = 499;
let updated = 0;
for (let i = 0; i < targets.length; i += CHUNK) {
  const batch = db.batch();
  const chunk = targets.slice(i, i + CHUNK);
  for (const doc of chunk) {
    const data = doc.data();
    // created_at があればそれ基準、なければ現在時刻
    const base = data.created_at?.toDate?.() ?? new Date();
    const expireAt = new Date(base.getTime() + TTL_DAYS * 24 * 60 * 60 * 1000);
    batch.update(doc.ref, { expireAt });
  }
  await batch.commit();
  updated += chunk.length;
  console.log(`  ${updated} / ${targets.length} 件完了`);
}

console.log(`完了: ${updated} 件に expireAt をセットしました。`);
