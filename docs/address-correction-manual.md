# 住所校正タスク 詳細マニュアル

> 対象コード:  
> - `src/components/ShippingApp.jsx` — UI・ビジネスロジック  
> - `src/lib/ecforce-api.js` — ecforce API クライアント / AddressCorrectionService  
> - `src/lib/firestore-helpers.js` — Firestore ヘルパー  
> - `functions/index.js` — Cloud Functions（webhook・住所校正プロキシ）

---

## 全体フロー概要

```
[ecforce 新規受注 webhook]
        ↓
  Cloud Function: ecforceWebhook
        ↓ OpenAI で事前校正
  Firestore: address_corrections（7日で自動削除）

        ↓ 出荷作業時

[ユーザーが「AI校正を実行」を押す]
        ↓
  ① Firestore から事前校正結果を照合
        ↓ 住所変更なし → DB結果をそのまま利用
        ↓ 住所変更あり or DB未登録 → OpenAI で再校正
  ② 結果をUI上に表示（変更件数・スコア）
  ③ ユーザーが確認して「ecforceに反映」ボタン押下
        ↓
  ④ ecforce 3エンドポイントへ順番に書き戻し
```

---

## 1. タスク対象の絞り込み

### コード（`ecforce-api.js` L835）

```javascript
addressCorrection: (orders) => orders.filter((o) => o.is_first_order),
```

### `normalizeOrder` での `is_first_order` 判定（`ecforce-api.js` L669–675）

```javascript
export function normalizeOrder(order) {
  return {
    ...order,
    times: order.times ?? null,
    is_first_order: (order.times ?? 0) <= 1,
  };
}
```

### なぜ初回のみか

- `times` は ecforce の「定期注文の何回目か」を示すフィールド
- 住所ミスが起きやすいのは初回注文
- 2回目以降は前回出荷時に確認済みとみなすため対象外
- `times <= 1`（初回 or 単品注文）を対象とする

---

## 2. webhook による事前住所校正（バックグラウンド処理）

### トリガー条件

ecforce から POST `/api/webhook/ecforce?secret=xxx` が到達したとき。

#### フィルター（全条件を満たす受注のみ処理）

| 条件 | 理由 |
|---|---|
| `product_name` に「定期」を含む | 定期コースのみ対象 |
| `product_name` が「【」で始まる | 自社商品のフォーマット |
| `product_name` に「★」を含まない | ★はイレギュラー商品（別処理）を示すマーク |
| `times === "1"` | 定期コースの初回受注のみ |

### Cloud Function コード（`functions/index.js`）

#### シークレット認証

```javascript
const incoming = req.query.secret ?? '';
if (!incoming || incoming !== webhookSecretDef.value()) {
  return res.status(403).json({ error: 'Forbidden' });
}
```

**なぜ URL クエリパラメータか**  
ecforce のwebhook設定はカスタムHTTPヘッダーを指定できないため、URLに `?secret=xxx` を含める方式を採用。シークレットは Firebase Secrets Manager（`ECFORCE_WEBHOOK_SECRET`）に保管。

#### べき等性チェック

```javascript
const docRef = db.collection('address_corrections').doc(String(order_id));
const existing = await docRef.get();
if (existing.exists) {
  return res.json({ status: 'already_corrected', order_id });
}
```

**なぜ必要か**  
ecforce は同一受注に対して webhook を複数回送信する場合がある（ネットワークエラー時の再送など）。既に校正済みのドキュメントが存在する場合は OpenAI 呼び出しをスキップして冪等性を保つ。

#### 住所フィールドの変換

ecforce の webhook payload は独自フォーマットで届くため、内部フォーマットに変換する。

```javascript
const addr = {
  zip:        `${zip01 ?? ''}${zip02 ?? ''}`,  // 例: "080" + "0046" → "0800046"
  prefecture: prefecture_name ?? '',             // 例: "北海道"
  city:       addr01 ?? '',                      // 例: "帯広市西十六条北"
  street:     addr02 ?? '',                      // 例: "1丁目10-19"
  building:   addr03 ?? '',                      // 例: "" (任意)
};
```

| ecforce payload フィールド | 内部フィールド | 内容 |
|---|---|---|
| `zip01` + `zip02` | `zip` | 郵便番号を結合（ハイフンなし7桁） |
| `prefecture_name` | `prefecture` | 都道府県名 |
| `addr01` | `city` | 市区町村 + 町名 |
| `addr02` | `street` | 丁目-番地-号 |
| `addr03` | `building` | 建物名（任意） |

#### OpenAI 校正呼び出し（`correctAddress` 内部ヘルパー）

```javascript
const fullAddress = `${addr.zip} ${addr.prefecture}${addr.city}${addr.street} ${addr.building || ''}`.trim();

const openaiRes = await fetch('https://api.openai.com/v1/responses', {
  method: 'POST',
  headers: { Authorization: `Bearer ${openaiKey}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ prompt: { id: promptId }, input: fullAddress }),
});
```

- OpenAI の **Responses API（Stored Prompt）** を使用
- プロンプトは OpenAI 側に保存済み（`pmpt_68c23271a...`）
- 住所を1行のテキストで渡し、JSON形式の校正結果を受け取る
- レスポンスの `output_text` から JSON を抽出（コードブロック対応）

#### Firestore への保存

```javascript
const expireAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
await docRef.set({
  order_id:          String(order_id),
  order_number:      order_number ?? null,
  original_address:  addr,        // webhook受信時の住所
  corrected_address: correction,  // OpenAI の校正結果
  correction_source: 'webhook',
  corrected_at:      now,
  created_at:        now,
  expireAt,                       // TTL: 7日後に Firestore が自動削除
  status:            'pending',   // 出荷作業者が確認するまで pending
  error:             errorMsg,    // OpenAI エラーがあれば記録
});
```

- ドキュメントID = `order_id`（文字列）→ 後でUI側から素早く取得できる
- `expireAt` は Firestore TTL フィールド（`firestore.indexes.json` に登録済み）
- `status: 'pending'` は将来的な承認フローのための予約フィールド

---

## 3. 出荷作業時の住所校正（UI操作）

### トリガー

ユーザーが住所校正タスク画面で **「AI校正を実行」** ボタンを押す。

### 3-1. Firestore から事前校正結果を取得

```javascript
const orderIds = ordersList.map((o) => o.id);
const cached = await getAddressCorrections(orderIds);
```

#### `getAddressCorrections`（`firestore-helpers.js`）

```javascript
export async function getAddressCorrections(orderIds) {
  if (!isFirebaseConfigured || !orderIds?.length) return {};
  try {
    const { doc, getDoc } = await firestoreModule();
    const results = {};
    await Promise.all(
      orderIds.map(async (id) => {
        const snap = await getDoc(doc(db, 'address_corrections', String(id)));
        if (snap.exists()) results[String(id)] = snap.data();
      })
    );
    return results;
  } catch {
    return {};
  }
}
```

**なぜ `Promise.all` か**  
受注を1件ずつ直列に取得すると100件で100往復かかる。`Promise.all` で全件を並列リクエストすることで、ほぼ1往復分の時間（数百ms）で完了する。

**なぜドキュメントIDを `order_id` にしたか**  
`collection.where()` ではなく `doc(id)` の直接取得にするため。`where` はインデックスが必要で複合クエリに制限があるが、ID直接取得は制限なし・最速。

### 3-2. DBヒット判定と住所変更チェック

```javascript
ordersList.forEach((order) => {
  const hit = cached[String(order.id)];
  const addressUnchanged = hit && isSameAddress(hit.original_address, order.shipping_address);

  if (hit?.corrected_address && !hit.error && addressUnchanged) {
    // DB の校正結果をそのまま使用
    setAddressResults((prev) => ({
      ...prev,
      [order.id]: { original: order.shipping_address, correction: hit.corrected_address, applied: false },
    }));
  } else {
    // OpenAI で再校正
    uncachedOrders.push(order);
  }
});
```

**DBキャッシュが使える条件（3つすべて必要）**

| 条件 | 理由 |
|---|---|
| `hit?.corrected_address` が存在する | 校正結果が保存されている |
| `!hit.error` | OpenAI エラーで失敗していない |
| `addressUnchanged === true` | webhook受信後に顧客が住所変更していない |

#### `isSameAddress` — 住所同一性チェック

```javascript
const isSameAddress = (a, b) => {
  if (!a || !b) return false;
  const n = (s) => (s ?? '')
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)) // 全角数字→半角
    .replace(/[Ａ-Ｚａ-ｚ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)) // 全角英字→半角
    .replace(/[\s　\-－ー]/g, ''); // スペース・ハイフン類を除去

  return n(a.zip) === n(b.zip)
    && n(a.city) === n(b.city)
    && n(a.street) === n(b.street)
    && n(a.building) === n(b.building);
};
```

**比較対象**
- `a` = `hit.original_address`（webhook受信時の住所）
- `b` = `order.shipping_address`（ecforceから取得した現在の住所）

**なぜ正規化が必要か**  
同じ住所でも表記揺れで不一致になるケースがある。

| 問題 | 対処 |
|---|---|
| 郵便番号にハイフン `080-0046` vs `0800046` | ハイフン除去 |
| 全角数字 `１丁目` vs 半角 `1丁目` | 全角→半角変換 |
| スペースの有無 `西十六条 北` vs `西十六条北` | スペース除去 |

**なぜ `prefecture` は比較しないか**  
ecforceでは都道府県は通常変更されない（ドロップダウンで選択され、住所変更UIで都道府県だけ変えることは稀）。比較から外すことで false negative を減らしている。

### 3-3. OpenAI で再校正（DB未登録 or 住所変更あり）

```javascript
await addressService.correctAddresses(uncachedOrders.map((o) => o.shipping_address), {
  onProgress: ({ completed, total, index, result }) => {
    setAddressProgress({ completed, total });
    const orderId = uncachedOrders[index].id;
    setAddressResults((prev) => ({ ...prev, [orderId]: { ...result, applied: false } }));
    if (result?.correction && hasAddressChange(uncachedOrders[index], result.correction)) {
      setAddressSelection((prev) => new Set([...prev, orderId]));
    }
  },
});
```

#### `AddressCorrectionService.correctAddresses`（`ecforce-api.js` L473）

```javascript
const CONCURRENCY = 3;
for (let i = 0; i < addresses.length; i += CONCURRENCY) {
  const chunk = [];
  for (let j = i; j < Math.min(i + CONCURRENCY, addresses.length); j++) {
    chunk.push(processOne(addresses[j], j));
  }
  await Promise.all(chunk); // 3件並列
}
```

**なぜ並列数を3に制限しているか**  
- Cloud Function 側の ecforce API プロキシがレート制限（1.1秒に1リクエスト）を持つため、並列数を増やしても ecforce 側はボトルネックにならない
- OpenAI Responses API は並列数3程度が安定しており、タイムアウトリスクも低い
- 1件ずつ直列（CONCURRENCY=1）だと 100件 × 約2秒 = 約3分。3並列で約1分に短縮

#### `_correctOne` — 1件分の校正リクエスト

```javascript
async _correctOne(address) {
  const token = await this.getAuthToken(); // Firebase ID Token
  const res = await fetch('/api/address-correction', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ addresses: [address] }),
  });
  const data = await res.json();
  return data.results?.[0] ?? { original: address, error: 'No result' };
}
```

**なぜ Firebase Functions プロキシ経由か**
- OpenAI APIキーをフロントエンドに公開しないため（Secrets Manager で管理）
- CORS 問題を回避するため
- Firebase Auth トークンで認証し、認証済みユーザーのみ呼び出し可能

#### Cloud Function: `addressCorrection`（`functions/index.js`）

```javascript
await verifyAuth(req); // Firebase ID Token 検証

const config = await getApiConfig(); // Firestore から API設定取得
const openaiKey = openaiKeySecret.value(); // Secrets Manager から取得

for (const addr of addresses) {
  const correction = await correctAddress(addr, openaiKey, promptId);
  results.push({ original: addr, correction });
}
```

### 3-4. 変更検出と自動チェックボックス選択

```javascript
const hasAddressChange = (order, correction) => {
  if (!correction) return false;
  // AIが returned フラグを優先
  if (typeof correction.changed === 'boolean') return correction.changed;
  // フォールバック: 元住所と校正後住所を文字列比較
  const addr = order.shipping_address;
  const origNorm = `${addr?.prefecture || ''}${addr?.city || ''}${addr?.street || ''}${addr?.building || ''}`.replace(/[\s　]/g, '');
  const corrFull = correction.address
    || `${correction.prefecture || ''}${correction.city || ''}${[correction.town, correction.chome, correction.banchi, correction.go].filter(Boolean).join('')}${correction.building || ''}${correction.building_number || ''}`;
  return origNorm !== corrFull.replace(/[\s　]/g, '');
};
```

- OpenAI の校正結果には `changed: true/false` フラグが含まれる（ストアドプロンプトで指示済み）
- `changed` フラグが存在する場合はそれを優先使用
- ない場合は元住所と校正後住所をスペース除去して文字列比較

**変更あり → 自動的にチェックボックスをONにする**理由  
変更が必要な住所だけをデフォルト選択状態にすることで、作業者が1件ずつ選択する手間を省く。変更なしの住所はチェックが外れた状態で表示され、確認のみを促す。

### 3-5. 完了トースト

```javascript
const dbCount = ordersList.length - uncachedOrders.length;
showToast(`住所校正完了（DB: ${dbCount}件 / AI: ${uncachedOrders.length}件）`, 'success');
```

DBから取得できた件数とOpenAIに流れた件数を分けて表示する。DBヒット率が高いほどスピードが速い。

---

## 4. 校正結果の表示（UI）

### スコア（OpenAI が返す `score` フィールド）

| スコア | 意味 | 対応 |
|---|---|---|
| `OK` | 都道府県〜号・建物まで入力された配送適切な住所 | 通常通り出荷 |
| `Review` | 補完・推定が多く曖昧 | 作業者が目視確認してから反映 |
| `NG` | 市区町村以下に不備多く配送リスク高い | 顧客に確認を取ることを推奨 |

### 住所組み立て（表示用）

```javascript
const assembleAddr = (c) => {
  if (c.address) return c.address; // フル住所フィールドがあればそれを優先
  if (c.corrected_address) return c.corrected_address;
  const street = [c.town, c.chome, c.banchi, c.go].filter(Boolean).join('');
  const building = [c.building, c.building_number].filter(Boolean).join(' ');
  return `${c.prefecture || ''}${c.city || ''}${street}${building ? ' ' + building : ''}`.trim();
};
```

OpenAI の校正結果には複数のフォーマットが存在する可能性があるため（フル住所 or 個別フィールド）、優先度をつけてフォールバックする。

---

## 5. ecforce への書き戻し（一括反映）

### トリガー

ユーザーが住所変更あり受注にチェックを入れ、**「ecforceに反映」** ボタンを押す。

### 5-1. 送信フィールドの組み立て

```javascript
// ⚠️ CLAUDE.md 記載の変更禁止ルール
const addr01 = c.corrected_addr01
  || `${c.city || ''}${c.town || ''}`.trim();       // 市区町村 + 町名（都道府県は含めない）

const numPart = [c.chome, c.banchi, c.go].filter(Boolean).join('-');    // 例: "1-10-19"
const buildingPart = [c.building, c.building_number].filter(Boolean).join(' '); // 例: "ヴィラ 101"
const addr02 = c.corrected_addr02 || [numPart, buildingPart].filter(Boolean).join(' ');

const zip = c.corrected_zip || r?.zip || '';
```

| ecforce フィールド | 内容 | 例 |
|---|---|---|
| `addr01` | 市区町村 + 町名 | `帯広市西十六条北` |
| `addr02` | 丁目-番地-号 + 建物名 | `1-10-19` / `3-16 ヴィラ 101号` |
| `zip01` / `zip02` | 郵便番号を3桁+4桁に分割 | `080` / `0046` |
| `prefecture` | 送信しない（変更しない） | — |

**都道府県を送信しない理由**  
ecforce の住所更新APIで都道府県を誤って書き換えると、後続の発送処理や帳票に影響する。住所ミスの大半は番地・建物名の表記揺れであり、都道府県が変わることはほぼないため送信対象から除外。

#### `normalizeZip` — 郵便番号の分割

```javascript
const normalizeZip = (a) => {
  const zip = String(a.zip ?? '').replace(/[^0-9]/g, ''); // 数字以外除去（ハイフン等）
  if ((!a.zip01 || !a.zip02) && zip.length === 7) {
    return { ...a, zip01: zip.slice(0, 3), zip02: zip.slice(3) };
  }
  return a;
};
```

ecforce API は郵便番号を `zip01`（上3桁）と `zip02`（下4桁）に分けて受け取る。内部形式（7桁連続）から変換する。

### 5-2. 3エンドポイント順次呼び出し

```javascript
for (const input of inputs) {
  // 1) 受注: shipping_address + billing_address の両方を更新
  await requestWithRetry('ORDER_BULK_UPDATE',
    '/api/v2/admin/orders/bulk_update.json',
    {
      orders: [{
        id: input.orderId,
        billing_address_attributes:  pickAddressPayload(orderBilling),
        shipping_address_attributes: pickAddressPayload(orderShipping),
      }],
    }
  );

  // 2) 定期受注: shipping_address のみ（subsOrderId がある場合のみ）
  if (input.subsOrderId) {
    await requestWithRetry('SUBS_ORDER_BULK_UPDATE',
      '/api/v2/admin/subs_orders/bulk_update.json',
      {
        subs_orders: [{
          id: input.subsOrderId,
          shipping_address_attributes: pickAddressPayload(subsOrderShipping),
        }],
      }
    );
  }

  // 3) 顧客マスタ: billing_address のみ（エラーでも続行）
  try {
    await requestWithRetry('CUSTOMER_BULK_UPDATE_BILLING_ONLY',
      '/api/v2/admin/customers/bulk_update.json',
      {
        customers: [{
          id: input.customerId,
          billing_address_attributes: pickAddressPayload(customerBilling),
        }],
      }
    );
  } catch (e) {
    if (input.continueOnCustomerBillingError) {
      // 顧客マスタのエラーは無視して次の受注へ
      console.warn('[warn] CUSTOMER_BULK_UPDATE_BILLING_ONLY failed but continuing', e.message);
    } else {
      throw e;
    }
  }
}
```

| ステップ | エンドポイント | 更新内容 | エラー時 |
|---|---|---|---|
| 1 | `orders/bulk_update.json` | 請求先 + 配送先の両方 | 例外スロー（処理中断） |
| 2 | `subs_orders/bulk_update.json` | 配送先のみ | 例外スロー（処理中断）|
| 3 | `customers/bulk_update.json` | 請求先のみ | `continueOnCustomerBillingError: true` の場合は無視して次へ |

**ステップ3を最後にする理由**  
顧客マスタの更新は他のシステムへの影響範囲が広く、失敗しやすい（同一顧客が複数受注を持つ場合のロック競合等）。ecforce 仕様として billing_address_attributes が subs_orders/bulk_update に存在するか未確認のため、ステップ2では shipping のみ送る。

**なぜ1件ずつ直列か**  
ecforce API のレート制限（1.1秒間隔 = `MIN_INTERVAL_MS = 1300`）があるため、並列にしても待機時間が発生する。また、受注ごとに3エンドポイントを確実に完了させてから次の受注へ進む必要がある（部分的な更新によるデータ不整合を防ぐ）。

#### `requestWithRetry` — レートリミット対応リトライ

```javascript
const requestWithRetry = async (step, path, payload) => {
  let attempt = 0;
  while (true) {
    await throttle(); // 最低 1.3秒間隔を保証
    try {
      const res = await this.proxyRequest('PUT', path, payload);
      if (res?.success === false) throw new Error(...);
      return res;
    } catch (e) {
      const status = e?.status ?? e?.response?.status;
      const retryable = status === 429 || (status >= 500 && status <= 599);
      attempt++;
      if (!retryable || attempt > MAX_RETRIES) throw e; // MAX_RETRIES = 6
      const base = 1500 * Math.pow(2, attempt - 1); // 指数バックオフ
      const jitter = base * Math.random() * 0.3;    // ジッター（同時リトライを散らす）
      await sleep(base + jitter);
    }
  }
};
```

| ステータス | リトライ | 理由 |
|---|---|---|
| `429` | する（最大6回） | レートリミット超過 |
| `5xx` | する（最大6回） | サーバー一時エラー |
| `4xx`（429以外） | しない | リクエスト自体が不正（リトライしても改善しない） |

### 5-3. UI上の住所の更新

```javascript
setOrders((prev) => prev.map((o) => {
  if (!appliedIds.has(o.id)) return o;
  const c = addressResults[o.id]?.correction;
  return {
    ...o,
    shipping_address: {
      ...o.shipping_address,
      city:     newCity,    // addr01 相当
      street:   newStreet,  // addr02 相当
      building: newBuilding,
      zip:      newZip,
    },
  };
}));
```

ecforce への書き戻し成功後、フロントエンドのローカル状態（`orders`）も更新する。これにより、ページリロードなしで出荷テーブルに最新の住所が即時反映される。

---

## 6. データライフサイクル

```
受注発生（ecforce）
    ↓ webhook
Firestore: address_corrections
    ↓ created_at + 7日
Firestore TTL による自動削除
```

| フィールド | 型 | 内容 |
|---|---|---|
| `order_id` | string | ecforce 受注ID（ドキュメントIDと同じ） |
| `order_number` | string | ecforce 注文番号（表示用） |
| `original_address` | map | webhook受信時点の住所 |
| `corrected_address` | map | OpenAI の校正結果 |
| `correction_source` | string | `'webhook'`（将来拡張用） |
| `corrected_at` | timestamp | 校正実行日時 |
| `created_at` | timestamp | ドキュメント作成日時 |
| `expireAt` | timestamp | `created_at + 7日`（Firestore TTL） |
| `status` | string | `'pending'`（将来の承認フロー用） |
| `error` | string/null | OpenAI エラーメッセージ（成功時 null） |

**TTL 7日の根拠**  
受注から出荷までのリードタイムが最大でも数日のため、7日あれば確実に出荷作業が完了する。それ以降はデータ保持の必要がなく、ストレージコスト最適化のため自動削除する。

---

## 7. Firestore セキュリティルール

```
match /address_corrections/{docId} {
  allow read: if request.auth != null;   // 認証済みユーザーのみ読み取り可
  allow write: if false;                 // クライアントからの書き込み不可
}
```

**書き込みを `false` にした理由**  
`address_corrections` への書き込みは Cloud Functions（Admin SDK）のみが行う。クライアントから直接書き込めてしまうと、悪意あるユーザーが校正結果を改ざんできるため、クライアント書き込みを完全に禁止している。

---

## 8. 速度の目安

| ケース | 件数 | 所要時間（目安） |
|---|---|---|
| 全件DBヒット（住所変更なし） | 300件 | 〜1秒 |
| 全件OpenAI（DB未登録） | 300件 | 〜3分20秒（3並列 × 2秒/件） |
| DBヒット290件 + OpenAI10件 | 300件 | 〜20秒 |

webhook事前校正が機能している通常運用では、DBヒット率が高いため大幅な時間短縮が期待できる。
