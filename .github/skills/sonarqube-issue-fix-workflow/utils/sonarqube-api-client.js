// SonarQube API Client
// Fetches and filters issues from local SonarQube instance

const http = require('http');
const https = require('https');
const fs = require('fs');

class SonarQubeClient {
  constructor(baseUrl, token) {
    this.baseUrl = baseUrl.replace(/\/$/, ''); // Remove trailing slash
    this.token = token;
    this.issues = [];
  }

  /**
   * Make authenticated HTTP request to SonarQube API
   */
  async request(path, options = {}) {
    return new Promise((resolve, reject) => {
      const url = new URL(`${this.baseUrl}${path}`);
      
      // Add token to auth header
      const headers = {
        'Authorization': `Bearer ${this.token}`,
        'Content-Type': 'application/json',
        ...options.headers
      };

      const protocol = url.protocol === 'https:' ? https : http;
      
      const reqOptions = {
        headers,
        ...options
      };

      const req = protocol.request(url, reqOptions, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            resolve({
              status: res.statusCode,
              body: data ? JSON.parse(data) : null
            });
          } catch (e) {
            reject(new Error(`Failed to parse response: ${e.message}`));
          }
        });
      });

      req.on('error', reject);
      if (options.body) req.write(JSON.stringify(options.body));
      req.end();
    });
  }

  /**
   * Check if SonarQube is healthy
   */
  async checkHealth() {
    try {
      const response = await this.request('/api/system/status');
      return response.body?.status === 'UP';
    } catch (e) {
      console.error('Health check failed:', e.message);
      return false;
    }
  }

  /**
   * Get project info
   */
  async getProject(projectKey) {
    try {
      const response = await this.request(`/api/projects/search?keys=${projectKey}`);
      return response.body?.components?.[0];
    } catch (e) {
      console.error(`Failed to get project ${projectKey}:`, e.message);
      return null;
    }
  }

  /**
   * Create a project
   */
  async createProject(projectKey, projectName) {
    try {
      const response = await this.request('/api/projects/create', {
        method: 'POST',
        body: {
          project: projectKey,
          name: projectName
        }
      });
      return response.body?.project;
    } catch (e) {
      console.error(`Failed to create project ${projectKey}:`, e.message);
      return null;
    }
  }

  /**
   * Fetch issues with filtering
   * @param {Object} options - Filter options
   *   - severity: array of severity levels (CRITICAL, HIGH, MEDIUM, LOW)
   *   - types: array of issue types (BUG, VULNERABILITY, CODE_SMELL, SECURITY_HOTSPOT)
   *   - status: array of statuses (OPEN, RESOLVED, etc.)
   *   - projectKey: filter by project
   */
  async fetchIssues(options = {}) {
    const {
      severity = ['CRITICAL', 'HIGH'],
      types = ['BUG', 'VULNERABILITY', 'CODE_SMELL'],
      status = ['OPEN'],
      projectKey = null
    } = options;

    console.log('Fetching issues from SonarQube...');
    console.log(`  Severity: ${severity.join(', ')}`);
    console.log(`  Types: ${types.join(', ')}`);
    console.log(`  Status: ${status.join(', ')}`);

    const params = new URLSearchParams();
    
    if (projectKey) params.append('projects', projectKey);
    if (severity?.length) params.append('severities', severity.join(','));
    if (types?.length) params.append('types', types.join(','));
    if (status?.length) params.append('statuses', status.join(','));
    
    params.append('ps', '500'); // Page size
    params.append('p', '1');    // Start at page 1

    this.issues = [];
    let pageIndex = 1;
    let totalPages = 1;

    while (pageIndex <= totalPages) {
      params.set('p', pageIndex);
      
      try {
        const response = await this.request(`/api/issues/search?${params.toString()}`);
        
        if (response.status !== 200) {
          throw new Error(`API returned status ${response.status}`);
        }

        const { issues, paging } = response.body;
        
        if (issues?.length) {
          this.issues.push(...issues);
          console.log(`  Page ${pageIndex}: ${issues.length} issues`);
        }

        totalPages = Math.ceil(paging?.total / paging?.pageSize) || 1;
        pageIndex++;
      } catch (e) {
        console.error(`Failed to fetch issues (page ${pageIndex}):`, e.message);
        throw e;
      }
    }

    console.log(`✓ Fetched ${this.issues.length} total issues`);
    return this.issues;
  }

  /**
   * Get issue details
   */
  async getIssueDetails(issueKey) {
    try {
      const response = await this.request(`/api/issues/search?issues=${issueKey}`);
      return response.body?.issues?.[0];
    } catch (e) {
      console.error(`Failed to get issue ${issueKey}:`, e.message);
      return null;
    }
  }

  /**
   * Group issues by criteria
   */
  groupIssues(criteria = 'severity') {
    const groups = {};
    
    this.issues.forEach(issue => {
      const key = issue[criteria];
      if (!groups[key]) groups[key] = [];
      groups[key].push(issue);
    });

    return groups;
  }

  /**
   * Get issues summary
   */
  getSummary() {
    const summary = {
      total: this.issues.length,
      bySeverity: {},
      byType: {},
      byFile: {}
    };

    this.issues.forEach(issue => {
      // By severity
      summary.bySeverity[issue.severity] = (summary.bySeverity[issue.severity] || 0) + 1;
      
      // By type
      summary.byType[issue.type] = (summary.byType[issue.type] || 0) + 1;
      
      // By file
      const filename = issue.component?.split(':').pop() || 'unknown';
      summary.byFile[filename] = (summary.byFile[filename] || 0) + 1;
    });

    return summary;
  }

  /**
   * Export issues to JSON file
   */
  exportToJSON(filepath) {
    const data = {
      exportDate: new Date().toISOString(),
      totalIssues: this.issues.length,
      summary: this.getSummary(),
      issues: this.issues.map(issue => ({
        key: issue.key,
        rule: issue.rule,
        severity: issue.severity,
        type: issue.type,
        message: issue.message,
        component: issue.component,
        line: issue.line,
        status: issue.status,
        effort: issue.effort,
        assignee: issue.assignee,
        creationDate: issue.creationDate
      }))
    };

    fs.writeFileSync(filepath, JSON.stringify(data, null, 2));
    console.log(`✓ Exported ${data.issues.length} issues to ${filepath}`);
    return filepath;
  }
}

module.exports = SonarQubeClient;
