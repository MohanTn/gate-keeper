#!/bin/bash
#
# SonarQube Cleanup Script
# Stops Docker containers and frees resources
#
# Usage: ./sonarqube-cleanup.sh [OPTIONS]
#   --all         Remove everything (containers, volumes, network, generated files)
#   --keep-data   Keep Docker volumes for faster restart
#   --force       Skip confirmation prompt
#   --help        Show this help message
#

set -e

# Colors for output (matches sonarqube-setup.sh)
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

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
    echo -e "${BLUE}[CLEANUP]${NC} $1"
}

usage() {
    echo "Usage: $0 [OPTIONS]"
    echo ""
    echo "Stops SonarQube Docker containers and frees resources."
    echo ""
    echo "Options:"
    echo "  --all         Remove everything (containers, volumes, network, files)"
    echo "  --keep-data   Keep Docker volumes for faster restart"
    echo "  --force       Skip confirmation prompt"
    echo "  --help        Show this help message"
    echo ""
    echo "Modes:"
    echo "  Default:      Stop and remove containers only"
    echo "  --keep-data:  Stop containers, keep volumes (fast restart)"
    echo "  --all:        Full cleanup (containers + volumes + network + files)"
    exit 0
}

# Options
REMOVE_ALL=false
KEEP_DATA=false
FORCE=false

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --all)
            REMOVE_ALL=true
            shift
            ;;
        --keep-data)
            KEEP_DATA=true
            shift
            ;;
        --force)
            FORCE=true
            shift
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

# Determine repo root
REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)

echo ""
echo "================================================================================"
echo "SonarQube Cleanup"
echo "================================================================================"
echo ""

# Confirmation prompt for destructive actions (unless --force)
if [ "$REMOVE_ALL" = true ] && [ "$FORCE" = false ]; then
    echo -e "${YELLOW}This will remove ALL SonarQube containers, volumes, network, and generated files.${NC}"
    echo -e "${YELLOW}Scan data and configuration will be permanently deleted.${NC}"
    echo ""
    read -p "Are you sure? (y/N) " -n 1 -r
    echo ""
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        log "Cleanup cancelled."
        exit 0
    fi
    echo ""
fi

# Stop and remove containers
info "Stopping containers..."

if docker ps -a --filter "name=^sonarqube$" --quiet 2>/dev/null | grep -q .; then
    docker stop sonarqube 2>/dev/null || true
    docker rm sonarqube 2>/dev/null || true
    log "SonarQube container removed"
else
    log "SonarQube container not found (already removed)"
fi

if docker ps -a --filter "name=^sonarqube-postgres$" --quiet 2>/dev/null | grep -q .; then
    docker stop sonarqube-postgres 2>/dev/null || true
    docker rm sonarqube-postgres 2>/dev/null || true
    log "PostgreSQL container removed"
else
    log "PostgreSQL container not found (already removed)"
fi

# Remove volumes (if --all and not --keep-data)
if [ "$REMOVE_ALL" = true ] && [ "$KEEP_DATA" = false ]; then
    info "Removing Docker volumes..."

    for volume in sonarqube-db-volume sonarqube-data-volume sonarqube-logs-volume sonarqube-extensions-volume; do
        if docker volume inspect "$volume" &> /dev/null; then
            docker volume rm "$volume" 2>/dev/null || true
            log "Volume $volume removed"
        fi
    done
fi

# Remove network (if --all)
if [ "$REMOVE_ALL" = true ]; then
    info "Removing Docker network..."

    if docker network inspect sonarqube-network &> /dev/null; then
        docker network rm sonarqube-network 2>/dev/null || true
        log "Network sonarqube-network removed"
    else
        log "Network sonarqube-network not found (already removed)"
    fi
fi

# Clean generated files (if --all)
if [ "$REMOVE_ALL" = true ]; then
    info "Cleaning generated files..."

    # .env.local
    if [ -f "${REPO_ROOT}/.env.local" ]; then
        rm -f "${REPO_ROOT}/.env.local"
        log "Removed .env.local"
    fi

    # sonar-project.properties
    if [ -f "${REPO_ROOT}/sonar-project.properties" ]; then
        rm -f "${REPO_ROOT}/sonar-project.properties"
        log "Removed sonar-project.properties"
    fi

    # Setup logs
    for logfile in "${REPO_ROOT}"/sonarqube-setup-*.log; do
        if [ -f "$logfile" ]; then
            rm -f "$logfile"
            log "Removed $(basename "$logfile")"
        fi
    done

    # Scanner work directories
    if [ -d "${REPO_ROOT}/.sonarqube" ]; then
        rm -rf "${REPO_ROOT}/.sonarqube"
        log "Removed .sonarqube/"
    fi

    if [ -d "${REPO_ROOT}/.scannerwork" ]; then
        rm -rf "${REPO_ROOT}/.scannerwork"
        log "Removed .scannerwork/"
    fi
fi

echo ""
log "================================"
log "Cleanup Complete"
log "================================"
echo ""

if [ "$REMOVE_ALL" = true ] && [ "$KEEP_DATA" = false ]; then
    log "All SonarQube resources have been removed."
    log "Run sonarqube-setup.sh to start fresh."
elif [ "$KEEP_DATA" = true ]; then
    log "Containers stopped. Volumes preserved for faster restart."
    log "Run sonarqube-setup.sh to restart (will reuse existing data)."
else
    log "Containers stopped and removed."
    log "Volumes and network still exist for quick restart."
    log "Use --all to remove everything."
fi
echo ""
