# 心臟方塊對戰

雙人平板網頁遊戲。每人僅看到自己的俄羅斯方塊盤面；消除任一列，對手會收到 3 題取自既有 50 題國考式心臟題庫的單選題，答完才可繼續操作。

## 在課堂中啟動

在此資料夾執行：

```bash
/Users/amie/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node server.mjs
```

教師電腦與學生平板需在同一個 Wi-Fi。教師以電腦的區域網路 IP 組成網址，例如 `http://192.168.1.25:4173`，讓學生以瀏覽器開啟。兩位學生輸入相同的 4–8 碼英數房間代碼便會自動開始。

題庫已內嵌於 `questions.json`，可直接部署到 Render 或其他支援 Node.js 的服務。
