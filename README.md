# 空间声像工作台（Spatial Audio Workbench）

纯浏览器端的 HRTF 空间声像试听工作台：本地音轨、Three.js 声源/听者可视化、
Web Audio API 空间化与明确距离衰减、IndexedDB 本地工程存储。**音频不出本机、无任何上传。**

## 运行

```bash
npm install
npm run dev        # 开发服务器
npm run build      # 类型检查 + 生产构建
npm run test:smoke # 引擎逻辑冒烟测试（mock Web Audio / IndexedDB，32 项）
```

建议佩戴耳机试听（HRTF 依赖双耳串扰控制）。

## 功能与设计要点

### 坐标一致性
- 全程同一右手坐标系：**+X 向右、+Y 向上、+Z 朝前（屏幕外/南）**；听者 yaw=0 时朝向 **−Z**。
- `PannerNode` / `AudioListener`、Three.js 场景、二维俯视图共用该定义，无二次翻转。
- 听者 **L = −X（蓝耳）、R = +X（红耳）**：声源在 +X 时右声道更强。

### 音频图
```
BufferSource → trackGain(-48..+12dB, M/S 逻辑) → PannerNode(HRTF, linear 1m→20m)
                                                         ↓
                                               masterGain(-48..+12dB)
                                                    ↙       ↘
                                             destination   ChannelSplitter
                                                              ↓      ↓
                                                          AnalyserL AnalyserR  → 峰值/PEAK
```
- **移动声源只写 panner 的位置 AudioParam，绝不重启 BufferSource**（音轨不中断、不重头）。
- 距离衰减显式配置：`distanceModel=linear, refDistance=1, maxDistance=20, rolloffFactor=1`。
- 静音/独奏为真实增益（独奏优先：存在独奏轨时仅独奏轨可闻）；总线增益串联在真实输出链上。
- L/R 峰值表取自 master 之后的分路器，≥0dBFS（0.9999）锁存红色 PEAK，点击表区清除。

### 同步
所有轨道在一次 `play()` 中以相同 `when` 调度 `start()`，双声源样例使用逐样本相同的缓冲，
可用来检验同步（对称双脉冲应融合为正前方稳定声像）。

### 音频解锁与错误分离
- AudioContext 仅在用户手势（点播放）内创建并 `resume()`；未解锁时顶栏有明确徽标，不自动发声。
- 本地文件存原始 Blob 到 IndexedDB；解码在解锁后进行，**解码失败仅在该轨标红**，不拖垮其他轨。

### 二维操作入口
- 俯视 SVG：拖球移动声源、拖听者平移、拖橙色手柄旋转朝向；另有 X/Y/Z 数值输入与前/后/左/右方位快捷。
- 上半部为 Three.js 三维只读视图（OrbitControls 观察），每帧从引擎同步位置/朝向/作用距离圆。

### 试听样例（「载入试听样例」）
1. **脉冲单源（右 +90°）**：每秒一次瞬态滴答，检验方位与移动不中断。
2. **单音（左 −90°）**：1000Hz 循环正弦（HRTF 敏感频段），检验持续声像与转向。
3. **双声源（前左/前右相同脉冲）**：检验同步与融合声像。

### 工程
- 布局/参数防抖自动保存 + 手动保存；原始音频在独立的 IndexedDB store 按轨道 id 存放。
- 刷新/重开恢复最近工程的全部参数与播放位置，**但不自动播放**（浏览器策略与需求一致）。

## 技术栈

React 18 + TypeScript（`useSyncExternalStore` 订阅引擎单一状态源）、Three.js（r169）、
Web Audio API（HRTF PannerNode / AnalyserNode）、IndexedDB、Vite。
