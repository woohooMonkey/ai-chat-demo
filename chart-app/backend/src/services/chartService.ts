import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import axios from 'axios';
import Anthropic from '@anthropic-ai/sdk';

// 初始化 Claude 客户端
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || ''
});

interface GenerateChartRequest {
  text: string;
  options?: {
    width?: number;
    height?: number;
    theme?: string;
  };
}

interface ParsedChartData {
  toolName: string;
  arguments: Record<string, any>;
  title: string;
}

interface ChartResult {
  success: boolean;
  data?: {
    imageUrl: string;
    toolName: string;
    title: string;
    parsedData: ParsedChartData;
    sqlQuery?: string;
    rawData?: any[];
  };
  error?: {
    code: string;
    message: string;
  };
}

interface MCPTool {
  name: string;
  description: string;
  inputSchema: {
    type: string;
    properties: Record<string, any>;
    required?: string[];
  };
}

interface LLMResponse {
  needDatabase: boolean;
  sqlQuery?: string;
  chartData?: {
    toolName: string;
    title: string;
    arguments: Record<string, any>;
  };
}

// 内存存储图表历史
const chartHistory: Array<{
  id: string;
  imageUrl: string;
  originalText: string;
  toolName: string;
  sqlQuery?: string;
  createdAt: string;
}> = [];

// MCP 工具缓存
let cachedChartTools: MCPTool[] | null = null;
let chartToolsCacheTime: number = 0;
const TOOLS_CACHE_TTL = 5 * 60 * 1000; // 5分钟缓存

// 工具描述缓存（避免重复构建字符串）
let cachedToolsDescription: string | null = null;

// MySQL 配置
const MYSQL_CONFIG = {
  host: process.env.MYSQL_HOST || 'localhost',
  user: process.env.MYSQL_USER || 'root',
  password: process.env.MYSQL_PASSWORD || '',
  database: process.env.MYSQL_DATABASE || 'test'
};

// 清除工具缓存
function clearToolsCache() {
  cachedChartTools = null;
  chartToolsCacheTime = 0;
  cachedToolsDescription = null;
}

// 启动时清除缓存
clearToolsCache();

export class ChartService {
  /**
   * 获取图表 MCP 工具列表
   */
  private async getChartMCPTools(): Promise<MCPTool[]> {
    if (cachedChartTools && Date.now() - chartToolsCacheTime < TOOLS_CACHE_TTL) {
      return cachedChartTools;
    }

    return new Promise((resolve, reject) => {
      const mcpProcess = spawn('npx', ['-y', '@antv/mcp-server-chart'], {
        shell: true,
        cwd: process.cwd()
      });

      let stdout = '';
      const timeout = setTimeout(() => {
        mcpProcess.kill();
        reject(new Error('获取 MCP 工具列表超时'));
      }, 30000);

      mcpProcess.stdout.on('data', (chunk) => {
        stdout += chunk.toString();
      });

      mcpProcess.on('close', () => {
        clearTimeout(timeout);
        try {
          const response = JSON.parse(stdout.trim());
          const tools = response.result?.tools || [];
          cachedChartTools = tools;
          chartToolsCacheTime = Date.now();
          resolve(tools);
        } catch (error: any) {
          reject(new Error(`解析工具列表失败: ${error.message}`));
        }
      });

      mcpProcess.on('error', (err: Error) => {
        clearTimeout(timeout);
        reject(new Error(`MCP 进程启动失败: ${err.message}`));
      });

      const listToolsRequest = {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list',
        params: {}
      };

      mcpProcess.stdin.write(JSON.stringify(listToolsRequest) + '\n');
      mcpProcess.stdin.end();
    });
  }

  /**
   * 获取 MySQL MCP 工具列表
   */
  private async getMySQLMCPTools(): Promise<MCPTool[]> {
    return new Promise((resolve, reject) => {
      const mcpProcess = spawn('npx', ['-y', '@f4ww4z/mcp-mysql-server'], {
        shell: true,
        cwd: process.cwd()
      });

      let stdout = '';
      const timeout = setTimeout(() => {
        mcpProcess.kill();
        reject(new Error('获取 MySQL MCP 工具列表超时'));
      }, 30000);

      mcpProcess.stdout.on('data', (chunk) => {
        stdout += chunk.toString();
      });

      mcpProcess.on('close', ( ) => {
        clearTimeout(timeout);
        try {
          const response = JSON.parse(stdout.trim());
          resolve(response.result?.tools || []);
        } catch (error: any) {
          reject(new Error(`解析 MySQL 工具列表失败: ${error.message}`));
        }
      });

      mcpProcess.on('error', (err: Error) => {
        clearTimeout(timeout);
        reject(new Error(`MySQL MCP 进程启动失败: ${err.message}`));
      });

      const listToolsRequest = {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list',
        params: {}
      };

      mcpProcess.stdin.write(JSON.stringify(listToolsRequest) + '\n');
      mcpProcess.stdin.end();
    });
  }

  /**
   * 获取数据库表结构信息（包含列信息）
   */
  private async getDatabaseSchema(): Promise<string> {
    console.log('📊 连接 MySQL...', MYSQL_CONFIG);
    return new Promise((resolve, reject) => {
      const mcpProcess = spawn('npx', ['-y', '@f4ww4z/mcp-mysql-server'], {
        shell: true,
        cwd: process.cwd(),
        env: { ...process.env }
      });

      let stdout = '';
      const requiredResponses = 3; // connect + list_tables + describe_table

      const timeout = setTimeout(() => {
        console.log('⏰ MySQL MCP 超时，当前输出:', stdout.substring(0, 500));
        mcpProcess.kill();
        reject(new Error('获取数据库结构超时'));
      }, 60000);

      mcpProcess.stdout.on('data', (chunk) => {
        stdout += chunk.toString();
        // 检查是否收到了足够的响应
        const lines = stdout.trim().split('\n').filter(l => l.includes('jsonrpc'));
        if (lines.length >= requiredResponses) {
          clearTimeout(timeout);
          try {
            const allLines = stdout.trim().split('\n');

            // 获取表列表
            let tables: string[] = [];
            for (const line of allLines) {
              if (line.includes('"id":2') || line.includes('"id": 2')) {
                const tablesResult = JSON.parse(line);
                const tablesText = tablesResult.result?.content?.[0]?.text || '[]';
                const tablesData = JSON.parse(tablesText);
                tables = tablesData.map((t: any) => Object.values(t)[0]);
              }
            }

            // 获取第一个表的结构
            let schemaInfo = `数据库表: ${tables.join(', ')}\n\n`;
            for (const line of allLines) {
              if (line.includes('"id":3') || line.includes('"id": 3')) {
                const descResult = JSON.parse(line);
                const descText = descResult.result?.content?.[0]?.text || '[]';
                const columns = JSON.parse(descText);
                schemaInfo += `表结构 (sales_orders):\n`;
                schemaInfo += columns.map((c: any) =>
                  `  - ${c.Field}: ${c.Type} ${c.Key === 'PRI' ? '(主键)' : ''}`
                ).join('\n');
              }
            }

            resolve(schemaInfo);
            mcpProcess.kill();
            return;
          } catch (e) {
            reject(new Error('解析数据库结构失败'));
            mcpProcess.kill();
          }
        }
      });

      mcpProcess.on('error', (err: Error) => {
        clearTimeout(timeout);
        reject(new Error(`MySQL MCP 进程启动失败: ${err.message}`));
      });

      // 发送请求：连接 -> 获取表列表 -> 获取表结构
      const requests = [
        {
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name: 'connect_db', arguments: MYSQL_CONFIG }
        },
        {
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/call',
          params: { name: 'list_tables', arguments: {} }
        },
        {
          jsonrpc: '2.0',
          id: 3,
          method: 'tools/call',
          params: { name: 'describe_table', arguments: { table: 'sales_orders' } }
        }
      ];

      requests.forEach(req => mcpProcess.stdin.write(JSON.stringify(req) + '\n'));
      mcpProcess.stdin.end();
    });
  }

  /**
   * 执行 SQL 查询
   */
  private async executeSQLQuery(sql: string): Promise<any[]> {
    console.log('📊 执行 SQL:', sql);
    return new Promise((resolve, reject) => {
      const mcpProcess = spawn('npx', ['-y', '@f4ww4z/mcp-mysql-server'], {
        shell: true,
        cwd: process.cwd(),
        env: { ...process.env }
      });

      let stdout = '';

      const timeout = setTimeout(() => {
        console.log('⏰ SQL 查询超时，当前输出:', stdout.substring(0, 500));
        mcpProcess.kill();
        reject(new Error('SQL 查询超时'));
      }, 90000);

      mcpProcess.stdout.on('data', (chunk) => {
        stdout += chunk.toString();
        // 检查是否收到了查询响应
        const lines = stdout.trim().split('\n').filter(l => l.includes('jsonrpc'));
        if (lines.length >= 2) {
          clearTimeout(timeout);
          try {
            const allLines = stdout.trim().split('\n');
            // 找到查询响应（id:2）
            for (const line of allLines) {
              if (line.includes('"id":2') || line.includes('"id": 2')) {
                const queryResult = JSON.parse(line);
                if (queryResult.error) {
                  reject(new Error(`SQL 执行失败: ${queryResult.error.message}`));
                } else {
                  const data = queryResult.result?.content?.[0]?.text || '[]';
                  const parsedData = typeof data === 'string' ? JSON.parse(data) : data;
                  resolve(Array.isArray(parsedData) ? parsedData : [parsedData]);
                }
                mcpProcess.kill();
                return;
              }
            }
            resolve([]);
            mcpProcess.kill();
          } catch (e: any) {
            reject(new Error(`解析查询结果失败: ${e.message}`));
            mcpProcess.kill();
          }
        }
      });

      mcpProcess.on('error', (err: Error) => {
        clearTimeout(timeout);
        reject(new Error(`MySQL MCP 进程启动失败: ${err.message}`));
      });

      const requests = [
        {
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name: 'connect_db', arguments: MYSQL_CONFIG }
        },
        {
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/call',
          params: { name: 'query', arguments: { sql } }
        }
      ];

      requests.forEach(req => mcpProcess.stdin.write(JSON.stringify(req) + '\n'));
      mcpProcess.stdin.end();
    });
  }

  /**
   * 主流程：生成图表
   */
  async generateChart(request: GenerateChartRequest): Promise<ChartResult> {
    try {
      // Step 0: 获取工具列表
      console.log('📚 步骤0: 获取MCP工具列表...');
      const chartTools = await this.getChartMCPTools();
      console.log('✅ 图表工具:', chartTools.map(t => t.name).join(', '));

      // Step 1: 获取数据库结构（用于智能判断）
      let dbSchema = '';
      try {
        console.log('📊 获取数据库结构...');
        dbSchema = await this.getDatabaseSchema();
        console.log('✅ 数据库表:', dbSchema.substring(0, 200) + '...');
      } catch (error: any) {
        console.log('⚠️ 无法获取数据库结构:', error.message);
      }

      // Step 2: LLM 分析用户意图
      console.log('🔍 步骤1: 分析用户意图...');
      const llmResponse = await this.analyzeUserIntent(request.text, chartTools, dbSchema);
      console.log('✅ LLM 分析结果:', JSON.stringify(llmResponse, null, 2));

      let sqlQuery: string | undefined;
      let rawData: any[] | undefined;
      let chartData: ParsedChartData;

      // Step 3: 如果需要查询数据库
      if (llmResponse.needDatabase && llmResponse.sqlQuery) {
        console.log('🗄️ 步骤2: 执行SQL查询...');
        console.log('📝 SQL:', llmResponse.sqlQuery);

        try {
          rawData = await this.executeSQLQuery(llmResponse.sqlQuery);
          sqlQuery = llmResponse.sqlQuery;
          console.log('✅ 查询结果:', rawData.length, '条记录');
          console.log('📄 数据预览:', JSON.stringify(rawData.slice(0, 3), null, 2));

          // 用真实数据重新生成图表参数
          console.log('🔄 步骤3: 基于真实数据生成图表...');
          chartData = await this.generateChartFromData(request.text, rawData, chartTools);
        } catch (error: any) {
          console.error('❌ SQL 执行失败:', error.message);
          // 降级为模拟数据
          chartData = llmResponse.chartData || this.getDefaultChartData();
        }
      } else {
        // 直接使用 LLM 返回的图表数据（可能是模拟数据）
        chartData = llmResponse.chartData || this.getDefaultChartData();
      }

      console.log('✅ 图表参数:', JSON.stringify(chartData, null, 2));

      // Step 4: 调用 MCP 生成图表
      console.log('📊 步骤4: 调用MCP生成图表...');
      const imageUrl = await this.callChartMCPTool(chartData.toolName, chartData.arguments);
      console.log('✅ 图表生成:', imageUrl);

      // Step 5: 保存到历史记录
      const chartRecord = {
        id: uuidv4(),
        imageUrl,
        originalText: request.text,
        toolName: chartData.toolName,
        sqlQuery,
        createdAt: new Date().toISOString()
      };
      chartHistory.unshift(chartRecord);

      if (chartHistory.length > 50) {
        chartHistory.pop();
      }

      return {
        success: true,
        data: {
          imageUrl,
          toolName: chartData.toolName,
          title: chartData.title,
          parsedData: chartData,
          sqlQuery,
          rawData
        }
      };

    } catch (error: any) {
      console.error('❌ 生成图表失败:', error);
      return {
        success: false,
        error: {
          code: 'GENERATE_ERROR',
          message: error.message
        }
      };
    }
  }

  /**
   * 分析用户意图：是否需要数据库，生成 SQL 或图表参数
   */
  private async analyzeUserIntent(
    text: string,
    chartTools: MCPTool[],
    dbSchema: string
  ): Promise<LLMResponse> {
    const chartToolsDesc = this.buildToolsDescription(chartTools);

    // 优化：更清晰的 SQL 生成规则和字段映射
    const systemPrompt = `你是一个智能数据分析助手，能够判断是否需要查询数据库并生成SQL或图表数据。

## 可用的图表工具
${chartToolsDesc}

## 判断规则
1. 如果用户请求涉及"查询"、"统计"、"按...分组"、"各..."等关键词，需要查询数据库
2. 如果用户只是简单的数据展示（如"桃10，李5"），不需要查询数据库
3. 对于天气、股价等实时数据，数据库可能没有，使用模拟数据

## 关键字段映射（非常重要！）
根据用户请求中的词汇，选择正确的数据库字段：
- "地区" / "区域" / "华东/华北/华南" → 使用 region 字段
- "品类" / "分类" / "类别" / "电子产品/服装/食品" → 使用 category 字段
- "产品" / "商品名称" / "iPhone/运动鞋" → 使用 product_name 字段
- "日期" / "时间" / "月份" → 使用 order_date 字段
- "销售额" / "金额" / "总价" → 使用 amount 字段
- "数量" / "销量" → 使用 quantity 字段

## SQL 编写规则
1. **必须使用上述映射的正确字段名**
2. SELECT 中包含分组字段和聚合结果
3. 使用 SUM() 求和、COUNT() 计数、AVG() 平均
4. GROUP BY 使用正确的分组字段

## SQL 示例
- "按地区统计销售额": SELECT region, SUM(amount) as total_amount FROM sales_orders GROUP BY region
- "各品类销售额": SELECT category, SUM(amount) as total_amount FROM sales_orders GROUP BY category
- "各产品销售总额": SELECT product_name, SUM(amount) as total_amount FROM sales_orders GROUP BY product_name

## 返回格式（禁止使用注释！）
需要数据库时返回：
{"needDatabase": true, "sqlQuery": "SELECT 分组字段, 聚合函数(数值字段) as 别名 FROM sales_orders GROUP BY 分组字段"}

不需要数据库时返回：
{"needDatabase": false, "chartData": {"toolName": "generate_column_chart", "title": "标题", "arguments": {"data": [...], "title": "标题"}}}

只返回纯 JSON。`;

    const userPrompt = `## 用户请求
"${text}"

## 数据库表结构
${dbSchema || '(无法获取数据库结构)'}

请根据用户请求中的关键词（地区/品类/产品），选择正确的字段生成 SQL。`;

    try {
      // 使用 Claude SDK 调用
      const message = await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        system: systemPrompt,
        messages: [
          { role: 'user', content: userPrompt }
        ]
      });

      // 提取文本内容
      const content = message.content
        .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
        .map(block => block.text)
        .join('');

      console.log('🤖 Claude 原始返回:', content);

      let jsonStr = content.replace(/```json\s*/gi, '').replace(/```\s*/gi, '').trim();
      const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        jsonStr = jsonMatch[0];
      }

      return JSON.parse(jsonStr);
    } catch (error: any) {
      console.error('❌ Claude 分析失败:', error.message);
      return {
        needDatabase: false,
        chartData: this.getDefaultChartData()
      };
    }
  }

  /**
   * 基于真实数据生成图表参数
   */
  private async generateChartFromData(
    originalText: string,
    data: any[],
    chartTools: MCPTool[]
  ): Promise<ParsedChartData> {
    const chartToolsDesc = this.buildToolsDescription(chartTools);

    // 优化：更详细的图表选择指南和参数说明
    const systemPrompt = `你是数据可视化助手，将数据库查询结果转换为图表数据格式。

## 可用的图表工具
${chartToolsDesc}

## 图表类型选择指南（非常重要！）
1. **generate_column_chart**（推荐）：纵向柱状图，分类在X轴，数值在Y轴。适用于类别比较。
2. **generate_bar_chart**：横向柱状图，分类在Y轴，数值在X轴。仅当类别名称很长时使用。
3. **generate_pie_chart**：饼图，适用于展示占比/比例关系。
4. **generate_line_chart**：折线图，适用于时间序列趋势。

## 数据格式规范
- 柱状图/饼图: data = [{"category": "分类名称", "value": 100}]
- 多系列柱状图: data = [{"category": "分类", "value": 100, "group": "系列名"}]
- 折线图: data = [{"time": "时间", "value": 100, "group": "系列名(可选)"}]

## 返回格式（必须包含 axisXTitle 和 axisYTitle）
{
  "toolName": "generate_column_chart",
  "title": "图表标题",
  "arguments": {
    "data": [{"category": "分类1", "value": 100}, {"category": "分类2", "value": 200}],
    "title": "图表标题",
    "axisXTitle": "X轴标题（通常是分类字段名）",
    "axisYTitle": "Y轴标题（通常是数值/金额/数量等）"
  }
}

## 重要规则
1. 默认使用 generate_column_chart，除非用户明确要求其他类型
2. 必须设置 axisXTitle 和 axisYTitle
3. axisXTitle 是分类/维度字段，axisYTitle 是数值/度量字段
4. 只返回纯 JSON，不要包含任何注释或 markdown 标记`;

    const userPrompt = `## 用户原始请求
"${originalText}"

## 数据库查询结果
${JSON.stringify(data, null, 2)}

请根据上述数据，选择最适合的图表类型并生成完整的参数（包含 axisXTitle 和 axisYTitle）。`;

    try {
      // 使用 Claude SDK 调用
      const message = await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2048,
        system: systemPrompt,
        messages: [
          { role: 'user', content: userPrompt }
        ]
      });

      // 提取文本内容
      const content = message.content
        .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
        .map(block => block.text)
        .join('');

      let jsonStr = content.replace(/```json\s*/gi, '').replace(/```\s*/gi, '').trim();
      const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        jsonStr = jsonMatch[0];
      }

      const parsed = JSON.parse(jsonStr);
      return {
        toolName: parsed.toolName,
        title: parsed.title || '数据图表',
        arguments: parsed.arguments
      };
    } catch (error: any) {
      console.error('❌ 生成图表参数失败:', error.message);
      return this.getDefaultChartData();
    }
  }

  /**
   * 构建工具描述（带缓存）
   */
  private buildToolsDescription(tools: MCPTool[]): string {
    // 使用缓存，避免重复构建字符串
    if (cachedToolsDescription) {
      return cachedToolsDescription;
    }

    const description = tools.map(tool => {
      const props = tool.inputSchema?.properties || {};
      const propsDesc = Object.entries(props)
        .map(([key, val]: [string, any]) => {
          const type = val.type || 'unknown';
          const desc = val.description || '';
          const required = tool.inputSchema?.required?.includes(key) ? '(必填)' : '(可选)';

          let detail = `    - ${key}: ${type} ${required} - ${desc}`;

          if (type === 'array' && val.items?.properties) {
            detail += `\n      items:`;
            for (const [ik, iv] of Object.entries(val.items.properties)) {
              detail += `\n        - ${ik}: ${(iv as any).type}`;
            }
          }

          return detail;
        })
        .join('\n');

      return `\n### ${tool.name}\n描述: ${tool.description}\n参数:\n${propsDesc}`;
    }).join('\n');

    cachedToolsDescription = description;
    return description;
  }

  /**
   * 获取默认图表数据
   */
  private getDefaultChartData(): ParsedChartData {
    return {
      toolName: 'generate_bar_chart',
      title: '数据解析失败',
      arguments: {
        data: [{ category: '请重试', value: 1 }],
        title: '数据解析失败'
      }
    };
  }

  /**
   * 调用图表 MCP 工具
   */
  private async callChartMCPTool(toolName: string, args: Record<string, any>): Promise<string> {
    return new Promise((resolve, reject) => {
      const mcpProcess = spawn('npx', ['-y', '@antv/mcp-server-chart'], {
        shell: true,
        cwd: process.cwd()
      });

      let stdout = '';
      const timeout = setTimeout(() => {
        mcpProcess.kill();
        reject(new Error('MCP 服务超时'));
      }, 60000);

      mcpProcess.stdout.on('data', (chunk) => {
        stdout += chunk.toString();
      });

      mcpProcess.on('close', async ( ) => {
        clearTimeout(timeout);

        try {
          console.log('📊 MCP 原始输出:', stdout.substring(0, 500));

          const response = JSON.parse(stdout.trim());

          if (response.error) {
            reject(new Error(`MCP 错误: ${response.error.message}`));
            return;
          }

          const imageUrl = response.result?.content?.[0]?.text;
          if (!imageUrl) {
            reject(new Error('MCP 返回数据格式错误'));
            return;
          }

          const localPath = await this.downloadImage(imageUrl, args?.title || '图表');
          const absolutePath = path.resolve(__dirname, '../../public', localPath.replace(/^\//, ''));

          resolve(absolutePath);
        } catch (error: any) {
          reject(new Error(`解析 MCP 响应失败: ${error.message}`));
        }
      });

      mcpProcess.on('error', (err: Error) => {
        clearTimeout(timeout);
        reject(new Error(`MCP 进程启动失败: ${err.message}`));
      });

      const mcpRequest = {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: toolName, arguments: args }
      };

      console.log('📤 发送 MCP 请求:', JSON.stringify(mcpRequest, null, 2));
      mcpProcess.stdin.write(JSON.stringify(mcpRequest) + '\n');
      mcpProcess.stdin.end();
    });
  }

  /**
   * 下载远程图片到本地
   */
  private async downloadImage(imageUrl: string, title: string): Promise<string> {
    try {
      const response = await axios.get(imageUrl, { responseType: 'arraybuffer' });
      const filename = `chart_${Date.now()}_${uuidv4().slice(0, 8)}.png`;
      const filepath = path.join(__dirname, '../../public/charts', filename);

      fs.writeFileSync(filepath, Buffer.from(response.data));
      return `/charts/${filename}`;
    } catch (error: any) {
      console.error('下载图片失败:', error);
      return imageUrl;
    }
  }

  /**
   * 获取图表历史
   */
  async getChartHistory() {
    return chartHistory;
  }
}
