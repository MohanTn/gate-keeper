# SonarQube Setup Script for Windows (PowerShell)
# Sets up local SonarQube Docker instance with PostgreSQL backend
# Usage: .\sonarqube-setup.ps1

param(
    [int]$Port = 9000
)

# Configuration
$SONARQUBE_PORT = $Port
$SONARQUBE_VERSION = "latest"
$POSTGRES_VERSION = "15"
$DOCKER_NETWORK = "sonarqube-network"
$DOCKER_VOLUME_DB = "sonarqube-db-volume"
$DOCKER_VOLUME_DATA = "sonarqube-data-volume"
$ENV_FILE = ".env.local"
$TIMESTAMP = Get-Date -Format "yyyyMMdd_HHmmss"
$SETUP_LOG = "sonarqube-setup-${TIMESTAMP}.log"

# Helper functions
function Write-Log {
    param([string]$Message, [string]$Level = "INFO")
    $Color = switch ($Level) {
        "INFO" { "Green" }
        "WARN" { "Yellow" }
        "ERROR" { "Red" }
    }
    Write-Host "[$Level] $Message" -ForegroundColor $Color
    Add-Content -Path $SETUP_LOG -Value "[${Level}] $Message"
}

function Test-Prerequisites {
    Write-Log "Checking prerequisites..." "INFO"
    
    # Check Docker
    if (-not (Test-Path "C:\Program Files\Docker\Docker\resources\bin\docker.exe")) {
        Write-Log "Docker is not installed. Please install Docker Desktop for Windows." "ERROR"
        exit 1
    }
    
    $dockerVersion = docker --version
    Write-Log "✓ Docker found: $dockerVersion" "INFO"
    
    # Check Docker daemon
    try {
        docker info | Out-Null
        Write-Log "✓ Docker daemon is running" "INFO"
    }
    catch {
        Write-Log "Docker daemon is not running. Please start Docker Desktop." "ERROR"
        exit 1
    }
    
    # Check Git
    if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
        Write-Log "Git is not installed. Please install Git for Windows." "ERROR"
        exit 1
    }
    
    $gitVersion = git --version
    Write-Log "✓ Git found: $gitVersion" "INFO"
    
    Write-Log "✓ All prerequisites met" "INFO"
}

function Test-Port {
    $netstat = netstat -aon | Select-String ":$SONARQUBE_PORT"
    if ($netstat) {
        Write-Log "Port $SONARQUBE_PORT is already in use" "WARN"
        $script:SONARQUBE_PORT = $SONARQUBE_PORT + 1
        Write-Log "Using alternate port: $SONARQUBE_PORT" "INFO"
    }
}

function New-DockerNetwork {
    Write-Log "Creating Docker network: $DOCKER_NETWORK" "INFO"
    
    $exists = docker network inspect $DOCKER_NETWORK 2>$null
    if ($exists) {
        Write-Log "✓ Network already exists" "INFO"
    }
    else {
        docker network create $DOCKER_NETWORK --driver bridge
        Write-Log "✓ Network created" "INFO"
    }
}

function New-DockerVolumes {
    Write-Log "Creating Docker volumes" "INFO"
    
    @($DOCKER_VOLUME_DB, $DOCKER_VOLUME_DATA) | ForEach-Object {
        $exists = docker volume inspect $_ 2>$null
        if ($exists) {
            Write-Log "✓ Volume $_ already exists" "INFO"
        }
        else {
            docker volume create $_
            Write-Log "✓ Volume $_ created" "INFO"
        }
    }
}

function Start-PostgreSQL {
    Write-Log "Starting PostgreSQL database..." "INFO"
    
    $exists = docker ps -a --filter "name=sonarqube-postgres" --quiet
    if ($exists) {
        Write-Log "PostgreSQL container exists, starting..." "INFO"
        docker start sonarqube-postgres
    }
    else {
        docker run -d `
            --name sonarqube-postgres `
            --network $DOCKER_NETWORK `
            -v "${DOCKER_VOLUME_DB}:/var/lib/postgresql/data" `
            -e POSTGRES_USER=sonar `
            -e POSTGRES_PASSWORD=sonarpassword `
            -e POSTGRES_DB=sonarqube `
            "postgres:${POSTGRES_VERSION}" `
            postgres -c max_wal_size=1GB
    }
    
    Write-Log "✓ PostgreSQL started, waiting for readiness..." "INFO"
    
    # Wait for PostgreSQL to be ready
    $maxAttempts = 30
    $attempt = 0
    while ($attempt -lt $maxAttempts) {
        try {
            docker exec sonarqube-postgres pg_isready -U sonar 2>$null | Out-Null
            Write-Log "✓ PostgreSQL is ready" "INFO"
            return
        }
        catch {
            $attempt++
            Start-Sleep -Seconds 1
        }
    }
    
    Write-Log "PostgreSQL failed to start after $maxAttempts seconds" "ERROR"
    exit 1
}

function Start-SonarQube {
    Write-Log "Starting SonarQube server..." "INFO"
    
    $exists = docker ps -a --filter "name=sonarqube" --quiet
    if ($exists) {
        Write-Log "SonarQube container exists, starting..." "INFO"
        docker start sonarqube
    }
    else {
        docker run -d `
            --name sonarqube `
            --network $DOCKER_NETWORK `
            -p "${SONARQUBE_PORT}:9000" `
            -v "${DOCKER_VOLUME_DATA}:/opt/sonarqube/data" `
            -e SONAR_JDBC_URL="jdbc:postgresql://sonarqube-postgres:5432/sonarqube" `
            -e SONAR_JDBC_USERNAME=sonar `
            -e SONAR_JDBC_PASSWORD=sonarpassword `
            "sonarqube:${SONARQUBE_VERSION}-community"
    }
    
    Write-Log "✓ SonarQube container started, waiting for readiness..." "INFO"
    
    # Wait for SonarQube to be ready
    $maxAttempts = 60
    $attempt = 0
    while ($attempt -lt $maxAttempts) {
        try {
            $response = Invoke-RestMethod -Uri "http://localhost:${SONARQUBE_PORT}/api/system/status" -ErrorAction SilentlyContinue
            if ($response.status -eq "UP") {
                Write-Log "✓ SonarQube is ready" "INFO"
                return
            }
        }
        catch {
            $attempt++
            Start-Sleep -Seconds 1
        }
    }
    
    Write-Log "SonarQube failed to start after $maxAttempts seconds" "ERROR"
    docker logs sonarqube | Select-Object -Last 20
    exit 1
}

function Get-AuthToken {
    Write-Log "Generating SonarQube authentication token..." "INFO"
    
    $sonarqubeUser = "admin"
    $sonarqubePassword = "admin"
    $tokenName = "github-copilot-${TIMESTAMP}"
    
    $authHeader = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes("${sonarqubeUser}:${sonarqubePassword}"))
    
    try {
        $response = Invoke-RestMethod -Uri "http://localhost:${SONARQUBE_PORT}/api/user_tokens/generate" `
            -Method POST `
            -Headers @{"Authorization" = "Basic $authHeader"} `
            -Body @{name = $tokenName } `
            -ContentType "application/x-www-form-urlencoded"
        
        $script:SONARQUBE_TOKEN = $response.token
        $script:SONARQUBE_USER = $sonarqubeUser
        $script:SONARQUBE_PASSWORD = $sonarqubePassword
        
        Write-Log "✓ Token generated: $($SONARQUBE_TOKEN.Substring(0, 10))..." "INFO"
    }
    catch {
        Write-Log "Failed to generate SonarQube token: $_" "ERROR"
        exit 1
    }
}

function Save-Credentials {
    Write-Log "Saving credentials to $ENV_FILE" "INFO"
    
    $content = @"
# SonarQube Setup - Generated at $TIMESTAMP
# Created by sonarqube-setup.ps1

# SonarQube Connection
SONARQUBE_URL="http://localhost:${SONARQUBE_PORT}"
SONARQUBE_TOKEN="${SONARQUBE_TOKEN}"
SONARQUBE_USER="${SONARQUBE_USER}"
SONARQUBE_PASSWORD="${SONARQUBE_PASSWORD}"

# Database Connection (for reference)
POSTGRES_URL="postgresql://sonar:sonarpassword@localhost:5432/sonarqube"

# Project Configuration
PROJECT_KEY="local-project-$(Get-Date -Format 'yyyyMMddHHmmss')"
LANGUAGES_DETECTED="auto"

# SonarQube Web UI
# Visit: http://localhost:${SONARQUBE_PORT}
# Login with credentials above
"@
    
    Set-Content -Path $ENV_FILE -Value $content
    Write-Log "✓ Credentials saved to $ENV_FILE" "INFO"
    Write-Log "⚠️  DO NOT commit $ENV_FILE to version control" "WARN"
}

function Print-Summary {
    Write-Log "" "INFO"
    Write-Log "================================" "INFO"
    Write-Log "SonarQube Setup Complete ✓" "INFO"
    Write-Log "================================" "INFO"
    Write-Log "" "INFO"
    Write-Log "Connection Details:" "INFO"
    Write-Log "  URL:      http://localhost:${SONARQUBE_PORT}" "INFO"
    Write-Log "  User:     ${SONARQUBE_USER}" "INFO"
    Write-Log "  Password: ${SONARQUBE_PASSWORD}" "INFO"
    Write-Log "  Token:    $($SONARQUBE_TOKEN.Substring(0, 20))..." "INFO"
    Write-Log "" "INFO"
    Write-Log "Next Steps:" "INFO"
    Write-Log "  1. Open http://localhost:${SONARQUBE_PORT} in your browser" "INFO"
    Write-Log "  2. Login with admin credentials above" "INFO"
    Write-Log "  3. Create a new project" "INFO"
    Write-Log "  4. Run sonarqube-scan.ps1 to scan your repository" "INFO"
    Write-Log "" "INFO"
    Write-Log "Cleanup (when done):" "INFO"
    Write-Log "  Run: .\sonarqube-cleanup.ps1" "INFO"
    Write-Log "" "INFO"
}

# Main execution
function Main {
    Write-Log "SonarQube Local Setup - $(Get-Date)" "INFO"
    Write-Log "================================" "INFO"
    Write-Log "" "INFO"
    
    Test-Prerequisites
    Write-Log "" "INFO"
    
    Test-Port
    Write-Log "" "INFO"
    
    New-DockerNetwork
    Write-Log "" "INFO"
    
    New-DockerVolumes
    Write-Log "" "INFO"
    
    Start-PostgreSQL
    Write-Log "" "INFO"
    
    Start-SonarQube
    Write-Log "" "INFO"
    
    Get-AuthToken
    Write-Log "" "INFO"
    
    Save-Credentials
    Write-Log "" "INFO"
    
    Print-Summary
    
    Write-Log "Setup log saved to: $SETUP_LOG" "INFO"
}

# Run main
Main
