import { Router } from 'express';
import { ChartService } from '../services/chartService';

const router = Router();
const chartService = new ChartService();

// POST /api/generate - 生成图表
router.post('/generate', async (req, res) => {
  try {
    const { text, options } = req.body;

    if (!text || typeof text !== 'string') {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_INPUT',
          message: '请输入有效的文本内容'
        }
      });
    }

    console.log('📝 收到生成请求:', text);
    const result = await chartService.generateChart({ text, options });

    res.json(result);
  } catch (error: any) {
    console.error('生成图表失败:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'GENERATE_ERROR',
        message: error.message || '生成图表失败'
      }
    });
  }
});

// GET /api/charts - 获取图表历史
router.get('/charts', async (req, res) => {
  try {
    const charts = await chartService.getChartHistory();
    res.json({
      success: true,
      data: {
        items: charts,
        total: charts.length
      }
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: {
        code: 'FETCH_ERROR',
        message: error.message
      }
    });
  }
});

export { router as chartRouter };
