# プロジェクトルール

## ⚠️ 絶対に変更してはいけないルール

### ecforce 住所フィールドマッピング

ecforce API の住所フィールドは以下の定義に固定する。変更禁止。

#### ecforce API フィールド定義

| ecforce API フィールド | 内容 | 例 |
|---|---|---|
| `prefecture_name` / `prefecture_id` | 都道府県 | `山形県` / `6` |
| `addr01` | 市区町村 + 町名（都道府県を含まない） | `西村山郡西川町吉川` |
| `addr02` | 丁目-番地-号 + 建物名 + 部屋番号 | `2250-3` / `3080-16 ヴィラプレジール3 101号` |
| `addr03` | 建物名補足（任意） | |
| `zip01` | 郵便番号上3桁 | `990` |
| `zip02` | 郵便番号下4桁 | `0711` |

#### 内部 shipping_address フィールドとの対応

`denormalizeJsonApiOrders` で変換される内部フィールド：

| 内部フィールド | ecforce API フィールド |
|---|---|
| `shipping_address.prefecture` | `prefecture_name` |
| `shipping_address.city` | `addr01`（市区町村） |
| `shipping_address.street` | `addr02`（番地） |
| `shipping_address.building` | `addr03`（建物名） |
| `shipping_address.zip` | `full_zip` (`zip01` + `zip02`) |

#### AI校正後の住所組み立てルール（ShippingApp.jsx）

```
addr01（ecforce送信） = city + town        ← 都道府県は含めない
addr02（ecforce送信） = chome-banchi-go + " " + building + building_number
zip（ecforce送信）    = zip01（3桁） + zip02（4桁）に分割して送信
```

**都道府県は更新しない**。`prefecture` は ecforce 側の既存値のまま変更しない。
`prefecture_id` は原則として送信しない。

---

### ecforce 住所更新の API フロー（bulkApplyAddressCorrections）

以下の順序・内容で3エンドポイントを順番に呼ぶ。変更禁止。

```
1. orders/bulk_update.json
   → billing_address_attributes + shipping_address_attributes（両方必須）

2. subs_orders/bulk_update.json  ← subsOrderId がある場合のみ
   → shipping_address_attributes のみ（billing は仕様書未確認のため送らない）

3. customers/bulk_update.json  ← 最後・continueOnCustomerBillingError=true
   → billing_address_attributes のみ（切り分け用）
```

---

### 質問前に必ず確認すること

トークンを多く使う操作（AI校正の一括実行・ecforce への書き戻しなど）を行う前に、必ずユーザーに確認を取ること。
