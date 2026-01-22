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
