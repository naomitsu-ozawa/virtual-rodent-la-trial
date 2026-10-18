# Virtual Rodent Lab — 体験版

マウス・実験動物のmicro-CT画像を、ブラウザだけで観察できる教育用の体験版です。同梱の練習データ4種類を使って、断面表示、3D表示、セグメンテーション、画像フィルター、体積計測などの操作を試せます。**VRヘッドセットを使えば、CT画像を目の前の空間に立体で浮かべて観察することもできます（VR / AR）。** 診断用のソフトウェアではありません。

**公開サイト: https://naomitsu-ozawa.github.io/virtual-rodent-la-trial/**

> English summary is provided below.

## 練習データの開き方

1. 画面の「データ」パネル（上部のツールバーにもあります）にある「練習データ」ボタンを押します。
2. 4種類から1つ選びます: ラット腹部 / マウス腹部 / マウス頭部 / 骨梁（それぞれ約260〜270MB）。
3. 読み込みが終わると、3面の断面（Axial / Coronal / Sagittal）と3D表示が現れます。初回はダウンロードに時間がかかります。2回目以降は端末内のキャッシュを使います。

練習データはすべて、このサイトに同梱されたものです。

## VR / AR で観察する

VRヘッドセットのブラウザでこのサイトを開くと、CT画像を立体のまま空間に浮かべて、手で回したり、近づいてのぞき込んだりできます。

- **VR**: 周りの景色を消して、CT画像だけを見ます。
- **AR**: ヘッドセットのカメラ越しに部屋を見ながら、机の上などにCT画像を置いて見ます（パススルー）。

**始め方**

1. VRヘッドセット（Meta Quest 3 で確認しています）のブラウザで、このサイトを開きます。
2. 「練習データ」から1つ選んで開きます。
3. 左のツール列の「表示」を開き、いちばん上の「VR / AR」の行にある「VRで見る」または「ARで見る」を押します。
4. ヘッドセット内で、コントローラーを使って回転・拡大・断面の操作ができます。VR表示とAR表示は、スティックを2回押し込むか、手元のリングメニューで切り替えられます。

**注意**

- 「VRで見る」「ARで見る」のボタンは、VR / ARに対応したブラウザでだけ表示されます。パソコンやiPadでは表示されません。
- VR / ARで表示できるのは、ボリューム表示（CT値をそのまま立体にした表示）です。3Dのサーフェス表示（メッシュ）はVR / ARには対応していません。

## できること

- 3面MPRの表示とスライス移動、十字線、HUの計測（線・プロファイル）、距離の計測、位置コメント
- 3D表示: GPUボリュームレンダリング（WebGPU）とサーフェス表示。WebGPUが使えない環境ではWebGLで表示します
- 組織セグメント（骨・軟部組織・脂肪・肺など）の表示、色・不透明度・CT値範囲の調整、後処理（Opening / Closing / 小さい塊の除去 / 穴埋め）
- 非破壊の画像フィルター（Spike / Hole補正、NLM、Anisotropic Diffusion、Gaussian、Median、Sigmoid、Bilateral、TV、Unsharp）
- 体積解析（mm³ / µL）、囲み選択、切断、断面ビュー
- STL書き出しと、立方体の切り出し（DICOMとして書き出し）
- VR / AR表示（VRヘッドセットのみ。上の「VR / AR で観察する」を参照）
- 日本語 / 英語の切り替え、6種類のカラーテーマ

## 動作環境

- WebGPUに対応した最新のブラウザを推奨します（デスクトップのChrome / Edge、Mac・iPadのSafariなど）。WebGPUが使えない環境ではWebGLで表示しますが、処理が遅くなったり表示品質が下がったりすることがあります。
- 練習データは1つあたり数百MBのメモリを使います。メモリに余裕のある端末で開いてください。
- Linux版Chromeでは、起動オプション `--enable-features=ForceEnableWebGpuInterop` が必要な場合があります（Wayland環境のみ）。

## 自分のPCで動かす

Node.jsがあれば、ビルドなしで動きます。

```bash
node scripts/serve-docs.mjs      # http://localhost:4173/ で docs/ を配信
```

GitHub Pagesで公開する場合は、`docs/` をそのまま配信してください（`.github/workflows/pages.yml` は `gh-pages` ブランチへ配信します）。

## テスト（開発者向け）

```bash
npm ci
npm run lint
npm test                 # 構文・ビルド番号の整合・循環チェック + ユニットテスト (Vitest)
npx playwright install chromium
npm run test:e2e         # ブラウザテスト (Playwright)
```

## ライセンス

本ソフトウェアは **GNU Affero General Public License v3.0 only (AGPL-3.0-only)** の条件で公開します。全文は `LICENSE` を参照してください。

ネットワーク経由で改変版を提供する場合も、利用者へ対応するソースコードを提供する必要があります。第三者ライブラリおよび同梱データには、それぞれのライセンス・利用条件が適用されます。詳細は `THIRD_PARTY_NOTICES.md`（`docs/THIRD_PARTY_NOTICES.md` と同じ内容）を参照してください。

---

## English

Virtual Rodent Lab (trial) is an educational, browser-only viewer for small-animal micro-CT. It ships with four bundled practice datasets so you can try multiplanar views, 3D rendering, segmentation, non-destructive filters and volume measurements. **With a VR headset you can also place the CT volume in the space in front of you (VR / AR).** It is not a diagnostic tool.

**Site: https://naomitsu-ozawa.github.io/virtual-rodent-la-trial/**

### Opening the practice data

1. Press **Practice data** in the Data panel (also in the top toolbar).
2. Choose one of the four sets: rat abdomen, mouse abdomen, mouse head, or trabecular bone (about 260-270 MB each).
3. When loading finishes, the three MPR planes and the 3D view appear. The first download takes a while; later visits use the on-device cache.

All practice data is bundled with this site.

### Viewing in VR / AR

Open this site in the browser of a VR headset to see the CT volume in 3D in front of you, turn it with your hands and look inside it.

- **VR**: only the CT volume, the surroundings are hidden.
- **AR**: the volume sits in your room, seen through the headset cameras (passthrough).

1. Open this site in the headset's browser (checked on Meta Quest 3).
2. Open one of the practice datasets.
3. Open **Display** in the tool rail on the left and press **View in VR** or **View in AR** in the **VR / AR** row at the top.
4. Use the controllers to rotate, zoom and move sections. Switch between VR and AR by pressing a thumbstick twice or from the ring menu.

The VR / AR buttons appear only in browsers that support VR / AR (not on a PC or iPad). VR / AR shows the volume rendering; surface meshes are not shown in VR / AR.

### Features

- Axial / Coronal / Sagittal MPR with slice navigation, crosshair, HU line and profile, distance measurement, position comments
- 3D view: WebGPU volume rendering and surface meshes (WebGL fallback)
- Tissue segments (bone, soft tissue, fat, lung, ...) with color, opacity and CT range; Opening / Closing / small-component removal / hole filling
- Non-destructive filters (Spike / Hole, NLM, Anisotropic Diffusion, Gaussian, Median, Sigmoid, Bilateral, TV, Unsharp)
- Volume analysis (mm³ / µL), lasso selection, cutting, section view
- STL export and cube crop export (as DICOM)
- VR / AR (VR headsets only, see above), Japanese / English UI, six color themes

### Browser requirements

- A recent browser with WebGPU is recommended (Chrome / Edge on desktop, Safari on Mac and iPad). Without WebGPU the app falls back to WebGL, which can be slower and look coarser.
- Each practice dataset needs several hundred MB of memory.
- Chrome on Linux may need `--enable-features=ForceEnableWebGpuInterop` (Wayland only).

### Run locally

`node scripts/serve-docs.mjs` serves `docs/` at http://localhost:4173/ (no build step).

### License

**GNU Affero General Public License v3.0 only (AGPL-3.0-only)**; see `LICENSE`. Third-party libraries and bundled data keep their own licenses; see `THIRD_PARTY_NOTICES.md`.
