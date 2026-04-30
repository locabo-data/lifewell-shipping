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

const ecforceTokenSecret = defineSecret('ECFORCE_API_TOKEN');
const openaiKeySecret    = defineSecret('OPENAI_API_KEY');
const demoTokenSecret    = defineSecret('DEMO_TOKEN');

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
      const data = await apiRes.json();

      res.status(apiRes.status).json(data);
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
        const fullAddress = `${addr.zip} ${addr.prefecture}${addr.city}${addr.street} ${addr.building || ''}`.trim();

        try {
          const openaiRes = await fetch(OPENAI_ENDPOINT, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${openaiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              prompt: { id: promptId },
              input: fullAddress,
            }),
          });

          if (!openaiRes.ok) {
            const errBody = await openaiRes.text();
            console.error(`OpenAI error for "${fullAddress}":`, errBody);
            results.push({
              original: addr,
              error: `OpenAI API error: ${openaiRes.status}`,
            });
            continue;
          }

          const openaiData = await openaiRes.json();

          // Reasoning モデルは output[0] が reasoning ステップ、output[1]以降が message
          const messageOutput = openaiData.output?.find((o) => o.type === 'message');
          const outputText = openaiData.output_text
            || messageOutput?.content?.find((c) => c.type === 'output_text' || c.type === 'text')?.text
            || null;

          if (!outputText) {
            results.push({
              original: addr,
              error: 'No output from OpenAI',
            });
            continue;
          }

          const correction = JSON.parse(outputText);
          results.push({
            original: addr,
            correction,
          });
        } catch (addrErr) {
          console.error(`Address correction failed for "${fullAddress}":`, addrErr);
          results.push({
            original: addr,
            error: addrErr.message,
          });
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
 * イベントデモ認証
 * GET /api/demo?token=SECRET
 * 有効なトークン + 期限内であれば Firebase カスタムトークンを返す
 */
export const demoAuth = onRequest(
  { cors: true, region: 'asia-northeast1', secrets: [demoTokenSecret] },
  async (req, res) => {
    try {
      const token = (req.query.token || '').trim();
      const DEMO_TOKEN = demoTokenSecret.value().trim();
      // JST 2026-05-02 23:59:59
      const DEMO_EXPIRY = new Date('2026-05-02T23:59:59+09:00');

      if (!DEMO_TOKEN || !token || token !== DEMO_TOKEN) {
        return res.status(403).json({ error: 'Invalid token' });
      }
      if (new Date() > DEMO_EXPIRY) {
        return res.status(403).json({ error: 'Demo expired' });
      }

      const customToken = await getAuth().createCustomToken('demo-event-user', { demo: true });
      return res.json({ customToken });
    } catch (err) {
      console.error('demoAuth error:', err);
      res.status(500).json({ error: err.message });
    }
  }
);
