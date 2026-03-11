import matplotlib.pyplot as plt
import matplotlib.dates as mdates
from datetime import datetime, timedelta

# 设置中文字体
plt.rcParams['font.sans-serif'] = ['SimHei', 'Microsoft YaHei', 'Arial Unicode MS']
plt.rcParams['axes.unicode_minus'] = False

# 数据
dates = ['3月6日', '3月7日', '3月8日', '3月9日', '3月10日']
high_temps = [11, 11, 13, 13, 14]  # 最高温度
low_temps = [4, 5, 5, 4, 6]        # 最低温度

# 创建x轴日期数据
x = range(len(dates))

# 创建图表
fig, ax = plt.subplots(figsize=(10, 6))

# 绘制折线
ax.plot(x, high_temps, 'o-', color='#FF6B6B', linewidth=2.5, markersize=10, label='最高温度')
ax.plot(x, low_temps, 'o-', color='#4ECDC4', linewidth=2.5, markersize=10, label='最低温度')

# 填充两线之间的区域
ax.fill_between(x, high_temps, low_temps, alpha=0.2, color='#95E1D3')

# 在数据点上显示数值
for i, (h, l) in enumerate(zip(high_temps, low_temps)):
    ax.annotate(f'{h}°C', (i, h), textcoords="offset points", xytext=(0, 10), ha='center', fontsize=11, color='#FF6B6B', fontweight='bold')
    ax.annotate(f'{l}°C', (i, l), textcoords="offset points", xytext=(0, -15), ha='center', fontsize=11, color='#4ECDC4', fontweight='bold')

# 设置x轴
ax.set_xticks(x)
ax.set_xticklabels(dates, fontsize=12)

# 设置y轴
ax.set_ylabel('温度 (°C)', fontsize=12)
ax.set_ylim(0, 18)

# 设置标题
ax.set_title('上海最近五天天气气温变化 (2026年3月6日-10日)', fontsize=14, fontweight='bold', pad=20)

# 添加网格
ax.grid(True, linestyle='--', alpha=0.6)

# 添加图例
ax.legend(loc='upper left', fontsize=11)

# 添加天气状况标注
weather_conditions = ['阴', '多云转阴', '阴', '多云转晴', '多云转晴']
for i, condition in enumerate(weather_conditions):
    ax.annotate(condition, (i, (high_temps[i] + low_temps[i])/2), textcoords="offset points",
                xytext=(15, 0), ha='left', fontsize=9, color='#666666', style='italic')

plt.tight_layout()
plt.savefig('shanghai_weather_chart.png', dpi=150, bbox_inches='tight', facecolor='white')
plt.show()

print("图表已保存为 shanghai_weather_chart.png")
