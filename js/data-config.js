/**
 * 数据源配置
 *
 * 本部署是自托管:data/ 与 assets/ 由本机 nginx 从同源直接提供,
 * 不再读 raw.githubusercontent.com,也不再有「本仓库 / 原仓库」切换。
 * (上游那套 GitHub Pages + data 分支的读法已整体移除,连带 js/data-source.js。)
 */
const DATA_CONFIG = {
    /**
     * 数据文件的完整 URL。同源相对路径,前面不加 host。
     * @param {string} filePath 形如 'data/2026-09-03_AI_enhanced_Chinese.jsonl'
     */
    getDataUrl: function (filePath) {
        return filePath;
    }
};
