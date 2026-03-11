@echo off
chcp 65001 >nul
echo ==========================================
echo     📊 智能图表生成器启动脚本
echo ==========================================
echo.

cd /d "%~dp0"

:: 检查 Node.js
node --version >nul 2>&1
if errorlevel 1 (
    echo ❌ 错误: 未检测到 Node.js，请先安装 Node.js
    pause
    exit /b 1
)

echo ✅ Node.js 已安装
node --version
echo.

:: 安装后端依赖
echo 📦 安装后端依赖...
cd backend
if not exist "node_modules" (
    call npm install
    if errorlevel 1 (
        echo ❌ 依赖安装失败
        pause
        exit /b 1
    )
) else (
    echo ✅ 依赖已安装
)

echo.
echo 🚀 启动后端服务...
echo    访问地址: http://localhost:3000
echo    API 地址: http://localhost:3000/api
echo.
echo 按 Ctrl+C 停止服务
echo.

:: 启动服务
npm run dev

pause
