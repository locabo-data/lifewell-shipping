/**
 * ecforce API 連携レイヤー
 * - LIVEモード: Firebase Functions プロキシ経由（CORS回避）
 * - DEMOモード: モックデータで動作
 */
import { auth, isFirebaseConfigured } from './firebase';

export const DEFAULT_SINGLE_ITEM_CODES = ['EA00', 'WB00', 'SU00'];

// --- ecforce API クライアント ---
// 本番: Firebase Functions プロキシ経由（Firebase Auth トークンで認証）
// ローカル: Vite dev server ミドルウェア経由（apiConfig をリクエストに含める）
export class EcforceAPI {
  constructor(config = {}) {
    this.isDemo = config.isDemo ?? true;
    this.proxyUrl = config.proxyUrl || '/api/ecforce';
    this.apiConfig = config.apiConfig || null;
  }

  async getAuthToken() {
    if (!isFirebaseConfigured || !auth?.currentUser) return null;
    return auth.currentUser.getIdToken();
  }

  async proxyRequest(method, path, body = null, params = null, retryCount = 0) {
    const token = await this.getAuthToken();
    const requestBody = { method, path, body, params };

    // ローカル開発: Firebase Auth がない場合は apiConfig を含める
    if (!token && this.apiConfig) {
      requestBody.apiConfig = {
        ecforceBaseUrl: this.apiConfig.ecforceBaseUrl,
        ecforceToken: this.apiConfig.ecforceToken,
      };
    }

    const res = await fetch(this.proxyUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(requestBody),
    });
    const responseText = await res.text();
    console.log(`[ecforce] ${method} ${path} → ${res.status} (${responseText.length} bytes)`);

    // 429 レートリミット: 最大3回リトライ（3秒待機）
    if (res.status === 429 && retryCount < 3) {
      const wait = 3000 * (retryCount + 1);
      console.warn(`[ecforce] 429 rate limit. ${wait}ms後にリトライ (${retryCount + 1}/3)`);
      await new Promise((resolve) => setTimeout(resolve, wait));
      return this.proxyRequest(method, path, body, params, retryCount + 1);
    }

    if (!res.ok) {
      console.error(`[ecforce] Error response:`, responseText.substring(0, 500));
      throw new Error(`ecforce API error ${res.status}: ${responseText}`);
    }
    if (!responseText.trim()) {
      return { success: true, accepted: true };
    }
    try {
      return JSON.parse(responseText);
    } catch {
      if (res.ok) {
        return {
          success: true,
          accepted: true,
          nonJsonResponse: true,
          bodyPreview: responseText.substring(0, 200),
        };
      }
      console.error(`[ecforce] Invalid JSON response:`, responseText.substring(0, 500));
      throw new Error(`ecforce API: レスポンスのJSON解析に失敗しました`);
    }
  }

  // --- 受注取得 ---
  // ecforce API v2 レスポンス: { data: [...], meta: { total_count, ... }, links: {...} }
  async getOrders(params = {}) {
    if (this.isDemo) return { data: generateMockOrders(30) };
    return this.proxyRequest('GET', '/api/v2/admin/orders', null, params);
  }

  /**
   * 全受注を取得（ページネーション対応）
   * @param {Object} params - クエリパラメータ
   * @param {Function} onProgress - 進捗コールバック ({ fetched, total, page }) => void
   */
  async getAllOrders(params = {}, onProgress = null) {
    if (this.isDemo) return generateMockOrders(30);
    let page = 1;
    let allRawOrders = [];
    let allIncluded = [];
    let hasMore = true;
    while (hasMore) {
      const res = await this.getOrders({ ...params, page, per: 100 });
      // ecforce v2: data キーに受注配列
      const orders = res.data || res.orders || [];
      const included = res.included || [];
      const totalCount = res.meta?.total_count;
      allRawOrders = allRawOrders.concat(orders);
      allIncluded = allIncluded.concat(included);
      console.log(`[ecforce] getAllOrders page=${page}: ${orders.length}件取得 (累計: ${allRawOrders.length} / total: ${totalCount ?? '?'})`);

      // 進捗コールバック
      if (onProgress) {
        onProgress({ fetched: allRawOrders.length, total: totalCount || 0, page });
      }

      // ページネーション判定
      if (orders.length === 0) {
        hasMore = false;
      } else if (totalCount != null) {
        hasMore = allRawOrders.length < totalCount;
      } else {
        hasMore = orders.length > 0 && page < 200;
      }
      page++;
    }
    // JSON:API形式をフラットなオブジェクトに変換
    const denormalized = denormalizeJsonApiOrders(allRawOrders, allIncluded);
    console.log(`[ecforce] getAllOrders 完了: 合計 ${denormalized.length}件 (denormalized)`);
    return denormalized;
  }

  /**
   * 発送予定日で受注を一括取得
   * @param {string} formattedDate - YYYY-MM-DD形式の日付
   * @param {Function} onProgress - 進捗コールバック
   */
  async getOrdersByShippingDate(formattedDate, onProgress = null) {
    return this.getAllOrders({
      sort: '-updated_at,id',
      include: 'shipping_address,order_items',
      lighter: '0',
      'q[state_eq]': 'complete',
      'q[scheduled_to_be_shipped_at_gteq]': `${formattedDate} 00:00:00`,
      'q[scheduled_to_be_shipped_at_lteq]': `${formattedDate} 23:59:59`,
    }, onProgress);
  }

  // 差分チェック用: state フィルタなし（state が complete 以外に変わった受注も検出）
  async getRecheckOrders(formattedDate, onProgress = null) {
    if (this.isDemo) return generateMockOrders(30);
    return this.getAllOrders({
      sort: '-updated_at,id',
      include: 'shipping_address,order_items',
      lighter: '0',
      'q[scheduled_to_be_shipped_at_gteq]': `${formattedDate} 00:00:00`,
      'q[scheduled_to_be_shipped_at_lteq]': `${formattedDate} 23:59:59`,
    }, onProgress);
  }

  async getOrder(id) {
    if (this.isDemo) return { order: generateMockOrders(1)[0] };
    return this.proxyRequest('GET', `/api/v2/admin/orders/${id}`);
  }

  // --- 受注更新（住所校正の書き戻し等） ---
  async updateOrder(id, data) {
    if (this.isDemo) return { order: { id, ...data }, success: true };
    return this.proxyRequest('PUT', `/api/v2/admin/orders/${id}`, { order: data });
  }

  // --- 発送予定日を bulk_update で更新 ---
  // PUT /api/v2/admin/orders/bulk_update.json
  // body: { orders: [{ id, scheduled_to_be_shipped_at }] }
  async updateOrderShippingDate(orderId, dateStr) {
    if (this.isDemo) return { orders: [{ id: orderId, scheduled_to_be_shipped_at: dateStr }] };
    return this.proxyRequest('PUT', '/api/v2/admin/orders/bulk_update.json', {
      orders: [{ id: Number(orderId), scheduled_to_be_shipped_at: dateStr }],
    });
  }

  // --- 住所校正の結果をecforceに一括反映 ---
  // UpdateInput: {
  //   orderId, orderShipping, orderBilling,
  //   customerId, customerBilling,
  //   subsOrderId?, subsOrderShipping?,
  //   continueOnCustomerBillingError?
  // }
  async bulkApplyAddressCorrections(inputs, onLog = null) {
    if (this.isDemo) return { success: true };

    const MIN_INTERVAL_MS = 1300;
    const MAX_RETRIES = 6;
    let nextAllowedAt = 0;

    const log = (msg, extra) => {
      if (onLog) onLog(msg, extra);
      console.log(`[ecforce] ${msg}`, extra !== undefined ? extra : '');
    };

    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    const throttle = async () => {
      const now = Date.now();
      const wait = Math.max(0, nextAllowedAt - now);
      if (wait > 0) await sleep(wait);
      nextAllowedAt = Date.now() + MIN_INTERVAL_MS;
    };

    // zip を正規化し zip01/zip02 に分割
    const normalizeZip = (a) => {
      const zip = String(a.zip ?? '').replace(/[^0-9]/g, '');
      if ((!a.zip01 || !a.zip02) && zip.length === 7) {
        return { ...a, zip01: zip.slice(0, 3), zip02: zip.slice(3) };
      }
      return a;
    };

    // AddressInput から送信フィールドのみ抽出
    const pickAddressPayload = (a) => {
      const o = {};
      if (a.zip01) o.zip01 = a.zip01;
      if (a.zip02) o.zip02 = a.zip02;
      if (a.prefecture_id !== undefined) o.prefecture_id = a.prefecture_id;
      if (a.addr01) o.addr01 = a.addr01;
      if (a.addr02 != null) o.addr02 = a.addr02;
      if (a.addr03) o.addr03 = a.addr03;
      return o;
    };

    const requestWithRetry = async (step, path, payload) => {
      let attempt = 0;
      while (true) {
        await throttle();
        log(`[${step}] request => PUT ${path}`, payload);
        try {
          const res = await this.proxyRequest('PUT', path, payload);
          log(`[${step}] response <= 200`, res);
          if (res?.success === false) {
            throw new Error(res?.message || res?.error || `${step} に失敗しました`);
          }
          return res;
        } catch (e) {
          const status = e?.status ?? e?.response?.status;
          const body = e?.response?.data;
          log(`[${step}] ERROR <= ${status ?? 'NO_STATUS'}`, body ?? e.message);
          const retryable = status === 429 || (status >= 500 && status <= 599);
          attempt++;
          if (!retryable || attempt > MAX_RETRIES) throw e;
          const base = 1500 * Math.pow(2, attempt - 1);
          const jitter = base * Math.random() * 0.3;
          log(`[${step}] retry ${attempt}/${MAX_RETRIES} in ${Math.round(base + jitter)}ms`);
          await sleep(base + jitter);
        }
      }
    };

    // 各 input を順番に処理
    for (const input of inputs) {
      const orderShipping = normalizeZip(input.orderShipping);
      const orderBilling = normalizeZip(input.orderBilling);
      const customerBilling = normalizeZip(input.customerBilling);

      // 1) Orders: shipping + billing 両方
      await requestWithRetry(
        'ORDER_BULK_UPDATE',
        '/api/v2/admin/orders/bulk_update.json',
        {
          orders: [{
            id: input.orderId,
            billing_address_attributes: pickAddressPayload(orderBilling),
            shipping_address_attributes: pickAddressPayload(orderShipping),
          }],
        },
      );

      // 2) SubsOrders: shipping のみ（billing は仕様書に確認できないので送らない）
      if (input.subsOrderId && input.subsOrderShipping) {
        const subsOrderShipping = normalizeZip(input.subsOrderShipping);
        await requestWithRetry(
          'SUBS_ORDER_BULK_UPDATE',
          '/api/v2/admin/subs_orders/bulk_update.json',
          {
            subs_orders: [{
              id: input.subsOrderId,
              shipping_address_attributes: pickAddressPayload(subsOrderShipping),
            }],
          },
        );
      } else {
        log('[skip] SUBS_ORDER_BULK_UPDATE (no subsOrderId/subsOrderShipping)');
      }

      // 3) Customers: billing_address_attributes のみ（最後・エラー続行可）
      const customerPayload = {
        customers: [{
          id: input.customerId,
          billing_address_attributes: pickAddressPayload(customerBilling),
        }],
      };
      try {
        await requestWithRetry('CUSTOMER_BULK_UPDATE_BILLING_ONLY', '/api/v2/admin/customers/bulk_update.json', customerPayload);
      } catch (e) {
        if (input.continueOnCustomerBillingError) {
          log('[warn] CUSTOMER_BULK_UPDATE_BILLING_ONLY failed but continuing', e.message);
        } else {
          throw e;
        }
      }
    }

    return { success: true };
  }

  // --- 一括更新（汎用） ---
  async bulkUpdateOrders(data) {
    if (this.isDemo) return { success: true };
    return this.proxyRequest('PUT', '/api/v2/admin/orders/bulk_update', data);
  }


  /**
   * 過去出荷分確認: 未出荷・与信済み受注を取得
   * - state: complete
   * - payment_state: authed OR credit_exam_completed
   * - scheduled_to_be_shipped_at: 15日前〜前日(昼の部) or 今日(夕の部)
   * - shipped_at = null, tbc = false（クライアント側フィルタ）
   * @param {string} sessionType - 'daytime' | 'evening'
   * @param {string|null} sessionDate - 'YYYY-MM-DD'（nullの場合は今日）
   */
  async getPendingShipments(sessionType = 'daytime', sessionDate = null) {
    if (this.isDemo) {
      const now = new Date();
      return [
        { id: 99001, number: 'EC-0099001', email: 'demo1@example.com', payment_state: 'authed', scheduled_to_be_shipped_at: new Date(now - 5 * 864e5).toISOString().slice(0, 10), tbc: false, shipped_at: null, customer_id: 12001 },
        { id: 99002, number: 'EC-0099002', email: 'demo2@example.com', payment_state: 'credit_exam_completed', scheduled_to_be_shipped_at: new Date(now - 12 * 864e5).toISOString().slice(0, 10), tbc: false, shipped_at: null, customer_id: 12002 },
      ];
    }

    // 基準日（セッション選択日、なければ今日）
    const base = sessionDate ? new Date(sessionDate) : new Date();

    // 下限: 15日前 00:00:00
    const since = new Date(base);
    since.setDate(since.getDate() - 15);
    const sinceStr = since.toISOString().slice(0, 10) + ' 00:00:00';

    // 上限: session.date はセッションの出荷予定日（昼=当日, 夕=翌日）
    // 過去出荷分は出荷予定日より前の受注が対象なので、常に -1 日
    //   昼の部: session.date = 作業日 → until = 作業日 - 1 = 前日
    //   夕の部: session.date = 翌日  → until = 翌日 - 1  = 作業日（今日）
    const until = new Date(base);
    until.setDate(until.getDate() - 1);
    const untilStr = until.toISOString().slice(0, 10) + ' 23:59:59';

    const commonParams = {
      include: 'shipping_address',
      'q[state_eq]': 'complete',
      'q[scheduled_to_be_shipped_at_gteq]': sinceStr,
      'q[scheduled_to_be_shipped_at_lteq]': untilStr,
    };
    const [res1, res2] = await Promise.all([
      this.getAllOrders({ ...commonParams, 'q[payment_state_eq]': 'authed' }),
      this.getAllOrders({ ...commonParams, 'q[payment_state_eq]': 'credit_exam_completed' }),
    ]);
    const combined = [...res1, ...res2];
    return combined.filter((o) => !o.tbc && o.shipped_at == null);
  }

  /**
   * テスト注文キャンセル処理
   * ① 受注をキャンセル状態に
   * ② 決済void
   * ③ 定期受注をキャンセル（subsOrderId がある場合）
   */
  async cancelTestOrder(orderId, subsOrderId = null) {
    if (this.isDemo) { console.log(`[demo] cancelTestOrder orderId=${orderId}`); return { success: true }; }
    await this.proxyRequest('PUT', '/api/v2/admin/orders/bulk_update.json', {
      orders: [{ id: Number(orderId), state: 'canceled' }],
    });
    try {
      await this.proxyRequest('POST', '/api/v2/admin/orders/payment_status/bulk_update.json', {
        method: 'void',
        order_ids: [Number(orderId)],
      });
    } catch (e) {
      console.warn('[cancelTestOrder] void failed (non-fatal):', e.message);
    }
    if (subsOrderId) {
      await this.proxyRequest('PUT', '/api/v2/admin/subs_orders/bulk_update.json', {
        check_duplicate_link_numbers: 0,
        subs_orders: [{ id: Number(subsOrderId), state: 'canceled' }],
      });
    }
    return { success: true };
  }

  /**
   * 氏名修正
   * ① 受注の請求先・配送先姓名を変更
   * ② 顧客の姓名を変更
   * ③ 定期受注の配送先姓名を変更（任意）
   */
  async updateOrderName(orderId, customerId, subsOrderId, { name01, name02, kana01, kana02 }) {
    if (this.isDemo) { console.log(`[demo] updateOrderName orderId=${orderId}`); return { success: true }; }
    const nameAttrs = { name01, name02, kana01, kana02 };
    await this.proxyRequest('PUT', '/api/v2/admin/orders/bulk_update.json', {
      orders: [{
        id: Number(orderId),
        billing_address_attributes: nameAttrs,
        shipping_address_attributes: nameAttrs,
      }],
    });
    if (customerId) {
      await this.proxyRequest('PUT', `/api/v2/admin/customers/${customerId}.json`, {
        customer: {
          billing_address_attributes: nameAttrs,
          shipping_address_attributes: nameAttrs,
        },
      });
    }
    if (subsOrderId) {
      await this.proxyRequest('PUT', '/api/v2/admin/subs_orders/bulk_update.json', {
        subs_orders: [{ id: Number(subsOrderId), shipping_address_attributes: nameAttrs }],
      });
    }
    return { success: true };
  }

  /**
   * 出荷ステータス変更
   * @param {number[]} orderIds - 受注IDリスト
   * @param {string} shipmentState - 'cooolawait'（平日/COOOLa）or 'wmswait'（土日祝/コマロボ）
   */
  async registerShipping(orderIds, shipmentState = 'cooolawait') {
    if (this.isDemo) { console.log(`[demo] registerShipping`, orderIds, shipmentState); return { success: true }; }
    const orders = orderIds.map((id) => ({ id: Number(id), state: shipmentState }));
    console.log(`[registerShipping] PUT bulk_update.json body=`, JSON.stringify({ orders }, null, 2));
    return this.proxyRequest('PUT', '/api/v2/admin/orders/bulk_update.json', { orders });
  }
}

// --- OpenAI 住所校正サービス ---
// 本番: Firebase Functions プロキシ経由
// ローカル: Vite dev server ミドルウェア経由
export class AddressCorrectionService {
  constructor(config = {}) {
    this.isDemo = config.isDemo ?? true;
    this.proxyUrl = config.proxyUrl || '/api/address-correction';
    this.apiConfig = config.apiConfig || null;
    this.demoToken = config.demoToken || null; // イベントデモ用トークン
  }

  async getAuthToken() {
    if (!isFirebaseConfigured || !auth?.currentUser) return null;
    return auth.currentUser.getIdToken();
  }

  // 1件分のリクエストを送る内部メソッド
  async _correctOne(address) {
    const requestBody = { addresses: [address] };

    // 認証ヘッダーを決定
    let authHeaders = {};
    if (this.demoToken) {
      // イベントデモ: X-Demo-Token ヘッダーで認証（Firebase Auth 不要）
      authHeaders = { 'X-Demo-Token': this.demoToken };
    } else {
      const token = await this.getAuthToken();
      if (token) {
        authHeaders = { Authorization: `Bearer ${token}` };
      } else if (this.apiConfig) {
        requestBody.apiConfig = {
          openaiKey: this.apiConfig.openaiKey,
          openaiPromptId: this.apiConfig.openaiPromptId,
        };
      }
    }

    const res = await fetch(this.proxyUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders },
      body: JSON.stringify(requestBody),
    });
    if (!res.ok) throw new Error(`住所校正エラー: ${res.status}`);
    const data = await res.json();
    return data.results?.[0] ?? { original: address, error: 'No result' };
  }

  // 並列処理 (CONCURRENCY=3) + リアルタイム進捗コールバック
  async correctAddresses(addresses, { onProgress } = {}) {
    if (this.isDemo) {
      return addresses.map((addr) => ({
        original: addr,
        correction: generateMockCorrection(addr),
      }));
    }
    const CONCURRENCY = 3;
    const results = new Array(addresses.length).fill(null);
    let completed = 0;

    const processOne = async (addr, idx) => {
      try {
        results[idx] = await this._correctOne(addr);
      } catch (err) {
        results[idx] = { original: addr, error: err.message };
      }
      completed++;
      onProgress?.({ completed, total: addresses.length, index: idx, result: results[idx] });
    };

    for (let i = 0; i < addresses.length; i += CONCURRENCY) {
      const chunk = [];
      for (let j = i; j < Math.min(i + CONCURRENCY, addresses.length); j++) {
        chunk.push(processOne(addresses[j], j));
      }
      await Promise.all(chunk);
    }
    return results;
  }

  async correctSingleAddress(address) {
    const results = await this.correctAddresses([address]);
    return results[0];
  }
}

function generateMockCorrection(addr) {
  const rand = Math.random();
  if (rand < 0.3) {
    return {
      corrected_zip: addr.zip,
      corrected_prefecture: addr.prefecture,
      corrected_city: addr.city,
      corrected_street: addr.street?.replace(/ー/g, '-') || addr.street,
      corrected_building: addr.building,
      changed: true,
      notes: '番地のハイフンを統一しました',
    };
  }
  return {
    corrected_zip: addr.zip,
    corrected_prefecture: addr.prefecture,
    corrected_city: addr.city,
    corrected_street: addr.street,
    corrected_building: addr.building,
    changed: false,
    notes: '変更なし',
  };
}

// --- 受注データ処理ユーティリティ ---

// =============================================================================
// ⚠️ 絶対変更禁止: ecforce 住所フィールドマッピング定義
//
// ecforce API フィールド  ←→  内部 shipping_address フィールド
//   prefecture_name       →   prefecture  (都道府県)
//   addr01                →   city        (市区町村 + 町名、都道府県を含まない)
//   addr02                →   street      (丁目-番地-号 + 建物名 + 部屋番号)
//   addr03                →   building    (建物名補足)
//   full_zip / zip01+zip02→   zip         (郵便番号)
//
// ecforce への住所更新時のフィールド組み立てルール (CLAUDE.md も参照)
//   addr01 = city + town                    ← 都道府県は含めない
//   addr02 = chome-banchi-go + building + building_number
//   都道府県は更新しない (prefecture_id は原則送信しない)
// =============================================================================

/**
 * JSON:API形式のレスポンスをフラットなオブジェクトに変換
 * - data[].attributes をトップレベルに展開
 * - included から shipping_address, order_items を解決してネスト
 * - ecforce固有のフィールド名を統一名にマッピング
 */
export function denormalizeJsonApiOrders(rawOrders, included = []) {
  // included リソースのルックアップマップ作成
  // ecforce API は relationship の type 名（複数形: order_items）と
  // included リソースの type 名（単数形: order_item）が一致しない場合があるため
  // 単数形↔複数形の両方のキーでアクセスできるようエイリアスを追加する
  const includedMap = {};
  included.forEach((item) => {
    const key = `${item.type}:${item.id}`;
    includedMap[key] = item;
    // 単数 → 複数 (例: order_item → order_items)
    // 複数 → 単数 (例: order_items → order_item)
    const altKey = item.type.endsWith('s')
      ? `${item.type.slice(0, -1)}:${item.id}`
      : `${item.type}s:${item.id}`;
    includedMap[altKey] = item;
  });

  return rawOrders.map((order) => {
    const attrs = order.attributes || {};

    // --- shipping_address を解決 ---
    const shippingRef = order.relationships?.shipping_address?.data;
    let shipping_address = null;
    if (shippingRef) {
      const addrResource = includedMap[`${shippingRef.type}:${shippingRef.id}`];
      if (addrResource) {
        const a = addrResource.attributes;
        shipping_address = {
          family_name: a.name01 || '',
          given_name: a.name02 || '',
          kana01: a.kana01 || '',
          kana02: a.kana02 || '',
          zip: a.full_zip || `${a.zip01 || ''}${a.zip02 || ''}`,
          prefecture: a.prefecture_name || '',
          city: a.addr01 || '',
          street: a.addr02 || '',
          building: a.addr03 || '',
          full_name: a.full_name || '',
          full_address: a.full_address || '',
        };
      }
    }

    // --- order_items を解決 ---
    const itemRefs =
      order.relationships?.order_items?.data ||
      order.relationships?.line_items?.data ||
      order.relationships?.items?.data ||
      [];

    const line_items = itemRefs
      .map((ref) => {
        // ecforce API は relationship の type にハイフン(order-item)を使うが
        // included リソースの type はアンダースコア(order_item)の場合がある
        // ハイフン↔アンダースコアの両方で検索する
        const typeNorm = ref.type.replace(/-/g, '_');
        const typeHyph = ref.type.replace(/_/g, '-');
        const itemResource =
          includedMap[`${ref.type}:${ref.id}`] ||
          includedMap[`${typeNorm}:${ref.id}`] ||
          includedMap[`${typeHyph}:${ref.id}`] ||
          includedMap[`${typeNorm}s:${ref.id}`] ||
          includedMap[`${typeNorm.replace(/s$/, '')}:${ref.id}`];
        if (!itemResource) return null;
        const ia = itemResource.attributes;
        return {
          // ecforce API のフィールド名はバージョンによって異なる可能性があるため複数候補を試す
          product_code: ia.product_number || ia.product_code || ia.item_code || ia.variant_sku || ia.sku || ia.code || '',
          name: ia.product_name || ia.name || '',
          quantity: ia.quantity,
        };
      })
      .filter(Boolean);

    return {
      id: order.id,
      ...attrs,
      // purchase_url は ecforce では url フィールド
      purchase_url: attrs.url || '',
      // 解決済みリレーション
      shipping_address,
      line_items,
    };
  });
}

/**
 * 要対応受注（tbc: true）を除外
 * ecforce の tbc: true は「要対応受注」を意味する（ブラックリスト等）
 * tbc: false の受注のみ通常フローで処理する
 */
export function filterTbcFalse(orders) {
  const before = orders.length;
  const filtered = orders.filter((o) => !o.tbc);
  const excluded = before - filtered.length;
  if (excluded > 0) {
    const detail = orders
      .filter((o) => o.tbc)
      .map((o) => `#${o.id}${o.tbc_order_reasons ? `(${o.tbc_order_reasons})` : ''}`)
      .join(', ');
    console.log(`[ecforce] filterTbcFalse: ${before}件 → ${filtered.length}件 (要対応受注${excluded}件除外: ${detail})`);
  } else {
    console.log(`[ecforce] filterTbcFalse: ${before}件 → ${filtered.length}件 (要対応受注なし)`);
  }
  return filtered;
}

/**
 * 受注データを正規化し、times（注文回数）を抽出
 * denormalize済みデータを前提（attributesはトップレベル）
 */
export function normalizeOrder(order) {
  return {
    ...order,
    times: order.times ?? null,
    is_first_order: (order.times ?? 0) <= 1,
  };
}

/**
 * イレギュラーSKU判定・グループ分け
 * @param {Array} orders - 受注一覧
 * @param {Object} irregularMap - { sku: targetSessionType } マッピング
 * @param {string} targetState - 現在のセッション種別 ('daytime' | 'evening')
 * @returns {{ normalOrders: Array, irregularGroups: Object }}
 */
export function classifyByIrregular(orders, irregularMap = {}, targetState = 'daytime') {
  const normalOrders = [];
  const irregularGroups = {};

  for (const order of orders) {
    const items = order.line_items || [];
    const skus = items.map((item) => item.product_code || '').filter(Boolean);
    let irregularState = null;

    for (const sku of skus) {
      if (irregularMap[sku]) {
        irregularState = irregularMap[sku];
        break;
      }
    }

    if (irregularState && irregularState !== targetState) {
      if (!irregularGroups[irregularState]) {
        irregularGroups[irregularState] = [];
      }
      irregularGroups[irregularState].push(order);
    } else {
      normalOrders.push(order);
    }
  }

  const irregularTotal = Object.values(irregularGroups).reduce((sum, arr) => sum + arr.length, 0);
  console.log(`[ecforce] classifyByIrregular: ${orders.length}件 → 通常${normalOrders.length}件 + イレギュラー${irregularTotal}件`);
  return { normalOrders, irregularGroups };
}

// --- 氏名異常判定ロジック ---

/**
 * 氏名の異常判定（テスト注文・入力ミス検出）
 * name01/name02 優先、full_name フォールバック
 * @returns {{ abnormal: boolean, reasons: string[] }}
 */
export function judgePersonName({ name01, name02, full_name } = {}) {
  const reasons = [];

  // ---- helpers ----
  const normalize = (s) => {
    let x = String(s ?? '');
    try { x = x.normalize('NFKC'); } catch { /* noop */ }
    x = x.replace(/\u00A0/g, ' ');
    x = x.replace(/[\u200B-\u200D\uFEFF]/g, '');
    x = x.trim().replace(/\s+/g, ' ');
    return x;
  };

  const TEST_WORDS = [
    'テスト', 'ﾃｽﾄ', 'test', 'dummy', 'ダミー', 'xxx', 'xxxx',
    'sample', 'サンプル', '会社', '。', '、', 'ok', 'ng', ',',
  ];

  const hasEmojiOrSurrogate = (s) => /[^\u0000-\uD7FF\uE000-\uFFFF]/.test(s);
  const isOnlySymbols = (s) => /^[\p{P}\p{S}\s]+$/u.test(s);
  const isOnlyDigits = (s) => /^\d+$/.test(s);
  const tooManyInvalidChars = (s) => {
    const rest = s.replace(/[ぁ-んァ-ン一-龥々〆ヵヶA-Za-z・\s\u30FC\uFF0D\-．.ー]/g, '');
    return rest.length >= 2;
  };
  const hasRepeatChar = (s) => /(.)\1{4,}/u.test(s);
  const tooManySpaces = (s) => ((s.match(/\s/g) || []).length >= 3);
  const edgeSymbol = (s) => (/^[-._・]/.test(s) || /[-._・]$/.test(s));
  const containsTestWord = (s) => {
    const lower = s.toLowerCase();
    return TEST_WORDS.some((w) => lower.includes(String(w).toLowerCase()));
  };
  const hasKanji = (s) => /[一-龥々〆ヵヶ]/.test(s);
  const hasHira = (s) => /[ぁ-んゕゖゔ]/u.test(s);
  const mixedKanjiHira = (s) => hasKanji(s) && hasHira(s);
  const kanjiTailShortHira = (s) => /[一-龥々〆ヵヶ]+[ぁ-んゕゖゔ]{1,2}$/u.test(s);
  const tokenKanjiTrailingHira = (token) => hasKanji(token) && /[ぁ-んゕゖゔ]{1,3}$/u.test(token);

  // ---- normalize inputs ----
  const n01 = normalize(name01);
  const n02 = normalize(name02);
  const fn = normalize(full_name);
  const useSplit = (n01 || n02) && !(n01 === '' && n02 === '');

  // ---- common checks ----
  const commonChecks = (label, s, { minLen, maxLen } = {}) => {
    if (!s) { reasons.push(`${label}_EMPTY`); return; }
    if (typeof minLen === 'number' && s.length < minLen) reasons.push(`${label}_TOO_SHORT`);
    if (typeof maxLen === 'number' && s.length > maxLen) reasons.push(`${label}_TOO_LONG`);
    if (containsTestWord(s)) reasons.push(`${label}_TEST_WORD`);
    if (hasEmojiOrSurrogate(s)) reasons.push(`${label}_EMOJI`);
    if (isOnlySymbols(s)) reasons.push(`${label}_ONLY_SYMBOLS`);
    if (isOnlyDigits(s)) reasons.push(`${label}_ONLY_DIGITS`);
    if (tooManyInvalidChars(s)) reasons.push(`${label}_TOO_MANY_INVALID_CHARS`);
    if (hasRepeatChar(s)) reasons.push(`${label}_REPEAT_CHAR`);
    if (tooManySpaces(s)) reasons.push(`${label}_TOO_MANY_SPACES`);
    if (edgeSymbol(s)) reasons.push(`${label}_EDGE_SYMBOL`);
  };

  if (useSplit) {
    commonChecks('NAME01', n01, { minLen: 1, maxLen: 50 });
    commonChecks('NAME02', n02, { minLen: 1, maxLen: 50 });
    if (!!n01 !== !!n02) reasons.push('SPLIT_MISSING_PART');
    const full = normalize(`${n01} ${n02}`.trim());
    if (full.length < 2) reasons.push('FULL_TOO_SHORT');
    if (n01 && mixedKanjiHira(n01)) reasons.push('NAME01_MIXED_KANJI_HIRA');
    if (n01 && kanjiTailShortHira(n01)) reasons.push('NAME01_KANJI_TAIL_HIRA_SHORT');
    if (n02 && kanjiTailShortHira(n02)) reasons.push('NAME02_KANJI_TAIL_HIRA_SHORT');
    if (fn && containsTestWord(fn)) reasons.push('FULL_NAME_TEST_WORD');
    // ひらがなのみで5文字以上 → 誤入力（例: よしあけきら）
    const isOnlyHira = (s) => s.length > 0 && /^[ぁ-んゕゖゔ]+$/.test(s);
    if (n01 && isOnlyHira(n01) && n01.length >= 5) reasons.push('NAME01_HIRA_ONLY_TOO_LONG');
    if (n02 && isOnlyHira(n02) && n02.length >= 5) reasons.push('NAME02_HIRA_ONLY_TOO_LONG');
  } else {
    commonChecks('FULL_NAME', fn, { minLen: 2, maxLen: 50 });
    const hasSeparator = /[\s・]/.test(fn);
    if (fn && hasSeparator) {
      const tokens = fn.split(/[\s・]+/).filter(Boolean);
      const lastToken = tokens[tokens.length - 1] || '';
      if (lastToken && tokenKanjiTrailingHira(lastToken)) reasons.push('FULL_LAST_TOKEN_KANJI_TRAILING_HIRA');
      for (const t of tokens) {
        if (mixedKanjiHira(t)) {
          reasons.push('FULL_TOKEN_MIXED_KANJI_HIRA');
          if (kanjiTailShortHira(t)) reasons.push('FULL_TOKEN_KANJI_TAIL_HIRA_SHORT');
          break;
        }
      }
    }
  }

  return { abnormal: reasons.length > 0, reasons };
}

/**
 * 購入URLに "defo" または "test" が含まれるか判定
 */
function hasDefoOrTest(url) {
  const u = String(url || '').toLowerCase();
  return u.includes('defo') || u.includes('test');
}

// --- 9つのタスクプロセッサ ---
// セッション開始時に tbc=false フィルタ済みの受注配列を受け取る前提

/** 決済エラー状態一覧 */
const PAYMENT_ERROR_STATES = [
  'registration_failed', 'sales_failed', 'credit_exam_processing',
  'credit_exam_hold', 'credit_exam_failed', 'shipment_report_failed',
  'void_failed', 'update_failed', 'failed', 'auth_failed',
];

export const TaskProcessors = {
  /** タスク1: 住所校正 — 新規注文（初回 is_first_order=true）のみ対象 */
  addressCorrection: (orders) => orders.filter((o) => o.is_first_order),

  /** タスク2: 決済エラー確認 — payment_state がエラー系の受注 */
  paymentError: (orders) =>
    orders.filter((o) => PAYMENT_ERROR_STATES.includes(o.payment_state)),

  /** タスク3: NP別送確認 — payment_method_id が NP後払い（57, 24, 61）の受注 */
  npPayment: (orders) =>
    orders.filter((o) => [57, 24, 61].includes(Number(o.payment_method_id))),

  /** タスク4: 過去出荷分確認 — APIで別途取得するためセッション受注は使わない */
  pendingShipment: (_orders) => [],

  /** タスク5: テスト注文・氏名不備 — judgePersonName で異常検出 + O-PLUX振り仮名誤りも含む */
  nameAnomaly: (orders) =>
    orders.filter((o) => {
      if (!o.is_first_order) return false; // 新規受注のみチェック
      const addr = o.shipping_address;
      if (!addr) return false;
      // ① judgePersonName で氏名異常検出
      const result = judgePersonName({
        name01: addr.family_name,
        name02: addr.given_name,
        full_name: addr.full_name,
      });
      if (result.abnormal) return true;
      // ② O-PLUX審査詳細にフリガナ関連キーワードが含まれる場合も対象
      const desc = String(o.o_plux_description || '');
      return /振り仮名|フリガナ|ふりがな|カナ不一致|カナ相違|kana/i.test(desc);
    }),

  /** タスク6: 購入URL確認 — URL に "defo" or "test" を含む初回受注(times=1) */
  purchaseUrl: (orders) =>
    orders.filter((o) => {
      if (Number(o.times) !== 1) return false;
      // attrs.url (= purchase_url にマッピング済み) をチェック
      if (hasDefoOrTest(o.purchase_url)) return true;
      if (hasDefoOrTest(o.url)) return true;
      return false;
    }),

  /** タスク7: O-PLUX審査確認 — o_plux_result が REVIEW / OK（OK は理由ありのみ）の初回受注(times=1) */
  oplux: (orders) =>
    orders.filter((o) => {
      if (Number(o.times) !== 1) return false;
      const result = String(o.o_plux_result || '').toUpperCase();
      if (result === 'REVIEW') return true;
      // OK かつ審査詳細（o_plux_description）がある場合のみ表示
      if (result === 'OK') return !!(o.o_plux_description);
      return false;
    }),

  /** タスク8: 重複注文確認 — 同一氏名 or 同一住所 の受注グループ */
  duplicate: (orders) => {
    // 氏名の正規化（全角→半角、スペース除去、小文字化）
    const normalizeName = (s) =>
      (s || '').normalize('NFKC').replace(/\s+/g, '').toLowerCase();
    // 住所の正規化（全角→半角、スペース除去、各種ハイフン統一）
    const normalizeAddr = (addr) => {
      const raw = addr?.full_address
        || `${addr?.prefecture || ''}${addr?.city || ''}${addr?.street || ''}`;
      return raw.normalize('NFKC').replace(/\s+/g, '').replace(/[ー－─—―]/g, '-').toLowerCase();
    };

    const nameMap = {};
    const addrMap = {};

    orders.forEach((o) => {
      const addr = o.shipping_address;
      const nameKey = normalizeName(`${addr?.family_name || ''}${addr?.given_name || ''}`);
      const addrKey = normalizeAddr(addr);

      if (nameKey) {
        if (!nameMap[nameKey]) nameMap[nameKey] = [];
        nameMap[nameKey].push(o);
      }
      if (addrKey) {
        if (!addrMap[addrKey]) addrMap[addrKey] = [];
        addrMap[addrKey].push(o);
      }
    });

    // 各受注にグループキーをアノテート（addr優先）
    const orderGroupKey = {};

    Object.entries(addrMap).forEach(([addrKey, group]) => {
      if (group.length > 1) {
        group.forEach((o) => {
          orderGroupKey[o.id] = { key: `addr:${addrKey}`, reason: 'addr' };
        });
      }
    });
    Object.entries(nameMap).forEach(([nameKey, group]) => {
      if (group.length > 1) {
        group.forEach((o) => {
          if (!orderGroupKey[o.id]) {
            orderGroupKey[o.id] = { key: `name:${nameKey}`, reason: 'name' };
          }
        });
      }
    });

    return orders
      .filter((o) => orderGroupKey[o.id])
      .map((o) => ({ ...o, _dupGroupKey: orderGroupKey[o.id].key, _dupReason: orderGroupKey[o.id].reason }));
  },

  /** タスク9: 単品注文確認 — 特定商品コードを含む受注 */
  singleItem: (orders, targetCodes = []) => {
    const codeSet = new Set(
      targetCodes.length > 0
        ? targetCodes.map((c) => (typeof c === 'object' ? c.code : String(c)).trim()).filter(Boolean)
        : DEFAULT_SINGLE_ITEM_CODES,
    );
    return orders.filter((o) => {
      const items = o.line_items || [];
      return items.some((item) => codeSet.has(item.product_code));
    });
  },
};

/**
 * モックデータ (DEMOモード用)
 */
export function generateMockOrders(count = 30) {
  const prefectures = ['東京都', '大阪府', '神奈川県', '愛知県', '福岡県', '北海道', '埼玉県', '千葉県'];
  const familyNames = ['田中', '鈴木', '佐藤', '高橋', '渡辺', '伊藤', '山本', '中村', 'テスト'];
  const givenNames = ['太郎', '花子', '一郎', '美咲', '健太', '優子', '大輔', '真由'];
  const paymentMethods = ['クレジットカード', 'NP後払い', '代金引換', 'Amazon Pay'];
  const paymentStates = ['paid', 'paid', 'paid', 'paid', 'paid', 'failed', 'error', 'pending'];
  const opluxResults = ['ok', 'ok', 'ok', 'ok', 'review', 'ng', null, 'ok', 'ok'];
  const cities = ['渋谷区', '新宿区', '中央区', '北区', '港区', '品川区', '目黒区', '世田谷区'];

  // 重複テスト用
  const dupFamily = familyNames[Math.floor(Math.random() * 5)];
  const dupGiven = givenNames[Math.floor(Math.random() * 5)];
  const dupZip = `${100 + Math.floor(Math.random() * 900)}-${1000 + Math.floor(Math.random() * 9000)}`;

  return Array.from({ length: count }, (_, i) => {
    const isDup = i === 2 || i === 3;
    const familyName = isDup ? dupFamily : familyNames[Math.floor(Math.random() * familyNames.length)];
    const givenName = isDup ? dupGiven : givenNames[Math.floor(Math.random() * givenNames.length)];
    const zip = isDup ? dupZip : `${100 + Math.floor(Math.random() * 900)}-${1000 + Math.floor(Math.random() * 9000)}`;

    return {
      id: 100001 + i,
      number: `EC-${String(100001 + i).padStart(7, '0')}`,
      state: i % 15 === 0 ? 'payment_pending' : 'complete',
      payment_state: paymentStates[Math.floor(Math.random() * paymentStates.length)],
      shipment_state: i % 10 === 0 ? 'pending' : 'ready',
      payment_method_name: paymentMethods[Math.floor(Math.random() * paymentMethods.length)],
      o_plux_result: opluxResults[Math.floor(Math.random() * opluxResults.length)],
      purchase_url: i % 12 === 0 ? '' : `https://lifewell.jp/p/${1000 + i}`,
      completed_at: new Date(Date.now() - Math.random() * 86400000 * 7).toISOString(),
      is_first_order: i % 4 === 0,
      shipping_address: {
        family_name: familyName,
        given_name: givenName,
        zip,
        prefecture: prefectures[Math.floor(Math.random() * prefectures.length)],
        city: cities[Math.floor(Math.random() * cities.length)],
        street: `${Math.floor(Math.random() * 10) + 1}-${Math.floor(Math.random() * 30) + 1}-${Math.floor(Math.random() * 20) + 1}`,
        building: i % 5 === 0 ? `テストマンション${Math.floor(Math.random() * 300) + 100}号` : '',
      },
      line_items: Array.from(
        { length: i % 8 === 0 ? 1 : Math.floor(Math.random() * 3) + 1 },
        (_, j) => ({
          product_code: `LW-${String(j + 1).padStart(4, '0')}`,
          name: `Lifewell サプリメント ${j + 1}`,
          quantity: Math.floor(Math.random() * 3) + 1,
          price: (Math.floor(Math.random() * 50) + 10) * 100,
        })
      ),
    };
  });
}
