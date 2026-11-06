# Demo DICOM (sample5, marmoset brain MRI, 50 µm)

Practice dataset (560 x 768 x 480 voxels, 0.05 mm isotropic, 16-bit, 480 slices `001.dcm` … `480.dcm`). A marmoset brain MRI template (T2*-weighted, 50 µm symmetric template). Chosen as 「マーモセット脳 MRI（50 µm）」 in the 練習データ chooser, under the separate group 「その他」 (Other); it is not one of the Lv0–Lv3 levels. The slices are listed in `index.json`.

## Credit and license

- Data: Cirong Liu / Marmoset Brain Mapping, https://www.scidb.cn/en/file?fid=6444dd2f292d4e32b96ea092&mode=front
- License: CC BY-NC-SA 4.0, https://creativecommons.org/licenses/by-nc-sa/4.0/ (see `LICENSE` in this folder)
- Changes: converted from NIfTI to DICOM without spatial resampling; signal values scaled x1,000,000 (arbitrary MRI intensity units, stored as 16-bit integers); 3D reconstruction and rendering in this app.
- Non-commercial use only. Adapted versions (for example segmentations made from this data) must be shared under the same license (CC BY-NC-SA 4.0).

日本語:

- 出典: Cirong Liu / Marmoset Brain Mapping（データ: 上記リンク）
- ライセンス: CC BY-NC-SA 4.0（`LICENSE` 参照）
- 改変: NIfTI から DICOM に変換（空間リサンプリングなし）、信号値を100万倍に換算、本アプリで3D再構成・描画
- 非営利目的に限ります。改変物（セグメンテーション等）は同じライセンス（CC BY-NC-SA 4.0）で共有してください。

The credit is also shown in the app while this dataset is open. The rest of the app is not covered by this license.

## Bundled project (optional)

The practice project (`project.vrlab`, saved from this dataset) is bundled next to `index.json` and applied when the dataset is opened (its fingerprint must match). To replace it, save a project from this dataset, rename it to `project.vrlab` and put it here.
