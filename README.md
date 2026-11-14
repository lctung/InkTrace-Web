# InkTrace Web

同一個題字左右各寫一份。左欄收集工整筆跡，右欄收集稍微潦草的筆跡。兩欄各自保存、復原、清除與匯出，沿用 InkTrace 的稿紙、進度、淺深色與觸控操作。

## 部署到 GitHub Pages

1. 解壓縮 `inktrace-web.zip`，將內層 `inktrace-web` 資料夾的內容放進網站倉庫根目錄。`index.html` 與 `.nojekyll` 都應在根目錄。
2. 開啟該倉庫的 **Settings → Pages**，選 **Deploy from a branch**，再選 `main` 和 `/ (root)`。
3. 部署完成後，開啟 Pages 顯示的網址。手機與平板可使用同一網址。

頁面載入、筆跡保存及 300×300 SVG 匯出都由瀏覽器處理。使用相對資源路徑，支援 GitHub Pages 的 `/<repo>/` 專案子目錄。部署包內是靜態檔案。原工作資料夾的 `python app.py` 仍可提供本機預覽。

[GitHub Pages 建立方式](https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-github-pages-site)

## 書寫與灰字

- 左欄使用內附的 Noto Sans TC Thin 100，為思源黑體同系的繁體版本。
- 右欄固定使用 `fonts/ShoujinTi_GBK.ttf`（方正瘦金書 GBK）。字型載入失敗或沒有該題字時，右欄留白，仍可書寫。
- 灰字依可見輪廓置中，長邊約佔字格 85%。兩欄共用題字、粗細、筆壓與提示開關。每欄的復原、清除及 SVG 下載只作用於該欄。
- 桌面和行動裝置保留並排畫布。畫布依視窗尺寸縮放，筆跡以固定的 400×400 邏輯座標保存。
- 稿紙可手動新增、匯入 UTF-8 TXT 或貼上包含 `title` 與 `text` 的 JSON。草稿存於該網站網址的 IndexedDB。原本同網址的單欄草稿會出現在左欄。從 localhost 改用 Pages 時，兩個網址各有自己的草稿。

## SVG 與 GitHub 上傳

每欄可分別下載 300×300 SVG。筆跡參考 `drawAndMorph-main` 的輪廓做法，每筆輸出為黑色填滿的封閉 `<path>`，背景透明。兩份筆跡使用不同下載檔名。

若要上傳，請在「GitHub 設定」填入自己的帳號、資料倉庫與具有該倉庫 Contents 讀寫權限的 fine-grained token。倉庫需有 `main` 分支。Token 保存在目前頁面的記憶體，重新整理後需要重新輸入。帳號與倉庫名稱可記住。

按「上傳 GitHub」會依序提交目前題字已有筆跡的欄位。兩份都上傳成功才計入完成進度。一欄失敗時，已成功的欄位會保留上傳紀錄，重試會接著上傳缺少或已修改的欄位。

升級後，舊格式的上傳紀錄會顯示為待上傳。用目前的草稿再按一次「上傳 GitHub」，即可更新為封閉輪廓。

- 工整筆跡使用原路徑 `font_dataset/稿紙名稱/字.svg`。
- 潦草筆跡使用 `font_dataset/稿紙名稱/潦草/字.svg`。

同一路徑重傳會更新原檔。稿紙含重複題字時，同一欄仍對應同一遠端檔案。資料倉庫可與部署網站的倉庫分開。

[GitHub Contents API](https://docs.github.com/en/rest/repos/contents#create-or-update-file-contents)

## 原始碼與驗證

畫布、SVG 與草稿保存採 JavaScript。參考 `drawAndMorph-main` 的瀏覽器 Canvas 指標事件及 SVG 匯出方式，沿用 InkTrace 原有稿紙與筆跡格式。

JavaScript、HTML 和 CSS 使用兩個空格縮排，Python 使用四個空格。JavaScript 變數與函式採 `camelCase`，Python 採 `snake_case`，HTML 的 ID 與 CSS 類別採 `kebab-case`。既有草稿欄位名稱用於讀取瀏覽器已保存的資料。

已測試舊草稿讀取、雙指標事件、獨立清除、SVG 尺寸，以及使用模擬 GitHub 回應驗證單欄成功後的重試。尚未以真實 GitHub 倉庫或行動裝置實測。開發資料夾可執行 `node test_core.cjs`。

原始碼採 MIT。Noto Sans TC 的授權見 `fonts/OFL.txt` 與 `fonts/NOTICE.txt`。公開部署方正瘦金書 GBK 前，請確認持有的授權涵蓋網站嵌入。 [方正字庫授權條款](https://www.foundertype.com/index.php/About/userAuth.html)
