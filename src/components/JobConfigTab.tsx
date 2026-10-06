/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * Modül 1: Proje ve Ayarlar Modülü (Job Configurations)
 * Açık renkli tasarım teması. Epok ayarları 6. modüle taşınmıştır.
 */

import React from 'react';
import { JobConfig, CRSSystem, AngleUnit } from '../types/gnss';
import { Settings, Globe2, Compass, ShieldCheck, Clock, Layers, Sliders, ArrowRight } from 'lucide-react';

interface Props {
  config: JobConfig;
  onChange: (newConfig: JobConfig) => void;
  onResetDefaults: () => void;
}

export const JobConfigTab: React.FC<Props> = ({ config, onChange, onResetDefaults }) => {
  const handleChange = (field: keyof JobConfig, value: any) => {
    onChange({
      ...config,
      [field]: value,
    });
  };

  const handleCrsChange = (crs: CRSSystem) => {
    let dom = 30;
    if (crs === 'TUREF-TM27') dom = 27;
    else if (crs === 'TUREF-TM30') dom = 30;
    else if (crs === 'TUREF-TM33') dom = 33;
    else if (crs === 'TUREF-TM36') dom = 36;
    else if (crs === 'TUREF-TM39') dom = 39;
    else if (crs === 'TUREF-TM42') dom = 42;

    onChange({
      ...config,
      crsSystem: crs,
      dom,
    });
  };

  return (
    <div className="space-y-6">
      {/* Overview Banner - Açık Renk Tasarım */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="bg-sky-100 text-sky-800 text-xs font-semibold px-2.5 py-0.5 rounded border border-sky-200">
                MODÜL 1
              </span>
              <h2 className="text-base sm:text-lg font-bold text-slate-900">
                Proje Parametreleri ve Jeodezik Standartlar
              </h2>
            </div>
            <p className="text-xs text-slate-500 max-w-2xl leading-relaxed">
              T.C. Harita Genel Müdürlüğü (HGM), BÖHYY (Büyük Ölçekli Harita ve Harita Bilgileri Üretim Yönetmeliği) 
              ve TUSAGA-Aktif (CORS-TR) standartlarına tam uyumlu 3D ağ dengeleme parametreleri.
            </p>
          </div>
          <button
            onClick={onResetDefaults}
            className="self-start md:self-auto px-3.5 py-2 text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg border border-slate-300 transition cursor-pointer flex items-center gap-1.5"
            title="Tüm ayarları HGM ve TUREF fabrika ayarlarına sıfırlar"
          >
            <Settings className="w-3.5 h-3.5 text-sky-600" />
            <span>Varsayılan Ayarlara Dön</span>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {/* 1. Proje Bilgileri */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5 space-y-4">
          <div className="flex items-center gap-2 text-slate-800 font-bold border-b border-slate-100 pb-3">
            <Globe2 className="w-4 h-4 text-sky-600" />
            <h3 className="text-sm">Proje Tanımları</h3>
          </div>

          <div className="space-y-3 text-xs">
            <div>
              <label className="block text-slate-600 font-medium mb-1">Proje Başlığı</label>
              <input
                type="text"
                value={config.projectName}
                onChange={(e) => handleChange('projectName', e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-sky-500 font-medium text-slate-800"
              />
            </div>

            <div>
              <label className="block text-slate-600 font-medium mb-1">Yüklenici / Mühendis</label>
              <input
                type="text"
                value={config.surveyor}
                onChange={(e) => handleChange('surveyor', e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-sky-500 text-slate-800"
              />
            </div>

            <div>
              <label className="block text-slate-600 font-medium mb-1">İdare / Kurum</label>
              <input
                type="text"
                value={config.institution}
                onChange={(e) => handleChange('institution', e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-sky-500 text-slate-800"
              />
            </div>

            <div>
              <label className="block text-slate-600 font-medium mb-1 flex items-center gap-1">
                <Clock className="w-3 h-3 text-slate-400" />
                <span>Zaman Dilimi</span>
              </label>
              <input
                type="text"
                value={config.timeZone}
                readOnly
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-600 font-mono font-medium"
              />
            </div>
          </div>
        </div>

        {/* 2. Koordinat ve Referans Sistemi */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5 space-y-4">
          <div className="flex items-center gap-2 text-slate-800 font-bold border-b border-slate-100 pb-3">
            <Compass className="w-4 h-4 text-emerald-600" />
            <h3 className="text-sm">Referans ve Projeksiyon Sistemi</h3>
          </div>

          <div className="space-y-3 text-xs">
            <div>
              <label className="block text-slate-600 font-medium mb-1">Koordinat Sistemi & Dilim</label>
              <select
                value={config.crsSystem}
                onChange={(e) => handleCrsChange(e.target.value as CRSSystem)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-sky-500 font-semibold text-slate-800 bg-white"
              >
                <option value="TUREF-TM27">TUREF / ITRF96 (TM27 - DOM 27°)</option>
                <option value="TUREF-TM30">TUREF / ITRF96 (TM30 - DOM 30°)</option>
                <option value="TUREF-TM33">TUREF / ITRF96 (TM33 - DOM 33°)</option>
                <option value="TUREF-TM36">TUREF / ITRF96 (TM36 - DOM 36°)</option>
                <option value="TUREF-TM39">TUREF / ITRF96 (TM39 - DOM 39°)</option>
                <option value="TUREF-TM42">TUREF / ITRF96 (TM42 - DOM 42°)</option>
              </select>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-slate-600 font-medium mb-1">Merkezi Meridyen (DOM)</label>
                <div className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg font-mono font-bold text-slate-700">
                  {config.dom}° Doğu
                </div>
              </div>
              <div>
                <label className="block text-slate-600 font-medium mb-1">Açı Birimi</label>
                <select
                  value={config.angleUnit}
                  onChange={(e) => handleChange('angleUnit', e.target.value as AngleUnit)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-sky-500 font-medium text-slate-800 bg-white"
                >
                  <option value="Gon">Gon (Grad / 400G)</option>
                  <option value="Degree">Derece (360°)</option>
                  <option value="DMS">DMS (GG°DD'SS")</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-slate-600 font-medium mb-1">Referans Elipsoidi</label>
              <div className="p-2.5 bg-slate-50 border border-slate-200 rounded-lg text-slate-700 font-mono text-[11px] space-y-0.5">
                <div className="font-semibold text-slate-900">GRS80 (Geodetic Reference System 1980)</div>
                <div>a = 6,378,137.0000 m</div>
                <div>1/f = 298.257222101 (b = 6,356,752.3141 m)</div>
              </div>
            </div>
          </div>
        </div>

        {/* 3. Dengeleme ve Döngü Toleransları (Epok ayarları Modül 6'ya taşındı) */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5 space-y-4">
          <div className="flex items-center gap-2 text-slate-800 font-bold border-b border-slate-100 pb-3">
            <ShieldCheck className="w-4 h-4 text-amber-600" />
            <h3 className="text-sm">Dengeleme ve Döngü Toleransları</h3>
          </div>

          <div className="space-y-3 text-xs">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-slate-600 font-medium mb-1">Uydu Yükseklik Maskesi</label>
                <div className="flex items-center">
                  <input
                    type="number"
                    value={config.elevationMask}
                    onChange={(e) => handleChange('elevationMask', parseInt(e.target.value) || 10)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono text-slate-800"
                  />
                  <span className="ml-1 text-slate-500 font-bold">°</span>
                </div>
              </div>
              <div>
                <label className="block text-slate-600 font-medium mb-1">Baarda w-testi Eşik</label>
                <input
                  type="number"
                  step="0.01"
                  value={config.wCrit}
                  onChange={(e) => handleChange('wCrit', parseFloat(e.target.value) || 3.29)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono font-bold text-amber-800"
                />
              </div>
            </div>

            <div>
              <label className="block text-slate-600 font-medium mb-1">Döngü Kapanış Toleransı (Formül)</label>
              <div className="flex items-center gap-1.5">
                <input
                  type="number"
                  value={config.loopToleranceBaseMm}
                  onChange={(e) => handleChange('loopToleranceBaseMm', parseFloat(e.target.value) || 10)}
                  className="w-16 px-2.5 py-1.5 border border-slate-300 rounded-lg font-mono text-center font-bold"
                />
                <span className="text-slate-600 font-semibold">mm +</span>
                <input
                  type="number"
                  step="0.1"
                  value={config.loopTolerancePpm}
                  onChange={(e) => handleChange('loopTolerancePpm', parseFloat(e.target.value) || 1.0)}
                  className="w-16 px-2.5 py-1.5 border border-slate-300 rounded-lg font-mono text-center font-bold"
                />
                <span className="text-slate-600 font-semibold">ppm · S</span>
              </div>
              <p className="text-[10px] text-slate-400 mt-1">
                Örnek: 40 km döngü çevresi için T = 10 mm + 1.0 × 40 = 50.0 mm
              </p>
            </div>

            {/* Info notice about epoch settings being in Module 6 */}
            <div className="p-3 bg-sky-50 border border-sky-200 rounded-lg text-sky-900 space-y-1">
              <div className="flex items-center gap-1.5 font-bold text-[11px] text-sky-800">
                <Clock className="w-3.5 h-3.5 text-sky-600" />
                <span>Epok Parametreleri Taşındı:</span>
              </div>
              <p className="text-[11px] text-sky-700 leading-relaxed">
                Ölçü epoğu (t) yüklenen RINEX verilerinden otomatik olarak tespit edilir ve 
                <strong> 6. Epok & GeoCalc</strong> sekmesinde yönetilir.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
