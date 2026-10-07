/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * Veri Girişi Modülü (Data Entry & GNSS Observations Engine)
 * - Dengelenecek Noktalar (Rover) ve TUSAGA Sabit Noktaları (CORS) RINEX Yükleme (.o, .g, .n)
 * - TUSAGA 2005 Epok Hız Bilgileri (Tektonik Deformasyon Modeli)
 * - IGS Hassas Yörünge (.SP3) ve Uydu Saatleri (.CLK) Otomatik Tespiti ve İndirilmesi
 * - NOAA NGS ANTCAL & IGS20 Mutlak Anten Kalibrasyon Kataloğu
 */

import React, { useState, useMemo } from 'react';
import {
  Station,
  AntennaHeightType,
  StationType,
  StationVelocities,
  IgsOrbitInfo,
  IgsSp3File,
} from '../types/gnss';
import {
  calculateCorrectedAntennaHeight,
  parseRinexHeader,
  parseAntexFile,
  getGpsWeekDay,
  getShortAntennaName,
  adjustDateStringToTimeZone,
  getIgsProductDetails,
  parseIgsSp3File,
  TUSAGA_VELOCITY_CATALOG,
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
  Satellite,
  Download,
  ShieldCheck,
  TrendingUp,
  Globe2,
  Database,
  Info,
  FileCode,
  ExternalLink,
  Sparkles,
} from 'lucide-react';

interface Props {
  stations: Record<string, Station>;
  dom?: number;
  timeZone?: string;
  surveyEpoch?: number;
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
  surveyEpoch = 2026.0,
  onUpdateStation,
  onAddStation,
  onDeleteStation,
  onClearAllStations,
  onDetectedSurveyEpoch,
}) => {
  // Sort stations alphabetically by name
  const sortedStations = useMemo(() => {
    return Object.values(stations).sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
    );
  }, [stations]);

  const roverStations = useMemo(() => sortedStations.filter((s) => s.type !== 'CORS' && !(s.isFixed.x && s.isFixed.y && s.isFixed.z)), [sortedStations]);
  const corsStations = useMemo(() => sortedStations.filter((s) => s.type === 'CORS' || (s.isFixed.x && s.isFixed.y && s.isFixed.z)), [sortedStations]);

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

  // Velocity Modal State
  const [isVelocityModalOpen, setIsVelocityModalOpen] = useState(false);
  const [editingVelocityStationId, setEditingVelocityStationId] = useState<string | null>(null);
  const [tempVx, setTempVx] = useState<number>(-0.015);
  const [tempVy, setTempVy] = useState<number>(-0.0218);
  const [tempVz, setTempVz] = useState<number>(0.0084);
  const [tempVe, setTempVe] = useState<number>(-21.5);
  const [tempVn, setTempVn] = useState<number>(14.0);
  const [tempVu, setTempVu] = useState<number>(1.0);

  // IGS Orbit Product State
  const [loadedSp3File, setLoadedSp3File] = useState<IgsSp3File | null>(null);

  // Detect earliest observation date from all loaded stations
  const earliestObsDateStr = useMemo(() => {
    for (const st of sortedStations) {
      if (st.occupation?.firstEpochDate) return st.occupation.firstEpochDate;
      if (st.observationDateStr) return st.observationDateStr;
    }
    return undefined;
  }, [sortedStations]);

  const earliestEpochDecimal = useMemo(() => {
    for (const st of sortedStations) {
      if (st.observationEpoch) return st.observationEpoch;
    }
    return surveyEpoch;
  }, [sortedStations, surveyEpoch]);

  const igsOrbitInfo: IgsOrbitInfo | null = useMemo(() => {
    if (!earliestObsDateStr && !earliestEpochDecimal) return null;
    return getIgsProductDetails(earliestObsDateStr, earliestEpochDecimal);
  }, [earliestObsDateStr, earliestEpochDecimal]);

  const manufacturers = useMemo(() => Array.from(new Set(NOAA_ANTCAL_CATALOG.map((a) => a.manufacturer))).sort(), []);

  const modalFilteredAntennas = useMemo(() => {
    return NOAA_ANTCAL_CATALOG.filter((ant) => {
      const matchesMan = modalManufacturer === 'ALL' || ant.manufacturer === modalManufacturer;
      const matchesCat = modalCategory === 'ALL' || ant.category === modalCategory;
      const matchesQuery =
        modalSearchQuery === '' ||
        ant.model.toLowerCase().includes(modalSearchQuery.toLowerCase()) ||
        ant.displayName.toLowerCase().includes(modalSearchQuery.toLowerCase()) ||
        ant.manufacturer.toLowerCase().includes(modalSearchQuery.toLowerCase());
      return matchesMan && matchesCat && matchesQuery;
    });
  }, [modalManufacturer, modalCategory, modalSearchQuery]);

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
   * Generalized RINEX File Upload
   */
  const processRinexFiles = (files: FileList, forcedType?: 'GROUND' | 'CORS') => {
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
          const stnName = (rinexStn.name || rinexStn.id || 'PNT1').trim();

          const pointType: StationType = forcedType
            ? forcedType
            : rinexStn.type || (stnName.length <= 4 ? 'CORS' : 'GROUND');

          const isFixedStatus = pointType === 'CORS';

          // Assign default or catalog velocity
          const nameUpper = stnName.toUpperCase().substring(0, 4);
          const catalogVel = TUSAGA_VELOCITY_CATALOG[nameUpper] || TUSAGA_VELOCITY_CATALOG.DEFAULT;

          const finalStation: Station = {
            ...(rinexStn as Station),
            name: stnName,
            type: pointType,
            isFixed: { x: isFixedStatus, y: isFixedStatus, z: isFixedStatus },
            velocities: {
              vx: catalogVel.vx,
              vy: catalogVel.vy,
              vz: catalogVel.vz,
              ve: catalogVel.ve,
              vn: catalogVel.vn,
              vu: catalogVel.vu,
            },
          };

          onAddStation(finalStation);

          const matched = matchAntennaInNoaaCatalog(finalStation.antenna?.model || '');

          if (finalStation.observationEpoch && onDetectedSurveyEpoch) {
            onDetectedSurveyEpoch(finalStation.observationEpoch, finalStation.observationDateStr);
          }

          const epochMsg = finalStation.observationEpoch
            ? ` [Ölçü Epoğu: t = ${finalStation.observationEpoch.toFixed(2)}]`
            : '';

          setUploadFeedback(
            `RINEX verisi (${file.name}) aktarıldı: "${finalStation.name}" [${pointType === 'CORS' ? 'TUSAGA Sabit' : 'Dengelenecek Ara Nokta'}] eklendi.${epochMsg} ${
              matched
                ? `[Anten: ${matched.displayName}]`
                : `[Anten tanınamadı. .atx dosyası yükleyebilirsiniz]`
            }`
          );
        }
      };
      reader.readAsText(file);
    }

    if (skippedCount > 0 && importedCount === 0) {
      setUploadFeedback(`Yalnızca sonu .o, .g, .n veya .obs olan RINEX dosyaları kabul edilmektedir.`);
    }
  };

  const handleRoverUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      processRinexFiles(e.target.files, 'GROUND');
      e.target.value = '';
    }
  };

  const handleTusagaUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      processRinexFiles(e.target.files, 'CORS');
      e.target.value = '';
    }
  };

  const handleGeneralUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      processRinexFiles(e.target.files);
      e.target.value = '';
    }
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

  /**
   * Handle SP3 Precise Orbit File Upload
   */
  const handleSp3Upload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      if (!text) return;

      const parsed = parseIgsSp3File(text, file.name);
      if (parsed) {
        setLoadedSp3File(parsed);
        setUploadFeedback(
          `IGS Hassas Yörünge Dosyası (.SP3) yüklendi: ${file.name} (${parsed.satelliteCount} Uydu, ${parsed.epochCount} Epok). AUSPOS / Bernese düzeyinde hassasiyet aktif.`
        );
      } else {
        setUploadFeedback(`Geçerli bir IGS .SP3 hassas yörünge dosyası formatı tespit edilemedi.`);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  /**
   * Auto-apply official TUSAGA National Velocities
   */
  const handleAutoApplyTusagaVelocities = () => {
    let count = 0;
    for (const id in stations) {
      const st = stations[id];
      const nameUpper = st.name.toUpperCase().substring(0, 4);
      const cat = TUSAGA_VELOCITY_CATALOG[nameUpper] || TUSAGA_VELOCITY_CATALOG.DEFAULT;
      onUpdateStation({
        ...st,
        velocities: {
          vx: cat.vx,
          vy: cat.vy,
          vz: cat.vz,
          ve: cat.ve,
          vn: cat.vn,
          vu: cat.vu,
        },
      });
      count++;
    }
    setUploadFeedback(`${count} istasyona resmi TUSAGA-Aktif tektonik plaka hızları (ITRF96 / 2005.00) otomatik atandı.`);
  };

  /**
   * Open Velocity Modal for specific station or all
   */
  const handleOpenVelocityModal = (stationId?: string) => {
    setEditingVelocityStationId(stationId || null);
    if (stationId && stations[stationId]?.velocities) {
      const v = stations[stationId].velocities;
      setTempVx(v.vx);
      setTempVy(v.vy);
      setTempVz(v.vz);
      setTempVe(v.ve ?? -21.5);
      setTempVn(v.vn ?? 14.0);
      setTempVu(v.vu ?? 1.0);
    } else {
      setTempVx(-0.015);
      setTempVy(-0.0218);
      setTempVz(0.0084);
      setTempVe(-21.5);
      setTempVn(14.0);
      setTempVu(1.0);
    }
    setIsVelocityModalOpen(true);
  };

  const handleSaveVelocityModal = () => {
    if (editingVelocityStationId) {
      const st = stations[editingVelocityStationId];
      if (st) {
        onUpdateStation({
          ...st,
          velocities: {
            vx: tempVx,
            vy: tempVy,
            vz: tempVz,
            ve: tempVe,
            vn: tempVn,
            vu: tempVu,
          },
        });
        setUploadFeedback(`"${st.name}" istasyonunun 2005 epok hızları güncellendi.`);
      }
    } else {
      // Apply to all CORS / Fixed stations
      for (const id in stations) {
        const st = stations[id];
        onUpdateStation({
          ...st,
          velocities: {
            vx: tempVx,
            vy: tempVy,
            vz: tempVz,
            ve: tempVe,
            vn: tempVn,
            vu: tempVu,
          },
        });
      }
      setUploadFeedback(`Tüm istasyonların tektonik plaka hızları güncellendi.`);
    }
    setIsVelocityModalOpen(false);
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
      {/* Overview Header Banner */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="bg-sky-100 text-sky-800 text-[10px] font-extrabold px-2 py-0.5 rounded border border-sky-300 uppercase">
                Adım 2 / 8
              </span>
              <h2 className="text-base sm:text-lg font-bold text-slate-900">
                Veri Girişi ve Jeodezik Gözlem Yönetimi
              </h2>
            </div>
            <p className="text-xs text-slate-500 mt-1 max-w-3xl">
              Dengelenecek noktaların (Rover) ve TUSAGA-Aktif sabit bazlarının (Base) RINEX gözlem verileri, 
              2005 epok hızları ($V_x, V_y, V_z$), IGS hassas yörünge (.SP3) ve NOAA mutlak anten kalibrasyonları (.ATX).
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {sortedStations.length > 0 && (
              <button
                onClick={onClearAllStations}
                className="px-3.5 py-2 text-xs font-semibold bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-300 rounded-lg transition cursor-pointer flex items-center gap-1.5"
                title="Tüm noktaları ve verileri temizle"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Verileri Temizle</span>
              </button>
            )}
          </div>
        </div>

        {uploadFeedback && (
          <div className="mt-4 p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg text-xs flex items-center justify-between animate-fade-in">
            <div className="flex items-center gap-2 font-medium">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>{uploadFeedback}</span>
            </div>
            <button
              onClick={() => setUploadFeedback(null)}
              className="text-emerald-700 hover:text-emerald-950 font-bold ml-2 cursor-pointer text-base leading-none"
            >
              ×
            </button>
          </div>
        )}
      </div>

      {/* 4 Main Action Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: Dengelenecek Noktalar (Rover) */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 flex flex-col justify-between hover:border-sky-300 transition">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="w-8 h-8 rounded-lg bg-sky-100 text-sky-700 flex items-center justify-center font-bold text-xs">
                1
              </span>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-sky-50 text-sky-700 border border-sky-200">
                {roverStations.length} Rover Nokta
              </span>
            </div>
            <div>
              <h3 className="text-xs font-bold text-slate-900">Dengelenecek Noktalar (Rover)</h3>
              <p className="text-[11px] text-slate-500 mt-0.5 leading-relaxed">
                Bilinmeyen ve koordinatları aranacak arazi noktalarına ait RINEX verileri.
              </p>
            </div>
          </div>

          <div className="pt-3 mt-3 border-t border-slate-100">
            <label className="w-full py-2 px-3 text-xs font-bold bg-sky-600 hover:bg-sky-700 text-white rounded-lg shadow-xs transition cursor-pointer flex items-center justify-center gap-2 text-center">
              <Upload className="w-3.5 h-3.5" />
              <span>Rover RINEX Yükle</span>
              <input
                type="file"
                multiple
                accept=".o,.g,.n,.24o,.25o,.26o,.27o,.28o,.29o,.30o,.rnx,.crx,.obs,.nav"
                onChange={handleRoverUpload}
                className="hidden"
              />
            </label>
          </div>
        </div>

        {/* Card 2: TUSAGA Sabit Noktaları (CORS / Base) */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 flex flex-col justify-between hover:border-emerald-300 transition">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="w-8 h-8 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center font-bold text-xs">
                2
              </span>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                {corsStations.length} TUSAGA Sabit
              </span>
            </div>
            <div>
              <h3 className="text-xs font-bold text-slate-900">TUSAGA Sabit Noktaları (Base)</h3>
              <p className="text-[11px] text-slate-500 mt-0.5 leading-relaxed">
                TUSAGA-Aktif portalından indirilen sabit CORS istasyonlarına ait RINEX verileri.
              </p>
            </div>
          </div>

          <div className="pt-3 mt-3 border-t border-slate-100">
            <label className="w-full py-2 px-3 text-xs font-bold bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg shadow-xs transition cursor-pointer flex items-center justify-center gap-2 text-center">
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>TUSAGA RINEX Yükle</span>
              <input
                type="file"
                multiple
                accept=".o,.g,.n,.24o,.25o,.26o,.27o,.28o,.29o,.30o,.rnx,.crx,.obs,.nav"
                onChange={handleTusagaUpload}
                className="hidden"
              />
            </label>
          </div>
        </div>

        {/* Card 3: TUSAGA 2005 Epok Hız Bilgileri */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 flex flex-col justify-between hover:border-purple-300 transition">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="w-8 h-8 rounded-lg bg-purple-100 text-purple-700 flex items-center justify-center font-bold text-xs">
                3
              </span>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-purple-50 text-purple-700 border border-purple-200">
                2005.00 → {surveyEpoch.toFixed(2)}
              </span>
            </div>
            <div>
              <h3 className="text-xs font-bold text-slate-900">TUSAGA 2005 Epok Hızları</h3>
              <p className="text-[11px] text-slate-500 mt-0.5 leading-relaxed">
                Anadolu plaka tektoniği ($V_x, V_y, V_z$). $X(t) = X_{2005} + V_x \cdot (t - 2005.00)$.
              </p>
            </div>
          </div>

          <div className="pt-3 mt-3 border-t border-slate-100 flex items-center gap-1.5">
            <button
              onClick={handleAutoApplyTusagaVelocities}
              className="flex-1 py-2 px-2 text-[11px] font-bold bg-purple-700 hover:bg-purple-800 text-white rounded-lg shadow-xs transition cursor-pointer flex items-center justify-center gap-1 text-center"
              title="Resmi TUSAGA-Aktif hız kataloğundaki değerleri istasyonlara ata"
            >
              <TrendingUp className="w-3 h-3" />
              <span>Hızları Otomatik Ata</span>
            </button>
            <button
              onClick={() => handleOpenVelocityModal()}
              className="py-2 px-2.5 text-[11px] font-bold bg-purple-50 hover:bg-purple-100 text-purple-800 border border-purple-300 rounded-lg transition cursor-pointer"
              title="İstasyon bazında hızları düzenle"
            >
              <Edit2 className="w-3 h-3" />
            </button>
          </div>
        </div>

        {/* Card 4: IGS Hassas Yörünge (.SP3) ve Uydu Saatleri (.CLK) */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 flex flex-col justify-between hover:border-amber-300 transition">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="w-8 h-8 rounded-lg bg-amber-100 text-amber-800 flex items-center justify-center font-bold text-xs">
                4
              </span>
              <span
                className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                  loadedSp3File
                    ? 'bg-emerald-100 text-emerald-800 border-emerald-300'
                    : 'bg-amber-50 text-amber-800 border-amber-200'
                }`}
              >
                {loadedSp3File ? 'SP3 Aktif (< 2cm)' : igsOrbitInfo ? `${igsOrbitInfo.productType}` : 'IGS SP3'}
              </span>
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <h3 className="text-xs font-bold text-slate-900">IGS Hassas Yörünge (.SP3)</h3>
                <Sparkles className="w-3.5 h-3.5 text-amber-500" />
              </div>
              <p className="text-[11px] text-slate-500 mt-0.5 leading-relaxed">
                {igsOrbitInfo
                  ? `Hafta: ${igsOrbitInfo.gpsWeek}-${igsOrbitInfo.dayOfWeek} (DOY ${igsOrbitInfo.doy}). AUSPOS/Bernese hassasiyeti.`
                  : 'RINEX verisi yüklendiğinde IGS SP3 ürünü otomatik tespit edilir.'}
              </p>
            </div>
          </div>

          <div className="pt-3 mt-3 border-t border-slate-100 flex items-center gap-1.5">
            <label className="flex-1 py-2 px-2 text-[11px] font-bold bg-slate-900 hover:bg-slate-800 text-white rounded-lg shadow-xs transition cursor-pointer flex items-center justify-center gap-1.5 text-center">
              <Satellite className="w-3 h-3 text-amber-400" />
              <span>{loadedSp3File ? '.SP3 Değiştir' : '.SP3 Yükle'}</span>
              <input
                type="file"
                accept=".sp3,.eph,.clk,.SP3"
                onChange={handleSp3Upload}
                className="hidden"
              />
            </label>
            {igsOrbitInfo && (
              <a
                href={igsOrbitInfo.cddisUrl}
                target="_blank"
                rel="noreferrer"
                className="py-2 px-2.5 text-[11px] font-bold bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-300 rounded-lg transition inline-flex items-center gap-1"
                title={`CDDIS IGS ${igsOrbitInfo.productName} indir`}
              >
                <Download className="w-3 h-3 text-amber-700" />
                <span>İndir</span>
              </a>
            )}
          </div>
        </div>
      </div>

      {/* IGS Orbit Info Detail Box (if detected) */}
      {igsOrbitInfo && (
        <div className="bg-linear-to-r from-slate-900 to-slate-800 text-white rounded-xl p-4 shadow-sm border border-slate-700 flex flex-col md:flex-row md:items-center justify-between gap-4 text-xs">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Satellite className="w-4 h-4 text-sky-400" />
              <span className="font-bold text-white text-sm">
                Tespit Edilen IGS Hassas Yörünge: {igsOrbitInfo.productName}
              </span>
              <span className="px-2 py-0.5 rounded bg-sky-500/20 text-sky-300 text-[10px] font-mono border border-sky-400/30">
                GPS Hafta: {igsOrbitInfo.gpsWeek}-{igsOrbitInfo.dayOfWeek}
              </span>
            </div>
            <p className="text-slate-300 text-[11px]">
              {igsOrbitInfo.recommendationText} &bull; Hassasiyet: <strong className="text-emerald-400">{igsOrbitInfo.accuracyEstimate}</strong>
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <a
              href={igsOrbitInfo.cddisUrl}
              target="_blank"
              rel="noreferrer"
              className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-600 rounded-lg text-[11px] font-semibold flex items-center gap-1"
            >
              <span>CDDIS (NASA)</span>
              <ExternalLink className="w-3 h-3 text-slate-400" />
            </a>
            <a
              href={igsOrbitInfo.ignUrl}
              target="_blank"
              rel="noreferrer"
              className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-600 rounded-lg text-[11px] font-semibold flex items-center gap-1"
            >
              <span>IGN (Fransa)</span>
              <ExternalLink className="w-3 h-3 text-slate-400" />
            </a>
            <a
              href={igsOrbitInfo.bkgUrl}
              target="_blank"
              rel="noreferrer"
              className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-600 rounded-lg text-[11px] font-semibold flex items-center gap-1"
            >
              <span>BKG (Almanya)</span>
              <ExternalLink className="w-3 h-3 text-slate-400" />
            </a>
          </div>
        </div>
      )}

      {/* Empty State */}
      {sortedStations.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm border border-dashed border-slate-300 p-12 text-center space-y-4">
          <div className="w-14 h-14 bg-sky-50 text-sky-600 rounded-full flex items-center justify-center mx-auto">
            <Radio className="w-7 h-7" />
          </div>
          <div className="space-y-1">
            <h3 className="text-base font-bold text-slate-800">Yüklü Nokta ve RINEX Verisi Bulunmuyor</h3>
            <p className="text-xs text-slate-500 max-w-xl mx-auto leading-relaxed">
              Ölçülerinize ait <code>.o, .g, .n</code> veya <code>.obs</code> uzantılı RINEX gözlem ve navigasyon dosyalarını 
              yukarıdaki <strong>Rover RINEX Yükle</strong> veya <strong>TUSAGA RINEX Yükle</strong> butonlarından ekleyiniz.
            </p>
          </div>

          <div className="pt-2 flex items-center justify-center gap-3">
            <label className="px-5 py-2.5 text-xs font-bold bg-sky-600 hover:bg-sky-700 text-white rounded-xl shadow-sm transition cursor-pointer inline-flex items-center gap-2">
              <Upload className="w-4 h-4" />
              <span>Dengelenecek Rover Yükle</span>
              <input
                type="file"
                multiple
                accept=".o,.g,.n,.24o,.25o,.26o,.27o,.28o,.29o,.30o,.rnx,.crx,.obs,.nav"
                onChange={handleRoverUpload}
                className="hidden"
              />
            </label>
            <label className="px-5 py-2.5 text-xs font-bold bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl shadow-sm transition cursor-pointer inline-flex items-center gap-2">
              <ShieldCheck className="w-4 h-4" />
              <span>TUSAGA Sabit Yükle</span>
              <input
                type="file"
                multiple
                accept=".o,.g,.n,.24o,.25o,.26o,.27o,.28o,.29o,.30o,.rnx,.crx,.obs,.nav"
                onChange={handleTusagaUpload}
                className="hidden"
              />
            </label>
          </div>
        </div>
      ) : (
        /* Full Width Station Table */
        <div className="w-full bg-white rounded-xl shadow-sm border border-slate-200 p-5 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-3">
            <div className="flex items-center gap-2">
              <Radio className="w-4 h-4 text-sky-600" />
              <h3 className="text-sm font-bold text-slate-900">
                Gözlem ve İstasyon Listesi ({sortedStations.length} Nokta: {roverStations.length} Rover, {corsStations.length} CORS)
              </h3>
            </div>
            <div className="flex items-center gap-2 text-xs text-slate-500 font-medium">
              <span className="flex items-center gap-1">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" /> TUSAGA Sabit
              </span>
              <span className="flex items-center gap-1 ml-2">
                <span className="w-2.5 h-2.5 rounded-full bg-sky-500" /> Dengelenecek Rover
              </span>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-50 text-slate-700 font-semibold border-b border-slate-200 whitespace-nowrap">
                  <th className="py-2.5 px-3">Nokta Adı</th>
                  <th className="py-2.5 px-3 text-center">Nokta Tipi</th>
                  <th className="py-2.5 px-3 text-right">Y (Sağa - m)</th>
                  <th className="py-2.5 px-3 text-right">X (Yukarı - m)</th>
                  <th className="py-2.5 px-3 text-right">Z (Elip. H - m)</th>
                  <th className="py-2.5 px-3">GNSS Anteni</th>
                  <th className="py-2.5 px-3 text-right">Alet Yük. (m)</th>
                  <th className="py-2.5 px-3 text-center">Yük. Tipi</th>
                  <th className="py-2.5 px-3 text-center">Epok Hızları (Vx, Vy, Vz)</th>
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
                            isFixed || st.type === 'CORS'
                              ? 'bg-emerald-500 ring-2 ring-emerald-200'
                              : 'bg-sky-500 ring-2 ring-sky-200'
                          }`}
                        />
                        <span>{st.name}</span>
                      </td>

                      {/* 2. Nokta Tipi */}
                      <td className="py-2.5 px-3 text-center whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => handleToggleFixed(st.id)}
                          className={`px-2 py-0.5 rounded text-[10px] font-bold border cursor-pointer transition ${
                            isFixed || st.type === 'CORS'
                              ? 'bg-emerald-100 text-emerald-800 border-emerald-300'
                              : 'bg-sky-100 text-sky-800 border-sky-300'
                          }`}
                          title="Tıklandığında Sabit / Ara Nokta tipini değiştirir"
                        >
                          {isFixed || st.type === 'CORS' ? 'TUSAGA Sabit' : 'Ara Nokta (Rover)'}
                        </button>
                      </td>

                      {/* 3. Y (Sağa Değer) */}
                      <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-800 whitespace-nowrap">
                        {(st.projY || 0).toFixed(3)}
                      </td>

                      {/* 4. X (Yukarı Değer) */}
                      <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-800 whitespace-nowrap">
                        {(st.projX || 0).toFixed(3)}
                      </td>

                      {/* 5. Z (Elipsoidal Kot - Zemin) */}
                      <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-800 whitespace-nowrap">
                        {(st.h || 0).toFixed(3)}
                      </td>

                      {/* 6. GNSS Anteni */}
                      <td className="py-2.5 px-3 whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          {hasValidAntenna ? (
                            <button
                              onClick={() => handleOpenAntennaModalForStation(st.id)}
                              className="font-mono text-xs font-bold text-sky-700 hover:text-sky-900 underline decoration-sky-300 cursor-pointer"
                              title="Anten modelini değiştir / NOAA Kataloğu"
                            >
                              {getShortAntennaName(matchedCal?.displayName || st.antenna?.model)}
                            </button>
                          ) : (
                            <button
                              onClick={() => handleOpenAntennaModalForStation(st.id)}
                              className="px-2 py-0.5 bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-300 rounded text-[10px] font-bold cursor-pointer inline-flex items-center gap-1"
                            >
                              <span>Anten Seç</span>
                            </button>
                          )}

                          <label
                            className="p-1 hover:bg-slate-100 text-slate-400 hover:text-sky-600 rounded cursor-pointer transition"
                            title="Bu noktaya özel .atx anten kalibrasyon dosyası yükle"
                          >
                            <FileCode className="w-3.5 h-3.5" />
                            <input
                              type="file"
                              accept=".atx,.ATX"
                              onChange={(e) => handleSingleAtxUpload(st.id, e)}
                              className="hidden"
                            />
                          </label>
                        </div>
                      </td>

                      {/* 7. Alet Yüksekliği */}
                      <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-800 whitespace-nowrap">
                        {(st.antenna?.measuredHeight || 0).toFixed(3)}
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

                      {/* 9. Epok Hızları */}
                      <td className="py-2.5 px-3 text-center whitespace-nowrap">
                        <button
                          onClick={() => handleOpenVelocityModal(st.id)}
                          className="font-mono text-[11px] text-purple-700 hover:text-purple-900 bg-purple-50 hover:bg-purple-100 border border-purple-200 px-2 py-0.5 rounded cursor-pointer font-bold"
                          title="Tektonik plaka hızlarını düzenle"
                        >
                          {(st.velocities?.vx * 1000).toFixed(1)}, {(st.velocities?.vy * 1000).toFixed(1)}, {(st.velocities?.vz * 1000).toFixed(1)} mm/yıl
                        </button>
                      </td>

                      {/* 10. GPS Week Day */}
                      <td className="py-2.5 px-3 text-center font-mono font-bold text-slate-800 whitespace-nowrap">
                        <span className="bg-slate-100 text-slate-800 border border-slate-200 px-2 py-0.5 rounded text-[11px]">
                          {gpsWeekDayStr}
                        </span>
                      </td>

                      {/* 11. Başlangıç Zamanı */}
                      <td className="py-2.5 px-3 font-mono text-[11px] text-slate-700 whitespace-nowrap">
                        {adjustDateStringToTimeZone(st.occupation?.firstEpochDate || st.observationDateStr, timeZone)}
                      </td>

                      {/* 12. Bitiş Zamanı */}
                      <td className="py-2.5 px-3 font-mono text-[11px] text-slate-700 whitespace-nowrap">
                        {adjustDateStringToTimeZone(st.occupation?.lastEpochDate, timeZone)}
                      </td>

                      {/* 13. İşlem */}
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
      {/* 2. STATION PROPERTIES EDIT POPUP MODAL */}
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

      {/* ========================================================================= */}
      {/* 3. TUSAGA 2005 EPOCH VELOCITY MODAL */}
      {/* ========================================================================= */}
      {isVelocityModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full overflow-hidden animate-in fade-in duration-150">
            <div className="p-5 border-b border-slate-200 bg-slate-900 text-white flex items-center justify-between">
              <div className="flex items-center gap-2">
                <TrendingUp className="w-5 h-5 text-purple-400" />
                <h3 className="font-bold text-base">
                  {editingVelocityStationId
                    ? `Tektonik Hız Düzenle: ${stations[editingVelocityStationId]?.name}`
                    : 'Tüm İstasyonlar İçin Tektonik Plaka Hızları'}
                </h3>
              </div>
              <button
                onClick={() => setIsVelocityModalOpen(false)}
                className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-4 text-xs">
              <p className="text-slate-600 leading-relaxed">
                TUREF / ITRF96 (2005.00) epoğu ile ölçü anı ($t = {surveyEpoch.toFixed(2)}$) arasındaki 
                koordinat ötelemesi için kartezyen ECEF ($V_x, V_y, V_z$) veya topomerkez ($V_e, V_n, V_u$) hız değerlerini giriniz:
              </p>

              <div className="space-y-3 bg-purple-50/60 p-4 rounded-xl border border-purple-200">
                <h4 className="font-bold text-purple-950">Kartezyen ECEF Hızları (m/yıl)</h4>
                <div className="grid grid-cols-3 gap-2 font-mono">
                  <div>
                    <label className="block text-slate-600 text-[11px] mb-1 font-sans">Vx (m/yıl)</label>
                    <input
                      type="number"
                      step="0.0001"
                      value={tempVx}
                      onChange={(e) => setTempVx(parseFloat(e.target.value) || 0)}
                      className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg bg-white font-bold"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-600 text-[11px] mb-1 font-sans">Vy (m/yıl)</label>
                    <input
                      type="number"
                      step="0.0001"
                      value={tempVy}
                      onChange={(e) => setTempVy(parseFloat(e.target.value) || 0)}
                      className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg bg-white font-bold"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-600 text-[11px] mb-1 font-sans">Vz (m/yıl)</label>
                    <input
                      type="number"
                      step="0.0001"
                      value={tempVz}
                      onChange={(e) => setTempVz(parseFloat(e.target.value) || 0)}
                      className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg bg-white font-bold"
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-3 bg-slate-50 p-4 rounded-xl border border-slate-200">
                <h4 className="font-bold text-slate-800">Yerel Toposentrik Hızlar (mm/yıl)</h4>
                <div className="grid grid-cols-3 gap-2 font-mono">
                  <div>
                    <label className="block text-slate-600 text-[11px] mb-1 font-sans">Ve (Doğu - mm/yıl)</label>
                    <input
                      type="number"
                      step="0.1"
                      value={tempVe}
                      onChange={(e) => setTempVe(parseFloat(e.target.value) || 0)}
                      className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg bg-white"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-600 text-[11px] mb-1 font-sans">Vn (Kuzey - mm/yıl)</label>
                    <input
                      type="number"
                      step="0.1"
                      value={tempVn}
                      onChange={(e) => setTempVn(parseFloat(e.target.value) || 0)}
                      className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg bg-white"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-600 text-[11px] mb-1 font-sans">Vu (Düşey - mm/yıl)</label>
                    <input
                      type="number"
                      step="0.1"
                      value={tempVu}
                      onChange={(e) => setTempVu(parseFloat(e.target.value) || 0)}
                      className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg bg-white"
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="p-4 bg-slate-50 border-t border-slate-200 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsVelocityModalOpen(false)}
                className="px-4 py-2 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-100 font-semibold cursor-pointer"
              >
                İptal
              </button>
              <button
                type="button"
                onClick={handleSaveVelocityModal}
                className="px-5 py-2 rounded-lg bg-purple-700 hover:bg-purple-800 text-white font-bold shadow-sm transition cursor-pointer flex items-center gap-1.5"
              >
                <Save className="w-4 h-4" />
                <span>Hızları Kaydet</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 4. NOAA ANTCAL SELECTION MODAL */}
      {/* ========================================================================= */}
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
