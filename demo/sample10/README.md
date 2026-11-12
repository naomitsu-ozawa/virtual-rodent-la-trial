# マウス脳・脳血管 — VRLサンプル

出典: Huang Siyi / Han Xin / Li Zuoyan / Zhou Enze / Wang Shaoyang / Liu Qian / Xie Tianwu, "A multi-material photon-counting micro-CT dataset of mouse brain with voxel-wise cerebrovascular annotations", Zenodo record 22092756. DOI: 10.5281/zenodo.22092756
https://doi.org/10.5281/zenodo.22092756
元データ: マウス脳の光子計数（フォトンカウンティング）microCT（個体 mouse_02、in vivo）。全脳像（total_whole_brain）・頭蓋内像（total_intracranial）・人手レビュー済み脳血管マスク（vessel_mask）の NIfTI セット。
データライセンス: CC BY 4.0。https://creativecommons.org/licenses/by/4.0/
変更: ベースCT（total_whole_brain）を頭部範囲に切り出し（512×408）、スライス方向を 670 枚から 512 枚にリサンプル（間隔 0.02292mm → 0.02999mm）して DICOM 化。脳血管マスクをそのまま造影セグメント（赤 #c1272d）に、頭蓋内像のサポート領域から血管分を差し引いたものを軟部組織セグメント＝脳（#d9a79b）に登録（project.vrlab）。
注意: 格納値はフォトンカウンティングCTの処理値で、HU には較正されていません。元データセットは寄託時点で対応する Data Descriptor が未確定で、所属機関・撮像施設・倫理承認の記載がありません（帰属表示は Zenodo レコードの著者名と DOI で行っています）。
サムネイル（thumb.webp）について: アプリ実画面のスクリーンショットではなく、変換後データ（セグメントマスクと色設定）からオフラインで描画した3Dレンダリングです。
