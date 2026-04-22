
import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { DEFAULT_CONFIG, Slot, LayoutConfig, SlotCrop, MaskType } from './types';
import Canvas from './components/Canvas';
import Sidebar from './components/Sidebar';
import Header from './components/Header';
import ExportModal from './components/ExportModal';
import ExportAIModal from './components/ExportAIModal';
import CropModal from './components/CropModal';
import Login from './components/Login';
import SliceModal from './components/SliceModal';
import { jsPDF } from 'jspdf';
import JSZip from 'jszip';

const STORAGE_KEY = 'pro-imposer-config-v3';
const PROJECT_NAME_KEY = 'pro-imposer-project-name';
const NOTES_KEY = 'pro-imposer-page-notes';
const AUTH_KEY = 'pro-imposer-auth';

type ViewMode = 'front' | 'back' | 'third' | 'all';

interface ExportOptions {
  includeImages: boolean;
  includeBleed: boolean;
  includeDiecut: boolean;
  includeRoundedDiecut: boolean;
}

const App: React.FC = () => {
  const [isLoggedIn, setIsLoggedIn] = useState(() => sessionStorage.getItem(AUTH_KEY) === 'true');
  const [loginError, setLoginError] = useState<string>();
  const [config, setConfig] = useState<LayoutConfig>(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    const loaded = saved ? { ...DEFAULT_CONFIG, ...JSON.parse(saved) } : DEFAULT_CONFIG;
    return {
      ...loaded,
      canvasWidth: 420,
      canvasHeight: 297,
      rectWidth: 64,
      rectHeight: 93,
      dieCutWidth: 60,
      dieCutHeight: 89,
      marginLeft: 18,
      marginRight: 18,
      marginTop: 9,
      marginBottom: 9
    };
  });

  const [projectName, setProjectName] = useState(() => localStorage.getItem(PROJECT_NAME_KEY) || '模切排版项目');
  const [pageNotes, setPageNotes] = useState<string[]>(() => {
    const saved = localStorage.getItem(NOTES_KEY);
    return saved ? JSON.parse(saved) : ['', '', ''];
  });

  const [frontSlots, setFrontSlots] = useState<Slot[]>([]);
  const [backSlots, setBackSlots] = useState<Slot[]>([]);
  const [thirdSlots, setThirdSlots] = useState<Slot[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [isPdfModalOpen, setIsPdfModalOpen] = useState(false);
  const [isAIModalOpen, setIsAIModalOpen] = useState(false);
  const [sliceModalFile, setSliceModalFile] = useState<File | null>(null);
  
  const [editingSlot, setEditingSlot] = useState<{ listId: 'front'|'back'|'third', index: number, slot: Slot } | null>(null);

  const [viewMode, setViewMode] = useState('all' as ViewMode);
  const [zoom, setZoom] = useState(0.4); 
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const panStartRef = useRef({ x: 0, y: 0 });

  const totalPages = useMemo(() => {
    const hasThird = thirdSlots.some(s => s.imageUrl);
    if (hasThird) return 3;
    const hasBack = backSlots.some(s => s.imageUrl);
    if (hasBack) return 2;
    return 1;
  }, [frontSlots, backSlots, thirdSlots]);

  useEffect(() => {
    if (totalPages === 1 && viewMode !== 'all' && viewMode !== 'front') setViewMode('front');
    if (totalPages === 2 && viewMode === 'third') setViewMode('back');
  }, [totalPages, viewMode]);

  const handleLogin = (password: string) => {
    if (password === '777') {
      setIsLoggedIn(true);
      setLoginError(undefined);
      sessionStorage.setItem(AUTH_KEY, 'true');
    } else {
      setLoginError('访问令牌错误，请重试');
    }
  };

  const handleLogout = () => {
    setIsLoggedIn(false);
    sessionStorage.removeItem(AUTH_KEY);
  };

  useEffect(() => {
    if (!isLoggedIn) return;
    const syncSlots = (prev: Slot[]) => {
      const targetLength = config.rows * config.cols;
      if (prev.length === targetLength) return prev;
      return Array.from({ length: targetLength }, (_, i) => prev[i] || {
        id: i, imageUrl: null, fileName: null, crop: { scale: 1, x: 0, y: 0 }, maskType: 'rounded-rect', isStretched: false
      });
    };
    setFrontSlots(prev => syncSlots(prev));
    setBackSlots(prev => syncSlots(prev));
    setThirdSlots(prev => syncSlots(prev));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
    localStorage.setItem(NOTES_KEY, JSON.stringify(pageNotes));
  }, [config, isLoggedIn, pageNotes]);

  const handleConfigChange = useCallback((newConfig: Partial<LayoutConfig>) => setConfig(prev => ({ ...prev, ...newConfig })), []);
  const resetConfig = useCallback(() => window.confirm('确定要重置生产参数吗？') && setConfig(DEFAULT_CONFIG), []);

  const handleNoteChange = useCallback((index: number, text: string) => {
    setPageNotes(prev => {
      const next = [...prev];
      next[index] = text;
      return next;
    });
  }, []);

  const handleNoteChangePage1 = useCallback((t: string) => handleNoteChange(0, t), [handleNoteChange]);
  const handleNoteChangePage2 = useCallback((t: string) => handleNoteChange(1, t), [handleNoteChange]);
  const handleNoteChangePage3 = useCallback((t: string) => handleNoteChange(2, t), [handleNoteChange]);
  
  const handleEditSlotPage1 = useCallback((idx: number) => setEditingSlot({ listId: 'front', index: idx, slot: frontSlots[idx] }), [frontSlots]);
  const handleEditSlotPage2 = useCallback((idx: number) => setEditingSlot({ listId: 'back', index: idx, slot: backSlots[idx] }), [backSlots]);
  const handleEditSlotPage3 = useCallback((idx: number) => setEditingSlot({ listId: 'third', index: idx, slot: thirdSlots[idx] }), [thirdSlots]);

  const batchSetMask = useCallback((type: MaskType) => {
    setFrontSlots(prev => prev.map(s => ({ ...s, maskType: type })));
    setBackSlots(prev => prev.map(s => ({ ...s, maskType: type })));
    setThirdSlots(prev => prev.map(s => ({ ...s, maskType: type })));
  }, []);

  const batchToggleStretch = useCallback(() => {
    let targetState = true;
    const sampleSlot = frontSlots.find(s => s.imageUrl);
    if (sampleSlot && sampleSlot.isStretched) {
        targetState = false;
    }
    const updater = (prev: Slot[]) => prev.map(s => ({ ...s, isStretched: targetState }));
    setFrontSlots(updater);
    setBackSlots(updater);
    setThirdSlots(updater);
  }, [frontSlots]);

  const batchAutoFitBleed = useCallback(() => {
    const updater = (prev: Slot[]) => prev.map(s => ({ ...s, maskType: 'rect', isStretched: false, crop: { scale: 1, x: 0, y: 0 } }));
    setFrontSlots(updater);
    setBackSlots(updater);
    setThirdSlots(updater);
  }, []);

  const batchAutoFitDieCut = useCallback(() => {
    const updater = (prev: Slot[]) => prev.map(s => ({ ...s, maskType: 'rounded-rect', isStretched: false, crop: { scale: 1, x: 0, y: 0 } }));
    setFrontSlots(updater);
    setBackSlots(updater);
    setThirdSlots(updater);
  }, []);

  const handleUnifiedUpload = useCallback(async (files: File[]) => {
    setIsProcessing(true);
    const pageSize = config.rows * config.cols;

    // Helper to process sequential batches to prevent UI blocking
    const processBatchSequential = async (
      targetFiles: File[], 
      setter: React.Dispatch<React.SetStateAction<Slot[]>>
    ) => {
        if (targetFiles.length === 0) return;

        // 1. Initial display (optimistic)
        const fileData = targetFiles.map((f, i) => ({ file: f, url: URL.createObjectURL(f), index: i }));
        
        setter(prev => {
            const next = [...prev];
            fileData.forEach(({file, url, index}) => {
                if (index < next.length) {
                     if (next[index].imageUrl) URL.revokeObjectURL(next[index].imageUrl!);
                     next[index] = {
                        ...next[index],
                        imageUrl: url,
                        fileName: file.name,
                        crop: { scale: 1, x: 0, y: 0 },
                        maskType: 'rounded-rect',
                        isStretched: false
                     };
                }
            });
            return next;
        });
    };
    
    // Auto-switch to 'all' if uploading more than 1 page
    let effectiveViewMode = viewMode;
    if (files.length > pageSize && viewMode !== 'all') {
      effectiveViewMode = 'all';
      setViewMode('all');
      setZoom(0.35);
      setPan({x:0, y:0});
    }

    if (effectiveViewMode === 'all') {
        const page1Files = files.slice(0, pageSize);
        const page2Files = files.slice(pageSize, pageSize * 2);
        const page3Files = files.slice(pageSize * 2, pageSize * 3);

        await Promise.all([
            processBatchSequential(page1Files, setFrontSlots),
            processBatchSequential(page2Files, setBackSlots),
            processBatchSequential(page3Files, setThirdSlots)
        ]);
    } else {
        const targetFiles = files.slice(0, pageSize);
        if (effectiveViewMode === 'front') await processBatchSequential(targetFiles, setFrontSlots);
        else if (effectiveViewMode === 'back') await processBatchSequential(targetFiles, setBackSlots);
        else if (effectiveViewMode === 'third') await processBatchSequential(targetFiles, setThirdSlots);
    }

    setIsProcessing(false);
  }, [config.rows, config.cols, viewMode]);

  const loadImage = useCallback(async (url: string, retries = 3): Promise<HTMLImageElement> => {
    const load = () => new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      if (!url.startsWith('blob:')) img.crossOrigin = "anonymous";
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`Failed to load image: ${url}`));
      img.src = url;
    });

    for (let i = 0; i < retries; i++) {
      try {
        return await load();
      } catch (err) {
        if (i === retries - 1) throw err;
        await new Promise(r => setTimeout(r, 1000));
      }
    }
    throw new Error(`Failed to load image after ${retries} retries`);
  }, []);

  const getProcessedBase64 = (img: HTMLImageElement, wMm: number, hMm: number, dpi: number, opts: any = {}): string => {
    const { 
      cornerRadiusMm = 4, 
      transparent = false, 
      crop = { scale: 1, x: 0, y: 0 }, 
      maskType = 'rect', 
      rotateToFinished = false, 
      autoTrim = false,
      isStretched = false
    } = opts;

    const canvas = document.createElement("canvas");
    const pr = dpi / 25.4;
    
    canvas.width = Math.round(wMm * pr);
    canvas.height = Math.round(hMm * pr);
    
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return "";
    
    if (!transparent && !autoTrim) {
      ctx.fillStyle = "#FFFFFF";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    
    ctx.save();
    const w = canvas.width;
    const h = canvas.height;
    
    ctx.beginPath();
    if (maskType === 'rounded-rect') {
      const maskWMm = opts.dieCutWidth || 60; 
      const maskHMm = opts.dieCutHeight || 89; 
      
      const mWidth = maskWMm * pr;
      const mHeight = maskHMm * pr;
      const r = cornerRadiusMm * pr;
      const ox = (w - mWidth) / 2;
      const oy = (h - mHeight) / 2;
      ctx.moveTo(ox + r, oy);
      ctx.lineTo(ox + mWidth - r, oy);
      ctx.quadraticCurveTo(ox + mWidth, oy, ox + mWidth, oy + r);
      ctx.lineTo(ox + mWidth, oy + mHeight - r);
      ctx.quadraticCurveTo(ox + mWidth, oy + mHeight, ox + mWidth - r, oy + mHeight);
      ctx.lineTo(ox + r, oy + mHeight);
      ctx.quadraticCurveTo(ox, oy + mHeight, ox, oy + mHeight - r);
      ctx.lineTo(ox, oy + r);
      ctx.quadraticCurveTo(ox, oy, ox + r, oy);
    } else {
      ctx.rect(0, 0, w, h);
    }
    ctx.closePath();
    ctx.clip();

    ctx.translate(w / 2, h / 2); 
    
    const targetW = (maskType === 'rounded-rect' && opts.dieCutWidth ? opts.dieCutWidth : wMm) * pr;
    const targetH = (maskType === 'rounded-rect' && opts.dieCutHeight ? opts.dieCutHeight : hMm) * pr;
    
    let dW, dH;
    
    if (isStretched) {
        dW = targetW;
        dH = targetH;
    } else {
        const imgA = img.naturalWidth / img.naturalHeight;
        const fA = targetW / targetH;
        // object-contain logic
        if (imgA > fA) { 
            dW = targetW; 
            dH = dW / imgA; 
        } else { 
            dH = targetH; 
            dW = dH * imgA; 
        }
    }
    
    ctx.scale(crop.scale, crop.scale);
    ctx.drawImage(img, -dW / 2 + (crop.x * pr), -dH / 2 + (crop.y * pr), dW, dH);
    ctx.restore();

    if (autoTrim) {
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const l = pixels.data.length;
      let minX = canvas.width, minY = canvas.height, maxX = 0, maxY = 0;
      let hasVisible = false;

      for (let i = 0; i < l; i += 4) {
        if (pixels.data[i + 3] > 0) {
          const x = (i / 4) % canvas.width;
          const y = Math.floor((i / 4) / canvas.width);
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
          hasVisible = true;
        }
      }

      if (hasVisible) {
        const trimW = maxX - minX + 1;
        const trimH = maxY - minY + 1;
        const trimmedCanvas = document.createElement('canvas');
        trimmedCanvas.width = trimW;
        trimmedCanvas.height = trimH;
        const trimmedCtx = trimmedCanvas.getContext('2d');
        if (trimmedCtx) {
          trimmedCtx.drawImage(canvas, minX, minY, trimW, trimH, 0, 0, trimW, trimH);
          return trimmedCanvas.toDataURL("image/png", 1.0);
        }
      }
    }

    return canvas.toDataURL("image/png", 1.0);
  };

  const handleExportSvg = async () => {
    setIsProcessing(true);
    setExportProgress(0);
    try {
      const buildSvgContent = async (slots: Slot[], label: string, note: string) => {
        let svg = `<svg width="${config.canvasWidth}mm" height="${config.canvasHeight}mm" viewBox="0 0 ${config.canvasWidth} ${config.canvasHeight}" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">`;
        svg += `\n  <title>${projectName} - ${label}</title>`;
        svg += `\n  <g id="IMAGES_${label}">`;
        
        svg += `\n  <text x="50%" y="50%" font-family="sans-serif" font-size="120" font-weight="900" fill="#e5e7eb" text-anchor="middle" dominant-baseline="middle" opacity="0.5">${label}</text>`;

        for (let i = 0; i < slots.length; i++) {
          const s = slots[i];
          if (s.imageUrl) {
            const img = await loadImage(s.imageUrl);
            const b64 = getProcessedBase64(img, config.rectWidth, config.rectHeight, 300, {
              transparent: config.transparentBackground, 
              crop: s.crop, 
              maskType: s.maskType, 
              rotateToFinished: false, 
              autoTrim: false,
              isStretched: s.isStretched,
              dieCutWidth: config.dieCutWidth,
              dieCutHeight: config.dieCutHeight
            });
            const col = i % config.cols;
            const row = Math.floor(i / config.cols);
            const x = config.marginLeft + col * config.rectWidth;
            const y = config.marginTop + row * config.rectHeight;
            svg += `\n    <image x="${x}" y="${y}" width="${config.rectWidth}" height="${config.rectHeight}" xlink:href="${b64}" />`;
          }
        }
        
        // Vertical Note Layout matching Canvas
        if (note || true) {
             const labelX = config.canvasWidth - 8;
             const centerY = config.canvasHeight / 2;
             
             const labelText = "生产备注 / INFO";
             // Use explicit rotation for vertical text compatibility
             const labelH = labelText.length * 2; 
             const labelStartY = centerY - labelH / 2;
             
             // Render vertical label char by char for max compatibility
             let cursorY = labelStartY;
             svg += `\n    <g font-family="sans-serif" font-size="5" font-weight="bold" fill="#ccc" text-anchor="middle">`;
             for(const char of labelText) {
                 svg += `\n      <text x="${labelX}" y="${cursorY}">${char}</text>`;
                 cursorY += 2;
             }
             svg += `\n    </g>`;

             if (note) {
                 const noteX = labelX - 6;
                 const noteH = note.length * 4;
                 const noteStartY = centerY - noteH / 2;
                 cursorY = noteStartY;
                 svg += `\n    <g font-family="sans-serif" font-size="9" font-weight="bold" fill="#333" text-anchor="middle">`;
                 for(const char of note) {
                    svg += `\n      <text x="${noteX}" y="${cursorY}">${char}</text>`;
                    cursorY += 4;
                 }
                 svg += `\n    </g>`;
             }
        }
        
        svg += `\n  </g>\n</svg>`;
        return svg;
      };

      const zip = new JSZip();
      if (totalPages >= 1) zip.file(`${projectName}_第一页.svg`, await buildSvgContent(frontSlots, "PAGE1", pageNotes[0]));
      if (totalPages >= 2) zip.file(`${projectName}_第二页.svg`, await buildSvgContent(backSlots, "PAGE2", pageNotes[1]));
      if (totalPages >= 3) zip.file(`${projectName}_第三页.svg`, await buildSvgContent(thirdSlots, "PAGE3", pageNotes[2]));
      
      const content = await zip.generateAsync({ type: 'blob' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(content);
      link.download = `${projectName}_矢量SVG包.zip`;
      link.click();
    } catch (e) { console.error(e); alert("SVG 导出失败"); } finally { setIsProcessing(false); setExportProgress(0); }
  };

  const batchExportRoundedPNGs = async () => {
    let all = [
      ...frontSlots.map(s => ({ ...s, side: '第一页' }))
    ];
    if (totalPages >= 2) all.push(...backSlots.map(s => ({ ...s, side: '第二页' })));
    if (totalPages >= 3) all.push(...thirdSlots.map(s => ({ ...s, side: '第三页' })));

    const allFiltered = all.filter(s => s.imageUrl);

    if (!allFiltered.length) return alert("无可导出的素材");
    setIsProcessing(true); 
    setExportProgress(0);
    
    try {
      const zip = new JSZip(); 
      for (let i = 0; i < allFiltered.length; i++) {
        setExportProgress(Math.round(((i + 1) / allFiltered.length) * 100));
        const s = allFiltered[i]; 
        const img = await loadImage(s.imageUrl!);
        const exportWidth = s.maskType === 'rounded-rect' ? config.dieCutWidth : config.rectWidth;
        const exportHeight = s.maskType === 'rounded-rect' ? config.dieCutHeight : config.rectHeight;
        const b64 = getProcessedBase64(img, exportWidth, exportHeight, 300, {
          cornerRadiusMm: 4, 
          transparent: true, 
          crop: s.crop, 
          maskType: s.maskType, 
          rotateToFinished: true, 
          autoTrim: false,
          isStretched: s.isStretched,
          dieCutWidth: config.dieCutWidth,
          dieCutHeight: config.dieCutHeight
        });
        zip.file(`${projectName}_${s.side}_${i + 1}.png`, b64.split(',')[1], { base64: true });
      }
      const content = await zip.generateAsync({ type: 'blob' });
      const link = document.createElement('a'); 
      link.href = URL.createObjectURL(content); 
      link.download = `${projectName}_成品图PNG.zip`;
      link.click(); 
    } catch (e) { console.error(e); alert("PNG 导出失败"); } finally { setIsProcessing(false); setExportProgress(0); }
  };

  const handleExportPdf = async (options: ExportOptions) => {
    setIsPdfModalOpen(false);
    setIsProcessing(true);
    setExportProgress(0);
    try {
      const pdf = new jsPDF({
        orientation: config.canvasWidth > config.canvasHeight ? 'l' : 'p',
        unit: 'mm',
        format: [config.canvasWidth, config.canvasHeight]
      });

      const allSides = [
        { slots: frontSlots, label: "PAGE 1", note: pageNotes[0] },
        { slots: backSlots, label: "PAGE 2", note: pageNotes[1] },
        { slots: thirdSlots, label: "PAGE 3", note: pageNotes[2] }
      ];

      const sides = allSides.slice(0, totalPages);

      for (let sIdx = 0; sIdx < sides.length; sIdx++) {
        if (sIdx > 0) pdf.addPage([config.canvasWidth, config.canvasHeight], config.canvasWidth > config.canvasHeight ? 'l' : 'p');
        const side = sides[sIdx];
        
        pdf.saveGraphicsState();
        pdf.setTextColor(230, 230, 230);
        pdf.setFontSize(120);
        pdf.text(side.label, config.canvasWidth / 2, config.canvasHeight / 2, { align: 'center', baseline: 'middle', angle: 0 });
        pdf.restoreGraphicsState();

        if (options.includeImages) {
          for (let i = 0; i < side.slots.length; i++) {
            const slot = side.slots[i];
            if (slot.imageUrl) {
              const img = await loadImage(slot.imageUrl);
              const b64 = getProcessedBase64(img, config.rectWidth, config.rectHeight, 300, {
                transparent: config.transparentBackground, 
                crop: slot.crop, 
                maskType: slot.maskType, 
                rotateToFinished: false, 
                autoTrim: false,
                isStretched: slot.isStretched,
                dieCutWidth: config.dieCutWidth,
                dieCutHeight: config.dieCutHeight
              });
              const col = i % config.cols;
              const row = Math.floor(i / config.cols);
              const x = config.marginLeft + col * config.rectWidth;
              const y = config.marginTop + row * config.rectHeight;
              pdf.addImage(b64, 'PNG', x, y, config.rectWidth, config.rectHeight);
            }
            setExportProgress(Math.round(((sIdx * side.slots.length + i + 1) / (sides.length * side.slots.length)) * 100));
          }
        }

        const labelX = config.canvasWidth - 8;
        const centerY = config.canvasHeight / 2;
        
        pdf.setTextColor(200, 200, 200);
        pdf.setFontSize(5); 
        const labelText = "生产备注 / INFO";
        const labelCharSpacing = 2; 
        const labelHeight = labelText.length * labelCharSpacing;
        let cursorY = centerY - labelHeight / 2;
        
        labelText.split('').forEach(char => {
            pdf.text(char, labelX, cursorY, { align: 'center', baseline: 'middle' });
            cursorY += labelCharSpacing;
        });

        if (side.note) {
          pdf.setTextColor(50, 50, 50);
          pdf.setFontSize(9);
          const noteX = labelX - 6; 
          const noteCharSpacing = 4;
          const noteHeight = side.note.length * noteCharSpacing;
          cursorY = centerY - noteHeight / 2;
          
          side.note.split('').forEach(char => {
            pdf.text(char, noteX, cursorY, { align: 'center', baseline: 'middle' });
            cursorY += noteCharSpacing;
          });
        }

        pdf.setLineWidth(0.1);
        for (let i = 0; i < side.slots.length; i++) {
          const col = i % config.cols;
          const row = Math.floor(i / config.cols);
          const x = config.marginLeft + col * config.rectWidth;
          const y = config.marginTop + row * config.rectHeight;
          if (options.includeBleed) { pdf.setDrawColor(0, 0, 255); pdf.rect(x, y, config.rectWidth, config.rectHeight); }
          if (options.includeDiecut) {
            pdf.setDrawColor(255, 0, 0);
            const dx = x + (config.rectWidth - config.dieCutWidth) / 2;
            const dy = y + (config.rectHeight - config.dieCutHeight) / 2;
            pdf.roundedRect(dx, dy, config.dieCutWidth, config.dieCutHeight, 4, 4);
          }
        }
      }
      
      const fileNameSuffix = sides.length === 1 ? `_${sides[0].label}` : '_多页合一';
      pdf.save(`${projectName}${fileNameSuffix}排版.pdf`);
    } catch (e) { console.error(e); alert("PDF 生成失败"); } finally { setIsProcessing(false); setExportProgress(0); }
  };

  const handleExportAI = async () => {
    setIsAIModalOpen(false);
    setIsProcessing(true);
    setExportProgress(0);
    try {
      const allSides = [
        { slots: frontSlots, label: "PAGE 1", note: pageNotes[0] },
        { slots: backSlots, label: "PAGE 2", note: pageNotes[1] },
        { slots: thirdSlots, label: "PAGE 3", note: pageNotes[2] }
      ];

      const sides = allSides.slice(0, totalPages);
      if (sides.length === 0) return;

      const pdf = new jsPDF({
        orientation: config.canvasWidth > config.canvasHeight ? 'l' : 'p',
        unit: 'mm',
        format: [config.canvasWidth, config.canvasHeight]
      });

      for (let sIdx = 0; sIdx < sides.length; sIdx++) {
        const side = sides[sIdx];
        
        if (sIdx > 0) {
          pdf.addPage([config.canvasWidth, config.canvasHeight], config.canvasWidth > config.canvasHeight ? 'l' : 'p');
        }
        
        // Add images
        for (let i = 0; i < side.slots.length; i++) {
          const slot = side.slots[i];
          if (slot.imageUrl) {
            const img = await loadImage(slot.imageUrl);
            const b64 = getProcessedBase64(img, config.rectWidth, config.rectHeight, 300, {
              transparent: config.transparentBackground, 
              crop: slot.crop, 
              maskType: slot.maskType, 
              rotateToFinished: false, 
              autoTrim: false,
              isStretched: slot.isStretched,
              dieCutWidth: config.dieCutWidth,
              dieCutHeight: config.dieCutHeight
            });
            const col = i % config.cols;
            const row = Math.floor(i / config.cols);
            const x = config.marginLeft + col * config.rectWidth;
            const y = config.marginTop + row * config.rectHeight;
            pdf.addImage(b64, 'PNG', x, y, config.rectWidth, config.rectHeight);
          }
          setExportProgress(Math.round(((sIdx * side.slots.length + i + 1) / (sides.length * side.slots.length)) * 100));
        }

        // Add text info (K=90)
        const labelX = config.canvasWidth - 8;
        const centerY = config.canvasHeight / 2;
        
        pdf.setTextColor(0, 0, 0, 90);
        pdf.setFontSize(5); 
        const labelText = "生产备注 / INFO";
        const labelCharSpacing = 2; 
        const labelHeight = labelText.length * labelCharSpacing;
        let cursorY = centerY - labelHeight / 2;
        
        labelText.split('').forEach(char => {
            pdf.text(char, labelX, cursorY, { align: 'center', baseline: 'middle' });
            cursorY += labelCharSpacing;
        });

        if (side.note) {
          pdf.setFontSize(9);
          const noteX = labelX - 6; 
          const noteCharSpacing = 4;
          const noteHeight = side.note.length * noteCharSpacing;
          cursorY = centerY - noteHeight / 2;
          
          side.note.split('').forEach(char => {
            pdf.text(char, noteX, cursorY, { align: 'center', baseline: 'middle' });
            cursorY += noteCharSpacing;
          });
        }

        // Add lines
        pdf.setLineWidth(0.1);
        for (let i = 0; i < side.slots.length; i++) {
          const col = i % config.cols;
          const row = Math.floor(i / config.cols);
          const x = config.marginLeft + col * config.rectWidth;
          const y = config.marginTop + row * config.rectHeight;
          
          // Bleed line (CMYK Cyan: C=100 M=0 Y=0 K=0)
          pdf.setDrawColor(100, 0, 0, 0);
          pdf.rect(x, y, config.rectWidth, config.rectHeight);
          
          // DieCut line (CMYK Red: C=0 M=100 Y=100 K=0)
          pdf.setDrawColor(0, 100, 100, 0);
          const dx = x + (config.rectWidth - config.dieCutWidth) / 2;
          const dy = y + (config.rectHeight - config.dieCutHeight) / 2;
          pdf.roundedRect(dx, dy, config.dieCutWidth, config.dieCutHeight, 4, 4);
        }
      }
      
      const pdfBlob = pdf.output('blob');
      const link = document.createElement('a'); 
      link.href = URL.createObjectURL(pdfBlob); 
      link.download = `${projectName}_AI_CMYK.ai`;
      link.click(); 
    } catch (e) { console.error(e); alert("AI 导出失败"); } finally { setIsProcessing(false); setExportProgress(0); }
  };

  const handleSaveCrop = useCallback((crop: SlotCrop, maskType: MaskType) => {
    setEditingSlot(current => {
      if (!current) return null;
      const { listId, index } = current;
      const updater = (prev: Slot[]) => {
        const next = [...prev];
        next[index] = { ...next[index], crop, maskType };
        return next;
      };
      if (listId === 'front') setFrontSlots(updater);
      else if (listId === 'back') setBackSlots(updater);
      else setThirdSlots(updater);
      return null;
    });
  }, []);

  if (!isLoggedIn) return <Login onLogin={handleLogin} error={loginError} />;

  return (
    <div className="h-screen flex flex-col font-sans antialiased text-gray-900 bg-[#fbfbfd] select-none overflow-hidden relative">
      <div className="fixed inset-0 pointer-events-none z-0">
        <div className="absolute top-[-20%] left-[-15%] w-[70%] h-[70%] bg-[#ff385c]/5 rounded-full blur-[150px] opacity-40 animate-pulse" />
      </div>

      <div className="sticky top-0 z-[100] w-full shrink-0 h-[12vh] shadow-[0_1px_0_rgba(0,0,0,0.05)]">
        <Header 
          projectName={projectName} onProjectNameChange={setProjectName}
          onOpenPdfDialog={() => setIsPdfModalOpen(true)} 
          onOpenAIDialog={() => setIsAIModalOpen(true)}
          onExportSVG={handleExportSvg} onBatchExportPNG={batchExportRoundedPNGs}
          onLogout={handleLogout} isProcessing={isProcessing} progress={exportProgress}
        />
      </div>
      
      <main className="flex-1 flex overflow-hidden relative z-10" style={{ background: 'linear-gradient(135deg, #f0f9ff 0%, #fdf2f8 100%)' }}>
        <Sidebar 
          config={config} 
          onConfigChange={handleConfigChange} 
          onFilesUpload={handleUnifiedUpload} 
          onSliceUpload={setSliceModalFile}
          isProcessing={isProcessing} 
          onResetConfig={resetConfig} 
          onBatchMask={batchSetMask} 
          onBatchStretch={batchToggleStretch}
          onBatchAutoFitBleed={batchAutoFitBleed}
          onBatchAutoFitDieCut={batchAutoFitDieCut}
        />
        
        <div className={`flex-1 overflow-hidden relative cursor-${isPanning ? 'grabbing' : 'grab'}`} 
             onWheel={(e) => { if (e.ctrlKey) { setZoom(z => Math.min(Math.max(z - e.deltaY * 0.001, 0.1), 5)); e.preventDefault(); } }} 
             onMouseDown={(e) => { if (e.button === 0) { setIsPanning(true); panStartRef.current = { x: e.clientX - pan.x, y: e.clientY - pan.y }; } }}
             onMouseMove={(e) => isPanning && setPan({ x: e.clientX - panStartRef.current.x, y: e.clientY - panStartRef.current.y })}
             onMouseUp={() => setIsPanning(false)}
             onMouseLeave={() => setIsPanning(false)}>
          
          {totalPages > 1 && (
            <div className="absolute top-8 left-1/2 -translate-x-1/2 z-50 flex bg-white/70 backdrop-blur-3xl shadow-[0_20px_60px_rgba(0,0,0,0.08)] rounded-full p-1.5 border border-white/80 no-print scale-90 md:scale-100">
              {totalPages >= 1 && (
                <button onClick={() => { setViewMode('front'); setZoom(viewMode === 'all' ? 0.65 : zoom); setPan({x:0, y:0}); }} 
                        className={`px-10 py-3 rounded-full text-[9px] font-black tracking-[0.2em] uppercase transition-all duration-500 ${(viewMode === 'front') ? 'bg-[#ff385c] text-white shadow-lg' : 'text-gray-400 hover:text-gray-900'}`}>
                  第一页
                </button>
              )}
              {totalPages >= 2 && (
                <button onClick={() => { setViewMode('back'); setZoom(viewMode === 'all' ? 0.65 : zoom); setPan({x:0, y:0}); }} 
                        className={`px-10 py-3 rounded-full text-[9px] font-black tracking-[0.2em] uppercase transition-all duration-500 ${viewMode === 'back' ? 'bg-[#ff385c] text-white shadow-lg' : 'text-gray-400 hover:text-gray-900'}`}>
                  第二页
                </button>
              )}
              {totalPages >= 3 && (
                <button onClick={() => { setViewMode('third'); setZoom(viewMode === 'all' ? 0.65 : zoom); setPan({x:0, y:0}); }} 
                        className={`px-10 py-3 rounded-full text-[9px] font-black tracking-[0.2em] uppercase transition-all duration-500 ${viewMode === 'third' ? 'bg-[#ff385c] text-white shadow-lg' : 'text-gray-400 hover:text-gray-900'}`}>
                  第三页
                </button>
              )}
              {totalPages > 1 && (
                <button onClick={() => { setViewMode('all'); setZoom(0.35); setPan({x:0, y:0}); }} 
                        className={`px-10 py-3 rounded-full text-[9px] font-black tracking-[0.2em] uppercase transition-all duration-500 ${viewMode === 'all' ? 'bg-[#ff385c] text-white shadow-lg' : 'text-gray-400 hover:text-gray-900'}`}>
                  全选
                </button>
              )}
            </div>
          )}

          <div className="absolute inset-0 flex items-center justify-center pointer-events-none" 
               style={{ 
                 // Use translate3d for GPU acceleration
                 transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoom})`, 
                 transition: isPanning ? 'none' : 'transform 0.4s cubic-bezier(0.2, 0, 0, 1)',
                 willChange: 'transform' // Hint for browser optimization
               }}>
            <div className={`flex pointer-events-auto items-start ${viewMode === 'all' && totalPages > 1 ? 'space-x-12 p-20' : 'p-20'}`}>
              {totalPages >= 1 && (viewMode === 'front' || viewMode === 'all' || totalPages === 1) && (
                <div className="flex flex-col items-center">
                  <div style={{ width: `${config.canvasWidth}mm`, height: `${config.canvasHeight}mm`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <Canvas 
                        config={config} 
                        slots={frontSlots} 
                        label="PAGE 1" 
                        note={pageNotes[0]} 
                        onNoteChange={handleNoteChangePage1} 
                        onSlotClick={handleEditSlotPage1}
                      />
                  </div>
                  {viewMode === 'all' && totalPages > 1 && <div className="mt-8 text-[16px] font-black text-gray-300 tracking-[0.4em] uppercase">第一页序列</div>}
                </div>
              )}
              {totalPages >= 2 && (viewMode === 'back' || viewMode === 'all') && (
                <div className="flex flex-col items-center">
                  <div style={{ width: `${config.canvasWidth}mm`, height: `${config.canvasHeight}mm`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <Canvas 
                        config={config} 
                        slots={backSlots} 
                        label="PAGE 2" 
                        note={pageNotes[1]} 
                        onNoteChange={handleNoteChangePage2}
                        onSlotClick={handleEditSlotPage2}
                      />
                  </div>
                  {viewMode === 'all' && totalPages > 1 && <div className="mt-8 text-[16px] font-black text-gray-300 tracking-[0.4em] uppercase">第二页序列</div>}
                </div>
              )}
              {totalPages >= 3 && (viewMode === 'third' || viewMode === 'all') && (
                <div className="flex flex-col items-center">
                  <div style={{ width: `${config.canvasWidth}mm`, height: `${config.canvasHeight}mm`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <Canvas 
                        config={config} 
                        slots={thirdSlots} 
                        label="PAGE 3" 
                        note={pageNotes[2]} 
                        onNoteChange={handleNoteChangePage3}
                        onSlotClick={handleEditSlotPage3}
                      />
                  </div>
                  {viewMode === 'all' && totalPages > 1 && <div className="mt-8 text-[16px] font-black text-gray-300 tracking-[0.4em] uppercase">第三页序列</div>}
                </div>
              )}
            </div>
          </div>

          <div className="absolute bottom-12 left-1/2 -translate-x-1/2 flex items-center space-x-3 no-print z-50">
            <div className="bg-white/60 backdrop-blur-3xl px-6 py-3 rounded-full shadow-xl border border-white/80 flex items-center space-x-6">
              <button onClick={() => setZoom(z => Math.max(z - 0.1, 0.1))} className="text-gray-400 hover:text-[#ff385c] transition-colors">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M20 12H4" /></svg>
              </button>
              <button onClick={() => {setZoom(viewMode === 'all' ? 0.35 : 0.65); setPan({x:0, y:0});}} className="text-[10px] font-black text-gray-900 tracking-widest min-w-[60px]">{Math.round(zoom * 100)}%</button>
              <button onClick={() => setZoom(z => Math.min(z + 0.1, 5))} className="text-gray-400 hover:text-[#ff385c] transition-colors">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M12 6v6m0 0v6m0-6h6m-6 0H6" /></svg>
              </button>
            </div>
          </div>
        </div>
      </main>

      <ExportModal isOpen={isPdfModalOpen} onClose={() => setIsPdfModalOpen(false)} onConfirm={handleExportPdf} />
      <ExportAIModal isOpen={isAIModalOpen} onClose={() => setIsAIModalOpen(false)} onConfirm={handleExportAI} />
      
      <CropModal 
        isOpen={!!editingSlot} 
        onClose={() => setEditingSlot(null)} 
        slot={editingSlot?.slot || null} 
        onSave={handleSaveCrop} 
      />

      <SliceModal 
        isOpen={!!sliceModalFile} 
        file={sliceModalFile} 
        onClose={() => setSliceModalFile(null)} 
        onConfirm={(files) => {
          handleUnifiedUpload(files);
          setSliceModalFile(null);
        }} 
      />
    </div>
  );
};

export default App;
