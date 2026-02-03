import React, { useState, useRef, useEffect, useMemo } from 'react';
import { 
  Upload, 
  Ruler, 
  Scan, 
  Download, 
  Trash2, 
  ZoomIn, 
  ZoomOut, 
  Maximize, 
  CheckCircle2, 
  MousePointer2,
  ChevronLeft,
  ChevronRight, 
  Leaf, 
  PenTool, 
  Sliders, 
  Play, 
  X
} from 'lucide-react';

/**
 * LeafArea Pro v2.1 (Otimizado)
 * - Performance: Processamento de pixels restrito ao Bounding Box dos polígonos
 * - UX: Auto-fechamento de polígonos por proximidade
 * - UX: Sliders maiores e mais fluídos
 */

// --- Helpers ---

// Converte RGB para HSL
function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h, s, l = (max + min) / 2;

  if (max === min) {
    h = s = 0; 
  } else {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }
  return [h * 360, s * 100, l * 100];
}

// Calcula o retângulo que engloba todos os polígonos para otimizar o loop de pixels
function getBoundingBox(polygons, width, height) {
    if (!polygons || polygons.length === 0) return { x: 0, y: 0, w: width, h: height };
    
    let minX = width, minY = height, maxX = 0, maxY = 0;
    
    polygons.forEach(poly => {
        poly.forEach(p => {
            if (p.x < minX) minX = p.x;
            if (p.x > maxX) maxX = p.x;
            if (p.y < minY) minY = p.y;
            if (p.y > maxY) maxY = p.y;
        });
    });

    // Adicionar margem de segurança e garantir limites da imagem
    const margin = 2;
    minX = Math.max(0, Math.floor(minX - margin));
    minY = Math.max(0, Math.floor(minY - margin));
    maxX = Math.min(width, Math.ceil(maxX + margin));
    maxY = Math.min(height, Math.ceil(maxY + margin));

    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

// --- Componentes UI Reutilizáveis ---

const Button = ({ children, onClick, active, disabled, variant = 'primary', className = '' }) => {
  const baseStyle = "flex items-center gap-2 px-3 py-1.5 rounded-lg font-medium transition-all duration-200 text-sm";
  const variants = {
    primary: active 
      ? "bg-emerald-600 text-white shadow-lg shadow-emerald-900/20" 
      : "bg-emerald-500 hover:bg-emerald-600 text-white shadow-md",
    secondary: active
      ? "bg-slate-700 text-white border border-slate-600"
      : "bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700",
    danger: "bg-red-500/10 hover:bg-red-500 text-red-500 hover:text-white border border-red-500/20",
    ghost: "text-slate-400 hover:text-white hover:bg-slate-800"
  };

  return (
    <button 
      onClick={onClick} 
      disabled={disabled}
      className={`${baseStyle} ${variants[variant]} ${disabled ? 'opacity-50 cursor-not-allowed' : ''} ${className}`}
    >
      {children}
    </button>
  );
};

const SliderGroup = ({ label, minVal, maxVal, setMin, setMax, rangeMin, rangeMax, unit = "" }) => (
    <div className="flex flex-col gap-2 w-full">
        <div className="flex justify-between text-xs text-slate-400 font-bold uppercase tracking-wide">
            <span>{label}</span>
            <span className="text-emerald-400">{minVal}-{maxVal}{unit}</span>
        </div>
        <div className="flex items-center gap-3 bg-slate-900/50 p-2 rounded-lg border border-slate-700/50">
            <input 
                type="range" min={rangeMin} max={rangeMax} value={minVal} 
                onChange={(e) => setMin(Math.min(parseInt(e.target.value), maxVal))}
                className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-emerald-500 hover:accent-emerald-400 transition-all"
            />
            <input 
                type="range" min={rangeMin} max={rangeMax} value={maxVal} 
                onChange={(e) => setMax(Math.max(parseInt(e.target.value), minVal))}
                className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-emerald-500 hover:accent-emerald-400 transition-all"
            />
        </div>
    </div>
);

// --- Lógica Principal ---

export default function App() {
  // Estados Globais
  const [images, setImages] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [isSidebarOpen, setSidebarOpen] = useState(true);
  const [showExportModal, setShowExportModal] = useState(false);

  // Estados do Editor
  const [mode, setMode] = useState('view'); // 'view', 'calibrate', 'polygon', 'threshold'
  const [scaleFactor, setScaleFactor] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  
  // Dados de Trabalho Temporários
  const [calibrationPoints, setCalibrationPoints] = useState([]);
  const [realDistance, setRealDistance] = useState(10);
  
  // Polígonos
  const [polygons, setPolygons] = useState([]); // Lista de Polígonos [[{x,y}...], ...]
  const [currentPolygon, setCurrentPolygon] = useState([]); // Polígono sendo desenhado agora

  // Filtro de Cor (HSL)
  const [hslParams, setHslParams] = useState({
      hMin: 30, hMax: 160, // Foco em verdes
      sMin: 15, sMax: 100,
      lMin: 15, lMax: 90
  });

  // Refs
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  
  const activeImage = useMemo(() => images.find(img => img.id === selectedId), [images, selectedId]);

  // --- File System ---

  const handleFileUpload = (e) => {
    const files = Array.from(e.target.files);
    const newImages = files.map(file => ({
      id: crypto.randomUUID(),
      name: file.name,
      url: URL.createObjectURL(file),
      width: 0, height: 0,
      scaleData: null,
      polygons: [], // Polígonos salvos
      results: [], // [{ id: 1, area: 12.5 }, ...]
      status: 'pending'
    }));

    setImages(prev => [...prev, ...newImages]);
    if (!selectedId && newImages.length > 0) setSelectedId(newImages[0].id);
  };

  const removeImage = (id, e) => {
    e.stopPropagation();
    setImages(prev => prev.filter(img => img.id !== id));
    if (selectedId === id) setSelectedId(null);
  };

  // --- Canvas Logic ---

  useEffect(() => {
    if (!activeImage || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const img = new Image();
    
    img.onload = () => {
      if (activeImage.width === 0) {
        setImages(prev => prev.map(item => 
          item.id === activeImage.id ? { ...item, width: img.width, height: img.height } : item
        ));
      }
      canvas.width = img.width;
      canvas.height = img.height;
      drawCanvas(img);
      fitToScreen(img.width, img.height);
    };
    img.src = activeImage.url;

    // Load saved state
    setCalibrationPoints(activeImage.tempCalibrationPoints || []);
    setPolygons(activeImage.polygons || []);
    setCurrentPolygon([]);
  }, [selectedId]);

  // Redraw trigger
  useEffect(() => {
    if (!activeImage || !canvasRef.current) return;
    const img = new Image();
    img.src = activeImage.url;
    // Otimização: Se apenas sliders mudarem, talvez não precise recarregar imagem do zero se tivermos um buffer,
    // mas o navegador geralmente lida bem com cache de imagem src.
    img.onload = () => drawCanvas(img);
  }, [mode, calibrationPoints, polygons, currentPolygon, hslParams, activeImage]);

  const drawCanvas = (img) => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    
    // 1. Base Image
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0);

    // 2. Threshold Preview (Somente dentro dos polígonos no modo threshold)
    if (mode === 'threshold' && polygons.length > 0) {
        renderThresholdPreview(ctx);
    } 
    // Show processed results if ready and not editing
    else if (activeImage.status === 'ready' && mode === 'view') {
        renderResultsOverlay(ctx);
    }

    // 3. Polígonos
    ctx.lineWidth = 2 / scaleFactor;
    
    // Polígonos Salvos
    polygons.forEach((poly, idx) => {
        if (poly.length < 2) return;
        ctx.beginPath();
        ctx.moveTo(poly[0].x, poly[0].y);
        poly.forEach(p => ctx.lineTo(p.x, p.y));
        ctx.closePath();
        ctx.strokeStyle = '#34d399'; // Emerald 400
        ctx.stroke();
        ctx.fillStyle = 'rgba(52, 211, 153, 0.1)';
        ctx.fill();

        // Label
        const center = getPolygonCenter(poly);
        ctx.fillStyle = '#fff';
        ctx.font = `bold ${16/scaleFactor}px Arial`;
        ctx.fillText(`#${idx+1}`, center.x, center.y);
    });

    // Polígono Atual (Sendo desenhado)
    if (currentPolygon.length > 0) {
        ctx.beginPath();
        ctx.moveTo(currentPolygon[0].x, currentPolygon[0].y);
        currentPolygon.forEach(p => ctx.lineTo(p.x, p.y));
        ctx.strokeStyle = '#facc15'; // Yellow
        ctx.stroke();
        
        // Desenha pontos
        currentPolygon.forEach((p, idx) => {
            ctx.beginPath();
            ctx.arc(p.x, p.y, 3 / scaleFactor, 0, Math.PI * 2);
            ctx.fillStyle = idx === 0 ? '#ffffff' : '#facc15'; // Primeiro ponto branco para indicar fechamento
            ctx.fill();
            if (idx === 0) {
                ctx.strokeStyle = '#facc15';
                ctx.lineWidth = 1 / scaleFactor;
                ctx.stroke();
            }
        });
    }

    // 4. Calibration Points
    if (mode === 'calibrate' || activeImage.scaleData) {
        const points = mode === 'calibrate' ? calibrationPoints : (activeImage.savedPoints || []);
        if (points.length > 0) {
            points.forEach((p, idx) => {
                ctx.beginPath();
                // Tamanho fixo visual: 5px radius dividido pelo scaleFactor
                ctx.arc(p.x, p.y, 5 / scaleFactor, 0, Math.PI * 2);
                ctx.fillStyle = '#ef4444';
                ctx.strokeStyle = 'white';
                ctx.lineWidth = 2 / scaleFactor;
                ctx.fill();
                ctx.stroke();
            });

            if (points.length === 2) {
                ctx.beginPath();
                ctx.moveTo(points[0].x, points[0].y);
                ctx.lineTo(points[1].x, points[1].y);
                ctx.strokeStyle = '#facc15';
                ctx.lineWidth = 2 / scaleFactor;
                ctx.stroke();
                
                // Texto de distância
                const midX = (points[0].x + points[1].x) / 2;
                const midY = (points[0].y + points[1].y) / 2;
                ctx.fillStyle = 'white';
                ctx.strokeStyle = 'black';
                ctx.lineWidth = 3;
                ctx.font = `bold ${14 / scaleFactor}px Arial`;
                const text = activeImage.scaleData ? `${activeImage.scaleData.realCm}cm` : `? cm`;
                ctx.strokeText(text, midX + 10/scaleFactor, midY);
                ctx.fillText(text, midX + 10/scaleFactor, midY);
            }
        }
    }
  };

  const getPolygonCenter = (poly) => {
      let x = 0, y = 0;
      poly.forEach(p => { x += p.x; y += p.y; });
      return { x: x / poly.length, y: y / poly.length };
  };

  const renderThresholdPreview = (ctx) => {
      const w = ctx.canvas.width;
      const h = ctx.canvas.height;
      
      // OTIMIZAÇÃO: Calcular Bounding Box para processar apenas pixels relevantes
      const bbox = getBoundingBox(polygons, w, h);
      if (bbox.w <= 0 || bbox.h <= 0) return;

      // 1. Criar máscara apenas para a área relevante (Bounding Box)
      const maskCanvas = document.createElement('canvas');
      maskCanvas.width = bbox.w;
      maskCanvas.height = bbox.h;
      const maskCtx = maskCanvas.getContext('2d');
      
      // Ajustar contexto para desenhar polígonos relativos ao bbox
      maskCtx.translate(-bbox.x, -bbox.y);
      
      maskCtx.fillStyle = '#000000';
      maskCtx.fillRect(bbox.x, bbox.y, bbox.w, bbox.h);
      maskCtx.fillStyle = '#FFFFFF';
      
      polygons.forEach(poly => {
          if(poly.length < 3) return;
          maskCtx.beginPath();
          maskCtx.moveTo(poly[0].x, poly[0].y);
          poly.forEach(p => maskCtx.lineTo(p.x, p.y));
          maskCtx.closePath();
          maskCtx.fill();
      });

      // 2. Pegar dados da imagem APENAS do bbox
      const imageData = ctx.getImageData(bbox.x, bbox.y, bbox.w, bbox.h);
      const data = imageData.data;
      const maskData = maskCtx.getImageData(0, 0, bbox.w, bbox.h).data;

      // 3. Processar pixels
      for (let i = 0; i < data.length; i += 4) {
          // Se máscara é branca (dentro do polígono)
          // Usamos canal R (index 0) da máscara. A máscara é P&B.
          if (maskData[i] > 128) {
              const r = data[i], g = data[i+1], b = data[i+2];
              const [hVal, sVal, lVal] = rgbToHsl(r, g, b);

              // Verifica HSL Ranges
              if (hVal >= hslParams.hMin && hVal <= hslParams.hMax &&
                  sVal >= hslParams.sMin && sVal <= hslParams.sMax &&
                  lVal >= hslParams.lMin && lVal <= hslParams.lMax) {
                  
                  // Highlight Green
                  data[i] = 0;
                  data[i+1] = 255;
                  data[i+2] = 0;
              }
          }
      }
      
      // Colocar de volta na posição correta
      ctx.putImageData(imageData, bbox.x, bbox.y);
  };

  const renderResultsOverlay = (ctx) => {
      polygons.forEach((poly, idx) => {
          const res = activeImage.results.find(r => r.id === idx + 1);
          if (res) {
            const center = getPolygonCenter(poly);
            ctx.fillStyle = 'white';
            ctx.strokeStyle = 'black';
            ctx.lineWidth = 2;
            ctx.font = `bold ${16/scaleFactor}px Arial`;
            const text = `${res.area} cm²`;
            ctx.strokeText(text, center.x, center.y + 20/scaleFactor);
            ctx.fillText(text, center.x, center.y + 20/scaleFactor);
          }
      });
  };

  // --- Interaction Logic ---

  const getCanvasCoordinates = (e) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    return {
        x: (e.clientX - rect.left) / scaleFactor,
        y: (e.clientY - rect.top) / scaleFactor
    };
  };

  const handleMouseDown = (e) => {
    if (e.button === 1 || mode === 'view' || e.shiftKey) {
        setIsDragging(true);
        setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
        return;
    }

    const coords = getCanvasCoordinates(e);

    if (mode === 'calibrate') {
        if (calibrationPoints.length >= 2) setCalibrationPoints([coords]);
        else setCalibrationPoints(prev => [...prev, coords]);
    } else if (mode === 'polygon') {
        // Lógica de fechamento automático por proximidade
        if (currentPolygon.length > 2) {
            const startPoint = currentPolygon[0];
            const dist = Math.sqrt(
                Math.pow(coords.x - startPoint.x, 2) + 
                Math.pow(coords.y - startPoint.y, 2)
            );
            
            // Tolerância visual de 20px (ajustada pelo zoom para manter consistência na tela)
            const snapDistance = 20 / scaleFactor;
            
            if (dist < snapDistance) {
                handlePolygonClose();
                return;
            }
        }
        setCurrentPolygon(prev => [...prev, coords]);
    }
  };

  const handlePolygonClose = () => {
      if (currentPolygon.length > 2) {
          setPolygons(prev => [...prev, currentPolygon]);
          setCurrentPolygon([]);
      }
  };

  // --- Processing ---

  const saveCalibration = () => {
    if (calibrationPoints.length !== 2) return;
    const p1 = calibrationPoints[0];
    const p2 = calibrationPoints[1];
    const distPixels = Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2));
    const ratio = distPixels / realDistance;
    
    setImages(prev => prev.map(img => 
        img.id === selectedId 
        ? { ...img, scaleData: { pixels: distPixels, realCm: realDistance, ratio }, savedPoints: calibrationPoints } 
        : img
    ));
    setMode('view');
  };

  const processAreas = () => {
    if (!activeImage.scaleData) return alert("Calibre a imagem primeiro!");
    if (polygons.length === 0) return alert("Defina pelo menos um polígono.");

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const { ratio } = activeImage.scaleData;

    // Redesenhar imagem limpa para ler dados
    const img = new Image();
    img.src = activeImage.url;
    ctx.drawImage(img, 0, 0);
    const fullData = ctx.getImageData(0,0, canvas.width, canvas.height).data;

    const results = polygons.map((poly, idx) => {
        // Criar mask para este polígono específico
        const tempC = document.createElement('canvas');
        tempC.width = canvas.width;
        tempC.height = canvas.height;
        const tempCtx = tempC.getContext('2d');
        tempCtx.fillStyle = 'black';
        tempCtx.fillRect(0,0,canvas.width,canvas.height);
        tempCtx.fillStyle = 'white';
        tempCtx.beginPath();
        tempCtx.moveTo(poly[0].x, poly[0].y);
        poly.forEach(p => tempCtx.lineTo(p.x, p.y));
        tempCtx.closePath();
        tempCtx.fill();
        
        const maskData = tempCtx.getImageData(0,0, canvas.width, canvas.height).data;
        let pixelCount = 0;

        for (let i = 0; i < fullData.length; i += 4) {
            // Se pixel está no polígono (máscara branca)
            if (maskData[i] > 128) {
                const r = fullData[i], g = fullData[i+1], b = fullData[i+2];
                const [h, s, l] = rgbToHsl(r, g, b);
                
                if (h >= hslParams.hMin && h <= hslParams.hMax &&
                    s >= hslParams.sMin && s <= hslParams.sMax &&
                    l >= hslParams.lMin && l <= hslParams.lMax) {
                    pixelCount++;
                }
            }
        }

        const area = pixelCount / (ratio * ratio);
        return { id: idx + 1, area: area.toFixed(2) };
    });

    const totalArea = results.reduce((acc, curr) => acc + parseFloat(curr.area), 0);

    setImages(prev => prev.map(img => 
        img.id === selectedId 
        ? { ...img, results, areaCm2: totalArea.toFixed(2), polygons, status: 'ready' } 
        : img
    ));
    setMode('view');
  };

  const handleExport = (separator) => {
    const header = `Nome do Arquivo${separator}Folha ID${separator}Area (cm2)${separator}Escala (px/cm)\n`;
    const rows = images.flatMap(img => {
        if (!img.results || img.results.length === 0) return [];
        return img.results.map(res => 
            `${img.name}${separator}${res.id}${separator}${res.area.replace('.', ',')}${separator}${img.scaleData?.ratio.toFixed(2)}`
        );
    }).join("\n");

    const csvContent = "data:text/csv;charset=utf-8," + encodeURI(header + rows);
    const link = document.createElement("a");
    link.setAttribute("href", csvContent);
    link.setAttribute("download", `areas_foliares_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setShowExportModal(false);
  };

  // --- View Helpers ---
  const fitToScreen = (w, h) => {
    if (!containerRef.current) return;
    const { clientWidth, clientHeight } = containerRef.current;
    const scale = Math.min(clientWidth / w, clientHeight / h) * 0.9;
    setScaleFactor(scale);
    setPan({ x: (clientWidth - w * scale) / 2, y: (clientHeight - h * scale) / 2 });
  };

  // --- Render ---

  return (
    <div className="flex h-screen w-full bg-slate-950 text-slate-100 overflow-hidden font-sans select-none">
      
      {/* Export Modal */}
      {showExportModal && (
          <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center backdrop-blur-sm">
              <div className="bg-slate-900 border border-slate-700 p-6 rounded-xl shadow-2xl w-80">
                  <h3 className="text-lg font-bold text-white mb-4">Exportar CSV</h3>
                  <p className="text-slate-400 text-sm mb-6">Escolha o separador para o arquivo CSV:</p>
                  <div className="flex gap-3">
                      <Button onClick={() => handleExport(',')} variant="secondary" className="flex-1 justify-center">Vírgula (,)</Button>
                      <Button onClick={() => handleExport(';')} variant="primary" className="flex-1 justify-center">Ponto e Vírgula (;)</Button>
                  </div>
                  <button onClick={() => setShowExportModal(false)} className="mt-4 text-xs text-slate-500 hover:text-white w-full text-center">Cancelar</button>
              </div>
          </div>
      )}

      {/* Sidebar */}
      <div className={`flex flex-col border-r border-slate-800 bg-slate-900 transition-all duration-300 ${isSidebarOpen ? 'w-80' : 'w-0'}`}>
        <div className="p-4 border-b border-slate-800 flex justify-between items-center bg-slate-900 z-10">
          <div className="flex items-center gap-2 text-emerald-400">
            <Leaf className="w-6 h-6" />
            <h1 className="font-bold text-lg tracking-tight text-white">LeafArea Pro</h1>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <div className="bg-slate-800/50 rounded-xl p-4 border border-slate-700/50 hover:bg-slate-800 transition-colors">
             <label className="flex flex-col items-center gap-2 cursor-pointer group">
                <div className="w-10 h-10 rounded-full bg-emerald-500/10 text-emerald-500 flex items-center justify-center group-hover:bg-emerald-500 group-hover:text-white transition-colors">
                    <Upload className="w-5 h-5" />
                </div>
                <span className="text-sm font-medium text-slate-300 group-hover:text-white">Importar Fotos</span>
                <input type="file" multiple accept="image/*" onChange={handleFileUpload} className="hidden" />
             </label>
          </div>

          <div className="space-y-2">
            <div className="flex justify-between items-center mb-2">
                <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Galeria</h2>
                <span className="text-xs text-slate-600">{images.length} fotos</span>
            </div>
            {images.map(img => (
              <div 
                key={img.id}
                onClick={() => setSelectedId(img.id)}
                className={`group flex items-center gap-3 p-2 rounded-lg cursor-pointer border transition-all ${
                  selectedId === img.id 
                    ? 'bg-emerald-900/20 border-emerald-500/50' 
                    : 'bg-slate-800 border-transparent hover:border-slate-700'
                }`}
              >
                <div className="w-10 h-10 rounded bg-slate-950 overflow-hidden relative flex-shrink-0">
                    <img src={img.url} className="w-full h-full object-cover opacity-80 group-hover:opacity-100" alt="" />
                    {img.status === 'ready' && <div className="absolute bottom-0 right-0 bg-emerald-500 p-0.5 rounded-tl"><CheckCircle2 className="w-2.5 h-2.5 text-white" /></div>}
                </div>
                <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate text-slate-200">{img.name}</p>
                    <p className="text-xs text-slate-500">
                        {img.results?.length > 0 ? `${img.results.length} folha(s)` : 'Pendente'}
                    </p>
                </div>
                <button onClick={(e) => removeImage(img.id, e)} className="p-1.5 text-slate-600 hover:text-red-400 opacity-0 group-hover:opacity-100"><Trash2 className="w-4 h-4" /></button>
              </div>
            ))}
          </div>
        </div>

        <div className="p-4 border-t border-slate-800">
            <Button onClick={() => setShowExportModal(true)} variant="secondary" className="w-full justify-center" disabled={images.length === 0}>
                <Download className="w-4 h-4" /> Exportar Resultados
            </Button>
        </div>
      </div>

      {/* Main Area */}
      <div className="flex-1 flex flex-col h-full relative">
        <button onClick={() => setSidebarOpen(!isSidebarOpen)} className="absolute top-4 left-4 z-30 bg-slate-800 p-2 rounded-lg border border-slate-700 text-slate-400 hover:text-white shadow-lg">
            {isSidebarOpen ? <ChevronLeft size={20}/> : <ChevronRight size={20}/>}
        </button>

        {/* Toolbar */}
        <div className="h-16 border-b border-slate-800 bg-slate-900/95 backdrop-blur flex items-center px-4 justify-between z-20 shadow-sm">
            <div className="pl-14 flex items-center gap-2">
                {selectedId ? (
                    <div className="flex bg-slate-800 rounded-lg p-1 gap-1 border border-slate-700">
                        <Button variant={mode === 'view' ? 'secondary' : 'ghost'} onClick={() => setMode('view')}>
                            <MousePointer2 className="w-4 h-4" /> Ver
                        </Button>
                        <Button variant={mode === 'calibrate' ? 'primary' : 'ghost'} onClick={() => setMode('calibrate')}>
                            <Ruler className="w-4 h-4" /> Calibrar
                        </Button>
                        <Button variant={mode === 'polygon' ? 'primary' : 'ghost'} onClick={() => setMode('polygon')} disabled={!activeImage?.scaleData}>
                            <PenTool className="w-4 h-4" /> Polígonos
                        </Button>
                        <Button variant={mode === 'threshold' ? 'primary' : 'ghost'} onClick={() => setMode('threshold')} disabled={!activeImage?.scaleData || polygons.length === 0}>
                            <Sliders className="w-4 h-4" /> Cor & Cálculo
                        </Button>
                    </div>
                ) : <span className="text-slate-500 text-sm">Nenhuma imagem selecionada</span>}
            </div>

            {/* Context Controls */}
            <div className="flex items-center gap-4">
                 {mode === 'calibrate' && (
                    <div className="flex items-center gap-2 animate-in fade-in slide-in-from-top-2 bg-slate-800 p-1.5 rounded-lg border border-slate-700">
                        <span className="text-xs text-slate-400 font-bold px-2">REF:</span>
                        <input type="number" value={realDistance} onChange={(e) => setRealDistance(parseFloat(e.target.value))} className="w-16 bg-slate-900 border border-slate-600 rounded px-2 py-1 text-sm outline-none focus:border-emerald-500" />
                        <span className="text-sm text-slate-400">cm</span>
                        <Button onClick={saveCalibration} className="h-8 text-xs">OK</Button>
                    </div>
                 )}

                 {mode === 'polygon' && (
                     <div className="flex items-center gap-2 animate-in fade-in slide-in-from-top-2">
                        <span className="text-xs text-slate-400">Clique para pontos. Clique próximo ao início para fechar.</span>
                        {currentPolygon.length > 2 && (
                             <Button onClick={handlePolygonClose} className="h-8 text-xs bg-amber-500 hover:bg-amber-600">Fechar Polígono</Button>
                        )}
                        <Button onClick={() => {setPolygons([]); setCurrentPolygon([]);}} variant="danger" className="h-8 text-xs">Limpar</Button>
                     </div>
                 )}

                 {mode === 'threshold' && (
                     <div className="flex items-center gap-4 animate-in fade-in slide-in-from-top-2 bg-slate-800 p-4 rounded-xl border border-slate-700 shadow-2xl absolute top-16 right-4 flex-col items-end w-80 z-50 ring-1 ring-slate-700/50">
                        <div className="w-full space-y-4 pb-2">
                            <h4 className="text-sm font-bold text-slate-300 uppercase border-b border-slate-700 pb-2 mb-2 flex items-center gap-2">
                                <Sliders className="w-4 h-4 text-emerald-500" /> Filtro HSL
                            </h4>
                            <SliderGroup label="Hue (Matiz)" minVal={hslParams.hMin} maxVal={hslParams.hMax} setMin={v => setHslParams(p=>({...p, hMin:v}))} setMax={v => setHslParams(p=>({...p, hMax:v}))} rangeMin={0} rangeMax={360} unit="°" />
                            <SliderGroup label="Sat (Saturação)" minVal={hslParams.sMin} maxVal={hslParams.sMax} setMin={v => setHslParams(p=>({...p, sMin:v}))} setMax={v => setHslParams(p=>({...p, sMax:v}))} rangeMin={0} rangeMax={100} unit="%" />
                            <SliderGroup label="Lum (Luminosidade)" minVal={hslParams.lMin} maxVal={hslParams.lMax} setMin={v => setHslParams(p=>({...p, lMin:v}))} setMax={v => setHslParams(p=>({...p, lMax:v}))} rangeMin={0} rangeMax={100} unit="%" />
                        </div>
                        <Button onClick={processAreas} className="w-full justify-center mt-2 py-3 bg-emerald-600 hover:bg-emerald-500 font-bold text-white shadow-lg shadow-emerald-900/50 transition-all">
                            <Play className="w-4 h-4 fill-current" /> Calcular Áreas
                        </Button>
                     </div>
                 )}
            </div>
        </div>

        {/* Canvas Area */}
        <div className="flex-1 overflow-hidden relative cursor-crosshair bg-[url('https://www.transparenttextures.com/patterns/cubes.png')] bg-slate-950" ref={containerRef}>
            {activeImage && (
                <div 
                    className="absolute inset-0 transform-gpu origin-top-left"
                    style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${scaleFactor})` }}
                    onWheel={(e) => {
                        e.preventDefault();
                        const delta = -e.deltaY * 0.001;
                        setScaleFactor(s => Math.min(Math.max(0.1, s + delta), 20));
                    }}
                    onMouseDown={handleMouseDown}
                    onMouseMove={(e) => {
                        if (isDragging) setPan({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y });
                    }}
                    onMouseUp={() => setIsDragging(false)}
                    onMouseLeave={() => setIsDragging(false)}
                    onDoubleClick={mode === 'polygon' ? handlePolygonClose : undefined}
                >
                   <canvas ref={canvasRef} className="shadow-2xl ring-1 ring-slate-800" />
                </div>
            )}
            
            {/* Overlay Info */}
            {activeImage && (
                <div className="absolute bottom-4 left-4 bg-slate-900/80 backdrop-blur px-3 py-1 rounded text-xs font-mono text-slate-400 border border-slate-700 pointer-events-none">
                    Zoom: {(scaleFactor * 100).toFixed(0)}% | Mode: {mode.toUpperCase()}
                </div>
            )}
            
            {/* Zoom Controls */}
            {activeImage && (
                <div className="absolute bottom-6 right-6 flex flex-col gap-2">
                    <button onClick={() => fitToScreen(activeImage.width, activeImage.height)} className="p-2 bg-slate-800 hover:bg-slate-700 text-white rounded shadow border border-slate-700"><Maximize size={18} /></button>
                    <div className="flex flex-col bg-slate-800 rounded border border-slate-700 overflow-hidden">
                        <button onClick={() => setScaleFactor(s => s * 1.2)} className="p-2 hover:bg-slate-700 text-white border-b border-slate-700"><ZoomIn size={18} /></button>
                        <button onClick={() => setScaleFactor(s => s / 1.2)} className="p-2 hover:bg-slate-700 text-white"><ZoomOut size={18} /></button>
                    </div>
                </div>
            )}
        </div>
      </div>
    </div>
  );
}
