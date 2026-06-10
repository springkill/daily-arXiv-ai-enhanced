/**
 * Data Source Configuration
 * This file can be updated by GitHub Actions during deployment.
 * If no values are injected, it infers repo info from the GitHub Pages URL
 * to enable fetching data from the data branch.
 */

function inferRepoInfo() {
    if (typeof window === 'undefined') {
        return { owner: null, repoName: null };
    }

    const host = window.location.hostname || '';
    const hostParts = host.split('.');
    const pathParts = window.location.pathname.split('/').filter(Boolean);

    let owner = null;
    let repoName = null;

    if (hostParts.length >= 3 && hostParts[1] === 'github' && hostParts[2] === 'io') {
        owner = hostParts[0];
        if (pathParts.length > 0) {
            repoName = pathParts[0];
        } else if (owner) {
            repoName = `${owner}.github.io`;
        }
    }

    return { owner: owner, repoName: repoName };
}

const inferredRepo = inferRepoInfo();
const DEFAULT_REPO_OWNER = 'dw-dengwei';
const DEFAULT_REPO_NAME = 'daily-arXiv-ai-enhanced';

/**
 * 自托管模式开关。
 * true  -> 数据从本站同源 (/data, /assets) 读取,由本机 nginx 直接提供,不再走 GitHub。
 * false -> 原行为:从 raw.githubusercontent.com 的 data 分支读取。
 */
const SELF_HOSTED = true;

const DATA_CONFIG = {
    /**
     * GitHub repository owner (username)
     * This will be replaced during GitHub Actions workflow execution
     */
    repoOwner: inferredRepo.owner || DEFAULT_REPO_OWNER,

    /**
     * GitHub repository name
     * This will be replaced during GitHub Actions workflow execution
     */
    repoName: inferredRepo.repoName || DEFAULT_REPO_NAME,

    /**
     * Data branch name
     * Default: 'data'
     */
    dataBranch: 'data',

    /**
     * Get the base URL for raw GitHub content from data branch
     * @returns {string} Base URL for raw GitHub content
     */
    getDataBaseUrl: function() {
        // 自托管:同源根路径,数据由本机 nginx 从 ./data、./assets 提供
        if (typeof SELF_HOSTED !== 'undefined' && SELF_HOSTED) {
            return '';
        }
        return `https://raw.githubusercontent.com/${this.repoOwner}/${this.repoName}/${this.dataBranch}`;
    },

    /**
     * Get the full URL for a data file
     * @param {string} filePath - Relative path to the data file (e.g., 'data/2025-01-01.jsonl')
     * @returns {string} Full URL to the data file
     */
    getDataUrl: function(filePath) {
        return `${this.getDataBaseUrl()}/${filePath}`;
    }
};
