/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * Rinex Veriler ve Anten Kalibrasyon Yönetimi
 * Entegre: NOAA NGS ANTCAL & IGS20 Anten Veritabanı
 */

import React, { useState } from 'react';
import { Station, AntennaHeightType } from '../types/gnss';
import {
  calculateCorrectedAntennaHeight,
  parseRinexHeader,
  parseAntexFile,
  getGpsWeekDay,
  getShortAntennaName,
  adjustDateStringToTimeZone,
} from '../utils/geodesy';
import {
  NOAA_ANTCAL_CATALOG,
  NoaaAntennaCalibration,
  matchAntennaInNoaaCatalog,
} from '../data/noaaAntcal';
import { OccupationViewTab } from './OccupationViewTab';
import {
  Radio,
  Upload,
  Trash2,
  Check,
  X,
  Sliders,
  Search,
  CheckCircle2,
  Activity,
  Edit2,
  Save,
  Layers,
  Compass,
} from 'lucide-react';

interface Props {
  stations: Record<string, Station>;
  dom?: number;
  timeZone?: string;
  onUpdateStation: (station: Station) => void;
  onAddStation: (station: Station) => void;
  onDeleteStation: (id: string) => void;
  onClearAllStations: () => void;
  onDetectedSurveyEpoch?: (epoch: number, dateStr?: string) => void;
}

export const StationsAntennaTab: React.FC<Props> = ({
  stations,
  dom = 30,
  timeZone = 'GMT+03:00',
  onUpdateStation,
  onAddStation,
  onDeleteStation,
  onClearAllStations,
  onDetectedSurveyEpoch,
}) => {
  // Sort stations alphabetically by name
  const sortedStations = Object.values(stations).sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
  );

  const [uploadFeedback, setUploadFeedback] = useState<string | null>(null);

  // Popup Modal States
  const [occupationModalStationId, setOccupationModalStationId] = useState<string | null>(null);

  // Station Properties Edit Modal State
  const [editStation, setEditStation] = useState<Station | null>(null);
  const [editName, setEditName] = useState<string>('');
  const [editMeasuredH, setEditMeasuredH] = useState<number>(0);
  const [editHeightType, setEditHeightType] = useState<AntennaHeightType>('vertical');
  const [editRadius, setEditRadius] = useState<number>(0.09);
  const [editOffset, setEditOffset] = useState<number>(0);

  // Dedicated Antenna Selection Modal State (from NOAA catalog)
  const [isAntennaModalOpen, setIsAntennaModalOpen] = useState(false);
  const [antennaModalStationId, setAntennaModalStationId] = useState<string>('');
  const [modalSearchQuery, setModalSearchQuery] = useState('');
  const [modalManufacturer, setModalManufacturer] = useState<string>('ALL');
  const [modalCategory, setModalCategory] = useState<string>('ALL');

  const manufacturers = Array.from(new Set(NOAA_ANTCAL_CATALOG.map((a) => a.manufacturer))).sort();

  const modalFilteredAntennas = NOAA_ANTCAL_CATALOG.filter((ant) => {
    const matchesMan = modalManufacturer === 'ALL' || ant.manufacturer === modalManufacturer;
    const matchesCat = modalCategory === 'ALL' || ant.category === modalCategory;
    const matchesQuery =
      modalSearchQuery === '' ||
      ant.model.toLowerCase().includes(modalSearchQuery.toLowerCase()) ||
      ant.displayName.toLowerCase().includes(modalSearchQuery.toLowerCase()) ||
      ant.manufacturer.toLowerCase().includes(modalSearchQuery.toLowerCase());
    return matchesMan && matchesCat && matchesQuery;
  });

  const handleToggleFixed = (id: string) => {
    const st = stations[id];
    if (!st) return;
    const isCurrentlyFixed = st.isFixed.x && st.isFixed.y && st.isFixed.z;
    const nextFixed = !isCurrentlyFixed;
    onUpdateStation({
      ...st,
      type: nextFixed ? 'CORS' : 'GROUND',
      isFixed: { x: nextFixed, y: nextFixed, z: nextFixed },
    });
  };

  /**
   * Handle opening station properties edit modal
   */
  const handleOpenEditModal = (st: Station) => {
    setEditStation(st);
    setEditName(st.name);
    setEditMeasuredH(st.antenna?.measuredHeight || 0);
    setEditHeightType(st.antenna?.heightType || 'vertical');
    setEditRadius(st.antenna?.radius || 0.09);
    setEditOffset(st.antenna?.verticalOffset || 0);
  };

  /**
   * Save edited station properties
   */
  const handleSaveEditModal = () => {
    if (!editStation) return;

    const corrected = calculateCorrectedAntennaHeight(
      editHeightType,
      editMeasuredH,
      editRadius,
      editOffset
    );

    const updated: Station = {
      ...editStation,
      name: editName.trim() || editStation.name,
      antenna: {
        ...editStation.antenna,
        measuredHeight: editMeasuredH,
        heightType: editHeightType,
        radius: editRadius,
        verticalOffset: editOffset,
        correctedHeight: corrected,
      },
    };

    onUpdateStation(updated);
    setEditStation(null);
    setUploadFeedback(`"${updated.name}" nokta özellikleri ve alet yüksekliği güncellendi.`);
  };

  /**
   * RINEX File Upload Handler
   * Only processes RINEX files ending with .o, .g, .n (or RINEX 2/3 year variants .24o, .25o, .26o, .24g, .25g, .26g, .24n, .25n, .26n, .obs, .rnx, .crx)
   */
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    let importedCount = 0;
    let skippedCount = 0;

    const validRinexRegex = /\.(obs|rnx|crx|nav|\d{2}[ogn]|[ogn])$/i;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const nameLower = file.name.toLowerCase();

      if (!validRinexRegex.test(nameLower)) {
        skippedCount++;
        continue;
      }

      const reader = new FileReader();
      reader.onload = (event) => {
        const text = event.target?.result as string;
        if (!text) return;

        const rinexStn = parseRinexHeader(text, file.name);
        if (rinexStn && rinexStn.id) {
          importedCount++;
          onAddStation(rinexStn as Station);

          const matched = matchAntennaInNoaaCatalog(rinexStn.antenna?.model || '');

          if (rinexStn.observationEpoch && onDetectedSurveyEpoch) {
            onDetectedSurveyEpoch(rinexStn.observationEpoch, rinexStn.observationDateStr);
          }

          const epochMsg = rinexStn.observationEpoch
            ? ` [Ölçü Epoğu: t = ${rinexStn.observationEpoch.toFixed(2)}]`
            : '';

          setUploadFeedback(
            `RINEX verisi (${file.name}) aktarıldı: "${rinexStn.name}" noktası eklendi.${epochMsg} ${
              matched
                ? `[Anten Otomatik Tespit Edildi: ${matched.displayName}]`
                : `[Anten tanınamadı. .atx dosyası yükleyebilirsiniz]`
            }`
          );
        }
      };
      reader.readAsText(file);
    }

    if (skippedCount > 0 && importedCount === 0) {
      setUploadFeedback(`Yalnızca sonu .o, .g, .n olan RINEX gözlem ve navigasyon dosyaları kabul edilmektedir.`);
    }

    e.target.value = '';
  };

  /**
   * Upload single .atx file for a specific station
   */
  const handleSingleAtxUpload = (stationId: string, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      if (!text) return;

      const parsedAtx = parseAntexFile(text);
      const models = Object.keys(parsedAtx);

      if (models.length > 0) {
        const modelName = models[0];
        const atxData = parsedAtx[modelName];
        const currentStn = stations[stationId];

        if (currentStn) {
          const updatedStn: Station = {
            ...currentStn,
            antenna: {
              ...currentStn.antenna,
              model: modelName,
              pcoL1: atxData.pcoL1,
              pcoL2: atxData.pcoL2,
              pcvZenith: atxData.pcvZenith,
            },
          };
          onUpdateStation(updatedStn);
          setUploadFeedback(`"${currentStn.name}" noktasına .atx anten kalibrasyonu yüklendi: ${modelName}`);
        }
      } else {
        setUploadFeedback(`Yüklenen .atx dosyasında geçerli anten modeli bulunamadı.`);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleOpenAntennaModalForStation = (stId: string) => {
    setAntennaModalStationId(stId);
    const targetSt = stations[stId];
    if (targetSt && targetSt.antenna?.model) {
      setModalSearchQuery(targetSt.antenna.model.trim());
    } else {
      setModalSearchQuery('');
    }
    setIsAntennaModalOpen(true);
  };

  const handleSelectNoaaAntenna = (stationId: string, ant: NoaaAntennaCalibration) => {
    const targetSt = stations[stationId];
    if (!targetSt) return;

    const corrected = calculateCorrectedAntennaHeight(
      targetSt.antenna.heightType,
      targetSt.antenna.measuredHeight,
      ant.radius,
      ant.verticalOffset
    );

    const updated: Station = {
      ...targetSt,
      antenna: {
        ...targetSt.antenna,
        model: ant.model,
        radius: ant.radius,
        verticalOffset: ant.verticalOffset,
        correctedHeight: corrected,
        pcoL1: ant.pcoL1,
        pcoL2: ant.pcoL2,
        pcvZenith: ant.pcvZenith,
      },
    };

    onUpdateStation(updated);
    setUploadFeedback(`"${targetSt.name}" noktasına NOAA ANTCAL anteni atandı: ${ant.displayName}`);
  };

  return (
    <div className="space-y-6">
      {/* Top Banner & File Actions */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-bold text-slate-900">
              Rinex Verileri ve Anten Kalibrasyonu
            </h2>
            <p className="text-xs text-slate-500 mt-1">
              Sonu <code>.o, .g, .n</code> ile biten RINEX gözlem ve navigasyon dosyalarını yükleyiniz. 
              Veriler alfabetik olarak sıralanır. Düzenle butonundan alet yüksekliği ve ölçüm tipi değiştirilebilir.
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <label className="px-4 py-2.5 text-xs font-bold bg-sky-600 hover:bg-sky-700 text-white rounded-lg shadow-sm transition cursor-pointer flex items-center gap-2">
              <Upload className="w-4 h-4" />
              <span>RINEX Yükle (.o, .g, .n)</span>
              <input
                type="file"
                multiple
                accept=".o,.g,.n,.24o,.25o,.26o,.27o,.28o,.29o,.30o,.24g,.25g,.26g,.27g,.28g,.29g,.30g,.24n,.25n,.26n,.27n,.28n,.29n,.30n,.rnx,.crx,.obs,.nav"
                onChange={handleFileUpload}
                className="hidden"
              />
            </label>

            {sortedStations.length > 0 && (
              <button
                onClick={onClearAllStations}
                className="px-3.5 py-2.5 text-xs font-semibold bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-300 rounded-lg transition cursor-pointer flex items-center gap-1.5"
                title="Tüm noktaları ve verileri temizle"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Noktaları Temizle</span>
              </button>
            )}
          </div>
        </div>

        {uploadFeedback && (
          <div className="mt-3 p-2.5 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg text-xs flex items-center justify-between">
            <div className="flex items-center gap-1.5 font-medium">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>{uploadFeedback}</span>
            </div>
            <button
              onClick={() => setUploadFeedback(null)}
              className="text-emerald-600 hover:text-emerald-900 font-bold ml-2 cursor-pointer"
            >
              ×
            </button>
          </div>
        )}
      </div>

      {/* Empty State */}
      {sortedStations.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm border border-dashed border-slate-300 p-12 text-center space-y-4">
          <div className="w-14 h-14 bg-sky-50 text-sky-600 rounded-full flex items-center justify-center mx-auto">
            <Radio className="w-7 h-7" />
          </div>
          <div className="space-y-1">
            <h3 className="text-base font-bold text-slate-800">Yüklü RINEX Verisi Bulunmuyor</h3>
            <p className="text-xs text-slate-500 max-w-xl mx-auto leading-relaxed">
              Ölçülerinize ait <code>.o, .g, .n</code> uzantılı RINEX gözlem ve navigasyon dosyalarını 
              doğrudan yükleyebilirsiniz.
            </p>
          </div>

          <div className="pt-2">
            <label className="px-5 py-3 text-xs font-bold bg-sky-600 hover:bg-sky-700 text-white rounded-xl shadow-sm transition cursor-pointer inline-flex items-center gap-2">
              <Upload className="w-4 h-4" />
              <span>RINEX Dosyası Seç (.o, .g, .n)</span>
              <input
                type="file"
                multiple
                accept=".o,.g,.n,.24o,.25o,.26o,.27o,.28o,.29o,.30o,.24g,.25g,.26g,.27g,.28g,.29g,.30g,.24n,.25n,.26n,.27n,.28n,.29n,.30n,.rnx,.crx,.obs,.nav"
                onChange={handleFileUpload}
                className="hidden"
              />
            </label>
          </div>
        </div>
      ) : (
        /* Full Width Station Table */
        <div className="w-full bg-white rounded-xl shadow-sm border border-slate-200 p-5 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div className="flex items-center gap-2">
              <Radio className="w-4 h-4 text-sky-600" />
              <h3 className="text-sm font-bold text-slate-900">Rinex Veri Listesi ({sortedStations.length})</h3>
            </div>
            <span className="text-xs text-slate-500 font-medium">
              İsimlerine göre alfabetik sıralanmıştır
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-50 text-slate-700 font-semibold border-b border-slate-200 whitespace-nowrap">
                  <th className="py-2.5 px-3">Nokta Adı</th>
                  <th className="py-2.5 px-3 text-right">Y (m)</th>
                  <th className="py-2.5 px-3 text-right">X (m)</th>
                  <th className="py-2.5 px-3 text-right">Z (Elip. H)</th>
                  <th className="py-2.5 px-3 text-center">Nokta Tipi</th>
                  <th className="py-2.5 px-3">GNSS Anteni</th>
                  <th className="py-2.5 px-3 text-right">Alet Yük. (m)</th>
                  <th className="py-2.5 px-3 text-center">Yükseklik Tipi</th>
                  <th className="py-2.5 px-3 text-center">GPS Week Day</th>
                  <th className="py-2.5 px-3 text-left">Başlangıç Zamanı</th>
                  <th className="py-2.5 px-3 text-left">Bitiş Zamanı</th>
                  <th className="py-2.5 px-3 text-center">İşlem</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {sortedStations.map((st) => {
                  const isFixed = st.isFixed.x && st.isFixed.y && st.isFixed.z;
                  const matchedCal = matchAntennaInNoaaCatalog(st.antenna?.model || '');

                  const hasValidAntenna = Boolean(
                    matchedCal || (st.antenna?.model && st.antenna.model !== 'UNKNOWN' && st.antenna.model !== 'NONE' && st.antenna.model !== '')
                  );

                  // Calculate Topcon Tools ARP height = Ground Height + Corrected Antenna Height
                  const arpH = (st.h || 0) + (st.antenna?.correctedHeight || 0);
                  const gpsWeekDayStr = getGpsWeekDay(
                    st.occupation?.firstEpochDate || st.observationDateStr,
                    st.observationEpoch
                  );

                  return (
                    <tr key={st.id} className="hover:bg-slate-50/80 transition">
                      {/* 1. Nokta Adı */}
                      <td className="py-2.5 px-3 font-bold font-mono text-slate-900 flex items-center gap-2 whitespace-nowrap">
                        <span
                          className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                            isFixed ? 'bg-rose-500 ring-2 ring-rose-200' : 'bg-sky-500 ring-2 ring-sky-200'
                          }`}
                        />
                        <span>{st.name}</span>
                      </td>

                      {/* 2. Y (Sağa Değer) */}
                      <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-800 whitespace-nowrap">
                        {(st.projY || 0).toFixed(3)}
                      </td>

                      {/* 3. X (Yukarı Değer) */}
                      <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-800 whitespace-nowrap">
                        {(st.projX || 0).toFixed(3)}
                      </td>

                      {/* 4. Z (Elipsoidal Kot - Zemin) */}
                      <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-900 whitespace-nowrap">
                        {(st.h || 0).toFixed(3)} m
                      </td>

                      {/* 5. Nokta Tipi (Sabit Nokta / Ara Nokta) */}
                      <td className="py-2.5 px-3 text-center whitespace-nowrap">
                        <button
                          onClick={() => handleToggleFixed(st.id)}
                          className={`px-2.5 py-0.5 rounded text-[10px] font-bold cursor-pointer transition ${
                            isFixed
                              ? 'bg-rose-100 text-rose-800 border border-rose-300'
                              : 'bg-sky-100 text-sky-800 border border-sky-300'
                          }`}
                          title="Tıklayarak Sabit Nokta (CORS) veya Ara Nokta (Gezici) durumunu değiştirin"
                        >
                          {isFixed ? 'Sabit Nokta' : 'Ara Nokta'}
                        </button>
                      </td>

                      {/* 6. GNSS Anteni */}
                      <td className="py-2.5 px-3 font-mono text-xs whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          <span className="bg-slate-100 text-slate-800 text-[11px] font-bold px-2 py-0.5 rounded border border-slate-200 flex items-center gap-1 font-mono">
                            <CheckCircle2 className="w-3 h-3 text-emerald-600 shrink-0" />
                            <span>{getShortAntennaName(matchedCal ? matchedCal.model : st.antenna?.model)}</span>
                          </span>

                          <label className="px-2 py-0.5 text-[10px] font-bold bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-300 rounded cursor-pointer inline-flex items-center gap-1 transition shrink-0">
                            <Upload className="w-3 h-3 text-amber-600 shrink-0" />
                            <span>ATX Yükle</span>
                            <input
                              type="file"
                              accept=".atx"
                              onChange={(e) => handleSingleAtxUpload(st.id, e)}
                              className="hidden"
                            />
                          </label>
                        </div>
                      </td>

                      {/* 7. Alet Yüksekliği */}
                      <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-800 whitespace-nowrap">
                        {(st.antenna?.measuredHeight || 0).toFixed(3)} m
                      </td>

                      {/* 8. Yükseklik Tipi */}
                      <td className="py-2.5 px-3 text-center whitespace-nowrap">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                          st.antenna?.heightType === 'slant'
                            ? 'bg-amber-100 text-amber-800 border border-amber-300'
                            : 'bg-sky-100 text-sky-800 border border-sky-300'
                        }`}>
                          {st.antenna?.heightType === 'slant' ? 'Eğik (Sehpa)' : 'Düşey (Pilye)'}
                        </span>
                      </td>

                      {/* 9. GPS Week Day */}
                      <td className="py-2.5 px-3 text-center font-mono font-bold text-slate-800 whitespace-nowrap">
                        <span className="bg-slate-100 text-slate-800 border border-slate-200 px-2 py-0.5 rounded">
                          {gpsWeekDayStr}
                        </span>
                      </td>

                      {/* 10. Başlangıç Zamanı (Proje Zaman Dilimine Göre) */}
                      <td className="py-2.5 px-3 font-mono text-[11px] text-slate-700 whitespace-nowrap">
                        {adjustDateStringToTimeZone(st.occupation?.firstEpochDate || st.observationDateStr, timeZone)}
                      </td>

                      {/* 11. Bitiş Zamanı (Proje Zaman Dilimine Göre) */}
                      <td className="py-2.5 px-3 font-mono text-[11px] text-slate-700 whitespace-nowrap">
                        {adjustDateStringToTimeZone(st.occupation?.lastEpochDate, timeZone)}
                      </td>

                      {/* 12. İşlem */}
                      <td className="py-2.5 px-3 text-center whitespace-nowrap">
                        <div className="flex items-center justify-center gap-1.5">
                          <button
                            onClick={() => setOccupationModalStationId(st.id)}
                            className="px-2 py-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-300 rounded text-[11px] font-bold cursor-pointer flex items-center gap-1 transition"
                            title="Uydu ve Zaman Takip Grafiğini Aç (Occupation View)"
                          >
                            <Activity className="w-3.5 h-3.5 text-emerald-600" />
                            <span>Uydu Grafiği</span>
                          </button>

                          <button
                            onClick={() => handleOpenEditModal(st)}
                            className="px-2 py-1 bg-sky-50 hover:bg-sky-100 text-sky-700 border border-sky-300 rounded text-[11px] font-bold cursor-pointer flex items-center gap-1 transition"
                            title="Alet yüksekliği ve ölçüm özelliklerini düzenle"
                          >
                            <Edit2 className="w-3.5 h-3.5 text-sky-600" />
                            <span>Düzenle</span>
                          </button>

                          <button
                            onClick={() => onDeleteStation(st.id)}
                            className="p-1 hover:bg-rose-100 rounded text-slate-400 hover:text-rose-600 cursor-pointer"
                            title="Noktayı Sil"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 1. OCCUPATION VIEW POPUP MODAL */}
      {/* ========================================================================= */}
      {occupationModalStationId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-2xl max-w-5xl w-full max-h-[92vh] flex flex-col overflow-hidden animate-in fade-in duration-150">
            <div className="p-4 border-b border-slate-200 bg-slate-900 text-white flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2">
                <Activity className="w-5 h-5 text-emerald-400" />
                <h3 className="font-bold text-base">
                  Oturum ve Uydu Takip Grafiği (Occupation View): {stations[occupationModalStationId]?.name}
                </h3>
              </div>
              <button
                onClick={() => setOccupationModalStationId(null)}
                className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 overflow-y-auto flex-1 custom-scrollbar">
              <OccupationViewTab
                stations={stations}
                selectedStationId={occupationModalStationId}
                onSelectStation={(id) => setOccupationModalStationId(id)}
              />
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 2. STATION PROPERTIES EDIT POPUP MODAL (Alet Yüksekliği & Ölçüm Tipi) */}
      {/* ========================================================================= */}
      {editStation && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full overflow-hidden animate-in fade-in duration-150">
            {/* Modal Header */}
            <div className="p-5 border-b border-slate-200 bg-slate-900 text-white flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Edit2 className="w-5 h-5 text-sky-400" />
                <h3 className="font-bold text-base">
                  Nokta Özelliklerini Düzenle: {editStation.name}
                </h3>
              </div>
              <button
                onClick={() => setEditStation(null)}
                className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 space-y-4 text-xs">
              <div>
                <label className="block text-slate-700 font-bold mb-1">Nokta Adı / ID</label>
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg font-bold font-mono text-slate-900"
                />
              </div>

              <div>
                <label className="block text-slate-700 font-bold mb-1">Yükseklik Ölçüm Tipi</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setEditHeightType('vertical')}
                    className={`py-2 px-3 rounded-lg font-bold text-xs cursor-pointer border transition ${
                      editHeightType === 'vertical'
                        ? 'bg-sky-600 text-white border-sky-600 shadow-xs'
                        : 'bg-slate-50 text-slate-700 border-slate-300'
                    }`}
                  >
                    Düşey (Pilye)
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditHeightType('slant')}
                    className={`py-2 px-3 rounded-lg font-bold text-xs cursor-pointer border transition ${
                      editHeightType === 'slant'
                        ? 'bg-amber-600 text-white border-amber-600 shadow-xs'
                        : 'bg-slate-50 text-slate-700 border-slate-300'
                    }`}
                  >
                    Eğik (Sehpa / Jalon)
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-slate-700 font-bold mb-1">Ölçülen Alet Yüksekliği (m)</label>
                <input
                  type="number"
                  step="0.001"
                  value={editMeasuredH}
                  onChange={(e) => setEditMeasuredH(parseFloat(e.target.value) || 0)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg font-bold font-mono text-slate-900 text-sm"
                />
              </div>

              <div className="grid grid-cols-2 gap-2 text-[11px]">
                <div>
                  <label className="block text-slate-600 font-medium mb-1">Anten Yarıçapı R (m)</label>
                  <input
                    type="number"
                    step="0.001"
                    value={editRadius}
                    onChange={(e) => setEditRadius(parseFloat(e.target.value) || 0)}
                    className="w-full px-2.5 py-1.5 border border-slate-300 rounded font-mono"
                  />
                </div>
                <div>
                  <label className="block text-slate-600 font-medium mb-1">ARP Dikey Ofset (m)</label>
                  <input
                    type="number"
                    step="0.001"
                    value={editOffset}
                    onChange={(e) => setEditOffset(parseFloat(e.target.value) || 0)}
                    className="w-full px-2.5 py-1.5 border border-slate-300 rounded font-mono"
                  />
                </div>
              </div>

              {/* Calculated ARP Height Preview */}
              <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl flex items-center justify-between">
                <span className="font-bold text-emerald-900">Hesaplanan Dik ARP Yüksekliği:</span>
                <span className="font-mono font-bold text-sm text-emerald-800">
                  {calculateCorrectedAntennaHeight(editHeightType, editMeasuredH, editRadius, editOffset).toFixed(4)} m
                </span>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="p-4 bg-slate-50 border-t border-slate-200 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditStation(null)}
                className="px-4 py-2 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-100 font-semibold cursor-pointer"
              >
                İptal
              </button>
              <button
                type="button"
                onClick={handleSaveEditModal}
                className="px-5 py-2 rounded-lg bg-sky-600 hover:bg-sky-700 text-white font-bold shadow-sm transition cursor-pointer flex items-center gap-1.5"
              >
                <Save className="w-4 h-4" />
                <span>Değişiklikleri Kaydet</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* DEDICATED NOAA ANTCAL SELECTION MODAL */}
      {isAntennaModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-3xl w-full max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in duration-150">
            {/* Modal Header */}
            <div className="p-5 border-b border-slate-200 bg-slate-900 text-white flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <Sliders className="w-4 h-4 text-sky-400" />
                  <h3 className="font-bold text-base">
                    NOAA NGS ANTCAL Anten Kalibrasyon Kataloğu
                  </h3>
                </div>
                <p className="text-xs text-slate-400 mt-0.5">
                  Seçilen Nokta: <strong>{stations[antennaModalStationId]?.name || antennaModalStationId}</strong> &bull; 
                  Resmi NOAA & IGS20 PCO / PCV Parametreleri
                </p>
              </div>
              <button
                onClick={() => setIsAntennaModalOpen(false)}
                className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Filter Controls */}
            <div className="p-4 border-b border-slate-200 bg-slate-50 space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <div className="relative sm:col-span-1">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-3" />
                  <input
                    type="text"
                    placeholder="Model ara (örn: Zephyr, TRM)..."
                    value={modalSearchQuery}
                    onChange={(e) => setModalSearchQuery(e.target.value)}
                    className="w-full pl-8 pr-3 py-2 border border-slate-300 rounded-lg text-xs bg-white"
                  />
                </div>

                <div>
                  <select
                    value={modalManufacturer}
                    onChange={(e) => setModalManufacturer(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs bg-white font-medium"
                  >
                    <option value="ALL">Tüm Markalar ({NOAA_ANTCAL_CATALOG.length})</option>
                    {manufacturers.map((m) => (
                      <option key={m} value={m}>
                        {m} ({NOAA_ANTCAL_CATALOG.filter((a) => a.manufacturer === m).length})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <select
                    value={modalCategory}
                    onChange={(e) => setModalCategory(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs bg-white font-medium"
                  >
                    <option value="ALL">Tüm Anten Tipleri</option>
                    <option value="CORS / Choke Ring">CORS / Choke Ring</option>
                    <option value="Geodetic Base">Jeodezik Sabit (Base)</option>
                    <option value="Rover / SmartAntenna">Gezici / SmartAntenna (Rover)</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Antenna List */}
            <div className="p-4 overflow-y-auto flex-1 custom-scrollbar divide-y divide-slate-100">
              {modalFilteredAntennas.length === 0 ? (
                <div className="py-12 text-center text-slate-400 text-xs">
                  Arama kriterlerine uygun anten kalibrasyon modeli bulunamadı.
                </div>
              ) : (
                modalFilteredAntennas.map((ant) => {
                  const targetStation = stations[antennaModalStationId];
                  const isCurrent =
                    targetStation &&
                    targetStation.antenna?.model &&
                    targetStation.antenna.model.trim().toUpperCase() === ant.model.trim().toUpperCase();

                  return (
                    <div
                      key={ant.model}
                      className={`py-3 px-2 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-slate-50 transition rounded-lg ${
                        isCurrent ? 'bg-sky-50/80 ring-1 ring-sky-300' : ''
                      }`}
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-slate-900 text-xs">{ant.displayName}</span>
                          <span className="bg-slate-100 text-slate-700 text-[10px] font-mono px-2 py-0.5 rounded border border-slate-200">
                            {ant.manufacturer}
                          </span>
                        </div>
                        <div className="font-mono text-[11px] text-slate-500 flex items-center gap-3 flex-wrap">
                          <span>Model: <strong className="text-slate-800">{ant.model}</strong></span>
                          <span>Radome: <strong>{ant.radome}</strong></span>
                        </div>
                      </div>

                      <div className="shrink-0 flex items-center gap-2">
                        {isCurrent ? (
                          <span className="px-3 py-1.5 bg-emerald-100 text-emerald-800 font-bold text-xs rounded-lg flex items-center gap-1 border border-emerald-300">
                            <Check className="w-3.5 h-3.5" />
                            <span>Mevcut Model</span>
                          </span>
                        ) : (
                          <button
                            onClick={() => {
                              handleSelectNoaaAntenna(antennaModalStationId, ant);
                              setIsAntennaModalOpen(false);
                            }}
                            className="px-3.5 py-1.5 bg-sky-600 hover:bg-sky-700 text-white font-bold text-xs rounded-lg shadow-xs cursor-pointer transition"
                          >
                            Bu Anteni Noktaya Ata
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Modal Footer */}
            <div className="p-3 bg-slate-50 border-t border-slate-200 flex justify-between items-center text-xs text-slate-500">
              <span>Toplam {modalFilteredAntennas.length} / {NOAA_ANTCAL_CATALOG.length} anten modeli listeleniyor.</span>
              <button
                onClick={() => setIsAntennaModalOpen(false)}
                className="px-4 py-1.5 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-100 font-semibold cursor-pointer"
              >
                Kapat
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
