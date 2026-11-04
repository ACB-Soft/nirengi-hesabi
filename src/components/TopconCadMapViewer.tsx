/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * Topcon Tools Style GNSS Network CAD / Map View (Ağ Haritası & CAD Koordinat Planı)
 * Exactly reproduces the CAD vector map interface from Topcon Tools / TBC:
 * - Top-left header: "Northing, Meters"
 * - Left vertical axis: Metric Northing tick marks and labels (e.g. 4497500, 4500000...)
 * - Bottom horizontal axis: Metric Easting tick marks and labels (e.g. 435000, 437500...) + "Easting, Meters"
 * - Bottom-left button: Green CAD "Zoom to Extents / Sığdır" icon button
 * - White CAD canvas with:
 *   - CORS / Fixed reference stations: Blue triangles (△) with station labels
 *   - Rover stations: Blue target circles with crosshairs (⊕) with station labels
 *   - Baselines: Crisp bright green vector lines connecting station pairs
 *   - Interactive pan, mouse-wheel zoom, and coordinate cursor display
 */

import React, { useRef, useState, useEffect, useMemo, useCallback } from 'react';
import { Station, BaselineVector } from '../types/gnss';
import {
  ZoomIn,
  ZoomOut,
  Maximize2,
  Layers,
  MapPin,
  Compass,
  RotateCcw,
  Eye,
  Sliders,
  Share2,
} from 'lucide-react';

interface Props {
  stations: Record<string, Station>;
  baselines?: BaselineVector[];
  selectedStationId?: string;
  onSelectStation?: (id: string) => void;
  className?: string;
}

export const TopconCadMapViewer: React.FC<Props> = ({
  stations,
  baselines = [],
  selectedStationId,
  onSelectStation,
  className = '',
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const stationList = useMemo(() => Object.values(stations), [stations]);

  // Pan & Zoom Transform State
  // centerEasting, centerNorthing: center of the view in meters
  // scale: pixels per meter
  const [viewState, setViewState] = useState<{
    centerE: number;
    centerN: number;
    scale: number; // pixels per meter
  }>({
    centerE: 465000,
    centerN: 4507500,
    scale: 0.015,
  });

  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [cursorCoords, setCursorCoords] = useState<{ e: number; n: number } | null>(null);
  const [hoveredStation, setHoveredStation] = useState<Station | null>(null);
  const [hoveredBaseline, setHoveredBaseline] = useState<BaselineVector | null>(null);

  // Layer toggles
  const [showGrid, setShowGrid] = useState(true);
  const [showBaselineLengths, setShowBaselineLengths] = useState(false);

  // Compute extents across all stations
  const extents = useMemo(() => {
    if (stationList.length === 0) {
      return {
        minE: 435000,
        maxE: 495000,
        minN: 4497500,
        maxN: 4517500,
        centerE: 465000,
        centerN: 4507500,
      };
    }

    let minE = Infinity;
    let maxE = -Infinity;
    let minN = Infinity;
    let maxN = -Infinity;

    stationList.forEach((st) => {
      const e = st.projY ?? st.adjustedProjY ?? 450000;
      const n = st.projX ?? st.adjustedProjX ?? 4500000;
      if (e < minE) minE = e;
      if (e > maxE) maxE = e;
      if (n < minN) minN = n;
      if (n > maxN) maxN = n;
    });

    // Ensure valid non-zero span
    if (maxE - minE < 1000) {
      minE -= 2500;
      maxE += 2500;
    }
    if (maxN - minN < 1000) {
      minN -= 2500;
      maxN += 2500;
    }

    return {
      minE,
      maxE,
      minN,
      maxN,
      centerE: (minE + maxE) / 2,
      centerN: (minN + maxN) / 2,
    };
  }, [stationList]);

  // Fit to extents function
  const fitToExtents = useCallback(() => {
    if (!canvasRef.current) return;
    const canvas = canvasRef.current;
    const width = canvas.width;
    const height = canvas.height;

    const spanE = (extents.maxE - extents.minE) * 1.35; // 35% margin
    const spanN = (extents.maxN - extents.minN) * 1.35;

    const scaleE = width / Math.max(spanE, 100);
    const scaleN = height / Math.max(spanN, 100);
    const optimalScale = Math.min(scaleE, scaleN);

    setViewState({
      centerE: extents.centerE,
      centerN: extents.centerN,
      scale: optimalScale,
    });
  }, [extents]);

  // Initial fit
  useEffect(() => {
    fitToExtents();
  }, [fitToExtents]);

  // Helper coordinate conversions
  const worldToScreen = useCallback(
    (easting: number, northing: number, canvasW: number, canvasH: number) => {
      // Easting increases to right (+X)
      // Northing increases upwards (-Y on screen)
      const x = canvasW / 2 + (easting - viewState.centerE) * viewState.scale;
      const y = canvasH / 2 - (northing - viewState.centerN) * viewState.scale;
      return { x, y };
    },
    [viewState]
  );

  const screenToWorld = useCallback(
    (screenX: number, screenY: number, canvasW: number, canvasH: number) => {
      const easting = viewState.centerE + (screenX - canvasW / 2) / viewState.scale;
      const northing = viewState.centerN - (screenY - canvasH / 2) / viewState.scale;
      return { easting, northing };
    },
    [viewState]
  );

  // Render Canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Handle high-DPI
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const w = Math.floor(rect.width);
    const h = Math.floor(rect.height);

    if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
      canvas.width = w * dpr;
      canvas.height = h * dpr;
    }

    ctx.save();
    ctx.scale(dpr, dpr);

    // 1. Clean CAD white background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);

    // 2. Subtle coordinate grid lines
    if (showGrid) {
      ctx.lineWidth = 0.5;
      ctx.strokeStyle = '#f1f5f9';

      // Pick grid step (2500m, 5000m, 10000m based on scale)
      const idealPixelStep = 80;
      const meterStepRaw = idealPixelStep / viewState.scale;
      let gridStep = 2500;
      if (meterStepRaw > 7500) gridStep = 10000;
      else if (meterStepRaw > 3500) gridStep = 5000;
      else if (meterStepRaw > 1500) gridStep = 2500;
      else if (meterStepRaw > 750) gridStep = 1000;
      else gridStep = 500;

      const { easting: minVisibleE, northing: maxVisibleN } = screenToWorld(0, 0, w, h);
      const { easting: maxVisibleE, northing: minVisibleN } = screenToWorld(w, h, w, h);

      const startE = Math.floor(minVisibleE / gridStep) * gridStep;
      const endE = Math.ceil(maxVisibleE / gridStep) * gridStep;
      for (let e = startE; e <= endE; e += gridStep) {
        const { x } = worldToScreen(e, 0, w, h);
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
      }

      const startN = Math.floor(minVisibleN / gridStep) * gridStep;
      const endN = Math.ceil(maxVisibleN / gridStep) * gridStep;
      for (let n = startN; n <= endN; n += gridStep) {
        const { y } = worldToScreen(0, n, w, h);
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }
    }

    // 3. Render Baseline Vectors (crisp neon-green lines, Topcon Tools style)
    ctx.lineWidth = 1.25;
    ctx.strokeStyle = '#00e600'; // Pure bright green matching Topcon Tools
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const drawnBaselines = baselines.length > 0 ? baselines : [];

    // If no explicit baselines, auto-connect CORS to rovers for visual network demonstration
    const activeVectors = drawnBaselines.length > 0
      ? drawnBaselines
      : stationList.length > 1
      ? stationList.flatMap((st1, i) =>
          stationList.slice(i + 1).map((st2) => ({
            id: `${st1.id}-${st2.id}`,
            fromId: st1.id,
            toId: st2.id,
            dX: 0, dY: 0, dZ: 0,
            length: Math.hypot((st2.projY || 0) - (st1.projY || 0), (st2.projX || 0) - (st1.projX || 0)),
            qxx: 0, qyy: 0, qzz: 0, qxy: 0, qyz: 0, qzx: 0,
            solutionType: 'FIX' as const,
            ratio: 5.0, rms: 0.015, durationMin: 180, satellites: 14, pdop: 1.8,
            excluded: false,
          }))
        )
      : [];

    activeVectors.forEach((b: BaselineVector | { id: string; fromId: string; toId: string; dX: number; dY: number; dZ: number; length: number; qxx: number; qyy: number; qzz: number; qxy: number; qyz: number; qzx: number; solutionType: any; ratio: number; rms: number; durationMin: number; satellites: number; pdop: number; excluded?: boolean }) => {
      if (b.excluded) return;
      const fromSt = stations[b.fromId];
      const toSt = stations[b.toId];
      if (!fromSt || !toSt) return;

      const p1 = worldToScreen(fromSt.projY ?? 0, fromSt.projX ?? 0, w, h);
      const p2 = worldToScreen(toSt.projY ?? 0, toSt.projX ?? 0, w, h);

      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();

      // Show baseline length text if enabled
      if (showBaselineLengths) {
        const midX = (p1.x + p2.x) / 2;
        const midY = (p1.y + p2.y) / 2;
        ctx.font = '9px monospace';
        ctx.fillStyle = '#059669';
        const lenKm = (b.length / 1000).toFixed(2);
        ctx.fillText(`${lenKm} km`, midX + 4, midY - 4);
      }
    });

    // 4. Render Station Symbols & Labels
    stationList.forEach((st) => {
      const e = st.projY ?? st.adjustedProjY ?? 0;
      const n = st.projX ?? st.adjustedProjX ?? 0;
      const { x, y } = worldToScreen(e, n, w, h);

      const isCors = st.type === 'CORS' || st.isFixed?.x;
      const isSelected = selectedStationId === st.id;
      const isHovered = hoveredStation?.id === st.id;

      // Selection Halo
      if (isSelected || isHovered) {
        ctx.beginPath();
        ctx.arc(x, y, 14, 0, Math.PI * 2);
        ctx.fillStyle = isSelected ? 'rgba(14, 165, 233, 0.25)' : 'rgba(14, 165, 233, 0.12)';
        ctx.fill();
        ctx.strokeStyle = '#0284c7';
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      if (isCors) {
        // CORS / Sabit: Blue Triangle (△) with central dot (Topcon Tools Style)
        const size = 8;
        ctx.beginPath();
        ctx.moveTo(x, y - size);
        ctx.lineTo(x + size * 0.866, y + size * 0.5);
        ctx.lineTo(x - size * 0.866, y + size * 0.5);
        ctx.closePath();

        ctx.fillStyle = '#ffffff';
        ctx.fill();
        ctx.strokeStyle = '#0044cc'; // Deep CAD Blue
        ctx.lineWidth = 1.75;
        ctx.stroke();

        // Central Dot
        ctx.beginPath();
        ctx.arc(x, y, 1.5, 0, Math.PI * 2);
        ctx.fillStyle = '#0044cc';
        ctx.fill();
      } else {
        // Rover / Network Station: Blue Target Circle with Crosshair (⊕)
        const r = 5.5;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff';
        ctx.fill();
        ctx.strokeStyle = '#0044cc';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Crosshairs
        ctx.beginPath();
        ctx.moveTo(x - r - 2, y);
        ctx.lineTo(x + r + 2, y);
        ctx.moveTo(x, y - r - 2);
        ctx.lineTo(x, y + r + 2);
        ctx.strokeStyle = '#0044cc';
        ctx.lineWidth = 1.2;
        ctx.stroke();

        // Center dot
        ctx.beginPath();
        ctx.arc(x, y, 1.2, 0, Math.PI * 2);
        ctx.fillStyle = '#0044cc';
        ctx.fill();
      }

      // Station Text Label
      ctx.font = 'bold 11px sans-serif';
      ctx.fillStyle = '#000000';
      // Label slightly to the top-right
      ctx.fillText(st.name, x + 8, y - 5);
    });

    ctx.restore();
  }, [
    stationList,
    baselines,
    viewState,
    selectedStationId,
    hoveredStation,
    showGrid,
    showBaselineLengths,
    worldToScreen,
    screenToWorld,
    stations,
  ]);

  // Calculate Rulers Ticks based on current viewState
  const rulerTicks = useMemo(() => {
    const canvas = canvasRef.current;
    const w = canvas ? canvas.clientWidth : 800;
    const h = canvas ? canvas.clientHeight : 500;

    const { easting: minE, northing: maxN } = screenToWorld(0, 0, w, h);
    const { easting: maxE, northing: minN } = screenToWorld(w, h, w, h);

    // Determine nice round tick step in meters
    const idealPixelStep = 90;
    const meterStepRaw = idealPixelStep / viewState.scale;
    let tickStep = 2500;
    if (meterStepRaw > 7500) tickStep = 10000;
    else if (meterStepRaw > 3500) tickStep = 5000;
    else if (meterStepRaw > 1500) tickStep = 2500;
    else if (meterStepRaw > 750) tickStep = 1000;
    else if (meterStepRaw > 300) tickStep = 500;
    else tickStep = 200;

    // Horizontal Easting Ticks
    const eastingTicks: Array<{ val: number; x: number; label: string }> = [];
    const startE = Math.floor(minE / tickStep) * tickStep;
    const endE = Math.ceil(maxE / tickStep) * tickStep;
    for (let e = startE; e <= endE; e += tickStep) {
      const { x } = worldToScreen(e, 0, w, h);
      if (x >= 0 && x <= w) {
        eastingTicks.push({
          val: e,
          x,
          label: Math.round(e).toString(),
        });
      }
    }

    // Vertical Northing Ticks
    const northingTicks: Array<{ val: number; y: number; label: string }> = [];
    const startN = Math.floor(minN / tickStep) * tickStep;
    const endN = Math.ceil(maxN / tickStep) * tickStep;
    for (let n = startN; n <= endN; n += tickStep) {
      const { y } = worldToScreen(0, n, w, h);
      if (y >= 0 && y <= h) {
        northingTicks.push({
          val: n,
          y,
          label: Math.round(n).toString(),
        });
      }
    }

    return { eastingTicks, northingTicks };
  }, [viewState, screenToWorld, worldToScreen]);

  // Mouse Interaction Handlers
  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true);
    setDragStart({ x: e.clientX, y: e.clientY });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    // Update real-world cursor coordinates
    const { easting, northing } = screenToWorld(mouseX, mouseY, rect.width, rect.height);
    setCursorCoords({ e: easting, n: northing });

    // Handle Pan Dragging
    if (isDragging) {
      const dx = e.clientX - dragStart.x;
      const dy = e.clientY - dragStart.y;

      setViewState((prev) => ({
        ...prev,
        centerE: prev.centerE - dx / prev.scale,
        centerN: prev.centerN + dy / prev.scale,
      }));

      setDragStart({ x: e.clientX, y: e.clientY });
      return;
    }

    // Hit test for stations
    let hitStn: Station | null = null;
    for (const st of stationList) {
      const { x, y } = worldToScreen(st.projY ?? 0, st.projX ?? 0, rect.width, rect.height);
      const dist = Math.hypot(mouseX - x, mouseY - y);
      if (dist < 12) {
        hitStn = st;
        break;
      }
    }
    setHoveredStation(hitStn);
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const handleClick = (e: React.MouseEvent) => {
    if (hoveredStation && onSelectStation) {
      onSelectStation(hoveredStation.id);
    }
  };

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const zoomFactor = e.deltaY < 0 ? 1.18 : 0.85;

    // Zoom centered around mouse cursor
    const { easting: mouseE, northing: mouseN } = screenToWorld(mouseX, mouseY, rect.width, rect.height);

    setViewState((prev) => {
      const nextScale = Math.max(0.0001, Math.min(2.0, prev.scale * zoomFactor));
      return {
        scale: nextScale,
        centerE: mouseE - (mouseX - rect.width / 2) / nextScale,
        centerN: mouseN + (mouseY - rect.height / 2) / nextScale,
      };
    });
  };

  const zoomIn = () => {
    setViewState((prev) => ({ ...prev, scale: Math.min(2.0, prev.scale * 1.3) }));
  };

  const zoomOut = () => {
    setViewState((prev) => ({ ...prev, scale: Math.max(0.0001, prev.scale * 0.77) }));
  };

  return (
    <div
      ref={containerRef}
      className={`flex flex-col bg-white border border-slate-300 rounded-xl shadow-xs overflow-hidden font-sans select-none ${className}`}
    >
      {/* Top Header & Toolbar */}
      <div className="flex flex-wrap items-center justify-between px-3 py-1.5 bg-slate-100 border-b border-slate-300 text-xs text-slate-700 gap-2">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 font-bold text-slate-800">
            <Compass className="w-4 h-4 text-blue-600" />
            <span>Ağ Haritası Görünümü (CAD Map View)</span>
          </div>

          <div className="h-4 w-px bg-slate-300 mx-1" />

          {/* Zoom Buttons */}
          <div className="flex items-center gap-1">
            <button
              onClick={zoomIn}
              title="Yakınlaş (+)"
              className="p-1 rounded bg-white hover:bg-slate-200 border border-slate-300 text-slate-700 transition"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={zoomOut}
              title="Uzaklaş (-)"
              className="p-1 rounded bg-white hover:bg-slate-200 border border-slate-300 text-slate-700 transition"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={fitToExtents}
              title="Tüm Noktalara Sığdır (Zoom to Extents)"
              className="px-2 py-0.5 rounded bg-emerald-50 hover:bg-emerald-100 border border-emerald-300 text-emerald-800 font-semibold text-[11px] flex items-center gap-1 transition"
            >
              <Maximize2 className="w-3 h-3 text-emerald-600" />
              <span>Sığdır</span>
            </button>
          </div>

          <div className="h-4 w-px bg-slate-300 mx-1" />

          {/* Toggles */}
          <label className="flex items-center gap-1 text-[11px] text-slate-600 cursor-pointer">
            <input
              type="checkbox"
              checked={showGrid}
              onChange={(e) => setShowGrid(e.target.checked)}
              className="rounded text-blue-600"
            />
            <span>CAD Izgarası</span>
          </label>
        </div>

        {/* Dynamic Cursor Coordinates Readout */}
        <div className="flex items-center gap-3 text-[11px]">
          {cursorCoords ? (
            <div className="font-mono bg-white px-2 py-0.5 rounded border border-slate-300 text-slate-700 flex items-center gap-2 shadow-2xs">
              <span>
                <strong className="text-slate-900 font-semibold">Sağa (E):</strong>{' '}
                {cursorCoords.e.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} m
              </span>
              <span className="text-slate-300">|</span>
              <span>
                <strong className="text-slate-900 font-semibold">Yukarı (N):</strong>{' '}
                {cursorCoords.n.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} m
              </span>
            </div>
          ) : (
            <span className="text-slate-400 font-mono">İmleç koordinatları bekleniyor...</span>
          )}

          {/* Legend */}
          <div className="hidden sm:flex items-center gap-2 text-[11px] text-slate-600">
            <span className="flex items-center gap-1">
              <span className="w-2.5 h-2.5 border-2 border-blue-600 bg-white rotate-45 inline-block" />
              <span>CORS (△)</span>
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-full border-2 border-blue-600 bg-white inline-block" />
              <span>Ara Nokta (⊕)</span>
            </span>
            <span className="flex items-center gap-1">
              <span className="w-3.5 h-0.5 bg-[#00e600] inline-block" />
              <span>Baz Vektörü</span>
            </span>
          </div>
        </div>
      </div>

      {/* Main CAD Layout: Left Northing Ruler + Bottom Easting Ruler + Center Canvas */}
      <div className="relative flex-1 flex flex-col min-h-[420px] max-h-[580px] bg-white">
        
        {/* Top-Left Corner Header: "Northing, Meters" */}
        <div className="flex flex-1 relative overflow-hidden">
          
          {/* Left Vertical Ruler (Northing, Meters) */}
          <div className="w-16 sm:w-20 shrink-0 bg-white border-r border-slate-400 relative z-10 flex flex-col justify-between py-1">
            {/* Top-Left Title Label */}
            <div className="px-1 text-[9px] font-sans font-bold text-slate-700 leading-tight border-b border-slate-200 pb-1">
              <div>Northing,</div>
              <div>Meters</div>
            </div>

            {/* Northing Tick Labels */}
            <div className="relative flex-1">
              {rulerTicks.northingTicks.map((tick, i) => (
                <div
                  key={i}
                  className="absolute right-0 flex items-center gap-1 pointer-events-none transform -translate-y-1/2 pr-1"
                  style={{ top: `${tick.y}px` }}
                >
                  <span className="text-[9px] font-mono text-slate-700 tracking-tight">
                    {tick.label}
                  </span>
                  <div className="w-1.5 h-px bg-slate-500" />
                </div>
              ))}
            </div>
          </div>

          {/* Center Drawing Canvas */}
          <div className="relative flex-1 h-full overflow-hidden bg-white cursor-crosshair">
            <canvas
              ref={canvasRef}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onClick={handleClick}
              onWheel={handleWheel}
              className="absolute inset-0 w-full h-full block"
            />

            {/* Hover Tooltip on Station */}
            {hoveredStation && (
              <div
                className="absolute z-30 pointer-events-none bg-slate-900/95 text-white p-2.5 rounded-lg shadow-xl text-xs space-y-1 border border-slate-700"
                style={{
                  left: `${worldToScreen(hoveredStation.projY ?? 0, hoveredStation.projX ?? 0, canvasRef.current?.clientWidth || 0, canvasRef.current?.clientHeight || 0).x + 14}px`,
                  top: `${worldToScreen(hoveredStation.projY ?? 0, hoveredStation.projX ?? 0, canvasRef.current?.clientWidth || 0, canvasRef.current?.clientHeight || 0).y - 20}px`,
                }}
              >
                <div className="font-bold text-sm text-sky-400 flex items-center justify-between gap-2">
                  <span>{hoveredStation.name}</span>
                  <span className="text-[10px] px-1.5 py-0.2 bg-blue-900/80 rounded text-blue-200 font-normal">
                    {hoveredStation.type === 'CORS' ? 'CORS Sabit Nokta' : 'Ara / Poligon Noktası'}
                  </span>
                </div>
                <div className="font-mono text-[11px] space-y-0.5 text-slate-300">
                  <div>Sağa (Y): {(hoveredStation.projY ?? 0).toFixed(3)} m</div>
                  <div>Yukarı (X): {(hoveredStation.projX ?? 0).toFixed(3)} m</div>
                  <div>Kot (h): {(hoveredStation.h ?? 0).toFixed(3)} m</div>
                  {hoveredStation.antenna?.model && (
                    <div className="text-[10px] text-slate-400 truncate max-w-[200px]">
                      Anten: {hoveredStation.antenna.model} ({hoveredStation.antenna.measuredHeight.toFixed(3)}m)
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Bottom Horizontal Ruler (Easting, Meters) */}
        <div className="h-7 bg-white border-t border-slate-400 flex items-center relative z-20">
          
          {/* Bottom-Left Corner Button: Green CAD Zoom to Extents Icon (Topcon Tools match) */}
          <div className="w-16 sm:w-20 shrink-0 h-full border-r border-slate-400 bg-slate-100 flex items-center justify-center">
            <button
              type="button"
              onClick={fitToExtents}
              title="Tümüne Sığdır (Zoom to Extents)"
              className="p-1 rounded hover:bg-slate-200 transition text-emerald-700"
            >
              {/* Custom CAD Extents Icon matching screenshot */}
              <div className="w-4 h-4 border-2 border-emerald-600 flex items-center justify-center p-0.5 rounded-2xs bg-emerald-50">
                <div className="w-1.5 h-1.5 bg-emerald-600 rounded-2xs" />
              </div>
            </button>
          </div>

          {/* Easting Ticks & Axis */}
          <div className="flex-1 h-full relative overflow-hidden">
            {rulerTicks.eastingTicks.map((tick, i) => (
              <div
                key={i}
                className="absolute top-0 flex flex-col items-center pointer-events-none transform -translate-x-1/2"
                style={{ left: `${tick.x}px` }}
              >
                <div className="w-px h-1.5 bg-slate-500" />
                <span className="text-[9px] font-mono text-slate-700 tracking-tight mt-0.5">
                  {tick.label}
                </span>
              </div>
            ))}

            {/* Bottom-Right Title: "Easting, Meters" */}
            <div className="absolute right-2 bottom-1 text-[9px] font-sans font-bold text-slate-700 bg-white/80 px-1 pointer-events-none">
              Easting, Meters
            </div>
          </div>

        </div>

      </div>
    </div>
  );
};
