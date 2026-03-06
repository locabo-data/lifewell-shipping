import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * ローカル開発用APIプロキシ
 * Firebase Functions が無いローカル環境で /api/ecforce, /api/address-correction を処理する
 * クライアントがリクエストに apiConfig を含めた場合のみ動作（Firebase Auth がない場合）
 */
function devApiProxy() {
  const parseBody = (req) =>
    new Promise((resolve) => {
      let data = '';
      req.on('data', (chunk) => (data += chunk));
      req.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve(null); }
      });
      req.on('error', () => resolve(null));
    });

  return {
    name: 'dev-api-proxy',
    configureServer(server) {
      // --- ecforce API プロキシ ---
      server.middlewares.use('/api/ecforce', async (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; res.end(); return; }

        const body = await parseBody(req);
        if (!body) {
          res.statusCode = 400;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: 'Invalid request body' }));
          return;
        }

        const { method = 'GET', path, body: apiBody, params, apiConfig } = body;

        if (!apiConfig?.ecforceBaseUrl || !apiConfig?.ecforceToken) {
          res.statusCode = 400;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: 'ecforce API未設定。設定画面でエンドポイントとトークンを入力してください。' }));
          return;
        }

        let url = `${apiConfig.ecforceBaseUrl.replace(/\/$/, '')}${path}`;
        if (params) {
          const qs = new URLSearchParams(params).toString();
          if (qs) url += `?${qs}`;
        }

        console.log(`[dev-proxy] ecforce ${method} ${url}`);

        try {
          // トークンが "Bearer " で始まる場合は二重付与を避ける
          const token = apiConfig.ecforceToken.startsWith('Bearer ')
            ? apiConfig.ecforceToken
            : `Bearer ${apiConfig.ecforceToken}`;

          const fetchOpts = {
            method,
            headers: {
              Authorization: token,
              'Content-Type': 'application/json',
              Accept: 'application/json',
            },
          };
          if (apiBody && method !== 'GET') {
            fetchOpts.body = JSON.stringify(apiBody);
            console.log(`[dev-proxy] request body: ${JSON.stringify(apiBody, null, 2).substring(0, 1000)}`);
          }

          const apiRes = await fetch(url, fetchOpts);
          const data = await apiRes.text();

          console.log(`[dev-proxy] ecforce response: ${apiRes.status} (${data.length} bytes)`);
          if (apiRes.status !== 200) {
            console.log(`[dev-proxy] ecforce error body: ${data.substring(0, 500)}`);
          }

          // デバッグ: レスポンスの最初のデータ項目の構造をログ出力
          if (apiRes.status === 200 && path.includes('/orders')) {
            try {
              const parsed = JSON.parse(data);
              if (parsed.data?.[0]) {
                const first = parsed.data[0];
                console.log(`[dev-proxy] 受注データ構造: keys=${Object.keys(first).join(',')}`);
                if (first.attributes) {
                  console.log(`[dev-proxy] attributes keys=${Object.keys(first.attributes).join(',')}`);
                  console.log(`[dev-proxy] tbc=${JSON.stringify(first.attributes.tbc)}, type=${typeof first.attributes.tbc}`);
                } else {
                  console.log(`[dev-proxy] tbc=${JSON.stringify(first.tbc)}, type=${typeof first.tbc}`);
                }
              }
            } catch {}
          }

          res.statusCode = apiRes.status;
          res.setHeader('Content-Type', 'application/json');
          res.end(data);
        } catch (err) {
          console.error('[dev-proxy] ecforce error:', err.message);
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: `Proxy error: ${err.message}` }));
        }
      });

      // --- OpenAI 住所校正プロキシ ---
      server.middlewares.use('/api/address-correction', async (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; res.end(); return; }

        const body = await parseBody(req);
        if (!body) {
          res.statusCode = 400;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: 'Invalid request body' }));
          return;
        }

        const { addresses, apiConfig } = body;

        if (!apiConfig?.openaiKey) {
          res.statusCode = 400;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: 'OpenAI APIキー未設定。設定画面で入力してください。' }));
          return;
        }
        if (!addresses?.length) {
          res.statusCode = 400;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: 'No addresses provided' }));
          return;
        }

        const promptId = apiConfig.openaiPromptId || 'pmpt_68c23271a2648190a7271a024b25f451065e59a2da9efda4';
        const results = [];

        for (const addr of addresses) {
          const fullAddress = `${addr.zip} ${addr.prefecture}${addr.city}${addr.street} ${addr.building || ''}`.trim();

          try {
            const openaiRes = await fetch('https://api.openai.com/v1/responses', {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${apiConfig.openaiKey}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                prompt: { id: promptId },
                input: fullAddress,
              }),
            });

            if (!openaiRes.ok) {
              const errText = await openaiRes.text();
              console.error(`[dev-proxy] OpenAI error for "${fullAddress}":`, errText);
              results.push({ original: addr, error: `OpenAI API error: ${openaiRes.status}` });
              continue;
            }

            const data = await openaiRes.json();
            // Reasoning モデルは output[0] が reasoning ステップ、output[1]以降が message
            const messageOutput = data.output?.find((o) => o.type === 'message');
            const outputText = data.output_text
              || messageOutput?.content?.find((c) => c.type === 'output_text' || c.type === 'text')?.text;

            if (!outputText) {
              console.error(`[dev-proxy] No output. types: ${data.output?.map((o) => o.type).join(',')}`);
              results.push({ original: addr, error: 'No output from OpenAI' });
              continue;
            }

            const correction = JSON.parse(outputText);
            results.push({ original: addr, correction });
          } catch (err) {
            console.error(`[dev-proxy] Address correction failed:`, err.message);
            results.push({ original: addr, error: err.message });
          }
        }

        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ results }));
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), devApiProxy()],
  server: {
    port: 3000,
  },
  build: {
    outDir: 'dist',
  },
});
