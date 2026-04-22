
export type MaskType = 'rect' | 'rounded-rect' | 'circle' | 'star' | 'hexagon' | 'heart';

export interface SlotCrop {
  scale: number;
  x: number;
  y: number;
}

export interface Slot {
  id: number;
  imageUrl: string | null;
  fileName: string | null;
  crop: SlotCrop;
  maskType: MaskType;
  isStretched?: boolean;
}

export interface LayoutConfig {
  canvasWidth: number;
  canvasHeight: number;
  rectWidth: number;
  rectHeight: number;
  dieCutWidth: number;
  dieCutHeight: number;
  rows: number;
  cols: number;
  marginLeft: number;
  marginRight: number;
  marginTop: number;
  marginBottom: number;
  transparentBackground: boolean;
}

// 生产级 A3 横向矩阵配置 (420x297mm)
export const DEFAULT_CONFIG: LayoutConfig = {
  canvasWidth: 420,
  canvasHeight: 297,
  rectWidth: 64,    // 出血位宽度 (64mm)
  rectHeight: 93,   // 出血位高度 (93mm)
  dieCutWidth: 60,  // 成品位宽度 (60mm)
  dieCutHeight: 89, // 成品位高度 (89mm)
  rows: 3,          // 纵向排3个 (3 * 93 = 279mm, 剩余18mm)
  cols: 6,          // 横向排6个 (6 * 64 = 384mm, 剩余36mm)
  marginLeft: 18,   // 左右边距各 18mm
  marginRight: 18,
  marginTop: 9,     // 上下边距各 9mm
  marginBottom: 9,
  transparentBackground: false,
};

/**
 * 根据蒙版类型生成 CSS clip-path
 * 容器已经是 60x89mm 成品位，不需要再缩进，直接应用 4mm 圆角
 */
export const getClipPath = (type: MaskType): string => {
  switch (type) {
    case 'rect':
      return 'none';
    case 'rounded-rect':
      // 容器已经是 60x89mm，不需要再缩进，直接应用 4mm 圆角
      return 'inset(0 round 4mm)';
    case 'circle':
      return 'circle(45% at 50% 50%)'; 
    case 'star':
      return 'inset(1mm) polygon(50% 0%, 61% 35%, 98% 35%, 68% 57%, 79% 91%, 50% 70%, 21% 91%, 32% 57%, 2% 35%, 39% 35%)';
    case 'hexagon':
      return 'inset(1.5mm 3mm) polygon(25% 0%, 75% 0%, 100% 50%, 75% 100%, 25% 100%, 0% 50%)';
    case 'heart':
      return 'path("M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z")';
    default:
      return 'none';
  }
};
