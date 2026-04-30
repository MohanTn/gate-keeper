#!/bin/bash
#
# SonarQube Scan Script
# Runs sonar-scanner via Docker, polls for completion, fetches issues.
# Requires: Docker running, .env.local from sonarqube-setup.sh, SonarQube healthy
#
# Usage: ./sonarqube-scan.sh [OPTIONS]
#   --project-key KEY     Project key (default: dh-mcp-server)
#   --timeout SECONDS     Max wait for scan completion (default: 300)
#   --min-severity LEVEL  Minimum severity to fetch (default: HIGH)
#   --artifact-dir DIR    Output directory (default: .github/artifacts/sonarqube-campaign-TIMESTAMP)
#   --help                Show this help message
#

set -e

# Colors for output (matches sonarqube-setup.sh)
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration defaults
PROJECT_KEY="dh-mcp-server"
PROJECT_NAME="dh-mcp-server"
SCAN_TIMEOUT=300
MIN_SEVERITY="HIGH"
ENV_FILE=".env.local"
DOCKER_NETWORK="sonarqube-network"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
ARTIFACT_DIR=""
REPO_ROOT=""

# Helper functions
log() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

info() {
    echo -e "${BLUE}[SCAN]${NC} $1"
}

usage() {
    echo "Usage: $0 [OPTIONS]"
    echo ""
    echo "Runs sonar-scanner via Docker against a local SonarQube instance."
    echo ""
    echo "Options:"
    echo "  --project-key KEY     Project key (default: dh-mcp-server)"
    echo "  --timeout SECONDS     Max wait for scan completion (default: 300)"
    echo "  --min-severity LEVEL  Minimum severity: CRITICAL, HIGH, MEDIUM, LOW (default: HIGH)"
    echo "  --artifact-dir DIR    Output directory for results"
    echo "  --help                Show this help message"
    echo ""
    echo "Prerequisites:"
    echo "  - Docker running"
    echo "  - .env.local with SonarQube credentials (from sonarqube-setup.sh)"
    echo "  - SonarQube server healthy on sonarqube-network"
    exit 0
}

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --project-key)
            PROJECT_KEY="$2"
            shift 2
            ;;
        --timeout)
            SCAN_TIMEOUT="$2"
            shift 2
            ;;
        --min-severity)
            MIN_SEVERITY="$2"
            shift 2
            ;;
        --artifact-dir)
            ARTIFACT_DIR="$2"
            shift 2
            ;;
        --help)
            usage
            ;;
        *)
            warn "Unknown option: $1"
            shift
            ;;
    esac
done

# Determine repo root (git root or current directory)
find_repo_root() {
    REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
    log "Repository root: $REPO_ROOT"
}

# Set artifact directory
setup_artifact_dir() {
    if [ -z "$ARTIFACT_DIR" ]; then
        ARTIFACT_DIR="${REPO_ROOT}/.github/artifacts/sonarqube-campaign-${TIMESTAMP}"
    fi
    mkdir -p "$ARTIFACT_DIR"
    log "Artifact directory: $ARTIFACT_DIR"
}

# Check prerequisites
check_prerequisites() {
    log "Checking prerequisites..."

    # Check Docker
    if ! command -v docker &> /dev/null; then
        error "Docker is not installed. Please install Docker first."
        exit 1
    fi

    if ! docker info &> /dev/null; then
        error "Docker daemon is not running. Please start Docker."
        exit 1
    fi
    log "Docker is running"

    # Check .env.local
    if [ ! -f "${REPO_ROOT}/${ENV_FILE}" ]; then
        error "${ENV_FILE} not found. Run sonarqube-setup.sh first."
        exit 1
    fi

    # Source credentials
    # shellcheck disable=SC1090
    source "${REPO_ROOT}/${ENV_FILE}"
    log "Loaded credentials from ${ENV_FILE}"

    # Validate required vars
    if [ -z "$SONARQUBE_URL" ] || [ -z "$SONARQUBE_TOKEN" ]; then
        error "SONARQUBE_URL or SONARQUBE_TOKEN not set in ${ENV_FILE}"
        exit 1
    fi

    # Extract port from URL
    SONARQUBE_PORT=$(echo "$SONARQUBE_URL" | grep -oP ':\K[0-9]+$' || echo "9000")

    # Check SonarQube is healthy
    local status
    status=$(curl -s -f "http://localhost:${SONARQUBE_PORT}/api/system/status" 2>/dev/null || echo '{}')
    if ! echo "$status" | grep -q '"status":"UP"'; then
        error "SonarQube is not healthy. Status: $status"
        error "Make sure SonarQube is running (sonarqube-setup.sh)"
        exit 1
    fi
    log "SonarQube is healthy at http://localhost:${SONARQUBE_PORT}"

    # Check Docker network exists
    if ! docker network inspect "$DOCKER_NETWORK" &> /dev/null; then
        error "Docker network '$DOCKER_NETWORK' not found. Run sonarqube-setup.sh first."
        exit 1
    fi
    log "Docker network '$DOCKER_NETWORK' exists"
}

# Create project in SonarQube (idempotent - handles 409)
create_project() {
    info "Creating SonarQube project: $PROJECT_KEY"

    local response
    response=$(curl -s -w "\n%{http_code}" -u "${SONARQUBE_TOKEN}:" \
        -X POST "http://localhost:${SONARQUBE_PORT}/api/projects/create" \
        -d "project=${PROJECT_KEY}&name=${PROJECT_NAME}")

    local http_code
    http_code=$(echo "$response" | tail -1)
    local body
    body=$(echo "$response" | head -n -1)

    case "$http_code" in
        200)
            log "Project '${PROJECT_KEY}' created successfully"
            ;;
        400)
            if echo "$body" | grep -q "already exists"; then
                log "Project '${PROJECT_KEY}' already exists (reusing)"
            else
                error "Failed to create project: $body"
                exit 1
            fi
            ;;
        *)
            error "Unexpected response creating project (HTTP $http_code): $body"
            exit 1
            ;;
    esac
}

# Generate sonar-project.properties at repo root
generate_properties() {
    info "Generating sonar-project.properties"

    cat > "${REPO_ROOT}/sonar-project.properties" << EOF
# SonarQube Project Configuration
# Auto-generated by sonarqube-scan.sh at ${TIMESTAMP}
# Monorepo config for dh-mcp-server

# Project identification
sonar.projectKey=${PROJECT_KEY}
sonar.projectName=${PROJECT_NAME}
sonar.projectVersion=1.0

# Source directories (all MCP server src/ dirs)
sonar.sources=newrelic-mcp-server/src,postgres-mcp-server/src,jira-mcp-server/src,gcloud-mcp-server/src,gitlab-mcp-server/src

# Source encoding
sonar.sourceEncoding=UTF-8

# Exclusions
sonar.exclusions=**/node_modules/**,**/.git/**,**/dist/**,**/build/**,**/coverage/**,**/__tests__/**,**/*.test.ts,**/*.spec.ts,**/*.d.ts,**/.claude/**,**/.github/**

# Test directories
sonar.tests=newrelic-mcp-server/src/__tests__,postgres-mcp-server/src/__tests__

# Test inclusions
sonar.test.inclusions=**/*.test.ts,**/*.spec.ts

# Coverage reports
sonar.javascript.lcov.reportPaths=newrelic-mcp-server/coverage/lcov.info,postgres-mcp-server/coverage/lcov.info

# Quality gate - we poll manually for completion
sonar.qualitygate.wait=false
EOF

    log "Generated sonar-project.properties at ${REPO_ROOT}"
}

# Run sonar-scanner via Docker
run_scanner() {
    info "Running sonar-scanner via Docker..."
    info "This may take several minutes on first run (downloads scanner image)"

    # Pull scanner image first (separate step for better error messages)
    if ! docker pull sonarsource/sonar-scanner-cli:latest 2>/dev/null; then
        warn "Could not pull latest scanner image, using cached version if available"
    fi

    # Run scanner inside Docker network so it can reach SonarQube by container name
    local scan_exit_code=0
    docker run --rm \
        --network "$DOCKER_NETWORK" \
        -e SONAR_TOKEN="${SONARQUBE_TOKEN}" \
        -e SONAR_HOST_URL="http://sonarqube:9000" \
        -v "${REPO_ROOT}:/usr/src" \
        sonarsource/sonar-scanner-cli:latest || scan_exit_code=$?

    if [ "$scan_exit_code" -ne 0 ]; then
        error "Scanner exited with code $scan_exit_code"
        error "Check SonarQube logs: docker logs sonarqube"
        exit 1
    fi

    log "Scanner completed successfully"
}

# Poll for scan completion with adaptive intervals
poll_completion() {
    info "Polling for scan task completion (timeout: ${SCAN_TIMEOUT}s)..."

    local elapsed=0
    local interval=5
    local status=""

    while [ "$elapsed" -lt "$SCAN_TIMEOUT" ]; do
        local response
        response=$(curl -s -u "${SONARQUBE_TOKEN}:" \
            "http://localhost:${SONARQUBE_PORT}/api/ce/component?component=${PROJECT_KEY}" 2>/dev/null || echo '{}')

        # Check if there's a current task
        status=$(echo "$response" | grep -oP '"status"\s*:\s*"\K[^"]+' | head -1 || echo "")

        case "$status" in
            SUCCESS)
                log "Scan task completed successfully"
                return 0
                ;;
            FAILED)
                error "Scan task failed"
                local error_msg
                error_msg=$(echo "$response" | grep -oP '"errorMessage"\s*:\s*"\K[^"]+' || echo "Unknown error")
                error "Error: $error_msg"
                exit 1
                ;;
            CANCELED)
                error "Scan task was canceled"
                exit 1
                ;;
            IN_PROGRESS|PENDING)
                info "Scan in progress... (${elapsed}s elapsed)"
                ;;
            "")
                info "Waiting for scan task to appear... (${elapsed}s elapsed)"
                ;;
        esac

        sleep "$interval"
        elapsed=$((elapsed + interval))

        # Adaptive interval: increase after 30 seconds
        if [ "$elapsed" -ge 30 ] && [ "$interval" -lt 10 ]; then
            interval=10
        fi
    done

    error "Scan timed out after ${SCAN_TIMEOUT} seconds"
    error "Check SonarQube at http://localhost:${SONARQUBE_PORT}/dashboard?id=${PROJECT_KEY}"
    exit 1
}

# Build severity filter for API call
build_severity_filter() {
    case "$MIN_SEVERITY" in
        CRITICAL)
            echo "CRITICAL"
            ;;
        HIGH)
            echo "CRITICAL,MAJOR"
            ;;
        MEDIUM)
            echo "CRITICAL,MAJOR,MINOR"
            ;;
        LOW)
            echo "CRITICAL,MAJOR,MINOR,INFO"
            ;;
        *)
            warn "Unknown severity '$MIN_SEVERITY', defaulting to HIGH"
            echo "CRITICAL,MAJOR"
            ;;
    esac
}

# Fetch issues from SonarQube
fetch_issues() {
    info "Fetching issues (minimum severity: $MIN_SEVERITY)..."

    local severities
    severities=$(build_severity_filter)

    local page=1
    local page_size=500
    local total=0
    local all_issues="[]"

    while true; do
        local response
        response=$(curl -s -u "${SONARQUBE_TOKEN}:" \
            "http://localhost:${SONARQUBE_PORT}/api/issues/search?componentKeys=${PROJECT_KEY}&severities=${severities}&statuses=OPEN,CONFIRMED,REOPENED&ps=${page_size}&p=${page}")

        # Extract total count
        if [ "$page" -eq 1 ]; then
            total=$(echo "$response" | grep -oP '"total"\s*:\s*\K[0-9]+' || echo "0")
            info "Total issues found: $total"
        fi

        # Extract issues array and merge
        local page_issues
        page_issues=$(echo "$response" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    issues = data.get('issues', [])
    json.dump(issues, sys.stdout)
except:
    print('[]')
" 2>/dev/null || echo "[]")

        all_issues=$(python3 -c "
import sys, json
existing = json.loads('${all_issues}' if len('${all_issues}') < 100000 else '[]')
new_issues = json.loads(sys.stdin.read())
existing.extend(new_issues)
json.dump(existing, sys.stdout)
" <<< "$page_issues" 2>/dev/null || echo "$all_issues")

        # Check if we have all pages
        local fetched=$((page * page_size))
        if [ "$fetched" -ge "$total" ] || [ "$total" -eq 0 ]; then
            break
        fi
        page=$((page + 1))
    done

    # Count by severity
    local critical_count high_count medium_count
    critical_count=$(echo "$all_issues" | grep -o '"severity":"CRITICAL"' | wc -l || echo "0")
    high_count=$(echo "$all_issues" | grep -o '"severity":"MAJOR"' | wc -l || echo "0")
    medium_count=$(echo "$all_issues" | grep -o '"severity":"MINOR"' | wc -l || echo "0")

    # Build output JSON
    python3 -c "
import json, sys
from datetime import datetime

issues = json.loads(sys.stdin.read())

output = {
    'scanMetadata': {
        'projectKey': '${PROJECT_KEY}',
        'projectName': '${PROJECT_NAME}',
        'scanTime': datetime.utcnow().isoformat() + 'Z',
        'totalIssuesFound': len(issues),
        'criticalIssues': ${critical_count},
        'highIssues': ${high_count},
        'mediumIssues': ${medium_count},
        'minSeverity': '${MIN_SEVERITY}',
        'sonarqubeUrl': 'http://localhost:${SONARQUBE_PORT}'
    },
    'issues': issues
}

with open('${ARTIFACT_DIR}/issues.json', 'w') as f:
    json.dump(output, f, indent=2)

print(json.dumps(output['scanMetadata'], indent=2))
" <<< "$all_issues"

    log "Issues saved to ${ARTIFACT_DIR}/issues.json"
}

# Check quality gate status
check_quality_gate() {
    info "Checking quality gate status..."

    local response
    response=$(curl -s -u "${SONARQUBE_TOKEN}:" \
        "http://localhost:${SONARQUBE_PORT}/api/qualitygates/project_status?projectKey=${PROJECT_KEY}" 2>/dev/null || echo '{}')

    local gate_status
    gate_status=$(echo "$response" | grep -oP '"status"\s*:\s*"\K[^"]+' | head -1 || echo "UNKNOWN")

    case "$gate_status" in
        OK)
            log "Quality Gate: PASSED"
            ;;
        ERROR)
            warn "Quality Gate: FAILED"
            ;;
        WARN)
            warn "Quality Gate: WARNING"
            ;;
        *)
            warn "Quality Gate: $gate_status"
            ;;
    esac

    # Save quality gate result
    echo "$response" > "${ARTIFACT_DIR}/quality-gate.json"
    log "Quality gate details saved to ${ARTIFACT_DIR}/quality-gate.json"

    echo "$gate_status"
}

# Print summary
print_summary() {
    local gate_status="$1"

    echo ""
    log "================================"
    log "SonarQube Scan Complete"
    log "================================"
    echo ""
    log "Project:        $PROJECT_KEY"
    log "Quality Gate:   $gate_status"
    log "Artifacts:      $ARTIFACT_DIR"
    log "Dashboard:      http://localhost:${SONARQUBE_PORT}/dashboard?id=${PROJECT_KEY}"
    echo ""
    log "Next Steps:"
    log "  1. Review issues in ${ARTIFACT_DIR}/issues.json"
    log "  2. Group issues into tasks using issue-grouper.js"
    log "  3. Run the fix workflow (/fix-sonarqube or dev-workflow)"
    echo ""
    log "Cleanup (when done):"
    log "  Run: ./sonarqube-cleanup.sh --all"
    echo ""
}

# Main execution
main() {
    echo ""
    info "SonarQube Scan - $(date)"
    info "================================"
    echo ""

    find_repo_root
    setup_artifact_dir
    echo ""

    check_prerequisites
    echo ""

    create_project
    echo ""

    generate_properties
    echo ""

    run_scanner
    echo ""

    poll_completion
    echo ""

    fetch_issues
    echo ""

    local gate_status
    gate_status=$(check_quality_gate)
    echo ""

    print_summary "$gate_status"
}

# Run main function
main "$@"
