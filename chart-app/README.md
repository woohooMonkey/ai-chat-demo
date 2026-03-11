# 📊 智能图表生成器

一个基于自然语言的智能图表生成 Web 应用。用户输入文本描述，系统自动解析数据并生成可视化图表。

## 🎯 功能特性

- 🤖 **自然语言输入** - 支持中文文本描述，如"苹果10个，梨子20个"
- 📈 **多种图表类型** - 自动判断并生成柱状图、折线图、饼图
- ⚡ **实时生成** - 调用 MCP 服务快速生成图表
- 📚 **历史记录** - 保存生成历史，方便查看和下载
- 🎨 **美观界面** - 现代化 UI 设计，响应式布局

## 🏗️ 系统架构

```
用户输入 → 后端解析 → LLM/Kimi 提取数据 → MCP 生成图表 → 返回图片 URL
```

## 📁 项目结构

```
chart-app/
├── backend/              # 后端服务 (Node.js + Express)
│   ├── src/
│   │   ├── app.ts        # 主应用入口
│   │   ├── routes/
│   │   │   └── chartRoutes.ts
│   │   └── services/
│   │       └── chartService.ts
│   ├── package.json
│   └── tsconfig.json
│
├── frontend/             # 前端界面
│   └── index.html        # 单页面应用
│
└── README.md
```

## 🚀 快速开始

### 1. 安装后端依赖

```bash
cd backend
npm install
```

### 2. 启动后端服务

```bash
npm run dev
```

后端服务将运行在 `http://localhost:3000`

### 3. 打开前端页面

直接打开 `frontend/index.html` 文件，或使用本地服务器：

```bash
# 使用 Python 简单 HTTP 服务器
cd frontend
python -m http.server 8080

# 或使用 Node.js
npx serve .
```

访问 `http://localhost:8080`

## 🔌 API 接口

### 生成图表

```http
POST /api/generate
Content-Type: application/json

{
  "text": "苹果10个，梨子20个，桃子100个",
  "options": {
    "width": 800,
    "height": 600
  }
}
```

响应：

```json
{
  "success": true,
  "data": {
    "imageUrl": "/charts/chart_xxx.png",
    "chartType": "bar",
    "title": "水果统计",
    "parsedData": {
      "chartType": "bar",
      "title": "水果统计",
      "data": [
        {"name": "苹果", "value": 10},
        {"name": "梨子", "value": 20},
        {"name": "桃子", "value": 100}
      ]
    }
  }
}
```

### 获取历史记录

```http
GET /api/charts
```

## 📝 使用示例

支持多种自然语言格式：

- **简单列举**：苹果10个，梨子20个，桃子100个
- **时间序列**：一季度50万，二季度80万，三季度120万
- **城市数据**：北京2000万人，上海2500万人，广州1500万人
- **温度变化**：周一30度，周二32度，周三35度

## ⚙️ 配置说明

### 环境变量 (backend/.env)

```bash
# 服务器端口
PORT=3000

# Kimi API 配置 (用于复杂文本解析)
KIMI_API_KEY=your_api_key_here

# MCP 服务配置
MCP_SERVER_URL=http://localhost:1123
```

## 🔧 技术栈

### 后端
- **Node.js** + **Express** - Web 框架
- **TypeScript** - 类型安全
- **MCP SDK** - 调用图表服务
- **Axios** - HTTP 客户端

### 前端
- **原生 HTML/JS** - 无框架依赖
- **现代 CSS** - Flexbox/Grid 布局
- **Fetch API** - 后端通信

### 图表服务
- **@antv/mcp-server-chart** - MCP 图表生成服务
- **AntV G2Plot** - 图表渲染引擎

## 🐛 常见问题

### 1. MCP 服务调用失败

确保已安装 `@antv/mcp-server-chart`：

```bash
npm install -g @antv/mcp-server-chart
# 或使用 npx
npx -y @antv/mcp-server-chart
```

### 2. 跨域问题

后端已配置 CORS，如果仍有跨域问题，请检查：
- 后端服务是否正常运行
- 前端访问地址是否正确

### 3. 图片无法显示

检查 `backend/public/charts` 目录是否存在且有写入权限。

## 📄 License

MIT License
