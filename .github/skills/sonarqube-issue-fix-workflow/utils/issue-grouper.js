// Issue Grouper
// Converts SonarQube issues into right-sized tasks for the task.json

const fs = require('fs');

class IssueGrouper {
  constructor(issues = []) {
    this.issues = issues;
    this.tasks = [];
  }

  /**
   * Group issues into tasks
   * @param {Object} options
   *   - groupByRule: group same issues by rule (default: true)
   *   - maxTaskSize: maximum hours per task (default: 3)
   *   - severityWeights: custom severity -> hours mapping
   */
  generateTasks(options = {}) {
    const {
      groupByRule = true,
      maxTaskSize = 3,
      severityWeights = {
        CRITICAL: 2,
        HIGH: 1.5,
        MEDIUM: 1,
        LOW: 0.5
      }
    } = options;

    console.log('Generating tasks from issues...');

    // Group by severity first
    const bySeverity = this.groupBySeverity();
    
    // Process CRITICAL first (1 per task)
    if (bySeverity.CRITICAL?.length) {
      console.log(`  Processing ${bySeverity.CRITICAL.length} CRITICAL issues (1 per task)`);
      bySeverity.CRITICAL.forEach((issue, idx) => {
        this.tasks.push(this.createTask(
          `SQ-${String(this.tasks.length + 1).padStart(3, '0')}`,
          `[CRITICAL] ${issue.message.substring(0, 80)}`,
          [issue],
          'CRITICAL',
          this.estimateComplexity([issue])
        ));
      });
    }

    // Process HIGH (2-3 per task if related)
    if (bySeverity.HIGH?.length) {
      console.log(`  Processing ${bySeverity.HIGH.length} HIGH issues (2-3 per task)`);
      const highGroups = this.groupByRelation(bySeverity.HIGH, 3);
      highGroups.forEach(group => {
        this.tasks.push(this.createTask(
          `SQ-${String(this.tasks.length + 1).padStart(3, '0')}`,
          this.generateTaskTitle(group),
          group,
          'HIGH',
          this.estimateComplexity(group)
        ));
      });
    }

    // Process MEDIUM (4-5 per task)
    if (bySeverity.MEDIUM?.length) {
      console.log(`  Processing ${bySeverity.MEDIUM.length} MEDIUM issues (4-5 per task)`);
      const mediumGroups = this.groupByRelation(bySeverity.MEDIUM, 5);
      mediumGroups.forEach(group => {
        this.tasks.push(this.createTask(
          `SQ-${String(this.tasks.length + 1).padStart(3, '0')}`,
          this.generateTaskTitle(group),
          group,
          'MEDIUM',
          this.estimateComplexity(group)
        ));
      });
    }

    console.log(`✓ Generated ${this.tasks.length} tasks`);
    return this.tasks;
  }

  /**
   * Group issues by severity
   */
  groupBySeverity() {
    const groups = {};
    this.issues.forEach(issue => {
      if (!groups[issue.severity]) groups[issue.severity] = [];
      groups[issue.severity].push(issue);
    });
    return groups;
  }

  /**
   * Group issues by relation (same rule, same file, or similar pattern)
   */
  groupByRelation(issues, maxPerGroup = 3) {
    const groups = [];
    const processed = new Set();

    issues.forEach(issue => {
      if (processed.has(issue.key)) return;

      const group = [issue];
      processed.add(issue.key);

      // Find related issues (same rule or same file)
      issues.forEach(otherIssue => {
        if (processed.has(otherIssue.key) || group.length >= maxPerGroup) return;

        if (issue.rule === otherIssue.rule || 
            issue.component === otherIssue.component) {
          group.push(otherIssue);
          processed.add(otherIssue.key);
        }
      });

      groups.push(group);
    });

    return groups;
  }

  /**
   * Generate a descriptive task title
   */
  generateTaskTitle(issues) {
    if (issues.length === 1) {
      return `${issues[0].message.substring(0, 60)}...`;
    }

    // Use common rule if all same
    if (new Set(issues.map(i => i.rule)).size === 1) {
      return `Fix ${issues.length} instances of rule [${issues[0].rule}]`;
    }

    // Use common file if all same
    if (new Set(issues.map(i => i.component)).size === 1) {
      const filename = issues[0].component.split(':').pop();
      return `Fix ${issues.length} issues in ${filename}`;
    }

    return `Fix ${issues.length} related code quality issues`;
  }

  /**
   * Estimate task complexity based on issues
   * Returns: 'simple' (< 1h), 'medium' (1-2h), 'complex' (2-3h)
   */
  estimateComplexity(issues) {
    // Count affected files
    const files = new Set(issues.map(i => i.component));
    
    // Check if issues need architectural changes
    const hasVulnerabilities = issues.some(i => i.type === 'VULNERABILITY');
    const hasBugs = issues.some(i => i.type === 'BUG');
    const hasCodeSmells = issues.some(i => i.type === 'CODE_SMELL');

    const totalEstimate = 
      (files.size * 0.5) +  // ~30 min per file
      (hasVulnerabilities ? 1 : 0) +  // Vulnerabilities take extra time
      (hasBugs ? 0.5 : 0) +  // Bugs need careful testing
      (issues.length > 5 ? 1 : 0);  // Batch fixes take longer

    if (totalEstimate < 1) return 'simple';
    if (totalEstimate < 2) return 'medium';
    return 'complex';
  }

  /**
   * Create a task object
   */
  createTask(id, title, issues, severity, complexity) {
    const affectedFiles = [...new Set(issues.map(i => i.component))];
    const ruleUrls = [...new Set(issues.map(i => `https://rules.sonarsource.com/typescript/RSPEC-${i.rule}`))];

    return {
      id,
      sonarqubeKey: issues[0].key,
      title,
      description: this.generateDescription(issues),
      severity,
      issueType: issues[0].type,
      affectedFiles,
      ruleDocUrl: ruleUrls[0],
      acceptanceCriteria: this.generateAcceptanceCriteria(issues, complexity),
      status: 'To do',
      priority: severity === 'CRITICAL' ? 1 : (severity === 'HIGH' ? 2 : 3),
      passes: false,
      notes: ''
    };
  }

  /**
   * Generate task description
   */
  generateDescription(issues) {
    if (issues.length === 1) {
      const issue = issues[0];
      return `SonarQube Issue: ${issue.message}\n\nFile: ${issue.component}\nLine: ${issue.line}\nRule: ${issue.rule}\nSeverity: ${issue.severity}`;
    }

    return `${issues.length} related SonarQube issues:\n${
      issues.slice(0, 5).map(i => `- ${i.message} (${i.component}:${i.line})`).join('\n')
    }${issues.length > 5 ? `\n... and ${issues.length - 5} more` : ''}`;
  }

  /**
   * Generate acceptance criteria
   */
  generateAcceptanceCriteria(issues, complexity) {
    const criteria = [];

    // Main criteria based on issue type
    if (issues.some(i => i.type === 'VULNERABILITY')) {
      criteria.push('Fix all security vulnerabilities per SonarQube rule requirements');
      criteria.push('Add test cases covering security attack patterns');
    } else if (issues.some(i => i.type === 'BUG')) {
      criteria.push('Fix all bugs per SonarQube rule requirements');
      criteria.push('Add test cases demonstrating the bug and the fix');
    } else {
      criteria.push('Resolve all code quality issues per SonarQube rules');
      criteria.push('Refactor code following best practices');
    }

    // Complexity-based criteria
    if (complexity === 'complex') {
      criteria.push('Add 5+ test cases covering multiple scenarios');
    } else if (complexity === 'medium') {
      criteria.push('Add 3+ test cases covering main scenarios');
    } else {
      criteria.push('Add 2+ test cases covering happy path and edge cases');
    }

    // Standard criteria
    criteria.push('All existing tests pass');
    criteria.push(`Re-run SonarQube scan confirms ${issues.length} issue(s) RESOLVED`);
    criteria.push('Typecheck passes');
    criteria.push('Code coverage remains ≥ 85%');

    return criteria;
  }

  /**
   * Export tasks to JSON file
   */
  exportToJSON(filepath, projectName, branchName) {
    const output = {
      project: projectName,
      branchName: branchName || `fix/sonarqube-critical-${Date.now()}`,
      description: `Fix ${this.issues.length} SonarQube code quality issues`,
      sonarqubeContext: {
        totalIssuesFound: this.issues.length,
        issuesTargeted: this.tasks.reduce((sum, t) => sum + (t.affectedFiles?.length || 1), 0),
        criticalCount: this.issues.filter(i => i.severity === 'CRITICAL').length,
        highCount: this.issues.filter(i => i.severity === 'HIGH').length,
        mediumCount: this.issues.filter(i => i.severity === 'MEDIUM').length
      },
      userStories: this.tasks
    };

    fs.writeFileSync(filepath, JSON.stringify(output, null, 2));
    console.log(`✓ Exported ${this.tasks.length} tasks to ${filepath}`);
    return filepath;
  }

  /**
   * Get summary statistics
   */
  getSummary() {
    return {
      totalIssues: this.issues.length,
      totalTasks: this.tasks.length,
      tasksByComplexity: {
        simple: this.tasks.filter(t => t.acceptanceCriteria?.length < 5).length,
        medium: this.tasks.filter(t => t.acceptanceCriteria?.length >= 5 && t.acceptanceCriteria?.length < 7).length,
        complex: this.tasks.filter(t => t.acceptanceCriteria?.length >= 7).length
      },
      estimatedHours: this.tasks.reduce((sum, t) => {
        const complexity = this.tasks.indexOf(t) < 5 ? 2 : (this.tasks.indexOf(t) < 10 ? 1.5 : 1);
        return sum + complexity;
      }, 0)
    };
  }
}

module.exports = IssueGrouper;
