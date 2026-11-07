# PacificPower 前端

Vue 3、Vite、TypeScript 與 Three.js 資料中心施工數位孿生原型。完整範圍與啟動方式見 [根目錄 README](../README.md)。

```sh
npm ci
npm run dev
npm test
npm run build
```

預設使用本機資料，不需要 Ampower 的環境設定。`public/models` 連到 `../../3D-datacenter`，建置時 Vite 會複製 GLB。
