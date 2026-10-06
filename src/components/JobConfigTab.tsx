/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * Proje Ayarları (Job Configurations)
 * Topcon & Trimble Uyumlu Jeodezik Parametreler
 */

import React from 'react';
import { JobConfig, CRSSystem, AngleUnit } from '../types/gnss';
import { Settings, Globe2, Compass, ShieldCheck, Clock } from 'lucide-react';

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
            <h2 className="text-base sm:text-lg font-bold text-slate-900">
              Proje Ayarları ve Jeodezik Parametreler
            </h2>
            <p className="text-xs text-slate-500 max-w-2xl leading-relaxed">
              TUREF / ITRF96 referans sistemi, BÖHYY yönetmeliği ve Topcon & Trimble yazılım standartlarına uygun proje tanımları ve dengeleme toleransları.
            </p>
          </div>
          <button
            onClick={onResetDefaults}
            className="self-start md:self-auto px-3.5 py-2 text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg border border-slate-300 transition cursor-pointer flex items-center gap-1.5"
            title="Tüm ayarları varsayılan değerlerine sıfırlar"
          >
            <Settings className="w-3.5 h-3.5 text-sky-600" />
            <span>Varsayılan Ayarlara Dön</span>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {/* 1. Proje Tanımları */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5 space-y-4">
          <div className="flex items-center gap-2 text-slate-800 font-bold border-b border-slate-100 pb-3">
            <Globe2 className="w-4 h-4 text-sky-600" />
            <h3 className="text-sm font-bold">Proje Tanımları</h3>
          </div>

          <div className="space-y-3.5 text-xs">
            <div>
              <label className="block text-slate-600 font-semibold mb-1">Proje Başlığı</label>
              <input
                type="text"
                value={config.projectName}
                onChange={(e) => handleChange('projectName', e.target.value)}
                placeholder="Proje adını giriniz"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-sky-500 font-medium text-slate-800 bg-white"
              />
            </div>

            <div>
              <label className="block text-slate-600 font-semibold mb-1">Hesaplayan</label>
              <input
                type="text"
                value={config.surveyor}
                onChange={(e) => handleChange('surveyor', e.target.value)}
                placeholder="Hesaplayan harita mühendisi"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-sky-500 text-slate-800 bg-white"
              />
            </div>

            <div>
              <label className="block text-slate-600 font-semibold mb-1">Kontrol Eden</label>
              <input
                type="text"
                value={config.checker || ''}
                onChange={(e) => handleChange('checker', e.target.value)}
                placeholder="Kontrol eden mühendis / kurum"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-sky-500 text-slate-800 bg-white"
              />
            </div>
          </div>
        </div>

        {/* 2. Referans ve Projeksiyon Sistemi */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5 space-y-4">
          <div className="flex items-center gap-2 text-slate-800 font-bold border-b border-slate-100 pb-3">
            <Compass className="w-4 h-4 text-emerald-600" />
            <h3 className="text-sm font-bold">Referans ve Projeksiyon Sistemi</h3>
          </div>

          <div className="space-y-3 text-xs">
            <div>
              <label className="block text-slate-600 font-semibold mb-1">Koordinat Sistemi & Dilim</label>
              <select
                value={config.crsSystem}
                onChange={(e) => handleCrsChange(e.target.value as CRSSystem)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-sky-500 font-semibold text-slate-800 bg-white"
              >
                <option value="TUREF-TM27">TUREF / ITRF96 (TM27 - 3° Dilim)</option>
                <option value="TUREF-TM30">TUREF / ITRF96 (TM30 - 3° Dilim)</option>
                <option value="TUREF-TM33">TUREF / ITRF96 (TM33 - 3° Dilim)</option>
                <option value="TUREF-TM36">TUREF / ITRF96 (TM36 - 3° Dilim)</option>
                <option value="TUREF-TM39">TUREF / ITRF96 (TM39 - 3° Dilim)</option>
                <option value="TUREF-TM42">TUREF / ITRF96 (TM42 - 3° Dilim)</option>
              </select>
            </div>

            <div>
              <label className="block text-slate-600 font-semibold mb-1">Merkezi Meridyen (DOM)</label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  value={config.dom}
                  onChange={(e) => handleChange('dom', parseInt(e.target.value, 10) || 30)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono font-bold text-slate-800 bg-white"
                />
                <span className="text-slate-600 font-bold">° Doğu</span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-slate-600 font-semibold mb-1">Açı Birimi</label>
                <select
                  value={config.angleUnit}
                  onChange={(e) => handleChange('angleUnit', e.target.value as AngleUnit)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-sky-500 font-medium text-slate-800 bg-white"
                >
                  <option value="Gon">Gons (Grad)</option>
                  <option value="Degree">Derece (°)</option>
                  <option value="DMS">DMS (GG°DD'SS")</option>
                </select>
              </div>

              <div>
                <label className="block text-slate-600 font-semibold mb-1">Uzunluk Birimi</label>
                <input
                  type="text"
                  value={config.lengthUnit || 'Metre'}
                  readOnly
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-700 font-semibold text-center"
                />
              </div>
            </div>

            <div>
              <label className="block text-slate-600 font-semibold mb-1 flex items-center gap-1">
                <Clock className="w-3.5 h-3.5 text-slate-500" />
                <span>Zaman Dilimi</span>
              </label>
              <input
                type="text"
                value={config.timeZone}
                onChange={(e) => handleChange('timeZone', e.target.value)}
                placeholder="Örn: GMT+03:00"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-sky-500 text-slate-800 font-medium bg-white"
              />
            </div>
          </div>
        </div>

        {/* 3. Dengeleme Ayarları */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5 space-y-4">
          <div className="flex items-center gap-2 text-slate-800 font-bold border-b border-slate-100 pb-3">
            <ShieldCheck className="w-4 h-4 text-amber-600" />
            <h3 className="text-sm font-bold">Dengeleme Ayarları</h3>
          </div>

          <div className="space-y-3.5 text-xs">
            <div>
              <label className="block text-slate-600 font-semibold mb-1">Uydu Seçenekleri</label>
              <select
                value={config.satelliteSystems || 'GPS+GLONASS'}
                onChange={(e) => handleChange('satelliteSystems', e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-sky-500 font-semibold text-slate-800 bg-white"
              >
                <option value="GPS Only">GPS Only</option>
                <option value="GPS+GLONASS">GPS + GLONASS (GPS+)</option>
                <option value="Multi-GNSS">Multi-GNSS (GPS+GLONASS+Galileo+BeiDou)</option>
              </select>
            </div>

            <div>
              <label className="block text-slate-600 font-semibold mb-1">Elevation Mask</label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  value={config.elevationMask}
                  onChange={(e) => handleChange('elevationMask', parseInt(e.target.value, 10) || 10)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono font-bold text-slate-800 bg-white"
                />
                <span className="text-slate-600 font-bold">°</span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-slate-600 font-semibold mb-1">Yatay Tolerans</label>
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    step="0.01"
                    value={config.horizontalTolerance ?? 0.03}
                    onChange={(e) => handleChange('horizontalTolerance', parseFloat(e.target.value) || 0.03)}
                    className="w-full px-2.5 py-2 border border-slate-300 rounded-lg font-mono font-bold text-emerald-700 bg-white"
                  />
                  <span className="text-slate-500 font-semibold">m</span>
                </div>
              </div>

              <div>
                <label className="block text-slate-600 font-semibold mb-1">Dikey Tolerans</label>
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    step="0.01"
                    value={config.verticalTolerance ?? 0.05}
                    onChange={(e) => handleChange('verticalTolerance', parseFloat(e.target.value) || 0.05)}
                    className="w-full px-2.5 py-2 border border-slate-300 rounded-lg font-mono font-bold text-sky-700 bg-white"
                  />
                  <span className="text-slate-500 font-semibold">m</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
