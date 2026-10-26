# AI VTuber Framework Lite - Запуск
$Host.UI.RawUI.WindowTitle = 'AI VTuber Framework Lite'

Write-Host '==============================================' -ForegroundColor Magenta
Write-Host '  AI VTuber Framework Lite - Запуск' -ForegroundColor Magenta
Write-Host '==============================================' -ForegroundColor Magenta

if (-not (Test-Path 'node_modules')) {
    Write-Host '[1/3] Установка зависимостей...' -ForegroundColor Cyan
    npm install
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

if (-not (Test-Path 'dist\server\index.js')) {
    Write-Host '[2/3] Сборка проекта...' -ForegroundColor Cyan
    npm run build
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

if (-not (Test-Path '.env')) {
    Copy-Item '.env.example' '.env'
}

Write-Host '[3/3] Запуск приложения...' -ForegroundColor Green
npm start
