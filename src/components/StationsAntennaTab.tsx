/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * Modül 2: Veri Okuma, Noktalar ve NOAA ANTCAL Anten Kalibrasyon Modülü
 * Entegre: NOAA NGS ANTCAL & IGS20 Anten Veritabanı (https://geodesy.noaa.gov/ANTCAL/)
 */

import React, { useState } from 'react';
import { Station, AntennaHeightType, StationType } from '../types/gnss';
import {
  calculateCorrectedAntennaHeight,
  parseRinexHeader,
  parseAntexFile,
  parseTusagaStationText,
  geodeticToEcef,
  ecefToGeodetic,
  geodeticToTM,
  tmToGeodetic,
} from '../utils/geodesy';
import {
  NOAA_ANTCAL_CATALOG,
  NoaaAntennaCalibration,
  matchAntennaInNoaaCatalog,
} from '../data/noaaAntcal';
import {
  Radio,
  Upload,
  FileText,
  Plus,
  Trash2,
  Edit2,
  Check,
  X,
  Layers,
  Info,
  Sliders,
  Search,
  CheckCircle2,
  HelpCircle,
  Compass,
  ArrowRightLeft,
  ShieldCheck,
  MapPin,
  ExternalLink,
  Cpu,
  BookOpen,
  Activity,
} from 'lucide-react';

interface Props {
  stations: Record<string, Station>;
  dom?: number;
  onUpdateStation: (station: Station) => void;
  onAddStation: (station: Station) => void;
  onDeleteStation: (id: string) => void;
  onClearAllStations: () => void;
  onDetectedSurveyEpoch?: (epoch: number, dateStr?: string) => void;
  onViewOccupation?: (stationId: string) => void;
}

export const StationsAntennaTab: React.FC<Props> = ({
  stations,
  dom = 30,
  onUpdateStation,
  onAddStation,
  onDeleteStation,
  onClearAllStations,
  onDetectedSurveyEpoch,
  onViewOccupation,
}) => {
  const stationList = Object.values(stations);
  const [selectedStationId, setSelectedStationId] = useState<string>(stationList[0]?.id || '');
  const [uploadFeedback, setUploadFeedback] = useState<string | null>(null);

  // Antenna Search / Selector Filter in side panel
  const [antennaSearchQuery, setAntennaSearchQuery] = useState('');
  const [selectedManufacturer, setSelectedManufacturer] = useState<string>('ALL');

  // Dedicated Antenna Selection Modal State
  const [isAntennaModalOpen, setIsAntennaModalOpen] = useState(false);
  const [antennaModalStationId, setAntennaModalStationId] = useState<string>('');
  const [modalSearchQuery, setModalSearchQuery] = useState('');
  const [modalManufacturer, setModalManufacturer] = useState<string>('ALL');
  const [modalCategory, setModalCategory] = useState<string>('ALL');

  // "Manuel Koordinat Girişinin Mantığı" Explanation Modal State
  const [isLogicExplanationOpen, setIsLogicExplanationOpen] = useState(false);

  // Manual Coordinate Entry / Edit Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<'create' | 'edit'>('create');
  const [coordInputSystem, setCoordInputSystem] = useState<'TM' | 'ECEF' | 'GEO'>('TM');

  // Modal Form State
  const [formId, setFormId] = useState('P.101');
  const [formName, setFormName] = useState('P.101');
  const [formType, setFormType] = useState<StationType>('GROUND');
  const [formIsFixed, setFormIsFixed] = useState(false);

  // Coordinates
  const [formTM_Y, setFormTM_Y] = useState(500000.0);
  const [formTM_X, setFormTM_X] = useState(4415000.0);
  const [formH, setFormH] = useState(950.0);
  const [formECEF_X, setFormECEF_X] = useState(4120000.0);
  const [formECEF_Y, setFormECEF_Y] = useState(2650000.0);
  const [formECEF_Z, setFormECEF_Z] = useState(4070000.0);
  const [formLat, setFormLat] = useState(39.88);
  const [formLon, setFormLon] = useState(32.75);

  // Antenna
  const [formAntModel, setFormAntModel] = useState('TRM59800.00     NONE');
  const [formHeightType, setFormHeightType] = useState<AntennaHeightType>('vertical');
  const [formMeasuredH, setFormMeasuredH] = useState(1.8);
  const [formAntRadius, setFormAntRadius] = useState(0.17);
  const [formAntOffset, setFormAntOffset] = useState(0.0);

  // Velocities (m/year)
  const [formVx, setFormVx] = useState(-0.016);
  const [formVy, setFormVy] = useState(0.023);
  const [formVz, setFormVz] = useState(0.009);

  const selectedStation = stations[selectedStationId] || stationList[0];

  // Slant to vertical live testing state
  const [testHeightType, setTestHeightType] = useState<AntennaHeightType>('slant');
  const [testMeasured, setTestMeasured] = useState<number>(1.854);
  const [testRadius, setTestRadius] = useState<number>(0.095);
  const [testOffset, setTestOffset] = useState<number>(0.035);

  const calculatedVertical = calculateCorrectedAntennaHeight(
    testHeightType,
    testMeasured,
    testRadius,
    testOffset
  );

  // Filtered NOAA Antennas for side panel
  const filteredAntennas = NOAA_ANTCAL_CATALOG.filter((ant) => {
    const matchesMan = selectedManufacturer === 'ALL' || ant.manufacturer === selectedManufacturer;
    const matchesQuery =
      antennaSearchQuery === '' ||
      ant.model.toLowerCase().includes(antennaSearchQuery.toLowerCase()) ||
      ant.displayName.toLowerCase().includes(antennaSearchQuery.toLowerCase()) ||
      ant.manufacturer.toLowerCase().includes(antennaSearchQuery.toLowerCase());
    return matchesMan && matchesQuery;
  });

  // Filtered NOAA Antennas for Dedicated Modal
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

  const manufacturers = Array.from(new Set(NOAA_ANTCAL_CATALOG.map((a) => a.manufacturer))).sort();

  /**
   * File Upload Handler
   * Fully recognizes year-based RINEX naming (.24o, .25o, .26o, .27o, .24g, .25g, .26g, .24n, .25n, .26n)
   * as well as standard RINEX 3 (.rnx, .crx), ANTEX (.atx) and TUSAGA (.txt, .csv)
   */
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    let observationCount = 0;
    let matchedAntennaCount = 0;
    let navCount = 0;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const reader = new FileReader();

      reader.onload = (event) => {
        const text = event.target?.result as string;
        if (!text) return;

        const nameLower = file.name.toLowerCase();

        // 1. ANTEX (.atx)
        if (nameLower.endsWith('.atx') || text.includes('ANTEX VERSION / SYST')) {
          const parsedAtx = parseAntexFile(text);
          const modelsFound = Object.keys(parsedAtx);
          setUploadFeedback(`ANTEX (.atx) okundu: ${modelsFound.length} adet anten kalibrasyon modeli kütüphaneye dahil edildi.`);
          return;
        }

        // 2. TUSAGA Koordinat Listesi (.txt, .csv)
        if (nameLower.endsWith('.txt') || nameLower.endsWith('.csv')) {
          const stns = parseTusagaStationText(text);
          if (stns.length > 0) {
            stns.forEach((s) => onAddStation(s));
            if (stns[0]) setSelectedStationId(stns[0].id);
            setUploadFeedback(`TUSAGA koordinat dosyasından ${stns.length} onaylı nokta aktarıldı.`);
            return;
          }
        }

        // 3. RINEX Navigation Dosyaları (.20n - .30n, .20g - .30g, .nav vb.)
        const isRinexNav =
          /\.\d{2}[ngp]$/i.test(nameLower) ||
          nameLower.endsWith('.nav') ||
          text.includes('NAVIGATION DATA');

        if (isRinexNav) {
          navCount++;
          setUploadFeedback(`RINEX Navigasyon/Yörünge dosyası (${file.name}) baz vektörü türetme için sisteme alındı.`);
          return;
        }

        // 4. RINEX Observation Dosyaları (.20o - .30o, .o, .obs, .rnx, .crx)
        const isRinexObs =
          /\.\d{2}o$/i.test(nameLower) ||
          nameLower.endsWith('.o') ||
          nameLower.endsWith('.obs') ||
          nameLower.endsWith('.rnx') ||
          nameLower.endsWith('.crx') ||
          text.includes('OBSERVATION DATA') ||
          text.includes('RINEX VERSION');

        if (isRinexObs) {
          const rinexStn = parseRinexHeader(text, file.name);
          if (rinexStn && rinexStn.id) {
            observationCount++;
            onAddStation(rinexStn as Station);
            setSelectedStationId(rinexStn.id);

            const matched = matchAntennaInNoaaCatalog(rinexStn.antenna?.model || '');
            if (matched) matchedAntennaCount++;

            if (rinexStn.observationEpoch && onDetectedSurveyEpoch) {
              onDetectedSurveyEpoch(rinexStn.observationEpoch, rinexStn.observationDateStr);
            }

            const epochMsg = rinexStn.observationEpoch
              ? ` [✓ Ölçü Epoğu: t = ${rinexStn.observationEpoch.toFixed(2)}]`
              : '';

            setUploadFeedback(
              `RINEX Gözlem Dosyası (${file.name}) aktarıldı: "${rinexStn.name}" noktası eklendi.${epochMsg} ${
                matched
                  ? `[✓ NOAA ANTCAL Otomatik Tanındı: ${matched.displayName}]`
                  : `[Anten: "${rinexStn.antenna?.model || 'Tanımsız'}" - Dilerseniz ANTCAL listesinden seçebilirsiniz]`
              }`
            );
          }
        }
      };

      reader.readAsText(file);
    }
  };

  const handleToggleFixed = (stId: string) => {
    const st = stations[stId];
    if (!st) return;
    const nextFixed = !st.isFixed.x;
    onUpdateStation({
      ...st,
      isFixed: { x: nextFixed, y: nextFixed, z: nextFixed },
      type: nextFixed ? 'CORS' : 'GROUND',
    });
  };

  const handleSelectNoaaAntenna = (stationId: string, cal: NoaaAntennaCalibration) => {
    const st = stations[stationId];
    if (!st) return;

    const newCorrected = calculateCorrectedAntennaHeight(
      st.antenna.heightType,
      st.antenna.measuredHeight,
      cal.radius,
      cal.verticalOffset
    );

    const updated: Station = {
      ...st,
      antenna: {
        ...st.antenna,
        model: cal.model,
        radius: cal.radius,
        verticalOffset: cal.verticalOffset,
        correctedHeight: newCorrected,
        pcoL1: cal.pcoL1,
        pcoL2: cal.pcoL2,
        pcvZenith: cal.pcvZenith,
      },
    };

    onUpdateStation(updated);
    setUploadFeedback(`"${st.name}" noktasına NOAA ANTCAL modeli atandı: ${cal.displayName}`);
  };

  const handleOpenAntennaModalForStation = (stId: string) => {
    setAntennaModalStationId(stId);
    setSelectedStationId(stId);
    setModalSearchQuery('');
    setModalManufacturer('ALL');
    setModalCategory('ALL');
    setIsAntennaModalOpen(true);
  };

  // Open Modal for New Station
  const handleOpenCreateModal = () => {
    const newIdx = stationList.length + 1;
    const defaultCal = NOAA_ANTCAL_CATALOG[0];

    setModalMode('create');
    setFormId(`P.${100 + newIdx}`);
    setFormName(`P.${100 + newIdx}`);
    setFormType('GROUND');
    setFormIsFixed(false);

    setFormTM_Y(500000.0);
    setFormTM_X(4415000.0);
    setFormH(950.0);

    const geo = tmToGeodetic(500000.0, 4415000.0, dom);
    setFormLat(geo.lat);
    setFormLon(geo.lon);

    const ec = geodeticToEcef(geo.lat, geo.lon, 950.0);
    setFormECEF_X(ec.x);
    setFormECEF_Y(ec.y);
    setFormECEF_Z(ec.z);

    setFormAntModel(defaultCal.model);
    setFormHeightType('vertical');
    setFormMeasuredH(1.800);
    setFormAntRadius(defaultCal.radius);
    setFormAntOffset(defaultCal.verticalOffset);

    setFormVx(-0.016);
    setFormVy(0.023);
    setFormVz(0.009);

    setIsModalOpen(true);
  };

  // Open Modal for Editing Existing Station
  const handleOpenEditModal = (st: Station) => {
    setModalMode('edit');
    setFormId(st.id);
    setFormName(st.name);
    setFormType(st.type);
    setFormIsFixed(st.isFixed.x && st.isFixed.y && st.isFixed.z);

    setFormTM_Y(st.projY);
    setFormTM_X(st.projX);
    setFormH(st.h);

    setFormLat(st.lat);
    setFormLon(st.lon);

    setFormECEF_X(st.x);
    setFormECEF_Y(st.y);
    setFormECEF_Z(st.z);

    setFormAntModel(st.antenna.model);
    setFormHeightType(st.antenna.heightType);
    setFormMeasuredH(st.antenna.measuredHeight);
    setFormAntRadius(st.antenna.radius);
    setFormAntOffset(st.antenna.verticalOffset);

    setFormVx(st.velocities?.vx ?? -0.016);
    setFormVy(st.velocities?.vy ?? 0.023);
    setFormVz(st.velocities?.vz ?? 0.009);

    setIsModalOpen(true);
  };

  // Coords change handlers in form modal
  const handleUpdateTM = (y: number, x: number, h: number) => {
    setFormTM_Y(y);
    setFormTM_X(x);
    setFormH(h);
    const geo = tmToGeodetic(y, x, dom);
    setFormLat(geo.lat);
    setFormLon(geo.lon);
    const ec = geodeticToEcef(geo.lat, geo.lon, h);
    setFormECEF_X(ec.x);
    setFormECEF_Y(ec.y);
    setFormECEF_Z(ec.z);
  };

  const handleUpdateECEF = (x: number, y: number, z: number) => {
    setFormECEF_X(x);
    setFormECEF_Y(y);
    setFormECEF_Z(z);
    const geo = ecefToGeodetic(x, y, z);
    setFormLat(geo.lat);
    setFormLon(geo.lon);
    setFormH(geo.h);
    const tm = geodeticToTM(geo.lat, geo.lon, dom);
    setFormTM_Y(tm.projY);
    setFormTM_X(tm.projX);
  };

  const handleUpdateGeo = (lat: number, lon: number, h: number) => {
    setFormLat(lat);
    setFormLon(lon);
    setFormH(h);
    const ec = geodeticToEcef(lat, lon, h);
    setFormECEF_X(ec.x);
    setFormECEF_Y(ec.y);
    setFormECEF_Z(ec.z);
    const tm = geodeticToTM(lat, lon, dom);
    setFormTM_Y(tm.projY);
    setFormTM_X(tm.projX);
  };

  // Save Modal
  const handleSaveModal = () => {
    const matchedCal = matchAntennaInNoaaCatalog(formAntModel);
    const radius = matchedCal ? matchedCal.radius : formAntRadius;
    const offset = matchedCal ? matchedCal.verticalOffset : formAntOffset;
    const pcoL1 = matchedCal ? matchedCal.pcoL1 : { n: 1.1, e: -0.3, u: 89.2 };
    const pcoL2 = matchedCal ? matchedCal.pcoL2 : { n: 0.9, e: -0.2, u: 82.1 };
    const pcvZenith = matchedCal ? matchedCal.pcvZenith : [0, 0.6, 1.4, 2.5, 4.1];

    const correctedH = calculateCorrectedAntennaHeight(
      formHeightType,
      formMeasuredH,
      radius,
      offset
    );

    const st: Station = {
      id: formId,
      name: formName || formId,
      type: formIsFixed ? 'CORS' : formType,
      isFixed: { x: formIsFixed, y: formIsFixed, z: formIsFixed },
      x: formECEF_X,
      y: formECEF_Y,
      z: formECEF_Z,
      lat: formLat,
      lon: formLon,
      h: formH,
      projY: formTM_Y,
      projX: formTM_X,
      antenna: {
        model: matchedCal ? matchedCal.model : formAntModel,
        heightType: formHeightType,
        measuredHeight: formMeasuredH,
        radius,
        verticalOffset: offset,
        correctedHeight: correctedH,
        pcoL1,
        pcoL2,
        pcvZenith,
      },
      velocities: { vx: formVx, vy: formVy, vz: formVz },
    };

    if (modalMode === 'create') {
      onAddStation(st);
      setSelectedStationId(st.id);
      setUploadFeedback(`Yeni nokta eklendi: ${st.name} [${st.type}]`);
    } else {
      onUpdateStation(st);
      setUploadFeedback(`Nokta güncellendi: ${st.name}`);
    }

    setIsModalOpen(false);
  };

  return (
    <div className="space-y-6">
      {/* Top Banner & Quick Actions */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="bg-sky-100 text-sky-800 text-xs font-semibold px-2 py-0.5 rounded">
                MODÜL 2
              </span>
              <h2 className="text-base font-bold text-slate-900">
                Veri Okuma ve Yerleşik NOAA NGS ANTCAL Anten Kalibrasyon Motoru
              </h2>
            </div>
            <p className="text-xs text-slate-500 mt-1">
              Yıla göre değişen tüm RINEX gözlem/navigasyon formatları (<code>.24o, .25o, .26o, .25g, .25n, .26g, .26n, .rnx, .crx</code>) 
              tam uyumlu olarak okunur. Anten başlığı NOAA ANTCAL kütüphanesiyle otomatik eşleştirilir.
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <label className="px-3.5 py-2 text-xs font-semibold bg-sky-600 hover:bg-sky-700 text-white rounded-lg shadow-sm transition cursor-pointer flex items-center gap-1.5">
              <Upload className="w-3.5 h-3.5" />
              <span>RINEX Yükle (.24o, .25o, .26o, .rnx, .txt)</span>
              <input
                type="file"
                multiple
                onChange={handleFileUpload}
                className="hidden"
              />
            </label>

            <button
              onClick={handleOpenCreateModal}
              className="px-3 py-2 text-xs font-semibold bg-slate-900 hover:bg-slate-800 text-white rounded-lg transition cursor-pointer flex items-center gap-1.5"
            >
              <Plus className="w-3.5 h-3.5 text-sky-400" />
              <span>Manuel Koordinat Gir</span>
            </button>

            <button
              onClick={() => setIsLogicExplanationOpen(true)}
              className="px-3 py-2 text-xs font-semibold bg-sky-50 hover:bg-sky-100 text-sky-800 border border-sky-200 rounded-lg transition cursor-pointer flex items-center gap-1.5"
              title="Manuel Koordinat Girişinin Jeodezik Mantığını İncele"
            >
              <HelpCircle className="w-3.5 h-3.5 text-sky-600" />
              <span>Giriş Mantığı Nedir?</span>
            </button>

            {stationList.length > 0 && (
              <button
                onClick={onClearAllStations}
                className="px-3 py-2 text-xs font-semibold bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-300 rounded-lg transition cursor-pointer flex items-center gap-1.5"
                title="Tüm noktaları temizle"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Noktaları Temizle</span>
              </button>
            )}
          </div>
        </div>

        {uploadFeedback && (
          <div className="mt-3 p-2.5 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg text-xs flex items-center justify-between">
            <div className="flex items-center gap-1.5">
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

      {/* When Empty: Helpful Empty State Banner */}
      {stationList.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm border border-dashed border-slate-300 p-12 text-center space-y-4">
          <div className="w-14 h-14 bg-sky-50 text-sky-600 rounded-full flex items-center justify-center mx-auto">
            <Radio className="w-7 h-7" />
          </div>
          <div className="space-y-1">
            <h3 className="text-base font-bold text-slate-800">Uygulamada Henüz Nokta Bulunmuyor</h3>
            <p className="text-xs text-slate-500 max-w-xl mx-auto leading-relaxed">
              Ölçülerinize ait RINEX (<code>.24o, .25o, .26o, .25g, .25n, .26g, .26n, .rnx, .crx</code>) 
              gözlem ve yörünge dosyalarınızı doğrudan yükleyebilir ya da onaylı tescilli CORS/nirengi koordinatlarınızı 
              <strong> Manuel Koordinat Gir</strong> butonuyla tanımlayabilirsiniz.
            </p>
          </div>

          <div className="flex items-center justify-center gap-3 pt-2 flex-wrap">
            <label className="px-4 py-2.5 text-xs font-bold bg-sky-600 hover:bg-sky-700 text-white rounded-lg shadow-sm transition cursor-pointer flex items-center gap-1.5">
              <Upload className="w-3.5 h-3.5" />
              <span>RINEX Dosyası Seç (.24o, .25o, .26o, .rnx)</span>
              <input
                type="file"
                multiple
                onChange={handleFileUpload}
                className="hidden"
              />
            </label>
            <button
              onClick={handleOpenCreateModal}
              className="px-4 py-2.5 text-xs font-bold bg-slate-900 hover:bg-slate-800 text-white rounded-lg transition cursor-pointer flex items-center gap-1.5"
            >
              <Plus className="w-3.5 h-3.5 text-sky-400" />
              <span>Manuel Koordinat Gir</span>
            </button>
            <button
              onClick={() => setIsLogicExplanationOpen(true)}
              className="px-4 py-2.5 text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg transition cursor-pointer flex items-center gap-1.5"
            >
              <HelpCircle className="w-3.5 h-3.5 text-sky-600" />
              <span>Manuel Giriş Mantığını İncele</span>
            </button>
          </div>
        </div>
      ) : (
        /* Main Grid: Station Table & Antenna / ANTEX Panel */
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left Column: Stations Table */}
          <div className="lg:col-span-7 bg-white rounded-xl shadow-sm border border-slate-200 p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <Radio className="w-4 h-4 text-sky-600" />
                <h3 className="text-sm font-bold text-slate-900">Ağ Noktaları ({stationList.length})</h3>
              </div>
              <span className="text-xs text-slate-500 font-medium">
                Tıklandığında sağ panelde anten ve NOAA parametreleri gösterilir
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-50 text-slate-700 font-semibold border-b border-slate-200">
                    <th className="py-2.5 px-3">Nokta ID</th>
                    <th className="py-2.5 px-3">Durum</th>
                    <th className="py-2.5 px-3">Tanımlı Anten & NOAA ANTCAL</th>
                    <th className="py-2.5 px-3 text-right">ARP Yük. (m)</th>
                    <th className="py-2.5 px-3 text-right">Elip. H (m)</th>
                    <th className="py-2.5 px-3 text-center">İşlem</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {stationList.map((st) => {
                    const isSelected = st.id === selectedStationId;
                    const isFixed = st.isFixed.x && st.isFixed.y && st.isFixed.z;
                    const matchedCal = matchAntennaInNoaaCatalog(st.antenna.model);

                    return (
                      <tr
                        key={st.id}
                        onClick={() => setSelectedStationId(st.id)}
                        className={`hover:bg-slate-50 transition cursor-pointer ${
                          isSelected ? 'bg-sky-50/70' : ''
                        }`}
                      >
                        <td className="py-2.5 px-3 font-bold font-mono text-slate-900 flex items-center gap-1.5">
                          <span
                            className={`w-2 h-2 rounded-full ${
                              isFixed ? 'bg-rose-500 ring-2 ring-rose-200' : 'bg-sky-500 ring-2 ring-sky-200'
                            }`}
                          />
                          <span>{st.name}</span>
                        </td>
                        <td className="py-2.5 px-3">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleToggleFixed(st.id);
                            }}
                            className={`px-2 py-0.5 rounded text-[10px] font-semibold cursor-pointer transition ${
                              isFixed
                                ? 'bg-rose-100 text-rose-800 border border-rose-300'
                                : 'bg-sky-100 text-sky-800 border border-sky-300'
                            }`}
                            title="Tıklayarak CORS (Sabit) veya Gezici (Serbest) durumunu değiştirin"
                          >
                            {isFixed ? 'SABİT (CORS)' : 'SERBEST (ARA)'}
                          </button>
                        </td>
                        <td className="py-2.5 px-3 font-mono text-[11px] text-slate-700">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="truncate max-w-[150px] font-semibold text-slate-800" title={st.antenna.model}>
                              {matchedCal ? matchedCal.displayName : st.antenna.model}
                            </span>
                            {matchedCal ? (
                              <span
                                className="bg-emerald-100 text-emerald-800 text-[9px] font-bold px-1.5 py-0.5 rounded flex items-center gap-0.5 border border-emerald-200"
                                title="NOAA NGS ANTCAL resmi kalibrasyonu eşleştirildi"
                              >
                                <CheckCircle2 className="w-2.5 h-2.5 text-emerald-600" />
                                ANTCAL
                              </span>
                            ) : (
                              <span className="bg-amber-100 text-amber-800 text-[9px] font-bold px-1.5 py-0.5 rounded border border-amber-200">
                                Özel
                              </span>
                            )}
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleOpenAntennaModalForStation(st.id);
                              }}
                              className="text-[10px] text-sky-600 hover:text-sky-800 font-bold underline cursor-pointer ml-1"
                              title="Bu nokta için yerleşik NOAA ANTCAL kütüphanesinden anten modeli seç"
                            >
                              Anten Seç
                            </button>
                          </div>
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono text-slate-800">
                          {st.antenna.correctedHeight.toFixed(3)}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono font-medium text-slate-900">
                          {st.h.toFixed(3)}
                        </td>
                        <td className="py-2.5 px-3 text-center">
                          <div className="flex items-center justify-center gap-1">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                if (onViewOccupation) onViewOccupation(st.id);
                              }}
                              className="p-1 hover:bg-emerald-100 rounded text-emerald-600 hover:text-emerald-900 cursor-pointer"
                              title="Topcon Tools Uydu Takip Grafiğini Görüntüle (Occupation View)"
                            >
                              <Activity className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleOpenAntennaModalForStation(st.id);
                              }}
                              className="p-1 hover:bg-sky-100 rounded text-sky-600 hover:text-sky-900 cursor-pointer"
                              title="NOAA ANTCAL Kataloğundan Anten Değiştir"
                            >
                              <Sliders className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleOpenEditModal(st);
                              }}
                              className="p-1 hover:bg-slate-200 rounded text-slate-600 hover:text-slate-900 cursor-pointer"
                              title="Koordinat ve Parametreleri Düzenle"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                onDeleteStation(st.id);
                              }}
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

          {/* Right Column: Selected Station Antenna & NOAA ANTCAL Catalog Selector */}
          <div className="lg:col-span-5 space-y-5">
            {selectedStation && (
              <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5 space-y-4">
                <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">
                      Nokta Anten Ayarları: {selectedStation.name}
                    </h3>
                    <div className="text-[11px] text-slate-500 font-mono">
                      Mevcut Anten: {selectedStation.antenna.model}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {onViewOccupation && (
                      <button
                        onClick={() => onViewOccupation(selectedStation.id)}
                        className="bg-emerald-50 text-emerald-800 hover:bg-emerald-100 border border-emerald-300 text-[10px] font-bold px-2 py-1 rounded cursor-pointer flex items-center gap-1"
                        title="Bu noktanın Topcon Tools Occupation View uydu takip grafiğini aç"
                      >
                        <Activity className="w-3 h-3 text-emerald-600" />
                        <span>Uydu Grafiği</span>
                      </button>
                    )}
                    <button
                      onClick={() => handleOpenAntennaModalForStation(selectedStation.id)}
                      className="bg-sky-50 text-sky-700 hover:bg-sky-100 border border-sky-300 text-[10px] font-bold px-2 py-1 rounded cursor-pointer flex items-center gap-1"
                    >
                      <Sliders className="w-3 h-3" />
                      <span>Katalogdan Değiştir</span>
                    </button>
                  </div>
                </div>

                {/* Antenna Height and Reduction Mode */}
                <div className="bg-slate-50 rounded-lg p-3.5 border border-slate-200 space-y-2.5 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-slate-700">Ölçüm Yöntemi:</span>
                    <div className="flex gap-2">
                      <button
                        onClick={() => {
                          const nextType: AntennaHeightType = 'vertical';
                          const corrected = calculateCorrectedAntennaHeight(
                            nextType,
                            selectedStation.antenna.measuredHeight,
                            selectedStation.antenna.radius,
                            selectedStation.antenna.verticalOffset
                          );
                          onUpdateStation({
                            ...selectedStation,
                            antenna: { ...selectedStation.antenna, heightType: nextType, correctedHeight: corrected },
                          });
                        }}
                        className={`px-2 py-1 rounded text-xs font-semibold cursor-pointer transition ${
                          selectedStation.antenna.heightType === 'vertical'
                            ? 'bg-sky-600 text-white'
                            : 'bg-white text-slate-600 border border-slate-300'
                        }`}
                      >
                        Düşey (Vertical/Pilye)
                      </button>
                      <button
                        onClick={() => {
                          const nextType: AntennaHeightType = 'slant';
                          const corrected = calculateCorrectedAntennaHeight(
                            nextType,
                            selectedStation.antenna.measuredHeight,
                            selectedStation.antenna.radius,
                            selectedStation.antenna.verticalOffset
                          );
                          onUpdateStation({
                            ...selectedStation,
                            antenna: { ...selectedStation.antenna, heightType: nextType, correctedHeight: corrected },
                          });
                        }}
                        className={`px-2 py-1 rounded text-xs font-semibold cursor-pointer transition ${
                          selectedStation.antenna.heightType === 'slant'
                            ? 'bg-sky-600 text-white'
                            : 'bg-white text-slate-600 border border-slate-300'
                        }`}
                      >
                        Eğik (Slant/Sehpa)
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-slate-600 font-medium mb-1">Ölçülen Yükseklik (m)</label>
                      <input
                        type="number"
                        step="0.001"
                        value={selectedStation.antenna.measuredHeight}
                        onChange={(e) => {
                          const measured = parseFloat(e.target.value) || 0;
                          const corrected = calculateCorrectedAntennaHeight(
                            selectedStation.antenna.heightType,
                            measured,
                            selectedStation.antenna.radius,
                            selectedStation.antenna.verticalOffset
                          );
                          onUpdateStation({
                            ...selectedStation,
                            antenna: {
                              ...selectedStation.antenna,
                              measuredHeight: measured,
                              correctedHeight: corrected,
                            },
                          });
                        }}
                        className="w-full px-2.5 py-1.5 border border-slate-300 rounded font-mono font-bold text-slate-900 bg-white"
                      />
                    </div>
                    <div>
                      <label className="block text-slate-600 font-medium mb-1">İndirgenmiş ARP Boyu</label>
                      <div className="px-2.5 py-1.5 bg-emerald-50 border border-emerald-200 rounded font-mono font-bold text-emerald-800 text-center">
                        {selectedStation.antenna.correctedHeight.toFixed(4)} m
                      </div>
                    </div>
                  </div>
                </div>

                {/* NOAA NGS ANTCAL Antenna Quick Selector */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                      <Sliders className="w-3.5 h-3.5 text-sky-600" />
                      <span>NOAA NGS ANTCAL Kataloğundan Anten Seç:</span>
                    </label>
                  </div>

                  {/* Filter and Search Bar */}
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <div className="col-span-2 relative">
                      <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
                      <input
                        type="text"
                        placeholder="Model ara (Zephyr, AR25, HiPer)..."
                        value={antennaSearchQuery}
                        onChange={(e) => setAntennaSearchQuery(e.target.value)}
                        className="w-full pl-8 pr-2 py-1.5 border border-slate-300 rounded text-xs"
                      />
                    </div>
                    <select
                      value={selectedManufacturer}
                      onChange={(e) => setSelectedManufacturer(e.target.value)}
                      className="px-2 py-1.5 border border-slate-300 rounded text-xs bg-white font-medium"
                    >
                      <option value="ALL">Tüm Markalar</option>
                      {manufacturers.map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Antenna Options List */}
                  <div className="max-h-48 overflow-y-auto border border-slate-200 rounded-lg divide-y divide-slate-100 text-xs custom-scrollbar">
                    {filteredAntennas.map((ant) => {
                      const isCurrent =
                        selectedStation.antenna.model.trim().toUpperCase() ===
                        ant.model.trim().toUpperCase();
                      return (
                        <button
                          key={ant.model}
                          onClick={() => handleSelectNoaaAntenna(selectedStation.id, ant)}
                          className={`w-full text-left p-2 hover:bg-sky-50 transition cursor-pointer flex items-center justify-between ${
                            isCurrent ? 'bg-sky-50/80 font-bold text-sky-900' : 'text-slate-700'
                          }`}
                        >
                          <div>
                            <div className="font-semibold text-slate-900">{ant.displayName}</div>
                            <div className="text-[10px] font-mono text-slate-500">
                              {ant.model} &bull; {ant.category} &bull; Radome: {ant.radome}
                            </div>
                          </div>
                          {isCurrent && (
                            <span className="text-sky-600 shrink-0 ml-2">
                              <Check className="w-4 h-4" />
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Selected Antenna PCO Values */}
                <div>
                  <h4 className="text-xs font-bold text-slate-800 mb-2 flex items-center gap-1.5">
                    <Info className="w-3.5 h-3.5 text-sky-500" />
                    <span>Kalibre Edilmiş Faz Merkezi Ofsetleri (PCO - mm)</span>
                  </h4>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="p-2.5 bg-sky-50/60 border border-sky-200 rounded-lg">
                      <div className="font-bold text-sky-900 mb-1">L1 / G01 Frekansı</div>
                      <div className="font-mono text-[11px] text-slate-700 space-y-0.5">
                        <div>North: {selectedStation.antenna.pcoL1.n.toFixed(1)} mm</div>
                        <div>East: {selectedStation.antenna.pcoL1.e.toFixed(1)} mm</div>
                        <div className="font-bold text-sky-800">Up (ARP): {selectedStation.antenna.pcoL1.u.toFixed(1)} mm</div>
                      </div>
                    </div>
                    <div className="p-2.5 bg-indigo-50/60 border border-indigo-200 rounded-lg">
                      <div className="font-bold text-indigo-900 mb-1">L2 / G02 Frekansı</div>
                      <div className="font-mono text-[11px] text-slate-700 space-y-0.5">
                        <div>North: {selectedStation.antenna.pcoL2.n.toFixed(1)} mm</div>
                        <div>East: {selectedStation.antenna.pcoL2.e.toFixed(1)} mm</div>
                        <div className="font-bold text-indigo-800">Up (ARP): {selectedStation.antenna.pcoL2.u.toFixed(1)} mm</div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Slant to Vertical Interactive Calculator Card */}
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5 space-y-3">
              <div className="flex items-center gap-2 border-b border-slate-100 pb-2.5">
                <Layers className="w-4 h-4 text-sky-600" />
                <h3 className="text-sm font-bold text-slate-900">
                  Anten Yükseklik İndirgeme Formülü (Slant → Vertical)
                </h3>
              </div>

              <div className="bg-slate-900 text-sky-300 p-3 rounded-lg font-mono text-xs">
                h_vertical = √(R_slant² - R_ant²) - offset
              </div>

              <div className="grid grid-cols-3 gap-2 text-xs">
                <div>
                  <label className="block text-slate-500 text-[10px] mb-1">Ölçülen R_slant (m)</label>
                  <input
                    type="number"
                    step="0.001"
                    value={testMeasured}
                    onChange={(e) => setTestMeasured(parseFloat(e.target.value) || 0)}
                    className="w-full p-1.5 border border-slate-300 rounded font-mono font-bold"
                  />
                </div>
                <div>
                  <label className="block text-slate-500 text-[10px] mb-1">Anten Yarıçapı R (m)</label>
                  <input
                    type="number"
                    step="0.001"
                    value={testRadius}
                    onChange={(e) => setTestRadius(parseFloat(e.target.value) || 0)}
                    className="w-full p-1.5 border border-slate-300 rounded font-mono font-bold"
                  />
                </div>
                <div>
                  <label className="block text-slate-500 text-[10px] mb-1">ARP Ofset (m)</label>
                  <input
                    type="number"
                    step="0.001"
                    value={testOffset}
                    onChange={(e) => setTestOffset(parseFloat(e.target.value) || 0)}
                    className="w-full p-1.5 border border-slate-300 rounded font-mono font-bold"
                  />
                </div>
              </div>

              <div className="p-2.5 bg-sky-50 rounded-lg border border-sky-200 flex justify-between items-center text-xs">
                <span className="font-semibold text-sky-900">Hesaplanan Dik ARP Yüksekliği:</span>
                <span className="font-mono font-bold text-sm text-sky-800">
                  {calculatedVertical.toFixed(4)} m
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 1. DEDICATED ANTENNA SELECTION MODAL (For any station) */}
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
                    placeholder="Model ara (örn: Zephyr, AR25)..."
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
                          <span className="bg-sky-100 text-sky-800 text-[10px] font-semibold px-2 py-0.5 rounded">
                            {ant.category}
                          </span>
                        </div>
                        <div className="font-mono text-[11px] text-slate-500 flex items-center gap-3 flex-wrap">
                          <span>Model: <strong className="text-slate-800">{ant.model}</strong></span>
                          <span>Radome: <strong>{ant.radome}</strong></span>
                          <span>Yarıçap: <strong>{(ant.radius * 100).toFixed(1)} cm</strong></span>
                        </div>
                        <div className="text-[11px] font-mono text-slate-600 flex items-center gap-4 pt-0.5">
                          <span className="text-sky-700">
                            L1 PCO: N={ant.pcoL1.n.toFixed(1)}, E={ant.pcoL1.e.toFixed(1)}, Up={ant.pcoL1.u.toFixed(1)} mm
                          </span>
                          <span className="text-indigo-700">
                            L2 PCO: N={ant.pcoL2.n.toFixed(1)}, E={ant.pcoL2.e.toFixed(1)}, Up={ant.pcoL2.u.toFixed(1)} mm
                          </span>
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

      {/* ========================================================================= */}
      {/* 2. "MANUEL KOORDİNAT GİRİŞİNİN MANTIĞI VE AMACI" EXPLANATION MODAL */}
      {/* ========================================================================= */}
      {isLogicExplanationOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in duration-150">
            {/* Header */}
            <div className="p-5 border-b border-slate-200 bg-slate-900 text-white flex items-center justify-between">
              <div className="flex items-center gap-2">
                <HelpCircle className="w-5 h-5 text-sky-400" />
                <h3 className="font-bold text-base">
                  Manuel Koordinat Girme Butonunun Mantığı ve Jeodezik Gerekçesi
                </h3>
              </div>
              <button
                onClick={() => setIsLogicExplanationOpen(false)}
                className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Content */}
            <div className="p-6 space-y-4 overflow-y-auto text-xs text-slate-700 leading-relaxed custom-scrollbar">
              <div className="p-3 bg-sky-50 border border-sky-200 rounded-xl text-sky-950 font-medium">
                Jeodezik ağ dengelemesinde (Topcon Tools, Leica Infinity, Trimble Business Center mantığında) 
                <strong> "Manuel Koordinat Gir" </strong> fonksiyonu aşağıdaki 5 temel mühendislik gereksinimi için zorunludur:
              </div>

              <div className="space-y-3">
                <div className="p-3 bg-white border border-slate-200 rounded-lg shadow-2xs space-y-1">
                  <div className="font-bold text-slate-900 text-sm flex items-center gap-1.5 text-rose-700">
                    <span>1. Dayalı Dengeleme (Constrained Adjustment) İçin Datum Sabiti Tanımlama</span>
                  </div>
                  <p>
                    Ağın dayalı (zorlamalı) dengelenebilmesi için en az bir veya birkaç TUSAGA-Aktif (CORS-TR) ya da 
                    TUTGA nirengi noktasının <strong>resmi/tescilli datum koordinatlarının (2005.00 referans epoğu)</strong> ağa 
                    tanıtılması gerekir. RINEX başlığındaki yaklaşık koordinatlar (SPP) tek nokta kod gözlemi olduğundan metrelerce 
                    hatalıdır ve datum sabiti olarak kullanılamaz.
                  </p>
                </div>

                <div className="p-3 bg-white border border-slate-200 rounded-lg shadow-2xs space-y-1">
                  <div className="font-bold text-slate-900 text-sm flex items-center gap-1.5 text-sky-700">
                    <span>2. RINEX Başlığındaki Yaklaşık Koordinat (Approx Position XYZ) Hatalarını Giderme</span>
                  </div>
                  <p>
                    Bazı GNSS alıcıları RINEX başlığına koordinat yazmaz (0, 0, 0) veya navigasyon çözümü kaba hata içerir. 
                    Bu durumda çift fark baz vektörü türetilirken Taylor açılımı ve doğrusallaştırma için yaklaşık koordinatların 
                    manuel tanımlanması veya düzeltilmesi zorunludur.
                  </p>
                </div>

                <div className="p-3 bg-white border border-slate-200 rounded-lg shadow-2xs space-y-1">
                  <div className="font-bold text-slate-900 text-sm flex items-center gap-1.5 text-emerald-700">
                    <span>3. Sahada Yanlış Girilen Anten Yüksekliklerinin Saha Karnesine Göre Düzeltilmesi</span>
                  </div>
                  <p>
                    Arazide alıcı kontrol ünitesine girilen jalon/sehpa yüksekliği ile arazide ölçülen gerçek dik veya eğik yükseklik 
                    farklı olabilir. Saha röleve karnesindeki gerçek değerler manuel formdan girilerek ARP indirgemesi doğru hesaplanır.
                  </p>
                </div>

                <div className="p-3 bg-white border border-slate-200 rounded-lg shadow-2xs space-y-1">
                  <div className="font-bold text-slate-900 text-sm flex items-center gap-1.5 text-amber-700">
                    <span>4. RINEX Kaydı Olmayan Poligon, Nivelman ve Yerel Nirengi Noktalarını Bağlama</span>
                  </div>
                  <p>
                    GNSS ağına entegre edilen ancak üzerinde doğrudan bağımsız RINEX kaydı bulunmayan yerel poligon, röper (RS) veya 
                    yer kontrol noktaları (YKN) koordinatlarıyla birlikte ağ topolojisine manuel dahil edilir.
                  </p>
                </div>

                <div className="p-3 bg-white border border-slate-200 rounded-lg shadow-2xs space-y-1">
                  <div className="font-bold text-slate-900 text-sm flex items-center gap-1.5 text-purple-700">
                    <span>5. Plaka Tektoniği Hız Vektörlerinin (Vx, Vy, Vz) Noktaya Özel Tanımlanması</span>
                  </div>
                  <p>
                    BÖHYY ve HGM standartlarına göre Türkiye'deki farklı tektonik bloklardaki noktaların yıllık kayma hızları 
                    farklıdır. Manuel giriş ile noktanın tektonik hızları girilerek 2005.00 epoğuna doğru ötelenmesi sağlanır.
                  </p>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="p-4 bg-slate-50 border-t border-slate-200 flex justify-end">
              <button
                onClick={() => setIsLogicExplanationOpen(false)}
                className="px-5 py-2 bg-sky-600 hover:bg-sky-700 text-white font-bold rounded-lg cursor-pointer transition"
              >
                Anladım, Kapat
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 3. MANUEL KOORDİNAT GİRME / DÜZENLEME MODALI */}
      {/* ========================================================================= */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[92vh] flex flex-col overflow-hidden animate-in fade-in duration-150">
            {/* Modal Header */}
            <div className="p-5 border-b border-slate-200 bg-slate-900 text-white flex items-center justify-between">
              <div>
                <h3 className="font-bold text-base">
                  {modalMode === 'create' ? 'Yeni Nokta ve Manuel Koordinat Tanımla' : `Nokta Düzenle: ${formName}`}
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  TUREF / ITRF96, GRS80 Elipsoiti & NOAA ANTCAL Anten Standartları
                </p>
              </div>
              <button
                onClick={() => setIsModalOpen(false)}
                className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 space-y-5 overflow-y-auto custom-scrollbar flex-1 text-xs">
              {/* Guidance Info Box */}
              <div className="p-3 bg-sky-50 border border-sky-200 rounded-xl text-sky-950 space-y-1">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 font-bold text-sky-900 text-xs">
                    <HelpCircle className="w-4 h-4 text-sky-600 shrink-0" />
                    <span>Manuel Koordinat Girişinin Amacı:</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsLogicExplanationOpen(true)}
                    className="text-[10px] text-sky-700 hover:text-sky-950 font-bold underline cursor-pointer"
                  >
                    Detaylı Açıklamayı Gör
                  </button>
                </div>
                <p className="text-[11px] leading-relaxed text-sky-800">
                  Dayalı Dengelemede datum oluşturmak için tescilli TUSAGA (CORS) veya TUTGA referans koordinatlarını tanımlayabilir, 
                  veya RINEX başlığındaki yaklaşık koordinat hatalarını düzeltebilirsiniz.
                </p>
              </div>

              {/* Station General Info */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-700 font-bold mb-1">Nokta Adı / Nirengi Numarası</label>
                  <input
                    type="text"
                    value={formName}
                    onChange={(e) => {
                      setFormName(e.target.value);
                      if (modalMode === 'create') setFormId(e.target.value);
                    }}
                    placeholder="Örn: ANKR, POL1, C1-105"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg font-bold font-mono text-slate-900"
                  />
                </div>

                <div>
                  <label className="block text-slate-700 font-bold mb-1">Nokta Tipi ve Durumu</label>
                  <div className="flex gap-2 pt-0.5">
                    <button
                      type="button"
                      onClick={() => {
                        setFormIsFixed(true);
                        setFormType('CORS');
                      }}
                      className={`flex-1 py-1.5 px-2 rounded-lg font-bold text-xs cursor-pointer transition border ${
                        formIsFixed
                          ? 'bg-rose-50 border-rose-400 text-rose-800 shadow-xs'
                          : 'bg-slate-50 border-slate-200 text-slate-600'
                      }`}
                    >
                      SABİT (CORS / Datum)
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setFormIsFixed(false);
                        setFormType('GROUND');
                      }}
                      className={`flex-1 py-1.5 px-2 rounded-lg font-bold text-xs cursor-pointer transition border ${
                        !formIsFixed
                          ? 'bg-sky-50 border-sky-400 text-sky-800 shadow-xs'
                          : 'bg-slate-50 border-slate-200 text-slate-600'
                      }`}
                    >
                      SERBEST (Arazi Noktası)
                    </button>
                  </div>
                </div>
              </div>

              {/* Coordinate Entry System Tabs */}
              <div className="border border-slate-200 rounded-xl p-4 bg-slate-50 space-y-3">
                <div className="flex items-center justify-between border-b border-slate-200 pb-2">
                  <span className="font-bold text-slate-800 flex items-center gap-1.5">
                    <MapPin className="w-3.5 h-3.5 text-sky-600" />
                    <span>Koordinat Giriş Formatı (Otomatik Dönüştürülür)</span>
                  </span>

                  <div className="flex gap-1">
                    <button
                      type="button"
                      onClick={() => setCoordInputSystem('TM')}
                      className={`px-2.5 py-1 rounded-md font-bold cursor-pointer transition ${
                        coordInputSystem === 'TM' ? 'bg-sky-600 text-white' : 'bg-white text-slate-600'
                      }`}
                    >
                      TUREF TM{dom}°
                    </button>
                    <button
                      type="button"
                      onClick={() => setCoordInputSystem('ECEF')}
                      className={`px-2.5 py-1 rounded-md font-bold cursor-pointer transition ${
                        coordInputSystem === 'ECEF' ? 'bg-sky-600 text-white' : 'bg-white text-slate-600'
                      }`}
                    >
                      ECEF XYZ
                    </button>
                    <button
                      type="button"
                      onClick={() => setCoordInputSystem('GEO')}
                      className={`px-2.5 py-1 rounded-md font-bold cursor-pointer transition ${
                        coordInputSystem === 'GEO' ? 'bg-sky-600 text-white' : 'bg-white text-slate-600'
                      }`}
                    >
                      Coğrafi (φ, λ)
                    </button>
                  </div>
                </div>

                {coordInputSystem === 'TM' && (
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <label className="block text-slate-600 font-semibold mb-1">Sağa Değer Y (m)</label>
                      <input
                        type="number"
                        step="0.0001"
                        value={formTM_Y}
                        onChange={(e) => handleUpdateTM(parseFloat(e.target.value) || 0, formTM_X, formH)}
                        className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg font-mono font-bold"
                      />
                    </div>
                    <div>
                      <label className="block text-slate-600 font-semibold mb-1">Yukarı Değer X (m)</label>
                      <input
                        type="number"
                        step="0.0001"
                        value={formTM_X}
                        onChange={(e) => handleUpdateTM(formTM_Y, parseFloat(e.target.value) || 0, formH)}
                        className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg font-mono font-bold"
                      />
                    </div>
                    <div>
                      <label className="block text-slate-600 font-semibold mb-1">Elipsoit Kot H (m)</label>
                      <input
                        type="number"
                        step="0.0001"
                        value={formH}
                        onChange={(e) => handleUpdateTM(formTM_Y, formTM_X, parseFloat(e.target.value) || 0)}
                        className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg font-mono font-bold"
                      />
                    </div>
                  </div>
                )}

                {coordInputSystem === 'ECEF' && (
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <label className="block text-slate-600 font-semibold mb-1">ECEF X (m)</label>
                      <input
                        type="number"
                        step="0.0001"
                        value={formECEF_X}
                        onChange={(e) => handleUpdateECEF(parseFloat(e.target.value) || 0, formECEF_Y, formECEF_Z)}
                        className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg font-mono font-bold"
                      />
                    </div>
                    <div>
                      <label className="block text-slate-600 font-semibold mb-1">ECEF Y (m)</label>
                      <input
                        type="number"
                        step="0.0001"
                        value={formECEF_Y}
                        onChange={(e) => handleUpdateECEF(formECEF_X, parseFloat(e.target.value) || 0, formECEF_Z)}
                        className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg font-mono font-bold"
                      />
                    </div>
                    <div>
                      <label className="block text-slate-600 font-semibold mb-1">ECEF Z (m)</label>
                      <input
                        type="number"
                        step="0.0001"
                        value={formECEF_Z}
                        onChange={(e) => handleUpdateECEF(formECEF_X, formECEF_Y, parseFloat(e.target.value) || 0)}
                        className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg font-mono font-bold"
                      />
                    </div>
                  </div>
                )}

                {coordInputSystem === 'GEO' && (
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <label className="block text-slate-600 font-semibold mb-1">Enlem (Derece)</label>
                      <input
                        type="number"
                        step="0.0000001"
                        value={formLat}
                        onChange={(e) => handleUpdateGeo(parseFloat(e.target.value) || 0, formLon, formH)}
                        className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg font-mono font-bold"
                      />
                    </div>
                    <div>
                      <label className="block text-slate-600 font-semibold mb-1">Boylam (Derece)</label>
                      <input
                        type="number"
                        step="0.0000001"
                        value={formLon}
                        onChange={(e) => handleUpdateGeo(formLat, parseFloat(e.target.value) || 0, formH)}
                        className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg font-mono font-bold"
                      />
                    </div>
                    <div>
                      <label className="block text-slate-600 font-semibold mb-1">Elipsoit H (m)</label>
                      <input
                        type="number"
                        step="0.0001"
                        value={formH}
                        onChange={(e) => handleUpdateGeo(formLat, formLon, parseFloat(e.target.value) || 0)}
                        className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg font-mono font-bold"
                      />
                    </div>
                  </div>
                )}

                {/* Live Converted Preview */}
                <div className="pt-2 border-t border-slate-200 grid grid-cols-2 gap-2 text-[11px] text-slate-500 font-mono">
                  <div>
                    TM: Y={formTM_Y.toFixed(3)}, X={formTM_X.toFixed(3)}
                  </div>
                  <div>
                    ECEF: {formECEF_X.toFixed(2)}, {formECEF_Y.toFixed(2)}, {formECEF_Z.toFixed(2)}
                  </div>
                </div>
              </div>

              {/* Antenna Selection in Modal */}
              <div className="space-y-3 border border-slate-200 rounded-xl p-4">
                <div className="flex items-center justify-between">
                  <label className="font-bold text-slate-800 flex items-center gap-1.5">
                    <Sliders className="w-3.5 h-3.5 text-sky-600" />
                    <span>Anten Modeli ve NOAA ANTCAL Kalibrasyonu</span>
                  </label>
                  <span className="text-[10px] text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded font-bold border border-emerald-200">
                    Yerleşik Katalog ({NOAA_ANTCAL_CATALOG.length} Model)
                  </span>
                </div>

                <div>
                  <select
                    value={formAntModel}
                    onChange={(e) => {
                      setFormAntModel(e.target.value);
                      const cal = matchAntennaInNoaaCatalog(e.target.value);
                      if (cal) {
                        setFormAntRadius(cal.radius);
                        setFormAntOffset(cal.verticalOffset);
                      }
                    }}
                    className="w-full p-2 border border-slate-300 rounded-lg text-xs font-semibold bg-white text-slate-900"
                  >
                    {NOAA_ANTCAL_CATALOG.map((ant) => (
                      <option key={ant.model} value={ant.model}>
                        {ant.displayName} ({ant.model.trim()})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-slate-600 font-semibold mb-1">Yükseklik Ölçüm Tipi</label>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setFormHeightType('vertical')}
                        className={`flex-1 py-1.5 px-2 rounded-lg text-xs font-semibold cursor-pointer border ${
                          formHeightType === 'vertical'
                            ? 'bg-sky-600 text-white border-sky-600'
                            : 'bg-slate-50 text-slate-700 border-slate-300'
                        }`}
                      >
                        Düşey (Pilye)
                      </button>
                      <button
                        type="button"
                        onClick={() => setFormHeightType('slant')}
                        className={`flex-1 py-1.5 px-2 rounded-lg text-xs font-semibold cursor-pointer border ${
                          formHeightType === 'slant'
                            ? 'bg-sky-600 text-white border-sky-600'
                            : 'bg-slate-50 text-slate-700 border-slate-300'
                        }`}
                      >
                        Eğik (Sehpa)
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="block text-slate-600 font-semibold mb-1">Ölçülen Yükseklik (m)</label>
                    <input
                      type="number"
                      step="0.001"
                      value={formMeasuredH}
                      onChange={(e) => setFormMeasuredH(parseFloat(e.target.value) || 0)}
                      className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg font-mono font-bold text-slate-900"
                    />
                  </div>
                </div>

                <div className="p-2.5 bg-emerald-50 border border-emerald-200 rounded-lg flex items-center justify-between text-xs">
                  <span className="text-emerald-900 font-semibold">İndirgenmiş ARP Düşey Yüksekliği:</span>
                  <span className="font-mono font-bold text-emerald-800 text-sm">
                    {calculateCorrectedAntennaHeight(formHeightType, formMeasuredH, formAntRadius, formAntOffset).toFixed(4)} m
                  </span>
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="p-4 bg-slate-50 border-t border-slate-200 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="px-4 py-2 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-100 font-semibold cursor-pointer"
              >
                İptal
              </button>
              <button
                type="button"
                onClick={handleSaveModal}
                className="px-5 py-2 rounded-lg bg-sky-600 hover:bg-sky-700 text-white font-bold shadow-sm transition cursor-pointer flex items-center gap-1.5"
              >
                <Check className="w-4 h-4" />
                <span>{modalMode === 'create' ? 'Noktayı Projeye Ekle' : 'Değişiklikleri Kaydet'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
