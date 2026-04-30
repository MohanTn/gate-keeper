#!/bin/bash
#
# SonarQube Setup Script for Linux/Mac
# Sets up local SonarQube Docker instance with PostgreSQL backend
# Usage: ./sonarqube-setup.sh [--port 9000]
#

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
SONARQUBE_PORT=${PORT:-9000}
SONARQUBE_VERSION="latest"
POSTGRES_VERSION="15"
DOCKER_NETWORK="sonarqube-network"
DOCKER_VOLUME_DB="sonarqube-db-volume"
DOCKER_VOLUME_DATA="sonarqube-data-volume"
ENV_FILE=".env.local"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
SETUP_LOG="sonarqube-setup-${TIMESTAMP}.log"

# Helper functions
log() {
    echo -e "${GREEN}[INFO]${NC} $1" | tee -a "$SETUP_LOG"
}

warn() {
    echo -e "${YELLOW}[WARN]${NC} $1" | tee -a "$SETUP_LOG"
}

error() {
    echo -e "${RED}[ERROR]${NC} $1" | tee -a "$SETUP_LOG"
}

# Check prerequisites
check_prerequisites() {
    log "Checking prerequisites..."
    
    # Check Docker
    if ! command -v docker &> /dev/null; then
        error "Docker is not installed. Please install Docker first."
        exit 1
    fi
    log "✓ Docker found: $(docker --version)"
    
    # Check Docker daemon is running
    if ! docker info &> /dev/null; then
        error "Docker daemon is not running. Please start Docker."
        exit 1
    fi
    log "✓ Docker daemon is running"
    
    # Check git
    if ! command -v git &> /dev/null; then
        error "Git is not installed. Please install Git first."
        exit 1
    fi
    log "✓ Git found: $(git --version)"
    
    # Check disk space (need ~4GB)
    available_space=$(df . | tail -1 | awk '{print $4}')
    if [ "$available_space" -lt 4194304 ]; then  # 4GB in KB
        warn "Low disk space available (< 4GB). SonarQube may need significant space."
    fi
    log "✓ Disk space check passed"
}

# Check if port is available
check_port() {
    if netstat -tuln 2>/dev/null | grep -q ":$SONARQUBE_PORT "; then
        warn "Port $SONARQUBE_PORT is already in use"
        SONARQUBE_PORT=$((SONARQUBE_PORT + 1))
        log "Using alternate port: $SONARQUBE_PORT"
    fi
}

# Create Docker network
create_network() {
    log "Creating Docker network: $DOCKER_NETWORK"
    if docker network inspect "$DOCKER_NETWORK" &> /dev/null; then
        log "✓ Network already exists"
    else
        docker network create "$DOCKER_NETWORK" --driver bridge
        log "✓ Network created"
    fi
}

# Create volumes
create_volumes() {
    log "Creating Docker volumes"
    
    for volume in "$DOCKER_VOLUME_DB" "$DOCKER_VOLUME_DATA"; do
        if docker volume inspect "$volume" &> /dev/null; then
            log "✓ Volume $volume already exists"
        else
            docker volume create "$volume"
            log "✓ Volume $volume created"
        fi
    done
}

# Start PostgreSQL
start_postgres() {
    log "Starting PostgreSQL database..."
    
    if docker ps -a --filter "name=sonarqube-postgres" --quiet | grep -q .; then
        log "PostgreSQL container already exists, starting..."
        docker start sonarqube-postgres || docker run -d \
            --name sonarqube-postgres \
            --network "$DOCKER_NETWORK" \
            -v "$DOCKER_VOLUME_DB:/var/lib/postgresql/data" \
            -e POSTGRES_USER=sonar \
            -e POSTGRES_PASSWORD=sonarpassword \
            -e POSTGRES_DB=sonarqube \
            "postgres:${POSTGRES_VERSION}" \
            postgres -c max_wal_size=1GB
    else
        docker run -d \
            --name sonarqube-postgres \
            --network "$DOCKER_NETWORK" \
            -v "$DOCKER_VOLUME_DB:/var/lib/postgresql/data" \
            -e POSTGRES_USER=sonar \
            -e POSTGRES_PASSWORD=sonarpassword \
            -e POSTGRES_DB=sonarqube \
            "postgres:${POSTGRES_VERSION}" \
            postgres -c max_wal_size=1GB
    fi
    
    log "✓ PostgreSQL started, waiting for readiness..."
    
    # Wait for PostgreSQL to be ready
    local max_attempts=30
    local attempt=0
    while [ $attempt -lt $max_attempts ]; do
        if docker exec sonarqube-postgres pg_isready -U sonar &> /dev/null; then
            log "✓ PostgreSQL is ready"
            return 0
        fi
        attempt=$((attempt + 1))
        sleep 1
    done
    
    error "PostgreSQL failed to start after ${max_attempts} seconds"
    exit 1
}

# Start SonarQube
start_sonarqube() {
    log "Starting SonarQube server..."
    
    if docker ps -a --filter "name=sonarqube" --quiet | grep -q .; then
        log "SonarQube container already exists, starting..."
        docker start sonarqube || docker run -d \
            --name sonarqube \
            --network "$DOCKER_NETWORK" \
            -p "${SONARQUBE_PORT}:9000" \
            -v "$DOCKER_VOLUME_DATA:/opt/sonarqube/data" \
            -e SONAR_JDBC_URL="jdbc:postgresql://sonarqube-postgres:5432/sonarqube" \
            -e SONAR_JDBC_USERNAME=sonar \
            -e SONAR_JDBC_PASSWORD=sonarpassword \
            "sonarqube:${SONARQUBE_VERSION}-community"
    else
        docker run -d \
            --name sonarqube \
            --network "$DOCKER_NETWORK" \
            -p "${SONARQUBE_PORT}:9000" \
            -v "$DOCKER_VOLUME_DATA:/opt/sonarqube/data" \
            -e SONAR_JDBC_URL="jdbc:postgresql://sonarqube-postgres:5432/sonarqube" \
            -e SONAR_JDBC_USERNAME=sonar \
            -e SONAR_JDBC_PASSWORD=sonarpassword \
            "sonarqube:${SONARQUBE_VERSION}-community"
    fi
    
    log "✓ SonarQube container started, waiting for readiness..."
    
    # Wait for SonarQube to be ready
    local max_attempts=60
    local attempt=0
    while [ $attempt -lt $max_attempts ]; do
        if curl -s "http://localhost:${SONARQUBE_PORT}/api/system/status" | grep -q '"status":"UP"'; then
            log "✓ SonarQube is ready"
            return 0
        fi
        attempt=$((attempt + 1))
        sleep 1
    done
    
    error "SonarQube failed to start after ${max_attempts} seconds"
    docker logs sonarqube | tail -20
    exit 1
}

# Generate authentication token
generate_token() {
    log "Generating SonarQube authentication token..."
    
    # Default admin credentials
    SONARQUBE_USER="admin"
    SONARQUBE_PASSWORD="admin"
    
    # Create token (change name to avoid duplicates)
    TOKEN_NAME="github-copilot-${TIMESTAMP}"
    
    SONARQUBE_TOKEN=$(curl -s -u "${SONARQUBE_USER}:${SONARQUBE_PASSWORD}" \
        -X POST "http://localhost:${SONARQUBE_PORT}/api/user_tokens/generate" \
        -d "name=${TOKEN_NAME}" | grep -o '"token":"[^"]*' | cut -d'"' -f4)
    
    if [ -z "$SONARQUBE_TOKEN" ]; then
        error "Failed to generate SonarQube token"
        exit 1
    fi
    
    log "✓ Token generated: ${SONARQUBE_TOKEN:0:10}..."
}

# Save credentials to .env.local
save_credentials() {
    log "Saving credentials to $ENV_FILE"
    
    cat > "$ENV_FILE" << EOF
# SonarQube Setup - Generated at $TIMESTAMP
# Created by sonarqube-setup.sh

# SonarQube Connection
SONARQUBE_URL="http://localhost:${SONARQUBE_PORT}"
SONARQUBE_TOKEN="${SONARQUBE_TOKEN}"
SONARQUBE_USER="${SONARQUBE_USER}"
SONARQUBE_PASSWORD="${SONARQUBE_PASSWORD}"

# Database Connection (for reference)
POSTGRES_URL="postgresql://sonar:sonarpassword@localhost:5432/sonarqube"

# Project Configuration
PROJECT_KEY="local-project-$(date +%s)"
LANGUAGES_DETECTED="auto"

# SonarQube Web UI
# Visit: http://localhost:${SONARQUBE_PORT}
# Login with credentials above
EOF
    
    log "✓ Credentials saved to $ENV_FILE"
    log "⚠️  DO NOT commit $ENV_FILE to version control"
}

# Print summary
print_summary() {
    log ""
    log "================================"
    log "SonarQube Setup Complete ✓"
    log "================================"
    log ""
    log "Connection Details:"
    log "  URL:      http://localhost:${SONARQUBE_PORT}"
    log "  User:     ${SONARQUBE_USER}"
    log "  Password: ${SONARQUBE_PASSWORD}"
    log "  Token:    ${SONARQUBE_TOKEN:0:20}..."
    log ""
    log "Next Steps:"
    log "  1. Open http://localhost:${SONARQUBE_PORT} in your browser"
    log "  2. Login with admin credentials above"
    log "  3. Create a new project"
    log "  4. Run sonarqube-scan.sh to scan your repository"
    log ""
    log "Cleanup (when done):"
    log "  Run: ./sonarqube-cleanup.sh"
    log ""
}

# Main execution
main() {
    log "SonarQube Local Setup - $(date)"
    log "================================"
    log ""
    
    check_prerequisites
    log ""
    
    check_port
    log ""
    
    create_network
    log ""
    
    create_volumes
    log ""
    
    start_postgres
    log ""
    
    start_sonarqube
    log ""
    
    generate_token
    log ""
    
    save_credentials
    log ""
    
    print_summary
    
    log "Setup log saved to: $SETUP_LOG"
}

# Run main function
main "$@"
