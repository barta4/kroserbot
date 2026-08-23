#!/usr/bin/env bash
# ==========================================================
# KroserBot - Docker Hub Build & Push Script
# User: alfredobartaburu
# ==========================================================

set -e

TAG="${1:-latest}"
DOCKER_USER="${2:-alfredobartaburu}"

echo "======================================================"
echo "  Compilando y Publicando Imagen Docker en Docker Hub "
echo "  Usuario: $DOCKER_USER | Tag: $TAG"
echo "======================================================"

# 1. Login
echo -e "\n[1/4] Verificando sesión en Docker Hub..."
docker login

# 2. Build App Image
echo -e "\n[2/4] Compilando imagen principal ($DOCKER_USER/kroserbot:$TAG)..."
docker build -t "$DOCKER_USER/kroserbot:$TAG" -t "$DOCKER_USER/kroserbot:latest" -f Dockerfile .

# 3. Build Scraper Image
echo -e "\n[3/4] Compilando imagen del Scraper ($DOCKER_USER/kroserbot-scraper:$TAG)..."
docker build -t "$DOCKER_USER/kroserbot-scraper:$TAG" -t "$DOCKER_USER/kroserbot-scraper:latest" -f scraper/Dockerfile .

# 4. Push to Docker Hub
echo -e "\n[4/4] Subiendo imágenes a Docker Hub..."
docker push "$DOCKER_USER/kroserbot:$TAG"
docker push "$DOCKER_USER/kroserbot:latest"
docker push "$DOCKER_USER/kroserbot-scraper:$TAG"
docker push "$DOCKER_USER/kroserbot-scraper:latest"

echo "======================================================"
echo "  ¡Imágenes publicadas con éxito en Docker Hub!"
echo "  - docker pull $DOCKER_USER/kroserbot:latest"
echo "  - docker pull $DOCKER_USER/kroserbot-scraper:latest"
echo "======================================================"
