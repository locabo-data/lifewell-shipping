/**
 * Firebase Functions: ecforce API プロキシ
 * - CORS問題を回避
 * - APIトークンをサーバーサイドで管理
 * - レート制限 (1 req/sec) を制御
 */
import { onRequest } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

const ecforceTokenSecret  = defineSecret('ECFORCE_API_TOKEN');
const openaiKeySecret     = defineSecret('OPENAI_API_KEY');
const webhookSecretDef    = defineSecret('ECFORCE_WEBHOOK_SECRET');

initializeApp();
const db = getFirestore();

// レート制限用
let lastRequestTime = 0;
const RATE_LIMIT_MS = 1100;

async function rateLimitedFetch(url, options) {
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  if (elapsed < RATE_LIMIT_MS) {
    await new Promise((r) => setTimeout(r, RATE_LIMIT_MS - elapsed));
  }
  lastRequestTime = Date.now();
  return fetch(url, options);
}

// Firebase Auth トークン検証
async function verifyAuth(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    throw new Error('Unauthorized');
  }
  const idToken = authHeader.split('Bearer ')[1];
  return getAuth().verifyIdToken(idToken);
}

// Firestore から API設定を取得
async function getApiConfig() {
  const doc = await db.collection('app_settings').doc('api_config').get();
  if (!doc.exists) throw new Error('API config not found');
  return doc.data();
}

/**
 * ecforce API プロキシ
 * POST /ecforceProxy
 * body: { method, path, body?, params? }
 */
export const ecforceProxy = onRequest(
  { cors: true, region: 'asia-northeast1', secrets: [ecforceTokenSecret] },
  async (req, res) => {
    try {
      // 認証チェック
      await verifyAuth(req);

      const config = await getApiConfig();
      const ecforceToken = ecforceTokenSecret.value();
      if (!config.ecforceBaseUrl || !ecforceToken) {
        res.status(400).json({ error: 'ecforce API not configured' });
        return;
      }

      const { method = 'GET', path, body, params } = req.body;
      let url = `${config.ecforceBaseUrl.replace(/\/$/, '')}${path}`;

      if (params) {
        const qs = new URLSearchParams(params).toString();
        if (qs) url += `?${qs}`;
      }

      const fetchOptions = {
        method,
        headers: {
          Authorization: `Bearer ${ecforceToken}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
      };

      if (body && method !== 'GET') {
        fetchOptions.body = JSON.stringify(body);
      }

      const apiRes = await rateLimitedFetch(url, fetchOptions);
      const responseText = await apiRes.text();
      let data = null;

      if (responseText.trim()) {
        try {
          data = JSON.parse(responseText);
        } catch (parseErr) {
          if (!apiRes.ok) {
            res.status(apiRes.status).json({
              error: 'ecforce API returned non-JSON error response',
              body: responseText.substring(0, 1000),
            });
            return;
          }

          // Some ecforce async update endpoints can accept the request but return
          // an empty or non-JSON body. Keep the successful HTTP status instead of
          // converting it into a proxy-side 500.
          res.status(apiRes.status).json({
            success: true,
            accepted: true,
            nonJsonResponse: true,
            bodyPreview: responseText.substring(0, 200),
          });
          return;
        }
      }

      if (!apiRes.ok) {
        res.status(apiRes.status).json(data || { error: 'ecforce API error' });
        return;
      }

      res.status(apiRes.status).json(data || { success: true, accepted: true });
    } catch (err) {
      console.error('ecforceProxy error:', err);
      res.status(err.message === 'Unauthorized' ? 401 : 500).json({
        error: err.message,
      });
    }
  }
);

// デフォルトのストアドプロンプトID
const DEFAULT_PROMPT_ID = 'pmpt_68c23271a2648190a7271a024b25f451065e59a2da9efda4';
const OPENAI_ENDPOINT = 'https://api.openai.com/v1/responses';

// ── 共通: 住所1件を校正する内部ヘルパー ──
async function correctAddress(addr, openaiKey, promptId) {
  const fullAddress = `${addr.zip} ${addr.prefecture}${addr.city}${addr.street} ${addr.building || ''}`.trim();

  const openaiRes = await fetch(OPENAI_ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${openaiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: { id: promptId }, input: fullAddress }),
  });

  if (!openaiRes.ok) {
    const errBody = await openaiRes.text();
    throw new Error(`OpenAI error ${openaiRes.status}: ${errBody}`);
  }

  const openaiData = await openaiRes.json();
  const messageOutput = openaiData.output?.find((o) => o.type === 'message');
  const outputText = openaiData.output_text
    || messageOutput?.content?.find((c) => c.type === 'output_text' || c.type === 'text')?.text;

  if (!outputText) throw new Error('No output from OpenAI');

  let jsonStr = outputText.trim();
  const block = jsonStr.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (block) jsonStr = block[1].trim();
  return JSON.parse(jsonStr);
}

/**
 * OpenAI Responses API プロキシ（住所校正用・ストアドプロンプト対応）
 * POST /addressCorrection
 * body: { addresses: [{ zip, prefecture, city, street, building }] }
 */
export const addressCorrection = onRequest(
  { cors: true, region: 'asia-northeast1', secrets: [openaiKeySecret] },
  async (req, res) => {
    try {
      await verifyAuth(req);

      const config = await getApiConfig();
      const openaiKey = openaiKeySecret.value();
      if (!openaiKey) {
        res.status(400).json({ error: 'OpenAI API key not configured' });
        return;
      }

      const { addresses } = req.body;
      if (!addresses?.length) {
        res.status(400).json({ error: 'No addresses provided' });
        return;
      }

      const promptId = config.openaiPromptId || DEFAULT_PROMPT_ID;
      const results = [];

      for (const addr of addresses) {
        try {
          const correction = await correctAddress(addr, openaiKey, promptId);
          results.push({ original: addr, correction });
        } catch (addrErr) {
          const fullAddress = `${addr.zip} ${addr.prefecture}${addr.city}${addr.street} ${addr.building || ''}`.trim();
          console.error(`Address correction failed for "${fullAddress}":`, addrErr);
          results.push({ original: addr, error: addrErr.message });
        }
      }

      res.json({ results });
    } catch (err) {
      console.error('addressCorrection error:', err);
      res.status(err.message === 'Unauthorized' ? 401 : 500).json({
        error: err.message,
      });
    }
  }
);

/**
 * ecforce webhook 受け取り → 住所校正 → Firestore 保存
 * POST /api/webhook/ecforce
 *
 * 対象フィルター:
 *   - product_name に「定期」を含む
 *   - product_name が「【」で始まる
 *   - product_name に「★」を含まない
 *   - times === "1"（初回受注）
 */
export const ecforceWebhook = onRequest(
  { cors: false, region: 'asia-northeast1', secrets: [openaiKeySecret, webhookSecretDef] },
  async (req, res) => {
    try {
      // ── シークレット検証（URLクエリパラメータ ?secret=xxx）──
      const incoming = req.query.secret ?? '';
      if (!incoming || incoming !== webhookSecretDef.value()) {
        console.warn('[ecforceWebhook] invalid secret');
        return res.status(403).json({ error: 'Forbidden' });
      }

      const payload = req.body;
      const { order_id, order_number, product_name, times, zip01, zip02, prefecture_name, addr01, addr02, addr03 } = payload;

      if (!order_id) {
        return res.status(400).json({ error: 'Missing order_id' });
      }

      // ── フィルター: 対象外はスキップ ──
      const productName = product_name ?? '';
      const shouldProcess =
        productName.includes('定期') &&
        productName.startsWith('【') &&
        !productName.includes('★') &&
        String(times) === '1';

      if (!shouldProcess) {
        console.log(`[ecforceWebhook] skipped order ${order_id}: filter not matched (product="${productName}", times=${times})`);
        return res.json({ status: 'skipped', order_id });
      }

      // ── べき等: 既に校正済みなら何もしない ──
      const docRef = db.collection('address_corrections').doc(String(order_id));
      const existing = await docRef.get();
      if (existing.exists) {
        console.log(`[ecforceWebhook] already corrected: order ${order_id}`);
        return res.json({ status: 'already_corrected', order_id });
      }

      // ── 住所を内部フォーマットに変換 ──
      const addr = {
        zip:        `${zip01 ?? ''}${zip02 ?? ''}`,
        prefecture: prefecture_name ?? '',
        city:       addr01 ?? '',
        street:     addr02 ?? '',
        building:   addr03 ?? '',
      };

      // ── OpenAI で住所校正 ──
      const config    = await getApiConfig();
      const openaiKey = openaiKeySecret.value();
      const promptId  = config.openaiPromptId || DEFAULT_PROMPT_ID;

      let correction = null;
      let errorMsg   = null;
      try {
        correction = await correctAddress(addr, openaiKey, promptId);
        console.log(`[ecforceWebhook] corrected order ${order_id}:`, correction);
      } catch (e) {
        errorMsg = e.message;
        console.error(`[ecforceWebhook] correction failed for order ${order_id}:`, e);
      }

      // ── Firestore に保存 ──
      const now = new Date();
      const expireAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000); // 7日後に自動削除
      await docRef.set({
        order_id:          String(order_id),
        order_number:      order_number ?? null,
        original_address:  addr,
        corrected_address: correction ?? null,
        correction_source: 'webhook',
        corrected_at:      now,
        created_at:        now,
        expireAt,          // Firestore TTL: 7日後に自動削除
        status:            'pending',  // 作業者が承認/却下する
        error:             errorMsg ?? null,
      });

      return res.json({ status: 'ok', order_id, corrected: !!correction });
    } catch (err) {
      console.error('[ecforceWebhook] unexpected error:', err);
      return res.status(500).json({ error: err.message });
    }
  }
);
