interface Props {
  onClose: () => void;
}

export default function HelpModal({ onClose }: Props) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>空间声像工作台 · 说明与检查步骤</h2>
        <h3>坐标系与左右声道</h3>
        <ul>
          <li>全程使用同一右手坐标系：<b>+X 向右、+Y 向上、+Z 朝向屏幕前方（南）</b>，听者 yaw=0 时朝向 <b>−Z</b>。</li>
          <li>Web Audio 的 <code>PannerNode</code>/<code>AudioListener</code>、Three.js 场景、二维俯视图共用这一套坐标与朝向，不做二次翻转。</li>
          <li>听者左耳在 <b>−X</b>（蓝色 L），右耳在 <b>+X</b>（红色 R）。声源在 +X 一侧时，<b>R 表应明显更强</b>。</li>
          <li>建议佩戴耳机试听（HRTF 依赖双耳串扰控制）。</li>
        </ul>
        <h3>试听与检查（点击「载入试听样例」）</h3>
        <ol>
          <li><b>脉冲单源（右 +90°）</b>：点播放，每秒一次的瞬态应来自右侧；播放中在二维视图拖动声源 —— 声像平滑跟随，音轨不中断、不重头开始。</li>
          <li><b>单音（左 −90°）</b>：1000Hz 持续音应稳定在左侧；拖动橙色手柄旋转听者朝向，声像应随头部转动重新定位。</li>
          <li><b>双声源（前左 / 前右，相同脉冲）</b>：两轨由同一次播放调度、样例缓冲逐样本相同，应融合为正前方的稳定声像；若听到来回跳动/双响，说明未同步。</li>
          <li>用「静音 / 独奏」逐轨验证：独奏时仅该轨可闻；所有静音时输出应为静默（L/R 表归零）。</li>
          <li>把总线或单轨增益推到 +6dB 以上并叠加多轨，L/R 峰值表应出现红色 <b>PEAK</b> 锁存；峰值表接在 master 之后的真实输出链上，点击表区清除。</li>
        </ol>
        <h3>距离衰减</h3>
        <ul>
          <li><code>HRTF</code> + <code>linear</code> 距离模型：参考距离 1m（最响），最大距离 20m（衰减到零），rolloffFactor = 1。二维/三维中的虚线圆即 20m 作用边界。</li>
        </ul>
        <h3>音频解锁与错误处理</h3>
        <ul>
          <li>首次点「播放」时在用户手势内创建并 resume AudioContext；在此之前状态显示「音频未解锁」，不会自动发声。</li>
          <li>本地文件存入 IndexedDB（原始 Blob），<b>全程无任何网络上传</b>；浏览器无法解码的文件会在该轨上单独标红提示，不影响其他轨道。</li>
        </ul>
        <h3>工程与重载</h3>
        <ul>
          <li>布局与参数防抖自动保存，也可手动「保存」。刷新/重开页面后自动恢复最近工程的全部参数与播放位置，<b>但不会自动播放</b>，需再次点击播放。</li>
        </ul>
        <div className="modal-actions">
          <button className="tbtn primary" onClick={onClose}>开始试听</button>
        </div>
      </div>
    </div>
  );
}
