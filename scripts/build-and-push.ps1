<#
.SYNOPSIS
  Compila y sube las imágenes Docker de KroserBot a Docker Hub (alfredobartaburu/kroserbot).

.EXAMPLE
  .\scripts\build-and-push.ps1
  .\scripts\build-and-push.ps1 -Tag "1.0.0"
#>

param (
  [string]$Tag = "latest",
  [string]$DockerUser = "alfredobartaburu"
)

$ErrorActionPreference = "Stop"

Write-Host "======================================================" -ForegroundColor Cyan
Write-Host "  Compilando y Publicando Imagen Docker en Docker Hub " -ForegroundColor Cyan
Write-Host "  Usuario: $DockerUser | Tag: $Tag" -ForegroundColor Cyan
Write-Host "======================================================" -ForegroundColor Cyan

# 1. Login verification
Write-Host "`n[1/4] Verificando sesión en Docker Hub..." -ForegroundColor Yellow
docker login

# 2. Build Backend / App Image
Write-Host "`n[2/4] Compilando imagen principal ($DockerUser/kroserbot:$Tag)..." -ForegroundColor Yellow
docker build -t "$DockerUser/kroserbot:$Tag" -t "$DockerUser/kroserbot:latest" -f Dockerfile .

# 3. Build Scraper Image
Write-Host "`n[3/4] Compilando imagen del Scraper ($DockerUser/kroserbot-scraper:$Tag)..." -ForegroundColor Yellow
docker build -t "$DockerUser/kroserbot-scraper:$Tag" -t "$DockerUser/kroserbot-scraper:latest" -f scraper/Dockerfile .

# 4. Push images to Docker Hub
Write-Host "`n[4/4] Subiendo imágenes a Docker Hub..." -ForegroundColor Yellow
docker push "$DockerUser/kroserbot:$Tag"
docker push "$DockerUser/kroserbot:latest"
docker push "$DockerUser/kroserbot-scraper:$Tag"
docker push "$DockerUser/kroserbot-scraper:latest"

Write-Host "`n======================================================" -ForegroundColor Green
Write-Host "  ¡Imágenes publicadas con éxito en Docker Hub!  " -ForegroundColor Green
Write-Host "  - docker pull $DockerUser/kroserbot:latest" -ForegroundColor Green
Write-Host "  - docker pull $DockerUser/kroserbot-scraper:latest" -ForegroundColor Green
Write-Host "======================================================" -ForegroundColor Green
