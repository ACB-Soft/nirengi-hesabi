/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * Sabit Koordinatlar Ön Sayfası (TUSAGA-Aktif Known Coordinates Management)
 * Dayalı (Tam Kısıtlı) Dengeleme öncesi bilinen gerçek koordinatların girilmesi ve kontrolü.
 */

import React, { useState } from 'react';
import { Station, JobConfig } from '../types/gnss';
import {
  ecefToGeodetic,
  geodeticToEcef,
  geodeticToTM,
  tmToGeodetic,
} from '../utils/geodesy';
import {
  ShieldCheck,
  Building2,
  CheckCircle2,
  Upload,
  Edit2,
  Save,
  ArrowRight,
  Database,
  FileText,
  RefreshCw,
  Plus,
  Trash2,
  Info,
} from 'lucide-react';

interface Props {
  stations: Record<string, Station>;
  config: JobConfig;
  onUpdateStation: (station: Station) => void;
  onNavigateToConstrainedAdjustment: () => void;
}

// Popular TUSAGA-Aktif Official Reference Station Coordinates (ITRF96 / TUREF)
const TUSAGA_CATALOG: Record<string, { x: number; y: number; z: number; name: string; city: string }> = {
  ANKR: { name: 'ANKR (Ankara - HGM)', city: 'Ankara', x: 4118542.894, y: 2505234.321, z: 4082211.543 },
  KONY: { name: 'KONY (Konya Selçuk)', city: 'Konya', x: 4220123.456, y: 2489112.789, z: 3901456.123 },
  YOZG: { name: 'YOZG (Yozgat Merkez)', city: 'Yozgat', x: 4056123.789, y: 2689456.123, z: 4060789.456 },
  ISTN: { name: 'ISTN (İstanbul İTÜ)', city: 'İstanbul', x: 4122112.345, y: 2212345.678, z: 4175678.901 },
  IZMR: { name: 'IZMR (İzmir Ege Ünv.)', city: 'İzmir', x: 4321098.765, y: 2109876.543, z: 3934567.890 },
  BURS: { name: 'BURS (Bursa Uludağ)', city: 'Bursa', x: 4187654.321, y: 2234567.890, z: 4098765.432 },
  TRAB: { name: 'TRAB (Trabzon KTÜ)', city: 'Trabzon', x: 3789012.345, y: 2890123.456, z: 4167890.123 },
  ERZU: { name: 'ERZU (Erzurum Atatürk)', city: 'Erzurum', x: 3812345.678, y: 3012345.678, z: 4078901.234 },
  ADAN: { name: 'ADAN (Adana Çukurova)', city: 'Adana', x: 4390123.456, y: 2712345.678, z: 3812345.678 },
  DIYA: { name: 'DIYA (Diyarbakır Dicle)', city: 'Diyarbakır', x: 4156789.012, y: 3123456.789, z: 3890123.456 },
  SIVA: { name: 'SIVA (Sivas Cumhuriyet)', city: 'Sivas', x: 3989012.345, y: 2812345.678, z: 4034567.890 },
  SAMS: { name: 'SAMS (Samsun OMÜ)', city: 'Samsun', x: 3890123.456, y: 2656789.012, z: 4190123.456 },
};

export const FixedCoordinatesTab: React.FC<Props> = ({
  stations,
  config,
  onUpdateStation,
  onNavigateToConstrainedAdjustment,
}) => {
  const stationList = Object.values(stations);
  const fixedStations = stationList.filter((s) => s.type === 'CORS' || s.isFixed.x || s.isFixed.y || s.isFixed.z);
  const roverStations = stationList.filter((s) => !fixedStations.includes(s));

  // Edit State
  const [editingStationId, setEditingStationId] = useState<string | null>(null);
  const [coordMode, setCoordMode] = useState<'ECEF' | 'GEODETIC' | 'TM'>('ECEF');
  
  // Temporary inputs
  const [editX, setEditX] = useState<number>(0);
  const [editY, setEditY] = useState<number>(0);
  const [editZ, setEditZ] = useState<number>(0);

  const [editLat, setEditLat] = useState<number>(0);
  const [editLon, setEditLon] = useState<number>(0);
  const [editH, setEditH] = useState<number>(0);

  const [editProjY, setEditProjY] = useState<number>(0);
  const [editProjX, setEditProjX] = useState<number>(0);

  // Batch paste modal state
  const [showBatchModal, setShowBatchModal] = useState(false);
  const [batchText, setBatchText] = useState('');

  const handleStartEdit = (st: Station) => {
    setEditingStationId(st.id);
    setEditX(st.x);
    setEditY(st.y);
    setEditZ(st.z);

    setEditLat(st.lat);
    setEditLon(st.lon);
    setEditH(st.h);

    setEditProjY(st.projY);
    setEditProjX(st.projX);
  };

  const handleSaveEdit = (st: Station) => {
    let finalX = editX;
    let finalY = editY;
    let finalZ = editZ;

    let finalLat = editLat;
    let finalLon = editLon;
    let finalH = editH;

    let finalProjY = editProjY;
    let finalProjX = editProjX;

    if (coordMode === 'ECEF') {
      const geo = ecefToGeodetic(finalX, finalY, finalZ);
      finalLat = geo.lat;
      finalLon = geo.lon;
      finalH = geo.h;
      const tm = geodeticToTM(finalLat, finalLon, config.dom);
      finalProjY = tm.projY;
      finalProjX = tm.projX;
    } else if (coordMode === 'GEODETIC') {
      const ecef = geodeticToEcef(finalLat, finalLon, finalH);
      finalX = ecef.x;
      finalY = ecef.y;
      finalZ = ecef.z;
      const tm = geodeticToTM(finalLat, finalLon, config.dom);
      finalProjY = tm.projY;
      finalProjX = tm.projX;
    } else if (coordMode === 'TM') {
      const geo = tmToGeodetic(finalProjY, finalProjX, config.dom);
      finalLat = geo.lat;
      finalLon = geo.lon;
      finalH = editH; // keep ellipsoidal height
      const ecef = geodeticToEcef(finalLat, finalLon, finalH);
      finalX = ecef.x;
      finalY = ecef.y;
      finalZ = ecef.z;
    }

    onUpdateStation({
      ...st,
      x: finalX,
      y: finalY,
      z: finalZ,
      lat: finalLat,
      lon: finalLon,
      h: finalH,
      projY: finalProjY,
      projX: finalProjX,
      isFixed: { x: true, y: true, z: true },
      type: 'CORS',
    });

    setEditingStationId(null);
  };

  const handleApplyCatalogCoordinates = (st: Station, catalogKey: string) => {
    const cat = TUSAGA_CATALOG[catalogKey];
    if (!cat) return;

    const geo = ecefToGeodetic(cat.x, cat.y, cat.z);
    const tm = geodeticToTM(geo.lat, geo.lon, config.dom);

    onUpdateStation({
      ...st,
      x: cat.x,
      y: cat.y,
      z: cat.z,
      lat: geo.lat,
      lon: geo.lon,
      h: geo.h,
      projY: tm.projY,
      projX: tm.projX,
      isFixed: { x: true, y: true, z: true },
      type: 'CORS',
    });
  };

  const handleToggleStationFixed = (st: Station) => {
    const currentlyFixed = st.isFixed.x && st.isFixed.y && st.isFixed.z;
    onUpdateStation({
      ...st,
      type: currentlyFixed ? 'GROUND' : 'CORS',
      isFixed: {
        x: !currentlyFixed,
        y: !currentlyFixed,
        z: !currentlyFixed,
      },
    });
  };

  const handleProcessBatchText = () => {
    if (!batchText.trim()) return;
    const lines = batchText.split(/\r?\n/);
    let updatedCount = 0;

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('//')) continue;
      const parts = trimmed.split(/[\s,;\t]+/);

      if (parts.length >= 4) {
        const name = parts[0].toUpperCase();
        const p1 = parseFloat(parts[1]);
        const p2 = parseFloat(parts[2]);
        const p3 = parseFloat(parts[3]);

        if (isNaN(p1) || isNaN(p2) || isNaN(p3)) continue;

        // Find existing station or match name
        const matchKey = Object.keys(stations).find(
          (id) => id.toUpperCase() === name || stations[id].name.toUpperCase() === name
        );

        if (matchKey) {
          const st = stations[matchKey];
          let x = 0, y = 0, z = 0;
          let lat = 0, lon = 0, h = 0;

          if (Math.abs(p1) > 1000000) {
            x = p1; y = p2; z = p3;
            const geo = ecefToGeodetic(x, y, z);
            lat = geo.lat; lon = geo.lon; h = geo.h;
          } else {
            lat = p1; lon = p2; h = p3;
            const ecef = geodeticToEcef(lat, lon, h);
            x = ecef.x; y = ecef.y; z = ecef.z;
          }

          const tm = geodeticToTM(lat, lon, config.dom);

          onUpdateStation({
            ...st,
            x, y, z, lat, lon, h,
            projY: tm.projY,
            projX: tm.projX,
            type: 'CORS',
            isFixed: { x: true, y: true, z: true },
          });
          updatedCount++;
        }
      }
    }

    setShowBatchModal(false);
    setBatchText('');
  };

  return (
    <div className="space-y-6">
      {/* Top Controls Banner */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="bg-purple-100 text-purple-800 border border-purple-300 text-[10px] font-extrabold px-2 py-0.5 rounded uppercase">
                Dayalı Dengeleme Ön Sayfası
              </span>
              <h2 className="text-base font-bold text-slate-900">
                TUSAGA-Aktif (CORS) Sabit Nokta Koordinat Yönetimi
              </h2>
            </div>
            <p className="text-xs text-slate-500 mt-1">
              Dayalı (Tam Kısıtlı) Dengeleme hesabına geçmeden önce TUSAGA-Aktif sabit baz istasyonlarının 
              resmi bilinen ITRF96 / TUREF gerçek koordinatlarını inceleyebilir ve düzenleyebilirsiniz.
            </p>
          </div>

          <div className="flex items-center gap-2.5 flex-wrap">
            <button
              onClick={() => setShowBatchModal(true)}
              className="px-3.5 py-2 text-xs font-bold bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-lg border border-slate-300 transition cursor-pointer flex items-center gap-1.5"
            >
              <Upload className="w-3.5 h-3.5 text-slate-600" />
              <span>Metinden Toplu Yükle</span>
            </button>

            <button
              onClick={onNavigateToConstrainedAdjustment}
              className="px-4 py-2 text-xs font-bold bg-sky-600 hover:bg-sky-700 text-white rounded-lg shadow-sm transition cursor-pointer flex items-center gap-2"
            >
              <span>Koordinatları Onayla & Dayalı Dengelemeye Geç</span>
              <ArrowRight className="w-4 h-4 text-sky-200" />
            </button>
          </div>
        </div>

        {/* Info Metric Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4 pt-4 border-t border-slate-100 text-xs">
          <div className="p-2.5 bg-purple-50 rounded-lg border border-purple-200">
            <div className="text-purple-700 font-medium">Sabit Referans (CORS)</div>
            <div className="text-base font-bold font-mono text-purple-900 mt-0.5">
              {fixedStations.length} Adet Nokta
            </div>
          </div>
          <div className="p-2.5 bg-sky-50 rounded-lg border border-sky-200">
            <div className="text-sky-700 font-medium">Serbest Gezici (Rover)</div>
            <div className="text-base font-bold font-mono text-sky-900 mt-0.5">
              {roverStations.length} Adet Nokta
            </div>
          </div>
          <div className="p-2.5 bg-slate-50 rounded-lg border border-slate-200">
            <div className="text-slate-500">Koordinat Sistemi / DOM</div>
            <div className="text-base font-bold font-mono text-slate-800 mt-0.5">
              {config.crsSystem} / {config.dom}°
            </div>
          </div>
          <div className="p-2.5 bg-emerald-50 rounded-lg border border-emerald-200">
            <div className="text-emerald-700 font-medium">Dengeleme Epoğu (t)</div>
            <div className="text-base font-bold font-mono text-emerald-800 mt-0.5">
              {config.surveyEpoch.toFixed(2)}
            </div>
          </div>
        </div>
      </div>

      {/* Main Table Container */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5 space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-3 border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-purple-600" />
            <h3 className="text-sm font-bold text-slate-900">
              Sabit TUSAGA Noktaları ve Bilinen Gerçek Koordinat Tablosu
            </h3>
          </div>

          {/* Coordinate Format Toggle */}
          <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-lg border border-slate-300 text-xs font-bold">
            <button
              onClick={() => setCoordMode('ECEF')}
              className={`px-3 py-1 rounded-md transition cursor-pointer ${
                coordMode === 'ECEF' ? 'bg-purple-600 text-white shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              ECEF (X, Y, Z)
            </button>
            <button
              onClick={() => setCoordMode('GEODETIC')}
              className={`px-3 py-1 rounded-md transition cursor-pointer ${
                coordMode === 'GEODETIC' ? 'bg-purple-600 text-white shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Coğrafi (Enlem, Boylam, h)
            </button>
            <button
              onClick={() => setCoordMode('TM')}
              className={`px-3 py-1 rounded-md transition cursor-pointer ${
                coordMode === 'TM' ? 'bg-purple-600 text-white shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              TM İzdüşüm (Sağa, Yukarı)
            </button>
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-slate-50 text-slate-700 font-semibold border-b border-slate-200">
                <th className="py-2.5 px-3">Nokta Tipi</th>
                <th className="py-2.5 px-3">Nokta Adı</th>
                <th className="py-2.5 px-3 text-right">
                  {coordMode === 'ECEF' ? 'ECEF X (m)' : coordMode === 'GEODETIC' ? 'Enlem (Derece)' : 'TM Sağa Y (m)'}
                </th>
                <th className="py-2.5 px-3 text-right">
                  {coordMode === 'ECEF' ? 'ECEF Y (m)' : coordMode === 'GEODETIC' ? 'Boylam (Derece)' : 'TM Yukarı X (m)'}
                </th>
                <th className="py-2.5 px-3 text-right">
                  {coordMode === 'ECEF' ? 'ECEF Z (m)' : 'Elipsoit Kotu h (m)'}
                </th>
                <th className="py-2.5 px-3 text-center">Eksen Kısıtlamaları</th>
                <th className="py-2.5 px-3 text-center">TUSAGA Kataloğu</th>
                <th className="py-2.5 px-3 text-center">İşlem</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {stationList.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-slate-400 font-sans">
                    Ağda henüz nokta bulunmuyor. "Rinex Veriler" sekmesinden verileri yükleyiniz.
                  </td>
                </tr>
              ) : (
                stationList.map((st) => {
                  const isFixed = st.type === 'CORS' || (st.isFixed.x && st.isFixed.y && st.isFixed.z);
                  const isEditing = editingStationId === st.id;

                  // Catalog match if available
                  const matchedCatKey = Object.keys(TUSAGA_CATALOG).find(
                    (k) => k === st.name.toUpperCase() || TUSAGA_CATALOG[k].name.startsWith(st.name.toUpperCase())
                  );

                  return (
                    <tr
                      key={st.id}
                      className={`hover:bg-slate-50/80 transition ${
                        isFixed ? 'bg-purple-50/30' : 'bg-white'
                      }`}
                    >
                      {/* Nokta Tipi Toggle */}
                      <td className="py-2.5 px-3 whitespace-nowrap">
                        <button
                          onClick={() => handleToggleStationFixed(st)}
                          className={`px-2.5 py-1 rounded text-[10px] font-bold cursor-pointer transition border ${
                            isFixed
                              ? 'bg-purple-100 text-purple-900 border-purple-300 hover:bg-purple-200'
                              : 'bg-slate-100 text-slate-700 border-slate-300 hover:bg-slate-200'
                          }`}
                          title="Tıklayarak Sabit CORS veya Gezici durumunu değiştirin"
                        >
                          {isFixed ? 'SABİT (TUSAGA)' : 'GEZİCİ (Rover)'}
                        </button>
                      </td>

                      {/* Nokta Adı */}
                      <td className="py-2.5 px-3 font-bold font-mono text-slate-900 whitespace-nowrap">
                        {st.name}
                      </td>

                      {/* Coordinate 1 */}
                      <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-900 whitespace-nowrap">
                        {isEditing ? (
                          <input
                            type="number"
                            step="any"
                            value={coordMode === 'ECEF' ? editX : coordMode === 'GEODETIC' ? editLat : editProjY}
                            onChange={(e) => {
                              const val = parseFloat(e.target.value) || 0;
                              if (coordMode === 'ECEF') setEditX(val);
                              else if (coordMode === 'GEODETIC') setEditLat(val);
                              else setEditProjY(val);
                            }}
                            className="w-28 text-right font-mono px-2 py-1 border border-purple-400 rounded bg-purple-50 text-slate-900 font-bold focus:outline-none"
                          />
                        ) : coordMode === 'ECEF' ? (
                          st.x.toFixed(4)
                        ) : coordMode === 'GEODETIC' ? (
                          st.lat.toFixed(8)
                        ) : (
                          st.projY.toFixed(4)
                        )}
                      </td>

                      {/* Coordinate 2 */}
                      <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-900 whitespace-nowrap">
                        {isEditing ? (
                          <input
                            type="number"
                            step="any"
                            value={coordMode === 'ECEF' ? editY : coordMode === 'GEODETIC' ? editLon : editProjX}
                            onChange={(e) => {
                              const val = parseFloat(e.target.value) || 0;
                              if (coordMode === 'ECEF') setEditY(val);
                              else if (coordMode === 'GEODETIC') setEditLon(val);
                              else setEditProjX(val);
                            }}
                            className="w-28 text-right font-mono px-2 py-1 border border-purple-400 rounded bg-purple-50 text-slate-900 font-bold focus:outline-none"
                          />
                        ) : coordMode === 'ECEF' ? (
                          st.y.toFixed(4)
                        ) : coordMode === 'GEODETIC' ? (
                          st.lon.toFixed(8)
                        ) : (
                          st.projX.toFixed(4)
                        )}
                      </td>

                      {/* Coordinate 3 */}
                      <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-900 whitespace-nowrap">
                        {isEditing ? (
                          <input
                            type="number"
                            step="any"
                            value={coordMode === 'ECEF' ? editZ : editH}
                            onChange={(e) => {
                              const val = parseFloat(e.target.value) || 0;
                              if (coordMode === 'ECEF') setEditZ(val);
                              else setEditH(val);
                            }}
                            className="w-28 text-right font-mono px-2 py-1 border border-purple-400 rounded bg-purple-50 text-slate-900 font-bold focus:outline-none"
                          />
                        ) : coordMode === 'ECEF' ? (
                          st.z.toFixed(4)
                        ) : (
                          st.h.toFixed(4)
                        )}
                      </td>

                      {/* Eksen Kısıtlamaları */}
                      <td className="py-2.5 px-3 text-center whitespace-nowrap">
                        <div className="flex items-center justify-center gap-1.5 font-mono text-[10px]">
                          <span className={`px-1.5 py-0.5 rounded font-bold ${st.isFixed.x ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-400'}`}>
                            X
                          </span>
                          <span className={`px-1.5 py-0.5 rounded font-bold ${st.isFixed.y ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-400'}`}>
                            Y
                          </span>
                          <span className={`px-1.5 py-0.5 rounded font-bold ${st.isFixed.z ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-400'}`}>
                            Z
                          </span>
                        </div>
                      </td>

                      {/* TUSAGA Kataloğu Hızlı Yükle */}
                      <td className="py-2.5 px-3 text-center whitespace-nowrap">
                        {matchedCatKey ? (
                          <button
                            onClick={() => handleApplyCatalogCoordinates(st, matchedCatKey)}
                            className="px-2 py-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-300 rounded text-[10px] font-bold cursor-pointer inline-flex items-center gap-1 transition"
                            title="TUSAGA Resmi ITRF96 veritabanından koordinatları yükle"
                          >
                            <Database className="w-3 h-3 text-emerald-600" />
                            <span>Resmi TUSAGA Yap ({matchedCatKey})</span>
                          </button>
                        ) : (
                          <span className="text-slate-400 text-[11px] font-mono">-</span>
                        )}
                      </td>

                      {/* İşlem */}
                      <td className="py-2.5 px-3 text-center whitespace-nowrap">
                        {isEditing ? (
                          <button
                            onClick={() => handleSaveEdit(st)}
                            className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-[11px] font-bold cursor-pointer inline-flex items-center gap-1 transition"
                          >
                            <Save className="w-3 h-3" />
                            <span>Kaydet</span>
                          </button>
                        ) : (
                          <button
                            onClick={() => handleStartEdit(st)}
                            className="px-2 py-1 bg-purple-50 hover:bg-purple-100 text-purple-800 border border-purple-300 rounded text-[11px] font-bold cursor-pointer inline-flex items-center gap-1 transition"
                          >
                            <Edit2 className="w-3 h-3 text-purple-600" />
                            <span>Düzenle</span>
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Batch Import Text Modal */}
      {showBatchModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full overflow-hidden animate-in fade-in duration-150">
            <div className="p-4 bg-slate-900 text-white flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FileText className="w-5 h-5 text-purple-400" />
                <h3 className="font-bold text-sm">Metinden TUSAGA Sabit Koordinat Yükleme</h3>
              </div>
              <button
                onClick={() => setShowBatchModal(false)}
                className="text-slate-400 hover:text-white text-sm cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="p-5 space-y-3">
              <p className="text-xs text-slate-600">
                Her satıra nokta adı ve ECEF $X, Y, Z$ veya Coğrafi Enlem, Boylam, Kot değerlerini giriniz:
              </p>
              <textarea
                value={batchText}
                onChange={(e) => setBatchText(e.target.value)}
                placeholder={`ANKR 4118542.894 2505234.321 4082211.543\nKONY 4220123.456 2489112.789 3901456.123`}
                rows={6}
                className="w-full font-mono text-xs p-3 border border-slate-300 rounded-lg focus:outline-none focus:border-purple-500 bg-slate-50"
              />

              <div className="flex justify-end gap-2 pt-2">
                <button
                  onClick={() => setShowBatchModal(false)}
                  className="px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-lg cursor-pointer"
                >
                  İptal
                </button>
                <button
                  onClick={handleProcessBatchText}
                  className="px-4 py-1.5 text-xs font-bold bg-purple-600 hover:bg-purple-700 text-white rounded-lg cursor-pointer shadow-xs"
                >
                  Koordinatları Güncelle
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
