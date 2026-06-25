// ─── AIIcon — AI 助手专属 Logo ───────────────────────────────
//
// 设计理念：
// 1. 六边形外框 — 代表 AI 的结构化、稳定
// 2. 中心圆点 — 神经网络节点，核心智能
// 3. 三条放射线 — 连接/思考/输出的意象
// 4. 流式输出时整体脉冲发光 — 表示正在"思考"
//
// 用 SVG 而非 emoji/CSS，保证暗色模式下清晰可辨

export default function AIIcon({ size = 20, streaming = false }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      className={`ai-icon${streaming ? ' streaming' : ''}`}
    >
      <defs>
        <linearGradient id="ai-grad" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
          <stop stopColor="#818cf8" />
          <stop offset="1" stopColor="#6366f1" />
        </linearGradient>
      </defs>

      {/* 六边形外框 */}
      <path
        d="M16 3 L27 9.5 L27 22.5 L16 29 L5 22.5 L5 9.5 Z"
        stroke="url(#ai-grad)"
        strokeWidth="2"
        strokeLinejoin="round"
        fill="rgba(99,102,241,0.06)"
      />

      {/* 三条放射连接线 */}
      <line x1="16" y1="16" x2="16" y2="8" stroke="url(#ai-grad)" strokeWidth="1.5" strokeLinecap="round" opacity="0.5" />
      <line x1="16" y1="16" x2="10" y2="20" stroke="url(#ai-grad)" strokeWidth="1.5" strokeLinecap="round" opacity="0.5" />
      <line x1="16" y1="16" x2="22" y2="20" stroke="url(#ai-grad)" strokeWidth="1.5" strokeLinecap="round" opacity="0.5" />

      {/* 三个外节点 */}
      <circle cx="16" cy="8" r="2" fill="url(#ai-grad)" />
      <circle cx="10" cy="20" r="2" fill="url(#ai-grad)" />
      <circle cx="22" cy="20" r="2" fill="url(#ai-grad)" />

      {/* 中心核心节点 */}
      <circle cx="16" cy="16" r="3.5" fill="url(#ai-grad)" />
      <circle cx="16" cy="16" r="1.5" fill="#fff" opacity="0.9" />
    </svg>
  )
}
