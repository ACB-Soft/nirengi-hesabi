/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * Modül 7: İnteraktif Leaflet GNSS Ağ Haritası (Interactive Geodetic Network Map)
 */

import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import { Station, BaselineVector, LoopClosure, AdjustmentResult } from '../types/gnss';
import {
  MapPin,
  Layers,
  Eye,
  Maximize2,
  Info,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react';

interface Props {
  stations: Record<string, Station>;
  baselines: BaselineVector[];
  loopClosures: LoopClosure[];
  adjustmentResult: AdjustmentResult | null;
}

export const MapTab: React.FC<Props> = ({
  stations,
  baselines,
  loopClosures,
  adjustmentResult,
}) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const layersGroupRef = useRef<L.LayerGroup | null>(null);

  const [showErrorEllipses, setShowErrorEllipses] = useState(true);
  const [showLoops, setShowLoops] = useState(false);
  const [selectedLoopId, setSelectedLoopId] = useState<string>('');

  const stationList = Object.values(stations);

  // Initialize or update Leaflet map
  useEffect(() => {
    if (!mapContainerRef.current) return;

    if (!mapInstanceRef.current) {
      const map = L.map(mapContainerRef.current, {
        center: [39.9, 32.8],
        zoom: 9,
        zoomControl: true,
      });

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors | TUREF GNSS Engine',
        maxZoom: 19,
      }).addTo(map);

      layersGroupRef.current = L.layerGroup().addTo(map);
      mapInstanceRef.current = map;
    }

    const map = mapInstanceRef.current;
    const group = layersGroupRef.current;
    if (!map || !group) return;

    group.clearLayers();

    const bounds = L.latLngBounds([]);

    // 1. Draw Baselines
    const activeBaselines = baselines.filter((b) => !b.excluded);

    activeBaselines.forEach((b) => {
      const fromSt = stations[b.fromId];
      const toSt = stations[b.toId];
      if (!fromSt || !toSt) return;

      const p1: [number, number] = [fromSt.lat, fromSt.lon];
      const p2: [number, number] = [toSt.lat, toSt.lon];
      bounds.extend(p1);
      bounds.extend(p2);

      const isFix = b.solutionType === 'FIX';
      const isOutlier = b.isOutlier;

      const lineColor = isOutlier ? '#e11d48' : isFix ? '#059669' : '#d97706';
      const dashArray = isOutlier ? '6, 6' : undefined;

      const poly = L.polyline([p1, p2], {
        color: lineColor,
        weight: isOutlier ? 3 : 2.5,
        opacity: 0.85,
        dashArray,
      });

      poly.bindPopup(`
        <div style="font-family: inherit; font-size: 12px; line-height: 1.4;">
          <div style="font-weight: bold; color: #0f172a; border-bottom: 1px solid #e2e8f0; padding-bottom: 4px; margin-bottom: 4px;">
            Baz: ${b.id} (${b.fromId} &rarr; ${b.toId})
          </div>
          <div><strong>Uzunluk:</strong> ${b.length.toFixed(2)} m (${(b.length / 1000).toFixed(2)} km)</div>
          <div><strong>Çözüm Tipi:</strong> <span style="font-weight: bold; color: ${isFix ? '#059669' : '#d97706'}">${b.solutionType} (Q=${isFix ? 1 : 2})</span></div>
          <div><strong>dX:</strong> ${b.dX.toFixed(3)} m</div>
          <div><strong>dY:</strong> ${b.dY.toFixed(3)} m</div>
          <div><strong>dZ:</strong> ${b.dZ.toFixed(3)} m</div>
          ${b.spatialV ? `<div><strong>Kalıntı v:</strong> ${b.spatialV.toFixed(1)} mm</div>` : ''}
          ${b.wTest ? `<div><strong>Baarda w:</strong> ${b.wTest.toFixed(2)} ${isOutlier ? '<span style="color:red; font-weight:bold;">[KABA HATA]</span>' : ''}</div>` : ''}
        </div>
      `);

      group.addLayer(poly);
    });

    // 2. Draw Highlighted Loop Polygon if active
    if (showLoops && selectedLoopId) {
      const activeLoop = loopClosures.find((l) => l.id === selectedLoopId);
      if (activeLoop) {
        const loopPts: [number, number][] = activeLoop.stationIds
          .map((id) => {
            const st = stations[id];
            return st ? ([st.lat, st.lon] as [number, number]) : null;
          })
          .filter((p): p is [number, number] => p !== null);

        if (loopPts.length >= 3) {
          const loopPolygon = L.polygon(loopPts, {
            color: activeLoop.isAccepted ? '#0284c7' : '#e11d48',
            fillColor: activeLoop.isAccepted ? '#38bdf8' : '#fb7185',
            fillOpacity: 0.25,
            weight: 3,
            dashArray: '4, 4',
          });
          group.addLayer(loopPolygon);
        }
      }
    }

    // 3. Draw Station Markers
    stationList.forEach((st) => {
      const latLng: [number, number] = [st.lat, st.lon];
      bounds.extend(latLng);

      const isFixed = st.isFixed.x && st.isFixed.y && st.isFixed.z;
      const markerColor = isFixed ? '#dc2626' : '#0284c7';

      // Custom DivIcon marker
      const markerHtml = `
        <div style="
          background-color: ${markerColor};
          color: white;
          padding: 2px 7px;
          border-radius: 9999px;
          font-size: 11px;
          font-weight: 700;
          border: 2px solid white;
          box-shadow: 0 2px 6px rgba(0,0,0,0.35);
          white-space: nowrap;
          text-align: center;
          cursor: pointer;
        ">
          ${st.name}
        </div>
      `;

      const customIcon = L.divIcon({
        className: 'custom-leaflet-marker',
        html: markerHtml,
        iconSize: [60, 24],
        iconAnchor: [30, 12],
      });

      const marker = L.marker(latLng, { icon: customIcon });

      marker.bindPopup(`
        <div style="font-family: inherit; font-size: 12px; line-height: 1.4; min-width: 180px;">
          <div style="font-weight: bold; color: ${isFixed ? '#dc2626' : '#0284c7'}; border-bottom: 1px solid #e2e8f0; padding-bottom: 4px; margin-bottom: 4px;">
            ${st.name} [${isFixed ? 'SABİT CORS (TUSAGA)' : 'ARAZİ NOKTASI'}]
          </div>
          <div><strong>Enlem / Boylam:</strong> ${st.lat.toFixed(6)}&deg; / ${st.lon.toFixed(6)}&deg;</div>
          <div><strong>Elipsoit Kot (H):</strong> ${(st.adjustedH ?? st.h).toFixed(3)} m</div>
          <div><strong>TM Sağa (Y):</strong> ${(st.adjustedProjY ?? st.projY).toFixed(3)} m</div>
          <div><strong>TM Yukarı (X):</strong> ${(st.adjustedProjX ?? st.projX).toFixed(3)} m</div>
          <div><strong>Anten Modeli:</strong> ${st.antenna.model}</div>
          <div><strong>İndirgenmiş ARP Boyu:</strong> ${st.antenna.correctedHeight.toFixed(3)} m</div>
          ${st.semiMajor ? `<div><strong>Hata Elipsi (95% a):</strong> ${st.semiMajor.toFixed(1)} mm</div>` : ''}
          ${st.sigmaH ? `<div><strong>Düşey Hata (&plusmn;&sigma;):</strong> &plusmn;${st.sigmaH.toFixed(1)} mm</div>` : ''}
        </div>
      `);

      group.addLayer(marker);

      // 4. Draw 2D Error Ellipse if available
      if (showErrorEllipses && st.semiMajor && st.semiMajor > 0.1) {
        // Draw exaggerated circle/ellipse scale for visual clarity on geographic map (scale factor 500)
        const radiusMeters = (st.semiMajor / 1000.0) * 1200.0;
        const ellipseCircle = L.circle(latLng, {
          radius: Math.max(15, radiusMeters),
          color: '#0284c7',
          fillColor: '#38bdf8',
          fillOpacity: 0.18,
          weight: 1.5,
          dashArray: '3, 3',
        });
        group.addLayer(ellipseCircle);
      }
    });

    if (bounds.isValid()) {
      map.fitBounds(bounds, { padding: [40, 40] });
    }
  }, [stations, baselines, loopClosures, showErrorEllipses, showLoops, selectedLoopId]);

  const handleFitBounds = () => {
    if (!mapInstanceRef.current) return;
    const bounds = L.latLngBounds(stationList.map((st) => [st.lat, st.lon]));
    if (bounds.isValid()) {
      mapInstanceRef.current.fitBounds(bounds, { padding: [40, 40] });
    }
  };

  return (
    <div className="space-y-4">
      {/* Map Control Bar */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
          {/* Legend */}
          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex items-center gap-1.5 font-medium text-slate-700">
              <span className="w-3 h-3 rounded-full bg-rose-600 border border-white shadow-sm" />
              <span>Sabit TUSAGA CORS (Kırmızı)</span>
            </div>
            <div className="flex items-center gap-1.5 font-medium text-slate-700">
              <span className="w-3 h-3 rounded-full bg-sky-600 border border-white shadow-sm" />
              <span>Dengelenecek Nokta (Mavi)</span>
            </div>
            <div className="flex items-center gap-1.5 font-medium text-slate-700">
              <span className="w-4 h-1 bg-emerald-600 rounded" />
              <span>Fix Baz (Q=1)</span>
            </div>
            <div className="flex items-center gap-1.5 font-medium text-slate-700">
              <span className="w-4 h-1 bg-amber-500 rounded" />
              <span>Float Baz (Q=2)</span>
            </div>
          </div>

          {/* Map Layer Controls */}
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => setShowErrorEllipses(!showErrorEllipses)}
              className={`px-3 py-1.5 rounded-lg border font-bold cursor-pointer transition flex items-center gap-1.5 ${
                showErrorEllipses
                  ? 'bg-sky-50 text-sky-700 border-sky-300'
                  : 'bg-slate-50 text-slate-600 border-slate-200'
              }`}
            >
              <Eye className="w-3.5 h-3.5" />
              <span>Hata Elipsleri ({showErrorEllipses ? 'Açık' : 'Kapalı'})</span>
            </button>

            {loopClosures.length > 0 && (
              <button
                onClick={() => {
                  setShowLoops(!showLoops);
                  if (!selectedLoopId && loopClosures[0]) {
                    setSelectedLoopId(loopClosures[0].id);
                  }
                }}
                className={`px-3 py-1.5 rounded-lg border font-bold cursor-pointer transition flex items-center gap-1.5 ${
                  showLoops
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-300'
                    : 'bg-slate-50 text-slate-600 border-slate-200'
                }`}
              >
                <Layers className="w-3.5 h-3.5" />
                <span>Döngü Poligonu ({showLoops ? 'Açık' : 'Kapalı'})</span>
              </button>
            )}

            <button
              onClick={handleFitBounds}
              className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-lg transition cursor-pointer flex items-center gap-1.5"
            >
              <Maximize2 className="w-3.5 h-3.5" />
              <span>Ağa Odaklan</span>
            </button>
          </div>
        </div>

        {/* Loop Selector bar if loop polygon active */}
        {showLoops && loopClosures.length > 0 && (
          <div className="mt-3 pt-3 border-t border-slate-100 flex items-center gap-2 overflow-x-auto text-xs">
            <span className="font-semibold text-slate-600 whitespace-nowrap">Vurgulanacak Döngü:</span>
            {loopClosures.map((l) => (
              <button
                key={l.id}
                onClick={() => setSelectedLoopId(l.id)}
                className={`px-2.5 py-1 rounded-md font-mono text-[11px] whitespace-nowrap cursor-pointer transition ${
                  selectedLoopId === l.id
                    ? 'bg-sky-600 text-white font-bold shadow-sm'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                {l.name} ({l.totalMisclosure.toFixed(1)} mm)
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Leaflet Map Canvas */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden relative">
        <div ref={mapContainerRef} className="w-full h-[620px] z-10" />

        {stationList.length === 0 && (
          <div className="absolute inset-0 z-20 bg-slate-900/30 backdrop-blur-2xs flex items-center justify-center pointer-events-none">
            <div className="bg-white/95 rounded-xl shadow-lg border border-slate-200 p-6 max-w-md text-center space-y-2 pointer-events-auto">
              <div className="w-10 h-10 rounded-full bg-sky-100 text-sky-700 flex items-center justify-center mx-auto">
                <MapPin className="w-5 h-5" />
              </div>
              <h4 className="font-bold text-sm text-slate-800">Ağ Noktaları Bekleniyor</h4>
              <p className="text-xs text-slate-500 leading-relaxed">
                Haritada baz ve noktaları görüntülemek için <strong>"2. Noktalar & ANTEX"</strong> sekmesinden 
                RINEX (<code>.24o, .25o, .26o, .rnx</code>) dosyalarınızı yükleyin veya manuel koordinat giriniz.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
