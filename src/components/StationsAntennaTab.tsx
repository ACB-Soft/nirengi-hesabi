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

import React, { useState, useMemo, useEffect } from 'react';
import {
  Station,
  BaselineVector,
  AntennaHeightType,
  StationType,
  IgsOrbitInfo,
  IgsSp3File,
  JobConfig,
} from '../types/gnss';
import { JobConfigTab } from './JobConfigTab';
import { QcSkyplotTab } from './QcSkyplotTab';
import {
  calculateCorrectedAntennaHeight,
  calculateAntennaPhaseCenterHeight,
  parseRinexHeader,
  parseAntexFile,
  getGpsWeekDay,
  getShortAntennaName,
  adjustDateStringToTimeZone,
  getIgsProductDetails,
  parseIgsSp3File,
  computeStationCoordinates,
  ecefToGeodetic,
  geodeticToEcef,
  geodeticToTM,
  tmToGeodetic,
} from '../utils/geodesy';
import {
  NOAA_ANTCAL_CATALOG,
  NoaaAntennaCalibration,
  matchAntennaInNoaaCatalog,
} from '../data/noaaAntcal';
import { OccupationViewTab } from './OccupationViewTab';
import { parseRinexFile, createStationFromSummary } from '../utils/rinexStreamParser';
import { saveRinexFileToOpfs } from '../utils/opfsStorage';
import {
  parseAntexContent,
  saveMultipleCustomAntennas,
  saveCustomAntenna,
  getCustomAntennaCatalog,
  getAllKnownAntennas,
  findAntennaInCatalog,
  isStationAntennaCalibrated,
  getUncalibratedStations,
} from '../utils/antennaCatalogManager';
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
  Globe2,
  Database,
  Info,
  FileCode,
  Sparkles,
  Table,
  FileSpreadsheet,
  Settings,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
} from 'lucide-react';

interface Props {
  stations: Record<string, Station>;
  baselines?: BaselineVector[];
  dom?: number;
  timeZone?: string;
  elevationMask?: number;
  config?: JobConfig;
  onChangeConfig?: (newConfig: JobConfig) => void;
  onResetConfigDefaults?: () => void;
  onUpdateStation: (station: Station) => void;
  onAddStation: (station: Station) => void;
  onDeleteStation: (id: string) => void;
  onClearAllStations: () => void;
  onNavigateTab?: (tab: string) => void;
}

export const StationsAntennaTab: React.FC<Props> = ({
  stations,
  baselines = [],
  dom = 30,
  timeZone = 'GMT+03:00',
  elevationMask = 10,
  config,
  onChangeConfig,
  onResetConfigDefaults,
  onUpdateStation,
  onAddStation,
  onDeleteStation,
  onClearAllStations,
  onNavigateTab,
}) => {
  const [isConfigOpen, setIsConfigOpen] = useState(false);
  const [isQcModalOpen, setIsQcModalOpen] = useState(false);
  const [qcSelectedStationId, setQcSelectedStationId] = useState<string>('');

  useEffect(() => {
    if (!isQcModalOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsQcModalOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isQcModalOpen]);
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
      if (st.observationDateStr) {
        const d = new Date(st.observationDateStr.replace(' GPS', ''));
        if (!isNaN(d.getTime())) return d.getFullYear() + (d.getMonth() + 1) / 12;
      }
    }
    return 2026.0;
  }, [sortedStations]);

  const igsOrbitInfo: IgsOrbitInfo | null = useMemo(() => {
    if (!earliestObsDateStr && !earliestEpochDecimal) return null;
    return getIgsProductDetails(earliestObsDateStr, earliestEpochDecimal);
  }, [earliestObsDateStr, earliestEpochDecimal]);

  const [catalogVersion, setCatalogVersion] = useState(0);

  // Uncalibrated stations list (stations with isCalibrated === false or missing calibration)
  const uncalibratedStations = useMemo(() => {
    return getUncalibratedStations(sortedStations);
  }, [sortedStations, catalogVersion]);

  // All known antennas (Built-in NOAA ANTCAL + User-Uploaded Custom ATX)
  const allKnownAntennas = useMemo(() => {
    return getAllKnownAntennas();
  }, [catalogVersion]);

  const manufacturers = useMemo(
    () => Array.from(new Set(allKnownAntennas.map((a) => a.manufacturer))).sort(),
    [allKnownAntennas]
  );

  const modalFilteredAntennas = useMemo(() => {
    return allKnownAntennas.filter((ant) => {
      const matchesMan = modalManufacturer === 'ALL' || ant.manufacturer === modalManufacturer;
      const matchesCat = modalCategory === 'ALL' || ant.category === modalCategory;
      const matchesQuery =
        modalSearchQuery === '' ||
        ant.model.toLowerCase().includes(modalSearchQuery.toLowerCase()) ||
        ant.displayName.toLowerCase().includes(modalSearchQuery.toLowerCase()) ||
        ant.manufacturer.toLowerCase().includes(modalSearchQuery.toLowerCase());
      return matchesMan && matchesCat && matchesQuery;
    });
  }, [allKnownAntennas, modalManufacturer, modalCategory, modalSearchQuery]);

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

    const isSlant = editHeightType === 'slant';
    const effectiveOffset = isSlant ? editOffset : 0;
    const corrected = calculateCorrectedAntennaHeight(
      editHeightType,
      editMeasuredH,
      editRadius,
      effectiveOffset
    );

    const pcoL1_u = editStation.antenna?.pcoL1?.u ?? 89.35;
    const pcoL2_u = editStation.antenna?.pcoL2?.u ?? 117.76;
    const apcCalc = calculateAntennaPhaseCenterHeight(
      editHeightType,
      editMeasuredH,
      editRadius,
      effectiveOffset,
      pcoL1_u,
      pcoL2_u,
      'L3'
    );
    const baseGroundH = editStation.groundH ?? editStation.h;

    const updated: Station = {
      ...editStation,
      name: editName.trim() || editStation.name,
      groundH: baseGroundH,
      arpH: Number((baseGroundH + apcCalc.hArp).toFixed(4)),
      apcH: Number((baseGroundH + apcCalc.hApcL3).toFixed(4)),
      antenna: {
        ...editStation.antenna,
        measuredHeight: editMeasuredH,
        heightType: editHeightType,
        radius: isSlant ? editRadius : 0,
        verticalOffset: effectiveOffset,
        correctedHeight: corrected,
      },
    };

    onUpdateStation(updated);
    setEditStation(null);
    setUploadFeedback(`"${updated.name}" nokta özellikleri ve alet yüksekliği güncellendi.`);
  };

  /**
   * Generalized RINEX File Upload (High-Performance Chunk Streaming & OPFS)
   */
  const processRinexFiles = async (files: FileList | File[], forcedType?: 'GROUND' | 'CORS') => {
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

      try {
        const summary = await parseRinexFile(file, dom);
        if (summary) {
          importedCount++;
          // Save to local OPFS in background without blocking
          saveRinexFileToOpfs(file).catch(() => {});

          const finalStation = createStationFromSummary(summary, {
            dom,
            forcedType,
          });

          onAddStation(finalStation);

          const matched = matchAntennaInNoaaCatalog(finalStation.antenna?.model || '');

          setUploadFeedback(
            `RINEX verisi (${file.name}) aktarıldı: "${finalStation.name}" [${(forcedType || summary.detectedPointType) === 'CORS' ? 'TUSAGA Sabit' : 'Dengelenecek Ara Nokta'}] eklendi. ${
              matched
                ? `[Anten: ${matched.displayName}]`
                : `[Anten: ${finalStation.antenna?.model || '-'}]`
            }`
          );
        }
      } catch (err) {
        console.error('RINEX parsing error for:', file.name, err);
      }
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
   * Process and save uploaded ATX files to permanent custom catalog and update affected stations
   */
  const processAtxFiles = async (files: FileList | File[], targetStationId?: string) => {
    if (!files || files.length === 0) return;

    const allParsed: NoaaAntennaCalibration[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      try {
        let text = '';
        if (file.name.toLowerCase().endsWith('.gz') || file.type.includes('gzip')) {
          const ds = new DecompressionStream('gzip');
          const stream = file.stream().pipeThrough(ds);
          text = await new Response(stream).text();
        } else {
          text = await file.text();
        }

        if (text) {
          const parsed = parseAntexContent(text);
          allParsed.push(...parsed);
        }
      } catch (err: any) {
        console.error('ATX dosya okuma hatası:', file.name, err);
      }
    }

    if (allParsed.length === 0) {
      setUploadFeedback('Geçerli bir ANTEX (.atx) anten kalibrasyon parametresi tespit edilemedi.');
      return;
    }

    // CRITICAL: Save all newly uploaded antennas to persistent catalog (localStorage)
    const stats = saveMultipleCustomAntennas(allParsed);
    setCatalogVersion((v) => v + 1);

    // Now update stations with new calibrations
    const updatedStationNames: string[] = [];

    // If targetStationId specified, calibrate that specific station
    if (targetStationId && stations[targetStationId]) {
      const st = stations[targetStationId];
      let calMatch: NoaaAntennaCalibration | undefined = allParsed.find(
        (a) => a.model.trim().toUpperCase() === (st.antenna?.model || st.antenna?.rawRinexModel || '').trim().toUpperCase()
      );
      if (!calMatch && allParsed.length === 1) {
        calMatch = allParsed[0];
      }
      if (!calMatch) {
        const found = findAntennaInCatalog(st.antenna?.model || st.antenna?.rawRinexModel || '');
        if (found) calMatch = found.calibration;
      }

      if (calMatch) {
        const isSlant = st.antenna?.heightType === 'slant';
        const effectiveOffset = isSlant ? (calMatch.verticalOffset || 0) : 0;
        const corrected = calculateCorrectedAntennaHeight(
          st.antenna?.heightType || 'vertical',
          st.antenna?.measuredHeight || 0,
          calMatch.radius,
          effectiveOffset
        );
        const apcCalc = calculateAntennaPhaseCenterHeight(
          st.antenna?.heightType || 'vertical',
          st.antenna?.measuredHeight || 0,
          calMatch.radius,
          effectiveOffset,
          calMatch.pcoL1?.u ?? 89.35,
          calMatch.pcoL2?.u ?? 117.76,
          'L3'
        );
        const baseGroundH = st.groundH ?? st.h;

        const updated: Station = {
          ...st,
          groundH: baseGroundH,
          arpH: Number((baseGroundH + apcCalc.hArp).toFixed(4)),
          apcH: Number((baseGroundH + apcCalc.hApcL3).toFixed(4)),
          antenna: {
            ...st.antenna,
            model: calMatch.model,
            radius: calMatch.radius,
            verticalOffset: effectiveOffset,
            correctedHeight: corrected,
            pcoL1: calMatch.pcoL1,
            pcoL2: calMatch.pcoL2,
            pcvZenith: calMatch.pcvZenith,
            isCalibrated: true,
            calibrationSource: 'CUSTOM_ATX',
          },
        };
        onUpdateStation(updated);
        updatedStationNames.push(updated.name);
      }
    }

    // Check all other stations that are uncalibrated or match newly added models
    for (const st of Object.values(stations)) {
      if (targetStationId && st.id === targetStationId) continue;
      const isCurrentlyCal = isStationAntennaCalibrated(st);
      if (!isCurrentlyCal) {
        const matchRes = findAntennaInCatalog(st.antenna?.model || st.antenna?.rawRinexModel || st.name);
        if (matchRes) {
          const cal = matchRes.calibration;
          const isSlant = st.antenna?.heightType === 'slant';
          const effectiveOffset = isSlant ? (cal.verticalOffset || 0) : 0;
          const corrected = calculateCorrectedAntennaHeight(
            st.antenna?.heightType || 'vertical',
            st.antenna?.measuredHeight || 0,
            cal.radius,
            effectiveOffset
          );
          const apcCalc = calculateAntennaPhaseCenterHeight(
            st.antenna?.heightType || 'vertical',
            st.antenna?.measuredHeight || 0,
            cal.radius,
            effectiveOffset,
            cal.pcoL1?.u ?? 89.35,
            cal.pcoL2?.u ?? 117.76,
            'L3'
          );
          const baseGroundH = st.groundH ?? st.h;

          const updated: Station = {
            ...st,
            groundH: baseGroundH,
            arpH: Number((baseGroundH + apcCalc.hArp).toFixed(4)),
            apcH: Number((baseGroundH + apcCalc.hApcL3).toFixed(4)),
            antenna: {
              ...st.antenna,
              model: cal.model,
              radius: cal.radius,
              verticalOffset: effectiveOffset,
              correctedHeight: corrected,
              pcoL1: cal.pcoL1,
              pcoL2: cal.pcoL2,
              pcvZenith: cal.pcvZenith,
              isCalibrated: true,
              calibrationSource: matchRes.source,
            },
          };
          onUpdateStation(updated);
          updatedStationNames.push(updated.name);
        }
      }
    }

    setUploadFeedback(
      `${allParsed.length} adet ANTEX anten kalibrasyon modeli ayrıştırıldı ve kataloga kalıcı olarak kaydedildi (${stats.total} toplam anten). ${
        updatedStationNames.length > 0
          ? `[${updatedStationNames.join(', ')}] noktaları başarıyla kalibre edildi.`
          : 'Mevcut ağda eşleşen noktalar güncellendi.'
      }`
    );
  };

  const handleBatchAtxUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      processAtxFiles(e.target.files);
      e.target.value = '';
    }
  };

  const handleSingleAtxUpload = (stationId: string, e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      processAtxFiles(e.target.files, stationId);
      e.target.value = '';
    }
  };

  /**
   * Handle SP3 Precise Orbit File Upload (supports .sp3, .eph, and .gz / .SP3.gz)
   */
  const handleSp3Upload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      let text = '';
      if (file.name.toLowerCase().endsWith('.gz') || file.type.includes('gzip')) {
        // Native browser decompression of .gz / .SP3.gz files
        const ds = new DecompressionStream('gzip');
        const stream = file.stream().pipeThrough(ds);
        text = await new Response(stream).text();
      } else {
        text = await file.text();
      }

      if (!text) {
        setUploadFeedback('Dosya içeriği boş veya okunamadı.');
        return;
      }

      const parsed = parseIgsSp3File(text, file.name);
      if (parsed) {
        setLoadedSp3File(parsed);
        setUploadFeedback(
          `IGS Hassas Yörünge Dosyası (.SP3) yüklendi: ${file.name} (Hafta: ${parsed.gpsWeek}-${parsed.dayOfWeek}, ${parsed.satelliteCount} Uydu, ${parsed.epochCount} Epok). AUSPOS / Bernese düzeyinde hassasiyet aktif.`
        );
      } else {
        setUploadFeedback('Geçerli bir IGS .SP3 hassas yörünge dosyası formatı tespit edilemedi.');
      }
    } catch (err: any) {
      setUploadFeedback(`SP3 dosyası okunurken hata oluştu: ${err?.message || err}`);
    }
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
    const isSlant = targetSt.antenna.heightType === 'slant';
    const effectiveOffset = isSlant ? (ant.verticalOffset || 0) : 0;
    const corrected = calculateCorrectedAntennaHeight(
      targetSt.antenna.heightType,
      targetSt.antenna.measuredHeight,
      ant.radius,
      effectiveOffset
    );

    const pcoL1_u = ant.pcoL1?.u ?? 89.35;
    const pcoL2_u = ant.pcoL2?.u ?? 117.76;
    const apcCalc = calculateAntennaPhaseCenterHeight(
      targetSt.antenna?.heightType || 'vertical',
      targetSt.antenna?.measuredHeight || 0,
      ant.radius,
      effectiveOffset,
      pcoL1_u,
      pcoL2_u,
      'L3'
    );
    const baseGroundH = targetSt.groundH ?? targetSt.h;

    const updated: Station = {
      ...targetSt,
      groundH: baseGroundH,
      arpH: Number((baseGroundH + apcCalc.hArp).toFixed(4)),
      apcH: Number((baseGroundH + apcCalc.hApcL3).toFixed(4)),
      antenna: {
        ...targetSt.antenna,
        model: ant.model,
        radius: ant.radius,
        verticalOffset: effectiveOffset,
        correctedHeight: corrected,
        pcoL1: ant.pcoL1,
        pcoL2: ant.pcoL2,
        pcvZenith: ant.pcvZenith,
        isCalibrated: true,
        calibrationSource: getCustomAntennaCatalog().some((c) => c.model.trim().toUpperCase() === ant.model.trim().toUpperCase())
          ? 'CUSTOM_ATX'
          : 'BUILTIN',
      },
    };

    onUpdateStation(updated);
    setUploadFeedback(`"${targetSt.name}" noktasına anten kalibrasyonu atandı: ${ant.displayName}`);
  };



  return (
    <div className="space-y-6">
      {/* 1. Proje Ayarları ve Jeodezik Parametreler (Birleştirilmiş Bölüm) */}
      {config && onChangeConfig && (
        <div className="bg-white rounded-xl shadow-xs border border-slate-200 overflow-hidden">
          <div className="p-4 sm:p-5 flex flex-col md:flex-row md:items-center justify-between gap-4 bg-slate-50 border-b border-slate-200">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-sky-100 text-sky-700 flex items-center justify-center shrink-0">
                <Settings className="w-5 h-5" />
              </div>
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="text-sm sm:text-base font-bold text-slate-900">
                    Proje Ayarları ve Jeodezik Parametreler
                  </h2>
                  <span className="text-[11px] font-semibold bg-sky-100 text-sky-800 px-2.5 py-0.5 rounded-full border border-sky-200">
                    {config.crsSystem} (DOM: {config.dom}°)
                  </span>
                </div>
                <p className="text-xs text-slate-500 mt-0.5">
                  Proje: <strong className="text-slate-800">{config.projectName || 'Tanımsız Proje'}</strong> • Hesaplayan: <strong className="text-slate-800">{config.surveyor || '-'}</strong> • Zaman Dilimi: <strong className="text-slate-800">{config.timeZone}</strong> • Elipsoit: <strong className="text-slate-800">GRS80</strong>
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setIsConfigOpen(!isConfigOpen)}
                className="px-3.5 py-2 text-xs font-semibold bg-white hover:bg-slate-100 text-slate-700 rounded-lg border border-slate-300 transition cursor-pointer flex items-center gap-1.5 shadow-2xs"
              >
                <Sliders className="w-3.5 h-3.5 text-sky-600" />
                <span>{isConfigOpen ? 'Proje Ayarlarını Kapat' : 'Proje Ayarlarını Düzenle'}</span>
                {isConfigOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>

          {isConfigOpen && (
            <div className="p-5 border-t border-slate-200 bg-slate-50/50">
              <JobConfigTab
                config={config}
                onChange={onChangeConfig}
                onResetDefaults={onResetConfigDefaults || (() => {})}
              />
            </div>
          )}
        </div>
      )}

      {/* Overview Header Banner */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h2 className="text-base sm:text-lg font-bold text-slate-900">
              İstasyonlar, RINEX ve Gözlem Verileri
            </h2>
            <p className="text-xs text-slate-500 mt-1">
              Rover ve TUSAGA sabit istasyonlarının RINEX gözlemleri, anten yükseklikleri ve IGS hassas yörünge verileri.
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => {
                if (!qcSelectedStationId || !stations[qcSelectedStationId]) {
                  setQcSelectedStationId(sortedStations[0]?.id || '');
                }
                setIsQcModalOpen(true);
              }}
              className="px-3.5 py-2 text-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg shadow-xs transition cursor-pointer flex items-center gap-1.5"
              title="Oturum görünümü (Occupation View), Skyplot ve SNR Kalite Kontrol penceresini aç"
            >
              <Compass className="w-3.5 h-3.5 text-indigo-100" />
              <span>Kalite Kontrol (QC)</span>
            </button>

            <button
              onClick={() => {
                setAntennaModalStationId('');
                setIsAntennaModalOpen(true);
              }}
              className="px-3 py-2 text-xs font-semibold bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 rounded-lg shadow-2xs transition cursor-pointer flex items-center gap-1.5"
              title="NOAA ANTCAL ve özel yüklenen anten kalibrasyon kataloğunu görüntüle"
            >
              <FileCode className="w-3.5 h-3.5 text-sky-600" />
              <span>ATX Anten Kataloğu ({allKnownAntennas.length})</span>
            </button>

            {sortedStations.length > 0 && (
              <>

                <button
                  onClick={onClearAllStations}
                  className="px-3 py-2 text-xs font-semibold bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-300 rounded-lg transition cursor-pointer flex items-center gap-1.5"
                  title="Tüm noktaları ve verileri temizle"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Temizle</span>
                </button>
              </>
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

      {/* Fail-Safe ANTEX Protection Warning Banner */}
      {uncalibratedStations.length > 0 && (
        <div className="bg-rose-50 border-2 border-rose-400 rounded-2xl p-5 shadow-sm text-rose-950 space-y-3.5 animate-in fade-in">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex items-start gap-3.5">
              <div className="w-11 h-11 rounded-xl bg-rose-600 text-white flex items-center justify-center shrink-0 shadow-sm">
                <AlertTriangle className="w-6 h-6 text-white animate-pulse" />
              </div>
              <div className="space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="text-base font-extrabold text-rose-950">
                    DİKKAT: {uncalibratedStations.length} İstasyonun ANTEX Anten Kalibrasyonu Eksik!
                  </h3>
                  <span className="text-xs bg-rose-200 text-rose-900 border border-rose-300 px-2.5 py-0.5 rounded-full font-bold">
                    Baz Çözümü &amp; Dengeleme Bloke Edildi
                  </span>
                </div>
                <p className="text-xs text-rose-800 leading-relaxed max-w-3xl">
                  Aşağıdaki istasyonların RINEX başlığında kayıtlı anten modelleri için faz merkezi ofsetleri (PCO/PCV) mutlak kalibrasyon veritabanında bulunamamıştır.
                  Anten kalibrasyonu olmadan yapılacak baz çözümü ve ağ dengelemesi <strong>5–15 cm düşey kota hatasına</strong> yol açacağından BÖHYY &amp; IGS standartları gereğince işlem engellenmiştir.
                </p>
              </div>
            </div>

            <div className="shrink-0 flex items-center gap-2">
              <label className="px-4 py-2.5 bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs rounded-xl shadow-sm transition flex items-center gap-2 cursor-pointer active:scale-95">
                <Upload className="w-4 h-4 text-white" />
                <span>Anten ATX Dosyası Yükle (.atx / .txt)</span>
                <input
                  type="file"
                  accept=".atx,.txt,.atx.gz,.ATX,.TXT"
                  multiple
                  onChange={handleBatchAtxUpload}
                  className="hidden"
                />
              </label>
            </div>
          </div>

          {/* List of uncalibrated stations */}
          <div className="pt-2 border-t border-rose-200/80 flex items-center gap-2 flex-wrap text-xs">
            <span className="font-bold text-rose-900">Eksik Kalibrasyonlu Noktalar:</span>
            {uncalibratedStations.map((st) => (
              <div
                key={st.id}
                className="bg-white border border-rose-300 px-3 py-1.5 rounded-lg text-xs font-mono font-bold text-rose-950 flex items-center gap-2 shadow-2xs"
              >
                <span className="text-rose-600">●</span>
                <span>{st.name}</span>
                <span className="text-[11px] text-slate-500 font-sans font-normal">
                  [{st.antenna?.model || st.antenna?.rawRinexModel || 'Model Belirtilmemiş'}]
                </span>
                <button
                  type="button"
                  onClick={() => handleOpenAntennaModalForStation(st.id)}
                  className="text-[11px] text-sky-700 hover:text-sky-950 font-sans font-bold underline cursor-pointer ml-1"
                >
                  Katalogdan Ata
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 3 Main Action Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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

        {/* Card 3: IGS Hassas Yörünge (.SP3) ve Uydu Saatleri (.CLK) */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 flex flex-col justify-between hover:border-amber-300 transition">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="w-8 h-8 rounded-lg bg-amber-100 text-amber-800 flex items-center justify-center font-bold text-xs">
                3
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
              <span>{loadedSp3File ? '.SP3 Değiştir' : '.SP3 / .gz Yükle'}</span>
              <input
                type="file"
                accept=".sp3,.eph,.clk,.SP3,.gz,.Z"
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
                title={`NASA EarthData (CDDIS) ${igsOrbitInfo.productName} indir`}
              >
                <Download className="w-3 h-3 text-amber-700" />
                <span>EarthData İndir</span>
              </a>
            )}
          </div>
        </div>
      </div>

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

          <div className="pt-2 flex flex-wrap items-center justify-center gap-3">
            <label className="px-5 py-2.5 text-xs font-bold bg-sky-600 hover:bg-sky-700 text-white rounded-xl shadow-xs transition cursor-pointer inline-flex items-center gap-2">
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
            <label className="px-5 py-2.5 text-xs font-bold bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl shadow-xs transition cursor-pointer inline-flex items-center gap-2">
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
        <>
          {/* Full Width Station Table */}
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
                  <th className="py-2.5 px-3 text-center">GPS Week Day</th>
                  <th className="py-2.5 px-3 text-left">Başlangıç Zamanı</th>
                  <th className="py-2.5 px-3 text-left">Bitiş Zamanı</th>
                  <th className="py-2.5 px-3 text-center">İşlem</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {sortedStations.map((st) => {
                  const isFixed = st.isFixed.x && st.isFixed.y && st.isFixed.z;
                  const isCalibrated = isStationAntennaCalibrated(st);
                  const matchResult = findAntennaInCatalog(st.antenna?.model || st.antenna?.rawRinexModel || '');
                  const matchedCal = matchResult?.calibration || matchAntennaInNoaaCatalog(st.antenna?.model || '');

                  const gpsWeekDayStr = getGpsWeekDay(
                    st.occupation?.firstEpochDate || st.observationDateStr
                  );

                  return (
                    <tr
                      key={st.id}
                      className={`transition ${
                        !isCalibrated
                          ? 'bg-rose-50/60 hover:bg-rose-100/60 border-l-4 border-l-rose-500'
                          : 'hover:bg-slate-50/80'
                      }`}
                    >
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
                        {!isCalibrated ? (
                          <div className="flex flex-col gap-1 py-1">
                            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-rose-100 border border-rose-300 rounded-md text-rose-950 font-bold text-xs shadow-2xs">
                              <AlertTriangle className="w-3.5 h-3.5 text-rose-600 shrink-0 animate-pulse" />
                              <span className="truncate max-w-[170px]" title={st.antenna?.model || st.antenna?.rawRinexModel}>
                                {st.antenna?.model || st.antenna?.rawRinexModel || 'Tanımsız Anten'}
                              </span>
                            </div>
                            <div className="flex items-center gap-1.5 text-[10px]">
                              <span className="font-extrabold text-rose-800 bg-rose-200/90 px-1.5 py-0.5 rounded">
                                ATX EKSİK
                              </span>
                              <label
                                className="px-2 py-0.5 bg-rose-600 hover:bg-rose-700 text-white rounded font-bold cursor-pointer transition shadow-2xs inline-flex items-center gap-1"
                                title="Bu nokta için .atx kalibrasyon dosyası yükle"
                              >
                                <Upload className="w-2.5 h-2.5" />
                                <span>ATX Yükle</span>
                                <input
                                  type="file"
                                  accept=".atx,.txt,.atx.gz,.ATX,.TXT"
                                  onChange={(e) => handleSingleAtxUpload(st.id, e)}
                                  className="hidden"
                                />
                              </label>
                              <button
                                type="button"
                                onClick={() => handleOpenAntennaModalForStation(st.id)}
                                className="text-sky-700 hover:text-sky-950 underline font-semibold cursor-pointer"
                              >
                                Katalog
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex flex-col gap-0.5">
                            <div className="flex items-center gap-1.5">
                              <button
                                onClick={() => handleOpenAntennaModalForStation(st.id)}
                                className="font-mono text-xs font-bold text-sky-700 hover:text-sky-900 underline decoration-sky-300 cursor-pointer"
                                title="Anten modelini değiştir / NOAA Kataloğu"
                              >
                                {getShortAntennaName(matchedCal?.displayName || st.antenna?.model)}
                              </button>
                              <span
                                className={`px-1.5 py-0.5 rounded text-[9px] font-bold border inline-flex items-center gap-0.5 ${
                                  st.antenna?.calibrationSource === 'CUSTOM_ATX'
                                    ? 'bg-purple-100 text-purple-800 border-purple-300'
                                    : 'bg-emerald-100 text-emerald-800 border-emerald-300'
                                }`}
                              >
                                <Check className="w-2.5 h-2.5" />
                                <span>{st.antenna?.calibrationSource === 'CUSTOM_ATX' ? 'Özel ATX' : 'IGS/NOAA'}</span>
                              </span>
                              <label
                                className="p-1 hover:bg-slate-100 text-slate-400 hover:text-sky-600 rounded cursor-pointer transition"
                                title="Farklı bir .atx anten kalibrasyon dosyası yükle"
                              >
                                <FileCode className="w-3.5 h-3.5" />
                                <input
                                  type="file"
                                  accept=".atx,.txt,.atx.gz,.ATX,.TXT"
                                  onChange={(e) => handleSingleAtxUpload(st.id, e)}
                                  className="hidden"
                                />
                              </label>
                            </div>
                            <span className="text-[10px] text-slate-500 font-mono">
                              PCO Up: +{(st.antenna?.pcoL1?.u ?? 0).toFixed(1)} / +{(st.antenna?.pcoL2?.u ?? 0).toFixed(1)} mm
                            </span>
                          </div>
                        )}
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

                      {/* 9. GPS Week Day */}
                      <td className="py-2.5 px-3 text-center font-mono font-bold text-slate-800 whitespace-nowrap">
                        <span className="bg-slate-100 text-slate-800 border border-slate-200 px-2 py-0.5 rounded text-[11px]">
                          {gpsWeekDayStr}
                        </span>
                      </td>

                      {/* 10. Başlangıç Zamanı */}
                      <td className="py-2.5 px-3 font-mono text-[11px] text-slate-700 whitespace-nowrap">
                        {adjustDateStringToTimeZone(st.occupation?.firstEpochDate || st.observationDateStr, timeZone)}
                      </td>

                      {/* 11. Bitiş Zamanı */}
                      <td className="py-2.5 px-3 font-mono text-[11px] text-slate-700 whitespace-nowrap">
                        {adjustDateStringToTimeZone(st.occupation?.lastEpochDate, timeZone)}
                      </td>

                      {/* 12. İşlem */}
                      <td className="py-2.5 px-3 text-center whitespace-nowrap">
                        <div className="flex items-center justify-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => {
                              setQcSelectedStationId(st.id);
                              setIsQcModalOpen(true);
                            }}
                            className="px-2 py-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-300 rounded text-[11px] font-bold cursor-pointer flex items-center gap-1 transition"
                            title="Bu istasyon için Kalite Kontrol (Oturum, Skyplot, SNR) penceresini aç"
                          >
                            <Compass className="w-3.5 h-3.5 text-indigo-600" />
                            <span>QC</span>
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
        </>
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
                  <label className="block text-slate-600 font-medium mb-1">
                    Anten Yarıçapı R (m) {editHeightType === 'slant' && <span className="text-amber-700 font-bold">*</span>}
                  </label>
                  <input
                    type="number"
                    step="0.001"
                    value={editRadius}
                    onChange={(e) => setEditRadius(parseFloat(e.target.value) || 0)}
                    disabled={editHeightType === 'vertical'}
                    className={`w-full px-2.5 py-1.5 border rounded font-mono ${
                      editHeightType === 'vertical' ? 'bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed' : 'bg-white border-slate-300'
                    }`}
                  />
                  {editHeightType === 'vertical' && (
                    <span className="text-[10px] text-slate-400 mt-0.5 block">Düşey ölçüde yarıçap kullanılmaz</span>
                  )}
                </div>
                <div>
                  <label className="block text-slate-600 font-medium mb-1">
                    {editHeightType === 'slant' ? 'Çentik Düşey Ofseti Δh (m)' : 'İlave Düşey Ofset (m)'}
                  </label>
                  <input
                    type="number"
                    step="0.001"
                    value={editOffset}
                    onChange={(e) => setEditOffset(parseFloat(e.target.value) || 0)}
                    disabled={editHeightType === 'vertical'}
                    className={`w-full px-2.5 py-1.5 border rounded font-mono ${
                      editHeightType === 'vertical' ? 'bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed' : 'bg-white border-slate-300'
                    }`}
                  />
                  {editHeightType === 'vertical' && (
                    <span className="text-[10px] text-slate-400 mt-0.5 block">Düşeyde h_ARP = h_ölçü</span>
                  )}
                </div>
              </div>

              {/* Antenna Calibration Status in Edit Modal */}
              {(() => {
                const isCalibrated = isStationAntennaCalibrated(editStation);
                const matchResult = findAntennaInCatalog(editStation.antenna?.model || editStation.antenna?.rawRinexModel || '');

                return (
                  <div className={`p-3.5 rounded-xl border space-y-2 ${
                    isCalibrated
                      ? 'bg-emerald-50/70 border-emerald-300 text-emerald-950'
                      : 'bg-rose-50 border-2 border-rose-400 text-rose-950'
                  }`}>
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <div className="flex items-center gap-1.5 font-bold">
                        {isCalibrated ? (
                          <>
                            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                            <span>ANTEX Kalibrasyonlu Anten</span>
                          </>
                        ) : (
                          <>
                            <AlertTriangle className="w-4 h-4 text-rose-600 animate-pulse" />
                            <span>ANTEX Kalibrasyonu Eksik (Baz Çözümü Engellendi)</span>
                          </>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <label className="px-2.5 py-1 bg-white hover:bg-slate-50 border border-slate-300 rounded text-[11px] font-bold text-slate-700 cursor-pointer shadow-2xs flex items-center gap-1">
                          <Upload className="w-3 h-3 text-sky-600" />
                          <span>ATX Yükle</span>
                          <input
                            type="file"
                            accept=".atx,.txt,.atx.gz,.ATX,.TXT"
                            onChange={(e) => {
                              handleSingleAtxUpload(editStation.id, e);
                              setEditStation(null);
                            }}
                            className="hidden"
                          />
                        </label>
                        <button
                          type="button"
                          onClick={() => {
                            const id = editStation.id;
                            setEditStation(null);
                            handleOpenAntennaModalForStation(id);
                          }}
                          className="px-2.5 py-1 bg-sky-600 hover:bg-sky-700 text-white rounded text-[11px] font-bold cursor-pointer shadow-2xs"
                        >
                          Katalogdan Seç
                        </button>
                      </div>
                    </div>
                    <div className="text-[11px] font-mono text-slate-600 flex items-center justify-between flex-wrap gap-2">
                      <span>Model: <strong className="text-slate-900">{editStation.antenna?.model || 'Tanımsız'}</strong></span>
                      {isCalibrated && (
                        <span>
                          PCO Up: <strong>L1: +{(editStation.antenna?.pcoL1?.u ?? 0).toFixed(1)} / L2: +{(editStation.antenna?.pcoL2?.u ?? 0).toFixed(1)} mm</strong>
                        </span>
                      )}
                    </div>
                  </div>
                );
              })()}

              {/* Calculated ARP & APC Height Preview strictly conforming to IGS ANTEX 1.4 Section 3 */}
              {(() => {
                const isSlant = editHeightType === 'slant';
                const pcoL1_u = editStation?.antenna?.pcoL1?.u ?? 89.35;
                const pcoL2_u = editStation?.antenna?.pcoL2?.u ?? 117.76;
                const apcCalc = calculateAntennaPhaseCenterHeight(
                  editHeightType,
                  editMeasuredH,
                  editRadius,
                  isSlant ? editOffset : 0,
                  pcoL1_u,
                  pcoL2_u,
                  'L3'
                );

                return (
                  <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl space-y-2.5 text-xs">
                    <div className="flex items-center justify-between pb-2 border-b border-slate-200">
                      <div>
                        <span className="font-bold text-slate-800 block">1. Dik ARP Yüksekliği (h_ARP):</span>
                        <span className="text-[10px] text-slate-500 font-mono">
                          {isSlant ? '√(s² - R²) - Δh_çentik' : 'Doğrudan Düşey Jalon/Pilye'}
                        </span>
                      </div>
                      <span className="font-mono text-sm font-extrabold text-slate-900 bg-white px-2 py-0.5 rounded border border-slate-200">
                        {apcCalc.hArp.toFixed(4)} m
                      </span>
                    </div>

                    <div className="space-y-1.5 text-[11px]">
                      <div className="font-bold text-slate-700 flex items-center justify-between">
                        <span>2. IGS ANTEX 1.4 Faz Merkezi Yükseklikleri (h_APC = h_ARP + PCO_Up):</span>
                      </div>

                      {/* L1 (G01) */}
                      <div className="flex items-center justify-between pl-2 font-mono">
                        <span className="text-slate-600 font-sans">
                          • L1 (G01) [PCO Up: +{apcCalc.pcoL1_Up_mm.toFixed(1)} mm]:
                        </span>
                        <span className="font-bold text-sky-800">
                          {apcCalc.hApcL1.toFixed(4)} m
                        </span>
                      </div>

                      {/* L2 (G02) */}
                      <div className="flex items-center justify-between pl-2 font-mono">
                        <span className="text-slate-600 font-sans">
                          • L2 (G02) [PCO Up: +{apcCalc.pcoL2_Up_mm.toFixed(1)} mm]:
                        </span>
                        <span className="font-bold text-indigo-800">
                          {apcCalc.hApcL2.toFixed(4)} m
                        </span>
                      </div>

                      {/* L3 / LC Ionosphere-Free */}
                      <div className="flex items-center justify-between pl-2 font-mono bg-emerald-50/80 p-1.5 rounded border border-emerald-200">
                        <span className="text-emerald-900 font-sans font-semibold">
                          • LC / L3 (İyonosfersiz) [PCO: +{apcCalc.pcoL3_Up_mm.toFixed(1)} mm]:
                        </span>
                        <span className="font-bold text-emerald-800 text-xs">
                          {apcCalc.hApcL3.toFixed(4)} m
                        </span>
                      </div>
                    </div>

                    <p className="text-[10px] text-slate-500 leading-tight pt-1 border-t border-slate-200">
                      * <strong>IGS ANTEX 1.4 (Bölüm 3)</strong> standardına göre ortalama faz merkezi konumu: 
                      <span className="font-mono text-purple-700"> r_APC = r_ARP + PCO</span> (Kuzey, Doğu, Yukarı) bağıntısıyla hesaplanır.
                    </p>
                  </div>
                );
              })()}
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
                    NOAA NGS ANTCAL &amp; IGS20 Anten Kalibrasyon Kataloğu
                  </h3>
                </div>
                <p className="text-xs text-slate-400 mt-0.5">
                  {antennaModalStationId ? (
                    <>Seçilen Nokta: <strong>{stations[antennaModalStationId]?.name || antennaModalStationId}</strong> &bull; Resmi NOAA / IGS &amp; Özel ATX Parametreleri</>
                  ) : (
                    <>Kalıcı Anten Veritabanı &bull; {allKnownAntennas.length} Anten Modeli Kayıtlı</>
                  )}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <label className="px-3 py-1.5 bg-sky-600 hover:bg-sky-500 text-white font-bold text-xs rounded-lg shadow-2xs transition flex items-center gap-1.5 cursor-pointer">
                  <Upload className="w-3.5 h-3.5" />
                  <span>Yeni ATX Yükle</span>
                  <input
                    type="file"
                    accept=".atx,.txt,.atx.gz,.ATX,.TXT"
                    multiple
                    onChange={handleBatchAtxUpload}
                    className="hidden"
                  />
                </label>
                <button
                  onClick={() => setIsAntennaModalOpen(false)}
                  className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Filter Controls */}
            <div className="p-4 border-b border-slate-200 bg-slate-50 space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <div className="relative sm:col-span-1">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-3" />
                  <input
                    type="text"
                    placeholder="Model veya marka ara (örn: Zephyr, TRM, CHC, LEI)..."
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
                    <option value="ALL">Tüm Markalar ({allKnownAntennas.length})</option>
                    {manufacturers.map((m) => (
                      <option key={m} value={m}>
                        {m} ({allKnownAntennas.filter((a) => a.manufacturer === m).length})
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
                  Arama kriterlerine uygun anten kalibrasyon modeli bulunamadı. Yukarıdaki "Yeni ATX Yükle" butonundan anten ATX dosyanızı içeri aktarabilirsiniz.
                </div>
              ) : (
                modalFilteredAntennas.map((ant) => {
                  const targetStation = antennaModalStationId ? stations[antennaModalStationId] : null;
                  const isCurrent =
                    targetStation &&
                    targetStation.antenna?.model &&
                    targetStation.antenna.model.trim().toUpperCase() === ant.model.trim().toUpperCase();

                  const isCustom = getCustomAntennaCatalog().some(
                    (c) => c.model.trim().toUpperCase() === ant.model.trim().toUpperCase()
                  );

                  return (
                    <div
                      key={ant.model}
                      className={`py-3 px-2 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-slate-50 transition rounded-lg ${
                        isCurrent ? 'bg-sky-50/80 ring-1 ring-sky-300' : ''
                      }`}
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-bold text-slate-900 text-xs">{ant.displayName}</span>
                          <span className="bg-slate-100 text-slate-700 text-[10px] font-mono px-2 py-0.5 rounded border border-slate-200">
                            {ant.manufacturer}
                          </span>
                          {isCustom && (
                            <span className="bg-purple-100 text-purple-800 text-[10px] font-bold px-2 py-0.5 rounded border border-purple-200">
                              Özel ATX
                            </span>
                          )}
                        </div>
                        <div className="font-mono text-[11px] text-slate-500 flex items-center gap-3 flex-wrap">
                          <span>Model: <strong className="text-slate-800">{ant.model}</strong></span>
                          <span>Radome: <strong>{ant.radome}</strong></span>
                          <span>PCO Up: <strong>L1: +{ant.pcoL1?.u?.toFixed(1) || 0} mm / L2: +{ant.pcoL2?.u?.toFixed(1) || 0} mm</strong></span>
                        </div>
                      </div>

                      <div className="shrink-0 flex items-center gap-2">
                        {antennaModalStationId ? (
                          isCurrent ? (
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
                          )
                        ) : (
                          <span className="text-[11px] text-slate-400 font-medium">
                            Katalogda Kayıtlı
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Modal Footer */}
            <div className="p-3 bg-slate-50 border-t border-slate-200 flex justify-between items-center text-xs text-slate-500">
              <span>
                Toplam {modalFilteredAntennas.length} / {allKnownAntennas.length} anten listeleniyor ({getCustomAntennaCatalog().length} özel ATX).
              </span>
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

      {/* ========================================================================= */}
      {/* 5. KALİTE KONTROL (QC) & GNSS GÖRÜNTÜLEME MODAL PENCERESİ */}
      {/* ========================================================================= */}
      {isQcModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/65 backdrop-blur-xs p-3 sm:p-5"
          onClick={() => setIsQcModalOpen(false)}
        >
          <div
            className="bg-slate-50 rounded-2xl shadow-2xl max-w-7xl w-full max-h-[92vh] flex flex-col overflow-hidden border border-slate-200 animate-in fade-in duration-150"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="px-5 py-4 border-b border-slate-800 bg-slate-900 text-white flex items-center justify-between shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-indigo-600/30 border border-indigo-400/40 flex items-center justify-center shrink-0">
                  <Compass className="w-5 h-5 text-indigo-300" />
                </div>
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-bold text-sm sm:text-base text-white">
                      Kalite Kontrol (QC) &amp; GNSS Görüntüleme Pencereleri
                    </h3>
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 font-bold border border-emerald-500/30">
                      Topcon Tools Standart
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    Oturum zaman çizelgeleri (Occupation View), kutupsal gökyüzü görünürlüğü (Skyplot) ve SNR analizleri
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setIsQcModalOpen(false)}
                className="text-slate-300 hover:text-white px-2.5 py-1.5 rounded-lg hover:bg-slate-800 cursor-pointer flex items-center gap-1.5 text-xs font-semibold transition"
                title="Kapat (Esc)"
              >
                <X className="w-4 h-4" />
                <span className="hidden sm:inline">Kapat</span>
              </button>
            </div>

            {/* Modal Content */}
            <div className="p-4 sm:p-5 overflow-y-auto flex-1 custom-scrollbar">
              <QcSkyplotTab
                stations={stations}
                baselines={baselines}
                timeZone={timeZone}
                elevationMask={elevationMask}
                selectedStationId={qcSelectedStationId}
                onSelectStation={setQcSelectedStationId}
                onOpenRinexModal={() => setIsQcModalOpen(false)}
                isModal={true}
              />
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
