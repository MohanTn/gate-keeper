// Language Detector
// Auto-detect programming languages in the repository

const fs = require('fs');
const path = require('path');

class LanguageDetector {
  constructor(repoPath = '.') {
    this.repoPath = repoPath;
    this.detectedLanguages = new Set();
  }

  /**
   * Detect all languages in the repository
   */
  detect() {
    console.log('Auto-detecting programming languages...');

    // Check file extensions
    this.detectByFileExtensions();

    // Check build files
    this.detectByBuildFiles();

    // Check package managers
    this.detectByPackageManagers();

    console.log(`✓ Detected languages: ${Array.from(this.detectedLanguages).join(', ')}`);
    return Array.from(this.detectedLanguages);
  }

  /**
   * Detect by file extensions
   */
  detectByFileExtensions() {
    const extensionMap = {
      // TypeScript/JavaScript
      '.ts': 'typescript',
      '.js': 'javascript',
      '.tsx': 'typescript',
      '.jsx': 'javascript',
      '.mjs': 'javascript',

      // Python
      '.py': 'python',

      // Java
      '.java': 'java',

      // Go
      '.go': 'go',

      // C#
      '.cs': 'csharp',

      // SQL
      '.sql': 'sql',

      // HTML/CSS
      '.html': 'html',
      '.htm': 'html',
      '.css': 'css',
      '.scss': 'css',
      '.sass': 'css',
      '.less': 'css',

      // Other
      '.rb': 'ruby',
      '.php': 'php',
      '.kotlin': 'kotlin',
      '.swift': 'swift',
      '.rs': 'rust',
      '.c': 'c',
      '.cpp': 'cpp',
      '.h': 'c',
      '.hpp': 'cpp'
    };

    const walkDir = (dirPath) => {
      try {
        const files = fs.readdirSync(dirPath);
        
        files.forEach(file => {
          const fullPath = path.join(dirPath, file);
          const stat = fs.statSync(fullPath);

          // Skip node_modules, .git, dist, build, etc.
          if (this.shouldSkipDirectory(fullPath)) return;

          if (stat.isDirectory()) {
            walkDir(fullPath);
          } else {
            const ext = path.extname(file).toLowerCase();
            if (extensionMap[ext]) {
              this.detectedLanguages.add(extensionMap[ext]);
            }
          }
        });
      } catch (e) {
        // Skip directories we can't read
      }
    };

    walkDir(this.repoPath);
  }

  /**
   * Detect by build files
   */
  detectByBuildFiles() {
    const buildFileMap = {
      'package.json': ['typescript', 'javascript', 'nodejs'],
      'pom.xml': ['java'],
      'build.gradle': ['java'],
      'setup.py': ['python'],
      'requirements.txt': ['python'],
      'Pipfile': ['python'],
      'Gemfile': ['ruby'],
      'Dockerfile': ['docker'],
      'go.mod': ['go'],
      'Cargo.toml': ['rust'],
      'composer.json': ['php'],
      'mix.exs': ['elixir'],
      '.csproj': ['csharp'],
      'build.sbt': ['scala'],
      'package-lock.json': ['nodejs'],
      'yarn.lock': ['nodejs'],
      'Gemfile.lock': ['ruby']
    };

    try {
      const files = fs.readdirSync(this.repoPath);
      
      files.forEach(file => {
        const buildFiles = Object.keys(buildFileMap);
        if (buildFiles.includes(file)) {
          buildFileMap[file].forEach(lang => this.detectedLanguages.add(lang));
        }
      });
    } catch (e) {
      // Directory doesn't exist
    }
  }

  /**
   * Detect by package managers
   */
  detectByPackageManagers() {
    const packageManagers = {
      'package.json': ['typescript', 'javascript'],
      'yarn.lock': ['nodejs'],
      'package-lock.json': ['nodejs'],
      'composer.json': ['php'],
      'composer.lock': ['php'],
      'requirements.txt': ['python'],
      'Pipfile.lock': ['python'],
      'Gemfile.lock': ['ruby'],
      'go.mod': ['go'],
      'Cargo.lock': ['rust']
    };

    try {
      const files = fs.readdirSync(this.repoPath);
      files.forEach(file => {
        if (packageManagers[file]) {
          packageManagers[file].forEach(lang => this.detectedLanguages.add(lang));
        }
      });
    } catch (e) {
      // Directory doesn't exist
    }
  }

  /**
   * Skip certain directories in file walk
   */
  shouldSkipDirectory(dirPath) {
    const skipDirs = [
      'node_modules',
      '.git',
      '.gitignore',
      '.github',
      'dist',
      'build',
      'target',
      'coverage',
      '.next',
      '.nuxt',
      'venv',
      'env',
      '.venv',
      '__pycache__',
      '.pytest_cache',
      'vendor',
      '.cache',
      'tmp',
      'temp',
      '.DS_Store',
      'Thumbs.db'
    ];

    return skipDirs.some(skip => dirPath.includes(skip));
  }

  /**
   * Map detected languages to SonarQube plugins
   */
  mapToSonarQubePlugins() {
    const pluginMap = {
      'typescript': 'sonarqube-typescript',
      'javascript': 'sonarqube-javascript',
      'python': 'sonarqube-python',
      'java': 'sonarqube-java',
      'go': 'sonarqube-go',
      'csharp': 'sonarqube-csharp',
      'sql': 'sonarqube-sql',
      'html': 'sonarqube-html',
      'css': 'sonarqube-css',
      'ruby': 'sonarqube-ruby',
      'php': 'sonarqube-php',
      'kotlin': 'sonarqube-kotlin',
      'swift': 'sonarqube-swift',
      'rust': 'sonarqube-rust',
      'docker': 'sonarqube-docker'
    };

    const plugins = [];
    this.detectedLanguages.forEach(lang => {
      if (pluginMap[lang]) plugins.push(pluginMap[lang]);
    });

    return plugins;
  }

  /**
   * Generate sonar-project.properties content
   */
  generateSonarProjectProperties(projectKey, projectName) {
    const languages = Array.from(this.detectedLanguages);
    const exclusions = [
      '**/node_modules/**',
      '**/.git/**',
      '**/dist/**',
      '**/build/**',
      '**/target/**',
      '**/*.min.js',
      '**/*.min.css',
      '**/coverage/**',
      '**/__pycache__/**',
      '**/venv/**'
    ];

    const sources = languages.includes('typescript') || languages.includes('javascript') 
      ? 'src,lib' 
      : '.';

    let content = `# SonarQube Project Configuration
# Auto-generated by language detector

# Project identification
sonar.projectKey=${projectKey}
sonar.projectName=${projectName}
sonar.projectVersion=1.0

# Source code
sonar.sources=${sources}
sonar.exclusions=${exclusions.join(',')}

# Language
sonar.language=${languages.length === 1 ? languages[0] : 'multi'}
${languages.length > 1 ? `sonar.languages=${languages.join(',')}` : ''}

# Coverage
sonar.javascript.lcov.reportPaths=coverage/lcov.info
sonar.python.coverage.reportPath=coverage.xml

# Issue resolution
sonar.qualitygate.wait=true
sonar.max-warnings-threshold=1000
`;

    return content;
  }

  /**
   * Get detection summary
   */
  getSummary() {
    return {
      languages: Array.from(this.detectedLanguages),
      count: this.detectedLanguages.size,
      sonarqubePlugins: this.mapToSonarQubePlugins()
    };
  }
}

module.exports = LanguageDetector;
