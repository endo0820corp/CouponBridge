GitHub Pages path fix: docs/index.html uses relative paths for CSS/JS/logo.

# CouponBridge

楽天RMS CouponAPIで、店舗ごとの定番クーポンを次回2週間分として新規作成するローカルWebツールです。

## 対応店舗

- ゆかい屋
  - 10000円以上 → 2000円OFF
  - 7500円以上 → 1125円OFF
  - 5000円以上 → 500円OFF
  - 2500円以上 → 125円OFF
  - API上は定額値引き `discountType=1`
  - 利用金額条件 `RS003`

- KAIRY
  - 5点以上 → 20%OFF
  - 4点以上 → 15%OFF
  - 3点以上 → 10%OFF
  - 2点以上 → 5%OFF
  - API上は定率値引き `discountType=2`
  - 利用個数条件 `RS004`

## 起動方法

```bash
npm install
cp .env.example .env
npm run dev
```

起動後、以下を開きます。

```text
http://localhost:5174
```

## .env

最初は必ず `DRY_RUN=true` のまま確認してください。

```env
RMS_YUKAIYA_SERVICE_SECRET=
RMS_YUKAIYA_LICENSE_KEY=

RMS_KAIRY_SERVICE_SECRET=
RMS_KAIRY_LICENSE_KEY=

DRY_RUN=true
PORT=5174
```

`DRY_RUN=false` にすると、実際に `coupon.issue` へ XML をPOSTします。

## 使い方

1. 店舗を選択
2. 「最新クーポンから次回期間を取得」
3. 「内容確認」
4. 問題なければ `DRY_RUN=false` にして「選択クーポンを作成」

発行時は `coupon.search` で同じクーポン名・同じ期間の既存クーポンを確認し、存在する場合は二重発行防止のためスキップします。

## 注意

楽天RMS CouponAPIは、1秒1リクエストまでを目安にする制約があります。このツールでは1件ごとに約1.1秒の待機を入れています。


## GitHub Pages + ローカルAPI運用

この版は、GitHub Pagesに画面だけを置き、RMS API実行はローカルPCのAPIサーバーで行えます。

### ローカルAPI起動

```powershell
cd C:\dev\web\projects\CouponBridge
npm install
npm run api
```

GitHub Pages側の画面は `http://localhost:5174/api` に接続します。`.env` はローカルPCだけに置いてください。

### GitHub Pages設定

GitHubのリポジトリ画面で以下を設定します。

```text
Settings
→ Pages
→ Source: Deploy from a branch
→ Branch: main
→ Folder: /docs
→ Save
```

数分後に `https://endo0820corp.github.io/CouponBridge/` で画面を開けます。
