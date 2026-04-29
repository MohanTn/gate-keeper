"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.UniversalAnalyzer = void 0;
const path = __importStar(require("path"));
const typescript_analyzer_1 = require("./typescript-analyzer");
const csharp_analyzer_1 = require("./csharp-analyzer");
const rating_calculator_1 = require("../rating/rating-calculator");
const SUPPORTED_EXTENSIONS = {
    '.ts': 'typescript',
    '.tsx': 'tsx',
    '.jsx': 'jsx',
    '.js': 'typescript',
    '.cs': 'csharp'
};
class UniversalAnalyzer {
    tsAnalyzer = new typescript_analyzer_1.TypeScriptAnalyzer();
    csAnalyzer = new csharp_analyzer_1.CSharpAnalyzer();
    ratingCalc = new rating_calculator_1.RatingCalculator();
    isSupportedFile(filePath) {
        return path.extname(filePath) in SUPPORTED_EXTENSIONS;
    }
    async analyze(filePath) {
        const ext = path.extname(filePath);
        const language = SUPPORTED_EXTENSIONS[ext];
        if (!language)
            return null;
        try {
            const result = language === 'csharp'
                ? this.csAnalyzer.analyze(filePath)
                : this.tsAnalyzer.analyze(filePath);
            const rating = this.ratingCalc.calculate(result.violations, result.metrics, result.dependencies);
            return {
                path: filePath,
                language,
                dependencies: result.dependencies,
                metrics: result.metrics,
                violations: result.violations,
                rating,
                analyzedAt: Date.now()
            };
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return {
                path: filePath,
                language,
                dependencies: [],
                metrics: { linesOfCode: 0, cyclomaticComplexity: 0, numberOfMethods: 0, numberOfClasses: 0, importCount: 0 },
                violations: [{ type: 'analysis_error', severity: 'error', message: `Analysis failed: ${message}` }],
                rating: 5,
                analyzedAt: Date.now()
            };
        }
    }
}
exports.UniversalAnalyzer = UniversalAnalyzer;
//# sourceMappingURL=universal-analyzer.js.map